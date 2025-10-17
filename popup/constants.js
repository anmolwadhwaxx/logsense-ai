/**
 * @file        constants.js
 * @description Centralize selectors, DOM ids, and timing constants used across the LogEasy popup.
 *
 * @summary
 *  Constants:
 *    - TAB_BUTTON_SELECTOR/TAB_CONTENT_SELECTOR/DEFAULT_ACTIVE_TAB: Configure popup tab navigation.
 *    - DOM_IDS/DOM_SELECTORS: Normalized identifiers for querying key UI elements.
 *    - RENDER_THROTTLE_MS/POPUP_POLL_INTERVAL_MS: Timing knobs for rendering and polling loops.
 *    - LOGON_REQUEST_KEYWORD: Keyword used to detect logon-related network activity.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
export const TAB_BUTTON_SELECTOR = '.tab-button';
export const TAB_CONTENT_SELECTOR = '.tab-content';
export const DEFAULT_ACTIVE_TAB = 'logs';

export const DOM_IDS = {
  networkContainer: 'network-data',
  sessionSummaryContainer: 'session-summary',
  envInfo: 'env-info',
  clearButton: 'clear-button',
  downloadButton: 'download-json',
  refreshUser: 'refresh-user-data',
  aiAuthForm: 'auth-form',
  aiAuthStatus: 'auth-status',
  aiSummary: 'ai-summary-content',
  visualizationTab: 'visualization-tab',
  userDetailsTab: 'user-details-tab',
  logsTab: 'logs-tab'
};

export const DOM_SELECTORS = {
  sessionSummarySection: '.session-summary-container',
  collapsibleSection: '.collapsible-section'
};

export const RENDER_THROTTLE_MS = 250;
export const POPUP_POLL_INTERVAL_MS = 2000;

export const LOGON_REQUEST_KEYWORD = 'logonUser?';


