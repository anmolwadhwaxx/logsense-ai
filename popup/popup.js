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
    
    // Create a simple hash based on the number of requests and latest timestamp
    const relevantData = data
      .filter(entry => entry.q2token && entry.q2token !== 'N/A')
      .map(entry => `${entry.requestId}-${entry.startTime}-${entry.q2token}`)
      .join('|');
    
    return relevantData || 'no-valid-data';
  }
  function createSessionSummary(data, activeDomain) {
    if (!data || data.length === 0) return null;

    // Filter relevant requests with q2token
    const relevantRequests = data
      .filter(entry => entry.q2token && entry.q2token !== 'N/A')
      .filter(entry => {
        try {
          return getDomain(entry.url) === activeDomain;
        } catch {
          return false;
        }
      });

    if (relevantRequests.length === 0) return null;

    // Get session ID (q2token) - use the most recent one
    const sessionId = relevantRequests[relevantRequests.length - 1].q2token;

    // Filter by session ID
    const sessionRequests = relevantRequests.filter(entry => entry.q2token === sessionId);

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
          currentSessionData = sessionSummary;
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

      html += `
        <div class="request-item">
          <div class="request-url">${method} ${url}</div>
          <div class="request-details">
            <strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${status}</span> | 
            <strong>Time:</strong> ${time}ms | 
            <strong>Started:</strong> ${startTime} GMT<br>
            <strong>Session ID:</strong> ${entry.q2token}<br>
            <strong>Workstation ID:</strong> ${workstationId}<br>
            <strong>FI Number:</strong> ${fi_no}
          </div>
        </div>
      `;
    });

    networkDataContainer.innerHTML = html;
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
    } catch (error) {
      console.error('[popup.js] Initialization error:', error);
    }
  });
}
