/**
 * @file        visualizationTab.js
 * @description Render aggregate metrics and charts for network activity within the Visualization tab.
 *
 * @summary
 *  Functions:
 *    - renderVisualization(summary, options): Compute metrics and update visualization widgets, honouring time filters.
 *    - resetVisualization(): Clear metrics, charts, and endpoint lists when no session data is available.
 *    - Internal helpers mirror legacy behaviour (timeline, request type pie, endpoint analysis).
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { subscribe } from './state.js';

const vizState = {
  initialized: false,
  cachedSummary: null,
  lastHash: null,
  lastTimeRange: null
};

export function renderVisualization(summary, options = {}) {
  ensureInitialized();

  if (!summary || !Array.isArray(summary.requests) || summary.requests.length === 0) {
    vizState.cachedSummary = summary ?? null;
    vizState.lastHash = summary?.dataSignature?.hash ?? null;
    resetVisualization();
    return;
  }

  vizState.cachedSummary = summary;

  const currentHash = summary.dataSignature?.hash ?? null;
  const currentTimeRange = getSelectedTimeRange();
  const forceRender = Boolean(options.force);
  const tabActive = isVisualizationActive();

  if (!forceRender && currentHash === vizState.lastHash && currentTimeRange === vizState.lastTimeRange) {
    // Nothing new to render; if tab is inactive we can safely skip.
    if (!tabActive) return;
  }

  vizState.lastHash = currentHash;
  vizState.lastTimeRange = currentTimeRange;

  updateSiteIndicator(summary.activeDomain);

  const filteredRequests = applyTimeFilter(summary.requests, currentTimeRange);
  updateMetrics(filteredRequests);
  renderTimeline(filteredRequests);
  renderRequestTypes(filteredRequests);
  renderEndpointList(filteredRequests, summary.activeDomain);
}

export function resetVisualization() {
  vizState.lastHash = null;
  updateSiteIndicator(null);
  updateMetric('total-requests', '0');
  updateMetric('avg-response-time', '0ms');
  updateMetric('error-rate', '0%');
  updateMetric('data-transferred', '0 B');
  clearCanvas(document.getElementById('timeline-canvas'));
  clearCanvas(document.getElementById('types-canvas'));
  const domainList = document.getElementById('domain-list');
  if (domainList) {
    domainList.innerHTML = '<div class="domain-item"><span class="domain-name">No data available</span></div>';
  }
}

function ensureInitialized() {
  if (vizState.initialized) return;
  vizState.initialized = true;

  const refreshBtn = document.getElementById('refresh-viz');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = 'true';
    refreshBtn.addEventListener('click', () => rerenderFromCache());
  }

  const timeRangeSelect = document.getElementById('time-range');
  if (timeRangeSelect && !timeRangeSelect.dataset.bound) {
    timeRangeSelect.dataset.bound = 'true';
    timeRangeSelect.addEventListener('change', () => rerenderFromCache({ force: true }));
  }

  subscribe('tab-change', tabName => {
    if (tabName === 'visualization') {
      rerenderFromCache({ force: true });
    }
  });
}

function rerenderFromCache(options = {}) {
  if (!vizState.cachedSummary) {
    resetVisualization();
    return;
  }
  renderVisualization(vizState.cachedSummary, { force: Boolean(options.force) });
}

function updateSiteIndicator(domain) {
  const siteNameEl = document.getElementById('current-site-name');
  if (siteNameEl) {
    siteNameEl.textContent = domain || 'Unknown';
  }
}

function applyTimeFilter(requests, range) {
  if (!Array.isArray(requests) || requests.length === 0) return [];
  if (!range || range === 'all') return [...requests];

  const offsets = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000
  };

  const windowMs = offsets[range];
  if (!windowMs) return [...requests];

  const cutoff = Date.now() - windowMs;
  return requests.filter(entry => {
    const start = entry.startTime ?? entry.timestamp ?? 0;
    return start >= cutoff;
  });
}

function updateMetrics(requests) {
  const totalRequests = requests.length;
  const responseTimes = requests
    .filter(entry => entry.startTime && entry.endTime && entry.endTime > entry.startTime)
    .map(entry => entry.endTime - entry.startTime);

  const avgResponseTime = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length)
    : 0;

  const errorCount = requests.filter(entry => typeof entry.statusCode === 'number' && entry.statusCode >= 400).length;
  const errorRate = totalRequests > 0 ? Math.round((errorCount / totalRequests) * 100) : 0;

  const totalBytes = requests
    .filter(entry => typeof entry.responseSize === 'number' && entry.responseSize > 0)
    .reduce((sum, entry) => sum + entry.responseSize, 0);

  updateMetric('total-requests', totalRequests.toString());
  updateMetric('avg-response-time', `${avgResponseTime}ms`);
  updateMetric('error-rate', `${errorRate}%`);
  updateMetric('data-transferred', formatBytes(totalBytes));
}

function renderTimeline(requests) {
  const canvas = document.getElementById('timeline-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const timelineData = prepareTimelineData(requests);
  if (timelineData.length === 0) {
    clearCanvas(canvas);
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
    return;
  }

  drawTimelineChart(ctx, canvas, timelineData);
}

function renderRequestTypes(requests) {
  const canvas = document.getElementById('types-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!requests.length) {
    clearCanvas(canvas);
    return;
  }

  const typeCounts = {};
  requests.forEach(entry => {
    const url = (entry.url || '').toLowerCase();
    let type = 'Other';
    if (url.includes('/api/') || url.includes('api.')) type = 'API';
    else if (url.includes('.js')) type = 'JavaScript';
    else if (url.includes('.css')) type = 'CSS';
    else if (url.match(/\.(png|jpg|jpeg|gif|svg|webp)/)) type = 'Images';
    else if (url.includes('.html') || !url.includes('.')) type = 'HTML';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });

  drawPieChart(ctx, canvas, typeCounts);
}

function renderEndpointList(requests, activeDomain) {
  const domainList = document.getElementById('domain-list');
  if (!domainList) return;

  if (!requests.length) {
    domainList.innerHTML = '<div class="domain-item"><span class="domain-name">No data available</span></div>';
    return;
  }

  const endpointCounts = {};
  requests.forEach(entry => {
    const rawUrl = entry.url || '';
    let endpoint = 'Unknown';
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      endpoint = parsed.pathname || '/';
    } catch {
      endpoint = rawUrl.split('?')[0] || '/';
    }
    endpoint = endpoint
      .replace(/\/\d+/g, '/{id}')
      .replace(/\/[a-f0-9-]{36}/g, '/{uuid}');
    if (endpoint.length > 60) {
      endpoint = `${endpoint.slice(0, 57)}...`;
    }
    endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;
  });

  const entries = Object.entries(endpointCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  domainList.innerHTML = '';
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

  const sectionHeader = domainList.closest('.viz-section')?.querySelector('h3');
  if (sectionHeader && activeDomain) {
    sectionHeader.textContent = `Top Endpoints (${activeDomain})`;
  }
}

function prepareTimelineData(requests) {
  if (!requests.length) return [];
  const grouped = {};

  requests.forEach(entry => {
    const timestamp = entry.startTime ?? entry.timestamp ?? Date.now();
    const minuteBucket = Math.floor(timestamp / (60 * 1000)) * 60 * 1000;
    grouped[minuteBucket] = (grouped[minuteBucket] || 0) + 1;
  });

  return Object.entries(grouped)
    .map(([time, count]) => ({ time: Number(time), count }))
    .sort((a, b) => a.time - b.time);
}

function drawTimelineChart(ctx, canvas, data) {
  canvas.width = canvas.offsetWidth;
  canvas.height = 160;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const padding = 40;
  const width = canvas.width - padding * 2;
  const height = canvas.height - padding * 2;

  const minTime = data[0].time;
  const maxTime = data[data.length - 1].time || minTime + 1;
  const maxCount = Math.max(...data.map(item => item.count)) || 1;

  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();

  ctx.strokeStyle = '#007acc';
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((point, index) => {
    const x = padding + ((point.time - minTime) / (maxTime - minTime || 1)) * width;
    const y = canvas.height - padding - (point.count / maxCount) * height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = '#007acc';
  data.forEach(point => {
    const x = padding + ((point.time - minTime) / (maxTime - minTime || 1)) * width;
    const y = canvas.height - padding - (point.count / maxCount) * height;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#555';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  const firstLabel = new Date(minTime).toLocaleTimeString();
  const lastLabel = new Date(maxTime).toLocaleTimeString();
  ctx.fillText(firstLabel, padding, canvas.height - padding + 20);
  ctx.fillText(lastLabel, canvas.width - padding, canvas.height - padding + 20);
  ctx.textAlign = 'right';
  ctx.fillText(`${maxCount} req`, padding - 10, padding + 4);
}

function drawPieChart(ctx, canvas, counts) {
  canvas.width = canvas.offsetWidth;
  canvas.height = 160;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const entries = Object.entries(counts);
  if (!entries.length) return;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 20;
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const colors = ['#007acc', '#28a745', '#ffc107', '#dc3545', '#6c757d', '#17a2b8'];

  let angle = 0;
  entries.forEach(([label, count], index) => {
    const slice = (count / total) * Math.PI * 2;
    const color = colors[index % colors.length];

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    const labelAngle = angle + slice / 2;
    const labelX = centerX + Math.cos(labelAngle) * (radius * 0.6);
    const labelY = centerY + Math.sin(labelAngle) * (radius * 0.6);
    ctx.fillStyle = '#fff';
    ctx.font = '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, labelX, labelY);
    ctx.fillText(count.toString(), labelX, labelY + 12);

    angle += slice;
  });
}

function updateMetric(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(1)} ${units[exponent]}`;
}

function getSelectedTimeRange() {
  return document.getElementById('time-range')?.value || 'all';
}

function isVisualizationActive() {
  return document.getElementById('visualization-tab')?.classList.contains('active') ?? false;
}

