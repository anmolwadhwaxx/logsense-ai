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

// Helper: Format timestamps into human-readable GMT string
function formatDateTime(ts) {
  if (!ts) return 'N/A';
  const date = new Date(ts);
  const pad = n => n.toString().padStart(2, '0');
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

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

  // Initialize cached authentication token
  initializeAuthToken().then(token => {
    if (token) {
      console.log('[AUTH] Successfully loaded cached token on popup initialization');
    } else {
      console.log('[AUTH] No cached token found on popup initialization');
    }
  }).catch(error => {
    console.warn('[AUTH] Error loading cached token:', error);
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

    // Store search strings globally for environment-specific log summaries
    window.environmentSearchStrings = {
      sessionId: summary.sessionId,
      workstationId: workstationId,
      isStaging: isStaging,
      formattedStart: formattedStart,
      formattedEnd: formattedEnd,
      indices: {
        hq: hqIndex,
        lightbridge: lbIndex,
        kamino: kaminoIndex,
        ardent: ardentIndex
      },
      searchStrings: {
        hq: hqSearchString,
        lightbridge: lbSearchString,
        kamino: kaminoSearchString,
        ardent: ardentSearchString
      }
    };

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
            <strong>?? Session Debug</strong><br>
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
              <strong>?? Session Debug (Isolated)</strong><br>
              <strong>Popup ID:</strong> ${popupId}<br>
              <strong>Source Tab:</strong> ${sourceTabId}<br>
              <strong>Domain:</strong> ${domain}<br>
              <strong>q2token:</strong> ${q2token.substring(0, 12)}${q2token.length > 12 ? '...' : ''}<br>
              <strong>Total Sessions:</strong> ${sessionInfo.totalSessions}<br>
              <strong>This Session:</strong> ${currentSession ? `${currentSession.requestCount} reqs` : 'Not found'}<br>
              <strong>Current Tab:</strong> ${currentActiveTab}<br>
              <strong>Session Data:</strong> ${currentSessionData ? `${currentSessionData.requests?.length || 0} reqs` : 'None'}<br>
              <strong>Hash:</strong> ${lastDataHash?.substring(0, 8) || 'none'}<br>
              <span style="color: #4CAF50;">? Tab isolation active</span><br>
              <small style="color: #aaa;">Updated: ${new Date().toLocaleTimeString()}</small>
            `;
          });
        });
      });
    } else {
      debugDiv.innerHTML = `
        <strong>?? Session Debug</strong><br>
        <strong>Popup ID:</strong> ${popupId || 'Initializing...'}<br>
        <strong>Source Tab:</strong> ${sourceTabId || 'Detecting...'}<br>
        <span style="color: #ffa500;">? Initialization in progress</span><br>
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
  } else if (tabName === 'ai-insights') {
    console.log('[popup.js] Switching to ai-insights tab');
    initializeAIInsights();
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
      console.log('[popup.js] Domain match:', entry.url, '→', entryDomain);
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
      lines.push(`👤 <strong>${userInfo.user}</strong> (ID: ${userInfo.userId})`);
    }
    
    if (userInfo.loginName) {
      lines.push(`🔑 Login: ${userInfo.loginName}`);
    }
    
    if (userInfo.customerId) {
      lines.push(`🏢 Customer: ${userInfo.customerId} | Group: ${userInfo.groupId}`);
    }
    
    if (userInfo.theme) {
      lines.push(`🎨 Theme: ${userInfo.theme} | TZ: ${userInfo.timeZone} (${userInfo.utcOffset})`);
    }
    
    if (userInfo.sessionExpires) {
      const expireTime = new Date(userInfo.sessionExpires).toLocaleString();
      lines.push(`⏰ Session expires: ${expireTime} (timeout: ${userInfo.sessionTimeout})`);
    }
    
    // Status flags
    const flags = [];
    if (userInfo.isSSO) flags.push('SSO');
    if (userInfo.isTreasury) flags.push('Treasury');
    if (userInfo.isCSR) flags.push('CSR');
    if (userInfo.isNewUser) flags.push('New User');
    if (flags.length > 0) {
      lines.push(`🚩 Flags: ${flags.join(', ')}`);
    }
    
    // Capabilities summary
    if (totalFeatures > 0) {
      lines.push(`⚡ Features: ${enabledFeatures}/${totalFeatures} enabled`);
    }
    
    if (totalTransactions > 0) {
      lines.push(`💰 Transactions: ${enabledTransactions}/${totalTransactions} enabled`);
    }
    
    // Messages
    if (data.messages && data.messages.unread > 0) {
      lines.push(`📬 Unread messages: ${data.messages.unread}`);
    }
    
    return `<div class="user-data-details">${lines.join('<br>')}</div>`;
    
  } catch (error) {
    console.error('[popup.js] Error parsing logonUser response:', error);
    return '<div class="user-data-error">⚠️ Error parsing user data</div>';
  }
}

