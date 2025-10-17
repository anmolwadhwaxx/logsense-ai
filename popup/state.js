/**
 * @file        state.js
 * @description Centralized in-memory store for popup state with helper setters/getters and event listeners.
 *
 * @summary
 *  Functions:
 *    - getState(): Access the singleton popup state object.
 *    - setPopupIdentity()/setActiveTab()/updateSession(): Mutate core identity, navigation, and session properties.
 *    - setEnvInfo()/setWorkstationId()/setUpdating(): Update ancillary state exposed to UI modules.
 *    - on(event, handler)/off(event, handler): Subscribe/unsubscribe to state change events.
 *    - emit(event, payload): Notify registered listeners about state updates.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { DEFAULT_ACTIVE_TAB } from './constants.js';
import { normalizeUtcOffset } from './utils.js';

const popupState = {
  popupId: null,
  sourceTabId: null,
  activeTab: DEFAULT_ACTIVE_TAB,
  currentSession: null,
  lastSessionHash: null,
  lastDataHash: null,
  envInfo: null,
  charts: {},
  authToken: null,
  isInitialized: false,
  currentDomain: null,
  workstationId: 'N/A',
  isUpdating: false,
  utcOffset: null,
  utcOffsetSource: 'auto'
};

const listeners = new Map();

export function getState() {
  return popupState;
}

export function setPopupIdentity({ popupId, sourceTabId }) {
  popupState.popupId = popupId;
  popupState.sourceTabId = sourceTabId;
  emit('identity', { popupId, sourceTabId });
}

export function setActiveTab(tabName) {
  if (popupState.activeTab === tabName) return;
  popupState.activeTab = tabName;
  emit('tab-change', tabName);
}

export function updateSession(session) {
  popupState.currentSession = session;
  popupState.lastSessionHash = session?.dataSignature?.hash ?? null;
  emit('session-update', session);
}

export function setLastDataHash(hash) {
  popupState.lastDataHash = hash;
}

export function getLastDataHash() {
  return popupState.lastDataHash;
}

export function setCurrentDomain(domain) {
  popupState.currentDomain = domain;
}

export function getCurrentDomain() {
  return popupState.currentDomain;
}

export function setEnvInfo(envInfo) {
  popupState.envInfo = envInfo;
  emit('env-update', envInfo);
}

export function setAuthToken(token) {
  popupState.authToken = token;
  emit('auth-update', token);
}

export function getAuthToken() {
  return popupState.authToken;
}

export function markInitialized() {
  popupState.isInitialized = true;
}

export function isInitialized() {
  return popupState.isInitialized;
}

export function setWorkstationId(value) {
  popupState.workstationId = value ?? 'N/A';
  emit('workstation-update', popupState.workstationId);
}

export function getWorkstationId() {
  return popupState.workstationId;
}

export function setUpdating(flag) {
  popupState.isUpdating = Boolean(flag);
}

export function isUpdatingFlag() {
  return popupState.isUpdating;
}

export function setUtcOffset(offset, source = 'auto') {
  const normalized = offset === null || offset === undefined ? null : normalizeUtcOffset(offset);
  if (offset !== null && offset !== undefined && normalized === null) {
    return;
  }

  if (popupState.utcOffsetSource === 'manual' && source === 'auto') {
    return;
  }

  if (popupState.utcOffset === normalized && popupState.utcOffsetSource === source) {
    return;
  }

  popupState.utcOffset = normalized;
  popupState.utcOffsetSource = source;
  emit('utc-offset', popupState.utcOffset);
}

export function getUtcOffset() {
  return popupState.utcOffset;
}

export function cacheChartInstance(key, instance) {
  popupState.charts[key] = instance;
}

export function getChartInstance(key) {
  return popupState.charts[key];
}

export function resetCharts() {
  Object.values(popupState.charts).forEach(chart => {
    if (chart && typeof chart.destroy === 'function') {
      chart.destroy();
    }
  });
  popupState.charts = {};
}

export function subscribe(event, handler) {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

function emit(event, payload) {
  if (!listeners.has(event)) return;
  for (const handler of listeners.get(event)) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`[state] Failed to notify listener for ${event}`, error);
    }
  }
}

