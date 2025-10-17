/**
 * @file        aiInsightsTab.js
 * @description Controls the AI Insights tab: manages Alexandria authentication, orchestrates AI summaries, and renders analysis UI components.
 *
 * @summary
 *  Functions:
 *    - initializeAIInsights(): Bootstrap the tab by wiring events, loading tokens, and resetting UI sections.
 *    - populateAuthState(): Toggle authentication UI based on cached Alexandria credentials.
 *    - generateAISummary(): Build prompt data from captured sessions and request an Alexandria AI summary.
 *    - summarizeAllEnvironments()/summarizeEnvironment(environment): Execute comprehensive or per-environment log analyses.
 *    - displayAnalysisSummary(summary): Render AI-generated summary text within the insights panel.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */

import { getState, getAuthToken, setAuthToken } from './state.js';
import { DOM_IDS } from './constants.js';
import { escapeHtml, triggerJsonDownload, copyToClipboard } from './utils.js';
import {
  wireLogAnalysisButtons,
  configureLogAnalysis,
  announceToken as announceLogAnalysisToken,
  summarizeAllEnvironments,
  summarizeEnvironment,
  parseTimeQuery,
  getLastLogAnalysis
} from './alexandria/logAnalysis.js';

const TOKEN_CACHE_KEY = 'alexandriaAuthToken';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

let authTokenCache = null;
let authToken = null;
let lastAnalysis = null;
let currentAnalysis = null;
export function initializeAIInsights() {
  wireHandlers();
  wireLogAnalysisButtons();
  exposeUtilities();
  const initialToken = authTokenCache || getAuthToken() || null;
  if (initialToken) {
    authTokenCache = initialToken;
    authToken = initialToken;
    announceLogAnalysisToken(initialToken);
  }
  configureLogAnalysis({
    token: initialToken,
    customTimeFilter: typeof window !== 'undefined' ? window.customTimeFilter ?? null : null
  });

  initializeAuthToken()
    .catch(error => console.warn('[AI] Failed to initialize auth token', error))
    .finally(() => {
      populateAuthState();
      resetAnalyticsSections();
    });
}

export function populateAuthState() {
  const authForm = document.getElementById(DOM_IDS.aiAuthForm);
  const authStatus = document.getElementById(DOM_IDS.aiAuthStatus);
  const token = authTokenCache || getAuthToken();

  if (!authForm || !authStatus) return;

  if (token) {
    authForm.style.display = 'none';
    authStatus.style.display = 'block';
    authStatus.innerHTML = `
      <div class="ai-placeholder">
        <span class="ai-placeholder-icon">AI</span>
        <p>Authenticated with cached token.</p>
        <button id="reset-auth-token" class="ai-action-btn secondary">Reset Token</button>
      </div>
    `;

    authStatus.querySelector('#reset-auth-token')?.addEventListener('click', () => {
      resetAuthToken();
    });
  } else {
    authForm.style.display = 'block';
    authStatus.style.display = 'none';
  }
}

function wireHandlers() {
  document.getElementById('auth-login')?.addEventListener('click', async event => {
    event.preventDefault();
    await handleLogin();
  });

  document.getElementById('generate-summary')?.addEventListener('click', () => generateAISummary());
  document.getElementById('clear-analysis')?.addEventListener('click', () => clearAnalysis());
  document.getElementById('copy-analysis')?.addEventListener('click', () => copyAnalysisResults());
  document.getElementById('download-analysis')?.addEventListener('click', () => downloadAnalysis());
  document.getElementById('analyze-performance')?.addEventListener('click', () => handleAnalyzePerformance());
  document.getElementById('detect-issues')?.addEventListener('click', () => handleDetectIssues());
}

function exposeUtilities() {
  if (typeof window === 'undefined') return;
  window.resetAuth = resetAuthToken;
  window.copyAnalysisResults = copyAnalysisResults;
  window.downloadAlexandriaLogs = downloadAlexandriaLogs;
  window.summarizeEnvironmentLogs = summarizeEnvironment;
  window.summarizeLogs = summarizeAllEnvironments;
  window.parseTimeQuery = parseTimeQuery;
}