// Initialize capability tabs
function initCapabilityTabs() {
  const tabs = document.querySelectorAll('.capability-tab');
  const contents = document.querySelectorAll('.capability-content');
  
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
}// Load user details data
function loadUserDetailsData() {
  console.log('[popup.js] Loading user details data...');
  
  // Use the same session-filtered data that the Network Logs tab uses
  if (!currentSessionData || !currentSessionData.requests) {
    console.log('[popup.js] No current session data available, attempting to load fresh data...');
    
    // Fallback: try to get fresh data if session data not yet available
    getNetworkData((response) => {
      if (response && response.data && response.data.length > 0) {
        // Create temporary session summary to get session-filtered data
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          const activeDomain = tabs[0] ? new URL(tabs[0].url).hostname : null;
          
          if (activeDomain) {
            const tempSessionSummary = createSessionSummary(response.data, activeDomain);
            
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
  
  loadUserDetailsFromRequests(currentSessionData.requests, currentSessionData.sessionId);
}

// Helper function to load user details from a set of requests
function loadUserDetailsFromRequests(requests, sessionId) {
  console.log('[popup.js] Loading user details from requests for session:', sessionId, 'with', requests.length, 'requests');
  
  // Filter for logonUser requests with response bodies from the CURRENT SESSION only
  const logonUserRequests = requests.filter(req => 
    (req.url?.includes('logonUser?') || req.isLogonUserCapture) && 
    req.responseBody
  );
  
  console.log('[popup.js] Found', logonUserRequests.length, 'logonUser requests with response bodies');
  
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
    
    try {
      const userData = JSON.parse(bestRequest.responseBody);
      console.log('[popup.js] Successfully parsed user data for User Details tab');
      populateUserDetailsTab(userData.data || userData);
    } catch (error) {
      console.error('[popup.js] Error parsing logonUser response:', error);
      populateUserDetailsTab(null);
    }
  } else {
    console.log('[popup.js] No logonUser data found in session requests');
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
  console.log('[popup.js] Populating user capabilities');
  
  if (userData.capabilities) {
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
  
  console.log('[popup.js] Populating', features.length, 'features');
  
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



// Populate transaction rights - Enhanced version with inline display
function populateTransactionRights(transactionRights) {
  const content = document.getElementById('transactions-content');
  if (!content) return;
  
  const grid = content.querySelector('.capability-grid');
  if (!grid) return;
  
  if (!transactionRights || Object.keys(transactionRights).length === 0) {
    console.log('[popup.js] No transaction rights available');
    grid.innerHTML = '<div class="capability-item">No transaction rights available</div>';
    return;
  }
  
  console.log('[popup.js] Populating transaction rights with', Object.keys(transactionRights).length, 'entries');
  
  grid.innerHTML = Object.entries(transactionRights).map(([name, details]) => {
    const displayName = formatTransactionRightName(name);
    
    // Handle different possible transaction right structures
    if (typeof details === 'boolean') {
      return `
        <div class="capability-item">
          <div class="capability-name">${displayName}</div>
          <div class="capability-status ${details ? 'enabled' : 'disabled'}">
            ${details ? 'ENABLED' : 'DISABLED'}
          </div>
        </div>
      `;
    } else if (typeof details === 'object' && details !== null) {
      // Create inline badges for each permission with green/red styling like feature flags
      const createPermissionBadge = (label, value) => {
        if (typeof value === 'boolean') {
          return `<span class="permission-badge ${value ? 'enabled' : 'disabled'}">${label}: ${value ? 'Yes' : 'No'}</span>`;
        } else if (typeof value === 'number') {
          if (label === 'View') {
            const viewText = value === 0 ? 'None' : value === 1 ? 'Own' : value === 2 ? 'All' : value;
            const isEnabled = value > 0;
            return `<span class="permission-badge ${isEnabled ? 'enabled' : 'disabled'}">${label}: ${viewText}</span>`;
          } else if (label === 'Dual Auth Limit') {
            if (value === -1) {
              return `<span class="permission-badge enabled">${label}: No Limit</span>`;
            } else if (value === 0) {
              return `<span class="permission-badge disabled">${label}: Not Allowed</span>`;
            } else {
              return `<span class="permission-badge enabled">${label}: $${value.toLocaleString()}</span>`;
            }
          }
        }
        return `<span class="permission-badge neutral">${label}: ${value}</span>`;
      };
      
      // Create all permission badges in one line
      const permissionBadges = [];
      
      // Add view permission
      if (details.view !== undefined) {
        permissionBadges.push(createPermissionBadge('View', details.view));
      }
      
      // Add enabled status
      if (details.enabled !== undefined) {
        permissionBadges.push(createPermissionBadge('Enabled', details.enabled));
      }
      
      // Add draft permission
      if (details.draft !== undefined) {
        permissionBadges.push(createPermissionBadge('Draft', details.draft));
      }
      
      // Add authorize permission
      if (details.authorize !== undefined) {
        permissionBadges.push(createPermissionBadge('Authorize', details.authorize));
      }
      
      // Add cancel permission
      if (details.cancel !== undefined) {
        permissionBadges.push(createPermissionBadge('Cancel', details.cancel));
      }
      
      // Add draft restricted status
      if (details.draftRestricted !== undefined) {
        permissionBadges.push(createPermissionBadge('Draft Restricted', details.draftRestricted));
      }
      
      // Add dual auth limit
      if (details.dualAuthLimit !== undefined) {
        permissionBadges.push(createPermissionBadge('Dual Auth Limit', details.dualAuthLimit));
      }
      
      return `
        <div class="capability-item transaction-right-inline">
          <div class="transaction-name">${displayName}</div>
          <div class="transaction-permissions">
            ${permissionBadges.join(' ')}
          </div>
        </div>
      `;
    }
    
    // Fallback for unknown types
    console.warn('[popup.js] Unknown transaction right type:', typeof details, 'for', name);
    return `
      <div class="capability-item">
        <div class="capability-name">${displayName}</div>
        <div class="capability-status disabled">UNKNOWN</div>
      </div>
    `;
  }).join('');
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
  const transactionRightsGrid = document.querySelector('#transactions-content .capability-grid');
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

// ========== AI INSIGHTS FUNCTIONALITY ==========

let aiAnalysisData = null;

function initializeAIInsights() {
  console.log('[popup.js] Initializing AI Insights tab');
  
  // Check for cached authentication token first
  initializeAuthToken().then(token => {
    const authForm = document.getElementById('auth-form');
    const authStatus = document.getElementById('auth-status');
    
    if (token) {
      console.log('[AUTH] Found cached token, hiding login form');
      // Hide login form and show authenticated status
      if (authForm) authForm.style.display = 'none';
      if (authStatus) {
        authStatus.style.display = 'block';
        authStatus.innerHTML = `
          <div style="padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px;">
            <div style="font-weight: 600; margin-bottom: 10px; color: #155724;">
              ✅ Authenticated with Cached Token
            </div>
            <div style="margin-bottom: 10px; font-size: 12px; color: #155724;">
              Using cached authentication token. Ready for Alexandria API queries.
            </div>
            <div style="margin-top: 15px; display: flex; gap: 10px;">
              <button onclick="resetAuth()" style="padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                🔄 Login as Different User
              </button>
            </div>
          </div>
        `;
      }
    } else {
      console.log('[AUTH] No cached token found, showing login form');
      // Show login form
      if (authForm) authForm.style.display = 'block';
      if (authStatus) authStatus.style.display = 'none';
    }
  }).catch(error => {
    console.warn('[AUTH] Error checking cached token:', error);
    // Show login form as fallback
    const authForm = document.getElementById('auth-form');
    const authStatus = document.getElementById('auth-status');
    if (authForm) authForm.style.display = 'block';
    if (authStatus) authStatus.style.display = 'none';
  });
  
  // Initialize AI action buttons
  const generateSummaryBtn = document.getElementById('generate-summary');
  const analyzePerformanceBtn = document.getElementById('analyze-performance');
  const detectIssuesBtn = document.getElementById('detect-issues');
  const summarizeLogsBtn = document.getElementById('summarize-logs');
  const clearAnalysisBtn = document.getElementById('clear-analysis');
  const authLoginBtn = document.getElementById('auth-login');
  
  if (generateSummaryBtn) {
    generateSummaryBtn.addEventListener('click', generateAISummary);
  }
  
  if (analyzePerformanceBtn) {
    analyzePerformanceBtn.addEventListener('click', analyzePerformance);
  }
  
  if (detectIssuesBtn) {
    detectIssuesBtn.addEventListener('click', detectIssues);
  }
  
  if (summarizeLogsBtn) {
    summarizeLogsBtn.addEventListener('click', summarizeLogs);
  }
  
  if (clearAnalysisBtn) {
    clearAnalysisBtn.addEventListener('click', clearAIAnalysis);
  }
  
  if (authLoginBtn) {
    authLoginBtn.addEventListener('click', handleLogin);
  }
  
  // Initialize time query functionality
  const parseTimeQueryBtn = document.getElementById('parse-time-query');
  const timeQueryInput = document.getElementById('time-query-input');
  
  if (parseTimeQueryBtn && timeQueryInput) {
    parseTimeQueryBtn.addEventListener('click', () => {
      const query = timeQueryInput.value.trim();
      if (query) {
        parseTimeQuery(query);
      } else {
        alert('Please enter a time query first.');
      }
    });
  }
  
  // Initialize environment-specific log summary buttons
  const summarizeHQBtn = document.getElementById('summarize-hq-logs');
  const summarizeKaminoBtn = document.getElementById('summarize-kamino-logs');
  const summarizeLightBridgeBtn = document.getElementById('summarize-lightbridge-logs');
  const summarizeArdentBtn = document.getElementById('summarize-ardent-logs');
  
  if (summarizeHQBtn) {
    summarizeHQBtn.addEventListener('click', () => summarizeEnvironmentLogs('HQ'));
  }
  
  if (summarizeKaminoBtn) {
    summarizeKaminoBtn.addEventListener('click', () => summarizeEnvironmentLogs('Kamino'));
  }
  
  if (summarizeLightBridgeBtn) {
    summarizeLightBridgeBtn.addEventListener('click', () => summarizeEnvironmentLogs('LightBridge'));
  }
  
  if (summarizeArdentBtn) {
    summarizeArdentBtn.addEventListener('click', () => summarizeEnvironmentLogs('Ardent'));
  }
  
  // Load existing analysis if available
  if (aiAnalysisData) {
    displayAIAnalysis(aiAnalysisData);
  }
}

// Function to parse time-based queries and convert to time format
function parseTimeQuery(query) {
  console.log('[TIME_PARSE] Parsing query:', query);
  
  const parsedTimeDisplay = document.getElementById('parsed-time-display');
  const parsedTimeValue = document.getElementById('parsed-time-value');
  
  // Convert query to lowercase for easier parsing
  const lowerQuery = query.toLowerCase();
  
  let timeValue = '';
  let timeUnit = '';
  let parsedTime = '';
  
  // Regular expressions for different time patterns
  const patterns = [
    // "last X minutes/mins" or "past X minutes"
    { regex: /(?:last|past)\s+(\d+)\s+(?:minutes?|mins?)/, unit: 'm' },
    // "last X hours" or "past X hours"  
    { regex: /(?:last|past)\s+(\d+)\s+(?:hours?|hrs?)/, unit: 'h' },
    // "last X days" or "past X days"
    { regex: /(?:last|past)\s+(\d+)\s+(?:days?)/, unit: 'd' },
    // "X minutes ago"
    { regex: /(\d+)\s+(?:minutes?|mins?)\s+ago/, unit: 'm' },
    // "X hours ago"
    { regex: /(\d+)\s+(?:hours?|hrs?)\s+ago/, unit: 'h' },
    // "X days ago"
    { regex: /(\d+)\s+(?:days?)\s+ago/, unit: 'd' },
    // Direct format like "10m", "2h", "1d"
    { regex: /(\d+)([mhd])(?:\s|$)/, unit: null }
  ];
  
  let matched = false;
  
  for (const pattern of patterns) {
    const match = lowerQuery.match(pattern.regex);
    if (match) {
      timeValue = match[1];
      timeUnit = pattern.unit || match[2]; // Use captured unit if no predefined unit
      parsedTime = `-${timeValue}${timeUnit}`;
      matched = true;
      break;
    }
  }
  
  if (!matched) {
    // Try to find any numbers and guess the unit
    const numberMatch = lowerQuery.match(/(\d+)/);
    if (numberMatch) {
      timeValue = numberMatch[1];
      if (lowerQuery.includes('hour') || lowerQuery.includes('hr')) {
        timeUnit = 'h';
      } else if (lowerQuery.includes('day')) {
        timeUnit = 'd';
      } else {
        // Default to minutes
        timeUnit = 'm';
      }
      parsedTime = `-${timeValue}${timeUnit}`;
      matched = true;
    }
  }
  
  if (matched) {
    // Store the parsed time globally for use in queries
    window.currentTimeFilter = parsedTime;
    
    // Update the display
    parsedTimeValue.textContent = parsedTime;
    parsedTimeDisplay.style.display = 'block';
    
    console.log('[TIME_PARSE] Successfully parsed:', parsedTime);
    
    // Update the global time variables used in queries
    updateGlobalTimeFilter(parsedTime);
  } else {
    alert('Could not parse time from query. Try formats like:\n- "last 10 minutes"\n- "past 2 hours"\n- "30 mins ago"\n- "1d" (direct format)');
    parsedTimeDisplay.style.display = 'none';
  }
}

// Function to update global time filters used in Alexandria queries
function updateGlobalTimeFilter(timeFilter) {
  // Update any global time variables here if they exist
  console.log('[TIME_FILTER] Updated global time filter to:', timeFilter);
  
  // This will be used by the environment-specific log summary functions
  window.customTimeFilter = timeFilter;
}

// Function to summarize logs for specific environments
window.summarizeEnvironmentLogs = async function(environment) {
  console.log(`[ENV_SUMMARY] Starting ${environment} log summary`);
  
  if (!authToken) {
    await initializeAuthToken();
    if (!authToken) {
      alert('Please authenticate first before summarizing logs.');
      return;
    }
  }

  // Check if we have stored search strings from session summary
  if (!window.environmentSearchStrings) {
    alert('No session data available. Please ensure you have captured some network requests first.');
    return;
  }

  const timeFilter = window.customTimeFilter || '-8h'; // Default to 8 hours if no custom time set
  const envData = window.environmentSearchStrings;
  
  // Map environment names to search string keys
  const environmentKeyMap = {
    'HQ': 'hq',
    'Kamino': 'kamino',
    'LightBridge': 'lightbridge',
    'Ardent': 'ardent'
  };
  
  const envKey = environmentKeyMap[environment];
  if (!envKey || !envData.searchStrings[envKey]) {
    alert(`No search configuration found for ${environment} environment.`);
    return;
  }

  try {
    // Show loading state
    const logSummariesContent = document.getElementById('log-summaries-content');
    logSummariesContent.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <div style="font-size: 16px; margin-bottom: 10px;">🔄 Summarizing ${environment} Logs...</div>
        <div style="font-size: 14px; color: #666;">Time Range: ${timeFilter}</div>
        <div style="margin-top: 15px;">
          <div class="loading-spinner"></div>
        </div>
      </div>
    `;
    
    // Get the base search string and modify it with custom time if needed
    let searchString = envData.searchStrings[envKey];
    
    // If a custom time filter is set, update the search string
    if (window.customTimeFilter && window.customTimeFilter !== '-8h') {
      // For HQ and Kamino (session-based), update the earliest/latest times
      if (envKey === 'hq' || envKey === 'kamino') {
        // Calculate new time range based on custom filter
        const now = new Date();
        const customStart = calculateTimeFromFilter(window.customTimeFilter);
        const formattedCustomStart = formatDateTime(customStart);
        const formattedCustomEnd = formatDateTime(now);
        
        searchString = `search index="${envData.indices[envKey]}" sessionId="${envData.sessionId}" earliest="${formattedCustomStart}" latest="${formattedCustomEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
      } 
      // For LightBridge and Ardent (workstation-based), update the earliest time
      else if (envKey === 'lightbridge') {
        const customStart = calculateTimeFromFilter(window.customTimeFilter);
        const formattedCustomStart = formatDateTime(customStart);
        const formattedCustomEnd = formatDateTime(new Date());
        
        searchString = `search index="${envData.indices[envKey]}" workstationId="${envData.workstationId}" earliest="${formattedCustomStart}" latest="${formattedCustomEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
      }
      else if (envKey === 'ardent') {
        searchString = `search index="${envData.indices[envKey]}" workstationId="${envData.workstationId}" earliest="${window.customTimeFilter}" | fields * | extract | sort timestamp, seqId | head 10000`;
      }
    }
    
    console.log(`[ENV_SUMMARY] Using search string for ${environment}:`, searchString);
    
    // Create query configuration for this environment
    const environmentQuery = {
      description: `${environment} Environment Logs`,
      query: searchString,
      timeRange: timeFilter,
      environment: environment
    };
    
    // Execute the Alexandria log query with this specific search string
    await executeAlexandriaLogQuery(searchString, environment);
    
  } catch (error) {
    console.error(`[ENV_SUMMARY] Error summarizing ${environment} logs:`, error);
    
    const logSummariesContent = document.getElementById('log-summaries-content');
    logSummariesContent.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #dc3545;">
        <div style="font-size: 16px; margin-bottom: 10px;">❌ Error Summarizing ${environment} Logs</div>
        <div style="font-size: 14px;">${error.message}</div>
      </div>
    `;
  }
};

// Helper function to calculate time from filter string (e.g., "-10m" -> Date 10 minutes ago)
function calculateTimeFromFilter(timeFilter) {
  const now = new Date();
  const match = timeFilter.match(/^-(\d+)([mhd])$/);
  
  if (!match) return now;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 'm': // minutes
      return new Date(now.getTime() - (value * 60 * 1000));
    case 'h': // hours
      return new Date(now.getTime() - (value * 60 * 60 * 1000));
    case 'd': // days
      return new Date(now.getTime() - (value * 24 * 60 * 60 * 1000));
    default:
      return now;
  }
}

// Function to display the exact prompt being sent to Alexandria
function displayExactPrompt(prompt, queryInfo) {
  console.log('[PROMPT_DISPLAY] Showing exact prompt to user');
  
  const logSummariesContent = document.getElementById('log-summaries-content');
  if (!logSummariesContent) return;
  
  const promptPreview = prompt.length > 2000 ? prompt.substring(0, 2000) + '\n\n[... truncated for display, full prompt sent to Alexandria ...]' : prompt;
  
  logSummariesContent.innerHTML = `
    <div style="padding: 20px; max-width: 100%;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #007acc;">
        📤 Alexandria AI Analysis Request
      </div>
      
      <div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border: 1px solid #2196f3; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">📋 Request Details:</div>
        <div style="margin-bottom: 8px;">
          <strong>Query Type:</strong> ${queryInfo?.description || 'General Log Analysis'}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Environment:</strong> ${queryInfo?.type || 'Mixed'}
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Prompt Length:</strong> ${prompt.length.toLocaleString()} characters
        </div>
        <div style="margin-bottom: 8px;">
          <strong>API Endpoint:</strong> alexandria.shs.aws.q2e.io/api/v3/ai/summarize
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Authentication:</strong> Bearer token (8-hour cache)
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #2e7d32;">📄 Exact Prompt Being Sent to Alexandria AI:</div>
        <div style="background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 15px; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.4; white-space: pre-wrap; max-height: 400px; overflow-y: auto; word-wrap: break-word;">
${promptPreview}
        </div>
      </div>
      
      <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">ℹ️ How This Works:</div>
        <ol style="margin: 5px 0; padding-left: 20px;">
          <li>Extension queries Alexandria logs using your session data</li>
          <li>Intelligent log selection picks key logs (first 5 + last 5 + errors + context)</li>
          <li>Selected logs are formatted into a structured prompt</li>
          <li>Prompt is sent to Alexandria AI for analysis via POST request</li>
          <li>AI analyzes the logs and returns insights about errors, performance, etc.</li>
        </ol>
      </div>
      
      <div style="margin-bottom: 20px;">
        <div class="ai-loading">
          <div class="loading-spinner"></div>
          🤖 Sending request to Alexandria AI... Please wait for analysis results.
        </div>
      </div>
      
      <div style="text-align: center;">
        <button onclick="copyPromptToClipboard()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
          📋 Copy Full Prompt
        </button>
        <button onclick="showRawPromptData()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🔍 Show Raw Data
        </button>
      </div>
    </div>
  `;
  
  // Store the prompt globally so the copy function can access it
  window.currentAlexandriaPrompt = prompt;
}

// Function to copy the full prompt to clipboard
function copyPromptToClipboard() {
  if (window.currentAlexandriaPrompt) {
    navigator.clipboard.writeText(window.currentAlexandriaPrompt).then(() => {
      alert('✅ Full Alexandria prompt copied to clipboard!');
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = window.currentAlexandriaPrompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('✅ Full Alexandria prompt copied to clipboard!');
    });
  }
}

// Function to show raw prompt data in a modal-like view
function showRawPromptData() {
  if (window.currentAlexandriaPrompt) {
    const popup = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    popup.document.write(`
      <html>
        <head>
          <title>Alexandria Prompt - Raw Data</title>
          <style>
            body { font-family: monospace; padding: 20px; line-height: 1.4; }
            .header { background: #f0f0f0; padding: 10px; margin-bottom: 20px; border-radius: 4px; }
            .content { white-space: pre-wrap; word-wrap: break-word; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>🤖 Alexandria AI Prompt - Raw Data</h2>
            <p><strong>Length:</strong> ${window.currentAlexandriaPrompt.length.toLocaleString()} characters</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <div class="content">${window.currentAlexandriaPrompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </body>
      </html>
    `);
  }
}

// Helper function to intelligently select logs for AI analysis
function selectLogsForAnalysis(logs) {
  if (!logs || logs.length === 0) {
    return [];
  }
  
  console.log(`[LOG_SELECTION] Processing ${logs.length} logs for intelligent selection`);
  
  let selectedLogs = [];
  
  // Step 1: Get first 5 logs
  const firstLogs = logs.slice(0, 5);
  selectedLogs = selectedLogs.concat(firstLogs.map(log => ({ ...log, source: 'first' })));
  console.log(`[LOG_SELECTION] Added ${firstLogs.length} first logs`);
  
  // Step 2: Get last 5 logs (avoid duplicates if total logs <= 5)
  if (logs.length > 5) {
    const lastLogs = logs.slice(-5);
    selectedLogs = selectedLogs.concat(lastLogs.map(log => ({ ...log, source: 'last' })));
    console.log(`[LOG_SELECTION] Added ${lastLogs.length} last logs`);
  }
  
  // Step 3: Find error level logs
  const errorLogs = logs.filter(log => {
    const message = log.message || log._raw || JSON.stringify(log);
    const level = log.level || log.logLevel || '';
    
    // Check for error indicators
    const hasErrorLevel = level.toLowerCase().includes('error') || 
                         level.toLowerCase().includes('exception') ||
                         level.toLowerCase().includes('fatal');
    
    const hasErrorMessage = message.toLowerCase().includes('error') ||
                          message.toLowerCase().includes('exception') ||
                          message.toLowerCase().includes('failed') ||
                          message.toLowerCase().includes('failure') ||
                          message.toLowerCase().includes('fatal') ||
                          message.toLowerCase().includes('critical');
    
    return hasErrorLevel || hasErrorMessage;
  });
  
  console.log(`[LOG_SELECTION] Found ${errorLogs.length} error logs`);
  
  // Step 4: For each error log, try to find the preceding request/response context
  for (const errorLog of errorLogs) {
    const errorIndex = logs.findIndex(log => log === errorLog);
    
    // Add the error log
    selectedLogs.push({ ...errorLog, source: 'error' });
    
    // Look for context logs before the error (up to 5 logs back)
    const contextStart = Math.max(0, errorIndex - 5);
    const contextLogs = logs.slice(contextStart, errorIndex);
    
    for (const contextLog of contextLogs) {
      const contextMessage = contextLog.message || contextLog._raw || JSON.stringify(contextLog);
      
      // Check if this looks like a request or response
      if (contextMessage.toLowerCase().includes('request') ||
          contextMessage.toLowerCase().includes('response') ||
          contextMessage.toLowerCase().includes('http') ||
          contextMessage.toLowerCase().includes('api') ||
          contextMessage.toLowerCase().includes('endpoint')) {
        selectedLogs.push({ ...contextLog, source: 'context' });
      }
    }
  }
  
  // Step 5: Remove duplicates based on timestamp and message
  const uniqueLogs = [];
  const seen = new Set();
  
  for (const log of selectedLogs) {
    const key = `${log.timestamp || ''}_${(log.message || log._raw || '').substring(0, 100)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLogs.push(log);
    }
  }
  
  console.log(`[LOG_SELECTION] Selected ${uniqueLogs.length} unique logs (${errorLogs.length} errors, ${uniqueLogs.filter(l => l.source === 'context').length} context)`);
  
  return uniqueLogs.slice(0, 25); // Limit to 25 logs max to avoid prompt size issues
}

// Function to execute Alexandria log query with specific search string
async function executeAlexandriaLogQuery(searchString, environment) {
  console.log(`[ALEXANDRIA_QUERY] Executing query for ${environment}:`, searchString);
  
  try {
    // Use the existing proceedWithAlexandriaLogQuery function but with our custom search
    const customQuery = {
      description: `${environment} Environment Query`,
      query: searchString
    };
    
    // Call the existing Alexandria query function with our custom search string
    const result = await queryAlexandriaLogs(authToken, searchString);
    
    if (result && result.Data && result.Data.length > 0) {
      console.log(`[ALEXANDRIA_QUERY] Got ${result.Data.length} log entries for ${environment}`);
      
      // Prepare log data for AI analysis using intelligent selection
      const selectedLogs = selectLogsForAnalysis(result.Data);
      let logSummary = `Found ${result.Data.length} log entries from ${environment} environment. Selected ${selectedLogs.length} key logs for analysis:\n\n`;
      
      // Group logs by source for better organization
      const logsBySource = {
        first: selectedLogs.filter(log => log.source === 'first'),
        last: selectedLogs.filter(log => log.source === 'last'),
        error: selectedLogs.filter(log => log.source === 'error'),
        context: selectedLogs.filter(log => log.source === 'context')
      };
      
      // Add first logs
      if (logsBySource.first.length > 0) {
        logSummary += `=== FIRST ${logsBySource.first.length} LOGS (Session Start) ===\n`;
        logsBySource.first.forEach((log, index) => {
          logSummary += `Log ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add error logs with context
      if (logsBySource.error.length > 0) {
        logSummary += `=== ERROR LOGS (${logsBySource.error.length} found) ===\n`;
        logsBySource.error.forEach((log, index) => {
          logSummary += `Error ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'ERROR'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add context logs
      if (logsBySource.context.length > 0) {
        logSummary += `=== CONTEXT LOGS (${logsBySource.context.length} request/response logs around errors) ===\n`;
        logsBySource.context.forEach((log, index) => {
          logSummary += `Context ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add last logs
      if (logsBySource.last.length > 0) {
        logSummary += `=== LAST ${logsBySource.last.length} LOGS (Recent Activity) ===\n`;
        logsBySource.last.forEach((log, index) => {
          logSummary += `Recent ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
      }
      
      if (result.Data.length > selectedLogs.length) {
        logSummary += `\n... and ${result.Data.length - selectedLogs.length} more log entries not shown`;
      }
      
      // Update UI to show analysis in progress
      const logSummariesContent = document.getElementById('log-summaries-content');
      logSummariesContent.innerHTML = `
        <div class="ai-loading">
          <div class="loading-spinner"></div>
          📊 Processing ${result.Data.length} ${environment} log entries with Alexandria AI analysis...
        </div>
      `;
      
      // Send to Alexandria for AI analysis
      const summaryPrompt = `Analyze these ${environment} environment log entries and provide insights:

${logSummary}

Focus on:
1. Any errors or issues found
2. Performance patterns
3. Key events or transactions
4. Recommendations for optimization
5. Environment-specific insights`;

      console.log(`[ALEXANDRIA_QUERY] Sending AI analysis prompt for ${environment}:`, summaryPrompt);
      
      // NEW: Show the exact prompt being sent to Alexandria in the UI
      displayExactPrompt(summaryPrompt, { description: `${environment} Environment Query`, type: environment.toLowerCase() });
      
      try {
        const alexandriaAnalysis = await summarizeLogsAPI(summaryPrompt);
        console.log(`[ALEXANDRIA_QUERY] AI analysis complete for ${environment}:`, alexandriaAnalysis);
        
        // Display results with both log data and AI analysis
        displayLogSummaryResults(result, alexandriaAnalysis, customQuery);
      } catch (analysisError) {
        console.error(`[ALEXANDRIA_QUERY] AI analysis failed for ${environment}:`, analysisError);
        
        // Show logs without analysis if AI fails
        displayLogSummaryResults(result, {
          summary: `Analysis failed for ${environment} logs: ${analysisError.message}`,
          response: `Error: ${analysisError.message}`
        }, customQuery);
      }
    } else {
      const logSummariesContent = document.getElementById('log-summaries-content');
      logSummariesContent.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <div style="font-size: 16px; margin-bottom: 10px;">📊 ${environment} Log Query Complete</div>
          <div style="font-size: 14px; color: #666;">No log entries found for the specified time range.</div>
          <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px;">
            <strong>Search Query:</strong><br>
            <code style="font-size: 12px; word-break: break-all;">${searchString}</code>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error(`[ALEXANDRIA_QUERY] Error executing query for ${environment}:`, error);
    throw error;
  }
}

async function handleLogin() {
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  const authForm = document.getElementById('auth-form');
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('auth-login');
  
  const username = usernameInput?.value?.trim();
  const password = passwordInput?.value?.trim();
  
  if (!username || !password) {
    alert('Please enter both username and password');
    return;
  }
  
  // Show loading state
  loginBtn.textContent = '🔄 Logging in...';
  loginBtn.disabled = true;
  
  // Add timeout to prevent infinite loading
  const timeoutId = setTimeout(() => {
    loginBtn.textContent = '⏰ Request timed out - Retry';
    loginBtn.disabled = false;
  }, 15000); // 15 second timeout
  
  try {
    console.log('[AUTH] Attempting login for user:', username);
    
    const response = await fetchAuthToken(username, password);
    clearTimeout(timeoutId);
    
    // Success - show the full response on screen for now
    authForm.style.display = 'none';
    authStatus.style.display = 'block';
    authStatus.innerHTML = `
      <div style="padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #155724;">
          ✅ Login Successful!
        </div>
        <div style="margin-bottom: 15px;">
          <strong>Full API Response:</strong>
        </div>
        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 11px; white-space: pre-wrap; max-height: 200px; overflow-y: auto; line-height: 1.4;">
${JSON.stringify(response, null, 2)}
        </div>
        <div style="margin-top: 15px; display: flex; gap: 10px;">
          <button onclick="resetAuth()" style="padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
            🔄 Login as Different User
          </button>
          <button onclick="copyTokenResponse()" style="padding: 6px 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
            📋 Copy Response
          </button>
        </div>
      </div>
    `;
    
    // Store the response globally so we can access it later
    window.lastTokenResponse = response;
    
    // Extract and store the authentication token
    if (response && response.access_token) {
      authToken = response.access_token;
      console.log('[AUTH] Token extracted from access_token:', authToken ? `${String(authToken).substring(0, 8)}...` : 'none');
      await saveTokenToCache(authToken); // Save to persistent cache
    } else if (response && typeof response === 'string') {
      // If response is a string token
      authToken = response;
      console.log('[AUTH] String token stored:', authToken ? `${authToken.substring(0, 8)}...` : 'none');
      await saveTokenToCache(authToken); // Save to persistent cache
    } else if (response && response.token) {
      // Try alternate token field
      authToken = response.token;
      console.log('[AUTH] Token extracted from token field:', authToken ? `${String(authToken).substring(0, 8)}...` : 'none');
      await saveTokenToCache(authToken); // Save to persistent cache
    } else {
      console.warn('[AUTH] Could not extract token from response, checking response structure:');
      console.warn('[AUTH] Response type:', typeof response);
      console.warn('[AUTH] Response keys:', response ? Object.keys(response) : 'null');
      console.warn('[AUTH] Full response:', response);
      
      // Try to find any field that looks like a token
      if (response && typeof response === 'object') {
        const possibleTokenFields = ['access_token', 'token', 'authToken', 'auth_token', 'bearer_token', 'jwt'];
        let foundToken = null;
        
        for (const field of possibleTokenFields) {
          if (response[field] && typeof response[field] === 'string') {
            foundToken = response[field];
            console.log('[AUTH] Found token in field:', field);
            break;
          }
        }
        
        if (foundToken) {
          authToken = foundToken;
          console.log('[AUTH] Using found token:', foundToken ? `${foundToken.substring(0, 8)}...` : 'none');
          await saveTokenToCache(authToken); // Save to persistent cache
        } else {
          // Last resort: convert entire response to string if it looks like a UUID/token
          const responseStr = String(response);
          if (responseStr.length > 10 && responseStr.match(/^[a-f0-9-]+$/i)) {
            authToken = responseStr;
            console.log('[AUTH] Using stringified response as token:', responseStr.substring(0, 8) + '...');
            await saveTokenToCache(authToken); // Save to persistent cache
          } else {
            console.error('[AUTH] No valid token found in response');
            authToken = null;
          }
        }
      } else {
        authToken = null;
      }
    }
    
    console.log('[AUTH] Login successful, response stored');
    
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[AUTH] Login failed:', error);
    
    // Show error and reset button
    loginBtn.textContent = '❌ Login Failed - Retry';
    loginBtn.disabled = false;
    
    // Show detailed error message
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'margin-top: 15px; padding: 12px; background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; border-radius: 4px; font-size: 12px;';
    errorDiv.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">❌ Login Failed</div>
      <div style="margin-bottom: 10px;">
        <strong>Error:</strong> ${error.message}
      </div>
      <div style="margin-bottom: 10px;">
        <strong>Troubleshooting:</strong>
      </div>
      <ul style="margin: 5px 0; padding-left: 20px; font-size: 11px;">
        <li>Check your username and password</li>
        <li>Verify Alexandria server is accessible</li>
        <li>Check browser console for CORS or network errors</li>
        <li>Try from a different network if connection issues persist</li>
      </ul>
      <details style="margin-top: 10px;">
        <summary style="cursor: pointer; font-size: 11px;">Show technical details</summary>
        <div style="margin-top: 5px; font-family: monospace; background: #f1f1f1; padding: 8px; border-radius: 3px; font-size: 10px;">
${error.stack || error.toString()}
        </div>
      </details>
    `;
    
    // Remove existing error if any
    const existingError = authForm.querySelector('.auth-error');
    if (existingError) {
      existingError.remove();
    }
    
    errorDiv.className = 'auth-error';
    authForm.appendChild(errorDiv);
  }
}

function copyTokenResponse() {
  if (window.lastTokenResponse) {
    const text = JSON.stringify(window.lastTokenResponse, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      alert('Token response copied to clipboard!');
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Token response copied to clipboard!');
    });
  }
}

function resetAuth() {
  authToken = null;
  clearTokenFromCache(); // Clear cached token as well
  const authForm = document.getElementById('auth-form');
  const authStatus = document.getElementById('auth-status');
  const loginBtn = document.getElementById('auth-login');
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  
  // Clear stored response
  window.lastTokenResponse = null;
  
  // Reset form
  authForm.style.display = 'block';
  authStatus.style.display = 'none';
  loginBtn.textContent = '� Login & Get Token';
  loginBtn.disabled = false;
  
  // Clear inputs
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  
  // Remove any error messages
  const existingError = authForm ? authForm.querySelector('.auth-error') : null;
  if (existingError) {
    existingError.remove();
  }
  
  console.log('[AUTH] Reset authentication form and cleared cached token');
}

function generateAISummary() {
  console.log('[popup.js] Generating AI summary...');
  
  const summaryContent = document.getElementById('ai-summary-content');
  if (!summaryContent) return;
  
  // Show loading state
  summaryContent.innerHTML = `
    <div class="ai-loading">
      <div class="loading-spinner"></div>
      Analyzing current session data with AI...
    </div>
  `;
  
  // Use current session data if available, otherwise get fresh data
  if (currentSessionData && currentSessionData.requests && currentSessionData.requests.length > 0) {
    console.log('[popup.js] Using current session data for AI analysis:', currentSessionData.sessionId);
    
    // Simulate AI processing delay
    setTimeout(() => {
      const analysis = analyzeSessionData(currentSessionData.requests, currentSessionData);
      aiAnalysisData = analysis;
      displayAIAnalysis(analysis);
      
      summaryContent.innerHTML = `
        <div class="ai-success">
          ✅ AI analysis completed for current session!
        </div>
        <div style="margin-top: 15px;">
          <h4>🧠 Current Session Intelligence Report</h4>
          <p><strong>Session ID:</strong> ${currentSessionData.sessionId}</p>
          <p><strong>Total Requests:</strong> ${analysis.totalRequests}</p>
          <p><strong>Session Duration:</strong> ${analysis.sessionDuration}</p>
          <p><strong>Average Response Time:</strong> ${analysis.avgResponseTime}ms</p>
          <p><strong>Success Rate:</strong> ${analysis.successRate}%</p>
          <p><strong>Performance Score:</strong> ${analysis.performanceScore}/100</p>
          
          <h4>📊 Key Insights</h4>
          <ul>
            ${analysis.insights.map(insight => `<li>${insight}</li>`).join('')}
          </ul>
        </div>
      `;
    }, 1500);
  } else {
    // Fallback: try to get fresh data and filter by current domain
    getNetworkData((response) => {
      if (!response?.data || response.data.length === 0) {
        summaryContent.innerHTML = `
          <div class="ai-error">
            No session data available to analyze. Please capture some network requests first.
          </div>
        `;
        return;
      }
      
      // Get current active domain from the tab
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const activeTab = tabs[0];
        if (!activeTab) {
          summaryContent.innerHTML = `
            <div class="ai-error">
              Unable to determine current tab for session analysis.
            </div>
          `;
          return;
        }
        
        const activeDomain = new URL(activeTab.url).hostname;
        console.log('[popup.js] Creating session summary for AI analysis with domain:', activeDomain);
        
        // Create session summary for current domain
        const sessionSummary = createSessionSummary(response.data, activeDomain);
        
        if (!sessionSummary || !sessionSummary.requests || sessionSummary.requests.length === 0) {
          summaryContent.innerHTML = `
            <div class="ai-error">
              No session data found for current domain: ${activeDomain}. Please ensure you're on the correct site and have captured some requests.
            </div>
          `;
          return;
        }
        
        // Simulate AI processing delay
        setTimeout(() => {
          const analysis = analyzeSessionData(sessionSummary.requests, sessionSummary);
          aiAnalysisData = analysis;
          displayAIAnalysis(analysis);
          
          summaryContent.innerHTML = `
            <div class="ai-success">
              ✅ AI analysis completed for current session!
            </div>
            <div style="margin-top: 15px;">
              <h4>🧠 Current Session Intelligence Report</h4>
              <p><strong>Domain:</strong> ${activeDomain}</p>
              <p><strong>Session ID:</strong> ${sessionSummary.sessionId}</p>
              <p><strong>Total Requests:</strong> ${analysis.totalRequests}</p>
              <p><strong>Session Duration:</strong> ${analysis.sessionDuration}</p>
              <p><strong>Average Response Time:</strong> ${analysis.avgResponseTime}ms</p>
              <p><strong>Success Rate:</strong> ${analysis.successRate}%</p>
              <p><strong>Performance Score:</strong> ${analysis.performanceScore}/100</p>
              
              <h4>📊 Key Insights</h4>
              <ul>
                ${analysis.insights.map(insight => `<li>${insight}</li>`).join('')}
              </ul>
            </div>
          `;
        }, 1500);
      });
    });
  }
}

function analyzePerformance() {
  console.log('[popup.js] Analyzing performance...');
  
  if (!aiAnalysisData) {
    alert('Please generate a summary first to analyze performance.');
    return;
  }
  
  // Performance analysis is already done in the main analysis
  displayPerformanceAnalysis(aiAnalysisData);
}

function detectIssues() {
  console.log('[popup.js] Detecting issues...');
  
  if (!aiAnalysisData) {
    alert('Please generate a summary first to detect issues.');
    return;
  }
  
  displayIssueDetection(aiAnalysisData);
}

function clearAIAnalysis() {
  console.log('[popup.js] Clearing AI analysis...');
  
  aiAnalysisData = null;
  
  // Reset all content areas
  const summaryContent = document.getElementById('ai-summary-content');
  const slowRequestsList = document.getElementById('slow-requests-list');
  const errorAnalysisList = document.getElementById('error-analysis-list');
  const performanceTrends = document.getElementById('performance-trends');
  const optimizationTips = document.getElementById('optimization-tips');
  const healthScoreValue = document.getElementById('health-score-value');
  const healthBreakdown = document.getElementById('health-breakdown');
  const recommendationsContent = document.getElementById('ai-recommendations-content');
  
  if (summaryContent) {
    summaryContent.innerHTML = `
      <div class="ai-placeholder">
        <span class="ai-placeholder-icon">🤖</span>
        <p>Click "Generate Smart Summary" to get AI-powered insights about your session</p>
      </div>
    `;
  }
  
  if (slowRequestsList) {
    slowRequestsList.innerHTML = '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>';
  }
  
  if (errorAnalysisList) {
    errorAnalysisList.innerHTML = '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>';
  }
  
  if (performanceTrends) {
    performanceTrends.innerHTML = '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>';
  }
  
  if (optimizationTips) {
    optimizationTips.innerHTML = '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>';
  }
  
  if (healthScoreValue) {
    healthScoreValue.textContent = '--';
  }
  
  if (healthBreakdown) {
    healthBreakdown.innerHTML = '<div class="health-placeholder">Generate analysis to see health score</div>';
  }
  
  if (recommendationsContent) {
    recommendationsContent.innerHTML = `
      <div class="recommendations-list">
        <div class="ai-placeholder">
          <span class="ai-placeholder-icon">💡</span>
          <p>AI recommendations will appear here after analysis</p>
        </div>
      </div>
    `;
  }
}

function analyzeSessionData(data, sessionInfo = null) {
  const analysis = {
    totalRequests: data.length,
    sessionStart: Math.min(...data.map(r => r.startTime).filter(t => t)),
    sessionEnd: Math.max(...data.map(r => r.endTime || r.startTime).filter(t => t)),
    slowRequests: [],
    errors: [],
    insights: [],
    recommendations: [],
    sessionId: sessionInfo ? sessionInfo.sessionId : 'Unknown',
    activeDomain: sessionInfo ? sessionInfo.activeDomain : 'Unknown'
  };
  
  // Calculate session duration
  analysis.sessionDuration = formatDuration(analysis.sessionEnd - analysis.sessionStart);
  
  // Analyze response times
  const responseTimes = data
    .filter(r => r.startTime && r.endTime)
    .map(r => r.endTime - r.startTime);
  
  analysis.avgResponseTime = responseTimes.length > 0 
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  
  // Find slow requests (> 2 seconds), or top 5 requests if no slow ones exist
  const slowRequestsFilter = data.filter(r => r.startTime && r.endTime && (r.endTime - r.startTime) > 2000);
  
  if (slowRequestsFilter.length > 0) {
    // Show top 3 slow requests (> 2 seconds)
    analysis.slowRequests = slowRequestsFilter
      .sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))
      .slice(0, 3)
      .map(r => ({
        url: r.url,
        responseTime: r.endTime - r.startTime
      }));
  } else {
    // No slow requests, show top 5 requests sorted by response time
    analysis.slowRequests = data
      .filter(r => r.startTime && r.endTime)
      .sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime))
      .slice(0, 5)
      .map(r => ({
        url: r.url,
        responseTime: r.endTime - r.startTime
      }));
  }
  
  // Find errors
  analysis.errors = data
    .filter(r => r.statusCode && r.statusCode >= 400)
    .slice(0, 5)
    .map(r => ({
      url: r.url, // Keep full URL for display, truncation handled in display functions
      statusCode: r.statusCode,
      statusText: r.statusText || 'Error',
      responseTime: (r.startTime && r.endTime) ? r.endTime - r.startTime : null
    }));
  
  // Calculate success rate
  const successfulRequests = data.filter(r => r.statusCode && r.statusCode < 400).length;
  analysis.successRate = data.length > 0 ? Math.round((successfulRequests / data.length) * 100) : 0;
  
  // Calculate performance score
  analysis.performanceScore = calculatePerformanceScore(analysis);
  
  // Generate insights with session context
  generateInsights(analysis);
  
  // Generate recommendations
  generateRecommendations(analysis);
  
  return analysis;
}

function displayAIAnalysis(analysis) {
  displaySlowRequests(analysis.slowRequests);
  displayErrorAnalysis(analysis.errors);
  displayPerformanceMetrics(analysis);
  displayHealthScore(analysis.performanceScore);
  displayRecommendations(analysis.recommendations);
}

function displaySlowRequests(slowRequests) {
  const slowRequestsList = document.getElementById('slow-requests-list');
  const slowRequestsTitle = document.getElementById('slow-requests-title');
  if (!slowRequestsList) return;
  
  if (slowRequests.length === 0) {
    slowRequestsList.innerHTML = '<div class="analytics-placeholder">No requests found! 📭</div>';
    if (slowRequestsTitle) {
      slowRequestsTitle.textContent = '⏱️ Slow Requests';
    }
    return;
  }
  
  // Check if any request is actually slow (> 2 seconds)
  const hasSlowRequests = slowRequests.some(req => req.responseTime > 2000);
  
  // Update title based on content
  if (slowRequestsTitle) {
    if (hasSlowRequests) {
      slowRequestsTitle.textContent = '🐌 Slow Requests';
    } else {
      slowRequestsTitle.textContent = '⚡ Top Requests by Time';
    }
  }
  
  const html = slowRequests.map((req, index) => `
    <div class="slow-request-item">
      <span class="slow-request-url" title="${req.url}">
        ${hasSlowRequests ? '' : `${index + 1}. `}${truncateUrl(req.url, 100)}
      </span>
      <span class="slow-request-time">${Math.round(req.responseTime)}ms</span>
    </div>
  `).join('');
  
  slowRequestsList.innerHTML = html;
}

function displayErrorAnalysis(errors) {
  const errorAnalysisList = document.getElementById('error-analysis-list');
  if (!errorAnalysisList) return;
  
  if (errors.length === 0) {
    errorAnalysisList.innerHTML = '<div class="analytics-placeholder">No errors detected! ✨</div>';
    return;
  }
  
  const html = errors.map(error => `
    <div class="error-item">
      <span class="error-status">${error.statusCode}</span>
      <span class="error-url" title="${error.url}">${truncateUrl(error.url, 100)}</span>
      ${error.responseTime !== null ? 
        `<span class="error-time">${Math.round(error.responseTime)}ms</span>` : 
        '<span class="error-time">N/A</span>'
      }
    </div>
  `).join('');
  
  errorAnalysisList.innerHTML = html;
}

function displayPerformanceMetrics(analysis) {
  const performanceTrends = document.getElementById('performance-trends');
  if (!performanceTrends) return;
  
  const html = `
    <div class="performance-metric">
      <span class="metric-label">Avg Response Time:</span>
      <span class="metric-value">${analysis.avgResponseTime}ms</span>
    </div>
    <div class="performance-metric">
      <span class="metric-label">Success Rate:</span>
      <span class="metric-value">${analysis.successRate}%</span>
    </div>
    <div class="performance-metric">
      <span class="metric-label">Total Requests:</span>
      <span class="metric-value">${analysis.totalRequests}</span>
    </div>
    <div class="performance-metric">
      <span class="metric-label">Session Duration:</span>
      <span class="metric-value">${analysis.sessionDuration}</span>
    </div>
  `;
  
  performanceTrends.innerHTML = html;
}

function displayHealthScore(score) {
  const healthScoreValue = document.getElementById('health-score-value');
  const healthBreakdown = document.getElementById('health-breakdown');
  
  if (healthScoreValue) {
    healthScoreValue.textContent = score;
    
    // Update the conic gradient based on score
    const scorePercent = score;
    const healthCircle = document.querySelector('.health-score-circle');
    if (healthCircle) {
      healthCircle.style.setProperty('--score-percent', `${scorePercent}%`);
      
      // Update color based on score
      let color = '#ff6b6b'; // Red for low scores
      if (score >= 70) color = '#4CAF50'; // Green for good scores
      else if (score >= 50) color = '#ff9800'; // Orange for medium scores
      
      healthCircle.style.background = `conic-gradient(from 0deg, ${color} 0% ${scorePercent}%, #e0e0e0 ${scorePercent}% 100%)`;
    }
  }
  
  if (healthBreakdown) {
    let status = 'Poor';
    let statusColor = '#f44336';
    
    if (score >= 80) {
      status = 'Excellent';
      statusColor = '#4CAF50';
    } else if (score >= 60) {
      status = 'Good';
      statusColor = '#8BC34A';
    } else if (score >= 40) {
      status = 'Fair';
      statusColor = '#ff9800';
    }
    
    healthBreakdown.innerHTML = `
      <div style="color: ${statusColor}; font-weight: 600; margin-bottom: 10px;">
        Status: ${status}
      </div>
      <div style="font-size: 11px; color: #666;">
        Health score is calculated based on response times, error rates, and overall session performance.
      </div>
    `;
  }
}

function displayRecommendations(recommendations) {
  const recommendationsContent = document.getElementById('ai-recommendations-content');
  if (!recommendationsContent) return;
  
  if (recommendations.length === 0) {
    recommendationsContent.innerHTML = `
      <div class="recommendations-list">
        <div class="ai-placeholder">
          <span class="ai-placeholder-icon">🎉</span>
          <p>Great job! No specific recommendations at this time.</p>
        </div>
      </div>
    `;
    return;
  }
  
  const html = recommendations.map(rec => `
    <div class="recommendation-item">
      <div class="recommendation-title">${rec.title}</div>
      <p class="recommendation-text">${rec.description}</p>
    </div>
  `).join('');
  
  recommendationsContent.innerHTML = `<div class="recommendations-list">${html}</div>`;
}

function displayPerformanceAnalysis(analysis) {
  const optimizationTips = document.getElementById('optimization-tips');
  if (!optimizationTips) return;
  
  const tips = [];
  
  if (analysis.avgResponseTime > 1000) {
    tips.push('Consider implementing caching to reduce response times');
  }
  
  if (analysis.slowRequests.length > 0) {
    tips.push('Optimize slow endpoints identified in the analysis');
  }
  
  if (analysis.errors.length > 0) {
    tips.push('Review and fix error-prone requests');
  }
  
  if (analysis.totalRequests > 50) {
    tips.push('Consider request batching to reduce network calls');
  }
  
  if (tips.length === 0) {
    optimizationTips.innerHTML = '<div class="analytics-placeholder">Performance looks good! 🚀</div>';
    return;
  }
  
  const html = tips.map(tip => `<div style="padding: 4px 0; font-size: 11px;">• ${tip}</div>`).join('');
  optimizationTips.innerHTML = html;
}

function displayIssueDetection(analysis) {
  const issues = [];
  
  if (analysis.errors.length > 0) {
    issues.push(`Found ${analysis.errors.length} error(s) in the session`);
  }
  
  if (analysis.slowRequests.length > 0) {
    issues.push(`Detected ${analysis.slowRequests.length} slow request(s)`);
  }
  
  if (analysis.successRate < 90) {
    issues.push(`Low success rate: ${analysis.successRate}%`);
  }
  
  if (issues.length === 0) {
    alert('✅ No critical issues detected in the current session!');
  } else {
    alert('⚠️ Issues detected:\n\n' + issues.map(issue => `• ${issue}`).join('\n'));
  }
}

function calculatePerformanceScore(analysis) {
  let score = 100;
  
  // Deduct points for slow average response time
  if (analysis.avgResponseTime > 2000) score -= 30;
  else if (analysis.avgResponseTime > 1000) score -= 15;
  else if (analysis.avgResponseTime > 500) score -= 5;
  
  // Deduct points for errors
  if (analysis.errors.length > 0) {
    score -= Math.min(analysis.errors.length * 10, 40);
  }
  
  // Deduct points for low success rate
  if (analysis.successRate < 100) {
    score -= (100 - analysis.successRate) / 2;
  }
  
  // Deduct points for slow requests
  if (analysis.slowRequests.length > 0) {
    score -= Math.min(analysis.slowRequests.length * 5, 20);
  }
  
  return Math.max(0, Math.round(score));
}

function generateInsights(analysis) {
  const insights = [];
  
  // Session context insights
  if (analysis.sessionId !== 'Unknown') {
    insights.push(`🔍 Analyzing session ${analysis.sessionId} for domain: ${analysis.activeDomain}`);
  }
  
  if (analysis.avgResponseTime < 500) {
    insights.push('Excellent response times - your application is performing very well!');
  } else if (analysis.avgResponseTime > 2000) {
    insights.push('Response times are slower than optimal - consider performance optimization.');
  }
  
  if (analysis.successRate === 100) {
    insights.push('Perfect success rate - no errors detected in this session.');
  } else if (analysis.successRate < 90) {
    insights.push('Lower than expected success rate - investigate error patterns.');
  }
  
  if (analysis.slowRequests.length === 0) {
    insights.push('No slow requests detected - great job on optimization!');
  } else {
    insights.push(`🐌 Found ${analysis.slowRequests.length} slow requests in this session`);
  }
  
  if (analysis.errors.length > 0) {
    insights.push(`❌ ${analysis.errors.length} errors detected in current session`);
  }
  
  if (analysis.totalRequests > 100) {
    insights.push('High request volume detected - monitor for potential performance impact.');
  } else if (analysis.totalRequests === 0) {
    insights.push('ℹ️ No network requests captured in this session yet');
  }
  
  // Session duration insights
  if (analysis.sessionStart && analysis.sessionEnd) {
    const sessionDurationMs = analysis.sessionEnd - analysis.sessionStart;
    if (sessionDurationMs > 1800000) { // 30 minutes
      insights.push('⏰ Long session duration - consider performance monitoring');
    }
  }
  
  if (insights.length === 1 && insights[0].includes('🔍 Analyzing session')) {
    insights.push('Session analysis completed - review the detailed metrics below.');
  } else if (insights.length === 0) {
    insights.push('Session analysis completed - review the detailed metrics below.');
  }
  
  analysis.insights = insights;
}

function generateRecommendations(analysis) {
  const recommendations = [];
  
  // Session-specific recommendations
  if (analysis.sessionId !== 'Unknown' && analysis.activeDomain !== 'Unknown') {
    recommendations.push({
      title: '🔍 Session Focus',
      description: `Currently analyzing session ${analysis.sessionId} for domain: ${analysis.activeDomain}. Use this focused view to troubleshoot specific issues.`
    });
  }
  
  if (analysis.avgResponseTime > 1000) {
    recommendations.push({
      title: '🚀 Optimize Response Times',
      description: 'Consider implementing caching, database query optimization, or CDN usage to improve response times.'
    });
  }
  
  if (analysis.errors.length > 0) {
    recommendations.push({
      title: '🛠️ Fix Error Responses',
      description: `Review the ${analysis.errors.length} error responses in this session and implement proper error handling and validation.`
    });
  }
  
  if (analysis.slowRequests.length > 0) {
    recommendations.push({
      title: '⚡ Address Slow Endpoints',
      description: `Focus on optimizing the ${analysis.slowRequests.length} slowest endpoints in this session to improve user experience.`
    });
  }
  
  if (analysis.totalRequests > 50) {
    recommendations.push({
      title: '📦 Consider Request Batching',
      description: 'Implement request batching or pagination to reduce the number of network calls.'
    });
  }
  
  if (analysis.totalRequests === 0) {
    recommendations.push({
      title: '🎯 Start Monitoring',
      description: 'Navigate to your application and perform actions to capture network requests for analysis.'
    });
  }
  
  // Performance score based recommendations
  if (analysis.performanceScore < 60) {
    recommendations.push({
      title: '⚠️ Performance Improvement Needed',
      description: 'This session has performance issues. Focus on reducing response times and fixing errors.'
    });
  } else if (analysis.performanceScore >= 90) {
    recommendations.push({
      title: '✨ Excellent Performance',
      description: 'This session shows excellent performance. Consider documenting successful patterns for other areas.'
    });
  }
  
  analysis.recommendations = recommendations;
}

// Helper functions
function truncateUrl(url, maxLength = 80) {
  if (!url) return 'N/A';
  if (url.length <= maxLength) return url;
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const search = urlObj.search;
    
    // Show domain + meaningful part of path
    let meaningful = urlObj.hostname + pathname;
    if (search) {
      meaningful += search.substring(0, 20); // Show some query params
    }
    
    if (meaningful.length <= maxLength) return meaningful;
    
    // If still too long, truncate smartly
    if (pathname.includes('/')) {
      const pathParts = pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      meaningful = urlObj.hostname + '/.../' + lastPart;
      if (search) meaningful += search.substring(0, 15);
    }
    
    if (meaningful.length <= maxLength) return meaningful;
    return meaningful.substring(0, maxLength - 3) + '...';
  } catch (e) {
    // Fallback for invalid URLs
    return url.length <= maxLength ? url : url.substring(0, maxLength - 3) + '...';
  }
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)}s`;
  return `${Math.round(milliseconds / 60000)}m`;
}

// ========== LOG SUMMARIZATION FUNCTIONALITY ==========

// Token management with 8-hour caching
let authToken = null;

// Token cache configuration
const TOKEN_CACHE_KEY = 'alexandria_auth_token';
const TOKEN_EXPIRY_HOURS = 8;

// Save token to persistent storage with expiration
async function saveTokenToCache(token) {
  if (!token) return;
  
  const tokenData = {
    token: token,
    timestamp: Date.now(),
    expiresAt: Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000) // 8 hours from now
  };
  
  try {
    await chrome.storage.local.set({ [TOKEN_CACHE_KEY]: tokenData });
    console.log('[TOKEN_CACHE] Token saved to cache, expires at:', new Date(tokenData.expiresAt).toISOString());
  } catch (error) {
    console.warn('[TOKEN_CACHE] Failed to save token to cache:', error);
  }
}

// Load token from persistent storage and check if it's still valid
async function loadTokenFromCache() {
  try {
    const result = await chrome.storage.local.get([TOKEN_CACHE_KEY]);
    const tokenData = result[TOKEN_CACHE_KEY];
    
    if (!tokenData) {
      console.log('[TOKEN_CACHE] No cached token found');
      return null;
    }
    
    const now = Date.now();
    const timeLeft = tokenData.expiresAt - now;
    
    if (timeLeft <= 0) {
      console.log('[TOKEN_CACHE] Cached token has expired, removing from cache');
      await chrome.storage.local.remove([TOKEN_CACHE_KEY]);
      return null;
    }
    
    const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
    const minutesLeft = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
    
    console.log(`[TOKEN_CACHE] Found valid cached token, expires in ${hoursLeft}h ${minutesLeft}m`);
    console.log('[TOKEN_CACHE] Token preview:', tokenData.token.substring(0, 12) + '...' + tokenData.token.substring(tokenData.token.length - 8));
    
    return tokenData.token;
  } catch (error) {
    console.warn('[TOKEN_CACHE] Failed to load token from cache:', error);
    return null;
  }
}

// Clear token from cache
async function clearTokenFromCache() {
  try {
    await chrome.storage.local.remove([TOKEN_CACHE_KEY]);
    console.log('[TOKEN_CACHE] Token cleared from cache');
  } catch (error) {
    console.warn('[TOKEN_CACHE] Failed to clear token from cache:', error);
  }
}

// Check if we have a valid cached token and load it
async function initializeAuthToken() {
  if (authToken) {
    console.log('[TOKEN_CACHE] Token already loaded in memory');
    return authToken;
  }
  
  const cachedToken = await loadTokenFromCache();
  if (cachedToken) {
    authToken = cachedToken;
    console.log('[TOKEN_CACHE] Using cached token for authentication');
    return authToken;
  }
  
  console.log('[TOKEN_CACHE] No valid cached token available, user will need to authenticate');
  return null;
}

async function fetchAuthToken(username, password) {
  try {
    console.log('[AUTH] Fetching authentication token from Alexandria API...');
    console.log('[AUTH] Username:', username);
    
    const requestBody = {
      "name": username,
      "pass": password
    };
    
    console.log('[AUTH] Request body:', requestBody);
    
    const response = await fetch('https://alexandria.shs.aws.q2e.io/api/v3/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Pragma': 'no-cache',
        'Accept': '*/*',
        'Authorization': 'Bearer 00000000-0000-0000-0000-000000000000',
        'Cache-Control': 'no-cache',
        'Origin': 'https://alexandria.shs.aws.q2e.io',
        'Referer': 'https://alexandria.shs.aws.q2e.io/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('[AUTH] Response received');
    console.log('[AUTH] Response status:', response.status);
    console.log('[AUTH] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      let errorDetails = `Login failed! status: ${response.status}`;
      try {
        const errorBody = await response.text();
        console.log('[AUTH] Error response body:', errorBody);
        errorDetails += ` - ${errorBody}`;
      } catch (e) {
        console.log('[AUTH] Could not read error response body');
      }
      throw new Error(errorDetails);
    }

    const result = await response.json();
    console.log('[AUTH] Login response:', result);
    
    // For now, just return the entire response to see what we get
    return result;
    
  } catch (error) {
    console.error('[AUTH] Error fetching auth token:', error);
    
    // Enhanced error information
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error - CORS or connection issue. Check browser console for details.');
    } else if (error.name === 'AbortError') {
      throw new Error('Request timed out - server may be slow or unreachable.');
    } else {
      throw error;
    }
  }
}

async function summarizeLogsAPI(textQuery) {
  try {
    console.log('[API] Sending request to Alexandria API with text:', textQuery);
    console.log('[API] Text query length:', textQuery ? textQuery.length : 0);
    
    // Use Alexandria token for authentication
    if (!authToken) {
      throw new Error('No authentication token available. Please log in first.');
    }
    
    const tokenStr = authToken ? String(authToken) : null;
    
    // Validate the prompt length and content
    if (!textQuery || textQuery.trim().length === 0) {
      throw new Error('Empty prompt provided to Alexandria API');
    }
    
    // Log prompt size but don't truncate - send full logs for better analysis
    console.log(`[API] Sending prompt with ${textQuery.length} characters to Alexandria`);
    if (textQuery.length > 10000) {
      console.warn('[API] Large prompt detected but sending full content for better analysis');
    }
    
    // Use Alexandria AI summarize format - send prompt as JSON string
    const requestPayload = JSON.stringify(textQuery);
    
    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Pragma": "no-cache",
        "Accept": "*/*",
        "Authorization": `Bearer ${tokenStr}`,
        "Sec-Fetch-Site": "same-origin",
        "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Mode": "cors",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://alexandria.shs.aws.q2e.io",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
        "Referer": "https://alexandria.shs.aws.q2e.io/logs/search",
        "Sec-Fetch-Dest": "empty",
        "Priority": "u=3, i"
      },
      body: requestPayload
    };
    
    console.log('[API] Request options:', requestOptions);
    console.log('[API] Request payload size:', requestPayload.length);
    console.log('[API] Request payload content:', requestPayload);
    console.log('[API] Using Alexandria token:', tokenStr ? `${tokenStr.substring(0, 8)}...` : 'none');
    
    const response = await fetch("https://alexandria.shs.aws.q2e.io/api/v3/ai/summarize", requestOptions);

    console.log('[API] Response status:', response.status);
    console.log('[API] Response status text:', response.statusText);
    console.log('[API] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      let errorDetails = `HTTP error! status: ${response.status}`;
      
      // Handle specific error types
      if (response.status === 401) {
        errorDetails += ' - Authentication failed. The Alexandria token may be expired or invalid.';
      } else if (response.status === 403) {
        errorDetails += ' - Access forbidden. Check API permissions for Alexandria.';
      } else if (response.status === 404) {
        errorDetails += ' - API endpoint not found. Check the Alexandria URL.';
      } else if (response.status === 500) {
        errorDetails += ' - Internal server error. The Alexandria service may be experiencing issues.';
      } else if (response.status === 502 || response.status === 503) {
        errorDetails += ' - Service unavailable. Alexandria may be temporarily down.';
      } else if (response.status === 429) {
        errorDetails += ' - Rate limit exceeded. Too many requests to Alexandria API.';
      }
      
      try {
        const errorBody = await response.text();
        console.log('[API] Error response body:', errorBody);
        if (errorBody) {
          errorDetails += ` Response: ${errorBody}`;
        }
      } catch (e) {
        console.log('[API] Could not read error response body');
      }
      
      throw new Error(errorDetails);
    }

    // Get response as text first to see what we're getting
    const responseText = await response.text();
    console.log('[API] Raw response text:', responseText);
    console.log('[API] Response text length:', responseText.length);
    
    let result;
    try {
      // Try to parse as JSON
      result = JSON.parse(responseText);
      console.log('[API] Successfully parsed as JSON:', result);
    } catch (jsonError) {
      console.log('[API] Response is not JSON, treating as plain text');
      // If it's not JSON, treat it as plain text response
      result = {
        summary: responseText,
        response: responseText,
        isPlainText: true
      };
    }
    
    console.log('[API] Final processed result:', result);
    
    // Transform Alexandria response to match expected format
    if (result.isPlainText) {
      // Handle plain text response
      return {
        summary: `Alexandria AI Analysis:\n\n${result.summary}`,
        response: result.response,
        alexandriaResults: { analysisText: result.response }
      };
    } else {
      // Handle JSON response
      return {
        summary: `Alexandria AI Analysis:\n\n${result.summary || result.response || 'Analysis completed'}`,
        response: result,
        alexandriaResults: result
      };
    }
  } catch (error) {
    console.error('[API] Error while summarizing:', error);
    throw error;
  }
}

// Alexandria logs query function
async function queryAlexandriaLogs(token, query, refererUrl = null) {
  try {
    // ========== FUNCTION INPUT LOGGING ==========
    console.log('🎯 [ALEXANDRIA] ========== QUERY FUNCTION CALLED ==========');
    console.log('📅 [ALEXANDRIA] Timestamp:', new Date().toISOString());
    
    // Ensure token is a string
    const tokenStr = token ? String(token) : null;
    
    console.log('🔐 [ALEXANDRIA] Token Analysis:');
    console.log('   Token provided:', !!token);
    console.log('   Token type:', typeof token);
    if (tokenStr) {
      console.log('   Token length:', tokenStr.length, 'characters');
      console.log('   Token preview:', `${tokenStr.substring(0, 12)}...${tokenStr.substring(tokenStr.length - 8)}`);
      console.log('   Token starts with:', tokenStr.substring(0, 5));
    } else {
      console.log('   Token: null/undefined');
    }
    
    console.log('🔍 [ALEXANDRIA] Query Analysis:');
    console.log('   Query provided:', !!query);
    console.log('   Query type:', typeof query);
    console.log('   Query length:', query ? query.length : 0, 'characters');
    console.log('   Query content:', query);
    
    console.log('🌐 [ALEXANDRIA] Referer Analysis:');
    console.log('   Referer URL provided:', !!refererUrl);
    console.log('   Referer URL:', refererUrl);
    
    if (!tokenStr) {
      console.log('❌ [ALEXANDRIA] ERROR: No valid authentication token available');
      throw new Error('No valid authentication token available');
    }
    
    // Build referer from the current session URLs if available
    let referer = 'https://alexandria.shs.aws.q2e.io/logs/search';
    if (refererUrl) {
      referer = refererUrl;
    } else {
      // Use current query URLs as referer base
      const currentUrls = getCurrentSessionUrls();
      if (currentUrls.length > 0) {
        // Create a search query URL with the current session context
        const encodedQuery = encodeURIComponent(query);
        referer = `https://alexandria.shs.aws.q2e.io/logs/search?query=${encodedQuery}`;
      }
    }
    
    const requestPayload = {
      "query": query,
      "isRetry": false,
      "isDownload": false,
      "isLegacyFormat": false,
      "queryLanguage": "Splunk SPL",
      "dataSource": "SentinelOne"
    };
    
    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Pragma": "no-cache",
        "Accept": "*/*",
        "Authorization": `Bearer ${tokenStr}`,
        "Sec-Fetch-Site": "same-origin",
        "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Mode": "cors",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://alexandria.shs.aws.q2e.io",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
        "Referer": referer,
        "Sec-Fetch-Dest": "empty",
        "Priority": "u=3, i"
      },
      body: JSON.stringify(requestPayload)
    };
    
    // ========== DETAILED ALEXANDRIA REQUEST LOGGING ==========
    console.log('🚀 [ALEXANDRIA] ========== SENDING REQUEST ==========');
    console.log('📍 [ALEXANDRIA] Endpoint:', 'https://alexandria.shs.aws.q2e.io/api/v3/logs/query');
    console.log('📋 [ALEXANDRIA] Request Method:', 'POST');
    console.log('🔑 [ALEXANDRIA] Authorization token length:', tokenStr.length, 'characters');
    console.log('🔗 [ALEXANDRIA] Referer:', referer);
    
    console.log('📦 [ALEXANDRIA] Request Headers:');
    Object.entries(requestOptions.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'authorization') {
        console.log(`   ${key}: Bearer ${value.substring(7, 20)}...${value.substring(value.length - 10)} (${value.length - 7} chars)`);
      } else {
        console.log(`   ${key}: ${value}`);
      }
    });
    
    console.log('📄 [ALEXANDRIA] Request Payload Object:');
    console.log('   searchId:', requestPayload.searchId || '(empty)');
    console.log('   query:', requestPayload.query);
    console.log('   timeArgs:', requestPayload.timeArgs);
    console.log('   isRetry:', requestPayload.isRetry);
    console.log('   isDownload:', requestPayload.isDownload);
    console.log('   isLegacyFormat:', requestPayload.isLegacyFormat);
    console.log('   maxCount:', requestPayload.maxCount);
    console.log('   queryLanguage:', requestPayload.queryLanguage);
    console.log('   dataSource:', requestPayload.dataSource);
    
    console.log('🔍 [ALEXANDRIA] Query Details:');
    console.log('   Query length:', requestPayload.query.length, 'characters');
    console.log('   Query content:', requestPayload.query);
    
    const requestBodyString = JSON.stringify(requestPayload);
    console.log('📊 [ALEXANDRIA] Request Body Stats:');
    console.log('   Body size:', requestBodyString.length, 'characters');
    console.log('   Body size:', new Blob([requestBodyString]).size, 'bytes');
    
    console.log('💾 [ALEXANDRIA] Full Request Payload (JSON):');
    console.log(JSON.stringify(requestPayload, null, 2));
    
    console.log('⚡ [ALEXANDRIA] PowerShell Equivalent:');
    console.log(`$Headers = @{
    'Content-Type' = 'application/json; charset=utf-8'
    'Authorization' = 'Bearer ${tokenStr.substring(0, 20)}...'
}
$Body = '${JSON.stringify(requestPayload, null, 2)}'
$Response = Invoke-RestMethod -Uri 'https://alexandria.shs.aws.q2e.io/api/v3/logs/query' -Method POST -Headers $Headers -Body $Body`);
    
    console.log('🌐 [ALEXANDRIA] Making fetch request now...');
    
    const response = await fetch("https://alexandria.shs.aws.q2e.io/api/v3/logs/query", requestOptions);
    
    // ========== DETAILED ALEXANDRIA RESPONSE LOGGING ==========
    console.log('📥 [ALEXANDRIA] ========== RESPONSE RECEIVED ==========');
    console.log('📊 [ALEXANDRIA] Response Status:', response.status, response.statusText);
    console.log('🕒 [ALEXANDRIA] Response received at:', new Date().toISOString());
    
    console.log('📋 [ALEXANDRIA] Response Headers:');
    const responseHeaders = Object.fromEntries(response.headers.entries());
    Object.entries(responseHeaders).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
    
    console.log('💡 [ALEXANDRIA] Response Info:');
    console.log('   Type:', response.type);
    console.log('   URL:', response.url);
    console.log('   Redirected:', response.redirected);
    console.log('   Ok:', response.ok);
    console.log('   Status:', response.status);
    console.log('   Status Text:', response.statusText);
    
    if (responseHeaders['content-length']) {
      console.log('   Content Length:', responseHeaders['content-length'], 'bytes');
    }
    if (responseHeaders['content-type']) {
      console.log('   Content Type:', responseHeaders['content-type']);
    }
    
    if (!response.ok) {
      console.log('❌ [ALEXANDRIA] ========== ERROR RESPONSE ==========');
      let errorDetails = `HTTP error! status: ${response.status}`;
      
      if (response.status === 401) {
        errorDetails += ' - Authentication failed. The token may be expired or invalid.';
        console.log('🔑 [ALEXANDRIA] Authentication Error: Token may be expired or invalid');
        console.log('🔑 [ALEXANDRIA] Token preview:', tokenStr.substring(0, 20) + '...' + tokenStr.substring(tokenStr.length - 10));
      } else if (response.status === 403) {
        errorDetails += ' - Access forbidden. Check API permissions.';
        console.log('🚫 [ALEXANDRIA] Access Forbidden: Check API permissions for this user/token');
      } else if (response.status === 404) {
        errorDetails += ' - API endpoint not found.';
        console.log('🔍 [ALEXANDRIA] Endpoint Not Found: API path may be incorrect');
      } else if (response.status === 400) {
        console.log('📝 [ALEXANDRIA] Bad Request: Request payload may be invalid');
      } else if (response.status >= 500) {
        console.log('🔥 [ALEXANDRIA] Server Error: Alexandria service may be down');
      }
      
      try {
        const errorBody = await response.text();
        console.log('📄 [ALEXANDRIA] Error Response Body Length:', errorBody.length, 'characters');
        console.log('📄 [ALEXANDRIA] Error Response Body:', errorBody);
        
        // Try to parse error as JSON for better formatting
        try {
          const errorJson = JSON.parse(errorBody);
          console.log('📄 [ALEXANDRIA] Parsed Error JSON:', JSON.stringify(errorJson, null, 2));
        } catch (e) {
          console.log('📄 [ALEXANDRIA] Error body is not valid JSON, showing as text');
        }
        
        if (errorBody) {
          errorDetails += ` Response: ${errorBody}`;
        }
      } catch (e) {
        console.log('⚠️  [ALEXANDRIA] Could not read error response body:', e.message);
      }
      
      console.log('❌ [ALEXANDRIA] Throwing error:', errorDetails);
      throw new Error(errorDetails);
    }
    
    // ========== SUCCESS RESPONSE PROCESSING ==========
    console.log('✅ [ALEXANDRIA] ========== SUCCESS RESPONSE ==========');
    console.log('📥 [ALEXANDRIA] Reading response body as JSON...');
    
    const result = await response.json();
    
    console.log('📊 [ALEXANDRIA] Response Data Stats:');
    console.log('   Result type:', typeof result);
    console.log('   Result is array:', Array.isArray(result));
    
    if (result && typeof result === 'object') {
      console.log('   Object keys:', Object.keys(result));
      
      if (result.Data && Array.isArray(result.Data)) {
        console.log('   Data array length:', result.Data.length);
        console.log('   First few results:', result.Data.slice(0, 3));
      }
      
      if (result.summary) {
        console.log('   Summary:', result.summary);
      }
      
      if (result.status) {
        console.log('   API Status:', result.status);
      }
    }
    
    console.log('📄 [ALEXANDRIA] Full Success Response:');
    console.log(JSON.stringify(result, null, 2));
    console.log('✅ [ALEXANDRIA] ========== END SUCCESS RESPONSE ==========');
    
    return result;
    
  } catch (error) {
    console.error('[ALEXANDRIA] Error while querying logs:', error);
    throw error;
  }
}

