let currentTabId = null;

document.addEventListener('DOMContentLoaded', function () {
  const networkDataContainer = document.getElementById('network-data');
  const clearButton = document.getElementById('clear-button');
  const siteSelector = document.getElementById('site-selector');
  const siteInput = document.getElementById('site-input');
  const addSiteBtn = document.getElementById('add-site');

  // Collapsible section logic
  const coll = document.querySelector(".collapsible");
  const content = document.querySelector(".collapsible-content");
  if (coll && content) {
    coll.addEventListener("click", () => {
      content.style.display = content.style.display === "block" ? "none" : "block";
    });
  }

  // Helper: Get domain from URL string
  function getDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Fetch environment info by injecting script into active tab
  function fetchEnvInfo(callback) {
    chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => {
        function readCookie(name) {
          const nameEQ = name + "=";
          const ca = document.cookie.split(';');
          for (let i = 0; i < ca.length; i++) {
            let c = ca[i].trim();
            if (c.indexOf(nameEQ) === 0) {
              return c.substring(nameEQ.length);
            }
          }
          return null;
        }

        const tct = (typeof Tecton === "object" && Tecton !== null)
          ? Tecton
          : { TECTON_PLATFORM_VERSION: "N/A", TECTON_SDK_VERSION: "N/A" };

        return {
          version: (typeof Ngam !== "undefined" && Ngam && Ngam.appVersion)
            ? Ngam.appVersion : "N/A",
          theme: readCookie("themeName")
            || ((typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.themeName) ? Q2_CONFIG.themeName : "N/A"),
          language: readCookie("languageCode") || "N/A",
          cdnBaseUrl: (typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.cdnBaseUrl)
            ? Q2_CONFIG.cdnBaseUrl : "N/A",
          cdnCustomerNumber: (typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.cdnCustomerNumber)
            ? Q2_CONFIG.cdnCustomerNumber : "N/A",
          tectonPlatformVersion: tct.TECTON_PLATFORM_VERSION,
          tectonSdkVersion: tct.TECTON_SDK_VERSION
        };
      }
    }, (results) => {
      if (results && results[0] && results[0].result) {
        callback(results[0].result);
      } else {
        callback(null);
      }
    });
  }

  // Populate environment info UI
  function populateEnvInfo() {
    const envInfoEl = document.getElementById("env-info");
    fetchEnvInfo((info) => {
      if (!info) {
        envInfoEl.textContent = "Could not retrieve environment info.";
        return;
      }
      envInfoEl.textContent =
        `**** UUX Info ****
Version: ${info.version}
Theme: ${info.theme}
Language: ${info.language}

**** Tecton Info ****
Platform Version: ${info.tectonPlatformVersion}
SDK Version: ${info.tectonSdkVersion}

**** CDN Info ****
Base URL: ${info.cdnBaseUrl}
Customer #: ${info.cdnCustomerNumber}`;
    });
  }

  // Load saved sites and add active domain if missing
  function loadSites(activeDomain) {
    chrome.storage.local.get({ sites: [] }, ({ sites }) => {
      if (activeDomain && !sites.includes(activeDomain)) {
        sites.unshift(activeDomain);
        chrome.storage.local.set({ sites });
      }

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

  // Add new site from input field
  addSiteBtn.addEventListener('click', () => {
    const site = siteInput.value.trim();
    if (site) {
      chrome.storage.local.get({ sites: [] }, ({ sites }) => {
        if (!sites.includes(site)) {
          sites.push(site);
          chrome.storage.local.set({ sites }, () => loadSites(site));
        }
      });
      siteInput.value = '';
    }
  });

  // Clear network data button handler
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'clearNetworkData' }, () => {
        networkDataContainer.innerHTML = '';
      });
    });
  }

  // Format timestamp as MM/DD/YYYY:HH:mm:ss GMT/UTC
  function formatDateTime(ts) {
    if (!ts) return 'N/A';
    const date = new Date(ts);
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  // Get protocol from URL (fallback https:)
  function getProtocol(url) {
    try {
      return new URL(url).protocol;
    } catch {
      return 'https:';
    }
  }

  // Display network data filtered by activeDomain (site)
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

      // Get the current 'workstation-id' cookie for the domain
      chrome.cookies.get({ url: cookieUrl, name: 'workstation-id' }, function (cookie) {
        let latestWorkstationId = cookie && cookie.value ? cookie.value : 'N/A';

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
            // Extract workstation-id
            let workstationId = 'N/A';
            if (entry.requestHeaders) {
              const cookieHeader = entry.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
              if (cookieHeader && cookieHeader.value) {
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

            const url = entry.url || 'N/A';
            const method = entry.method || 'N/A';
            const status = entry.statusCode || 'N/A';
            const time = (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime).toFixed(2) : 'N/A';
            const q2token = entry.q2token;
            const fi_no = entry.fi_no || 'N/A';

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

            const endTime = startTime ? startTime + 30 * 60 * 1000 : null;
            const formattedStart = formatDateTime(startTime);
            const formattedEnd = formatDateTime(endTime);
            const logIndex = url.includes('temporary') ? 'app_logs_stage_hq' : 'app_logs_prod_hq';
            const searchString = `search index="${logIndex}"  sessionId="${q2token}"  earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
            const baseUrl = "https://alexandria.shs.aws.q2e.io/logs/";
            const fullUrl = baseUrl + encodeURIComponent(searchString);

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
              <strong>Start Time :</strong> ${formattedStart} GMT<br>
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

  // Fetch network data for current active domain/site
  function fetchNetworkData(activeDomain) {
    chrome.runtime.sendMessage({ action: 'getNetworkData' }, (response) => {
      if (response && response.data) {
        displayNetworkData(response.data, activeDomain);
      } else {
        networkDataContainer.innerHTML = 'No network data captured.';
      }
    });
  }

  // Initialize popup: get active tab, load sites, show env info, fetch data
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    if (!activeTab) return;

    currentTabId = activeTab.id;
    const activeDomain = getDomain(activeTab.url);

    loadSites(activeDomain);
    populateEnvInfo();
    fetchNetworkData(activeDomain);
  });
});