async function handleLogin() {
  const username = document.getElementById('auth-username')?.value?.trim();
  const password = document.getElementById('auth-password')?.value?.trim();

  if (!username || !password) {
    alert('Username and password are required.');
    return;
  }

  try {
    const token = await fetchAuthToken(username, password);
    authTokenCache = token;
    authToken = token;
    setAuthToken(token);
    announceLogAnalysisToken(token);
    configureLogAnalysis({ token });
    await saveTokenToCache(token);
    populateAuthState();
    alert('Authentication successful. Token cached for 8 hours.');
  } catch (error) {
    console.error('[AI] Authentication failed', error);
    alert(`Authentication failed: ${error.message}`);
  }
}

async function initializeAuthToken() {
  if (authTokenCache) {
    authToken = authTokenCache;
    announceLogAnalysisToken(authTokenCache);
    configureLogAnalysis({ token: authTokenCache });
    return authTokenCache;
  }

  const memoryToken = getAuthToken();
  if (memoryToken) {
    authTokenCache = memoryToken;
    authToken = memoryToken;
    announceLogAnalysisToken(memoryToken);
    configureLogAnalysis({ token: memoryToken });
    return memoryToken;
  }

  const cached = await loadTokenFromCache();
  if (cached) {
    authTokenCache = cached;
    setAuthToken(cached);
    authToken = cached;
    announceLogAnalysisToken(cached);
    configureLogAnalysis({ token: cached });
  }
  return cached;
}

async function fetchAuthToken(username, password) {
  const response = await fetch('https://alexandria.shs.aws.q2e.io/api/v3/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
      'Authorization': 'Bearer 00000000-0000-0000-0000-000000000000'
    },
    body: JSON.stringify({ name: username, pass: password })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data?.token) {
    throw new Error('No token returned from Alexandria');
  }
  return data.token;
}

async function loadTokenFromCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([TOKEN_CACHE_KEY], result => {
      const record = result[TOKEN_CACHE_KEY];
      if (!record) {
        resolve(null);
        return;
      }
      const { token, cachedAt } = record;
      if (!token || !cachedAt) {
        resolve(null);
        return;
      }
      const isExpired = Date.now() - cachedAt > TOKEN_TTL_MS;
      resolve(isExpired ? null : token);
    });
  });
}

async function saveTokenToCache(token) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [TOKEN_CACHE_KEY]: {
        token,
        cachedAt: Date.now()
      }
    }, resolve);
  });
}

function resetAuthToken() {
  authTokenCache = null;
  authToken = null;
  setAuthToken(null);
  announceLogAnalysisToken(null);
  configureLogAnalysis({ token: null });
  chrome.storage.local.remove(TOKEN_CACHE_KEY);
  populateAuthState();
}

async function generateAISummary() {
  const session = getState().currentSession;
  if (!session || !session.requests?.length) {
    renderAISummaryMessage('No session data available. Capture network activity first.');
    resetAnalyticsSections();
    return;
  }

  renderAISummaryMessage('Analyzing session data...');
  resetAnalyticsSections();

  const analysis = analyzeSessionData(session.requests, session);
  currentAnalysis = analysis;

  const localSummary = buildLocalSummary(analysis);
  lastAnalysis = {
    timestamp: new Date().toISOString(),
    summary: localSummary,
    prompt: buildPromptFromSession(session),
    analysis
  };

  renderAISummaryContent(localSummary, analysis, { source: 'local' });
  displayAnalysisSections(analysis);

  // Attempt to enhance with Alexandria summary if a token is available
  const hasToken = Boolean(authTokenCache || getAuthToken());
  if (!hasToken) return;

  try {
    await ensureAuthToken();
    const response = await callAlexandriaAI(lastAnalysis.prompt);
    if (response) {
      const remoteSummary = response?.summary || response?.response || localSummary;
      lastAnalysis.summary = remoteSummary;
      lastAnalysis.raw = response;
      renderAISummaryContent(remoteSummary, analysis, { source: 'alexandria' });
    }
  } catch (error) {
    console.warn('[AI] Alexandria summary unavailable', error);
    // Keep the local summary rendered
  }
}

