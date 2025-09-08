let currentTabId = null;
let currentSessionData = null; // Store session data until sessionId changes
let isInitialized = false; // Prevent multiple initializations
let lastDataHash = null; // Track data changes to prevent unnecessary re-renders
let cachedEnvInfo = null; // Cache environment info to prevent unnecessary loading messages
let isUpdating = false; // Prevent concurrent updates

// Prevent multiple DOMContentLoaded listeners
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  initializePopup();
}

function initializePopup() {
  // Prevent multiple initializations
  if (isInitialized) return;
  isInitialized = true;
  const networkDataContainer = document.getElementById('network-data');
  const sessionSummaryContainer = document.getElementById('session-summary');
  const sessionSummarySection = document.querySelector('.session-summary-container');
  const clearButton = document.getElementById('clear-button');
  const downloadButton = document.getElementById('download-json');
  const siteSelector = document.getElementById('site-selector');
  const siteInput = document.getElementById('site-input');
  const addSiteBtn = document.getElementById('add-site');
  const envInfoEl = document.getElementById('env-info');

  // Collapsible section logic for showing/hiding content
  const collapsibles = document.querySelectorAll(".collapsible");
  collapsibles.forEach(coll => {
    const content = coll.nextElementSibling;
    if (content && content.classList.contains('collapsible-content')) {
      coll.addEventListener("click", (e) => {
        // Check if the button is disabled
        if (coll.style.cursor === "not-allowed") {
          e.preventDefault();
          return false;
        }
        
        const isOpen = content.style.display === "block";
        content.style.display = isOpen ? "none" : "block";
        coll.classList.toggle('active', !isOpen);
      });
    }
  });

  // Helper: Extract hostname from a full URL
  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Helper: Get protocol (http: or https:) from URL
  function getProtocol(url) {
    try {
      return new URL(url).protocol;
    } catch {
      return 'https:';
    }
  }

  // Helper: Format timestamps into human-readable GMT string
  function formatDateTime(ts) {
    if (!ts) return 'N/A';
    const date = new Date(ts);
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  // Helper: Download HAR file
  function downloadHAR(data, type) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `q2-easy-log-${type}-${timestamp}.har`;
    
    const harData = {
      log: {
        version: "1.2",
        creator: {
          name: "Q2 Easy Log Chrome Extension",
          version: "1.0"
        },
        entries: data.map(entry => ({
          startedDateTime: entry.startTime ? new Date(entry.startTime).toISOString() : new Date().toISOString(),
          time: (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime) : 0,
          request: {
            method: entry.method || 'GET',
            url: entry.url || '',
            httpVersion: "HTTP/1.1",
            headers: entry.requestHeaders ? entry.requestHeaders.map(h => ({name: h.name, value: h.value})) : [],
            queryString: [],
            postData: entry.postData || {},
            cookies: [],
            headersSize: -1,
            bodySize: -1
          },
          response: {
            status: entry.statusCode || 0,
            statusText: entry.statusText || '',
            httpVersion: "HTTP/1.1", 
            headers: entry.responseHeaders ? entry.responseHeaders.map(h => ({name: h.name, value: h.value})) : [],
            cookies: [],
            content: {
              size: entry.responseSize || 0,
              mimeType: entry.mimeType || 'text/plain',
              text: entry.responseBody || ''
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1
          },
          cache: {},
          timings: {
            send: 0,
            wait: (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime) : 0,
            receive: 0
          }
        }))
      }
    };

    const blob = new Blob([JSON.stringify(harData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper: Create a hash of data to detect changes
  function createDataHash(data) {
    if (!data || data.length === 0) return 'empty';
    
    // Create a hash based on all relevant requests including logonUser captures
    const relevantData = data
      .filter(entry => (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture)
      .map(entry => `${entry.requestId}-${entry.startTime}-${entry.q2token || 'logon'}-${entry.isLogonUserCapture || false}`)
      .join('|');
    
    // Also include a count of total relevant requests to detect session changes
    const totalRelevantCount = data.filter(entry => 
      (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture
    ).length;
    
    // Include the latest session ID to detect session changes
    const latestSessionId = data
      .filter(entry => entry.q2token && entry.q2token !== 'N/A')
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0]?.q2token || 'no-session';
    
    return `${relevantData}-count:${totalRelevantCount}-session:${latestSessionId}` || 'no-valid-data';
  }
  function createSessionSummary(data, activeDomain) {
    if (!data || data.length === 0) return null;

    console.log('[popup.js] createSessionSummary input:', {
      totalData: data.length,
      activeDomain: activeDomain,
      logonUserEntries: data.filter(r => r.isLogonUserCapture).length,
      logonUserUrls: data.filter(r => r.url?.includes('logonUser')).map(r => ({ url: r.url, domain: getDomain(r.url) }))
    });

    // Filter relevant requests with q2token OR logonUser captures
    const relevantRequests = data
      .filter(entry => (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture)
      .filter(entry => {
        try {
          const entryDomain = getDomain(entry.url);
          const domainMatch = entryDomain === activeDomain;
          if (entry.isLogonUserCapture) {
            console.log('[popup.js] LogonUser domain check:', { 
              url: entry.url, 
              entryDomain: entryDomain, 
              activeDomain: activeDomain, 
              match: domainMatch 
            });
          }
          return domainMatch;
        } catch {
          return false;
        }
      });

    console.log('[popup.js] After domain filtering:', {
      relevantRequests: relevantRequests.length,
      logonUserRelevant: relevantRequests.filter(r => r.isLogonUserCapture).length
    });

    if (relevantRequests.length === 0) return null;

    // Get session ID (q2token) - use the most recent one from requests that have it
    const requestsWithToken = relevantRequests.filter(entry => entry.q2token);
    const sessionId = requestsWithToken.length > 0 ? requestsWithToken[requestsWithToken.length - 1].q2token : 'NO_SESSION';

    // Filter by session ID (now logonUser requests will also have q2token)
    const sessionRequests = relevantRequests.filter(entry => entry.q2token === sessionId);

    console.log('[popup.js] createSessionSummary details:', {
      totalRelevantRequests: relevantRequests.length,
      sessionId: sessionId,
      sessionRequestsCount: sessionRequests.length,
      logonUserCount: sessionRequests.filter(r => r.isLogonUserCapture).length,
      regularRequestsCount: sessionRequests.filter(r => r.q2token === sessionId).length,
      logonUserRequests: sessionRequests.filter(r => r.isLogonUserCapture).map(r => ({ url: r.url, isLogonUserCapture: r.isLogonUserCapture }))
    });

    // Get workstation ID
    let workstationId = 'N/A';
    for (const entry of sessionRequests) {
      if (entry.workstationId && entry.workstationId !== 'N/A') {
        workstationId = entry.workstationId;
        break;
      }
    }

    // Calculate time range (first request - 5min, last request + 5min)
    const startTimes = sessionRequests.map(r => r.startTime).filter(t => t);
    const endTimes = sessionRequests.map(r => r.endTime || r.startTime).filter(t => t);
    
    const firstRequest = Math.min(...startTimes);
    const lastRequest = Math.max(...endTimes);
    const startTime = firstRequest - (5 * 60 * 1000); // -5 minutes
    const endTime = lastRequest + (5 * 60 * 1000); // +5 minutes

    return {
      totalRequests: sessionRequests.length,
      sessionId,
      workstationId,
      startTime,
      endTime,
      activeDomain,
      requests: sessionRequests
    };
  }

  // --- Env Info Handling via content.js injection ---

  // Renders environment information into the popup's env info element
  function renderEnvInfo(info) {
    cachedEnvInfo = info; // Cache the info to prevent repeated loading messages
    envInfoEl.innerHTML = `<div class="env-section"><div class="env-section-title">UUX Info</div><div class="env-section-content"><div class="env-info-item"><span class="env-info-label">Version:</span> <span class="env-info-value">${info.version}</span></div><div class="env-info-item"><span class="env-info-label">Theme:</span> <span class="env-info-value">${info.theme}</span></div><div class="env-info-item"><span class="env-info-label">Language:</span> <span class="env-info-value">${info.language}</span></div></div></div><div class="env-section"><div class="env-section-title">Tecton Info</div><div class="env-section-content"><div class="env-info-item"><span class="env-info-label">Platform Version:</span> <span class="env-info-value">${info.tectonPlatformVersion}</span></div><div class="env-info-item"><span class="env-info-label">SDK Version:</span> <span class="env-info-value">${info.tectonSdkVersion}</span></div></div></div><div class="env-section"><div class="env-section-title">CDN Info</div><div class="env-section-content"><div class="env-info-item"><span class="env-info-label">Base URL:</span> <span class="env-info-value">${info.cdnBaseUrl}</span></div><div class="env-info-item"><span class="env-info-label">Customer #:</span> <span class="env-info-value">${info.cdnCustomerNumber}</span></div></div></div>`;
  }

  // Fallback method to fetch cached environment info from background if content script fails
  function fetchEnvInfoFallback() {
    chrome.runtime.sendMessage({ type: 'GET_CACHED_ENV_INFO' }, response => {
      if (response?.data) {
        renderEnvInfo(response.data);
      } else {
        // Only show "not available" if we haven't already shown env info
        if (envInfoEl.textContent.includes('Loading') || envInfoEl.textContent.trim() === '') {
          envInfoEl.textContent = 'Environment info not available.';
        }
      }
    });
  }

  // Listen for env info response messages from content.js (remove duplicate listeners)
  let envInfoListenerAdded = false;
  if (!envInfoListenerAdded) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'UUX_ENV_INFO') {
        renderEnvInfo(message.data);
      }
    });
    envInfoListenerAdded = true;
  }

  // Request environment info from content.js for the given tab
  function populateEnvInfo(tabId) {
    // Only show loading if we don't have cached info
    if (!cachedEnvInfo) {
      envInfoEl.textContent = 'Loading environment info...';
    }

    chrome.tabs.sendMessage(tabId, { type: 'REQUEST_UUX_ENV_INFO' }, response => {
      if (chrome.runtime.lastError || !response?.data) {
        fetchEnvInfoFallback(); // Fallback to cached data if request fails
      } else {
        renderEnvInfo(response.data); // Successfully received env info
      }
    });
  }

  // --- Site Management ---

  // Load saved sites from local storage and populate dropdown selector
  function loadSites(activeDomain) {
    chrome.storage.local.get({ sites: [] }, ({ sites }) => {
      // Add active site if not already stored
      if (activeDomain && !sites.includes(activeDomain)) {
        sites.unshift(activeDomain);
        chrome.storage.local.set({ sites });
      }

      // Populate selector UI
      siteSelector.innerHTML = '';
      sites.forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        siteSelector.appendChild(opt);
      });

      if (activeDomain) {
        siteSelector.value = activeDomain;
      }
    });
  }

  // Add a new site from input field to saved sites
  addSiteBtn.addEventListener('click', () => {
    const site = siteInput.value.trim();
    if (site) {
      chrome.storage.local.get({ sites: [] }, ({ sites }) => {
        if (!sites.includes(site)) {
          sites.push(site);
          chrome.storage.local.set({ sites }, () => loadSites(site));
        }
      });
      siteInput.value = ''; // Clear input field
    }
  });

  // --- Network Data Handling ---

  // Clear button: Removes current network data from the popup view
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'clearNetworkData' }, () => {
        networkDataContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        currentSessionData = null;
        lastDataHash = null; // Reset hash to allow fresh data
      });
    });
  }

  // Download button: Downloads full HAR log
  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const activeTab = tabs[0];
        if (activeTab) {
          // Request full HAR data from content script
          chrome.tabs.sendMessage(activeTab.id, { type: 'GET_FULL_HAR_DATA' }, response => {
            if (chrome.runtime.lastError) {
              // Fallback: use basic network data
              chrome.runtime.sendMessage({ action: 'getNetworkData' }, (response) => {
                if (response?.data) {
                  downloadHAR(response.data, 'basic');
                }
              });
            } else if (response?.data) {
              downloadHAR(response.data, 'full');
            }
          });
        }
      });
    });
  }

  /**
   * Display the session summary and individual requests in the popup.
   * Includes session aggregation and Alexandria log URL generation.
   */
  function displayNetworkData(data, activeDomain) {
    // Prevent concurrent updates
    if (isUpdating) return;
    isUpdating = true;

    if (!activeDomain) {
      // Hide the entire Session Summary section when no active domain
      sessionSummarySection.classList.add('hidden');
      networkDataContainer.innerHTML = '';
      isUpdating = false;
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const activeTab = tabs[0];
      const protocol = activeTab ? getProtocol(activeTab.url) : 'https:';
      const cookieUrl = `${protocol}//${activeDomain}`;

      // Fetch the most recent 'workstation-id' cookie
      chrome.cookies.get({ url: cookieUrl, name: 'workstation-id' }, function (cookie) {
        let latestWorkstationId = cookie?.value || 'N/A';

        // Create session summary
        const sessionSummary = createSessionSummary(data, activeDomain);
        
        if (!sessionSummary) {
          // Hide the entire Session Summary section when no session data
          sessionSummarySection.classList.add('hidden');
          networkDataContainer.innerHTML = '';
          isUpdating = false;
          return;
        }

        // Show the Session Summary section when there is data
        sessionSummarySection.classList.remove('hidden');

        // Check if session has changed
        const sessionChanged = !currentSessionData || currentSessionData.sessionId !== sessionSummary.sessionId;
        
        if (sessionChanged) {
          console.log('[popup.js] Session change detected:', {
            oldSession: currentSessionData?.sessionId,
            newSession: sessionSummary.sessionId
          });
          currentSessionData = sessionSummary;
          // Force refresh by clearing the last data hash
          lastDataHash = null;
        }

        // Use workstation ID from summary or fallback to latest cookie
        const workstationId = sessionSummary.workstationId !== 'N/A' ? sessionSummary.workstationId : latestWorkstationId;

        // Display session summary and individual requests
        displaySessionSummary(sessionSummary, workstationId);
        displayIndividualRequests(sessionSummary.requests, workstationId);

        // Release the update lock
        isUpdating = false;
      });
    });
  }

  /**
   * Display session summary with aggregated data and log buttons
   */
  function displaySessionSummary(summary, workstationId) {
    const formattedStart = formatDateTime(summary.startTime);
    const formattedEnd = formatDateTime(summary.endTime);
    
    // Determine log indices based on domain
    const isStaging = summary.requests.some(r => r.url.includes('temporary'));
    const hqIndex = isStaging ? 'app_logs_stage_hq' : 'app_logs_prod_hq';
    const lbIndex = isStaging ? 'app_logs_stage_lightbridge' : 'app_logs_prod_lightbridge';
    const kaminoIndex = isStaging ? 'app_logs_stage_kamino' : 'app_logs_prod_kamino';
    const ardentIndex = isStaging ? 'app_logs_stage_ardent' : 'app_logs_prod_ardent';

    // Generate search URLs
    const hqSearchString = `search index="${hqIndex}" sessionId="${summary.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
    const hqUrl = `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(hqSearchString)}`;
    
    const lbSearchString = `search index="${lbIndex}" workstationId="${workstationId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
    const lbUrl = `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(lbSearchString)}`;
    
    const kaminoSearchString = `search index="${kaminoIndex}" sessionId="${summary.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
    const kaminoUrl = `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(kaminoSearchString)}`;
    
    const ardentSearchString = `search index="${ardentIndex}" workstationId="${workstationId}" earliest="-15m" | fields * | extract | sort timestamp, seqId | head 10000`;
    const ardentUrl = `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(ardentSearchString)}`;

    sessionSummaryContainer.innerHTML = `
      <div class="session-summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">Total Requests</div>
            <div class="summary-value">${summary.totalRequests}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Session ID</div>
            <div class="summary-value">${summary.sessionId}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Workstation ID</div>
            <div class="summary-value">${workstationId}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Environment</div>
            <div class="summary-value">${isStaging ? 'Staging' : 'Production'}</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">Start Time</div>
            <div class="summary-value">${formattedStart} GMT</div>
          </div>
          <div class="summary-item">
            <div class="summary-label">End Time</div>
            <div class="summary-value">${formattedEnd} GMT</div>
          </div>
        </div>
        <div class="log-buttons">
          <a href="${hqUrl}" target="_blank" class="log-button hq-log">HQ Logs</a>
          <a href="${lbUrl}" target="_blank" class="log-button lb-log">LightBridge Logs</a>
          <a href="${kaminoUrl}" target="_blank" class="log-button kamino-log">Kamino Logs</a>
          <a href="${ardentUrl}" target="_blank" class="log-button ardent-log">Ardent Logs</a>
        </div>
      </div>
    `;
  }

  /**
   * Display individual requests without log buttons
   */
  function displayIndividualRequests(requests, workstationId) {
    console.log('[popup.js] displayIndividualRequests called with', requests.length, 'requests');
    
    // Log detailed info about logonUser requests specifically
    const logonUserRequests = requests.filter(req => 
      req.url?.includes('logonUser?') || req.isLogonUserCapture
    );
    
    if (logonUserRequests.length > 0) {
      console.log('[popup.js] Found', logonUserRequests.length, 'logonUser requests:');
      logonUserRequests.forEach((req, index) => {
        console.log(`[popup.js] LogonUser ${index + 1}:`, {
          requestId: req.requestId,
          url: req.url,
          method: req.method,
          startTime: new Date(req.startTime).toISOString(),
          statusCode: req.statusCode,
          isLogonUserCapture: req.isLogonUserCapture,
          q2token: req.q2token,
          responseBodyLength: req.responseBody?.length || 0,
          source: req.isLogonUserCapture ? 'inject.js capture' : 'webRequest API'
        });
      });
      
      // Check for potential duplicates
      const urlGroups = {};
      logonUserRequests.forEach(req => {
        const baseUrl = req.url?.split('?')[0] || 'unknown';
        if (!urlGroups[baseUrl]) urlGroups[baseUrl] = [];
        urlGroups[baseUrl].push(req);
      });
      
      Object.entries(urlGroups).forEach(([baseUrl, reqs]) => {
        if (reqs.length > 1) {
          console.warn(`[popup.js] Potential duplicate logonUser requests for ${baseUrl}:`, reqs.length, 'instances');
          console.warn('[popup.js] Duplicate details:', reqs.map(r => ({
            id: r.requestId,
            time: new Date(r.startTime).toISOString(),
            source: r.isLogonUserCapture ? 'inject' : 'webRequest'
          })));
        }
      });
    }
    
    // Log detailed info about each request
    requests.forEach((req, index) => {
      console.log(`[popup.js] Request ${index}:`, {
        url: req.url,
        isLogonUserCapture: req.isLogonUserCapture,
        hasResponseBody: !!req.responseBody,
        q2token: req.q2token,
        method: req.method,
        isLogonUserCheck: req.url?.includes('logonUser?')
      });
    });
    
    const networkDataContainer = document.getElementById('network-data');
    const collapsibleContent = networkDataContainer.parentElement;
    const collapsibleButton = collapsibleContent.previousElementSibling;
    
    if (requests.length === 0) {
      // Hide the content and disable the button
      collapsibleContent.style.display = "none";
      collapsibleButton.classList.remove('active');
      collapsibleButton.style.opacity = "0.5";
      collapsibleButton.style.cursor = "not-allowed";
      networkDataContainer.innerHTML = '';
      return;
    }

    // Re-enable the button when there are requests
    collapsibleButton.style.opacity = "1";
    collapsibleButton.style.cursor = "pointer";

    // Show normal content when there are requests
    let html = '';
    requests.forEach(entry => {
      console.log('[popup.js] Processing request:', {
        url: entry.url,
        hasLogonUserInUrl: entry.url?.includes('logonUser?'),
        isLogonUser: entry.isLogonUser,
        isLogonUserCapture: entry.isLogonUserCapture,
        hasResponseBody: !!entry.responseBody,
        responseBodyLength: entry.responseBody?.length || 0,
        method: entry.method
      });
      
      const url = entry.url || 'N/A';
      const method = entry.method || 'N/A';
      const status = entry.statusCode || 'N/A';
      const time = (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime).toFixed(2) : 'N/A';
      const fi_no = entry.fi_no || 'N/A';
      const startTime = formatDateTime(entry.startTime);

      // Status color coding
      let statusColor = '#666';
      if (status >= 200 && status < 300) statusColor = '#28a745';
      else if (status >= 300 && status < 400) statusColor = '#ffc107';
      else if (status >= 400) statusColor = '#dc3545';

      // Check if this is a logonUser request with response body
      const isLogonUser = url.includes('logonUser?') || entry.isLogonUser || entry.isLogonUserCapture;
      const hasResponseBody = entry.responseBody && entry.responseBody.trim().length > 0;
      
      // Extract additional context for logonUser requests
      let logonUserContext = '';
      if (isLogonUser) {
        const urlParams = new URLSearchParams(url.split('?')[1] || '');
        const wsParam = urlParams.get('ws') || url.match(/ws\d+/)?.[0] || '';
        const timeFromStart = entry.startTime ? new Date(entry.startTime).toLocaleTimeString() : '';
        const requestSource = entry.isLogonUserCapture ? 'Response Captured' : 'Request Detected';
        logonUserContext = ` (${requestSource}${wsParam ? ', ' + wsParam : ''}${timeFromStart ? ', ' + timeFromStart : ''})`;
      }
      
      console.log('[popup.js] Request flags:', { 
        isLogonUser: isLogonUser, 
        hasResponseBody: hasResponseBody,
        url: url,
        urlIncludesLogonUser: url.includes('logonUser?'),
        entryIsLogonUserCapture: entry.isLogonUserCapture,
        logonUserContext: logonUserContext
      });
      
      // Create unique ID for collapsible response body
      const responseBodyId = `response-body-${entry.requestId || Math.random().toString(36).substr(2, 9)}`;

      html += `
        <div class="request-item ${isLogonUser ? 'logon-user-request' : ''}">
          <div class="request-url">${method} ${url}</div>
          <div class="request-details">
            <strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${status}</span> | 
            <strong>Time:</strong> ${time}ms | 
            <strong>Started:</strong> ${startTime} GMT
            ${isLogonUser ? `<br><span class="logon-user-badge">🔐 LogonUser Request${logonUserContext}</span>` : ''}
            ${hasResponseBody ? `
              <br><button class="response-body-toggle" data-response-id="${responseBodyId}">
                📄 View Response Body
              </button>
              <div id="${responseBodyId}" class="response-body-content" style="display: none;">
                <div class="response-body-header">
                  LogonUser Response Body
                  <button class="download-response-btn" data-response-data="${escapeHtml(JSON.stringify(entry.responseBody))}" data-url="${escapeHtml(entry.url)}">
                    💾 Download JSON
                  </button>
                </div>
                <pre class="response-body-text">${formatJsonResponse(entry.responseBody)}</pre>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    networkDataContainer.innerHTML = html;
    
    // Add event listeners for response body toggle buttons (CSP-compliant)
    networkDataContainer.querySelectorAll('.response-body-toggle').forEach(button => {
      button.addEventListener('click', (e) => {
        const responseId = e.target.getAttribute('data-response-id');
        toggleResponseBody(responseId);
      });
    });
    
    // Add event listeners for download response buttons
    networkDataContainer.querySelectorAll('.download-response-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const responseData = e.target.getAttribute('data-response-data');
        const url = e.target.getAttribute('data-url');
        downloadLogonUserResponse(JSON.parse(responseData), url);
      });
    });
  }

  // Fetch network data for the current site and show in popup
  function fetchNetworkData(activeDomain) {
    // Debounce multiple rapid calls
    if (fetchNetworkData.timeout) {
      clearTimeout(fetchNetworkData.timeout);
    }
    
    fetchNetworkData.timeout = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'getNetworkData' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[popup.js] Failed to get network data:', chrome.runtime.lastError.message);
          return;
        }
        
        if (response?.data) {
          console.log('[popup.js] Received network data:', {
            totalRequests: response.data.length,
            logonUserCaptures: response.data.filter(r => r.isLogonUserCapture).length,
            logonUserUrls: response.data.filter(r => r.url?.includes('logonUser')).map(r => r.url),
            sampleUrls: response.data.slice(0, 3).map(r => r.url)
          });
          
          // Check if data has actually changed to prevent unnecessary re-renders
          const newDataHash = createDataHash(response.data);
          
          if (newDataHash === lastDataHash) {
            // Data hasn't changed, no need to re-render
            return;
          }
          
          lastDataHash = newDataHash;
          displayNetworkData(response.data, activeDomain);
        } else {
          if (lastDataHash !== 'no-data') {
            lastDataHash = 'no-data';
            // Hide the entire Session Summary section when no data
            sessionSummarySection.classList.add('hidden');
            networkDataContainer.innerHTML = '';
          }
        }
      });
    }, 100); // Increased debounce to 100ms
  }

  // Helper function to escape HTML in response bodies
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  // Helper function to format JSON response with proper indentation and syntax highlighting
  function formatJsonResponse(responseBody) {
    try {
      // Try to parse as JSON
      const jsonData = JSON.parse(responseBody);
      const formattedJson = JSON.stringify(jsonData, null, 2);
      
      // Apply basic syntax highlighting
      return escapeHtml(formattedJson)
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, '<span class="json-key">$1</span>')
        .replace(/:\s*("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, ': <span class="json-string">$1</span>')
        .replace(/:\s*(true|false)/g, ': <span class="json-boolean">$1</span>')
        .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>')
        .replace(/:\s*(-?\d+(?:\.\d+)?)/g, ': <span class="json-number">$1</span>');
    } catch (error) {
      console.warn('[popup.js] Response body is not valid JSON, displaying as plain text:', error);
      // If not JSON, return escaped plain text
      return escapeHtml(responseBody);
    }
  }

  // Helper function to download logonUser response as JSON file
  function downloadLogonUserResponse(responseData, url) {
    try {
      let jsonData;
      let filename;
      
      // Try to parse the response data if it's a string
      if (typeof responseData === 'string') {
        try {
          jsonData = JSON.parse(responseData);
        } catch (e) {
          // If not JSON, wrap in an object
          jsonData = {
            responseText: responseData,
            url: url,
            capturedAt: new Date().toISOString()
          };
        }
      } else {
        jsonData = responseData;
      }
      
      // Create enhanced data with metadata
      const enhancedData = {
        metadata: {
          capturedAt: new Date().toISOString(),
          url: url,
          type: 'logonUser_response',
          source: 'Q2_Easy_Log_Extension'
        },
        response: jsonData
      };
      
      // Generate filename from URL
      const urlParts = url.split('/');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `logonUser-response-${timestamp}.json`;
      
      // Create and download the file
      const blob = new Blob([JSON.stringify(enhancedData, null, 2)], { type: 'application/json' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(downloadUrl);
      
      console.log('[popup.js] Downloaded logonUser response as:', filename);
    } catch (error) {
      console.error('[popup.js] Failed to download logonUser response:', error);
      alert('Failed to download response data. Check console for details.');
    }
  }

  // Function to toggle response body visibility
  window.toggleResponseBody = function(responseBodyId) {
    const element = document.getElementById(responseBodyId);
    const button = element.previousElementSibling;
    
    if (element.style.display === 'none') {
      element.style.display = 'block';
      button.textContent = '📄 Hide Response Body';
      button.classList.add('active');
    } else {
      element.style.display = 'none';
      button.textContent = '📄 View Response Body';
      button.classList.remove('active');
    }
  };

  // --- Initialize the popup UI on load ---
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    if (!activeTab) return;

    currentTabId = activeTab.id;
    const activeDomain = getDomain(activeTab.url);

    // Initialize UI components without flickering
    try {
      loadSites(activeDomain);         // Load or add active site
      populateEnvInfo(activeTab.id);   // Request and render env info
      fetchNetworkData(activeDomain);  // Show network activity
      
      // Set up periodic refresh to catch new sessions and logonUser requests
      const refreshInterval = setInterval(() => {
        fetchNetworkData(activeDomain);
      }, 2000); // Refresh every 2 seconds
      
      // Clean up interval when popup is closed
      window.addEventListener('beforeunload', () => {
        clearInterval(refreshInterval);
      });
      
    } catch (error) {
      console.error('[popup.js] Initialization error:', error);
    }
  });
}