// Helper function to get current session data (used by Alexandria integration)
function getSessionData() {
  return currentSessionData || { requests: [], sessionId: null };
}

// Helper function to get current session URLs for referer
function getCurrentSessionUrls() {
  try {
    const sessionData = getSessionData();
    const allRequests = sessionData.requests || [];
    return allRequests.map(req => req.url).filter(url => url);
  } catch (error) {
    console.warn('[ALEXANDRIA] Could not get current session URLs:', error);
    return [];
  }
}

// Helper function to extract query from existing Alexandria URLs
function extractQueryFromSession() {
  const sessionData = getSessionData();
  if (!sessionData) {
    console.warn('[ALEXANDRIA] No session data available');
    return null;
  }

  // Get the workstation ID from session
  const workstationId = sessionData.workstationId || 'N/A';
  const sessionId = sessionData.sessionId;
  const startTime = formatDateTime(sessionData.startTime);
  const endTime = formatDateTime(sessionData.endTime);

  // Determine environment from session requests (same logic as displaySessionSummary)
  const isStaging = sessionData.requests?.some(r => r.url.includes('temporary')) || false;
  
  // Build the same queries as the session summary, but also add fallback queries with broader time ranges
  const hqIndex = isStaging ? 'app_logs_stage_hq' : 'app_logs_prod_hq';
  const lbIndex = isStaging ? 'app_logs_stage_lightbridge' : 'app_logs_prod_lightbridge';
  const kaminoIndex = isStaging ? 'app_logs_stage_kamino' : 'app_logs_prod_kamino';
  const ardentIndex = isStaging ? 'app_logs_stage_ardent' : 'app_logs_prod_ardent';

  // Also check for dev environment like your curl example
  const hqDevIndex = 'app_logs_dev_hq';
  const lbDevIndex = 'app_logs_dev_lightbridge';
  const kaminoDevIndex = 'app_logs_dev_kamino';
  const ardentDevIndex = 'app_logs_dev_ardent';

  // Use the exact working query from your PowerShell example
  const workingQuery = `search index="app_logs_prod_hq" sessionId="4rvupzfaaq5rn2ix3wm2imjo" earliest="-8h" | fields * | extract | sort timestamp, seqId | head 10000`;
  
  const queries = {
    // Primary working query - exact copy of your PowerShell example
    working: workingQuery,
    
    // Simple fallbacks in case the sessionId changes
    prod_simple: `search index="app_logs_prod_hq" earliest="-8h" | fields * | extract | sort timestamp, seqId | head 1000`,
    prod_any: `search index="app_logs_prod_hq" | head 100`
  };

  console.log('[ALEXANDRIA] Generated queries from session:', {
    sessionId,
    workstationId,
    isStaging,
    environment: isStaging ? 'staging' : 'production',
    timeRange: `${startTime} to ${endTime}`,
    queries
  });

  // Debug: Log the exact queries that will be tried
  console.log('[ALEXANDRIA] Query details:');
  Object.entries(queries).forEach(([key, query]) => {
    console.log(`[ALEXANDRIA] ${key}: ${query}`);
  });

  return queries;
}