function buildPromptFromSession(session) {
  const lines = [
    `Session ID: ${session.sessionId}`,
    `Workstation ID: ${session.workstationId}`,
    `Total requests: ${session.requests.length}`,
    '',
    'Request overview:'
  ];

  session.requests.slice(0, 25).forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.method || 'GET'} ${entry.url || ''} -> ${entry.statusCode || 'N/A'}`);
  });

  return lines.join('\n');
}

function renderAISummaryContent(summaryText, analysis, { source } = {}) {
  const summaryElement = document.getElementById(DOM_IDS.aiSummary);
  if (!summaryElement) return;

  const insightsMarkup = analysis.insights && analysis.insights.length
    ? `<ul>${analysis.insights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>No additional insights available.</p>';

  const sourceLabel = source === 'alexandria'
    ? '<div class="ai-summary-note">Summary enhanced by Alexandria AI.</div>'
    : '<div class="ai-summary-note">Summary generated from captured session data.</div>';

  summaryElement.innerHTML = `
    <div class="ai-summary-card">
      <div class="ai-summary-banner">&#10003; AI analysis completed for current session!</div>
      <div class="ai-summary-section">
        <h4>Current Session Intelligence Report</h4>
        <p><strong>Session ID:</strong> ${escapeHtml(analysis.sessionId || 'N/A')}</p>
        <p><strong>Total Requests:</strong> ${escapeHtml(String(analysis.totalRequests))}</p>
        <p><strong>Session Duration:</strong> ${escapeHtml(analysis.sessionDuration)}</p>
        <p><strong>Average Response Time:</strong> ${escapeHtml(String(analysis.avgResponseTime))}ms</p>
        <p><strong>Success Rate:</strong> ${escapeHtml(String(analysis.successRate))}%</p>
        <p><strong>Performance Score:</strong> ${escapeHtml(String(analysis.performanceScore))}/100</p>
      </div>
      <div class="ai-summary-section">
        <h4>Key Insights</h4>
        ${insightsMarkup}
      </div>
      ${summaryText ? `
        <div class="ai-summary-section">
          <h4>Summary</h4>
          <p>${escapeHtml(summaryText)}</p>
        </div>
      ` : ''}
      ${sourceLabel}
      <button class="ai-action-btn secondary" onclick="copyAnalysisResults()">Copy Results</button>
    </div>
  `;
}

