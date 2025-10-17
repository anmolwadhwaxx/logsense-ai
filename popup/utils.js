/**
 * @file        utils.js
 * @description Shared popup utility helpers for formatting, hashing, DOM manipulation, timezones, and downloads.
 *
 * @summary
 *  Functions:
 *    - formatDateTime(timestamp)/formatDateTimeWithOffset(timestamp, offset, options): Date formatting helpers.
 *    - normalizeUtcOffset(value)/formatUtcOffsetLabel(offset)/formatUtcOffsetForInput(offset): UTC offset utilities.
 *    - createDataHash(data): Produce a stable hash signature for request arrays.
 *    - formatJsonResponse()/safeJsonParse(): JSON formatting and parsing with guardrails.
 *    - triggerJsonDownload(filename, dataObject): Download arbitrary data as JSON.
 *    - copyToClipboard(text): Copy text to clipboard with fallback for legacy browsers.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.1.0
 * @lastUpdated 2025-10-18
 */
const pad = (value) => value.toString().padStart(2, '0');

function buildDateOutput(date) {
  return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  return buildDateOutput(new Date(timestamp));
}

export function normalizeUtcOffset(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper === 'UTC' || upper === 'Z') {
    return '+0000';
  }

  const match = trimmed.match(/^([+-])?(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;

  const sign = match[1] === '-' ? '-' : '+';
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (Math.abs(hours) > 14 || minutes < 0 || minutes >= 60) return null;

  return `${sign}${pad(Math.abs(hours))}${pad(minutes)}`;
}

function offsetToMinutes(offset) {
  const normalized = normalizeUtcOffset(offset);
  if (!normalized) return 0;
  const sign = normalized[0] === '-' ? -1 : 1;
  const hours = parseInt(normalized.slice(1, 3), 10);
  const minutes = parseInt(normalized.slice(3, 5), 10);
  return sign * (hours * 60 + minutes);
}

export function formatUtcOffsetLabel(offset) {
  const normalized = normalizeUtcOffset(offset);
  if (!normalized) return 'UTC';
  const sign = normalized[0];
  const hours = normalized.slice(1, 3);
  const minutes = normalized.slice(3, 5);
  return `UTC${sign}${hours}:${minutes}`;
}

export function formatUtcOffsetForInput(offset) {
  const normalized = normalizeUtcOffset(offset);
  return normalized ?? '';
}

export function formatDateTimeWithOffset(timestamp, offset, options = {}) {
  if (!timestamp) return 'N/A';
  const includeLabel = options.includeLabel ?? false;
  const normalized = normalizeUtcOffset(offset);
  const baseDate = new Date(timestamp + offsetToMinutes(normalized) * 60 * 1000);
  const formatted = buildDateOutput(baseDate);
  if (!includeLabel) return formatted;
  return `${formatted} ${formatUtcOffsetLabel(normalized)}`;
}

export function getDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[0] || '';
  }
}

export function getProtocol(url) {
  if (!url) return 'https:';
  try {
    return new URL(url).protocol;
  } catch {
    return 'https:';
  }
}

export function createDataHash(data) {
  if (!Array.isArray(data) || data.length === 0) return 'empty';

  const relevantData = data
    .filter(entry => (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture)
    .map(entry => `${entry.requestId}-${entry.startTime}-${entry.q2token || 'logon'}-${entry.isLogonUserCapture || false}`)
    .join('|');

  const totalRelevantCount = data.filter(entry =>
    (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture
  ).length;

  const latestSessionId = data
    .filter(entry => entry.q2token && entry.q2token !== 'N/A')
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0]?.q2token || 'no-session';

  return `${relevantData}-count:${totalRelevantCount}-session:${latestSessionId}` || 'no-valid-data';
}

export function sortDescendingByStartTime(requests) {
  return [...requests].sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

export function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatJsonResponse(payload) {
  if (payload === undefined || payload === null) return '';
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  }
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function triggerJsonDownload(filename, dataObject) {
  const blob = new Blob([JSON.stringify(dataObject, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function generateUid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toggleElementVisibility(element, forceState) {
  if (!element) return;
  if (typeof forceState === 'boolean') {
    element.style.display = forceState ? '' : 'none';
    return;
  }
  element.style.display = element.style.display === 'none' ? '' : 'none';
}

export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