function summarizeLogs() {
  console.log('[popup.js] Starting comprehensive log summarization for all environments...');
  
  const logSummariesContent = document.getElementById('log-summaries-content');
  if (!logSummariesContent) return;
  
  // Check if we have a token
  if (!authToken) {
    logSummariesContent.innerHTML = `
      <div class="log-summary-error" style="padding: 20px;">
        <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">🔐 Authentication Required</div>
        <div style="margin-bottom: 15px;">
          Please login first to get an authentication token for the Alexandria API.
        </div>
        <div style="margin-bottom: 15px;">
          <strong>Steps:</strong>
          <ol style="margin: 8px 0; padding-left: 20px;">
            <li>Scroll up to the Authentication section</li>
            <li>Enter your Alexandria username and password</li>
            <li>Click "Login & Get Token"</li>
            <li>Return here and try again</li>
          </ol>
        </div>
        <button onclick="document.getElementById('auth-username').focus()" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
          📝 Go to Login Form
        </button>
      </div>
    `;
    return;
  }

  // Check if we have stored search strings from session summary
  if (!window.environmentSearchStrings) {
    logSummariesContent.innerHTML = `
      <div class="log-summary-error" style="padding: 20px;">
        <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">📋 Session Data Required</div>
        <div style="margin-bottom: 15px;">
          No session data available for dynamic queries. Please ensure you have captured some network requests first.
        </div>
        <div style="margin-bottom: 15px;">
          <strong>Steps:</strong>
          <ol style="margin: 8px 0; padding-left: 20px;">
            <li>Go to the Network Logs tab</li>
            <li>Capture some network activity from your session</li>
            <li>Come back and try again</li>
          </ol>
        </div>
        <button onclick="switchToTab('network')" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
          📊 Go to Network Logs
        </button>
      </div>
    `;
    return;
  }
  
  // Show initial loading state
  logSummariesContent.innerHTML = `
    <div style="padding: 20px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #007acc;">
        🔍 Comprehensive Log Analysis
      </div>
      <div style="margin-bottom: 20px; font-size: 14px; color: #666;">
        Querying Alexandria logs for all environments using dynamic session data...
      </div>
      <div class="ai-loading">
        <div class="loading-spinner"></div>
        Initializing multi-environment analysis...
      </div>
    </div>
  `;
  
  // Start comprehensive analysis for all environments
  proceedWithComprehensiveLogAnalysis().catch(error => {
    console.error('[popup.js] Comprehensive log analysis failed:', error);
    
    let errorMessage = 'Unable to complete comprehensive log analysis.';
    let troubleshooting = [];
    
    if (error.message.includes('401')) {
      errorMessage = 'Authentication failed - your token may have expired.';
      troubleshooting = [
        'Try logging in again to refresh your token',
        'Check if your Alexandria account has proper permissions',
        'Verify the token format is correct'
      ];
    } else if (error.message.includes('403')) {
      errorMessage = 'Access denied - insufficient permissions.';
      troubleshooting = [
        'Check if your account has log query permissions',
        'Contact your administrator for access',
        'Verify you\'re querying the correct data source'
      ];
    } else if (error.message.includes('404')) {
      errorMessage = 'Alexandria logs API endpoint not found.';
      troubleshooting = [
        'Check if the Alexandria server is accessible',
        'Verify the API endpoint URL is correct',
        'Contact support if the service is down'
      ];
    } else if (error.message.includes('CORS') || error.message.includes('Network')) {
      errorMessage = 'Network connectivity issue with Alexandria.';
      troubleshooting = [
        'Check your internet connection',
        'Try from a different network',
        'Contact IT support if behind corporate firewall'
      ];
    } else {
      troubleshooting = [
        'Check browser console for detailed errors',
        'Try refreshing the page and logging in again',
        'Contact support if the issue persists'
      ];
    }
    
    const technicalInfo = error.stack || error.toString();
    
    logSummariesContent.innerHTML = `
      <div class="log-summary-error" style="padding: 20px;">
        <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">❌ ${errorMessage}</div>
        <div style="margin-bottom: 15px;">
          <strong>What you can try:</strong>
          <ul style="margin: 8px 0; padding-left: 20px;">
            ${troubleshooting.map(tip => `<li>${tip}</li>`).join('')}
          </ul>
        </div>
        <div style="margin-bottom: 15px;">
          <button onclick="summarizeLogs()" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">
            🔄 Try Again
          </button>
          <button onclick="resetAuth()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
            🔑 Login Again
          </button>
        </div>
        <details style="margin-top: 15px;">
          <summary style="cursor: pointer; font-size: 12px; color: #666;">Show technical details</summary>
          <div style="margin-top: 10px; font-family: monospace; background: #f1f1f1; padding: 10px; border-radius: 4px; font-size: 11px; white-space: pre-wrap;">
${technicalInfo}
          </div>
        </details>
      </div>
    `;
  });
}

