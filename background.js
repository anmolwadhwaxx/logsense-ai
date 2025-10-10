// Store all captured request data organized by session ID
const sessions = {}; // sessionId -> { requests: {}, envInfo: null, lastActivity: timestamp }
const recentSessionsByDomain = {}; // domain -> sessionId (for fallback during refresh)
const popupSourceTabs = {}; // popupId -> tabId (track which tab each popup was opened from)
let popupCounter = 0; // Generate unique popup IDs
const MAX_STORED_REQUESTS_PER_SESSION = 500;
const MAX_SESSIONS = 10; // Keep last 10 sessions
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = 'easylog_sessions';
const ENV_STORAGE_KEY = 'easylog_env_info';

// Store latest environment info sent from content script
let cachedEnvInfo = null;

// Add throttling for popup requests
let lastPopupRequestTime = 0;
const POPUP_REQUEST_THROTTLE = 50; // Reduced to 50ms throttle

// Load stored sessions on startup
chrome.storage.local.get([STORAGE_KEY], (result) => {
  if (result[STORAGE_KEY]) {
    Object.assign(sessions, result[STORAGE_KEY]);
    console.log('[background.js] Restored', Object.keys(sessions).length, 'sessions from storage');
  }
});

// Load cached environment info on startup
chrome.storage.local.get([ENV_STORAGE_KEY], (result) => {
  if (result[ENV_STORAGE_KEY]) {
    cachedEnvInfo = result[ENV_STORAGE_KEY];
    console.log('[background.js] Restored environment info from storage');
  }
});

// Clean up popup tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove any popup tracking for the closed tab
  for (const [popupId, sourceTabId] of Object.entries(popupSourceTabs)) {
    if (sourceTabId === tabId) {
      delete popupSourceTabs[popupId];
      console.log(`[background.js] Cleaned up popup ${popupId} tracking for closed tab ${tabId}`);
    }
  }
});

// Helper function to get or create session
function getOrCreateSession(sessionId) {
  if (!sessionId || sessionId === 'N/A') {
    return null; // Don't create sessions for invalid session IDs
  }
  
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      requests: {},
      envInfo: null,
      lastActivity: Date.now(),
      createdAt: Date.now()
    };
    console.log(`[background.js] Created new session: ${sessionId}`);
  } else {
    sessions[sessionId].lastActivity = Date.now();
  }
  
  return sessions[sessionId];
}

// Helper function to extract session ID from request
function extractSessionId(requestHeaders, url) {
  // Try to get q2token from headers first
  if (requestHeaders) {
    const q2tokenHeader = requestHeaders.find(h => h.name.toLowerCase() === 'q2token');
    if (q2tokenHeader && q2tokenHeader.value && q2tokenHeader.value !== 'null') {
      return q2tokenHeader.value;
    }
  }
  
  // Fallback to URL-based extraction for logonUser requests
  if (url && url.includes('logonUser?')) {
    return 'pending_logon'; // Temporary session for logon requests
  }
  
  return null;
}

// Persist sessions to storage (debounced)
let saveTimeout = null;
function saveSessionsToStorage() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    // Clean up old sessions
    cleanupOldSessions();
    
    chrome.storage.local.set({
      [STORAGE_KEY]: sessions
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('[background.js] Error saving sessions:', chrome.runtime.lastError);
      }
    });
  }, 1000);
}

