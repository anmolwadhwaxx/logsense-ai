/**
 * @file        helpers.js
 * @description Helper utilities for Alexandria log analysis: log selection, summary building, and summary rendering.
 *
 * @summary
 *  Functions:
 *    - selectLogsForAnalysis(logs): Choose representative first/last/error/context logs for AI prompts.
 *    - buildLogSummary(environment, totalLogs, selectedLogs): Build prompt-ready text describing selected logs.
 *    - renderAnalysisSummary(summary): Wrap AI summary text in styled HTML for display in the popup.
 *    - formatLogLine(index, log, label): Internal helper to format individual log entries.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { escapeHtml } from '../utils.js';

export function selectLogsForAnalysis(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return [];
  }

  const selectedLogs = [];

  const firstLogs = logs.slice(0, 5);
  selectedLogs.push(...firstLogs.map(log => ({ ...log, source: 'first' })));

  if (logs.length > 5) {
    const lastLogs = logs.slice(-5);
    selectedLogs.push(...lastLogs.map(log => ({ ...log, source: 'last' })));
  }

  const errorLogs = logs.filter(log => {
    const message = (log.message || log._raw || JSON.stringify(log)).toLowerCase();
    const level = (log.level || log.logLevel || '').toLowerCase();
    const hasErrorLevel = level.includes('error') ||
      level.includes('exception') ||
      level.includes('fatal');
    const hasErrorMessage =
      message.includes('error') ||
      message.includes('exception') ||
      message.includes('failed') ||
      message.includes('failure') ||
      message.includes('fatal') ||
      message.includes('critical');
    return hasErrorLevel || hasErrorMessage;
  });

  for (const errorLog of errorLogs) {
    selectedLogs.push({ ...errorLog, source: 'error' });
    const errorIndex = logs.findIndex(entry => entry === errorLog);
    const contextStart = Math.max(0, errorIndex - 5);
    const contextLogs = logs.slice(contextStart, errorIndex);

    for (const contextLog of contextLogs) {
      const contextMessage = (contextLog.message || contextLog._raw || JSON.stringify(contextLog)).toLowerCase();
      if (
        contextMessage.includes('request') ||
        contextMessage.includes('response') ||
        contextMessage.includes('http') ||
        contextMessage.includes('api') ||
        contextMessage.includes('endpoint')
      ) {
        selectedLogs.push({ ...contextLog, source: 'context' });
      }
    }
  }

  const uniqueLogs = [];
  const seen = new Set();

  for (const log of selectedLogs) {
    const key = `${log.timestamp || ''}_${(log.message || log._raw || '').toString().substring(0, 100)}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLogs.push(log);
    }
  }

  return uniqueLogs.slice(0, 25);
}

export function buildLogSummary(environment, totalLogs, selectedLogs) {
  let summary = `Found ${totalLogs} log entries from ${environment} environment. Selected ${selectedLogs.length} key logs for analysis:\n\n`;

  const logsBySource = {
    first: selectedLogs.filter(log => log.source === 'first'),
    error: selectedLogs.filter(log => log.source === 'error'),
    context: selectedLogs.filter(log => log.source === 'context'),
    last: selectedLogs.filter(log => log.source === 'last')
  };

  if (logsBySource.first.length) {
    summary += `=== FIRST ${logsBySource.first.length} LOGS (Session Start) ===\n`;
    logsBySource.first.forEach((log, index) => {
      summary += formatLogLine(index + 1, log);
    });
    summary += '\n';
  }

  if (logsBySource.error.length) {
    summary += `=== ERROR LOGS (${logsBySource.error.length} found) ===\n`;
    logsBySource.error.forEach((log, index) => {
      summary += formatLogLine(index + 1, log, 'Error');
    });
    summary += '\n';
  }

  if (logsBySource.context.length) {
    summary += `=== CONTEXT LOGS (${logsBySource.context.length} request/response logs around errors) ===\n`;
    logsBySource.context.forEach((log, index) => {
      summary += formatLogLine(index + 1, log, 'Context');
    });
    summary += '\n';
  }

  if (logsBySource.last.length) {
    summary += `=== LAST ${logsBySource.last.length} LOGS (Recent Activity) ===\n`;
    logsBySource.last.forEach((log, index) => {
      summary += formatLogLine(index + 1, log, 'Recent');
    });
  }

  return summary.trimEnd();
}

export function renderAnalysisSummary(summary) {
  return `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="font-weight: 600; font-size: 14px;">Analysis Summary</div>
      <div style="white-space: pre-wrap; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 12px; font-size: 13px;">
        ${escapeHtml(summary)}
      </div>
    </div>
  `;
}

function formatLogLine(index, log, label = 'Log') {
  const timestamp = log.timestamp || log.Timestamp || log['@timestamp'] || 'N/A';
  const level = log.level || log.logLevel || log.Level || log.severity || 'N/A';
  const message = (log.message || log.Message || log._raw || JSON.stringify(log)).substring(0, 300);
  return `${label} ${index}:\nTimestamp: ${timestamp}\nLevel: ${level}\nMessage: ${message}\n---\n`;
}