// New comprehensive analysis function for all environments
async function proceedWithComprehensiveLogAnalysis() {
  console.log('[COMPREHENSIVE] Starting analysis for all environments');
  
  const environments = ['HQ', 'Kamino', 'LightBridge', 'Ardent'];
  const results = {};
  const logSummariesContent = document.getElementById('log-summaries-content');
  
  // Initialize the results container
  logSummariesContent.innerHTML = `
    <div style="padding: 20px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #28a745;">
        🔍 Comprehensive Log Analysis - All Environments
      </div>
      <div style="margin-bottom: 20px; font-size: 14px; color: #666;">
        Analyzing logs across HQ, Kamino, LightBridge, and Ardent environments...
      </div>
      
      <div id="environment-results">
        ${environments.map(env => `
          <div id="result-${env.toLowerCase()}" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
            <div style="font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 14px;">🔄 ${env} Environment</span>
              <div class="loading-spinner" style="width: 16px; height: 16px;"></div>
            </div>
            <div style="font-size: 12px; color: #666;">Querying Alexandria logs...</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  // Process each environment sequentially to avoid overwhelming the API
  for (const environment of environments) {
    try {
      console.log(`[COMPREHENSIVE] Processing ${environment} environment`);
      
      // Update status for current environment
      const envResult = document.getElementById(`result-${environment.toLowerCase()}`);
      if (envResult) {
        envResult.innerHTML = `
          <div style="font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 14px;">⚡ ${environment} Environment</span>
            <div class="loading-spinner" style="width: 16px; height: 16px;"></div>
          </div>
          <div style="font-size: 12px; color: #666;">Analyzing logs with Alexandria AI...</div>
        `;
      }
      
      // Get environment-specific analysis
      const envData = await analyzeEnvironmentLogs(environment);
      results[environment] = envData;
      
      // Update with results
      displayEnvironmentResult(environment, envData);
      
    } catch (error) {
      console.error(`[COMPREHENSIVE] Error analyzing ${environment}:`, error);
      results[environment] = { error: error.message };
      displayEnvironmentResult(environment, { error: error.message });
    }
  }
  
  // Add final summary and actions
  addComprehensiveSummary(results);
}