// Clean up old sessions to prevent storage overflow
function cleanupOldSessions() {
  const sessionEntries = Object.entries(sessions);
  
  // If we have too many sessions, keep only the most recent ones
  if (sessionEntries.length > MAX_SESSIONS) {
    sessionEntries.sort(([,a], [,b]) => b.lastActivity - a.lastActivity);
    
    const sessionsToKeep = sessionEntries.slice(0, MAX_SESSIONS);
    const newSessions = {};
    
    sessionsToKeep.forEach(([sessionId, sessionData]) => {
      newSessions[sessionId] = sessionData;
    });
    
    // Replace sessions object
    for (const key in sessions) delete sessions[key];
    Object.assign(sessions, newSessions);
    
    console.log(`[background.js] Cleaned up sessions, kept ${Object.keys(sessions).length} most recent`);
  }
  
  // Clean up old requests within each session
  Object.values(sessions).forEach(session => {
    const requests = Object.values(session.requests);
    if (requests.length > MAX_STORED_REQUESTS_PER_SESSION) {
      requests.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      const recentRequests = requests.slice(0, MAX_STORED_REQUESTS_PER_SESSION);
      
      session.requests = {};
      recentRequests.forEach(req => {
        session.requests[req.requestId] = req;
      });
    }
  });
}

// Run cleanup every hour
setInterval(() => {
  cleanupOldSessions();
  saveSessionsToStorage();
}, SESSION_CLEANUP_INTERVAL);

// Helper function to get session data for a specific tab
function getSessionDataForTab(tab, callback) {
  if (!tab) {
    callback([]);
    return;
  }

  const url = new URL(tab.url);
  const domain = url.hostname;
  
  console.log(`[background.js] Getting session data for tab: ${tab.id}, domain: ${domain}, url: ${tab.url}`);
  
  // Get cookies from the active tab to find the current session
  // Try different cookie scopes to ensure we get the right session
  const cookieQueries = [
    { domain: domain }, // Exact domain match
    { url: tab.url }, // URL-based lookup (includes path/subdomain context)
    { domain: domain.startsWith('.') ? domain : '.' + domain } // Try with dot prefix for parent domain
  ];
  
  let activeSessionId = null;
  let queryIndex = 0;
  
  function tryNextCookieQuery() {
    if (queryIndex >= cookieQueries.length) {
      // No session found with cookies, try fallback using recent domain activity
      const recentSessionId = recentSessionsByDomain[domain];
      if (recentSessionId && sessions[recentSessionId]) {
        console.log(`[background.js] Using fallback session ${recentSessionId} for domain ${domain}`);
        const sessionRequests = Object.values(sessions[recentSessionId].requests);
        callback(sessionRequests);
        return;
      }
      
      // No session found with any method, return empty data
      console.log(`[background.js] No q2token found for ${domain} after trying all queries and fallbacks`);
      callback([]);
      return;
    }
    
    const query = cookieQueries[queryIndex++];
    console.log(`[background.js] Trying cookie query ${queryIndex}/${cookieQueries.length}:`, query);
    
    chrome.cookies.getAll(query, (cookies) => {
      if (chrome.runtime.lastError) {
        console.warn(`[background.js] Cookie query error:`, chrome.runtime.lastError);
        tryNextCookieQuery();
        return;
      }
      
      // Look for q2token in cookies
      for (const cookie of cookies) {
        if (cookie.name.toLowerCase() === 'q2token' && cookie.value && cookie.value !== 'null' && cookie.value !== 'undefined') {
          activeSessionId = cookie.value;
          console.log(`[background.js] Found session ID with query ${queryIndex}: ${activeSessionId}`);
          
          // Update recent session tracking for this domain
          recentSessionsByDomain[domain] = activeSessionId;
          break;
        }
      }
      
      if (activeSessionId && sessions[activeSessionId]) {
        const sessionRequests = Object.values(sessions[activeSessionId].requests);
        console.log(`[background.js] Returning ${sessionRequests.length} requests for session ${activeSessionId} (tab: ${tab.id})`);
        callback(sessionRequests);
      } else if (activeSessionId) {
        console.log(`[background.js] Session ${activeSessionId} found in cookies but not in sessions storage (tab: ${tab.id})`);
        // Session ID exists but no session data - return empty but log available sessions
        const availableSessions = Object.keys(sessions);
        console.log(`[background.js] Available sessions: [${availableSessions.join(', ')}]`);
        callback([]);
      } else {
        // Try next query
        tryNextCookieQuery();
      }
    });
  }
  
  tryNextCookieQuery();
}