function renderAISummaryMessage(message) {
  const summaryElement = document.getElementById(DOM_IDS.aiSummary);
  if (!summaryElement) return;
  summaryElement.innerHTML = `
    <div class="ai-placeholder">
      <span class="ai-placeholder-icon">AI</span>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function clearAnalysis() {
  lastAnalysis = null;
  currentAnalysis = null;
  renderAISummaryMessage('Analysis cleared. Generate a new summary to get insights.');
  resetAnalyticsSections();
}

function copyAnalysisResults() {
  const logResults = getLastLogAnalysis() || window.lastAnalysisResults;
  if (logResults) {
    const totalLogs = logResults.alexandria?.Data?.length ?? logResults.alexandria?.results?.length ?? 0;
    const text = `Alexandria Log Analysis Results (${logResults.timestamp || new Date().toISOString()})

Alexandria Query Results:
- Log Entries: ${totalLogs}
- Status: ${logResults.alexandria?.status || 'N/A'}
- Duration: ${logResults.alexandria?.duration || 'N/A'}

Alexandria Analysis:
${logResults.alexandriaAnalysis?.summary || logResults.alexandriaAnalysis?.response || 'No analysis available'}
`;

    copyToClipboard(text)
      .then(() => alert('Analysis results copied to clipboard!'))
      .catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('Analysis results copied to clipboard!');
      });
    return;
  }

  if (!lastAnalysis) {
    alert('No analysis available to copy.');
    return;
  }

  const analysis = lastAnalysis.analysis || currentAnalysis;
  const lines = [
    `AI Session Summary (${lastAnalysis.timestamp})`,
    '',
    lastAnalysis.summary || 'No summary text available.',
  ];

  if (analysis) {
    lines.push(
      '',
      'Metrics:',
      `- Total Requests: ${analysis.totalRequests}`,
      `- Avg Response: ${analysis.avgResponseTime} ms`,
      `- Success Rate: ${analysis.successRate}%`,
      `- Session Duration: ${analysis.sessionDuration}`,
      `- Performance Score: ${analysis.performanceScore}`
    );

    if (analysis.insights?.length) {
      lines.push('', 'Insights:');
      analysis.insights.forEach(insight => lines.push(`- ${insight}`));
    }

    if (analysis.recommendations?.length) {
      lines.push('', 'Recommendations:');
      analysis.recommendations.forEach(rec => lines.push(`- ${rec.title}: ${rec.description}`));
    }
  }

  if (lastAnalysis.prompt) {
    lines.push('', 'Prompt:', lastAnalysis.prompt);
  }

  const text = lines.join('\n');

  copyToClipboard(text)
    .then(() => alert('Analysis results copied to clipboard.'))
    .catch(error => alert(`Failed to copy results: ${error.message}`));
}

function downloadAnalysis() {
  if (!lastAnalysis) {
    alert('No analysis available to download.');
    return;
  }

  triggerJsonDownload(`ai-session-analysis-${Date.now()}.json`, lastAnalysis);
}

function downloadAlexandriaLogs() {
  if (typeof window !== 'undefined' && typeof window.downloadAllEnvironmentLogs === 'function') {
    window.downloadAllEnvironmentLogs();
    return;
  }

  const logResults = getLastLogAnalysis() || window.lastAnalysisResults;
  if (!logResults) {
    alert('Run a log analysis before downloading results.');
    return;
  }

  triggerJsonDownload(`alexandria-log-analysis-${Date.now()}.json`, logResults);
}

function handleAnalyzePerformance() {
  if (!currentAnalysis) {
    alert('Generate a summary first to analyze performance.');
    return;
  }
  renderOptimizationTips(currentAnalysis, { highlight: true });
}

function handleDetectIssues() {
  if (!currentAnalysis) {
    alert('Generate a summary first to detect issues.');
    return;
  }

  const issues = collectIssues(currentAnalysis);
  if (!issues.length) {
    alert('No critical issues detected in the current session.');
    return;
  }

  alert(`Issues detected:\n\n${issues.map(issue => `- ${issue}`).join('\n')}`);
}

function displayAnalysisSections(analysis) {
  renderSlowRequests(analysis);
  renderErrorAnalysis(analysis);
  renderPerformanceMetrics(analysis);
  renderOptimizationTips(analysis);
  renderHealthScore(analysis);
  renderRecommendations(analysis);
}

function resetAnalyticsSections() {
  const setContent = (id, html) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  };

  setContent('slow-requests-list', '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>');
  setContent('error-analysis-list', '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>');
  setContent('performance-trends', '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>');
  setContent('optimization-tips', '<div class="analytics-placeholder">No analysis available. Generate summary first.</div>');
  const healthScoreValue = document.getElementById('health-score-value');
  if (healthScoreValue) healthScoreValue.textContent = '--';
  const healthBreakdown = document.getElementById('health-breakdown');
  if (healthBreakdown) healthBreakdown.innerHTML = '<div class="health-placeholder">Generate analysis to see health score</div>';
  setContent('ai-recommendations-content', `
    <div class="recommendations-list">
      <div class="ai-placeholder">
        <span class="ai-placeholder-icon">AI</span>
        <p>AI recommendations will appear here after analysis</p>
      </div>
    </div>
  `);
}

function analyzeSessionData(data, sessionInfo = {}) {
  const analysis = {
    totalRequests: Array.isArray(data) ? data.length : 0,
    sessionStart: null,
    sessionEnd: null,
    sessionDuration: 'N/A',
    slowRequests: [],
    errors: [],
    insights: [],
    recommendations: [],
    sessionId: sessionInfo.sessionId ?? 'Unknown',
    activeDomain: sessionInfo.activeDomain ?? sessionInfo.domain ?? 'Unknown'
  };

  if (!Array.isArray(data) || !data.length) {
    analysis.avgResponseTime = 0;
    analysis.successRate = 100;
    analysis.performanceScore = 100;
    generateInsights(analysis);
    generateRecommendations(analysis);
    return analysis;
  }

  const startTimes = data.map(r => r.startTime).filter(Boolean);
  const endTimes = data.map(r => r.endTime || r.startTime).filter(Boolean);
  if (startTimes.length && endTimes.length) {
    analysis.sessionStart = Math.min(...startTimes);
    analysis.sessionEnd = Math.max(...endTimes);
    analysis.sessionDuration = formatDuration(analysis.sessionEnd - analysis.sessionStart);
  }

  const responseTimes = data
    .filter(r => r.startTime && r.endTime)
    .map(r => r.endTime - r.startTime);

  analysis.avgResponseTime = responseTimes.length
    ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
    : 0;

  const slowCandidates = data.filter(r => r.startTime && r.endTime && (r.endTime - r.startTime) > 2000);
  const sortedByDuration = data
    .filter(r => r.startTime && r.endTime)
    .sort((a, b) => (b.endTime - b.startTime) - (a.endTime - a.startTime));

  analysis.slowRequests = (slowCandidates.length ? slowCandidates : sortedByDuration)
    .slice(0, slowCandidates.length ? 3 : 5)
    .map(r => ({
      url: r.url,
      responseTime: (r.endTime && r.startTime) ? r.endTime - r.startTime : 0
    }));

  analysis.errors = data
    .filter(r => r.statusCode && r.statusCode >= 400)
    .slice(0, 5)
    .map(r => ({
      url: r.url,
      statusCode: r.statusCode,
      statusText: r.statusText || 'Error',
      responseTime: (r.startTime && r.endTime) ? r.endTime - r.startTime : null
    }));

  const successes = data.filter(r => r.statusCode && r.statusCode < 400).length;
  const totalWithStatus = data.filter(r => r.statusCode).length;
  analysis.successRate = totalWithStatus
    ? Math.round((successes / totalWithStatus) * 100)
    : 100;

  analysis.performanceScore = calculatePerformanceScore(analysis);
  generateInsights(analysis);
  generateRecommendations(analysis);

  return analysis;
}

function renderSlowRequests(analysis) {
  const list = document.getElementById('slow-requests-list');
  const title = document.getElementById('slow-requests-title');
  if (!list) return;

  const requests = analysis.slowRequests || [];
  if (!requests.length) {
    list.innerHTML = '<div class="analytics-placeholder">No slow requests detected.</div>';
    if (title) title.textContent = 'Slow Requests';
    return;
  }

  const hasSlow = requests.some(req => req.responseTime > 2000);
  if (title) title.textContent = hasSlow ? 'Slow Requests' : 'Top Requests by Time';

  list.innerHTML = requests.map((req, index) => `
    <div class="slow-request-item">
      <span class="slow-request-url" title="${escapeHtml(req.url || '')}">
        ${hasSlow ? '' : `${index + 1}. `}${escapeHtml(truncateUrl(req.url, 90))}
      </span>
      <span class="slow-request-time">${Math.round(req.responseTime)} ms</span>
    </div>
  `).join('');
}

function renderErrorAnalysis(analysis) {
  const list = document.getElementById('error-analysis-list');
  if (!list) return;

  const errors = analysis.errors || [];
  if (!errors.length) {
    list.innerHTML = '<div class="analytics-placeholder">No errors detected.</div>';
    return;
  }

  list.innerHTML = errors.map(error => `
    <div class="error-item">
      <span class="error-status">${escapeHtml(String(error.statusCode))}</span>
      <span class="error-url" title="${escapeHtml(error.url || '')}">
        ${escapeHtml(truncateUrl(error.url, 100))}
      </span>
      <span class="error-time">${error.responseTime !== null ? `${Math.round(error.responseTime)} ms` : 'N/A'}</span>
    </div>
  `).join('');
}

function renderPerformanceMetrics(analysis) {
  const container = document.getElementById('performance-trends');
  if (!container) return;

  container.innerHTML = `
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
}

