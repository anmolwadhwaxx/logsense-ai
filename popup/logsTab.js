/**
 * @file        logsTab.js
 * @description Render the Network Logs tab: session summary, request list, and Alexandria log shortcuts.
 *
 * @summary
 *  Functions:
 *    - renderLogsTab(summary): Populate summary headers and network request list for the active session.
 *    - buildSummaryMarkup(summary, alexandria): Compose summary HTML, including Alexandria log links.
 *    - renderRequestList(container, requests): Paint collapsible request entries with status/timing indicators.
 *    - bindRequestInteractions(container, requests): Attach expand/copy/download handlers for request rows.
 *    - persistAlexandriaContext(summary, alexandria): Cache log query context for downstream AI workflows.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { DOM_IDS, DOM_SELECTORS } from './constants.js';
import {
  formatDateTimeWithOffset,
  formatUtcOffsetLabel,
  escapeHtml,
  formatJsonResponse,
  generateUid,
  toggleElementVisibility,
  triggerJsonDownload
} from './utils.js';
import { buildAlexandriaQueries, selectDisplayRequests } from './sessionProcessor.js';
import { getUtcOffset } from './state.js';

export function renderLogsTab(summary) {
  const summarySection = document.querySelector(DOM_SELECTORS.sessionSummarySection);
  const summaryContainer = document.getElementById(DOM_IDS.sessionSummaryContainer);
  const networkContainer = document.getElementById(DOM_IDS.networkContainer);

  if (!summary || !summaryContainer || !networkContainer) {
    hideSummarySection(summarySection, networkContainer);
    return { displayRequests: [] };
  }

  const alexandria = buildAlexandriaQueries(summary);
  const activeOffset = getUtcOffset() ?? summary.utcOffset ?? null;
  persistAlexandriaContext(summary, alexandria, activeOffset);

  showSummarySection(summarySection);
  summaryContainer.innerHTML = buildSummaryMarkup(summary, alexandria, activeOffset);

  const displayRequests = selectDisplayRequests(summary.requests);
  renderRequestList(networkContainer, displayRequests, activeOffset);
  bindRequestInteractions(networkContainer, displayRequests);

  return { displayRequests };
}

function buildSummaryMarkup(summary, alexandria, offset) {
  const { formattedStart, formattedEnd, urls } = alexandria;
  const environmentLabel = summary.isStaging ? 'Staging' : 'Production';
  const displayStart = formatDateTimeWithOffset(summary.startTime, offset, { includeLabel: true });
  const displayEnd = formatDateTimeWithOffset(summary.endTime, offset, { includeLabel: true });
  const offsetLabel = formatUtcOffsetLabel(offset);

  return `
    <div class="session-summary">
      <div class="summary-grid">
        ${summaryItem('Total Requests', summary.totalRequests)}
        ${summaryItem('Session ID', summary.sessionId)}
        ${summaryItem('Workstation ID', summary.workstationId)}
        ${summaryItem('Environment', environmentLabel)}
        ${summaryItem('UTC Offset', offsetLabel)}
        ${summaryItem('Start Time', displayStart)}
        ${summaryItem('End Time', displayEnd)}
      </div>
      <div class="log-buttons">
        ${logButton('HQ Logs', urls.hq, 'hq-log')}
        ${logButton('LightBridge Logs', urls.lightbridge, 'lb-log')}
        ${logButton('Kamino Logs', urls.kamino, 'kamino-log')}
        ${logButton('Ardent Logs', urls.ardent, 'ardent-log')}
      </div>
    </div>
  `;
}

function renderRequestList(container, requests, offset) {
  const collapsibleContent = container?.parentElement;
  const collapsibleButton = collapsibleContent?.previousElementSibling;

  if (!requests || requests.length === 0) {
    disableCollapsible(collapsibleContent, collapsibleButton, container);
    return;
  }

  enableCollapsible(collapsibleContent, collapsibleButton);
  container.innerHTML = requests.map(request => buildRequestMarkup(request, offset)).join('');
}

function buildRequestMarkup(entry, offset) {
  const url = entry.url || 'N/A';
  const method = entry.method || 'N/A';
  const status = entry.statusCode ?? 'N/A';
  const time = entry.endTime && entry.startTime
    ? `${(entry.endTime - entry.startTime).toFixed(2)} ms`
    : 'N/A';
  const fiNo = entry.fi_no || 'N/A';
  const start = formatDateTimeWithOffset(entry.startTime, offset, { includeLabel: true });
  const statusColor = getStatusColor(status);

  const isLogonUser = Boolean(
    url.includes('logonUser?') || entry.isLogonUser || entry.isLogonUserCapture
  );
  const hasResponseBody = Boolean(entry.responseBody && entry.responseBody.trim().length > 0);

  let logonUserContext = '';
  if (isLogonUser) {
    try {
      const urlObj = new URL(url, window.location.origin);
      const params = urlObj.searchParams;
      const wsParam = params.get('ws') || url.match(/ws\d+/)?.[0] || '';
      const requestSource = entry.isLogonUserCapture ? 'Response Captured' : 'Request Detected';
      const timestamp = entry.startTime ? new Date(entry.startTime).toLocaleTimeString() : '';
      const contextParts = [requestSource];
      if (wsParam) contextParts.push(wsParam);
      if (timestamp) contextParts.push(timestamp);
      logonUserContext = ` (${contextParts.join(', ')})`;
    } catch {
      const requestSource = entry.isLogonUserCapture ? 'Response Captured' : 'Request Detected';
      logonUserContext = ` (${requestSource})`;
    }
  }

  const responseId = generateUid('response-body');
  const rawResponseBody = typeof entry.responseBody === 'string'
    ? entry.responseBody
    : JSON.stringify(entry.responseBody ?? '');
  const encodedResponseBody = hasResponseBody ? encodeURIComponent(rawResponseBody) : '';
  const formattedResponseBody = hasResponseBody ? escapeHtml(formatJsonResponse(rawResponseBody)) : '';

  return `
    <div class="request-item ${isLogonUser ? 'logon-user-request' : ''}">
      <div class="request-url">${escapeHtml(method)} ${escapeHtml(url)}</div>
      <div class="request-details">
        <strong>Status:</strong> <span style="color:${statusColor};font-weight:bold;">${escapeHtml(status)}</span> |
        <strong>Time:</strong> ${escapeHtml(time)} |
        <strong>Started:</strong> ${escapeHtml(start)}
        ${isLogonUser ? `<br><span class="logon-user-badge">LogonUser Request${escapeHtml(logonUserContext)}</span>` : ''}
        ${hasResponseBody ? `
          <br><button class="response-body-toggle" data-response-id="${responseId}">View Response Body</button>
          <div id="${responseId}" class="response-body-content" style="display:none;">
            <div class="response-body-header">
              LogonUser Response Body
              <button class="download-response-btn" data-response-data="${encodedResponseBody}" data-url="${escapeHtml(entry.url || '')}">Download JSON</button>
            </div>
            <pre class="response-body-text">${formattedResponseBody}</pre>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function summaryItem(label, value) {
  return `
    <div class="summary-item">
      <div class="summary-label">${escapeHtml(label)}</div>
      <div class="summary-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function logButton(label, url, className) {
  return `
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="log-button ${className}">
      ${escapeHtml(label)}
    </a>
  `;
}

function hideSummarySection(sectionElement, networkContainer) {
  if (sectionElement) {
    sectionElement.classList.add('hidden');
  }
  if (networkContainer) {
    networkContainer.innerHTML = buildEmptyRequestMessage();
  }
}

function showSummarySection(sectionElement) {
  if (sectionElement) {
    sectionElement.classList.remove('hidden');
  }
}

function disableCollapsible(content, button, container) {
  if (content) {
    content.style.display = 'none';
  }
  if (button) {
    button.classList.remove('active');
    button.style.opacity = '0.5';
    button.style.cursor = 'not-allowed';
  }
  if (container) {
    container.innerHTML = buildEmptyRequestMessage();
  }
}

function enableCollapsible(content, button) {
  if (content) {
    content.style.display = '';
  }
  if (button) {
    button.style.opacity = '1';
    button.style.cursor = 'pointer';
  }
}

function buildEmptyRequestMessage() {
  return `
    <div class="empty-state">
      <div class="empty-state-title">No network requests captured yet.</div>
      <div class="empty-state-body">
        Perform an action in the active tab or verify that the session contains traffic with a q2token.
      </div>
    </div>
  `;
}

function getStatusColor(status) {
  const numeric = Number(status);
  if (Number.isNaN(numeric)) return '#666';
  if (numeric >= 200 && numeric < 300) return '#28a745';
  if (numeric >= 300 && numeric < 400) return '#ffc107';
  if (numeric >= 400) return '#dc3545';
  return '#666';
}

function bindRequestInteractions(container, requests) {
  container.querySelectorAll('.response-body-toggle').forEach(button => {
    button.addEventListener('click', event => {
      const target = event.currentTarget;
      const responseId = target.dataset.responseId;
      const element = document.getElementById(responseId);
      if (!element) return;

      toggleElementVisibility(element);
      const expanded = element.style.display !== 'none';
      target.textContent = expanded ? 'Hide Response Body' : 'View Response Body';
      target.classList.toggle('active', expanded);
    });
  });

  container.querySelectorAll('.download-response-btn').forEach(button => {
    button.addEventListener('click', event => {
      const target = event.currentTarget;
      const body = target.dataset.responseData;
      const url = target.dataset.url;
      if (!body) return;
      downloadResponse(body, url);
    });
  });
}

function downloadResponse(body, url) {
  try {
    let decoded = body;
    try {
      decoded = decodeURIComponent(body);
    } catch {
      decoded = body;
    }

    let parsed = decoded;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // If the decoded string still represents JSON within a string, try one more time
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          // leave as string
        }
      }
    }

    const payload = {
      metadata: {
        capturedAt: new Date().toISOString(),
        url,
        type: 'logonUser_response',
        source: 'Q2_Easy_Log_Extension'
      },
      response: parsed
    };
    triggerJsonDownload(`logonUser-response-${Date.now()}.json`, payload);
  } catch (error) {
    console.error('[logsTab] Failed to download response', error);
    alert('Unable to download response data.');
  }
}

function persistAlexandriaContext(summary, alexandria, offset) {
  window.environmentSearchStrings = {
    sessionId: summary.sessionId,
    workstationId: summary.workstationId,
    isStaging: summary.isStaging,
    utcOffset: offset ?? null,
    formattedStart: alexandria.formattedStart,
    formattedEnd: alexandria.formattedEnd,
    indices: alexandria.indices,
    searchStrings: alexandria.searchStrings
  };
}