// --- Helper function ---

// Extract `fi_no` from the request URL (used for CDN deport pattern)
function extractFiNo(url) {
  const match = url.match(/cdn\/deport\/([^/]+)/);
  return match ? match[1] : null;
}

// --- Web Request Listeners ---

// Temporary storage for requests before we know their session ID
const tempRequests = {};

// Capture initial request details
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Store temporarily until we get session ID from headers
    tempRequests[details.requestId] = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      startTime: details.timeStamp,
      fi_no: extractFiNo(details.url),
      postData: details.requestBody ? JSON.stringify(details.requestBody) : null,
      isLogonUser: details.url.includes('logonUser?') // Flag logonUser requests
    };
  },
  { urls: ["<all_urls>"] }, // Listen to all URLs
  ["requestBody"] // Capture request body for HAR
);

// Capture request headers to extract q2token, workstation-id, utcOffset and assign to session
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const tempReq = tempRequests[details.requestId];
    if (!tempReq) return;
    tempReq.requestHeaders = details.requestHeaders;

    // Extract session ID from request
    const sessionId = extractSessionId(details.requestHeaders, tempReq.url);
    
    if (sessionId) {
      // Get or create session
      const session = getOrCreateSession(sessionId);
      if (session) {
        // Move request from temp storage to session
        const req = { ...tempReq };
        
        // Extract q2token from headers
        const q2tokenHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'q2token');
        req.q2token = q2tokenHeader?.value || sessionId;

        // Extract from Cookie header
        const cookieHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
        if (cookieHeader?.value) {
          // Extract workstation-id from cookie string
          const matchWorkstationId = cookieHeader.value.match(/(?:^|;\s*)workstation-id=([^;]*)/i);
          if (matchWorkstationId) {
            req.workstationId = matchWorkstationId[1];
          }

          // Extract utcOffset (e.g. +0000) from cookie
          const matchUtcOffset = cookieHeader.value.match(/(?:^|;\s*)utcOffset=([-+]\d{4})/i);
          if (matchUtcOffset) {
            req.utcOffset = matchUtcOffset[1];
          }
        }
        
        // Store in session
        session.requests[details.requestId] = req;
        
        // Track recent session activity by domain for fallback
        try {
          const domain = new URL(req.url).hostname;
          recentSessionsByDomain[domain] = sessionId;
          console.log(`[background.js] Updated recent session for ${domain}: ${sessionId}`);
        } catch (e) {
          console.warn('[background.js] Could not extract domain from URL:', req.url);
        }
        
        saveSessionsToStorage();
      }
    }
    
    // Clean up temp storage
    delete tempRequests[details.requestId];
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"] // Required to access request headers
);

// Capture response headers for the request
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Find request in any session
    let req = null;
    let parentSession = null;
    
    for (const session of Object.values(sessions)) {
      if (session.requests[details.requestId]) {
        req = session.requests[details.requestId];
        parentSession = session;
        break;
      }
    }
    
    if (req) {
      req.responseHeaders = details.responseHeaders;
      req.statusText = details.statusLine;
      
      // Extract content type for HAR
      const contentTypeHeader = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type');
      req.mimeType = contentTypeHeader?.value || 'text/plain';
      
      // For logonUser requests, inject script to capture response body
      if (req.isLogonUser && details.tabId && details.tabId !== -1) {
        // Inject script to capture response body for this specific request
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          func: captureLogonUserResponse,
          args: [details.url, details.requestId, req.q2token || 'pending_logon']
        }).catch(err => {
          console.warn('[background.js] Failed to inject response capture script:', err);
        });
      }
      
      saveSessionsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"] // Required to access response headers
);

