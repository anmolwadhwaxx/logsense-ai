/**
 * @file        userDetailsTab.js
 * @description Extract and render user/session/capability data inside the User Details tab.
 *
 * @summary
 *  Functions:
 *    - extractUserDetails(requests): Parse logonUser responses to build normalized user data.
 *    - renderUserDetails(userData): Drive population of profile, session, capability, and environment panels.
    - populateProfileSection()/populateSessionSection(): Render profile and session grids with formatted data.
    - populateCapabilitiesSection(): Render feature/transaction/system capability tabs and attach interactivity.
    - clearSections(): Reset tab content when no user data is available.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { escapeHtml, normalizeUtcOffset } from './utils.js';
import { getState, setUtcOffset } from './state.js';

export function extractUserDetails(requests) {
  if (!Array.isArray(requests)) return null;

  const candidates = requests
    .filter(entry =>
      (entry.url?.includes('logonUser?') || entry.isLogonUserCapture) &&
      entry.responseBody && entry.responseBody.trim().length
    )
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

  if (!candidates.length) return null;

  try {
    const payload = typeof candidates[0].responseBody === 'string'
      ? JSON.parse(candidates[0].responseBody)
      : candidates[0].responseBody;
    const rawData = payload?.data ?? payload ?? null;
    if (!rawData) return null;

    const normalized = { ...rawData };
    const candidateOffset = normalizeUtcOffset(
      rawData.utcOffset ?? candidates[0].utcOffset ?? null
    );
    if (candidateOffset) {
      normalized.utcOffset = candidateOffset;
    }

    if (!normalized.lastLogin) {
      normalized.lastLogin =
        normalized.lastSuccessfulLogonDateTime ??
        normalized.currentLogonDateTime ??
        normalized.lastFailedLogonDateTime ??
        null;
    }

    if (!normalized.lastActivity) {
      normalized.lastActivity =
        normalized.currentLogonDateTime ??
        normalized.lastSuccessfulLogonDateTime ??
        null;
    }

    if (!normalized.sessionId && normalized.sessionToken) {
      normalized.sessionId = normalized.sessionToken;
    }

    return normalized;
  } catch (error) {
    console.warn('[userDetailsTab] Failed to parse logonUser response', error);
    return null;
  }
}

export function renderUserDetails(userData) {
  const statusIndicator = document.querySelector('.user-status-indicator');

  if (!userData) {
    if (statusIndicator) {
      statusIndicator.innerHTML = '<span>No user data available</span>';
      statusIndicator.classList.remove('has-data');
    }
    clearSections();
    return;
  }

  const displayName = buildDisplayName(userData);
  if (statusIndicator) {
    statusIndicator.innerHTML = `<span>User: <strong>${escapeHtml(displayName)}</strong></span>`;
    statusIndicator.classList.add('has-data');
  }

  if (userData.utcOffset) {
    setUtcOffset(userData.utcOffset, 'auto');
  }

  populateProfileSection(userData);
  populateSessionSection(userData);
  populateCapabilitiesSection(userData);
  populateEnvironmentSection(userData);
  initCapabilityTabs();
}

function buildDisplayName(userData) {
  if (userData.firstName || userData.lastName) {
    return `${userData.firstName ?? ''} ${userData.lastName ?? ''}`.trim() || userData.loginName || 'User';
  }
  return userData.fullName || userData.loginName || userData.userId || 'User';
}

function populateProfileSection(userData) {
  const profileGrid = document.querySelector('.user-profile-content .user-info-grid');
  if (!profileGrid) return;

  profileGrid.innerHTML = buildGrid([
    ['User ID', userData.userId],
    ['Login Name', userData.loginName],
    ['Full Name', buildDisplayName(userData)],
    ['Customer ID', userData.customerId],
    ['Group ID', userData.groupId],
    ['Time Zone', userData.timeZone]
  ]);
}

function populateSessionSection(userData) {
  const sessionGrid = document.querySelector('.user-session-content .user-info-grid');
  if (!sessionGrid) return;

  sessionGrid.innerHTML = buildGrid([
    ['Session ID', userData.sessionId || userData.sessionToken],
    ['Session Expires', userData.sessionExpiresAt ? new Date(userData.sessionExpiresAt).toLocaleString() : 'N/A'],
    ['Session Lifetime', userData.sessionLifeTime !== undefined && userData.sessionLifeTime !== null ? `${userData.sessionLifeTime} minutes` : 'N/A'],
    ['Session Lock (minutes)', userData.sessionLockInMinutes !== undefined && userData.sessionLockInMinutes !== null ? `${userData.sessionLockInMinutes} minutes` : 'N/A'],
    ['Life Warning', userData.sessionLifeWarningSeconds !== undefined && userData.sessionLifeWarningSeconds !== null ? `${userData.sessionLifeWarningSeconds} seconds` : 'N/A'],
    ['Lock Warning', userData.sessionLockWarningSeconds !== undefined && userData.sessionLockWarningSeconds !== null ? `${userData.sessionLockWarningSeconds} seconds` : 'N/A'],
    ['Sliding Timeout', userData.slidingSessionTimeOut !== undefined && userData.slidingSessionTimeOut !== null ? `${userData.slidingSessionTimeOut} minutes` : 'N/A'],
    ['Treasury User', formatBoolean(userData.isTreasury)],
    ['CSR Assist', formatBoolean(userData.isCsrAssist)]
  ]);
}

function populateCapabilitiesSection(userData) {
  const capabilities = userData.capabilities || {};
  populateFeatures(capabilities.features ?? userData.featureFlags ?? []);
  populateTransactionRights(capabilities.transactionRights ?? userData.transactionRights ?? {});
  populateSystemFlags(capabilities, userData);
}

function populateEnvironmentSection(userData) {
  const element = document.getElementById('environment-data');
  if (!element) return;

  const environmentInfo = [];

  if (userData.customerId) environmentInfo.push(`Customer ID: ${userData.customerId}`);
  if (userData.groupId) environmentInfo.push(`Group ID: ${userData.groupId}`);
  if (userData.timeZone) environmentInfo.push(`Time Zone: ${userData.timeZone}`);
  if (userData.themeId) environmentInfo.push(`Theme ID: ${userData.themeId}`);
  if (userData.productId) environmentInfo.push(`Product ID: ${userData.productId}`);
  if (userData.sessionExpiresAt) environmentInfo.push(`Session Expires: ${new Date(userData.sessionExpiresAt).toLocaleString()}`);

  const envInfo = getState().envInfo;
  if (envInfo) {
    if (envInfo.version) environmentInfo.push(`UUX Version: ${envInfo.version}`);
    if (envInfo.tectonPlatformVersion) environmentInfo.push(`Tecton Platform: ${envInfo.tectonPlatformVersion}`);
    if (envInfo.cdnBaseUrl) environmentInfo.push(`CDN Base URL: ${envInfo.cdnBaseUrl}`);
    if (envInfo.cdnCustomerNumber) environmentInfo.push(`CDN Customer #: ${envInfo.cdnCustomerNumber}`);
  }

  if (!environmentInfo.length) {
    element.textContent = 'No environment data available.';
    return;
  }

  element.innerHTML = `
    <div class="environment-info-list">
      ${environmentInfo.map(info => `<div class="environment-info-item">${escapeHtml(info)}</div>`).join('')}
    </div>
  `;
}

function initCapabilityTabs() {
  const tabButtons = document.querySelectorAll('.capability-tab');
  const contents = document.querySelectorAll('.capability-content');

  tabButtons.forEach(button => {
    if (button.dataset.capabilityInit === 'true') return;
    button.dataset.capabilityInit = 'true';
    button.addEventListener('click', event => {
      const target = event.currentTarget.dataset.capability;
      tabButtons.forEach(btn => btn.classList.toggle('active', btn === event.currentTarget));
      contents.forEach(content => {
        content.classList.toggle('active', content.id === `${target}-content`);
      });
    });
  });
}

function populateFeatures(source) {
  const grid = document.querySelector('#features-content .capability-grid');
  if (!grid) return;

  let features = [];
  if (Array.isArray(source)) {
    features = source;
  } else if (source && typeof source === 'object') {
    features = Object.entries(source).map(([property, value]) => ({ property, value }));
  }

  if (!features.length) {
    grid.innerHTML = '<div class="capability-item">No features available</div>';
    return;
  }

  grid.innerHTML = features.map((feature, index) => {
    let featureName = 'Unknown Feature';
    let featureValue = false;

    if (typeof feature === 'object' && feature !== null) {
      if (feature.property) {
        featureName = formatPropertyName(feature.property);
      } else {
        featureName = feature.name || feature.key || feature.featureName || `Feature ${index + 1}`;
      }

      featureValue = feature.value !== undefined
        ? Boolean(feature.value)
        : feature.enabled !== undefined
          ? Boolean(feature.enabled)
          : feature.active !== undefined
            ? Boolean(feature.active)
            : false;
    } else if (typeof feature === 'string') {
      featureName = feature;
      featureValue = true;
    } else {
      featureName = String(feature);
      featureValue = true;
    }

    const statusClass = featureValue ? 'enabled' : 'disabled';
    const statusText = featureValue ? 'ENABLED' : 'DISABLED';

    return `
      <div class="capability-item">
        <div class="capability-name">${escapeHtml(featureName)}</div>
        <div class="capability-status ${statusClass}">
          ${escapeHtml(statusText)}
        </div>
      </div>
    `;
  }).join('');
}

function populateTransactionRights(transactionRights) {
  const grid = document.querySelector('#transactions-content .capability-grid');
  if (!grid) return;

  if (!transactionRights || typeof transactionRights !== 'object' || Object.keys(transactionRights).length === 0) {
    grid.innerHTML = '<div class="capability-item">No transaction rights available</div>';
    return;
  }

  grid.innerHTML = Object.entries(transactionRights).map(([name, details]) => {
    const displayName = escapeHtml(formatTransactionRightName(name));

    if (typeof details === 'boolean') {
      const statusClass = details ? 'enabled' : 'disabled';
      const statusText = details ? 'ENABLED' : 'DISABLED';
      return `
        <div class="capability-item">
          <div class="capability-name">${displayName}</div>
          <div class="capability-status ${statusClass}">
            ${escapeHtml(statusText)}
          </div>
        </div>
      `;
    }

    if (details && typeof details === 'object') {
      const createPermissionBadge = (label, value) => {
        const safeLabel = escapeHtml(label);
        if (typeof value === 'boolean') {
          return `<span class="permission-badge ${value ? 'enabled' : 'disabled'}">${safeLabel}: ${value ? 'Yes' : 'No'}</span>`;
        }
        if (typeof value === 'number') {
          if (label === 'View') {
            const viewText = value === 0 ? 'None' : value === 1 ? 'Own' : value === 2 ? 'All' : String(value);
            return `<span class="permission-badge ${value > 0 ? 'enabled' : 'disabled'}">${safeLabel}: ${escapeHtml(viewText)}</span>`;
          }
          if (label === 'Dual Auth Limit') {
            let text;
            if (value === -1) text = 'No Limit';
            else if (value === 0) text = 'Not Allowed';
            else text = `$${value.toLocaleString()}`;
            return `<span class="permission-badge enabled">${safeLabel}: ${escapeHtml(text)}</span>`;
          }
        }
        return `<span class="permission-badge neutral">${safeLabel}: ${escapeHtml(String(value))}</span>`;
      };

      const badges = [];
      if (details.view !== undefined) badges.push(createPermissionBadge('View', details.view));
      if (details.enabled !== undefined) badges.push(createPermissionBadge('Enabled', details.enabled));
      if (details.draft !== undefined) badges.push(createPermissionBadge('Draft', details.draft));
      if (details.authorize !== undefined) badges.push(createPermissionBadge('Authorize', details.authorize));
      if (details.cancel !== undefined) badges.push(createPermissionBadge('Cancel', details.cancel));
      if (details.draftRestricted !== undefined) badges.push(createPermissionBadge('Draft Restricted', details.draftRestricted));
      if (details.dualAuthLimit !== undefined) badges.push(createPermissionBadge('Dual Auth Limit', details.dualAuthLimit));

      return `
        <div class="capability-item transaction-right-inline">
          <div class="transaction-name">${displayName}</div>
          <div class="transaction-permissions">
            ${badges.join(' ')}
          </div>
        </div>
      `;
    }

    return `
      <div class="capability-item">
        <div class="capability-name">${displayName}</div>
        <div class="capability-status disabled">UNKNOWN</div>
      </div>
    `;
  }).join('');
}

function populateSystemFlags(capabilities, userData) {
  const grid = document.querySelector('#system-content .capability-grid');
  if (!grid) return;

  if (!capabilities || typeof capabilities !== 'object') {
    grid.innerHTML = '<div class="capability-item">No system flags available</div>';
    return;
  }

  const excludeKeys = ['features', 'transactionRights'];
  const systemFlags = [];

  Object.entries(capabilities).forEach(([key, value]) => {
    if (!excludeKeys.includes(key) && typeof value === 'boolean') {
      systemFlags.push({ name: key, value });
    }
  });

  if (userData?.systemFlags) {
    if (Array.isArray(userData.systemFlags)) {
      userData.systemFlags.forEach(flag => {
        systemFlags.push({ name: flag, value: true });
      });
    } else if (typeof userData.systemFlags === 'object') {
      Object.entries(userData.systemFlags).forEach(([key, value]) => {
        systemFlags.push({ name: key, value: Boolean(value) });
      });
    }
  }

  if (!systemFlags.length) {
    grid.innerHTML = '<div class="capability-item">No system flags available</div>';
    return;
  }

  grid.innerHTML = systemFlags.map(flag => {
    const statusClass = flag.value ? 'enabled' : 'disabled';
    const statusText = flag.value ? 'ENABLED' : 'DISABLED';
    return `
      <div class="capability-item">
        <div class="capability-name">${escapeHtml(formatSystemFlagName(flag.name))}</div>
        <div class="capability-status ${statusClass}">
          ${escapeHtml(statusText)}
        </div>
      </div>
    `;
  }).join('');
}

function buildGrid(rows) {
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `
      <div class="user-info-item">
        <span class="user-info-label">${escapeHtml(label)}</span>
        <span class="user-info-value">${escapeHtml(String(value))}</span>
      </div>
    `)
    .join('');
}

function formatBoolean(value) {
  if (value === undefined || value === null) return 'N/A';
  return value ? 'Yes' : 'No';
}

function formatPropertyName(property) {
  if (!property) return 'Unknown Feature';

  const parts = property.split('/');
  if (parts.length === 1) {
    return convertCamelCaseToReadable(parts[0]);
  }

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const secondLastPart = parts[parts.length - 2];

    if (lastPart.toLowerCase() === 'enabled' || lastPart.toLowerCase() === 'access') {
      if (parts.length >= 3) {
        const category = convertCamelCaseToReadable(secondLastPart);
        const parentCategory = convertCamelCaseToReadable(parts[parts.length - 3]);
        return `${parentCategory}: ${category}`;
      }
      return convertCamelCaseToReadable(secondLastPart);
    }

    const category = convertCamelCaseToReadable(secondLastPart);
    const feature = convertCamelCaseToReadable(lastPart);
    return `${category}: ${feature}`;
  }

  return convertCamelCaseToReadable(property.replace(/\//g, ' '));
}

function convertCamelCaseToReadable(text) {
  if (!text) return 'Unknown';
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

function formatTransactionRightName(name) {
  const patterns = {
    fundsTransfer: 'Funds Transfer',
    externalTransfer: 'External Transfer',
    achBatch: 'ACH Batch',
    achPayment: 'ACH Payment',
    achReceipt: 'ACH Receipt',
    achCollection: 'ACH Collection',
    payroll: 'Payroll',
    domesticWire: 'Domestic Wire',
    internationalWire: 'International Wire',
    sendCheck: 'Send Check',
    changeOfAddress: 'Change of Address',
    stopPayment: 'Stop Payment',
    achPassThru: 'ACH Pass Through',
    eftps: 'EFTPS',
    checkReorder: 'Check Reorder',
    billPayment: 'Bill Payment',
    rtpCreditTransfer: 'RTP Credit Transfer',
    rtpRequestForPayment: 'RTP Request for Payment',
    wireTransfer: 'Wire Transfer',
    depositCapture: 'Remote Deposit Capture',
    positivePayException: 'Positive Pay Exception',
    accountRecon: 'Account Reconciliation',
    cardManagement: 'Card Management',
    loanPayment: 'Loan Payment',
    investmentTransfer: 'Investment Transfer'
  };

  return patterns[name] || convertCamelCaseToReadable(name);
}

function formatSystemFlagName(name) {
  return convertCamelCaseToReadable(name);
}

function clearSections() {
  const profileGrid = document.querySelector('.user-profile-content .user-info-grid');
  const sessionGrid = document.querySelector('.user-session-content .user-info-grid');
  const featureGrid = document.querySelector('#features-content .capability-grid');
  const transactionGrid = document.querySelector('#transactions-content .capability-grid');
  const systemGrid = document.querySelector('#system-content .capability-grid');
  const environmentEl = document.getElementById('environment-data');

  if (profileGrid) profileGrid.innerHTML = '<div class="user-info-item"><div class="user-info-value">No user data available</div></div>';
  if (sessionGrid) sessionGrid.innerHTML = '<div class="user-info-item"><div class="user-info-value">No session data available</div></div>';
  if (featureGrid) featureGrid.innerHTML = '<div class="capability-item">No features data available</div>';
  if (transactionGrid) transactionGrid.innerHTML = '<div class="capability-item">No transaction rights data available</div>';
  if (systemGrid) systemGrid.innerHTML = '<div class="capability-item">No system flags data available</div>';
  if (environmentEl) environmentEl.textContent = 'No environment data available.';
}