function renderOptimizationTips(analysis, { highlight = false } = {}) {
  const container = document.getElementById('optimization-tips');
  if (!container) return;

  const tips = [];
  if (analysis.avgResponseTime > 1000) {
    tips.push('Consider caching and database tuning to reduce response times.');
  }
  if ((analysis.slowRequests || []).length) {
    tips.push('Investigate the slowest endpoints identified in the analysis.');
  }
  if ((analysis.errors || []).length) {
    tips.push('Review failed requests and improve error handling.');
  }
  if (analysis.totalRequests > 50) {
    tips.push('Batch or paginate requests to reduce network chatter.');
  }

  if (!tips.length) {
    container.innerHTML = '<div class="analytics-placeholder">Performance looks good.</div>';
    return;
  }

  container.innerHTML = tips.map(tip => `
    <div class="optimization-tip${highlight ? ' highlight' : ''}">&bull; ${escapeHtml(tip)}</div>
  `).join('');
}

function renderHealthScore(analysis) {
  const scoreValue = document.getElementById('health-score-value');
  const breakdown = document.getElementById('health-breakdown');
  if (scoreValue) scoreValue.textContent = analysis.performanceScore;

  const circle = document.querySelector('.health-score-circle');
  if (circle) {
    const percent = Math.min(Math.max(analysis.performanceScore, 0), 100);
    circle.style.setProperty('--score-percent', `${percent}%`);

    let color = '#f44336';
    if (percent >= 70) color = '#4CAF50';
    else if (percent >= 50) color = '#ff9800';

    circle.style.background = `conic-gradient(from 0deg, ${color} 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
  }

  if (breakdown) {
    let status = 'Poor';
    let description = 'Significant performance or reliability issues detected.';
    if (analysis.performanceScore >= 80) {
      status = 'Excellent';
      description = 'Great job! Session is performing optimally.';
    } else if (analysis.performanceScore >= 60) {
      status = 'Good';
      description = 'Overall healthy with minor areas to monitor.';
    } else if (analysis.performanceScore >= 40) {
      status = 'Fair';
      description = 'Some issues detected; review recommendations.';
    }

    breakdown.innerHTML = `
      <div class="health-status">${escapeHtml(status)}</div>
      <div class="health-description">${escapeHtml(description)}</div>
    `;
  }
}

function renderRecommendations(analysis) {
  const container = document.getElementById('ai-recommendations-content');
  if (!container) return;

  const recommendations = analysis.recommendations || [];
  if (!recommendations.length) {
    container.innerHTML = `
      <div class="recommendations-list">
        <div class="ai-placeholder">
          <span class="ai-placeholder-icon">AI</span>
          <p>Great job! No specific recommendations at this time.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="recommendations-list">
      ${recommendations.map(rec => `
        <div class="recommendation-item">
          <div class="recommendation-title">${escapeHtml(rec.title)}</div>
          <p class="recommendation-text">${escapeHtml(rec.description)}</p>
        </div>
      `).join('')}
    </div>
  `;
}

function collectIssues(analysis) {
  const issues = [];
  if ((analysis.errors || []).length) {
    issues.push(`Detected ${analysis.errors.length} error response(s).`);
  }
  if ((analysis.slowRequests || []).length) {
    issues.push(`Identified ${analysis.slowRequests.length} slow request(s).`);
  }
  if (analysis.successRate < 90) {
    issues.push(`Success rate is below target at ${analysis.successRate}%.`);
  }
  if (analysis.performanceScore < 60) {
    issues.push(`Performance score is low (${analysis.performanceScore}).`);
  }
  return issues;
}

function calculatePerformanceScore(analysis) {
  let score = 100;

  if (analysis.avgResponseTime > 2000) score -= 30;
  else if (analysis.avgResponseTime > 1000) score -= 15;
  else if (analysis.avgResponseTime > 500) score -= 5;

  score -= Math.min((analysis.errors || []).length * 10, 40);

  if (analysis.successRate < 100) {
    score -= (100 - analysis.successRate) / 2;
  }

  score -= Math.min((analysis.slowRequests || []).length * 5, 20);

  return Math.max(0, Math.round(score));
}

function generateInsights(analysis) {
  const insights = [];

  if (analysis.sessionId && analysis.sessionId !== 'Unknown') {
    insights.push(`Analyzing session ${analysis.sessionId} for ${analysis.activeDomain || 'current domain'}.`);
  }

  if (analysis.avgResponseTime < 500) {
    insights.push('Response times are excellent across the session.');
  } else if (analysis.avgResponseTime > 2000) {
    insights.push('Response times are higher than optimal. Investigate slow endpoints.');
  }

  if (analysis.successRate === 100) {
    insights.push('No errors detected in this session.');
  } else if (analysis.successRate < 90) {
    insights.push('Error rate is elevated; review failing requests.');
  }

  if (!(analysis.slowRequests || []).length) {
    insights.push('No slow requests detected.');
  } else {
    insights.push(`Identified ${analysis.slowRequests.length} slow request(s).`);
  }

  if ((analysis.errors || []).length) {
    insights.push(`${analysis.errors.length} error response(s) captured during the session.`);
  }

  if (!insights.length) {
    insights.push('Session analysis completed. Review detailed metrics below.');
  }

  analysis.insights = insights;
}

function generateRecommendations(analysis) {
  const recommendations = [];

  if (analysis.sessionId && analysis.sessionId !== 'Unknown') {
    recommendations.push({
      title: 'Session Context',
      description: `Focus on session ${analysis.sessionId} (${analysis.activeDomain || 'current domain'}) to continue troubleshooting.`
    });
  }

  if (analysis.avgResponseTime > 1000) {
    recommendations.push({
      title: 'Optimize Response Times',
      description: 'Consider caching, optimizing queries, or leveraging a CDN to reduce latency.'
    });
  }

  if ((analysis.errors || []).length) {
    recommendations.push({
      title: 'Review Error Responses',
      description: `Investigate the ${analysis.errors.length} error response(s) to improve reliability.`
    });
  }

  if ((analysis.slowRequests || []).length) {
    recommendations.push({
      title: 'Address Slow Endpoints',
      description: `Improve the ${analysis.slowRequests.length} slowest endpoints to enhance user experience.`
    });
  }

  if (analysis.totalRequests > 50) {
    recommendations.push({
      title: 'Reduce Request Volume',
      description: 'Batch or paginate requests where possible to minimize load.'
    });
  }

  if (!analysis.totalRequests) {
    recommendations.push({
      title: 'Start Capturing Traffic',
      description: 'Perform actions within the application to capture session activity for analysis.'
    });
  }

  if (analysis.performanceScore < 60) {
    recommendations.push({
      title: 'Improve Performance Score',
      description: 'Focus on reducing response times and fixing errors to raise the overall score.'
    });
  } else if (analysis.performanceScore >= 90) {
    recommendations.push({
      title: 'Excellent Performance',
      description: 'Session performance is outstanding. Document successful patterns for future reference.'
    });
  }

  analysis.recommendations = recommendations;
}

function buildLocalSummary(analysis) {
  return [
    `Analyzed ${analysis.totalRequests} request(s) with a ${analysis.successRate}% success rate.`,
    `Average response time is ${analysis.avgResponseTime} ms and performance score is ${analysis.performanceScore}.`,
    analysis.insights?.[0] ? analysis.insights[0] : ''
  ].filter(Boolean).join(' ');
}

function truncateUrl(url, maxLength = 80) {
  if (!url) return 'N/A';
  if (url.length <= maxLength) return url;

  try {
    const parsed = new URL(url);
    const condensed = `${parsed.hostname}${parsed.pathname}`;
    if (condensed.length <= maxLength) return condensed;
    const parts = parsed.pathname.split('/');
    const tail = parts[parts.length - 1];
    const shortened = `${parsed.hostname}/.../${tail}`;
    return shortened.length <= maxLength ? shortened : `${shortened.substring(0, maxLength - 3)}...`;
  } catch {
    return url.substring(0, maxLength - 3) + '...';
  }
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'N/A';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)} s`;
  return `${Math.round(milliseconds / 60000)} m`;
}

async function ensureAuthToken() {
  const token = await initializeAuthToken();
  if (!token) {
    throw new Error('Please authenticate with Alexandria before running AI analysis.');
  }
}

async function callAlexandriaAI(prompt) {
  const token = authTokenCache;
  if (!token) throw new Error('Missing Alexandria authentication token.');

  const payload = JSON.stringify(String(prompt ?? ''));
  const response = await fetch('https://alexandria.shs.aws.q2e.io/api/v3/ai/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`
    },
    body: payload
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Alexandria API error (${response.status}): ${text}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return { summary: text, response: text, isPlainText: true };
  }
}