// Function to inject for capturing logonUser response body
function captureLogonUserResponse(url, requestId) {
  // This function runs in the page context
  
  // Override fetch if not already done
  if (!window.easyLogFetchOverridden) {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const [resource, config] = args;
      let requestUrl = resource;
      
      if (resource instanceof Request) {
        requestUrl = resource.url;
      }
      
      const response = await originalFetch.apply(this, args);
      
      // Check if this matches our target URL
      if (requestUrl === url) {
        try {
          const responseClone = response.clone();
          const responseBody = await responseClone.text();
          
          // Send to background script
          chrome.runtime.sendMessage({
            type: 'LOGON_USER_RESPONSE_CAPTURED',
            data: {
              requestId: requestId,
              url: requestUrl,
              responseBody: responseBody,
              status: response.status,
              statusText: response.statusText,
              timestamp: Date.now()
            }
          });
        } catch (error) {
          console.warn('[EasyLog] Failed to capture response body:', error);
        }
      }
      
      return response;
    };
    window.easyLogFetchOverridden = true;
  }
  
  // Also check if request was made via XHR
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, requestUrl, ...args) {
    this._easyLogUrl = requestUrl;
    this._easyLogRequestId = requestId;
    return originalXHROpen.apply(this, [method, requestUrl, ...args]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._easyLogUrl === url) {
      this.addEventListener('loadend', () => {
        if (this.readyState === 4) {
          try {
            chrome.runtime.sendMessage({
              type: 'LOGON_USER_RESPONSE_CAPTURED',
              data: {
                requestId: this._easyLogRequestId,
                url: this._easyLogUrl,
                responseBody: this.responseText,
                status: this.status,
                statusText: this.statusText,
                timestamp: Date.now()
              }
            });
          } catch (error) {
            console.warn('[EasyLog] Failed to capture XHR response body:', error);
          }
        }
      });
    }
    
    return originalXHRSend.apply(this, args);
  };
}

// Capture when request is completed to store status and end time
chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Find request in any session
    let req = null;
    
    for (const session of Object.values(sessions)) {
      if (session.requests[details.requestId]) {
        req = session.requests[details.requestId];
        break;
      }
    }
    
    if (req) {
      req.statusCode = details.statusCode;
      req.endTime = details.timeStamp;
      req.responseSize = details.responseSize;
      saveSessionsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] }
);

// Capture error information
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    // Find request in any session
    let req = null;
    
    for (const session of Object.values(sessions)) {
      if (session.requests[details.requestId]) {
        req = session.requests[details.requestId];
        break;
      }
    }
    
    if (req) {
      req.error = details.error;
      req.endTime = details.timeStamp;
      saveSessionsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] }
);

