import { formatDateTime, getDomain, normalizeUtcOffset, sortDescendingByStartTime } from './utils.js';

/**
 * @file        sessionProcessor.js
 * @description Transform captured request arrays into session summaries, metadata, and Alexandria query inputs.
 *
 * @summary
 *  Functions:
 *    - createSessionSummary(data, activeDomain): Build a normalized summary with counts, timings, staging flags, etc.
 *    - deriveWorkstationId(requests)/deriveTimeRange(requests)/deriveUtcOffset(requests): Compute key identifiers, time boundaries, and timezone offsets.
 *    - detectStagingEnvironment(requests): Infer environment (staging vs production) from request metadata.
 *    - buildAlexandriaQueries(summary): Generate Alexandria log query strings for each environment.
 *    - selectDisplayRequests(requests): Choose and sort requests for presentation in the logs tab.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
export function createSessionSummary(data, activeDomain) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const relevantRequests = data
    .filter(entry => (entry.q2token && entry.q2token !== 'N/A') || entry.isLogonUserCapture)
    .filter(entry => {
      try {
        return getDomain(entry.url) === activeDomain;
      } catch {
        return false;
      }
    });

  if (relevantRequests.length === 0) return null;

  const requestsWithToken = relevantRequests.filter(entry => entry.q2token);
  const sessionId = requestsWithToken.length > 0
    ? requestsWithToken[requestsWithToken.length - 1].q2token
    : 'NO_SESSION';

  const sessionRequests = relevantRequests.filter(entry => entry.q2token === sessionId);
  if (!sessionRequests.length) return null;

  const workstationId = deriveWorkstationId(sessionRequests);
  const utcOffset = deriveUtcOffset(sessionRequests);
  const range = deriveTimeRange(sessionRequests);

  return {
    sessionId,
    workstationId,
    requests: sessionRequests,
    totalRequests: sessionRequests.length,
    startTime: range.startTime,
    endTime: range.endTime,
    activeDomain,
    isStaging: detectStagingEnvironment(sessionRequests),
    utcOffset,
    dataSignature: {
      sessionId,
      requestCount: sessionRequests.length,
      lastRequestId: sortDescendingByStartTime(sessionRequests)[0]?.requestId ?? null,
      hash: null
    }
  };
}

export function deriveWorkstationId(requests) {
  for (const entry of requests) {
    if (entry.workstationId && entry.workstationId !== 'N/A') {
      return entry.workstationId;
    }
  }
  return 'N/A';
}

export function deriveTimeRange(requests) {
  const startTimes = requests.map(r => r.startTime).filter(Boolean);
  const endTimes = requests.map(r => r.endTime || r.startTime).filter(Boolean);

  if (!startTimes.length || !endTimes.length) {
    const now = Date.now();
    return { startTime: now, endTime: now };
  }

  const firstRequest = Math.min(...startTimes);
  const lastRequest = Math.max(...endTimes);
  return {
    startTime: firstRequest - (5 * 60 * 1000),
    endTime: lastRequest + (5 * 60 * 1000)
  };
}

export function detectStagingEnvironment(requests) {
  return requests.some(request => {
    try {
      const url = new URL(request.url);
      return /staging|stage|temporary/i.test(url.hostname);
    } catch {
      return /staging|stage|temporary/i.test(request.url || '');
    }
  });
}

export function buildAlexandriaQueries(summary) {
  const formattedStart = formatDateTime(summary.startTime);
  const formattedEnd = formatDateTime(summary.endTime);

  const indices = {
    hq: summary.isStaging ? 'app_logs_stage_hq' : 'app_logs_prod_hq',
    lightbridge: summary.isStaging ? 'app_logs_stage_lightbridge' : 'app_logs_prod_lightbridge',
    kamino: summary.isStaging ? 'app_logs_stage_kamino' : 'app_logs_prod_kamino',
    ardent: summary.isStaging ? 'app_logs_stage_ardent' : 'app_logs_prod_ardent'
  };

  const searchStrings = {
    hq: `search index="${indices.hq}" sessionId="${summary.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
    lightbridge: `search index="${indices.lightbridge}" workstationId="${summary.workstationId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
    kamino: `search index="${indices.kamino}" sessionId="${summary.sessionId}" earliest="${formattedStart}" latest="${formattedEnd}" | fields * | extract | sort timestamp, seqId | head 10000`,
    ardent: `search index="${indices.ardent}" workstationId="${summary.workstationId}" earliest="-15m" | fields * | extract | sort timestamp, seqId | head 10000`
  };

  const urls = Object.fromEntries(
    Object.entries(searchStrings).map(([key, query]) => [
      key,
      `https://alexandria.shs.aws.q2e.io/logs/${encodeURIComponent(query)}`
    ])
  );

  return { indices, searchStrings, urls, formattedStart, formattedEnd };
}

export function selectDisplayRequests(requests) {
  const logonUserRequests = requests.filter(req =>
    req.url?.includes('logonUser?') || req.isLogonUser || req.isLogonUserCapture
  );
  const nonLogon = requests.filter(req =>
    !req.url?.includes('logonUser?') && !req.isLogonUser && !req.isLogonUserCapture
  );

  let preferredLogon = null;
  if (logonUserRequests.length) {
    preferredLogon = [...logonUserRequests].sort((a, b) => {
      const score = req => {
        if (req.isLogonUserCapture && req.responseBody) return 3;
        if (req.isLogonUserCapture) return 2;
        return 1;
      };
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (b.startTime || 0) - (a.startTime || 0);
    })[0];
  }

  const sortedNonLogon = sortDescendingByStartTime(nonLogon);
  return preferredLogon ? [preferredLogon, ...sortedNonLogon] : sortedNonLogon;
}

export function deriveUtcOffset(requests) {
  if (!Array.isArray(requests)) return null;
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const entry = requests[index];
    if (entry?.utcOffset) {
      const normalized = normalizeUtcOffset(entry.utcOffset);
      if (normalized) return normalized;
    }
    if (entry?.responseBody) {
      try {
        const payload = typeof entry.responseBody === 'string'
          ? JSON.parse(entry.responseBody)
          : entry.responseBody;
        const candidate = payload?.data?.utcOffset ?? payload?.utcOffset ?? null;
        const normalizedCandidate = normalizeUtcOffset(candidate);
        if (normalizedCandidate) return normalizedCandidate;
      } catch {
        // Ignore JSON parse errors for non-logon responses
      }
    }
  }
  return null;
}