// Function to analyze logs for a specific environment
async function analyzeEnvironmentLogs(environment) {
  const envData = window.environmentSearchStrings;
  const environmentKeyMap = {
    'HQ': 'hq',
    'Kamino': 'kamino',
    'LightBridge': 'lightbridge',
    'Ardent': 'ardent'
  };
  
  const envKey = environmentKeyMap[environment];
  if (!envKey || !envData.searchStrings[envKey]) {
    throw new Error(`No search configuration found for ${environment} environment`);
  }
  
  const timeFilter = window.customTimeFilter || '-8h';
  let searchString = envData.searchStrings[envKey];
  
  // Apply custom time filter if set
  if (window.customTimeFilter && window.customTimeFilter !== '-8h') {
    if (envKey === 'hq' || envKey === 'kamino') {
      const timeFilter = calculateTimeFromFilter(window.customTimeFilter);
      searchString = searchString.replace(/-8h/g, window.customTimeFilter);
    } else {
      searchString = searchString.replace(/last 8 hours/gi, `last ${window.customTimeFilter.replace('-', '').replace('h', ' hours').replace('m', ' minutes').replace('d', ' days')}`);
    }
  }
  
  console.log(`[ENV_ANALYSIS] Querying ${environment} with: ${searchString}`);
  
  // Query Alexandria logs
  const logResults = await queryAlexandriaLogs(authToken, searchString);
  
  if (!logResults || !logResults.Data || logResults.Data.length === 0) {
    return {
      environment,
      logCount: 0,
      searchString,
      analysis: `No logs found for ${environment} environment in the specified time range.`,
      logs: []
    };
  }
  
  // Prepare data for AI analysis
  const selectedLogs = selectLogsForAnalysis(logResults.Data);
  let logSummary = `Found ${logResults.Data.length} log entries from ${environment} environment. Selected ${selectedLogs.length} key logs for analysis:\n\n`;
  
  // Format logs for AI analysis (same as existing logic)
  const logsBySource = {
    first: selectedLogs.filter(log => log.source === 'first'),
    last: selectedLogs.filter(log => log.source === 'last'),
    error: selectedLogs.filter(log => log.source === 'error'),
    context: selectedLogs.filter(log => log.source === 'context')
  };
  
  // Build formatted log summary
  if (logsBySource.first.length > 0) {
    logSummary += `=== FIRST ${logsBySource.first.length} LOGS (Session Start) ===\n`;
    logsBySource.first.forEach((log, index) => {
      logSummary += `Log ${index + 1}:\nTimestamp: ${log.timestamp || 'N/A'}\nLevel: ${log.level || log.logLevel || 'N/A'}\nMessage: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n---\n`;
    });
    logSummary += `\n`;
  }
  
  if (logsBySource.error.length > 0) {
    logSummary += `=== ERROR LOGS (${logsBySource.error.length} found) ===\n`;
    logsBySource.error.forEach((log, index) => {
      logSummary += `Error ${index + 1}:\nTimestamp: ${log.timestamp || 'N/A'}\nLevel: ${log.level || log.logLevel || 'ERROR'}\nMessage: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n---\n`;
    });
    logSummary += `\n`;
  }
  
  if (logsBySource.context.length > 0) {
    logSummary += `=== CONTEXT LOGS (${logsBySource.context.length} request/response logs around errors) ===\n`;
    logsBySource.context.forEach((log, index) => {
      logSummary += `Context ${index + 1}:\nTimestamp: ${log.timestamp || 'N/A'}\nLevel: ${log.level || log.logLevel || 'N/A'}\nMessage: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n---\n`;
    });
    logSummary += `\n`;
  }
  
  if (logsBySource.last.length > 0) {
    logSummary += `=== LAST ${logsBySource.last.length} LOGS (Recent Activity) ===\n`;
    logsBySource.last.forEach((log, index) => {
      logSummary += `Recent ${index + 1}:\nTimestamp: ${log.timestamp || 'N/A'}\nLevel: ${log.level || log.logLevel || 'N/A'}\nMessage: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n---\n`;
    });
  }
  
  // Send to Alexandria AI for analysis
  const summaryPrompt = `Analyze these ${environment} environment log entries and provide insights:

${logSummary}

Focus on:
1. Any errors or issues found
2. Performance patterns
3. Key events or transactions
4. Recommendations for optimization
5. Environment-specific insights`;

  const alexandriaAnalysis = await summarizeLogsAPI(summaryPrompt);
  
  return {
    environment,
    logCount: logResults.Data.length,
    selectedLogCount: selectedLogs.length,
    searchString,
    analysis: alexandriaAnalysis?.summary || alexandriaAnalysis?.response || 'Analysis completed',
    rawData: logResults,
    timestamp: new Date().toISOString()
  };
}

// Function to display results for a specific environment
function displayEnvironmentResult(environment, envData) {
  const envResult = document.getElementById(`result-${environment.toLowerCase()}`);
  if (!envResult) return;
  
  const envKey = environment.toLowerCase();
  
  if (envData.error) {
    envResult.innerHTML = `
      <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 15px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #721c24;">
          ❌ ${environment} Environment - Analysis Failed
        </div>
        <div style="margin-bottom: 10px; font-size: 13px;">
          <strong>Error:</strong> ${envData.error}
        </div>
        <button onclick="window.summarizeEnvironmentLogs('${environment}')" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          🔄 Retry ${environment}
        </button>
      </div>
    `;
    return;
  }
  
  envResult.innerHTML = `
    <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 6px; padding: 15px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div style="font-weight: 600; color: #155724; font-size: 14px;">
          ✅ ${environment} Environment Analysis
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="download-${envKey}-logs" style="padding: 4px 8px; background: #17a2b8; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
            📥 Download
          </button>
          <button onclick="window.toggleEnvironmentDetails('${envKey}')" style="padding: 4px 8px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
            📋 Details
          </button>
        </div>
      </div>
      
      <div style="margin-bottom: 10px; font-size: 12px; color: #155724;">
        <strong>Found:</strong> ${envData.logCount?.toLocaleString() || 0} total logs • 
        <strong>Analyzed:</strong> ${envData.selectedLogCount || 0} key logs • 
        <strong>Generated:</strong> ${new Date(envData.timestamp).toLocaleTimeString()}
      </div>
      
      <div id="summary-${envKey}" class="environment-summary" style="cursor: pointer; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #28a745;" onclick="window.toggleEnvironmentSummary('${envKey}')">
        <div style="font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>🔍 AI Analysis Summary</span>
          <span id="toggle-${envKey}" style="font-size: 12px;">▼ Click to expand</span>
        </div>
        <div id="analysis-${envKey}" style="display: none; white-space: pre-wrap; line-height: 1.4; font-size: 12px; margin-top: 10px; color: #495057;">
${envData.analysis}
        </div>
      </div>
    </div>
  `;
  
  // Store environment data globally for download
  window[`${envKey}EnvironmentData`] = envData;
  
  // Add event listeners with a slight delay to ensure DOM is ready
  setTimeout(() => {
    // Add download event listener
    const downloadBtn = document.getElementById(`download-${envKey}-logs`);
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => window.downloadEnvironmentLogs(environment, envData));
      console.log(`[EVENT] Added download listener for ${envKey}`);
    }
    
    // Add toggle event listener for the summary section
    const summaryDiv = document.getElementById(`summary-${envKey}`);
    if (summaryDiv) {
      summaryDiv.addEventListener('click', () => {
        console.log(`[EVENT] Summary div clicked for ${envKey}`);
        window.toggleEnvironmentSummary(envKey);
      });
      console.log(`[EVENT] Added toggle listener for ${envKey}`);
    }
    
    // Add event listener for details button
    const detailsBtn = document.querySelector(`button[onclick*="toggleEnvironmentDetails('${envKey}')"]`);
    if (detailsBtn) {
      detailsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[EVENT] Details button clicked for ${envKey}`);
        window.toggleEnvironmentDetails(envKey);
      });
      console.log(`[EVENT] Added details listener for ${envKey}`);
    }
  }, 100);
}

// Debug function to check if global functions are accessible
window.debugGlobalFunctions = function() {
  const functions = [
    'toggleEnvironmentSummary',
    'toggleEnvironmentDetails', 
    'downloadEnvironmentLogs',
    'copyEnvironmentQuery',
    'downloadAllEnvironmentLogs',
    'copyComprehensiveResults',
    'summarizeEnvironmentLogs'
  ];
  
  console.log('[DEBUG] Checking global function accessibility:');
  functions.forEach(funcName => {
    const exists = typeof window[funcName] === 'function';
    console.log(`[DEBUG] window.${funcName}: ${exists ? '✅ Available' : '❌ Missing'}`);
  });
  
  // Also check if comprehensive results exist
  console.log('[DEBUG] window.comprehensiveResults:', typeof window.comprehensiveResults, window.comprehensiveResults ? 'Available' : 'Missing');
  
  // Test the toggle function directly
  console.log('[DEBUG] Testing toggle function directly...');
  
  // Find any environment key that exists
  const allElements = document.querySelectorAll('[id*="analysis-"]');
  if (allElements.length > 0) {
    const firstElement = allElements[0];
    const envKey = firstElement.id.replace('analysis-', '');
    console.log('[DEBUG] Found environment key for testing:', envKey);
    console.log('[DEBUG] Calling toggleEnvironmentSummary with key:', envKey);
    window.toggleEnvironmentSummary(envKey);
  } else {
    console.log('[DEBUG] No analysis elements found - make sure you have run the comprehensive analysis first');
  }
  
  // Test download function
  console.log('[DEBUG] Testing download functions...');
  console.log('[DEBUG] Comprehensive results available:', !!window.comprehensiveResults);
  if (window.comprehensiveResults) {
    console.log('[DEBUG] Environments in results:', Object.keys(window.comprehensiveResults));
  }
  
  // Find download buttons
  const downloadAllBtn = document.querySelector('button[onclick="window.downloadAllEnvironmentLogs()"]');
  console.log('[DEBUG] Download All Logs button found:', !!downloadAllBtn);
  
  const copyAllBtn = document.querySelector('button[onclick="window.copyComprehensiveResults()"]');
  console.log('[DEBUG] Copy All Results button found:', !!copyAllBtn);
};

// Test function specifically for download functionality
window.testDownloadFunction = function() {
  console.log('[TEST] === TESTING DOWNLOAD ALL LOGS FUNCTION ===');
  
  // Check if the function exists
  if (typeof window.downloadAllEnvironmentLogs !== 'function') {
    console.error('[TEST] downloadAllEnvironmentLogs function not found!');
    return;
  }
  
  // Check if we have comprehensive results
  if (!window.comprehensiveResults) {
    console.error('[TEST] No comprehensive results available. Run analysis first.');
    return;
  }
  
  console.log('[TEST] Comprehensive results found:', Object.keys(window.comprehensiveResults));
  
  // Check what environments have successful results
  const successfulEnvs = Object.keys(window.comprehensiveResults).filter(env => !window.comprehensiveResults[env].error);
  console.log('[TEST] Successful environments:', successfulEnvs);
  
  if (successfulEnvs.length === 0) {
    console.error('[TEST] No successful environment results to download');
    return;
  }
  
  // Try calling the function
  console.log('[TEST] Calling downloadAllEnvironmentLogs...');
  try {
    window.downloadAllEnvironmentLogs();
    console.log('[TEST] Function called successfully');
  } catch (error) {
    console.error('[TEST] Error calling download function:', error);
  }
};

// Function to toggle environment summary visibility
window.toggleEnvironmentSummary = function(envKey) {
  console.log('[TOGGLE] === DEBUGGING TOGGLE FUNCTION ===');
  console.log('[TOGGLE] Toggling environment summary for envKey:', envKey);
  console.log('[TOGGLE] Looking for elements with IDs:');
  console.log('[TOGGLE] - analysis-' + envKey);
  console.log('[TOGGLE] - toggle-' + envKey);
  
  const analysisDiv = document.getElementById(`analysis-${envKey}`);
  const toggleSpan = document.getElementById(`toggle-${envKey}`);
  
  console.log('[TOGGLE] Found analysisDiv:', analysisDiv);
  console.log('[TOGGLE] Found toggleSpan:', toggleSpan);
  
  if (analysisDiv && toggleSpan) {
    console.log('[TOGGLE] Current display style:', analysisDiv.style.display);
    
    if (analysisDiv.style.display === 'none' || analysisDiv.style.display === '') {
      analysisDiv.style.display = 'block';
      toggleSpan.textContent = '▲ Click to collapse';
      console.log('[TOGGLE] Changed to: EXPANDED');
    } else {
      analysisDiv.style.display = 'none';
      toggleSpan.textContent = '▼ Click to expand';
      console.log('[TOGGLE] Changed to: COLLAPSED');
    }
  } else {
    console.error('[TOGGLE] Could not find elements for envKey:', envKey);
    console.error('[TOGGLE] Available elements with IDs containing "analysis":');
    
    // Debug: List all elements with IDs containing our search terms
    const allElements = document.querySelectorAll('[id*="analysis"]');
    allElements.forEach(el => console.log('[TOGGLE] Found element:', el.id, el));
    
    const allToggleElements = document.querySelectorAll('[id*="toggle"]');
    allToggleElements.forEach(el => console.log('[TOGGLE] Found toggle element:', el.id, el));
  }
};

// Function to toggle environment details (raw data)
window.toggleEnvironmentDetails = function(envKey) {
  console.log('[DETAILS] Toggling environment details for:', envKey);
  const envData = window[`${envKey}EnvironmentData`];
  if (!envData) {
    console.error('[DETAILS] No environment data found for:', envKey);
    return;
  }
  
  const existingDetails = document.getElementById(`details-${envKey}`);
  if (existingDetails) {
    existingDetails.remove();
    return;
  }
  
  const envResult = document.getElementById(`result-${envKey}`);
  if (!envResult) {
    console.error('[DETAILS] Could not find result container for:', envKey);
    return;
  }
  
  const detailsDiv = document.createElement('div');
  detailsDiv.id = `details-${envKey}`;
  detailsDiv.innerHTML = `
    <div style="margin-top: 15px; padding: 10px; background: #f1f1f1; border-radius: 4px; border: 1px solid #ddd;">
      <div style="font-weight: 600; margin-bottom: 10px; font-size: 12px;">🔧 Technical Details:</div>
      <div style="margin-bottom: 8px; font-size: 11px;">
        <strong>Search Query:</strong><br>
        <code style="font-size: 10px; word-break: break-all; background: #fff; padding: 4px; border-radius: 2px; display: block; margin-top: 4px;">${envData.searchString}</code>
      </div>
      <div style="margin-bottom: 8px; font-size: 11px;">
        <strong>Time Range:</strong> ${window.customTimeFilter || '-8h (default)'}
      </div>
      <div style="font-size: 11px;">
        <strong>Analysis ID:</strong> ${envData.timestamp}
      </div>
      <div style="margin-top: 10px;">
        <button onclick="window.copyEnvironmentQuery('${envKey}')" style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 10px;">
          📋 Copy Query
        </button>
        <button onclick="document.getElementById('details-${envKey}').remove()" style="padding: 4px 8px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 10px; margin-left: 8px;">
          ✖ Close
        </button>
      </div>
    </div>
  `;
  
  envResult.appendChild(detailsDiv);
};

// Function to download logs for a specific environment
window.downloadEnvironmentLogs = function(environment, envData) {
  console.log('[DOWNLOAD_ENV] Downloading logs for environment:', environment);
  if (!envData || !envData.rawData) {
    console.error('[DOWNLOAD_ENV] No raw data available for:', environment);
    alert(`No log data available for ${environment} environment.`);
    return;
  }
  
  const logEntries = envData.rawData.Data || [];
  if (logEntries.length === 0) {
    alert(`No log entries found for ${environment} environment.`);
    return;
  }
  
  try {
    // Convert to .log format
    let logContent = `# ${environment} Environment Log Export\n`;
    logContent += `# Export Date: ${new Date().toISOString()}\n`;
    logContent += `# Total Entries: ${logEntries.length}\n`;
    logContent += `# Analysis Timestamp: ${envData.timestamp}\n`;
    logContent += `# Source: EasyLogs Extension v3.0.0\n`;
    logContent += `#\n`;
    
    // Process each log entry
    logEntries.forEach((entry) => {
      if (typeof entry === 'object') {
        const timestamp = entry.timestamp || entry.Timestamp || entry['@timestamp'] || '';
        const message = entry.message || entry.Message || '';
        const level = entry.level || entry.Level || entry.severity || '';
        
        if (message) {
          logContent += `${timestamp} [${level}] ${message}\n`;
        } else {
          logContent += `${JSON.stringify(entry)}\n`;
        }
      } else {
        logContent += `${String(entry)}\n`;
      }
    });
    
    // Create and download file
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${environment.toLowerCase()}_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log(`[DOWNLOAD] Downloaded ${logEntries.length} log entries for ${environment}`);
  } catch (error) {
    console.error(`[DOWNLOAD] Error downloading ${environment} logs:`, error);
    alert(`Error downloading ${environment} logs: ${error.message}`);
  }
}

// Function to copy environment query to clipboard
window.copyEnvironmentQuery = function(envKey) {
  console.log('[COPY_QUERY] Copying query for environment:', envKey);
  const envData = window[`${envKey}EnvironmentData`];
  if (!envData) {
    console.error('[COPY_QUERY] No environment data found for:', envKey);
    alert(`No data available for ${envKey.toUpperCase()} environment.`);
    return;
  }
  
  navigator.clipboard.writeText(envData.searchString).then(() => {
    console.log('[COPY_QUERY] Successfully copied query to clipboard');
    alert(`✅ ${envKey.toUpperCase()} search query copied to clipboard!`);
  }).catch((error) => {
    console.error('[COPY_QUERY] Clipboard API failed, using fallback:', error);
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = envData.searchString;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    alert(`✅ ${envKey.toUpperCase()} search query copied to clipboard!`);
  });
};

