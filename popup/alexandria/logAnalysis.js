/**
 * @file        logAnalysis.js
 * @description Alexandria log-analysis controller for the AI Insights tab: handles token wiring, per-environment queries, prompt previews, and result rendering.
 *
 * @summary
 *  Functions:
 *    - configureLogAnalysis(options): Seed token/time-filter state and expose window helpers.
 *    - summarizeAllEnvironments(): Run sequential Alexandria queries across HQ/Kamino/LightBridge/Ardent.
 *    - summarizeEnvironment(environment): Execute a single-environment analysis with prompt preview + results.
 *    - runEnvironmentAnalysis(environment, context, token, options): Build queries, prompts, and call Alexandria APIs.
 *    - displayEnvironmentResult()/displaySingleEnvironmentAnalysis(): Render environment cards and download/copy controls.
 *    - downloadAllEnvironmentLogs(): Trigger individual HAR downloads for each analyzed environment.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { escapeHtml, formatDateTime } from '../utils.js';
import { getState, getAuthToken, getWorkstationId } from '../state.js';
import { selectLogsForAnalysis, buildLogSummary } from './helpers.js';

const DEFAULT_TIME_FILTER = '-8h';
const ENVIRONMENT_ORDER = ['HQ', 'Kamino', 'LightBridge', 'Ardent'];
const ENVIRONMENT_KEY_MAP = {
  HQ: 'hq',
  Kamino: 'kamino',
  LightBridge: 'lightbridge',
  Ardent: 'ardent'
};

let authToken = null;
let lastAnalysisResults = null;
let environmentContextCache = null;
let customTimeFilter = DEFAULT_TIME_FILTER;
let timeFilterLabel = DEFAULT_TIME_FILTER;
let environmentResultsMap = new Map();
let currentPromptDetails = null;

export function configureLogAnalysis(options = {}) {
  const { token, customTimeFilter: filter } = options;
  if (token) {
    authToken = token;
  }
  if (filter === null) {
    setCustomTimeFilter(DEFAULT_TIME_FILTER);
  } else if (typeof filter === 'string' && filter.trim()) {
    setCustomTimeFilter(filter.trim());
  }
  attachGlobalHelpers();
  setCustomTimeFilter(customTimeFilter);
}

export function announceToken(token) {
  authToken = token || null;
}

export function wireLogAnalysisButtons() {
  bindClick('summarize-logs', () => summarizeAllEnvironments());
  bindClick('summarize-hq-logs', () => summarizeEnvironment('HQ'));
  bindClick('summarize-kamino-logs', () => summarizeEnvironment('Kamino'));
  bindClick('summarize-lightbridge-logs', () => summarizeEnvironment('LightBridge'));
  bindClick('summarize-ardent-logs', () => summarizeEnvironment('Ardent'));
  bindClick('parse-time-query', () => parseTimeQuery());
}

export function getLastLogAnalysis() {
  return lastAnalysisResults;
}

export function getCurrentTimeFilter() {
  return customTimeFilter;
}

export function getTimeFilterLabel() {
  return timeFilterLabel;
}

export function invalidateEnvironmentCache() {
  environmentContextCache = null;
  if (typeof window !== 'undefined') {
    delete window.environmentSearchStrings;
  }
}

export async function summarizeAllEnvironments() {
  const container = ensureContainer();
  const token = await ensureTokenWithAlert();
  if (!token) return;

  const context = resolveEnvironmentContext();
  if (!context) {
    container.innerHTML = renderSessionError();
    attachSessionErrorActions(container);
    return;
  }

  environmentResultsMap = new Map();
  renderComprehensiveLayout(container);

  const results = {};
  const aggregatedLogs = [];

  for (const environment of ENVIRONMENT_ORDER) {
    setEnvironmentPending(environment);
    try {
      const data = await runEnvironmentAnalysis(environment, context, token);
      results[environment] = data;
      displayEnvironmentResult(environment, data);
      storeEnvironmentData(environment, data);
      if (!data.error && !data.empty && data.rawData?.Data?.length) {
        aggregatedLogs.push(...data.rawData.Data);
      }
    } catch (error) {
      const failure = {
        environment,
        error: error.message || String(error)
      };
      results[environment] = failure;
      displayEnvironmentResult(environment, failure);
      storeEnvironmentData(environment, failure);
    }
  }

  finalizeComprehensiveResults(results, aggregatedLogs);
}

export async function summarizeEnvironment(environment) {
  const container = ensureContainer();
  const token = await ensureTokenWithAlert();
  if (!token) return;

  const context = resolveEnvironmentContext();
  if (!context) {
    container.innerHTML = renderSessionError();
    attachSessionErrorActions(container);
    return;
  }

  environmentResultsMap = new Map();
  container.innerHTML = renderSingleEnvironmentLoading(environment);

  try {
    const data = await runEnvironmentAnalysis(environment, context, token, {
      container,
      showPrompt: true
    });
    storeEnvironmentData(environment, data);
    displaySingleEnvironmentAnalysis(container, data);
  } catch (error) {
    const failure = {
      environment,
      error: error.message || String(error)
    };
    container.innerHTML = renderSingleEnvironmentError(environment, failure.error);
  }
}

export function parseTimeQuery(query) {
  const input = document.getElementById('time-query-input');
  const parsedDisplay = document.getElementById('parsed-time-display');
  const parsedValue = document.getElementById('parsed-time-value');

  const sourceQuery = typeof query === 'string' && query.trim()
    ? query.trim()
    : input?.value?.trim();

  if (!sourceQuery) {
    alert('Please enter a time query first.');
    return null;
  }

  const parsed = parseTimeQueryString(sourceQuery);
  if (!parsed) {
    alert('Could not parse the time query. Try formats like "last 10 minutes", "past 2 hours", or "30 mins ago".');
    if (parsedDisplay) parsedDisplay.style.display = 'none';
    return null;
  }

  setCustomTimeFilter(parsed);

  if (parsedValue) parsedValue.textContent = parsed;
  if (parsedDisplay) parsedDisplay.style.display = 'block';

  return parsed;
}

export function parseTimeQueryString(query) {
  const lowerQuery = query.toLowerCase();

  const patterns = [
    { regex: /(?:last|past)\s+(\d+)\s+(?:minutes?|mins?)/, unit: 'm' },
    { regex: /(?:last|past)\s+(\d+)\s+(?:hours?|hrs?)/, unit: 'h' },
    { regex: /(?:last|past)\s+(\d+)\s+(?:days?)/, unit: 'd' },
    { regex: /(\d+)\s+(?:minutes?|mins?)\s+ago/, unit: 'm' },
    { regex: /(\d+)\s+(?:hours?|hrs?)\s+ago/, unit: 'h' },
    { regex: /(\d+)\s+(?:days?)\s+ago/, unit: 'd' },
    { regex: /(\d+)([mhd])(?:\s|$)/, unit: null }
  ];

  for (const pattern of patterns) {
    const match = lowerQuery.match(pattern.regex);
    if (match) {
      const value = match[1];
      const unit = pattern.unit || match[2];
      return `-${value}${unit}`;
    }
  }

  const fallback = lowerQuery.match(/(\d+)/);
  if (fallback) {
    const value = fallback[1];
    let unit = 'm';
    if (lowerQuery.includes('hour') || lowerQuery.includes('hr')) {
      unit = 'h';
    } else if (lowerQuery.includes('day')) {
      unit = 'd';
    }
    return `-${value}${unit}`;
  }

  return null;
}

export function calculateTimeFromFilter(filter) {
  const now = new Date();
  const match = filter?.match?.(/^-(\d+)([mhd])$/);
  if (!match) return now;

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'm':
      return new Date(now.getTime() - value * 60 * 1000);
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default:
      return now;
  }
}

function ensureContainer() {
  const container = document.getElementById('log-summaries-content');
  if (!container) {
    throw new Error('Log summaries container not found.');
  }
  return container;
}

async function ensureTokenWithAlert() {
  const token = await requireAlexandriaToken();
  if (!token) {
    const container = document.getElementById('log-summaries-content');
    if (container) {
      container.innerHTML = renderAuthError();
      attachAuthErrorActions(container);
    }
  }
  return token;
}

function attachGlobalHelpers() {
  if (typeof window === 'undefined') return;
  window.downloadEnvironmentLogs = downloadEnvironmentLogs;
  window.toggleEnvironmentSummary = toggleEnvironmentSummary;
  window.toggleEnvironmentDetails = toggleEnvironmentDetails;
  window.copyEnvironmentQuery = copyEnvironmentQuery;
  window.downloadAllEnvironmentLogs = downloadAllEnvironmentLogs;
  window.copyComprehensiveResults = copyComprehensiveResults;
}

function bindClick(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.dataset.logAnalysisBound === 'true') return;
  element.dataset.logAnalysisBound = 'true';
  element.addEventListener('click', handler);
}

function renderAuthError() {
  return `
    <div class="log-summary-error" style="padding: 20px;">
      <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">Authentication Required</div>
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
      <button data-auth-action="focus-login" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Go to Login Form
      </button>
    </div>
  `;
}

function renderSessionError() {
  return `
    <div class="log-summary-error" style="padding: 20px;">
      <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">Session Data Required</div>
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
      <button data-session-action="go-network" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Go to Network Logs
      </button>
    </div>
  `;
}

function renderComprehensiveLayout(container) {
  const cards = ENVIRONMENT_ORDER.map(env => `
    <div id="result-${env.toLowerCase()}" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
      <div style="font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 14px;">${escapeHtml(env)} Environment</span>
        <div class="loading-spinner" style="width: 16px; height: 16px;"></div>
      </div>
      <div style="font-size: 12px; color: #666;">Initializing Alexandria analysis...</div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="padding: 20px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #28a745;">
        Comprehensive Log Analysis - All Environments
      </div>
      <div style="margin-bottom: 20px; font-size: 14px; color: #666;">
        Analyzing logs across HQ, Kamino, LightBridge, and Ardent environments...
      </div>
      <div id="environment-results">${cards}</div>
    </div>
  `;
}

function renderSingleEnvironmentLoading(environment) {
  const timeLabel = timeFilterLabel || customTimeFilter || DEFAULT_TIME_FILTER;
  return `
    <div style="padding: 20px; text-align: center;">
      <div style="font-size: 16px; margin-bottom: 10px;">Summarizing ${escapeHtml(environment)} Logs...</div>
      <div style="font-size: 14px; color: #666;">Time Range: ${escapeHtml(timeLabel)}</div>
      <div style="margin-top: 15px;">
        <div class="loading-spinner"></div>
      </div>
    </div>
  `;
}

function renderSingleEnvironmentError(environment, message) {
  return `
    <div style="padding: 20px; text-align: center; color: #dc3545;">
      <div style="font-size: 16px; margin-bottom: 10px;">Error summarizing ${escapeHtml(environment)} logs</div>
      <div style="font-size: 14px;">${escapeHtml(message)}</div>
    </div>
  `;
}

function displayExactPrompt(container, environment, prompt, metadata = {}) {
  currentPromptDetails = { prompt, metadata, environment };

  const promptLength = ((metadata.promptLength ?? prompt.length) || 0).toLocaleString();
  const description = metadata.description || `${environment} Environment Query`;
  const envKey = metadata.environmentKey || environment.toLowerCase();
  const timeRange = metadata.timeRange || timeFilterLabel || customTimeFilter || DEFAULT_TIME_FILTER;

  container.innerHTML = `
    <div style="padding: 20px; max-width: 100%;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #007acc;">📤 Alexandria AI Analysis Request</div>

      <div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">📋 Request Details:</div>
        <div style="margin-bottom: 6px;"><strong>Query Type:</strong> ${escapeHtml(description)}</div>
        <div style="margin-bottom: 6px;"><strong>Environment:</strong> ${escapeHtml(envKey)}</div>
        <div style="margin-bottom: 6px;"><strong>Prompt Length:</strong> ${promptLength} characters</div>
        <div style="margin-bottom: 6px;"><strong>API Endpoint:</strong> alexandria.shs.aws.q2e.io/api/v3/ai/summarize</div>
        <div style="margin-bottom: 6px;"><strong>Authentication:</strong> Bearer token (8-hour cache)</div>
        <div style="margin-bottom: 6px;"><strong>Time Range:</strong> ${escapeHtml(timeRange)}</div>
      </div>

      <div style="margin-bottom: 20px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #2e7d32;">📄 Exact Prompt Being Sent to Alexandria AI:</div>
        <div style="background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 15px; font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.4; white-space: pre-wrap; max-height: 400px; overflow-y: auto; word-break: break-word;">
${escapeHtml(prompt)}
        </div>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: #fff9c4; border: 1px solid #ffe082; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">ℹ️ How This Works:</div>
        <ol style="margin: 5px 0; padding-left: 20px;">
          <li>Extension queries Alexandria logs using your session data</li>
          <li>Intelligent log selection picks key logs (first 5 + last 5 + errors + context)</li>
          <li>Selected logs are formatted into a structured prompt</li>
          <li>Prompt is sent to Alexandria AI for analysis via POST request</li>
          <li>AI analyzes the logs and returns insights about errors, performance, etc.</li>
        </ol>
      </div>

      <div class="ai-loading" style="margin-bottom: 20px;">
        <div class="loading-spinner"></div>
        🤖 Sending request to Alexandria AI... Please wait for analysis results.
      </div>

      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button data-prompt-action="copy" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">📋 Copy Full Prompt</button>
        <button data-prompt-action="raw" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">🔍 Show Raw Data</button>
      </div>
    </div>
  `;

  attachPromptActions(container);
}

function attachPromptActions(container) {
  const copyBtn = container.querySelector('[data-prompt-action="copy"]');
  if (copyBtn && !copyBtn.dataset.listener) {
    copyBtn.dataset.listener = 'true';
    copyBtn.addEventListener('click', () => {
      if (currentPromptDetails?.prompt) {
        copyTextToClipboard(currentPromptDetails.prompt, 'Prompt copied to clipboard!');
      } else {
        alert('No prompt available to copy.');
      }
    });
  }

  const rawBtn = container.querySelector('[data-prompt-action="raw"]');
  if (rawBtn && !rawBtn.dataset.listener) {
    rawBtn.dataset.listener = 'true';
    rawBtn.addEventListener('click', () => {
      if (!currentPromptDetails?.metadata?.rawData) {
        alert('Raw log data not available for this prompt.');
        return;
      }
      const rawText = JSON.stringify(currentPromptDetails.metadata.rawData, null, 2);
      copyTextToClipboard(rawText, 'Raw log data copied to clipboard!');
    });
  }
}

function copyTextToClipboard(text, successMessage = 'Copied to clipboard!') {
  if (!text) {
    alert('Nothing to copy.');
    return;
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => alert(successMessage))
      .catch(() => fallbackCopyText(text, successMessage));
  } else {
    fallbackCopyText(text, successMessage);
  }
}

function fallbackCopyText(text, successMessage) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  alert(successMessage);
}

function setEnvironmentPending(environment) {
  const envResult = document.getElementById(`result-${environment.toLowerCase()}`);
  if (!envResult) return;

  envResult.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
      <span style="font-size: 14px;">${escapeHtml(environment)} Environment</span>
      <div class="loading-spinner" style="width: 16px; height: 16px;"></div>
    </div>
    <div style="font-size: 12px; color: #666;">Analyzing logs with Alexandria AI...</div>
  `;
}

async function runEnvironmentAnalysis(environment, context, token, options = {}) {
  const { container = null, showPrompt = false } = options;
  const envKey = ENVIRONMENT_KEY_MAP[environment];
  if (!envKey) {
    return { environment, error: `Unknown environment: ${environment}` };
  }

  const searchString = buildEnvironmentQuery(context, envKey);
  if (!searchString) {
    return {
      environment,
      empty: true,
      logCount: 0,
      selectedLogCount: 0,
      searchString: null,
      analysis: 'No query available for this environment.',
      timestamp: new Date().toISOString()
    };
  }

  const logResults = await queryAlexandriaLogs(token, searchString);
  if (!logResults?.Data?.length) {
    return {
      environment,
      empty: true,
      logCount: 0,
      selectedLogCount: 0,
      searchString,
      analysis: `No logs found for ${environment} environment in the specified time range.`,
      rawData: logResults,
      timestamp: new Date().toISOString()
    };
  }

  const selectedLogs = selectLogsForAnalysis(logResults.Data);
  let logSummaryText = buildLogSummary(environment, logResults.Data.length, selectedLogs);
  if (logResults.Data.length > selectedLogs.length) {
    const extraCount = logResults.Data.length - selectedLogs.length;
    logSummaryText = `${logSummaryText}\n\n... and ${extraCount} additional log entries.`;
  }

  if (showPrompt && container) {
    displayExactPrompt(container, environment, logSummaryText, {
      environmentKey: envKey,
      description: `${environment} Environment Query`,
      promptLength: logSummaryText.length,
      timeRange: timeFilterLabel || customTimeFilter || DEFAULT_TIME_FILTER,
      rawData: logResults
    });
  }

  const prompt = buildEnvironmentPrompt(environment, logSummaryText);
  const aiResponse = await summarizeWithAlexandria(token, prompt).catch(error => ({
    summary: `Failed to analyze logs: ${error.message}`,
    response: error.message
  }));

  const analysis = aiResponse?.summary || aiResponse?.response || 'Analysis completed.';

  return {
    environment,
    logCount: logResults.Data.length,
    selectedLogCount: selectedLogs.length,
    searchString,
    analysis,
    rawData: logResults,
    selectedLogs,
    aiResponse,
    prompt,
    logSummaryText,
    environmentKey: envKey,
    timestamp: new Date().toISOString()
  };
}

function displayEnvironmentResult(environment, data) {
  const envResult = document.getElementById(`result-${environment.toLowerCase()}`);
  if (!envResult) return;

  if (data.error) {
    envResult.innerHTML = `
      <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 6px; padding: 15px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #721c24;">
          ${escapeHtml(environment)} Environment - Analysis Failed
        </div>
        <div style="margin-bottom: 10px; font-size: 13px;">
          <strong>Error:</strong> ${escapeHtml(data.error)}
        </div>
        <button data-env-retry="${envKey}" style="padding: 6px 12px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          Retry ${escapeHtml(environment)}
        </button>
      </div>
    `;
    const retryBtn = envResult.querySelector(`[data-env-retry="${envKey}"]`);
    if (retryBtn && !retryBtn.dataset.listener) {
      retryBtn.dataset.listener = 'true';
      retryBtn.addEventListener('click', () => summarizeEnvironment(environment));
    }
    return;
  }

  if (data.empty) {
    envResult.innerHTML = `
      <div style="background: #fff3cd; border: 1px solid #ffeeba; border-radius: 6px; padding: 15px;">
        <div style="font-weight: 600; margin-bottom: 10px; color: #856404;">
          ${escapeHtml(environment)} Environment
        </div>
        <div style="font-size: 12px; color: #856404;">
          No log entries found for the selected time range. Try adjusting the time filter or capturing additional activity.
        </div>
      </div>
    `;
    return;
  }

  const envKey = environment.toLowerCase();
  const analysisContent = safeTemplateText(data.analysis || 'No analysis available.');
  envResult.innerHTML = `
    <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 6px; padding: 15px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div style="font-weight: 600; color: #155724; font-size: 14px;">
          ${escapeHtml(environment)} Environment Analysis
        </div>
        <div style="display: flex; gap: 8px;">
          <button data-env-download="${envKey}" style="padding: 4px 8px; background: #17a2b8; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
            Download
          </button>
          <button data-env-details="${envKey}" style="padding: 4px 8px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
            Details
          </button>
        </div>
      </div>

      <div style="margin-bottom: 10px; font-size: 12px; color: #155724;">
        <strong>Found:</strong> ${formatLogCount(data.logCount)} total logs
        <strong>Analyzed:</strong> ${formatLogCount(data.selectedLogCount)}
        <strong>Generated:</strong> ${escapeHtml(new Date(data.timestamp).toLocaleTimeString())}
      </div>

      <div data-env-summary="${envKey}" class="environment-summary" style="cursor: pointer; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #28a745;">
        <div style="font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>AI Analysis Summary</span>
          <span id="toggle-${envKey}" style="font-size: 12px;"> Click to expand</span>
        </div>
        <div id="analysis-${envKey}" style="display: none; white-space: pre-wrap; line-height: 1.4; font-size: 12px; margin-top: 10px; color: #495057;">
${analysisContent}
        </div>
      </div>
    </div>
  `;

  window[`${envKey}EnvironmentData`] = data;
  environmentResultsMap.set(envKey, data);

  const downloadBtn = envResult.querySelector(`[data-env-download="${envKey}"]`);
  if (downloadBtn && !downloadBtn.dataset.listener) {
    downloadBtn.dataset.listener = 'true';
    downloadBtn.addEventListener('click', () => downloadEnvironmentLogs(environment, data));
  }

  const detailBtn = envResult.querySelector(`[data-env-details="${envKey}"]`);
  if (detailBtn && !detailBtn.dataset.listener) {
    detailBtn.dataset.listener = 'true';
    detailBtn.addEventListener('click', () => toggleEnvironmentDetails(envKey));
  }

  const summaryBlock = envResult.querySelector(`[data-env-summary="${envKey}"]`);
  if (summaryBlock && !summaryBlock.dataset.listener) {
    summaryBlock.dataset.listener = 'true';
    summaryBlock.addEventListener('click', () => toggleEnvironmentSummary(envKey));
  }
}

function addComprehensiveSummary(results) {
  const container = document.getElementById('environment-results');
  if (!container) return;

  const successful = Object.keys(results).filter(env => !results[env].error && !results[env].empty);
  const failed = Object.keys(results).filter(env => results[env].error);
  const totalLogs = successful.reduce((sum, env) => sum + (results[env].logCount || 0), 0);

  container.insertAdjacentHTML('beforeend', `
    <div style="margin-top: 30px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px;">
        Comprehensive Analysis Summary
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${successful.length}</div>
          <div style="font-size: 12px;">Environments Analyzed</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${totalLogs.toLocaleString()}</div>
          <div style="font-size: 12px;">Total Log Entries</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${failed.length}</div>
          <div style="font-size: 12px;">Failures</div>
        </div>
        <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
          <div style="font-size: 24px; font-weight: 600;">${escapeHtml(new Date().toLocaleTimeString())}</div>
          <div style="font-size: 12px;">Completed At</div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
        <button data-summary-action="download-all" style="padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          Download All Logs
        </button>
        <button data-summary-action="copy-all" style="padding: 10px 20px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          Copy All Results
        </button>
        <button data-summary-action="refresh" style="padding: 10px 20px; background: #ffc107; color: #212529; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
          Refresh Analysis
        </button>
      </div>
    </div>
  `);

  attachSummaryFooterActions();
}

function attachSummaryFooterActions() {
  const container = document.getElementById('environment-results');
  if (!container) return;

  const downloadAllBtn = container.querySelector('[data-summary-action="download-all"]');
  if (downloadAllBtn && !downloadAllBtn.dataset.listener) {
    downloadAllBtn.dataset.listener = 'true';
    downloadAllBtn.addEventListener('click', () => downloadAllEnvironmentLogs());
  }

  const copyAllBtn = container.querySelector('[data-summary-action="copy-all"]');
  if (copyAllBtn && !copyAllBtn.dataset.listener) {
    copyAllBtn.dataset.listener = 'true';
    copyAllBtn.addEventListener('click', () => copyComprehensiveResults());
  }

  const refreshBtn = container.querySelector('[data-summary-action="refresh"]');
  if (refreshBtn && !refreshBtn.dataset.listener) {
    refreshBtn.dataset.listener = 'true';
    refreshBtn.addEventListener('click', () => summarizeAllEnvironments());
  }
}

function attachAuthErrorActions(container) {
  const focusBtn = container.querySelector('[data-auth-action="focus-login"]');
  if (focusBtn && !focusBtn.dataset.listener) {
    focusBtn.dataset.listener = 'true';
    focusBtn.addEventListener('click', () => {
      const input = document.getElementById('auth-username');
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}

function attachSessionErrorActions(container) {
  const networkBtn = container.querySelector('[data-session-action="go-network"]');
  if (networkBtn && !networkBtn.dataset.listener) {
    networkBtn.dataset.listener = 'true';
    networkBtn.addEventListener('click', () => {
      if (typeof window.switchToTab === 'function') {
        window.switchToTab('network');
      }
    });
  }
}

function finalizeComprehensiveResults(results, aggregatedLogs) {
  if (Object.keys(results).length > 1) {
    addComprehensiveSummary(results);
  }
  storeGlobalResults(results, aggregatedLogs);
}

function storeEnvironmentData(environment, data) {
  const envKey = environment.toLowerCase();
  environmentResultsMap.set(envKey, data);
  if (typeof window !== 'undefined') {
    window[`${envKey}EnvironmentData`] = data;
  }
}

function storeGlobalResults(results, aggregatedLogs) {
  const environments = ENVIRONMENT_ORDER
    .map(env => results[env])
    .filter(Boolean);

  const summaryText = environments.map(env => {
    if (!env) return '';
    if (env.error) return `${env.environment}: ${env.error}`;
    if (env.empty) return `${env.environment}: No logs found.`;
    return `${env.environment}: ${env.analysis}`;
  }).filter(Boolean).join('\n\n');

  lastAnalysisResults = {
    environments,
    alexandria: { Data: aggregatedLogs },
    alexandriaAnalysis: { summary: summaryText },
    timestamp: new Date().toISOString(),
    timeFilter: customTimeFilter
  };

  if (typeof window !== 'undefined') {
    window.lastAnalysisResults = lastAnalysisResults;
    window.comprehensiveResults = results;
  }
}

function downloadEnvironmentLogs(environment, envData) {
  if (!envData || !envData.rawData) {
    alert(`No log data available for ${environment} environment.`);
    return;
  }

  const logEntries = envData.rawData.Data || [];
  if (!logEntries.length) {
    alert(`No log entries found for ${environment} environment.`);
    return;
  }

  try {
    let content = '';
    content += `# ${environment} Environment Log Export\n`;
    content += `# Export Date: ${new Date().toISOString()}\n`;
    content += `# Total Entries: ${logEntries.length}\n`;
    content += `# Analysis Timestamp: ${envData.timestamp}\n`;
    content += `# Time Filter: ${customTimeFilter || DEFAULT_TIME_FILTER}\n#\n`;

    logEntries.forEach(entry => {
      if (!entry || typeof entry !== 'object') {
        content += `${String(entry)}\n\n`;
        return;
      }

      const flattened = flattenLogEntry(entry);
      const timestamp = extractField(flattened, ['timestamp', '@timestamp', '_time', 'time', 'date']) || '';
      const level = extractField(flattened, ['level', 'severity', 'loglevel', 'log_level']) || 'N/A';
      const message = extractField(flattened, ['message', '_raw', 'msg']) || '';

      const headerParts = [
        `[${environment}]`,
        timestamp,
        level ? `[${level}]` : '',
        message
      ].filter(Boolean);

      if (headerParts.length) {
        content += `${headerParts.join(' ')}\n`;
      }

      const fieldLines = Object.entries(flattened)
        .map(([key, value]) => `${key}=${formatFieldValue(value)}`)
        .join(' ');

      content += `${fieldLines}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${environment.toLowerCase()}-alexandria-logs-${Date.now()}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(`[alexandria] Failed to download ${environment} logs`, error);
    alert(`Error downloading ${environment} logs: ${error.message || error}`);
  }
}

function flattenLogEntry(value, prefix = '', result = {}) {
  if (value === null || value === undefined) {
    const key = prefix.replace(/\.$/, '');
    if (key) result[key] = null;
    return result;
  }

  if (typeof value !== 'object') {
    const key = prefix.replace(/\.$/, '');
    if (key) result[key] = value;
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const path = prefix ? `${prefix}${index}.` : `${index}.`;
      flattenLogEntry(item, path, result);
    });
    return result;
  }

  Object.entries(value).forEach(([key, child]) => {
    const path = prefix ? `${prefix}${key}.` : `${key}.`;
    flattenLogEntry(child, path, result);
  });

  return result;
}

function extractField(flattened, candidates) {
  if (!flattened) return null;
  const normalizedCandidates = candidates.map(name => name.toLowerCase());

  for (const [key, value] of Object.entries(flattened)) {
    const lowerKey = key.toLowerCase();
    const lastSegment = lowerKey.split('.').pop();
    if (normalizedCandidates.includes(lowerKey) || normalizedCandidates.includes(lastSegment)) {
      return value;
    }
  }

  return null;
}

function formatFieldValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function downloadAllEnvironmentLogs() {
  if (!environmentResultsMap.size) {
    alert('Run a log analysis before downloading results.');
    return;
  }

  const entries = [];
  environmentResultsMap.forEach((data, key) => {
    const environment = (data?.environment || key || '').toString();
    if (!data || data.error || data.empty || !data.rawData?.Data?.length) return;
    entries.push({ environment, data });
  });

  if (!entries.length) {
    alert('No log data available to download. Run a summary with results first.');
    return;
  }

  entries.forEach(({ environment, data }, index) => {
    setTimeout(() => {
      downloadEnvironmentLogs(environment, data);
    }, index * 500);
  });

  alert(`Starting download of logs from ${entries.length} environment(s)...`);
}

function copyComprehensiveResults() {
  if (!lastAnalysisResults) {
    alert('Run a log analysis before copying results.');
    return;
  }

  const lines = [
    `Alexandria Log Analysis Summary (${lastAnalysisResults.timestamp})`,
    `Time Filter: ${customTimeFilter || DEFAULT_TIME_FILTER}`,
    ''
  ];

  (lastAnalysisResults.environments || []).forEach(env => {
    if (!env) return;
    lines.push(`${env.environment} Environment`, `- Logs Returned: ${env.logCount || 0}`, `- Selected Logs: ${env.selectedLogCount || 0}`, '', env.analysis || 'No analysis available', '');
  });

  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => alert('Comprehensive results copied to clipboard!'))
    .catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = lines.join('\n');
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('Comprehensive results copied to clipboard!');
    });
}

function toggleEnvironmentSummary(envKey) {
  const analysis = document.getElementById(`analysis-${envKey}`);
  const toggle = document.getElementById(`toggle-${envKey}`);
  if (!analysis || !toggle) return;

  const isOpen = analysis.style.display === 'block';
  analysis.style.display = isOpen ? 'none' : 'block';
  toggle.textContent = isOpen ? ' Click to expand' : ' Click to collapse';
}

function toggleEnvironmentDetails(envKey) {
  const existing = document.getElementById(`details-${envKey}`);
  if (existing) {
    existing.remove();
    return;
  }

  const data = environmentResultsMap.get(envKey);
  if (!data) return;

  const parent = document.getElementById(`result-${envKey}`);
  if (!parent) return;

  const details = document.createElement('div');
  details.id = `details-${envKey}`;
  details.innerHTML = `
    <div style="margin-top: 15px; padding: 10px; background: #f1f1f1; border-radius: 4px; border: 1px solid #ddd;">
      <div style="font-weight: 600; margin-bottom: 10px; font-size: 12px;">Technical Details</div>
      <div style="margin-bottom: 8px; font-size: 11px;">
        <strong>Search Query:</strong><br>
        <code style="font-size: 10px; word-break: break-all; background: #fff; padding: 4px; border-radius: 2px; display: block; margin-top: 4px;">${escapeHtml(data.searchString || 'N/A')}</code>
      </div>
      <div style="margin-bottom: 8px; font-size: 11px;">
        <strong>Time Range:</strong> ${escapeHtml(customTimeFilter || DEFAULT_TIME_FILTER)}
      </div>
      <div style="font-size: 11px;">
        <strong>Analysis ID:</strong> ${escapeHtml(data.timestamp || 'N/A')}
      </div>
      <div style="margin-top: 10px;">
        <button data-env-copy="${envKey}" style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 10px;">
          Copy Query
        </button>
        <button data-env-close="${envKey}" style="padding: 4px 8px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 10px; margin-left: 8px;">
          Close
        </button>
      </div>
    </div>
  `;

  parent.appendChild(details);

  const copyBtn = details.querySelector(`[data-env-copy="${envKey}"]`);
  if (copyBtn && !copyBtn.dataset.listener) {
    copyBtn.dataset.listener = 'true';
    copyBtn.addEventListener('click', () => copyEnvironmentQuery(envKey));
  }

  const closeBtn = details.querySelector(`[data-env-close="${envKey}"]`);
  if (closeBtn && !closeBtn.dataset.listener) {
    closeBtn.dataset.listener = 'true';
    closeBtn.addEventListener('click', () => {
      document.getElementById(`details-${envKey}`)?.remove();
    });
  }
}

function copyEnvironmentQuery(envKey) {
  const data = environmentResultsMap.get(envKey);
  if (!data?.searchString) {
    alert(`No query available for ${envKey.toUpperCase()} environment.`);
    return;
  }

  navigator.clipboard.writeText(data.searchString)
    .then(() => alert(`${envKey.toUpperCase()} search query copied to clipboard!`))
    .catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = data.searchString;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert(`${envKey.toUpperCase()} search query copied to clipboard!`);
    });
}

function displaySingleEnvironmentAnalysis(container, data) {
  const analysis = data.analysis || 'No analysis available.';
  const layout = `
    <div style="padding: 10px 20px 20px 20px;">
      <div style="font-weight: 600; margin-bottom: 15px; font-size: 16px; color: #28a745;">
        Alexandria Log Analysis Complete
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">Download Logs:</div>
        <button data-single-action="download" style="padding: 10px 20px; background: #17a2b8; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">
          Download Logs
        </button>
        <div style="margin-top: 10px; font-size: 12px; color: #6c757d;">
          Downloads the received log data as a .log file
        </div>
      </div>

      <div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border: 1px solid #bbdefb; border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 10px;">Alexandria Analysis:</div>
        <div style="white-space: pre-wrap; line-height: 1.5; font-size: 13px;">
${escapeHtml(analysis)}
        </div>
      </div>

      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button data-single-action="refresh" style="padding: 8px 16px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Analyze Again
        </button>
        <button data-single-action="copy" style="padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Copy Results
        </button>
      </div>
    </div>
  `;

  container.innerHTML = layout;
  updateLastAnalysisSingle(data);
  attachSingleEnvironmentActions(container, data);
}

function attachSingleEnvironmentActions(container, data) {
  const downloadBtn = container.querySelector('[data-single-action="download"]');
  if (downloadBtn && !downloadBtn.dataset.listener) {
    downloadBtn.dataset.listener = 'true';
    downloadBtn.addEventListener('click', () => downloadEnvironmentLogs(data.environment, data));
  }

  const copyBtn = container.querySelector('[data-single-action="copy"]');
  if (copyBtn && !copyBtn.dataset.listener) {
    copyBtn.dataset.listener = 'true';
    copyBtn.addEventListener('click', () => {
      if (typeof window.copyAnalysisResults === 'function') {
        window.copyAnalysisResults();
      }
    });
  }

  const refreshBtn = container.querySelector('[data-single-action="refresh"]');
  if (refreshBtn && !refreshBtn.dataset.listener) {
    refreshBtn.dataset.listener = 'true';
    refreshBtn.addEventListener('click', () => {
      if (typeof summarizeAllEnvironments === 'function') {
        summarizeAllEnvironments();
      }
    });
  }
}

function updateLastAnalysisSingle(data) {
  lastAnalysisResults = {
    environments: [data],
    alexandria: data.rawData,
    alexandriaAnalysis: { summary: data.analysis },
    timestamp: new Date().toISOString(),
    timeFilter: customTimeFilter
  };

  if (typeof window !== 'undefined') {
    window.lastAnalysisResults = lastAnalysisResults;
    const envKey = data.environment || data.environmentKey || 'environment';
    window.comprehensiveResults = { [envKey]: data };
  }
}

async function requireAlexandriaToken() {
  if (authToken) return authToken;
  authToken = getAuthToken();
  if (authToken) return authToken;
  alert('Please authenticate with Alexandria before running log analysis.');
  return null;
}

function resolveEnvironmentContext() {
  const session = getState().currentSession;
  if (!session) {
    environmentContextCache = null;
    return null;
  }

  if (environmentContextCache) {
    const matchesSession = environmentContextCache.sessionId === session.sessionId &&
      environmentContextCache.workstationId === (session.workstationId || getWorkstationId());
    if (matchesSession) {
      return environmentContextCache;
    }
  }

  const queries = extractQueryFromSession();
  if (!queries) return null;

  environmentContextCache = {
    sessionId: session.sessionId,
    workstationId: session.workstationId || getWorkstationId(),
    formattedStart: queries.formattedStart,
    formattedEnd: queries.formattedEnd,
    indices: queries.indices,
    searchStrings: {
      hq: queries.queries.hqSession,
      kamino: queries.queries.kamino,
      lightbridge: queries.queries.lightbridge,
      ardent: queries.queries.ardent
    }
  };

  if (typeof window !== 'undefined') {
    window.environmentSearchStrings = environmentContextCache;
  }

  return environmentContextCache;
}

function extractQueryFromSession() {
  const session = getState().currentSession;
  if (!session || !session.requests?.length) return null;

  const isStaging = session.requests.some(req => req.url?.includes('temporary'));

  const indices = {
    hq: isStaging ? 'app_logs_stage_hq' : 'app_logs_prod_hq',
    lightbridge: isStaging ? 'app_logs_stage_lightbridge' : 'app_logs_prod_lightbridge',
    kamino: isStaging ? 'app_logs_stage_kamino' : 'app_logs_prod_kamino',
    ardent: isStaging ? 'app_logs_stage_ardent' : 'app_logs_prod_ardent'
  };

  const formattedStart = formatDateTime(session.startTime);
  const formattedEnd = formatDateTime(session.endTime);

  return {
    indices,
    formattedStart,
    formattedEnd,
    queries: {
      working: `search index="app_logs_prod_hq" sessionId="${session.sessionId}" earliest="-8h" | fields * | extract | sort timestamp, seqId | head 10000`,
      hqSession: `search index="${indices.hq}" sessionId="${session.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
      lightbridge: `search index="${indices.lightbridge}" workstationId="${session.workstationId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
      kamino: `search index="${indices.kamino}" sessionId="${session.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
      ardent: `search index="${indices.ardent}" workstationId="${session.workstationId}" earliest="-15m" | fields * | extract | sort timestamp, seqId | head 10000`,
      fallback: `search index="${indices.hq}" earliest="-8h" | fields * | extract | sort timestamp, seqId | head 1000`
    }
  };
}

async function queryAlexandriaLogs(token, query) {
  const payload = {
    searchId: '',
    query,
    timeArgs: null,
    isRetry: false,
    isDownload: false,
    isLegacyFormat: false
  };

  const response = await fetch('https://alexandria.shs.aws.q2e.io/api/v3/logs/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Origin': 'https://alexandria.shs.aws.q2e.io',
      'Referer': 'https://alexandria.shs.aws.q2e.io/logs/search'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Alexandria log query failed (${response.status}): ${text}`);
  }

  return response.json();
}

function buildEnvironmentQuery(context, envKey) {
  const base = context?.searchStrings?.[envKey];
  if (!base) return null;

  if (!customTimeFilter || customTimeFilter === DEFAULT_TIME_FILTER) {
    return base;
  }

  const now = new Date();
  const customStart = calculateTimeFromFilter(customTimeFilter);
  const formattedStart = formatDateTime(customStart);
  const formattedEnd = formatDateTime(now);
  const indices = context.indices || {};
  const sessionId = context.sessionId || getState().currentSession?.sessionId || 'unknown-session';
  const workstationId = context.workstationId || getState().currentSession?.workstationId || getWorkstationId() || 'unknown-workstation';

  switch (envKey) {
    case 'hq':
    case 'kamino':
      return `search index="${indices[envKey]}" sessionId="${sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
    case 'lightbridge':
      return `search index="${indices[envKey]}" workstationId="${workstationId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`;
    case 'ardent':
      return `search index="${indices[envKey]}" workstationId="${workstationId}" earliest="${customTimeFilter}" | fields * | extract | sort timestamp, seqId | head 10000`;
    default:
      return base;
  }
}

function buildEnvironmentPrompt(environment, logSummary) {
  return `Analyze these ${environment} environment log entries and provide insights:

${logSummary}

Focus on:
1. Any errors or anomalies
2. Performance patterns
3. Key events or transactions
4. Recommendations for optimization
5. Environment-specific insights`;
}

function summarizeWithAlexandria(token, prompt) {
  return fetch('https://alexandria.shs.aws.q2e.io/api/v3/ai/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(String(prompt ?? ''))
  }).then(async response => {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Alexandria API error (${response.status}): ${text}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { summary: text, response: text, isPlainText: true };
    }
  });
}

function setCustomTimeFilter(value) {
  customTimeFilter = value || DEFAULT_TIME_FILTER;
  timeFilterLabel = customTimeFilter;

  if (typeof window !== 'undefined') {
    window.customTimeFilter = customTimeFilter;
    window.currentTimeFilter = customTimeFilter;
  }
}

function safeTemplateText(value) {
  return String(value ?? '')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function formatLogCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num.toLocaleString() : '0';
}

