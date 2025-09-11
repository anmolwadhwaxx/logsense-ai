let currentTabId = null;
let currentSessionData = null; // Store session data until sessionId changes
let isInitialized = false; // Prevent multiple initializations
let lastDataHash = null; // Track data changes to prevent unnecessary re-renders
let cachedEnvInfo = null; // Cache environment info to prevent unnecessary loading messages
let isUpdating = false; // Prevent concurrent updates
let currentActiveTab = 'logs'; // Track current active tab
let chartInstances = {}; // Store chart instances for cleanup
let currentActiveDomain = null; // Track current domain for visualization filtering
let popupId = null; // Track this popup's unique ID for session isolation
let sourceTabId = null; // Track which tab this popup was opened from

// Helper function to make session-isolated network data requests
function getNetworkData(callback) {
  chrome.runtime.sendMessage({ 
    action: 'getNetworkData', 
    popupId: popupId 
  }, callback);
}

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

  // Initialize popup with background script to track source tab
  chrome.runtime.sendMessage({ action: 'initializePopup' }, (response) => {
    if (response && response.popupId) {
      popupId = response.popupId;
      sourceTabId = response.sourceTabId;
      console.log(`[popup.js] Popup initialized with ID ${popupId} for source tab ${sourceTabId}`);
    } else {
      console.warn('[popup.js] Failed to initialize popup with background script');
    }
  });

  // Initialize tab functionality first
  initializeTabs();

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

  // Helper: Download network data summary as CSV (simplified format)
  function downloadCSV(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `q2-easy-log-summary-${timestamp}.csv`;

    // CSV headers - simplified network data summary
    const headers = [
      'Timestamp',
      'Method',
      'URL',
      'Status Code',
      'Response Time (ms)',
      'Response Size (bytes)',
      'Q2 Token',
      'Workstation ID',
      'Fi No',
      'Error'
    ];

    // Convert data to CSV rows
    const rows = data.map(entry => [
      entry.startTime ? new Date(entry.startTime).toISOString() : '',
      entry.method || '',
      entry.url || '',
      entry.statusCode || '',
      (entry.startTime && entry.endTime) ? (entry.endTime - entry.startTime) : '',
      entry.responseSize || '',
      entry.q2token || '',
      entry.workstationId || '',
      entry.fi_no || '',
      entry.error || ''
    ]);

    // Combine headers and rows
    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Helper: Import HAR file
  function importHARFile(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
      try {
        const harData = JSON.parse(e.target.result);
        
        // Validate HAR format
        if (!harData.log || !harData.log.entries) {
          alert('Invalid HAR file format. Please select a valid HAR file.');
          return;
        }

        // Convert HAR entries to our data format
        const importedData = harData.log.entries.map((entry, index) => ({
          requestId: `imported-${Date.now()}-${index}`,
          url: entry.request.url,
          method: entry.request.method,
          startTime: new Date(entry.startedDateTime).getTime(),
          endTime: new Date(entry.startedDateTime).getTime() + entry.time,
          statusCode: entry.response.status,
          responseSize: entry.response.bodySize > 0 ? entry.response.bodySize : entry.response.headersSize,
          requestHeaders: entry.request.headers,
          responseHeaders: entry.response.headers,
          q2token: entry.request.headers.find(h => h.name.toLowerCase() === 'q2token')?.value || null,
          workstationId: entry.request.headers.find(h => h.name.toLowerCase() === 'workstation-id')?.value || null,
          fi_no: extractFiNo(entry.request.url),
          isLogonUser: entry.request.url.includes('logonUser?')
        }));

        // Send imported data to background script
        chrome.runtime.sendMessage({ 
          action: 'importHARData', 
          data: importedData 
        }, (response) => {
          if (response && response.success) {
            alert(`Successfully imported ${importedData.length} requests from HAR file.`);
            // Refresh the current display
            if (currentActiveDomain) {
              fetchNetworkData(currentActiveDomain);
            }
          } else {
            alert('Failed to import HAR data.');
          }
        });

      } catch (error) {
        console.error('Error parsing HAR file:', error);
        alert('Error parsing HAR file. Please ensure it\'s a valid HAR file.');
      }
    };

    reader.readAsText(file);
  }

  // Helper function for Fi No extraction (should already exist but adding for completeness)
  function extractFiNo(url) {
    if (!url) return null;
    const match = url.match(/cdn\/deport\/([^/]+)/);
    return match ? match[1] : null;
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
              getNetworkData((response) => {
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

  // New Export Buttons in Settings Tab
  const exportHarBtn = document.getElementById('export-har');
  const exportCsvBtn = document.getElementById('export-csv');
  const importHarBtn = document.getElementById('import-har');
  const harFileInput = document.getElementById('har-file-input');

  if (exportHarBtn) {
    exportHarBtn.addEventListener('click', () => {
      getNetworkData((response) => {
        if (response?.data) {
          downloadHAR(response.data, 'settings-export');
        } else {
          alert('No network data available to export');
        }
      });
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      getNetworkData((response) => {
        if (response?.data) {
          downloadCSV(response.data);
        } else {
          alert('No network data available to export');
        }
      });
    });
  }

  if (importHarBtn) {
    importHarBtn.addEventListener('click', () => {
      harFileInput.click();
    });
  }

  if (harFileInput) {
    harFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        importHARFile(file);
      }
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

        // Update User Details tab if it's currently active
        if (currentActiveTab === 'user-details') {
          // Wait a bit for the DOM to update, then load user details
          setTimeout(() => {
            loadUserDetailsData();
          }, 100);
        }

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
    
    // Deduplicate requests: separate logonUser and non-logonUser requests
    const nonLogonUserRequests = requests.filter(req => 
      !req.url?.includes('logonUser?') && !req.isLogonUser && !req.isLogonUserCapture
    );
    
    // For logonUser requests, keep only the most recent one with response body (prioritize captures)
    let bestLogonUserRequest = null;
    if (logonUserRequests.length > 0) {
      // Sort by preference: captures with response body > captures without > regular requests
      // Then by most recent time
      bestLogonUserRequest = logonUserRequests.sort((a, b) => {
        // Priority scoring: capture with response (3) > capture without (2) > regular (1)
        const getScore = (req) => {
          if (req.isLogonUserCapture && req.responseBody) return 3;
          if (req.isLogonUserCapture) return 2;
          return 1;
        };
        
        const scoreA = getScore(a);
        const scoreB = getScore(b);
        
        if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first
        return (b.startTime || 0) - (a.startTime || 0); // Most recent first
      })[0];
      
      console.log('[popup.js] Selected best logonUser request:', {
        url: bestLogonUserRequest.url,
        isCapture: bestLogonUserRequest.isLogonUserCapture,
        hasResponseBody: !!bestLogonUserRequest.responseBody,
        startTime: new Date(bestLogonUserRequest.startTime).toISOString()
      });
    }
    
    // Create final request list: logonUser at top (if exists), then others
    const displayRequests = [];
    if (bestLogonUserRequest) {
      displayRequests.push(bestLogonUserRequest);
    }
    displayRequests.push(...nonLogonUserRequests);
    
    console.log('[popup.js] Final display requests:', displayRequests.length, 'total (1 logonUser max +', nonLogonUserRequests.length, 'others)');
    
    const networkDataContainer = document.getElementById('network-data');
    const collapsibleContent = networkDataContainer.parentElement;
    const collapsibleButton = collapsibleContent.previousElementSibling;
    
    if (displayRequests.length === 0) {
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
    displayRequests.forEach(entry => {
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
      
      // Extract user data from logonUser response body
      let userDataSummary = '';
      if (isLogonUser && hasResponseBody) {
        userDataSummary = extractLogonUserData(entry.responseBody);
      }
      
      console.log('[popup.js] Request flags:', { 
        isLogonUser: isLogonUser, 
        hasResponseBody: hasResponseBody,
        url: url,
        urlIncludesLogonUser: url.includes('logonUser?'),
        entryIsLogonUserCapture: entry.isLogonUserCapture,
        logonUserContext: logonUserContext,
        hasUserData: !!userDataSummary
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
            ${isLogonUser ? `<br><span class="logon-user-badge">ðŸ” LogonUser Request${logonUserContext}</span>` : ''}
            ${userDataSummary ? `<br><div class="user-data-summary">${userDataSummary}</div>` : ''}
            ${hasResponseBody ? `
              <br><button class="response-body-toggle" data-response-id="${responseBodyId}">
                ðŸ“„ View Response Body
              </button>
              <div id="${responseBodyId}" class="response-body-content" style="display: none;">
                <div class="response-body-header">
                  LogonUser Response Body
                  <button class="download-response-btn" data-response-data="${escapeHtml(JSON.stringify(entry.responseBody))}" data-url="${escapeHtml(entry.url)}">
                    ðŸ’¾ Download JSON
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
      getNetworkData((response) => {
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
      button.textContent = 'ðŸ“„ Hide Response Body';
      button.classList.add('active');
    } else {
      element.style.display = 'none';
      button.textContent = 'ðŸ“„ View Response Body';
      button.classList.remove('active');
    }
  };

  // --- Initialize the popup UI on load ---
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    if (!activeTab) return;

    currentTabId = activeTab.id;
    const activeDomain = getDomain(activeTab.url);
    currentActiveDomain = activeDomain; // Store for visualization filtering

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
      
      // Add session debug info (only in development)
      if (window.location.search.includes('debug=true')) {
        addSessionDebugInfo();
      }
      
    } catch (error) {
      console.error('[popup.js] Initialization error:', error);
    }
  });
}

// Debug function to show session information
function addSessionDebugInfo() {
  const debugDiv = document.createElement('div');
  debugDiv.id = 'session-debug';
  debugDiv.style.cssText = 'position: fixed; top: 5px; right: 5px; background: rgba(0,0,0,0.9); color: white; padding: 8px; font-size: 11px; z-index: 9999; border-radius: 4px; font-family: monospace; max-width: 350px;';
  
  function updateDebugInfo() {
    if (sourceTabId) {
      // Get specific tab info using the popup's source tab
      chrome.tabs.get(sourceTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          debugDiv.innerHTML = `
            <strong>🔍 Session Debug</strong><br>
            <strong>Popup ID:</strong> ${popupId || 'None'}<br>
            <strong>Source Tab:</strong> ${sourceTabId} (CLOSED)<br>
            <strong>Status:</strong> <span style="color: #ff6b6b;">Tab closed - using fallback</span><br>
            <small style="color: #aaa;">Updated: ${new Date().toLocaleTimeString()}</small>
          `;
          return;
        }
        
        const domain = new URL(tab.url).hostname;
        
        // Get cookies for the source tab (not the active tab)
        chrome.cookies.getAll({ url: tab.url }, (cookies) => {
          const q2token = cookies.find(c => c.name.toLowerCase() === 'q2token')?.value || 'None';
          
          // Get session info from background
          chrome.runtime.sendMessage({ action: 'getSessionInfo' }, (response) => {
            const sessionInfo = response || { totalSessions: 0, sessions: [] };
            const currentSession = sessionInfo.sessions.find(s => s.sessionId === q2token);
            
            debugDiv.innerHTML = `
              <strong>🔍 Session Debug (Isolated)</strong><br>
              <strong>Popup ID:</strong> ${popupId}<br>
              <strong>Source Tab:</strong> ${sourceTabId}<br>
              <strong>Domain:</strong> ${domain}<br>
              <strong>q2token:</strong> ${q2token.substring(0, 12)}${q2token.length > 12 ? '...' : ''}<br>
              <strong>Total Sessions:</strong> ${sessionInfo.totalSessions}<br>
              <strong>This Session:</strong> ${currentSession ? `${currentSession.requestCount} reqs` : 'Not found'}<br>
              <strong>Current Tab:</strong> ${currentActiveTab}<br>
              <strong>Session Data:</strong> ${currentSessionData ? `${currentSessionData.requests?.length || 0} reqs` : 'None'}<br>
              <strong>Hash:</strong> ${lastDataHash?.substring(0, 8) || 'none'}<br>
              <span style="color: #4CAF50;">✓ Tab isolation active</span><br>
              <small style="color: #aaa;">Updated: ${new Date().toLocaleTimeString()}</small>
            `;
          });
        });
      });
    } else {
      debugDiv.innerHTML = `
        <strong>🔍 Session Debug</strong><br>
        <strong>Popup ID:</strong> ${popupId || 'Initializing...'}<br>
        <strong>Source Tab:</strong> ${sourceTabId || 'Detecting...'}<br>
        <span style="color: #ffa500;">⚠ Initialization in progress</span><br>
        <small style="color: #aaa;">Updated: ${new Date().toLocaleTimeString()}</small>
      `;
    }
  }
  
  updateDebugInfo();
  document.body.appendChild(debugDiv);
  
  // Update every 3 seconds
  setInterval(updateDebugInfo, 3000);
  
  // Make it draggable (optional)
  debugDiv.addEventListener('mousedown', (e) => {
    let isDragging = true;
    const rect = debugDiv.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    
    function onMouseMove(e) {
      if (isDragging) {
        debugDiv.style.left = (e.clientX - offsetX) + 'px';
        debugDiv.style.top = (e.clientY - offsetY) + 'px';
        debugDiv.style.right = 'auto';
      }
    }
    
    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ========== TAB FUNCTIONALITY ==========

function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // Tab switching functionality
  tabButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const targetTab = e.target.dataset.tab;
      switchToTab(targetTab);
    });
  });

  // Initialize visualization controls
  initializeVisualizationControls();
  
  // Initialize user details refresh button
  const refreshUserBtn = document.getElementById('refresh-user-data');
  if (refreshUserBtn) {
    refreshUserBtn.addEventListener('click', () => {
      loadUserDetailsData();
    });
  }
  
  // Add double-click listener for testing (generates sample data)
  if (refreshUserBtn) {
    refreshUserBtn.addEventListener('dblclick', () => {
      console.log('[popup.js] Double-click detected, loading sample user data');
      const sampleUserData = {
        loginId: 'john.doe@company.com',
        fullName: 'John Doe',
        email: 'john.doe@company.com',
        department: 'Engineering',
        role: 'Senior Developer',
        status: 'Active',
        sessionId: 'sess_abc123def456',
        loginTime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        lastActivity: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
        expiresAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(), // 25 minutes from now (will show warning)
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        featureFlags: {
          'advanced_search': true,
          'beta_features': false,
          'dark_mode': true,
          'notifications': true,
          'export_data': false
        },
        transactionRights: {
          'view_reports': { access: true, level: 'full' },
          'create_projects': { access: true, level: 'limited' },
          'delete_data': { access: false, level: 'none' },
          'admin_panel': { access: false, level: 'none' }
        },
        systemFlags: {
          'maintenance_mode': false,
          'debug_enabled': true,
          'logging_level': 'INFO',
          'cache_enabled': true
        },
        environment: 'Production',
        server: 'app-server-01.company.com',
        version: '2.3.1',
        build: '20240915.1',
        region: 'US-East',
        tenant: 'company-main'
      };
      
      populateUserDetailsTab(sampleUserData);
    });
  }
}

function switchToTab(tabName) {
  if (currentActiveTab === tabName) return;

  console.log(`[popup.js] Switching to tab: ${tabName}`);

  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Update tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');

  currentActiveTab = tabName;

  // Load tab-specific content
  if (tabName === 'visualization') {
    updateVisualization();
  } else if (tabName === 'user-details') {
    console.log('[popup.js] Switching to user-details tab');
    loadUserDetailsData();
  }
}

// ========== VISUALIZATION FUNCTIONALITY ==========

function initializeVisualizationControls() {
  const refreshBtn = document.getElementById('refresh-viz');
  const timeRangeSelect = document.getElementById('time-range');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      updateVisualization();
    });
  }

  if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', () => {
      updateVisualization();
    });
  }
}

function updateVisualization() {
  if (currentActiveTab !== 'visualization') return;

  console.log('[popup.js] Updating visualization for domain:', currentActiveDomain);

  // Update current site indicator
  const siteNameEl = document.getElementById('current-site-name');
  if (siteNameEl) {
    siteNameEl.textContent = currentActiveDomain || 'Unknown';
  }

  // Get network data from background script
  getNetworkData((response) => {
    console.log('[popup.js] Visualization data response:', response);
    
    if (response && response.data) {
      console.log('[popup.js] Raw data length:', response.data.length);
      
      // Filter by current active domain first
      const domainFilteredData = filterDataByDomain(response.data, currentActiveDomain);
      console.log('[popup.js] Domain filtered data length:', domainFilteredData.length);
      
      // Then filter by time range
      const filteredData = filterDataByTimeRange(domainFilteredData);
      console.log('[popup.js] Time filtered data length:', filteredData.length);
      
      renderCharts(filteredData);
      updateMetrics(filteredData);
      updateDomainAnalysis(filteredData);
    } else {
      console.log('[popup.js] No data received for visualization');
      // Clear metrics when no data
      clearVisualizationData();
    }
  });
}

function clearVisualizationData() {
  // Clear metrics
  const totalReqEl = document.getElementById('total-requests');
  const avgTimeEl = document.getElementById('avg-response-time');
  const errorRateEl = document.getElementById('error-rate');
  const dataTransEl = document.getElementById('data-transferred');
  
  if (totalReqEl) totalReqEl.textContent = '0';
  if (avgTimeEl) avgTimeEl.textContent = '0ms';
  if (errorRateEl) errorRateEl.textContent = '0%';
  if (dataTransEl) dataTransEl.textContent = '0 B';

  // Clear charts
  const timelineCanvas = document.getElementById('timeline-canvas');
  const typesCanvas = document.getElementById('types-canvas');
  
  if (timelineCanvas) {
    const ctx = timelineCanvas.getContext('2d');
    ctx.clearRect(0, 0, timelineCanvas.width, timelineCanvas.height);
  }
  
  if (typesCanvas) {
    const ctx = typesCanvas.getContext('2d');
    ctx.clearRect(0, 0, typesCanvas.width, typesCanvas.height);
  }

  // Clear domain list
  const domainList = document.getElementById('domain-list');
  if (domainList) {
    domainList.innerHTML = '<div class="domain-item"><span class="domain-name">No requests captured for this site</span></div>';
  }
}

function filterDataByDomain(data, targetDomain) {
  if (!targetDomain || !data) return data;
  
  console.log('[popup.js] Filtering data by domain:', targetDomain);
  
  return data.filter(entry => {
    const entryDomain = getDomain(entry.url || '');
    const matches = entryDomain === targetDomain;
    if (matches) {
      console.log('[popup.js] Domain match:', entry.url, 'â†’', entryDomain);
    }
    return matches;
  });
}

function filterDataByTimeRange(data) {
  const timeRange = document.getElementById('time-range')?.value || 'all';
  if (timeRange === 'all') return data;

  const now = Date.now();
  const ranges = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000
  };

  const cutoff = now - ranges[timeRange];
  return data.filter(entry => {
    // Use startTime field from background.js data structure  
    const timestamp = entry.startTime || entry.timestamp || 0;
    return timestamp >= cutoff;
  });
}

function renderCharts(data) {
  renderTimelineChart(data);
  renderRequestTypesChart(data);
}

function renderTimelineChart(data) {
  const canvas = document.getElementById('timeline-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const container = canvas.parentElement;

  // Clear previous chart
  if (chartInstances.timeline) {
    chartInstances.timeline.destroy();
  }

  // Prepare timeline data
  const timelineData = prepareTimelineData(data);
  
  if (timelineData.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Simple timeline visualization
  drawTimelineChart(ctx, canvas, timelineData);
}

function prepareTimelineData(data) {
  if (!data || data.length === 0) return [];

  console.log('[popup.js] Preparing timeline data for', data.length, 'entries');
  console.log('[popup.js] Sample entry fields:', data[0] ? Object.keys(data[0]) : 'no data');

  // Group requests by minute for timeline
  const grouped = {};
  data.forEach(entry => {
    // Use startTime field from background.js data structure
    const timestamp = entry.startTime || entry.timestamp || Date.now();
    const minute = Math.floor(timestamp / (60 * 1000)) * 60 * 1000;
    if (!grouped[minute]) grouped[minute] = 0;
    grouped[minute]++;
  });

  const result = Object.entries(grouped)
    .map(([time, count]) => ({ time: parseInt(time), count }))
    .sort((a, b) => a.time - b.time);

  console.log('[popup.js] Timeline data points:', result.length);
  return result;
}

function drawTimelineChart(ctx, canvas, data) {
  canvas.width = canvas.offsetWidth;
  canvas.height = 150;

  const padding = 40;
  const chartWidth = canvas.width - 2 * padding;
  const chartHeight = canvas.height - 2 * padding;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (data.length === 0) return;

  // Find min/max values
  const minTime = Math.min(...data.map(d => d.time));
  const maxTime = Math.max(...data.map(d => d.time));
  const maxCount = Math.max(...data.map(d => d.count));

  // Draw axes
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();

  // Draw data points and lines
  ctx.strokeStyle = '#007acc';
  ctx.fillStyle = '#007acc';
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((point, index) => {
    const x = padding + ((point.time - minTime) / (maxTime - minTime || 1)) * chartWidth;
    const y = canvas.height - padding - (point.count / (maxCount || 1)) * chartHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    // Draw point
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
  });

  ctx.stroke();

  // Add labels
  ctx.fillStyle = '#666';
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Requests over time`, canvas.width / 2, 15);
}

function renderRequestTypesChart(data) {
  const canvas = document.getElementById('types-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  
  // Clear previous chart
  if (chartInstances.types) {
    chartInstances.types.destroy();
  }

  // Count request types
  const typeCounts = {};
  data.forEach(entry => {
    const url = entry.url || '';
    let type = 'Other';
    
    if (url.includes('/api/') || url.includes('api.')) type = 'API';
    else if (url.includes('.js')) type = 'JavaScript';
    else if (url.includes('.css')) type = 'CSS';
    else if (url.includes('.png') || url.includes('.jpg') || url.includes('.gif') || url.includes('.svg')) type = 'Images';
    else if (url.includes('.html') || url === '' || !url.includes('.')) type = 'HTML';

    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  drawPieChart(ctx, canvas, typeCounts);
}

function drawPieChart(ctx, canvas, data) {
  canvas.width = canvas.offsetWidth;
  canvas.height = 150;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 20;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const entries = Object.entries(data);
  if (entries.length === 0) return;

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const colors = ['#007acc', '#28a745', '#ffc107', '#dc3545', '#6c757d', '#17a2b8'];

  let currentAngle = 0;

  entries.forEach(([type, count], index) => {
    const sliceAngle = (count / total) * 2 * Math.PI;
    const color = colors[index % colors.length];

    // Draw slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Add label
    const labelAngle = currentAngle + sliceAngle / 2;
    const labelX = centerX + Math.cos(labelAngle) * (radius * 0.7);
    const labelY = centerY + Math.sin(labelAngle) * (radius * 0.7);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${type}`, labelX, labelY);
    ctx.fillText(`${count}`, labelX, labelY + 12);

    currentAngle += sliceAngle;
  });
}

function updateMetrics(data) {
  console.log('[popup.js] Updating metrics for', data.length, 'requests');
  
  const totalRequests = data.length;
  
  // Calculate response times using startTime and endTime
  const responseTimes = data
    .filter(entry => entry.startTime && entry.endTime && entry.endTime > entry.startTime)
    .map(entry => entry.endTime - entry.startTime);
  
  const avgResponseTime = responseTimes.length > 0 
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  
  // Use statusCode field from background.js
  const errorCount = data.filter(entry => entry.statusCode && entry.statusCode >= 400).length;
  const errorRate = totalRequests > 0 ? Math.round((errorCount / totalRequests) * 100) : 0;
  
  // Use responseSize field from background.js
  const totalBytes = data
    .filter(entry => entry.responseSize && entry.responseSize > 0)
    .reduce((sum, entry) => sum + entry.responseSize, 0);
  const dataTransferred = formatBytes(totalBytes);

  console.log('[popup.js] Metrics calculated:', {
    totalRequests,
    avgResponseTime,
    errorRate,
    totalBytes,
    dataTransferred
  });

  // Update metric displays
  const totalReqEl = document.getElementById('total-requests');
  const avgTimeEl = document.getElementById('avg-response-time');
  const errorRateEl = document.getElementById('error-rate');
  const dataTransEl = document.getElementById('data-transferred');
  
  if (totalReqEl) totalReqEl.textContent = totalRequests;
  if (avgTimeEl) avgTimeEl.textContent = `${avgResponseTime}ms`;
  if (errorRateEl) errorRateEl.textContent = `${errorRate}%`;
  if (dataTransEl) dataTransEl.textContent = dataTransferred;
}

function updateDomainAnalysis(data) {
  console.log('[popup.js] Updating domain analysis for', data.length, 'requests');
  
  // Since we're filtering by current domain, show endpoint analysis instead
  const endpointCounts = {};
  
  data.forEach(entry => {
    const url = entry.url || '';
    // Extract path from URL for endpoint analysis
    let endpoint = 'Unknown';
    try {
      const urlObj = new URL(url);
      endpoint = urlObj.pathname;
      // Group similar endpoints (remove IDs, query params)
      endpoint = endpoint.replace(/\/\d+/g, '/{id}'); // Replace numeric IDs
      endpoint = endpoint.replace(/\/[a-f0-9-]{36}/g, '/{uuid}'); // Replace UUIDs
      if (endpoint.length > 40) {
        endpoint = endpoint.substring(0, 37) + '...';
      }
    } catch (e) {
      endpoint = url.split('?')[0]; // Fallback to URL without query params
    }
    
    endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
  });

  const domainList = document.getElementById('domain-list');
  if (!domainList) return;

  // Update the section title to reflect endpoint analysis
  const sectionTitle = document.querySelector('.viz-section h3');
  if (sectionTitle && sectionTitle.textContent === 'Domain Analysis') {
    sectionTitle.textContent = `Endpoints (${currentActiveDomain || 'Current Site'})`;
  }

  domainList.innerHTML = '';

  const entries = Object.entries(endpointCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10); // Top 10 endpoints

  if (entries.length === 0) {
    domainList.innerHTML = '<div class="domain-item"><span class="domain-name">No data available</span></div>';
    return;
  }

  entries.forEach(([endpoint, count]) => {
    const item = document.createElement('div');
    item.className = 'domain-item';
    item.innerHTML = `
      <span class="domain-name" title="${endpoint}">${endpoint}</span>
      <span class="domain-count">${count}</span>
    `;
    domainList.appendChild(item);
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper function that should already exist
function getDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[0] || '';
  }
}

// Extract and format user data from logonUser response for debugging
function extractLogonUserData(responseBody) {
  if (!responseBody) return '';
  
  try {
    const response = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
    const data = response.data;
    
    if (!data) return '';
    
    // Extract key debugging information
    const userInfo = {
      user: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      userId: data.userId,
      customerId: data.customerId,
      groupId: data.groupId,
      loginName: data.loginName,
      timeZone: data.timeZone,
      utcOffset: data.utcOffset,
      theme: data.themeId,
      sessionExpires: data.sessionExpiresAt,
      sessionTimeout: `${data.sessionLockInMinutes}min`,
      isSSO: data.ssoAuthenticated,
      isTreasury: data.isTreasury,
      isCSR: data.isCSR,
      isNewUser: data.isNewUser
    };
    
    // Count enabled features
    const features = data.capabilities?.features || [];
    const enabledFeatures = features.filter(f => f.value === true).length;
    const totalFeatures = features.length;
    
    // Count transaction rights
    const transRights = data.capabilities?.transactionRights || {};
    const enabledTransactions = Object.values(transRights).filter(t => t && t.enabled === true).length;
    const totalTransactions = Object.keys(transRights).length;
    
    // Format user data summary
    const lines = [];
    
    if (userInfo.user) {
      lines.push(`ðŸ‘¤ <strong>${userInfo.user}</strong> (ID: ${userInfo.userId})`);
    }
    
    if (userInfo.loginName) {
      lines.push(`ðŸ”‘ Login: ${userInfo.loginName}`);
    }
    
    if (userInfo.customerId) {
      lines.push(`ðŸ¢ Customer: ${userInfo.customerId} | Group: ${userInfo.groupId}`);
    }
    
    if (userInfo.theme) {
      lines.push(`ðŸŽ¨ Theme: ${userInfo.theme} | TZ: ${userInfo.timeZone} (${userInfo.utcOffset})`);
    }
    
    if (userInfo.sessionExpires) {
      const expireTime = new Date(userInfo.sessionExpires).toLocaleString();
      lines.push(`â° Session expires: ${expireTime} (timeout: ${userInfo.sessionTimeout})`);
    }
    
    // Status flags
    const flags = [];
    if (userInfo.isSSO) flags.push('SSO');
    if (userInfo.isTreasury) flags.push('Treasury');
    if (userInfo.isCSR) flags.push('CSR');
    if (userInfo.isNewUser) flags.push('New User');
    if (flags.length > 0) {
      lines.push(`ðŸš© Flags: ${flags.join(', ')}`);
    }
    
    // Capabilities summary
    if (totalFeatures > 0) {
      lines.push(`âš¡ Features: ${enabledFeatures}/${totalFeatures} enabled`);
    }
    
    if (totalTransactions > 0) {
      lines.push(`ðŸ’° Transactions: ${enabledTransactions}/${totalTransactions} enabled`);
    }
    
    // Messages
    if (data.messages && data.messages.unread > 0) {
      lines.push(`ðŸ“¬ Unread messages: ${data.messages.unread}`);
    }
    
    return `<div class="user-data-details">${lines.join('<br>')}</div>`;
    
  } catch (error) {
    console.error('[popup.js] Error parsing logonUser response:', error);
    return '<div class="user-data-error">âš ï¸ Error parsing user data</div>';
  }
}

// Initialize capability tabs
function initCapabilityTabs() {
  const tabs = document.querySelectorAll('.capability-tab');
  const contents = document.querySelectorAll('.capability-content');
  
  console.log('[popup.js] Initializing capability tabs:', tabs.length, 'tabs found');
  
  // Remove any existing event listeners
  tabs.forEach((tab, index) => {
    tab.classList.remove('active');
    // Clone node to remove event listeners
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
  });
  
  contents.forEach(content => {
    content.classList.remove('active');
  });
  
  // Get fresh references after cloning
  const freshTabs = document.querySelectorAll('.capability-tab');
  const freshContents = document.querySelectorAll('.capability-content');
  
  // Add event listeners
  freshTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      console.log('[popup.js] Capability tab clicked:', tab.dataset.capability);
      
      // Remove active from all
      freshTabs.forEach(t => t.classList.remove('active'));
      freshContents.forEach(c => c.classList.remove('active'));
      
      // Activate clicked tab
      tab.classList.add('active');
      const targetContent = document.getElementById(`${tab.dataset.capability}-content`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
  
  // Set first tab as active
  if (freshTabs.length > 0 && freshContents.length > 0) {
    freshTabs[0].classList.add('active');
    freshContents[0].classList.add('active');
  }
}

// Load user details data
function loadUserDetailsData() {
  console.log('[popup.js] Loading user details data...');
  console.log('[popup.js] Current session data check:', {
    hasCurrentSessionData: !!currentSessionData,
    sessionId: currentSessionData?.sessionId,
    hasRequests: !!(currentSessionData?.requests),
    requestCount: currentSessionData?.requests?.length || 0
  });
  
  // Use the same session-filtered data that the Network Logs tab uses
  if (!currentSessionData || !currentSessionData.requests) {
    console.log('[popup.js] No current session data available for user details, attempting to load fresh data...');
    
    // Fallback: try to get fresh data if session data not yet available
    getNetworkData((response) => {
      console.log('[popup.js] Fallback getNetworkData response:', {
        hasResponse: !!response,
        hasData: !!(response && response.data),
        dataLength: response?.data?.length || 0
      });
      
      if (response && response.data && response.data.length > 0) {
        // Create temporary session summary to get session-filtered data
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          const activeDomain = tabs[0] ? new URL(tabs[0].url).hostname : null;
          console.log('[popup.js] Active domain for session creation:', activeDomain);
          
          if (activeDomain) {
            const tempSessionSummary = createSessionSummary(response.data, activeDomain);
            console.log('[popup.js] Temporary session summary:', {
              hasSessionSummary: !!tempSessionSummary,
              sessionId: tempSessionSummary?.sessionId,
              hasRequests: !!(tempSessionSummary?.requests),
              requestCount: tempSessionSummary?.requests?.length || 0
            });
            
            if (tempSessionSummary && tempSessionSummary.requests) {
              console.log('[popup.js] Created temporary session summary for user details');
              loadUserDetailsFromRequests(tempSessionSummary.requests, tempSessionSummary.sessionId);
              return;
            }
          }
        });
      }
      console.log('[popup.js] No data available for user details fallback');
      populateUserDetailsTab(null);
    });
    return;
  }
  
  console.log('[popup.js] Using current session data for user details:', {
    sessionId: currentSessionData.sessionId,
    requestCount: currentSessionData.requests.length
  });
  loadUserDetailsFromRequests(currentSessionData.requests, currentSessionData.sessionId);
}

// Helper function to load user details from a set of requests
function loadUserDetailsFromRequests(requests, sessionId) {
  console.log('[popup.js] Loading user details from requests:', {
    sessionId: sessionId,
    totalRequests: requests.length
  });
  
  // Debug: Log all request URLs to see what we have
  console.log('[popup.js] Available request URLs:', requests.map(req => ({
    url: req.url,
    hasResponseBody: !!req.responseBody,
    isLogonUserCapture: req.isLogonUserCapture,
    method: req.method
  })));
  
  // Filter for logonUser requests with response bodies from the CURRENT SESSION only
  const logonUserRequests = requests.filter(req => 
    (req.url?.includes('logonUser?') || req.isLogonUserCapture) && 
    req.responseBody
  );
  
  console.log('[popup.js] Found', logonUserRequests.length, 'logonUser requests with response bodies in session:', sessionId);
  
  // Debug: Log details of logonUser requests found
  logonUserRequests.forEach((req, index) => {
    console.log(`[popup.js] LogonUser request ${index + 1}:`, {
      url: req.url,
      hasResponseBody: !!req.responseBody,
      responseBodyLength: req.responseBody?.length || 0,
      isLogonUserCapture: req.isLogonUserCapture,
      startTime: req.startTime
    });
    
    // Try to parse the response body to see what's in it
    if (req.responseBody) {
      try {
        const parsed = JSON.parse(req.responseBody);
        console.log(`[popup.js] LogonUser request ${index + 1} parsed data:`, {
          hasData: !!parsed.data,
          hasCapabilities: !!(parsed.data?.capabilities),
          hasTransactionRights: !!(parsed.data?.capabilities?.transactionRights),
          transactionRightsCount: parsed.data?.capabilities?.transactionRights ? Object.keys(parsed.data.capabilities.transactionRights).length : 0,
          hasFeatures: !!(parsed.data?.capabilities?.features),
          featuresCount: parsed.data?.capabilities?.features?.length || 0,
          firstName: parsed.data?.firstName,
          lastName: parsed.data?.lastName
        });
      } catch (e) {
        console.log(`[popup.js] LogonUser request ${index + 1} parse error:`, e.message);
      }
    }
  });
  
  if (logonUserRequests.length > 0) {
    // Use the same prioritization logic as displayIndividualRequests
    const bestRequest = logonUserRequests.sort((a, b) => {
      const getScore = (req) => {
        if (req.isLogonUserCapture && req.responseBody) return 3;
        if (req.isLogonUserCapture) return 2;
        return 1;
      };
      
      const scoreA = getScore(a);
      const scoreB = getScore(b);
      
      if (scoreA !== scoreB) return scoreB - scoreA;
      return (b.startTime || 0) - (a.startTime || 0);
    })[0];
    
    console.log('[popup.js] Selected best logonUser request:', {
      url: bestRequest.url,
      isLogonUserCapture: bestRequest.isLogonUserCapture,
      score: bestRequest.isLogonUserCapture && bestRequest.responseBody ? 3 : 
             bestRequest.isLogonUserCapture ? 2 : 1
    });
    
    try {
      const userData = JSON.parse(bestRequest.responseBody);
      console.log('[popup.js] Successfully parsed user data for User Details tab (session:', sessionId, ')');
      console.log('[popup.js] User data structure:', {
        hasData: !!userData.data,
        dataKeys: userData.data ? Object.keys(userData.data) : [],
        hasCapabilities: !!(userData.data?.capabilities),
        capabilityKeys: userData.data?.capabilities ? Object.keys(userData.data.capabilities) : []
      });
      
      populateUserDetailsTab(userData.data || userData);
    } catch (error) {
      console.error('[popup.js] Error parsing logonUser response:', error);
      console.error('[popup.js] Response body that failed to parse:', bestRequest.responseBody?.substring(0, 200) + '...');
      populateUserDetailsTab(null);
    }
  } else {
    console.log('[popup.js] No logonUser data found in session:', sessionId);
    console.log('[popup.js] Available requests summary:', {
      total: requests.length,
      withResponseBody: requests.filter(req => req.responseBody).length,
      logonUserUrls: requests.filter(req => req.url?.includes('logonUser')).length,
      logonUserCaptures: requests.filter(req => req.isLogonUserCapture).length
    });
    populateUserDetailsTab(null);
  }
}

// Populate User Details tab with user data
function populateUserDetailsTab(userData) {
  console.log('[popup.js] Populating User Details tab with:', userData);
  
  const statusIndicator = document.querySelector('.user-status-indicator');
  
  if (!userData) {
    if (statusIndicator) {
      statusIndicator.innerHTML = '<span>No user data available</span>';
      statusIndicator.classList.remove('has-data');
    }
    clearUserDetailsContent();
    return;
  }
  
  // Update status indicator
  const userName = userData.firstName && userData.lastName 
    ? `${userData.firstName} ${userData.lastName}` 
    : userData.loginName || userData.userId || 'User';
    
  if (statusIndicator) {
    statusIndicator.innerHTML = `<span>User: <strong>${userName}</strong></span>`;
    statusIndicator.classList.add('has-data');
  }
  
  // Populate profile section
  populateUserProfile(userData);
  
  // Populate session section  
  populateUserSession(userData);
  
  // Populate capabilities
  populateUserCapabilities(userData);
  
  // Populate environment context
  populateEnvironmentContext(userData);
  
  // Initialize capability tabs
  initCapabilityTabs();
}

// Populate user profile section
function populateUserProfile(userData) {
  const profileGrid = document.querySelector('.user-profile-content .user-info-grid');
  if (!profileGrid) return;
  
  const profileData = [
    { label: 'User ID', value: userData.userId || 'N/A' },
    { label: 'Login Name', value: userData.loginName || 'N/A' },
    { label: 'Full Name', value: userData.firstName && userData.lastName ? `${userData.firstName} ${userData.lastName}` : 'N/A' },
    { label: 'Customer ID', value: userData.customerId || 'N/A' },
    { label: 'Group ID', value: userData.groupId || 'N/A' },
    { label: 'Time Zone', value: userData.timeZone || 'N/A' }
  ];
  
  profileGrid.innerHTML = profileData.map(item => `
    <div class="user-info-item">
      <div class="user-info-label">${item.label}</div>
      <div class="user-info-value">${item.value}</div>
    </div>
  `).join('');
}

// Populate user session section
function populateUserSession(userData) {
  const sessionGrid = document.querySelector('.user-session-content .user-info-grid');
  if (!sessionGrid) return;
  
  const expiresAt = userData.sessionExpiresAt ? new Date(userData.sessionExpiresAt).toLocaleString() : 'N/A';
  const lockTimeout = userData.sessionLockInMinutes ? `${userData.sessionLockInMinutes} minutes` : 'N/A';
  
  const sessionData = [
    { label: 'Session Expires', value: expiresAt },
    { label: 'Lock Timeout', value: lockTimeout },
    { label: 'SSO Authenticated', value: userData.ssoAuthenticated ? 'Yes' : 'No' },
    { label: 'Is Treasury', value: userData.isTreasury ? 'Yes' : 'No' },
    { label: 'Is CSR', value: userData.isCSR ? 'Yes' : 'No' },
    { label: 'Theme ID', value: userData.themeId || 'N/A' }
  ];
  
  sessionGrid.innerHTML = sessionData.map(item => `
    <div class="user-info-item">
      <div class="user-info-label">${item.label}</div>
      <div class="user-info-value">${item.value}</div>
    </div>
  `).join('');
}

// Populate environment context section
function populateEnvironmentContext(userData) {
  const environmentEl = document.getElementById('environment-data');
  if (!environmentEl) return;
  
  console.log('[popup.js] Populating environment context with user data');
  
  // Extract environment information from user data
  const environmentInfo = [];
  
  // Domain and customer info
  if (userData.customerId) {
    environmentInfo.push(`Customer ID: ${userData.customerId}`);
  }
  
  if (userData.groupId) {
    environmentInfo.push(`Group ID: ${userData.groupId}`);
  }
  
  // Time zone information
  if (userData.timeZone) {
    environmentInfo.push(`Time Zone: ${userData.timeZone}`);
  }
  
  // Theme information
  if (userData.themeId) {
    environmentInfo.push(`Theme ID: ${userData.themeId}`);
  }
  
  // Product information
  if (userData.productId) {
    environmentInfo.push(`Product ID: ${userData.productId}`);
  }
  
  // Check if we have any cached environment info from the main tab
  if (cachedEnvInfo) {
    if (cachedEnvInfo.version) {
      environmentInfo.push(`UUX Version: ${cachedEnvInfo.version}`);
    }
    if (cachedEnvInfo.tectonPlatformVersion) {
      environmentInfo.push(`Tecton Platform: ${cachedEnvInfo.tectonPlatformVersion}`);
    }
    if (cachedEnvInfo.cdnBaseUrl) {
      environmentInfo.push(`CDN Base URL: ${cachedEnvInfo.cdnBaseUrl}`);
    }
  }
  
  if (environmentInfo.length > 0) {
    environmentEl.innerHTML = `
      <div class="environment-info-list">
        ${environmentInfo.map(info => `<div class="environment-info-item">${info}</div>`).join('')}
      </div>
    `;
  } else {
    environmentEl.innerHTML = 'No environment data available.';
  }
}

// Populate user capabilities
function populateUserCapabilities(userData) {
  console.log('[popup.js] User capabilities data:', userData.capabilities);
  
  if (userData.capabilities) {
    console.log('[popup.js] Features data:', userData.capabilities.features);
    console.log('[popup.js] Transaction rights data:', userData.capabilities.transactionRights);
    populateFeatures(userData.capabilities.features || []);
    populateTransactionRights(userData.capabilities.transactionRights || {});
    populateSystemFlags(userData.capabilities);
  } else {
    console.log('[popup.js] No capabilities found in user data');
    populateFeatures([]);
    populateTransactionRights({});
    populateSystemFlags({});
  }
}

// Populate features
function populateFeatures(features) {
  const featuresContent = document.getElementById('features-content');
  if (!featuresContent) return;
  
  const grid = featuresContent.querySelector('.capability-grid');
  if (!grid) return;
  
  if (!features || features.length === 0) {
    grid.innerHTML = '<div class="capability-item">No features available</div>';
    return;
  }
  
  console.log('[popup.js] Populating features:', features);
  console.log('[popup.js] Sample feature structure:', features[0]);
  
  grid.innerHTML = features.map((feature, index) => {
    // Handle different possible feature structures
    let featureName = 'Unknown Feature';
    let featureValue = false;
    
    if (typeof feature === 'object') {
      // Handle the actual data structure with 'property' field
      if (feature.property) {
        // Convert property path to readable name
        featureName = formatPropertyName(feature.property);
      } else {
        // Fallback to other property names
        featureName = feature.name || feature.key || feature.featureName || feature.id || `Feature ${index + 1}`;
      }
      
      // Get the feature value
      featureValue = feature.value !== undefined ? feature.value : 
                    feature.enabled !== undefined ? feature.enabled :
                    feature.active !== undefined ? feature.active : false;
    } else if (typeof feature === 'string') {
      featureName = feature;
      featureValue = true; // Assume string features are enabled
    }
    
    console.log(`[popup.js] Feature ${index}:`, { name: featureName, value: featureValue, original: feature });
    
    return `
      <div class="capability-item">
        <div class="capability-name">${featureName}</div>
        <div class="capability-status ${featureValue ? 'enabled' : 'disabled'}">
          ${featureValue ? 'ENABLED' : 'DISABLED'}
        </div>
      </div>
    `;
  }).join('');
}

// Helper function to format property names into readable text
function formatPropertyName(property) {
  if (!property) return 'Unknown Feature';
  
  // Split the property path
  const parts = property.split('/');
  
  if (parts.length === 1) {
    // Single part - just convert camelCase to readable
    return convertCamelCaseToReadable(parts[0]);
  }
  
  // Multiple parts - use the last meaningful part(s)
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const secondLastPart = parts[parts.length - 2];
    
    // If last part is just "Enabled" or similar, use second-to-last
    if (lastPart.toLowerCase() === 'enabled' || lastPart.toLowerCase() === 'access') {
      if (parts.length >= 3) {
        // Use category and feature name: "FeatureGroup/SomethingCool/Enabled" -> "Feature Group: Something Cool"
        const category = convertCamelCaseToReadable(secondLastPart);
        const parentCategory = convertCamelCaseToReadable(parts[parts.length - 3]);
        return `${parentCategory}: ${category}`;
      } else {
        // Just use the second-to-last part: "Global/PolicyModuleAccess" -> "Policy Module Access"
        return convertCamelCaseToReadable(secondLastPart);
      }
    } else {
      // Use both parts: "Customer/Subsidiaries" -> "Customer: Subsidiaries"
      const category = convertCamelCaseToReadable(secondLastPart);
      const feature = convertCamelCaseToReadable(lastPart);
      return `${category}: ${feature}`;
    }
  }
  
  // Fallback: convert the whole thing
  return convertCamelCaseToReadable(property.replace(/\//g, ' '));
}

// Helper function to convert camelCase/PascalCase to readable text
function convertCamelCaseToReadable(text) {
  if (!text) return 'Unknown';
  
  return text
    // Insert spaces before capital letters
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert spaces before numbers
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    // Handle consecutive capitals (like "UUX" -> "UUX")
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    // Capitalize first letter
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

// Populate transaction rights
function populateTransactionRights(transactionRights) {
  const content = document.getElementById('transaction-rights-content');
  if (!content) return;
  
  const grid = content.querySelector('.capability-grid');
  if (!grid) return;
  
  console.log('[popup.js] populateTransactionRights called with:', {
    transactionRights: transactionRights,
    type: typeof transactionRights,
    isNull: transactionRights === null,
    isUndefined: transactionRights === undefined,
    keys: transactionRights ? Object.keys(transactionRights) : 'N/A',
    keyCount: transactionRights ? Object.keys(transactionRights).length : 0
  });
  
  if (!transactionRights || Object.keys(transactionRights).length === 0) {
    console.log('[popup.js] No transaction rights - showing empty message');
    grid.innerHTML = '<div class="capability-item">No transaction rights available</div>';
    return;
  }
  
  console.log('[popup.js] Populating transaction rights with data:', transactionRights);
  console.log('[popup.js] Transaction rights entries:', Object.entries(transactionRights));
  
  grid.innerHTML = Object.entries(transactionRights).map(([name, details]) => {
    console.log('[popup.js] Processing transaction right:', { name, details, detailsType: typeof details });
    
    const displayName = formatTransactionRightName(name);
    
    // Handle different possible transaction right structures
    if (typeof details === 'boolean') {
      console.log('[popup.js] Transaction right', name, 'is boolean:', details);
      return `
        <div class="capability-item">
          <div class="capability-name">${displayName}</div>
          <div class="capability-status ${details ? 'enabled' : 'disabled'}">
            ${details ? 'ENABLED' : 'DISABLED'}
          </div>
        </div>
      `;
    } else if (typeof details === 'object' && details !== null) {
      console.log('[popup.js] Transaction right', name, 'is detailed object:', details);
      
      // Enhanced display for detailed transaction rights objects
      const enabled = details.enabled || false;
      const viewLevel = details.view !== undefined ? details.view : 'N/A';
      const canDraft = details.draft || false;
      const canAuthorize = details.authorize || false;
      const canCancel = details.cancel || false;
      const dualAuthLimit = details.dualAuthLimit !== undefined ? 
        (details.dualAuthLimit === -1 ? 'No Limit' : 
         details.dualAuthLimit === 0 ? 'Not Allowed' : 
         `$${details.dualAuthLimit.toLocaleString()}`) : 'N/A';
      
      console.log('[popup.js] Transaction right processed details:', {
        name, enabled, viewLevel, canDraft, canAuthorize, canCancel, dualAuthLimit
      });
      
      // Interpret view level
      const getViewDescription = (level) => {
        switch(level) {
          case 0: return 'No View';
          case 1: return 'View Own';
          case 2: return 'View All';
          default: return level;
        }
      };
      
      // Create permission badges
      const permissions = [];
      if (viewLevel !== 'N/A' && viewLevel > 0) {
        permissions.push(`View (${getViewDescription(viewLevel)})`);
      }
      if (canDraft) permissions.push('Draft');
      if (canAuthorize) permissions.push('Authorize');
      if (canCancel) permissions.push('Cancel');
      
      const permissionBadges = permissions.length > 0 ? 
        permissions.map(p => `<span class="permission-badge">${p}</span>`).join(' ') : 
        '<span class="permission-badge disabled">No Permissions</span>';
      
      return `
        <div class="capability-item transaction-right-detailed">
          <div class="capability-header">
            <div class="capability-name">${displayName}</div>
            <div class="capability-status ${enabled ? 'enabled' : 'disabled'}">
              ${enabled ? 'ENABLED' : 'DISABLED'}
            </div>
          </div>
          <div class="transaction-details">
            <div class="permission-row">
              <strong>Permissions:</strong> ${permissionBadges}
            </div>
            ${dualAuthLimit !== 'N/A' ? `
              <div class="auth-limit-row">
                <strong>Dual Auth Limit:</strong> <span class="auth-limit">${dualAuthLimit}</span>
              </div>
            ` : ''}
            ${details.draftRestricted ? '<div class="restriction">⚠ Draft Restricted</div>' : ''}
          </div>
        </div>
      `;
    }
    
    // Fallback for unknown types
    console.log('[popup.js] Transaction right', name, 'has unknown type:', typeof details, details);
    return `
      <div class="capability-item">
        <div class="capability-name">${displayName}</div>
        <div class="capability-status disabled">UNKNOWN</div>
      </div>
    `;
  }).join('');
  
  console.log('[popup.js] Transaction rights HTML generated and inserted');
}

// Helper function to format transaction right names into readable text
function formatTransactionRightName(name) {
  // Common transaction right patterns (these are more standardized)
  const patterns = {
    'fundsTransfer': 'Funds Transfer',
    'externalTransfer': 'External Transfer',
    'achBatch': 'ACH Batch',
    'achPayment': 'ACH Payment',
    'achReceipt': 'ACH Receipt',
    'achCollection': 'ACH Collection',
    'payroll': 'Payroll',
    'domesticWire': 'Domestic Wire',
    'internationalWire': 'International Wire',
    'sendCheck': 'Send Check',
    'changeOfAddress': 'Change of Address',
    'stopPayment': 'Stop Payment',
    'achPassThru': 'ACH Pass Through',
    'eftps': 'EFTPS',
    'checkReorder': 'Check Reorder',
    'billPayment': 'Bill Payment',
    'rtpCreditTransfer': 'RTP Credit Transfer',
    'rtpRequestForPayment': 'RTP Request for Payment',
    'wireTransfer': 'Wire Transfer',
    'depositCapture': 'Remote Deposit Capture',
    'positivePayException': 'Positive Pay Exception',
    'accountRecon': 'Account Reconciliation',
    'cardManagement': 'Card Management',
    'loanPayment': 'Loan Payment',
    'investmentTransfer': 'Investment Transfer'
  };
  
  // Return specific pattern match or use dynamic conversion
  return patterns[name] || convertCamelCaseToReadable(name);
}

// Populate system flags (boolean capability flags)
function populateSystemFlags(capabilities) {
  const content = document.getElementById('system-content');
  if (!content) return;
  
  const grid = content.querySelector('.capability-grid');
  if (!grid) return;
  
  if (!capabilities) {
    grid.innerHTML = '<div class="capability-item">No system flags available</div>';
    return;
  }
  
  // Extract boolean flags from capabilities (excluding features and transactionRights)
  const systemFlags = [];
  const excludeKeys = ['features', 'transactionRights'];
  
  Object.entries(capabilities).forEach(([key, value]) => {
    if (!excludeKeys.includes(key) && typeof value === 'boolean') {
      systemFlags.push({ name: key, value: value });
    }
  });
  
  console.log('[popup.js] System flags found:', systemFlags);
  
  if (systemFlags.length === 0) {
    grid.innerHTML = '<div class="capability-item">No system flags available</div>';
    return;
  }
  
  grid.innerHTML = systemFlags.map(flag => {
    const displayName = formatSystemFlagName(flag.name);
    
    return `
      <div class="capability-item">
        <div class="capability-name">${displayName}</div>
        <div class="capability-status ${flag.value ? 'enabled' : 'disabled'}">
          ${flag.value ? 'ENABLED' : 'DISABLED'}
        </div>
      </div>
    `;
  }).join('');
}

// Helper function to format system flag names into readable text
function formatSystemFlagName(name) {
  // Use the dynamic camelCase converter instead of hardcoded patterns
  return convertCamelCaseToReadable(name);
}

// Clear user details content when no data available
function clearUserDetailsContent() {
  const profileGrid = document.querySelector('.user-profile-content .user-info-grid');
  const sessionGrid = document.querySelector('.user-session-content .user-info-grid');
  const featuresGrid = document.querySelector('#features-content .capability-grid');
  const transactionRightsGrid = document.querySelector('#transaction-rights-content .capability-grid');
  const systemFlagsGrid = document.querySelector('#system-content .capability-grid');
  
  if (profileGrid) {
    profileGrid.innerHTML = '<div class="user-info-item"><div class="user-info-value">No user data available</div></div>';
  }
  
  if (sessionGrid) {
    sessionGrid.innerHTML = '<div class="user-info-item"><div class="user-info-value">No session data available</div></div>';
  }
  
  if (featuresGrid) {
    featuresGrid.innerHTML = '<div class="capability-item">No features data available</div>';
  }
  
  if (transactionRightsGrid) {
    transactionRightsGrid.innerHTML = '<div class="capability-item">No transaction rights data available</div>';
  }
  
  if (systemFlagsGrid) {
    systemFlagsGrid.innerHTML = '<div class="capability-item">No system flags data available</div>';
  }
}