// Function to add comprehensive summary at the end
function addComprehensiveSummary(results) {
  const environmentResults = document.getElementById('environment-results');
  if (!environmentResults) return;
  
  const successfulAnalyses = Object.keys(results).filter(env => !results[env].error);
  const failedAnalyses = Object.keys(results).filter(env => results[env].error);
  const totalLogs = successfulAnalyses.reduce((sum, env) => sum + (results[env].logCount || 0), 0);
  
  environmentResults.insertAdjacentHTML('beforeend', `
    <div style="margin-top: 30px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px;">
        📊 Comprehensive Analysis Summary
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${successfulAnalyses.length}</div>
          <div style="font-size: 12px;">Environments Analyzed</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${totalLogs.toLocaleString()}</div>
          <div style="font-size: 12px;">Total Log Entries</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${failedAnalyses.length}</div>
          <div style="font-size: 12px;">Failures</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${new Date().toLocaleTimeString()}</div>
          <div style="font-size: 12px;">Completed At</div>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
        <button onclick="window.downloadAllEnvironmentLogs()" style="padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          📥 Download All Logs
        </button>
        <button onclick="window.copyComprehensiveResults()" style="padding: 10px 20px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          📋 Copy All Results
        </button>
        <button onclick="summarizeLogs()" style="padding: 10px 20px; background: #ffc107; color: #212529; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          🔄 Refresh Analysis
        </button>
      </div>
    </div>
  `);
  
  // Store comprehensive results globally
  window.comprehensiveResults = results;
  
  // Add event listeners for the comprehensive summary buttons
  setTimeout(() => {
    // Add event listener for Download All Logs button
    const downloadAllBtn = document.querySelector('button[onclick="window.downloadAllEnvironmentLogs()"]');
    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EVENT] Download All Logs button clicked');
        window.downloadAllEnvironmentLogs();
      });
      console.log('[EVENT] Added Download All Logs event listener');
    } else {
      console.error('[EVENT] Could not find Download All Logs button');
    }
    
    // Add event listener for Copy All Results button  
    const copyAllBtn = document.querySelector('button[onclick="window.copyComprehensiveResults()"]');
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EVENT] Copy All Results button clicked');
        window.copyComprehensiveResults();
      });
      console.log('[EVENT] Added Copy All Results event listener');
    } else {
      console.error('[EVENT] Could not find Copy All Results button');
    }
    
    // Add event listener for Refresh Analysis button
    const refreshBtn = document.querySelector('button[onclick="summarizeLogs()"]');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EVENT] Refresh Analysis button clicked');
        summarizeLogs();
      });
      console.log('[EVENT] Added Refresh Analysis event listener');
    } else {
      console.error('[EVENT] Could not find Refresh Analysis button');
    }
  }, 200);
}

// Function to download all environment logs
window.downloadAllEnvironmentLogs = function() {
  console.log('[DOWNLOAD] Starting download of all environment logs...');
  const results = window.comprehensiveResults;
  if (!results) {
    console.error('[DOWNLOAD] No comprehensive results available');
    alert('No comprehensive analysis results available. Please run analysis first.');
    return;
  }
  
  const environments = Object.keys(results).filter(env => !results[env].error);
  console.log('[DOWNLOAD] Found environments to download:', environments);
  
  if (environments.length === 0) {
    alert('No successful environment analyses found to download.');
    return;
  }
  
  environments.forEach((env, index) => {
    const envData = results[env];
    if (envData.rawData) {
      setTimeout(() => {
        console.log(`[DOWNLOAD] Downloading logs for ${env}...`);
        downloadEnvironmentLogs(env, envData);
      }, 500 * index);
    }
  });
  
  alert(`📥 Starting download of logs from ${environments.length} environments...`);
};

// Function to copy all comprehensive results
window.copyComprehensiveResults = function() {
  console.log('[COPY] Copying comprehensive analysis results...');
  const results = window.comprehensiveResults;
  if (!results) {
    console.error('[COPY] No comprehensive results available');
    alert('No comprehensive analysis results available. Please run analysis first.');
    return;
  }
  
  let text = `Comprehensive Log Analysis Results\n`;
  text += `Generated: ${new Date().toISOString()}\n`;
  text += `Time Range: ${window.customTimeFilter || '-8h (default)'}\n\n`;
  
  Object.keys(results).forEach(env => {
    const data = results[env];
    text += `=== ${env.toUpperCase()} ENVIRONMENT ===\n`;
    if (data.error) {
      text += `Status: Failed - ${data.error}\n\n`;
    } else {
      text += `Status: Success\n`;
      text += `Log Count: ${data.logCount || 0}\n`;
      text += `Analysis:\n${data.analysis}\n\n`;
    }
  });
  
  navigator.clipboard.writeText(text).then(() => {
    console.log('[COPY] Successfully copied to clipboard');
    alert('✅ Comprehensive analysis results copied to clipboard!');
  }).catch((error) => {
    console.error('[COPY] Clipboard API failed, using fallback:', error);
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    alert('✅ Comprehensive analysis results copied to clipboard!');
  });
};

