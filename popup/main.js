/**
 * @file        main.js
 * @description Popup bootstrapper: initializes UI chrome, hydrates data from background, and wires periodic polling.
 *
 * @summary
 *  Functions:
 *    - bootstrapPopup(): Entry point that prepares tabs, auth state, environment info, and polling loop.
 *    - hydrateEnvInfo(): Load cached and fresh environment context from the background script.
 *    - refreshNetworkData(): Fetch latest captured requests, render logs/visualizations, and sync state.
 *    - wireControls(): Hook Clear/Download/Refresh buttons to session/state operations.
 *    - resolveActiveTab(): Identify the currently active browser tab to scope network capture.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import {
  markInitialized,
  isInitialized,
  setPopupIdentity,
  updateSession,
  getState,
  setEnvInfo,
  setLastDataHash,
  getLastDataHash,
  setCurrentDomain,
  setWorkstationId,
  isUpdatingFlag,
  setUpdating,
  setUtcOffset,
  getUtcOffset,
  subscribe
} from './state.js';
import { initializeTabs } from './tabs.js';
import { initializeCollapsibles } from './collapsible.js';
import { renderEnvInfo, renderEnvInfoLoading } from './envInfo.js';
import { renderLogsTab } from './logsTab.js';
import { extractUserDetails, renderUserDetails } from './userDetailsTab.js';
import { renderVisualization } from './visualizationTab.js';
import { initializeAIInsights, populateAuthState } from './aiInsightsTab.js';
import {
  initializePopupIdentity,
  fetchNetworkData,
  clearNetworkData,
  requestCachedEnvInfo,
  requestFreshEnvInfo,
  getCookieValue
} from './runtimeClient.js';
import { createSessionSummary } from './sessionProcessor.js';
import { createDataHash, normalizeUtcOffset, formatUtcOffsetForInput } from './utils.js';
import { DOM_IDS, POPUP_POLL_INTERVAL_MS } from './constants.js';

let pollHandle = null;

export async function bootstrapPopup() {
  if (isInitialized()) return;
  markInitialized();

  initializeTabs();
  initializeCollapsibles();
  initializeSettingsControls();
  setupUtcOffsetSubscription();
  initializeAIInsights();
  populateAuthState();
  renderEnvInfoLoading();

  try {
    const identity = await initializePopupIdentity();
    setPopupIdentity(identity);
  } catch (error) {
    console.error('[LogEasy] Failed to initialize popup identity', error);
  }

  await hydrateEnvInfo();
  await refreshNetworkData();
  startPolling();
  wireControls();
}

async function hydrateEnvInfo() {
  try {
    const cached = await requestCachedEnvInfo();
    if (cached) {
      setEnvInfo(cached);
      renderEnvInfo(cached);
    }
  } catch (error) {
    console.warn('[LogEasy] Failed to load cached env info', error);
  }

  try {
    const fresh = await requestFreshEnvInfo();
    if (fresh) {
      setEnvInfo(fresh);
      renderEnvInfo(fresh);
    }
  } catch (error) {
    console.warn('[LogEasy] Failed to fetch fresh env info', error);
  }
}

async function refreshNetworkData() {
  if (isUpdatingFlag()) return;
  setUpdating(true);

  try {
    const tabInfo = await resolveActiveTab();
    if (!tabInfo) {
      setCurrentDomain(null);
      setWorkstationId('N/A');
      setLastDataHash('no-domain');
      renderLogsTab(null);
      renderVisualization(null);
      renderUserDetails(null);
      return;
    }

    setCurrentDomain(tabInfo.domain);

    const [requests = [], workstationCookie] = await Promise.all([
      fetchNetworkData().catch(() => []),
      getCookieValue(`${tabInfo.protocol}//${tabInfo.domain}`, 'workstation-id').catch(() => null)
    ]);

    const dataHash = createDataHash(requests);
    if (dataHash === getLastDataHash()) {
      return;
    }
    setLastDataHash(dataHash);

    const summary = createSessionSummary(requests, tabInfo.domain);
    if (!summary) {
      updateSession(null);
      renderLogsTab(null);
      renderVisualization(null);
      renderUserDetails(null);
      setWorkstationId(workstationCookie || 'N/A');
      return;
    }
    summary.dataSignature.hash = dataHash;

    updateSession(summary);

    const workstationId = summary.workstationId !== 'N/A' ? summary.workstationId : (workstationCookie || 'N/A');
    summary.workstationId = workstationId;
    setWorkstationId(workstationId);

    if (summary.utcOffset) {
      setUtcOffset(summary.utcOffset, 'auto');
    }

    const effectiveOffset = getUtcOffset();
    if (effectiveOffset) {
      summary.utcOffset = effectiveOffset;
    }

    renderLogsTab(summary);
    renderVisualization(summary);
    renderUserDetails(extractUserDetails(summary.requests));
  } catch (error) {
    console.error('[LogEasy] Failed to refresh network data', error);
  } finally {
    setUpdating(false);
  }
}

function startPolling() {
  stopPolling();
  pollHandle = setInterval(refreshNetworkData, POPUP_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

function setupUtcOffsetSubscription() {
  subscribe('utc-offset', handleUtcOffsetChange);
}

function handleUtcOffsetChange(offset) {
  const offsetInput = document.getElementById('user-utc-offset');
  if (offsetInput) {
    const formatted = formatUtcOffsetForInput(offset);
    if (formatted !== undefined) {
      offsetInput.value = formatted;
    }
  }
  rerenderCurrentSession();
}

function initializeSettingsControls() {
  const offsetInput = document.getElementById('user-utc-offset');
  const applyButton = document.getElementById('set-utc-offset');
  const siteSelector = document.getElementById('site-selector');
  const siteInput = document.getElementById('site-input');
  const addSiteBtn = document.getElementById('add-site');
  const sideSelector = document.getElementById('side-selector');
  const customSideInput = document.getElementById('custom-side');
  const exportHarBtn = document.getElementById('export-har');
  const exportCsvBtn = document.getElementById('export-csv');
  const importHarBtn = document.getElementById('import-har');
  const harFileInput = document.getElementById('har-file-input');
  if (!offsetInput) return;
  if (offsetInput.dataset.bound === 'true') return;
  offsetInput.dataset.bound = 'true';

  const currentOffset = getUtcOffset();
  const formattedCurrent = currentOffset ? formatUtcOffsetForInput(currentOffset) : '';
  if (formattedCurrent) {
    offsetInput.value = formattedCurrent;
  } else if (offsetInput.value) {
    const normalized = normalizeUtcOffset(offsetInput.value);
    if (normalized) {
      setUtcOffset(normalized, 'auto');
      offsetInput.value = formatUtcOffsetForInput(normalized);
    }
  }

  const applyOffset = () => {
    const normalized = normalizeUtcOffset(offsetInput.value);
    if (!normalized) {
      alert('Enter a valid UTC offset using +/-HHMM or +/-HH:MM format.');
      return;
    }
    offsetInput.value = formatUtcOffsetForInput(normalized);
    setUtcOffset(normalized, 'manual');
  };

  applyButton?.addEventListener('click', applyOffset);
  offsetInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyOffset();
    }
  });

  // --- Site management ---
  if (siteSelector && !siteSelector.dataset.bound) {
    siteSelector.dataset.bound = 'true';
    const applyCurrentDomain = () => populateSiteSelector(siteSelector, getState().currentDomain);
    subscribe('session-update', applyCurrentDomain);
    applyCurrentDomain();
  }

  if (addSiteBtn && !addSiteBtn.dataset.bound) {
    addSiteBtn.dataset.bound = 'true';
    addSiteBtn.addEventListener('click', () => tryAddSite(siteInput, siteSelector));
  }

  if (siteInput && !siteInput.dataset.bound) {
    siteInput.dataset.bound = 'true';
    siteInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        tryAddSite(siteInput, siteSelector);
      }
    });
  }

  if (sideSelector && customSideInput && !sideSelector.dataset.bound) {
    sideSelector.dataset.bound = 'true';
    const toggleCustomSide = () => {
      const useCustom = sideSelector.value === 'Other';
      customSideInput.style.display = useCustom ? '' : 'none';
      if (!useCustom) {
        customSideInput.value = '';
      }
    };
    sideSelector.addEventListener('change', toggleCustomSide);
    toggleCustomSide();
  }

  // --- Export / Import controls ---
  if (exportHarBtn && !exportHarBtn.dataset.bound) {
    exportHarBtn.dataset.bound = 'true';
    exportHarBtn.addEventListener('click', () => handleExportHar());
  }

  if (exportCsvBtn && !exportCsvBtn.dataset.bound) {
    exportCsvBtn.dataset.bound = 'true';
    exportCsvBtn.addEventListener('click', () => handleExportCsv());
  }

  if (importHarBtn && harFileInput && !importHarBtn.dataset.bound) {
    importHarBtn.dataset.bound = 'true';
    importHarBtn.addEventListener('click', () => harFileInput.click());
  }

  if (harFileInput && !harFileInput.dataset.bound) {
    harFileInput.dataset.bound = 'true';
    harFileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0] ?? null;
      if (file) {
        importHarFile(file)
          .then(count => {
            alert(`Successfully imported ${count} requests from HAR file.`);
            refreshNetworkData();
          })
          .catch(error => {
            console.error('[LogEasy] Failed to import HAR', error);
            alert(`Failed to import HAR file: ${error.message || error}`);
          })
          .finally(() => {
            harFileInput.value = '';
          });
      }
    });
  }
}

function rerenderCurrentSession() {
  const session = getState().currentSession;
  if (session) {
    const currentOffset = getUtcOffset();
    session.utcOffset = currentOffset ?? session.utcOffset ?? null;
    renderLogsTab(session);
    renderVisualization(session);
    renderUserDetails(extractUserDetails(session.requests));
  } else {
    renderLogsTab(null);
    renderVisualization(null);
    renderUserDetails(null);
  }
}

function populateSiteSelector(siteSelector, activeDomain) {
  if (!siteSelector) return;
  chrome.storage.local.get({ sites: [] }, ({ sites }) => {
    let updatedSites = Array.isArray(sites) ? [...sites] : [];
    if (activeDomain && activeDomain !== 'N/A' && !updatedSites.includes(activeDomain)) {
      updatedSites.unshift(activeDomain);
      chrome.storage.local.set({ sites: updatedSites });
    }

    const listToRender = updatedSites;
    const fragment = document.createDocumentFragment();
    listToRender.forEach(site => {
      const option = document.createElement('option');
      option.value = site;
      option.textContent = site;
      fragment.appendChild(option);
    });
    siteSelector.innerHTML = '';
    siteSelector.appendChild(fragment);
    if (activeDomain && listToRender.includes(activeDomain)) {
      siteSelector.value = activeDomain;
    }
  });
}

function tryAddSite(inputElement, siteSelector) {
  if (!inputElement) return;
  const rawValue = inputElement.value.trim();
  if (!rawValue) return;

  chrome.storage.local.get({ sites: [] }, ({ sites }) => {
    if (!sites.includes(rawValue)) {
      sites.push(rawValue);
      chrome.storage.local.set({ sites }, () => populateSiteSelector(siteSelector, rawValue));
    } else {
      populateSiteSelector(siteSelector, rawValue);
    }
  });

  inputElement.value = '';
}

async function handleExportHar() {
  try {
    const data = await fetchNetworkData();
    if (!Array.isArray(data) || data.length === 0) {
      alert('No network data available to export.');
      return;
    }
    downloadHar(data, 'settings-export');
  } catch (error) {
    console.error('[LogEasy] Failed to export HAR', error);
    alert('Unable to export HAR. See console for details.');
  }
}

async function handleExportCsv() {
  try {
    const data = await fetchNetworkData();
    if (!Array.isArray(data) || data.length === 0) {
      alert('No network data available to export.');
      return;
    }
    downloadCsv(data);
  } catch (error) {
    console.error('[LogEasy] Failed to export CSV', error);
    alert('Unable to export CSV. See console for details.');
  }
}

function downloadHar(data, typeLabel) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `q2-easy-log-${typeLabel}-${timestamp}.har`;

  const harPayload = {
    log: {
      version: '1.2',
      creator: {
        name: 'Q2 LogEasy',
        version: '1.0'
      },
      entries: data.map(entry => ({
        startedDateTime: entry.startTime ? new Date(entry.startTime).toISOString() : new Date().toISOString(),
        time: entry.endTime && entry.startTime ? entry.endTime - entry.startTime : 0,
        request: {
          method: entry.method || 'GET',
          url: entry.url || '',
          httpVersion: 'HTTP/1.1',
          headers: Array.isArray(entry.requestHeaders) ? entry.requestHeaders.map(h => ({ name: h.name, value: h.value })) : [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1,
          postData: entry.postData ? { text: typeof entry.postData === 'string' ? entry.postData : JSON.stringify(entry.postData) } : undefined
        },
        response: {
          status: entry.statusCode || 0,
          statusText: entry.statusText || '',
          httpVersion: 'HTTP/1.1',
          headers: Array.isArray(entry.responseHeaders) ? entry.responseHeaders.map(h => ({ name: h.name, value: h.value })) : [],
          cookies: [],
          content: {
            size: entry.responseSize || 0,
            mimeType: entry.mimeType || 'application/json',
            text: typeof entry.responseBody === 'string' ? entry.responseBody : JSON.stringify(entry.responseBody ?? '')
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: entry.responseSize || -1
        },
        cache: {},
        timings: {
          wait: entry.endTime && entry.startTime ? entry.endTime - entry.startTime : 0
        }
      }))
    }
  };

  const blob = new Blob([JSON.stringify(harPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `q2-easy-log-summary-${timestamp}.csv`;
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

  const rows = data.map(entry => [
    entry.startTime ? new Date(entry.startTime).toISOString() : '',
    entry.method || '',
    entry.url || '',
    entry.statusCode ?? '',
    entry.startTime && entry.endTime ? entry.endTime - entry.startTime : '',
    entry.responseSize ?? '',
    entry.q2token ?? '',
    entry.workstationId ?? '',
    entry.fi_no ?? '',
    entry.error ?? ''
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function importHarFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed?.log?.entries || !Array.isArray(parsed.log.entries)) {
          reject(new Error('Invalid HAR file format.'));
          return;
        }

        const importedData = parsed.log.entries.map((entry, index) => {
          const startTime = entry.startedDateTime ? Date.parse(entry.startedDateTime) : Date.now();
          const waitTime = typeof entry.time === 'number' ? entry.time : 0;
          const requestHeaders = Array.isArray(entry.request?.headers) ? entry.request.headers : [];

          return {
            requestId: `imported-${Date.now()}-${index}`,
            url: entry.request?.url || '',
            method: entry.request?.method || 'GET',
            startTime,
            endTime: startTime + waitTime,
            statusCode: entry.response?.status ?? 0,
            responseSize: entry.response?.bodySize ?? entry.response?.headersSize ?? 0,
            requestHeaders,
            responseHeaders: Array.isArray(entry.response?.headers) ? entry.response.headers : [],
            q2token: requestHeaders.find(h => h.name?.toLowerCase() === 'q2token')?.value || null,
            workstationId: requestHeaders.find(h => h.name?.toLowerCase() === 'workstation-id')?.value || null,
            fi_no: extractFiNo(entry.request?.url),
            isLogonUser: (entry.request?.url || '').includes('logonUser?'),
            responseBody: entry.response?.content?.text ?? null,
            responseMimeType: entry.response?.content?.mimeType ?? null
          };
        });

        chrome.runtime.sendMessage({ action: 'importHARData', data: importedData }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.success) {
            reject(new Error('Background import was unsuccessful.'));
            return;
          }
          resolve(importedData.length);
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Failed to read HAR file.'));
    };

    reader.readAsText(file);
  });
}

function extractFiNo(url) {
  if (!url) return null;
  const match = url.match(/cdn\/deport\/([^/]+)/);
  return match ? match[1] : null;
}

function wireControls() {
  document.getElementById(DOM_IDS.clearButton)?.addEventListener('click', async () => {
    const sessionId = getState().currentSession?.sessionId;
    await clearNetworkData(sessionId);
    updateSession(null);
    setLastDataHash(null);
    setWorkstationId('N/A');
    renderLogsTab(null);
    renderVisualization(null);
    renderUserDetails(null);
  });

  document.getElementById(DOM_IDS.downloadButton)?.addEventListener('click', () => {
    const session = getState().currentSession;
    if (!session) {
      alert('No session data available to download.');
      return;
    }
    downloadSessionRequests(session.requests);
  });

  document.getElementById(DOM_IDS.refreshUser)?.addEventListener('click', () => {
    const session = getState().currentSession;
    renderUserDetails(session ? extractUserDetails(session.requests) : null);
  });
}

function downloadSessionRequests(requests) {
  const blob = new Blob([JSON.stringify(requests, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `logeasy-session-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function resolveActiveTab() {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs?.[0];
        if (!tab?.url) {
          resolve(null);
          return;
        }
        try {
          const parsed = new URL(tab.url);
          resolve({
            tabId: tab.id,
            url: tab.url,
            domain: parsed.hostname,
            protocol: parsed.protocol
          });
        } catch {
          resolve(null);
        }
      });
    } catch (error) {
      console.warn('[LogEasy] Failed to resolve active tab', error);
      resolve(null);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapPopup);
} else {
  bootstrapPopup();
}