// --- Message Listener (handles messages from popup or content script) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[background.js] Received message:', {
    type: message?.type,
    action: message?.action,
    tabId: sender.tab?.id,
    url: sender.tab?.url,
    messageKeys: message ? Object.keys(message) : 'no message'
  });
  
  // Handle undefined or malformed messages
  if (!message) {
    console.warn('[background.js] Received undefined message');
    sendResponse({ error: 'Message is undefined' });
    return true;
  }
  
  // Test message from content script
  if (message.type === 'TEST_CONTENT_TO_BACKGROUND') {
    console.log('[background.js] TEST: Received test message from content script:', message.data);
    sendResponse({ success: true, message: 'Background received your test message' });
    return true; // Keep message channel open
  }
  
  // Initialize popup with source tab tracking
  if (message.action === 'initializePopup') {
    // Generate unique popup ID and track the source tab
    const popupId = ++popupCounter;
    
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        popupSourceTabs[popupId] = tabs[0].id;
        console.log(`[background.js] Popup ${popupId} initialized for tab ${tabs[0].id} (${new URL(tabs[0].url).hostname})`);
        sendResponse({ popupId: popupId, sourceTabId: tabs[0].id });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
    return true; // Keep message channel open for async response

  // Return captured network data to popup (session-specific for the popup's source tab)
  } else if (message.action === 'getNetworkData') {
    const popupId = message.popupId;
    const sourceTabId = popupId ? popupSourceTabs[popupId] : null;
    
    const now = Date.now();
    if (now - lastPopupRequestTime < POPUP_REQUEST_THROTTLE) {
      // For throttling, we still need to determine the session for the popup's source tab
      if (sourceTabId) {
        chrome.tabs.get(sourceTabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            console.warn(`[background.js] Source tab ${sourceTabId} no longer exists, using active tab as fallback`);
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
              if (tabs[0]) {
                getSessionDataForTab(tabs[0], (sessionData) => {
                  sendResponse({ data: sessionData });
                });
              } else {
                sendResponse({ data: [] });
              }
            });
          } else {
            getSessionDataForTab(tab, (sessionData) => {
              sendResponse({ data: sessionData });
            });
          }
        });
      } else {
        // Fallback to active tab if no popup ID provided
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            getSessionDataForTab(tabs[0], (sessionData) => {
              sendResponse({ data: sessionData });
            });
          } else {
            sendResponse({ data: [] });
          }
        });
      }
      return true; // Keep message channel open for async response
    }
    lastPopupRequestTime = now;
    
    // Get session data for the popup's source tab, not the currently active tab
    // Add retry logic to handle timing issues during tab refresh
    function attemptGetSessionData(retryCount = 0) {
      const maxRetries = 3;
      const retryDelay = 100; // 100ms delay between retries
      
      if (sourceTabId) {
        chrome.tabs.get(sourceTabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            console.warn(`[background.js] Source tab ${sourceTabId} no longer exists, using active tab as fallback`);
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
              if (!tabs[0]) {
                sendResponse({ data: [] });
                return;
              }
              
              getSessionDataForTab(tabs[0], (sessionData) => {
                // If no session data found and we haven't exhausted retries, try again
                if (sessionData.length === 0 && retryCount < maxRetries) {
                  console.log(`[background.js] No session data found (fallback), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
                  setTimeout(() => {
                    attemptGetSessionData(retryCount + 1);
                  }, retryDelay);
                } else {
                  console.log(`[background.js] Sending response with ${sessionData.length} requests from fallback tab (attempt ${retryCount + 1})`);
                  sendResponse({ data: sessionData });
                }
              });
            });
            return;
          }
          
          getSessionDataForTab(tab, (sessionData) => {
            // If no session data found and we haven't exhausted retries, try again
            if (sessionData.length === 0 && retryCount < maxRetries) {
              console.log(`[background.js] No session data found for source tab ${sourceTabId}, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
              setTimeout(() => {
                attemptGetSessionData(retryCount + 1);
              }, retryDelay);
            } else {
              console.log(`[background.js] Sending response with ${sessionData.length} requests for source tab ${sourceTabId} (attempt ${retryCount + 1})`);
              sendResponse({ data: sessionData });
            }
          });
        });
      } else {
        // Fallback to active tab if no popup ID provided
        console.warn(`[background.js] No popup ID provided, using active tab as fallback`);
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (!tabs[0]) {
            sendResponse({ data: [] });
            return;
          }
          
          getSessionDataForTab(tabs[0], (sessionData) => {
            // If no session data found and we haven't exhausted retries, try again
            if (sessionData.length === 0 && retryCount < maxRetries) {
              console.log(`[background.js] No session data found (active tab fallback), retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`);
              setTimeout(() => {
                attemptGetSessionData(retryCount + 1);
              }, retryDelay);
            } else {
              console.log(`[background.js] Sending response with ${sessionData.length} requests from active tab fallback (attempt ${retryCount + 1})`);
              sendResponse({ data: sessionData });
            }
          });
        });
      }
    }
    
    attemptGetSessionData();
    return true; // Keep message channel open for async response

  // Clear specific session or all data
  } else if (message.action === 'clearNetworkData') {
    if (message.sessionId) {
      // Clear specific session
      if (sessions[message.sessionId]) {
        delete sessions[message.sessionId];
        console.log(`[background.js] Cleared session: ${message.sessionId}`);
      }
    } else {
      // Clear all sessions
      for (const key in sessions) delete sessions[key];
      console.log('[background.js] Cleared all sessions');
    }
    
    lastPopupRequestTime = 0; // Reset throttle
    saveSessionsToStorage();
    sendResponse({ success: true });

  // Cache environment info sent by content script
  } else if (message.type === 'UUX_ENV_INFO') {
    cachedEnvInfo = message.data;
    // Persist environment info to storage
    chrome.storage.local.set({
      [ENV_STORAGE_KEY]: message.data
    });
    sendResponse({ success: true });

  // Provide cached env info when popup requests it
  } else if (message.type === 'GET_CACHED_ENV_INFO') {
    sendResponse({ data: cachedEnvInfo });

  // Handle logonUser response body capture
  } else if (message.type === 'LOGON_USER_RESPONSE') {
    console.log('[background.js] Received LOGON_USER_RESPONSE!', message.data?.url);
    
    const responseData = message.data;
    
    // Collect all requests from all sessions for debugging
    const allRequests = [];
    for (const session of Object.values(sessions)) {
      if (session.requests) {
        allRequests.push(...Object.values(session.requests));
      }
    }
    
    // Log all existing logonUser requests for debugging
    const existingLogonRequests = allRequests.filter(req => 
      req.url?.includes('logonUser?') || req.isLogonUserCapture
    );
    console.log('[background.js] Existing logonUser requests:', existingLogonRequests.length);
    existingLogonRequests.forEach((req, index) => {
      console.log(`[background.js] Existing ${index + 1}:`, {
        id: req.requestId,
        url: req.url,
        time: new Date(req.startTime || 0).toISOString(),
        source: req.isLogonUserCapture ? 'inject capture' : 'webRequest'
      });
    });
    
    // Find matching request by URL and approximate timestamp
    let matchingRequest = null;
    
    // Look for request with same URL within last 30 seconds across all sessions
    const timeWindow = 30000; // 30 seconds
    for (const req of allRequests) {
      if (req.url === responseData.url && 
          Math.abs((req.startTime || 0) - responseData.timestamp) < timeWindow) {
        matchingRequest = req;
        console.log('[background.js] Found matching request for response body:', req.requestId);
        break;
      }
    }
    
    if (matchingRequest) {
      // Add response body to existing request
      matchingRequest.responseBody = responseData.responseBody;
      matchingRequest.capturedResponseHeaders = responseData.headers;
      console.log('[background.js] Added response body to request:', matchingRequest.requestId);
    } else {
      // Create new entry for this logonUser response
      console.log('[background.js] No matching request found, creating new synthetic entry');
      const syntheticId = 'logon_' + Date.now();
      
      // Ensure we have an absolute URL
      let absoluteUrl = responseData.url;
      if (responseData.url && !responseData.url.startsWith('http')) {
        // Convert relative URL to absolute using the sender tab's URL
        try {
          const tabUrl = sender.tab?.url;
          if (tabUrl) {
            const baseUrl = new URL(tabUrl);
            // For relative URLs like "mobilews/logonUser?ws25", we need to resolve against the tab's path
            // This will preserve the FI-specific path structure
            absoluteUrl = new URL(responseData.url, tabUrl).href;
            console.log('[background.js] Converted relative URL:', responseData.url, 'to absolute:', absoluteUrl, 'using base:', tabUrl);
          } else {
            console.warn('[background.js] No tab URL available for relative URL conversion:', responseData.url);
            absoluteUrl = responseData.url; // fallback to original
          }
        } catch (error) {
          console.warn('[background.js] Failed to convert relative URL:', responseData.url, error);
          absoluteUrl = responseData.url; // fallback to original
        }
      }
      
      // Create synthetic request and store in appropriate session
      const syntheticRequest = {
        requestId: syntheticId,
        url: absoluteUrl,
        method: responseData.method,
        startTime: responseData.timestamp,
        endTime: responseData.timestamp,
        statusCode: responseData.status,
        statusText: responseData.statusText,
        responseBody: responseData.responseBody,
        capturedResponseHeaders: responseData.headers,
        isLogonUserCapture: true, // Flag to identify these special captures
        q2token: responseData.q2token // Include session ID from the captured request
      };
      
      // Store in the appropriate session
      const sessionId = responseData.q2token || 'captured_' + Date.now();
      const session = getOrCreateSession(sessionId);
      if (session) {
        session.requests[syntheticId] = syntheticRequest;
        console.log(`[background.js] Created synthetic logonUser request in session ${sessionId}:`, syntheticId);
      }
    }
    
    saveSessionsToStorage(); // Persist to storage
    sendResponse({ success: true });

  // Handle logonUser response body capture from injected script
  } else if (message.type === 'LOGON_USER_RESPONSE_CAPTURED') {
    const responseData = message.data;
    
    // Find the matching request in any session
    let matchingRequest = null;
    let parentSession = null;
    
    for (const [sessionId, session] of Object.entries(sessions)) {
      if (session.requests[responseData.requestId]) {
        matchingRequest = session.requests[responseData.requestId];
        parentSession = session;
        console.log(`[background.js] Found matching request in session ${sessionId}`);
        break;
      }
    }
    
    if (matchingRequest) {
      // Add response body to existing request
      matchingRequest.responseBody = responseData.responseBody;
      matchingRequest.capturedAt = responseData.timestamp;
      matchingRequest.isLogonUserCapture = true; // Mark as captured
      console.log('[background.js] Captured response body for logonUser request:', responseData.requestId);
      saveSessionsToStorage(); // Persist to storage
    } else {
      console.warn('[background.js] No matching request found for captured response:', responseData.requestId);
    }
    
    sendResponse({ success: true });

  // Handle HAR data import
  } else if (message.action === 'importHARData') {
    if (message.data && Array.isArray(message.data)) {
      console.log('[background.js] Importing', message.data.length, 'HAR entries');
      
      // Group imported data by session ID (q2token)
      const importedSessions = {};
      
      message.data.forEach(entry => {
        const sessionId = entry.q2token || 'imported_session_' + Date.now();
        
        if (!importedSessions[sessionId]) {
          importedSessions[sessionId] = {
            requests: {},
            envInfo: null,
            lastActivity: Date.now(),
            createdAt: Date.now()
          };
        }
        
        importedSessions[sessionId].requests[entry.requestId] = entry;
      });
      
      // Merge with existing sessions
      Object.assign(sessions, importedSessions);
      
      // Save to storage
      saveSessionsToStorage();
      
      const totalRequests = Object.values(sessions).reduce((sum, session) => 
        sum + Object.keys(session.requests).length, 0);
      
      console.log('[background.js] Successfully imported HAR data. Total sessions:', Object.keys(sessions).length, 'Total requests:', totalRequests);
      sendResponse({ success: true, imported: message.data.length });
    } else {
      console.error('[background.js] Invalid HAR import data');
      sendResponse({ success: false, error: 'Invalid data format' });
    }
  
  // Get session information for debugging
  } else if (message.action === 'getSessionInfo') {
    const sessionInfo = {
      totalSessions: Object.keys(sessions).length,
      sessions: Object.entries(sessions).map(([sessionId, session]) => ({
        sessionId: sessionId,
        requestCount: Object.keys(session.requests).length,
        lastActivity: session.lastActivity,
        createdAt: session.createdAt
      }))
    };
    sendResponse(sessionInfo);
  }
});
