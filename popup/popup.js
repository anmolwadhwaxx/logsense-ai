let currentTabId = null;

document.addEventListener('DOMContentLoaded', function () {
  const networkDataContainer = document.getElementById('network-data');
  const clearButton = document.getElementById('clear-button');
  const siteSelector = document.getElementById('site-selector');
  const siteInput = document.getElementById('site-input');
  const addSiteBtn = document.getElementById('add-site');
  const envInfoEl = document.getElementById('env-info');

  // Collapsible section logic for showing/hiding content
  const coll = document.querySelector(".collapsible");
  const content = document.querySelector(".collapsible-content");
  if (coll && content) {
    coll.addEventListener("click", () => {
      content.style.display = content.style.display === "block" ? "none" : "block";
    });
  }

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

  // --- Env Info Handling via content.js injection ---

  // Renders environment information into the popup's env info element
  function renderEnvInfo(info) {
    envInfoEl.textContent = `
**** UUX Info ****
Version: ${info.version}
Theme: ${info.theme}
Language: ${info.language}

**** Tecton Info ****
Platform Version: ${info.tectonPlatformVersion}
SDK Version: ${info.tectonSdkVersion}

**** CDN Info ****
Base URL: ${info.cdnBaseUrl}
Customer #: ${info.cdnCustomerNumber}
    `;
  }

  // Fallback method to fetch cached environment info from background if content script fails
  function fetchEnvInfoFallback() {
    chrome.runtime.sendMessage({ type: 'GET_CACHED_ENV_INFO' }, response => {
      if (response?.data) renderEnvInfo(response.data);
      else envInfoEl.textContent = 'Environment info not available.';
    });
  }

  // Listen for env info response messages from content.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'UUX_ENV_INFO') {
      renderEnvInfo(message.data);
    }
  });

  // Request environment info from content.js for the given tab
  function populateEnvInfo(tabId) {
    envInfoEl.textContent = 'Loading environment info...';

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
      });
    });
  }

  /**
   * Display the captured network data in the popup.
   * Includes parsing cookies, q2tokens, and building Alexandria HQ search URL.
   */
  function displayNetworkData(data, activeDomain) {
    networkDataContainer.innerHTML = '';

    if (!activeDomain) {
      networkDataContainer.textContent = 'No active site selected.';
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const activeTab = tabs[0];
      const protocol = activeTab ? getProtocol(activeTab.url) : 'https:';
      const cookieUrl = `${protocol}//${activeDomain}`;

      // Fetch the most recent 'workstation-id' cookie
      chrome.cookies.get({ url: cookieUrl, name: 'workstation-id' }, function (cookie) {
        let latestWorkstationId = cookie?.value || 'N/A';

        data
          .filter(entry => entry.q2token && entry.q2token !== 'N/A')
          .filter(entry => {
            try {
              return getDomain(entry.url) === activeDomain;
            } catch {
              return false;
            }
          })
          .forEach(entry => {
            // Extract workstation-id from request or response headers
            let workstationId = 'N/A';
            if (entry.requestHeaders) {
              const cookieHeader = entry.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
              if (cookieHeader?.value) {
                const match = cookieHeader.value.match(/(?:^|;\s*)workstation-id=([^;]*)/i);
                if (match) workstationId = match[1];
              }
            }

            if (workstationId === 'N/A' && entry.responseHeaders) {
              const setCookieHeaders = entry.responseHeaders.filter(h => h.name.toLowerCase() === 'set-cookie');
              for (const setCookie of setCookieHeaders) {
                const match = setCookie.value.match(/(?:^|;\s*)workstation-id=([^;]*)/i);
                if (match) {
                  workstationId = match[1];
                  break;
                }
              }
            }

            if (workstationId === 'N/A') {
              workstationId = latestWorkstationId;
            }

            // Extract relevant network info
            const url = entry.url || 'N/A';
            const method = entry.method || 'N/A';
            const status = entry.statusCode || 'N/A';
            const time = (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime).toFixed(2) : 'N/A';
            const q2token = entry.q2token;
            const fi_no = entry.fi_no || 'N/A';

            // Determine session start and end time for Alexandria logs
            let startTime = null;
            if (entry.responseHeaders) {
              const header = entry.responseHeaders.find(h => h.name.toLowerCase() === 'starteddatetime');
              if (header && header.value) {
                startTime = Date.parse(header.value);
              }
            }
            if (!startTime && entry.startTime) {
              startTime = entry.startTime;
            }

            const endTime = startTime ? startTime + 30 * 60 * 1000 : null; // +30 min
            const formattedStart = formatDateTime(startTime);
            const formattedEnd = formatDateTime(endTime);
            const logIndex = url.includes('temporary') ? 'app_logs_stage_hq' : 'app_logs_prod_hq';
            const searchString = `search index="${logIndex}"  sessionId="${q2token}"  earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
            const fullUrl = `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(searchString)}`;

            // Build HTML block for this network entry
            const entryElement = document.createElement('div');
            entryElement.className = 'network-entry';
            entryElement.innerHTML = `
              <strong>Request URL:</strong> ${url}<br>
              <strong>Request Method:</strong> ${method}<br>
              <strong>Status:</strong> ${status}<br>
              <strong>Response Time:</strong> ${time} ms<br>
              <strong>q2token (sessionId):</strong> ${q2token}<br>
              <strong>workstation-id (from cookie):</strong> ${workstationId}<br>
              <strong>fi_no:</strong> ${fi_no}<br>
              <strong>Start Time:</strong> ${formattedStart} GMT<br>
              <strong>End Time (30 min later):</strong> ${formattedEnd} GMT<br>
              <strong>Search String:</strong><br>
              <code style="word-break:break-all;">${searchString}</code><br>
              <strong>Alexandria HQ Logs URL:</strong><br>
              <a href="${fullUrl}" target="_blank">${fullUrl}</a>
              <hr>
            `;
            networkDataContainer.appendChild(entryElement);
          });
      });
    });
  }

  // Fetch network data for the current site and show in popup
  function fetchNetworkData(activeDomain) {
    chrome.runtime.sendMessage({ action: 'getNetworkData' }, (response) => {
      if (response?.data) {
        displayNetworkData(response.data, activeDomain);
      } else {
        networkDataContainer.innerHTML = 'No network data captured.';
      }
    });
  }

  // --- Initialize the popup UI on load ---
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    if (!activeTab) return;

    currentTabId = activeTab.id;
    const activeDomain = getDomain(activeTab.url);

    loadSites(activeDomain);         // Load or add active site
    populateEnvInfo(activeTab.id);   // Request and render env info
    fetchNetworkData(activeDomain);  // Show network activity
  });
});
