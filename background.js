// Store all captured request data by requestId - using persistent storage
const requests = {};
const MAX_STORED_REQUESTS = 1000; // Limit to prevent storage overflow
const STORAGE_KEY = 'easylog_requests';
const ENV_STORAGE_KEY = 'easylog_env_info';

// Store latest environment info sent from content script
let cachedEnvInfo = null;

// Add throttling for popup requests
let lastPopupRequestTime = 0;
const POPUP_REQUEST_THROTTLE = 50; // Reduced to 50ms throttle

// Load stored requests on startup
chrome.storage.local.get([STORAGE_KEY], (result) => {
  if (result[STORAGE_KEY]) {
    Object.assign(requests, result[STORAGE_KEY]);
    console.log('[background.js] Restored', Object.keys(requests).length, 'requests from storage');
  }
});

// Load cached environment info on startup
chrome.storage.local.get([ENV_STORAGE_KEY], (result) => {
  if (result[ENV_STORAGE_KEY]) {
    cachedEnvInfo = result[ENV_STORAGE_KEY];
    console.log('[background.js] Restored environment info from storage');
  }
});

// Persist requests to storage (debounced)
let saveTimeout = null;
function saveRequestsToStorage() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    // Keep only the most recent requests to prevent storage overflow
    const requestArray = Object.values(requests);
    if (requestArray.length > MAX_STORED_REQUESTS) {
      // Sort by timestamp and keep the most recent ones
      requestArray.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      const recentRequests = requestArray.slice(0, MAX_STORED_REQUESTS);
      
      // Clear and rebuild requests object
      for (const key in requests) delete requests[key];
      recentRequests.forEach(req => {
        requests[req.requestId] = req;
      });
    }
    
    chrome.storage.local.set({
      [STORAGE_KEY]: requests
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[background.js] Failed to save requests:', chrome.runtime.lastError);
      }
    });
  }, 1000); // Save after 1 second of inactivity
}

// Clean up old requests (older than 24 hours)
function cleanupOldRequests() {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  let cleaned = 0;
  
  for (const requestId in requests) {
    const request = requests[requestId];
    if (request.startTime && request.startTime < oneDayAgo) {
      delete requests[requestId];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[background.js] Cleaned up ${cleaned} old requests`);
    saveRequestsToStorage();
  }
}

// Run cleanup every hour
setInterval(cleanupOldRequests, 60 * 60 * 1000);

// --- Helper function ---

// Extract `fi_no` from the request URL (used for CDN deport pattern)
function extractFiNo(url) {
  const match = url.match(/cdn\/deport\/([^/]+)/);
  return match ? match[1] : null;
}

// --- Web Request Listeners ---

// Capture initial request details
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Initialize tracking for this request
    requests[details.requestId] = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      startTime: details.timeStamp,
      fi_no: extractFiNo(details.url),
      postData: details.requestBody ? JSON.stringify(details.requestBody) : null,
      isLogonUser: details.url.includes('logonUser?') // Flag logonUser requests
    };
    saveRequestsToStorage(); // Persist to storage
  },
  { urls: ["<all_urls>"] }, // Listen to all URLs
  ["requestBody"] // Capture request body for HAR
);

// Capture request headers to extract q2token, workstation-id, utcOffset
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.requestHeaders = details.requestHeaders;

      // Extract q2token from headers
      const q2tokenHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'q2token');
      req.q2token = q2tokenHeader?.value || null;

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
      saveRequestsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"] // Required to access request headers
);

// Capture response headers for the request
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const req = requests[details.requestId];
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
          args: [details.url, details.requestId]
        }).catch(err => {
          console.warn('[background.js] Failed to inject response capture script:', err);
        });
      }
      
      saveRequestsToStorage(); // Persist to storage
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
    const req = requests[details.requestId];
    if (req) {
      req.statusCode = details.statusCode;
      req.endTime = details.timeStamp;
      req.responseSize = details.responseSize;
      saveRequestsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] }
);

// Capture error information
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.error = details.error;
      req.endTime = details.timeStamp;
      saveRequestsToStorage(); // Persist to storage
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
  
  // Return captured network data to popup (with throttling)
  if (message.action === 'getNetworkData') {
    const now = Date.now();
    if (now - lastPopupRequestTime < POPUP_REQUEST_THROTTLE) {
      // Too soon, return cached response
      sendResponse({ data: Object.values(requests) });
      return;
    }
    lastPopupRequestTime = now;
    
    sendResponse({ data: Object.values(requests) });

  // Clear all captured request data
  } else if (message.action === 'clearNetworkData') {
    for (const key in requests) delete requests[key];
    lastPopupRequestTime = 0; // Reset throttle
    // Clear storage as well
    chrome.storage.local.set({
      [STORAGE_KEY]: {}
    }, () => {
      console.log('[background.js] Cleared storage');
    });
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
    
    // Log all existing logonUser requests for debugging
    const existingLogonRequests = Object.values(requests).filter(req => 
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
    const requestArray = Object.values(requests);
    
    // Look for request with same URL within last 30 seconds
    const timeWindow = 30000; // 30 seconds
    for (const req of requestArray) {
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
      
      requests[syntheticId] = {
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
      console.log('[background.js] Created new logonUser capture entry:', syntheticId, 'with session ID:', responseData.q2token);
    }
    
    saveRequestsToStorage(); // Persist to storage
    sendResponse({ success: true });

  // Handle logonUser response body capture from injected script
  } else if (message.type === 'LOGON_USER_RESPONSE_CAPTURED') {
    const responseData = message.data;
    
    // Find the matching request by requestId
    const matchingRequest = requests[responseData.requestId];
    
    if (matchingRequest) {
      // Add response body to existing request
      matchingRequest.responseBody = responseData.responseBody;
      matchingRequest.capturedAt = responseData.timestamp;
      console.log('[background.js] Captured response body for logonUser request:', responseData.requestId);
      saveRequestsToStorage(); // Persist to storage
    } else {
      console.warn('[background.js] No matching request found for captured response:', responseData.requestId);
    }
    
    sendResponse({ success: true });
  }
});