// New function to handle Alexandria log query and analysis
async function proceedWithAlexandriaLogQuery() {
  const logSummariesContent = document.getElementById('log-summaries-content');
  
  try {
    // Step 0: Check for cached authentication token first
    console.log('🔐 [ALEXANDRIA] Checking authentication status...');
    if (!authToken) {
      console.log('🔄 [ALEXANDRIA] No token in memory, checking cache...');
      authToken = await initializeAuthToken();
    }
    
    if (!authToken) {
      throw new Error('No authentication token available. Please log in first to cache your token for 8 hours.');
    }
    
    console.log('✅ [ALEXANDRIA] Authentication token available');
    const tokenStr = String(authToken);
    console.log('🔑 [ALEXANDRIA] Using token:', tokenStr.substring(0, 12) + '...' + tokenStr.substring(tokenStr.length - 8));
    
    // Step 1: Get queries from existing session data (same as Networks tab)
    const sessionQueries = extractQueryFromSession();
    
    if (!sessionQueries) {
      throw new Error('No session data available to build query. Please ensure you have active network requests.');
    }
    
    // Step 2: Determine which query to use based on domain context
    const sessionData = getSessionData();
    const allRequests = sessionData.requests || [];
    const activeDomain = sessionData.activeDomain;
    
    // Debug: Log session data being used for queries
    console.log('[ALEXANDRIA] Session data for queries:', {
      sessionId: sessionData.sessionId,
      workstationId: sessionData.workstationId,
      activeDomain: activeDomain,
      requestCount: allRequests.length,
      sessionDataKeys: Object.keys(sessionData),
      hasValidSessionId: !!(sessionData.sessionId && sessionData.sessionId !== 'NO_SESSION'),
      hasValidWorkstationId: !!(sessionData.workstationId && sessionData.workstationId !== 'N/A')
    });
    
    // Detect the most appropriate query based on domain patterns
    let selectedQueries = [];
    let queryType;
    
    // Check if we have valid session data to inform query strategy
    const hasValidSession = sessionData.sessionId && sessionData.sessionId !== 'NO_SESSION';
    const hasValidWorkstation = sessionData.workstationId && sessionData.workstationId !== 'N/A';
    
    console.log('[ALEXANDRIA] Session validity check:', {
      hasValidSession,
      hasValidWorkstation,
      willUseSessionQueries: hasValidSession || hasValidWorkstation
    });
    
    // Use your exact working PowerShell query first, then try simple fallbacks
    selectedQueries = [
      { query: sessionQueries.working, type: 'working', description: 'Your exact working PowerShell query' },
      { query: sessionQueries.prod_simple, type: 'prod_simple', description: 'Production HQ logs (-8h, no session filter)' },
      { query: sessionQueries.prod_any, type: 'prod_any', description: 'Any production HQ logs (100 entries)' }
    ];
    queryType = 'working_example';
    
    console.log('📝 [ALEXANDRIA] ========== QUERY SELECTION ==========');
    console.log('🎯 [ALEXANDRIA] Selected query strategy:', queryType);
    console.log('📋 [ALEXANDRIA] Query options available:', selectedQueries.length);
    
    selectedQueries.forEach((queryOption, index) => {
      console.log(`📄 [ALEXANDRIA] Query ${index + 1}:`);
      console.log(`   Type: ${queryOption.type}`);
      console.log(`   Description: ${queryOption.description}`);
      console.log(`   Query length: ${queryOption.query?.length || 0} characters`);
      console.log(`   Query content: ${queryOption.query}`);
    });
    
    console.log('🔐 [ALEXANDRIA] Auth token analysis:');
    console.log('   Auth token type:', typeof authToken);
    console.log('   Auth token exists:', !!authToken);
    if (authToken) {
      const tokenStr = String(authToken);
      console.log('   Auth token length:', tokenStr.length);
      console.log('   Auth token preview:', tokenStr.substring(0, 12) + '...' + tokenStr.substring(tokenStr.length - 8));
    } else {
      console.log('   Auth token: null/undefined');
    }
    
    // Step 3: Try queries in order until we get results
    let logResults = null;
    let successfulQuery = null;
    
    console.log('🔄 [ALEXANDRIA] ========== STARTING QUERY ATTEMPTS ==========');
    console.log('📊 [ALEXANDRIA] Will attempt', selectedQueries.length, 'queries in order');
    
    for (const queryOption of selectedQueries) {
      try {
        console.log(`🚀 [ALEXANDRIA] ========== ATTEMPT ${selectedQueries.indexOf(queryOption) + 1}/${selectedQueries.length} ==========`);
        console.log(`📝 [ALEXANDRIA] Query Type: ${queryOption.type}`);
        console.log(`📝 [ALEXANDRIA] Description: ${queryOption.description}`);
        console.log(`📝 [ALEXANDRIA] Query: ${queryOption.query}`);
        console.log(`⏰ [ALEXANDRIA] Starting at: ${new Date().toISOString()}`);
        
        // Update status for current query attempt
        logSummariesContent.innerHTML = `
          <div class="ai-loading">
            <div class="loading-spinner"></div>
            📡 Querying Alexandria logs using: ${queryOption.description}...
            <div style="margin-top: 10px; font-size: 12px; color: #666;">
              Environment: <strong>${queryOption.type.toUpperCase()}</strong><br>
              Query: ${queryOption.query}<br>
              Token: ${String(authToken).substring(0, 8)}...<br>
              Attempt: ${selectedQueries.indexOf(queryOption) + 1} of ${selectedQueries.length}
            </div>
          </div>
        `;
        
        console.log(`⚡ [ALEXANDRIA] Calling queryAlexandriaLogs() for attempt ${selectedQueries.indexOf(queryOption) + 1}`);
        const results = await queryAlexandriaLogs(authToken, queryOption.query);
        
        console.log(`📥 [ALEXANDRIA] Query attempt ${selectedQueries.indexOf(queryOption) + 1} completed`);
        console.log(`📊 [ALEXANDRIA] Results analysis:`, {
          hasResults: !!results,
          resultsType: typeof results,
          hasDataArray: !!(results && results.Data),
          dataLength: results?.Data?.length || 0,
          resultKeys: results ? Object.keys(results) : []
        });
        
        if (results && results.Data && results.Data.length > 0) {
          console.log(`✅ [ALEXANDRIA] SUCCESS! Query ${selectedQueries.indexOf(queryOption) + 1} returned ${results.Data.length} results`);
          logResults = results;
          successfulQuery = queryOption;
          break; // Success! Exit the loop
        } else {
          console.log(`⚠️  [ALEXANDRIA] Query ${selectedQueries.indexOf(queryOption) + 1} returned no results, trying next...`);
        }
      } catch (error) {
        console.warn(`❌ [ALEXANDRIA] Query ${selectedQueries.indexOf(queryOption) + 1} failed: ${queryOption.type} - ${error.message}`);
        console.log(`🔄 [ALEXANDRIA] Continuing to next query attempt...`);
        // Continue to next query
      }
    }
    
    if (!logResults || !logResults.Data || logResults.Data.length === 0) {
      throw new Error(`No logs found with any of the ${selectedQueries.length} queries attempted. Check if the Alexandria indices contain data for your session.`);
    }
    
    console.log('[ALEXANDRIA] Log query results:', logResults);
    
    // Step 4: Process the log results and prepare for Alexandria analysis using intelligent selection
    let logSummary = 'No logs found matching the session criteria.';
    
    if (logResults && logResults.Data && logResults.Data.length > 0) {
      const selectedLogs = selectLogsForAnalysis(logResults.Data);
      logSummary = `Found ${logResults.Data.length} log entries from Alexandria (using ${successfulQuery.description}). Selected ${selectedLogs.length} key logs for analysis:\n\n`;
      
      // Group logs by source for better organization
      const logsBySource = {
        first: selectedLogs.filter(log => log.source === 'first'),
        last: selectedLogs.filter(log => log.source === 'last'),
        error: selectedLogs.filter(log => log.source === 'error'),
        context: selectedLogs.filter(log => log.source === 'context')
      };
      
      // Add first logs
      if (logsBySource.first.length > 0) {
        logSummary += `=== FIRST ${logsBySource.first.length} LOGS (Session Start) ===\n`;
        logsBySource.first.forEach((log, index) => {
          logSummary += `Log ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add error logs with context
      if (logsBySource.error.length > 0) {
        logSummary += `=== ERROR LOGS (${logsBySource.error.length} found) ===\n`;
        logsBySource.error.forEach((log, index) => {
          logSummary += `Error ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'ERROR'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add context logs
      if (logsBySource.context.length > 0) {
        logSummary += `=== CONTEXT LOGS (${logsBySource.context.length} request/response logs around errors) ===\n`;
        logsBySource.context.forEach((log, index) => {
          logSummary += `Context ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
        logSummary += `\n`;
      }
      
      // Add last logs
      if (logsBySource.last.length > 0) {
        logSummary += `=== LAST ${logsBySource.last.length} LOGS (Recent Activity) ===\n`;
        logsBySource.last.forEach((log, index) => {
          logSummary += `Recent ${index + 1}:\n`;
          logSummary += `Timestamp: ${log.timestamp || 'N/A'}\n`;
          logSummary += `Level: ${log.level || log.logLevel || 'N/A'}\n`;
          logSummary += `Message: ${log.message || log._raw || JSON.stringify(log).substring(0, 300)}\n`;
          logSummary += `---\n`;
        });
      }
      
      if (logResults.Data.length > selectedLogs.length) {
        logSummary += `\n... and ${logResults.Data.length - selectedLogs.length} more log entries not shown`;
      }
    }
    
    // Step 5: Update status for Alexandria analysis
    logSummariesContent.innerHTML = `
      <div class="ai-loading">
        <div class="loading-spinner"></div>
        📊 Processing ${logResults?.Data?.length || 0} log entries with Alexandria analysis...
        <div style="margin-top: 8px; font-size: 12px; color: #666;">
          Successfully queried: ${successfulQuery.description}
        </div>
      </div>
    `;
    
    // Step 5: Send to Alexandria for analysis (using the same API)
    const summaryPrompt = `Analyze these log entries and provide insights:

${logSummary}

Focus on:
1. Any errors or issues found
2. Performance patterns
3. Key events or transactions
4. Recommendations for optimization`;

    console.log('[ALEXANDRIA] Sending analysis prompt to Alexandria:', summaryPrompt);
    console.log('[ALEXANDRIA] Prompt length:', summaryPrompt.length);
    
    // NEW: Show the exact prompt being sent to Alexandria in the UI
    displayExactPrompt(summaryPrompt, successfulQuery);
    
    try {
      console.log('[ALEXANDRIA] Calling summarizeLogsAPI with prompt...');
      const alexandriaResult = await summarizeLogsAPI(summaryPrompt);
      console.log('[ALEXANDRIA] Analysis result received:', alexandriaResult);
      console.log('[ALEXANDRIA] Analysis result type:', typeof alexandriaResult);
      console.log('[ALEXANDRIA] Analysis result keys:', alexandriaResult ? Object.keys(alexandriaResult) : 'null');
      console.log('[ALEXANDRIA] Analysis summary:', alexandriaResult?.summary);
      console.log('[ALEXANDRIA] Analysis response:', alexandriaResult?.response);
      
      // Step 6: Display final results
      displayLogSummaryResults(logResults, alexandriaResult, successfulQuery);
      
    } catch (alexandriaError) {
      console.error('[ALEXANDRIA] Alexandria analysis failed:', alexandriaError);
      
      // Show log query results even if analysis fails
      const logSummariesContent = document.getElementById('log-summaries-content');
      logSummariesContent.innerHTML = `
        <div style="padding: 20px;">
          <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #f39c12;">
            ⚠️ Partial Analysis Complete
          </div>
          
          <div style="margin-bottom: 20px; padding: 15px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 6px;">
            <div style="font-weight: 600; margin-bottom: 10px;">✅ Alexandria Log Query Results:</div>
            <div style="margin-bottom: 8px;">
              <strong>Log Entries Found:</strong> ${logResults?.results?.length || 0}
            </div>
            <div style="margin-bottom: 8px;">
              <strong>Successful Query:</strong> ${successfulQuery.description}
            </div>
            <div style="margin-bottom: 8px;">
              <strong>Query Status:</strong> ${logResults?.status || 'Success'}
            </div>
            <div style="margin-bottom: 8px;">
              <strong>Search Duration:</strong> ${logResults?.duration || 'N/A'}
            </div>
          </div>
          
          <div style="margin-bottom: 20px; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px;">
            <div style="font-weight: 600; margin-bottom: 10px;">❌ Alexandria Analysis Failed:</div>
            <div style="margin-bottom: 10px;">
              <strong>Error:</strong> ${alexandriaError.message}
            </div>
            <div style="margin-bottom: 10px;">
              <strong>Possible causes:</strong>
              <ul style="margin: 5px 0; padding-left: 20px;">
                <li>Alexandria service may be temporarily unavailable</li>
                <li>Analysis prompt may be too large (${summaryPrompt.length} characters)</li>
                <li>Authentication token may have expired</li>
                <li>Service may be experiencing high load</li>
              </ul>
            </div>
            <div style="margin-bottom: 10px;">
              <strong>You can:</strong>
              <ul style="margin: 5px 0; padding-left: 20px;">
                <li>Review the raw Alexandria log data below</li>
                <li>Try again in a few minutes</li>
                <li>Use a smaller time range to reduce data size</li>
                <li>Log in again to refresh your token</li>
              </ul>
            </div>
          </div>
          
          <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <button onclick="summarizeLogs()" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
              🔄 Try Again
            </button>
            <button onclick="resetAuth()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
              🔑 Login Again
            </button>
            <button onclick="copyAnalysisResults()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
              📋 Copy Error Info
            </button>
          </div>
        </div>
      `;
      
      // Store partial results
      window.lastAnalysisResults = {
        alexandria: logResults,
        alexandriaAnalysis: null,
        analysisError: alexandriaError.message,
        timestamp: new Date().toISOString()
      };
      
      return; // Don't throw the error, just show partial results
    }
    
  } catch (error) {
    console.error('[ALEXANDRIA] Error in log query process:', error);
    throw error;
  }
}

// Function to display the combined Alexandria + Alexandria Analysis results
function displayLogSummaryResults(alexandriaResults, alexandriaAnalysis, successfulQuery) {
  const logSummariesContent = document.getElementById('log-summaries-content');
  
  const logCount = alexandriaResults?.Data?.length || 0;
  const analysisText = alexandriaAnalysis?.summary || alexandriaAnalysis?.response || 'No analysis available';
  
  logSummariesContent.innerHTML = `
    <div style="padding: 10px 20px 20px 20px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #28a745;">
        ✅ Alexandria Log Analysis Complete
      </div>
      
      <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">📊 Download Logs:</div>
        <button id="download-alexandria-logs" style="padding: 10px 20px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">
          📥 Download Logs
        </button>
        <div style="margin-top: 10px; font-size: 12px; color: #6c757d;">
          Downloads the received log data as a .log file
        </div>
      </div>
      
      <div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">🔍 Alexandria Analysis:</div>
        <div style="white-space: pre-wrap; line-height: 1.5; font-size: 13px;">
${analysisText}
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button onclick="summarizeLogs()" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🔄 Analyze Again
        </button>
        <button onclick="copyAnalysisResults()" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
          📋 Copy Results
        </button>
      </div>
    </div>
  `;
  
  // Store results globally for copy/export functions
  window.lastAnalysisResults = {
    alexandria: alexandriaResults,
    alexandriaAnalysis: alexandriaAnalysis,
    timestamp: new Date().toISOString()
  };
  
  // Add event listener for download button
  setTimeout(() => {
    const downloadBtn = document.getElementById('download-alexandria-logs');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        console.log('[DOWNLOAD] Event listener triggered');
        downloadAlexandriaLogs();
      });
      console.log('[DOWNLOAD] Event listener attached to download button');
    } else {
      console.warn('[DOWNLOAD] Download button not found');
    }
  }, 100);
}

// Helper functions for the results display
function downloadAlexandriaLogs() {
  console.log('[DOWNLOAD] Download button clicked');
  console.log('[DOWNLOAD] Checking window.lastAnalysisResults:', window.lastAnalysisResults);
  
  if (window.lastAnalysisResults && window.lastAnalysisResults.alexandria) {
    const logData = window.lastAnalysisResults.alexandria;
    console.log('[DOWNLOAD] Alexandria data found:', logData);
    
    const logEntries = logData.Data || logData.results || [];
    
    if (logEntries.length === 0) {
      alert('No log entries found to download.');
      return;
    }
    
    console.log('[DOWNLOAD] Processing log entries:', logEntries.length);
    
    try {
      // Convert log entries to .log format (plain text, one entry per line)
      let logContent = '';
      
      // Add header with metadata
      logContent += `# Alexandria Log Export\n`;
      logContent += `# Export Date: ${new Date().toISOString()}\n`;
      logContent += `# Total Entries: ${logEntries.length}\n`;
      logContent += `# Source: EasyLogs Extension v3.0.0\n`;
      logContent += `#\n`;
      
      // Process each log entry
      logEntries.forEach((entry, index) => {
        if (typeof entry === 'string') {
          // If entry is already a string, use it directly
          logContent += `${entry}\n`;
        } else if (typeof entry === 'object') {
          // If entry is an object, convert to readable format
          if (entry.message || entry.Message) {
            // Use the message field if available
            const timestamp = entry.timestamp || entry.Timestamp || entry['@timestamp'] || '';
            const message = entry.message || entry.Message || '';
            const level = entry.level || entry.Level || entry.severity || '';
            
            logContent += `${timestamp} [${level}] ${message}\n`;
          } else {
            // Convert entire object to JSON string for this line
            logContent += `${JSON.stringify(entry)}\n`;
          }
        } else {
          // For any other type, convert to string
          logContent += `${String(entry)}\n`;
        }
      });
      
      console.log('[DOWNLOAD] Log content prepared, length:', logContent.length);
      
      // Create blob and download as .log file
      const blob = new Blob([logContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = `alexandria_logs_${new Date().toISOString().split('T')[0]}_${Date.now()}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up the URL object
      URL.revokeObjectURL(url);
      
      console.log('[DOWNLOAD] Alexandria logs downloaded successfully as .log file');
      alert('Download started! Check your Downloads folder for the .log file.');
    } catch (error) {
      console.error('[DOWNLOAD] Error during download:', error);
      alert(`Download failed: ${error.message}`);
    }
  } else {
    console.log('[DOWNLOAD] No data available');
    console.log('[DOWNLOAD] window.lastAnalysisResults:', window.lastAnalysisResults);
    alert('No Alexandria log data available to download. Please run a log query first.');
  }
}

// Make the function globally accessible
window.downloadAlexandriaLogs = downloadAlexandriaLogs;

function copyAnalysisResults() {
  if (window.lastAnalysisResults) {
    const text = `Alexandria Log Analysis Results (${window.lastAnalysisResults.timestamp})

Alexandria Query Results:
- Log Entries: ${window.lastAnalysisResults.alexandria?.results?.length || 0}
- Status: ${window.lastAnalysisResults.alexandria?.status || 'N/A'}
- Duration: ${window.lastAnalysisResults.alexandria?.duration || 'N/A'}

Alexandria Analysis:
${window.lastAnalysisResults.alexandriaAnalysis?.summary || window.lastAnalysisResults.alexandriaAnalysis?.response || 'No analysis available'}
`;
    
    navigator.clipboard.writeText(text).then(() => {
      alert('Analysis results copied to clipboard!');
    }).catch(() => {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Analysis results copied to clipboard!');
    });
  }
}

function showRawLogData() {
  const rawDataDiv = document.getElementById('raw-log-data');
  if (rawDataDiv) {
    rawDataDiv.style.display = rawDataDiv.style.display === 'none' ? 'block' : 'none';
  }
}

function copyRawLogData() {
  if (window.lastAnalysisResults && window.lastAnalysisResults.alexandria) {
    const text = `Alexandria Raw Log Data (${window.lastAnalysisResults.timestamp})

${JSON.stringify(window.lastAnalysisResults.alexandria, null, 2)}`;
    
    navigator.clipboard.writeText(text).then(() => {
      alert('Raw log data copied to clipboard!');
    }).catch(() => {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Raw log data copied to clipboard!');
    });
  } else {
    alert('No raw log data available to copy.');
  }
}

async function testAPICall() {
  console.log('[popup.js] Testing Alexandria API connection...');
  
  const testQuery = "Test connection to API - please respond with a simple confirmation message.";
  
  try {
    const result = await summarizeLogsAPI(testQuery);
    console.log('[popup.js] Alexandria API test successful:', result);
    return result;
  } catch (error) {
    console.error('[popup.js] Alexandria API test failed:', error);
    throw error;
  }
}

function proceedWithLogSummarization() {
  console.log('[popup.js] Proceeding with log summarization...');
  
  const logSummariesContent = document.getElementById('log-summaries-content');
  
  // Create the log summary container
  const summaryContainer = document.createElement('div');
  summaryContainer.className = 'log-summary-container';
  
  // Define the three log types and their queries
  const logQueries = [
    {
      type: 'HQ Logs',
      icon: '🏢',
      className: 'log-type-hq',
      query: 'Analyze HQ logs for errors, warnings, and performance issues'
    },
    {
      type: 'LB Logs', 
      icon: '⚖️',
      className: 'log-type-lb',
      query: 'Analyze Load Balancer logs for traffic patterns and failures'
    },
    {
      type: 'Kamino Logs',
      icon: '🧬',
      className: 'log-type-kamino', 
      query: 'Analyze Kamino logs for deployment and system health'
    }
  ];
  
  // Create blocks for each log type
  logQueries.forEach(logQuery => {
    const block = createLogSummaryBlock(logQuery);
    summaryContainer.appendChild(block);
  });
  
  logSummariesContent.innerHTML = '';
  logSummariesContent.appendChild(summaryContainer);
  
  // Make API calls for each log type
  logQueries.forEach((logQuery, index) => {
    performLogSummaryCall(logQuery, index);
  });
}

function createLogSummaryBlock(logQuery) {
  const block = document.createElement('div');
  block.className = 'log-summary-block';
  block.id = `log-summary-${logQuery.type.toLowerCase().replace(' ', '-')}`;
  
  block.innerHTML = `
    <div class="log-summary-header ${logQuery.className}">
      <span>${logQuery.icon}</span>
      <span>${logQuery.type}</span>
    </div>
    <div class="log-summary-content">
      <div class="log-summary-loading">
        <div class="loading-spinner"></div>
        Analyzing ${logQuery.type}...
      </div>
    </div>
  `;
  
  return block;
}

async function performLogSummaryCall(logQuery, index) {
  const blockId = `log-summary-${logQuery.type.toLowerCase().replace(' ', '-')}`;
  const block = document.getElementById(blockId);
  if (!block) return;
  
  const contentArea = block.querySelector('.log-summary-content');
  
  try {
    console.log(`[popup.js] Making API call for ${logQuery.type}...`);
    
    // Send just the query text string to the API
    console.log(`[popup.js] Query for ${logQuery.type}:`, logQuery.query);
    
    const result = await summarizeLogsAPI(logQuery.query);
    
    // Display the response
    contentArea.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: 600; color: #28a745;">
        ✅ Analysis Complete
      </div>
      <div style="border: 1px solid #e0e0e0; padding: 10px; border-radius: 4px; background: #f8f9fa;">
        <strong>Query:</strong><br>
        <div style="font-style: italic; margin: 5px 0; color: #666;">${logQuery.query}</div>
        <strong>AI Response:</strong><br>
        <pre style="white-space: pre-wrap; font-size: 11px; margin: 5px 0;">${JSON.stringify(result, null, 2)}</pre>
      </div>
    `;
    
    console.log(`[popup.js] ${logQuery.type} summary completed:`, result);
    
  } catch (error) {
    console.error(`[popup.js] Error summarizing ${logQuery.type}:`, error);
    
    contentArea.innerHTML = `
      <div class="log-summary-error">
        <div style="font-weight: 600; margin-bottom: 8px;">❌ Error occurred</div>
        <div style="font-size: 12px; color: #721c24; margin-bottom: 8px;">
          ${error.message || 'Failed to analyze logs'}
        </div>
        <details style="margin-top: 8px;">
          <summary style="cursor: pointer; font-size: 11px; color: #666;">Show technical details</summary>
          <div style="margin-top: 5px; font-size: 10px; font-family: monospace; background: #f1f1f1; padding: 8px; border-radius: 3px; white-space: pre-wrap;">
${error.stack || error.toString()}
          </div>
        </details>
      </div>
    `;
  }
}

// Test function for transaction rights formatting
window.testTransactionRights = function() {
  const sampleTransactionRights = {
    "fundsTransfer": {
      "view": 2,
      "enabled": true,
      "draft": true,
      "authorize": true,
      "cancel": true,
      "draftRestricted": false,
      "dualAuthLimit": 9999999.99
    },
    "externalTransfer": {
      "view": 0,
      "enabled": false,
      "draft": false,
      "authorize": false,
      "cancel": false,
      "draftRestricted": false,
      "dualAuthLimit": 0
    },
    "billPayment": {
      "view": 1,
      "enabled": true,
      "draft": true,
      "authorize": true,
      "cancel": true,
      "draftRestricted": false,
      "dualAuthLimit": -1
    }
  };
  
  console.log('[TEST] Testing transaction rights display with sample data');
  console.log('[TEST] Sample data:', sampleTransactionRights);
  
  // First, switch to User Details tab if not already there
  const userDetailsBtn = document.querySelector('[data-tab="user-details"]');
  if (userDetailsBtn) {
    userDetailsBtn.click();
    console.log('[TEST] Switched to User Details tab');
  }
  
  // Wait a moment for tab to switch, then activate transaction rights tab
  setTimeout(() => {
    const transactionTab = document.querySelector('[data-capability="transactions"]');
    if (transactionTab) {
      transactionTab.click();
      console.log('[TEST] Activated Transaction Rights tab');
      
      // Wait for tab activation, then populate data
      setTimeout(() => {
        populateTransactionRights(sampleTransactionRights);
        console.log('[TEST] Transaction rights populated. Check the User Details tab -> Transaction Rights section');
        
        // Verify the content is visible
        const content = document.getElementById('transactions-content');
        const grid = content ? content.querySelector('.capability-grid') : null;
        if (content && grid) {
          console.log('[TEST] Content element classes:', content.className);
          console.log('[TEST] Grid innerHTML length:', grid.innerHTML.length);
        }
      }, 100);
    } else {
      console.error('[TEST] Could not find transaction rights tab');
    }
  }, 100);
};

// Debug function to check if elements exist
window.debugTransactionRights = function() {
  const content = document.getElementById('transactions-content');
  const grid = content ? content.querySelector('.capability-grid') : null;
  const transactionTab = document.querySelector('[data-capability="transactions"]');
  const userDetailsBtn = document.querySelector('[data-tab="user-details"]');
  
  console.log('[DEBUG] User Details button:', userDetailsBtn);
  console.log('[DEBUG] Transaction rights tab:', transactionTab);
  console.log('[DEBUG] Transaction rights content element:', content);
  console.log('[DEBUG] Transaction rights grid element:', grid);
  
  if (content) {
    console.log('[DEBUG] Content element classes:', content.className);
    console.log('[DEBUG] Content is visible:', content.offsetHeight > 0);
  }
  
  if (!content) {
    console.error('[DEBUG] Missing transactions-content element!');
    return false;
  }
  
  if (!grid) {
    console.error('[DEBUG] Missing .capability-grid inside transactions-content!');
    return false;
  }
  
  console.log('[DEBUG] All elements found successfully');
  return true;
};

// Force show transaction rights tab for testing
window.forceShowTransactionRights = function() {
  // Make transaction rights content visible
  const content = document.getElementById('transactions-content');
  if (content) {
    content.classList.add('active');
    content.style.display = 'block';
    console.log('[FORCE] Made transaction rights content visible');
  }
  
  // Activate the transaction rights tab
  const transactionTab = document.querySelector('[data-capability="transactions"]');
  if (transactionTab) {
    transactionTab.classList.add('active');
    console.log('[FORCE] Activated transaction rights tab');
  }
  
  // Now run the test
  window.testTransactionRights();
};

// Debug function to check logonUser request capture
window.debugLogonUserCapture = function() {
  console.log('[DEBUG] Checking logonUser request capture...');
  
  getNetworkData((response) => {
    if (!response || !response.data) {
      console.log('[DEBUG] No network data available');
      return;
    }
    
    console.log('[DEBUG] Total requests in data:', response.data.length);
    
    // Find all logonUser related requests
    const logonUserRequests = response.data.filter(req => 
      req.url?.includes('logonUser?') || 
      req.isLogonUserCapture ||
      req.url?.includes('logonUser')
    );
    
    console.log('[DEBUG] Found', logonUserRequests.length, 'logonUser-related requests:');
    
    logonUserRequests.forEach((req, index) => {
      console.log(`[DEBUG] LogonUser Request ${index + 1}:`, {
        id: req.requestId,
        url: req.url,
        method: req.method,
        status: req.statusCode,
        hasResponseBody: !!req.responseBody,
        responseBodyLength: req.responseBody ? req.responseBody.length : 0,
        responseBodyPreview: req.responseBody ? req.responseBody.substring(0, 200) + '...' : 'none',
        isLogonUserCapture: req.isLogonUserCapture,
        timestamp: new Date(req.startTime || 0).toISOString(),
        headers: req.responseHeaders ? Object.keys(req.responseHeaders).length : 0,
        q2token: req.q2token
      });
      
      if (req.responseBody) {
        try {
          const parsed = JSON.parse(req.responseBody);
          console.log(`[DEBUG] Request ${index + 1} parsed response:`, {
            hasData: !!parsed.data,
            hasUserInfo: !!(parsed.data?.firstName || parsed.data?.lastName || parsed.data?.loginName),
            dataKeys: parsed.data ? Object.keys(parsed.data) : [],
            firstName: parsed.data?.firstName,
            lastName: parsed.data?.lastName,
            loginName: parsed.data?.loginName
          });
        } catch (e) {
          console.log(`[DEBUG] Request ${index + 1} response body not valid JSON:`, req.responseBody.substring(0, 100));
        }
      }
    });
    
    // Check current session data
    if (currentSessionData && currentSessionData.requests) {
      const sessionLogonRequests = currentSessionData.requests.filter(req => 
        req.url?.includes('logonUser?') || req.isLogonUserCapture
      );
      console.log('[DEBUG] Current session has', sessionLogonRequests.length, 'logonUser requests');
      sessionLogonRequests.forEach((req, index) => {
        console.log(`[DEBUG] Session LogonUser ${index + 1}:`, {
          url: req.url,
          hasResponseBody: !!req.responseBody,
          isLogonUserCapture: req.isLogonUserCapture
        });
      });
    } else {
      console.log('[DEBUG] No current session data available');
    }
    
    // Test loading user details manually
    console.log('[DEBUG] Testing manual user details load...');
    loadUserDetailsData();
  });
};

// Debug function to check inject.js status  
window.debugInjectStatus = function() {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0]) {
      console.log('[DEBUG] Current tab URL:', tabs[0].url);
      
      // Try to send a message to content script to test communication
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'TEST_INJECT_STATUS'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[DEBUG] Error communicating with content script:', chrome.runtime.lastError.message);
        } else {
          console.log('[DEBUG] Content script response:', response);
        }
      });
    }
  });
  
  // Also test if we can trigger inject.js manually
  console.log('[DEBUG] To test inject.js manually, run this in the page console:');
  console.log('window.postMessage({type: "LOGON_USER_RESPONSE", data: {url: "test", responseBody: "test"}}, "*")');
};

// Force refresh User Details with latest data
window.forceRefreshUserDetails = function() {
  console.log('[FORCE] Forcing refresh of User Details tab...');
  
  // Clear current session data to force fresh load
  currentSessionData = null;
  
  // Switch to User Details tab if not already there
  const userDetailsBtn = document.querySelector('[data-tab="user-details"]');
  if (userDetailsBtn && !userDetailsBtn.classList.contains('active')) {
    userDetailsBtn.click();
    console.log('[FORCE] Switched to User Details tab');
  }
  
  // Wait a moment then force load fresh data
  setTimeout(() => {
    console.log('[FORCE] Loading fresh user details data...');
    loadUserDetailsData();
  }, 100);
  
  // Also refresh the whole popup to get latest session data
  setTimeout(() => {
    console.log('[FORCE] Refreshing network data...');
    refreshNetworkData();
  }, 200);
};
