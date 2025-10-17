/**
 * @file        tabs.js
 * @description Handles tab navigation for the LogEasy popup, including default tab rendering and sample data utilities.
 *
 * @summary
 *  Functions:
 *    - initializeTabs(): Wire tab buttons, double-click sample injector, and render the active tab.
 *    - displayTab(tabName, buttons, contents): Toggle active classes across tab buttons/containers.
 *    - buildSampleUser(): Provide mock user data for demo/double-click testing scenarios.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { TAB_BUTTON_SELECTOR, TAB_CONTENT_SELECTOR, DEFAULT_ACTIVE_TAB } from './constants.js';
import { getState, setActiveTab } from './state.js';
import { renderUserDetails } from './userDetailsTab.js';

export function initializeTabs() {
  const buttons = document.querySelectorAll(TAB_BUTTON_SELECTOR);
  const contents = document.querySelectorAll(TAB_CONTENT_SELECTOR);
  const refreshUserBtn = document.getElementById('refresh-user-data');

  buttons.forEach(button => {
    button.addEventListener('click', event => {
      const targetTab = event.currentTarget.dataset.tab;
      if (!targetTab) return;
      setActiveTab(targetTab);
      displayTab(targetTab, buttons, contents);
    });
  });

  if (refreshUserBtn && !refreshUserBtn.dataset.sampleInit) {
    refreshUserBtn.dataset.sampleInit = 'true';
    refreshUserBtn.addEventListener('dblclick', () => {
      renderUserDetails(buildSampleUser());
    });
  }

  displayTab(getState().activeTab ?? DEFAULT_ACTIVE_TAB, buttons, contents);
}

export function displayTab(tabName, buttons = null, contents = null) {
  const tabButtons = buttons ?? document.querySelectorAll(TAB_BUTTON_SELECTOR);
  const tabContents = contents ?? document.querySelectorAll(TAB_CONTENT_SELECTOR);

  tabButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

function buildSampleUser() {
  const now = Date.now();
  return {
    userId: 'sample-user',
    loginName: 'john.doe@company.com',
    firstName: 'John',
    lastName: 'Doe',
    customerId: 'CUST-12345',
    groupId: 'GRP-001',
    timeZone: 'America/Chicago',
    language: 'en-US',
    emailAddress: 'john.doe@company.com',
    sessionId: 'sess_abc123def456',
    sessionExpiresAt: new Date(now + 25 * 60 * 1000).toISOString(),
    sessionLockInMinutes: 30,
    ssoAuthenticated: true,
    isTreasury: false,
    isCSR: true,
    lastLogin: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    lastActivity: new Date(now - 15 * 60 * 1000).toISOString(),
    capabilities: {
      features: [
        { property: 'Accounts/FundTransfer/Enabled', value: true },
        { property: 'Payments/ACH/Enabled', value: true }
      ],
      transactionRights: {
        fundsTransfer: { view: 2, enabled: true, authorize: true, draft: true },
        achBatch: { view: 1, enabled: true, draft: true, authorize: false }
      },
      debugEnabled: true
    },
    environment: 'Production',
    server: 'app-server-01.company.com',
    version: '2.3.1',
    build: '20240915.1',
    region: 'US-East',
    tenant: 'company-main'
  };
}


