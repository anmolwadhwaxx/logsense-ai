/**
 * @file        envInfo.js
 * @description Render environment information retrieved from the active tab into the popup UI.
 *
 * @summary
 *  Functions:
 *    - renderEnvInfo(info): Populate environment info panel with grouped sections.
 *    - renderEnvInfoLoading(): Show a temporary loading message while data is fetched.
 *    - envSection(title, items): Helper to wrap items in a titled section block.
 *    - envItem(label, value): Format individual label/value pairs with safe HTML.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { DOM_IDS } from './constants.js';
import { escapeHtml } from './utils.js';

export function renderEnvInfo(info) {
  const envElement = document.getElementById(DOM_IDS.envInfo);
  if (!envElement) return;

  if (!info) {
    envElement.textContent = 'No environment information available.';
    return;
  }

  const sections = [
    envSection('UUX Info', [
      envItem('Version:', info.version),
      envItem('Theme:', info.theme),
      envItem('Language:', info.language)
    ]),
    envSection('Tecton Info', [
      envItem('Platform Version:', info.tectonPlatformVersion),
      envItem('SDK Version:', info.tectonSdkVersion)
    ]),
    envSection('CDN Info', [
      envItem('Base URL:', info.cdnBaseUrl),
      envItem('Customer #:', info.cdnCustomerNumber)
    ])
  ];

  envElement.innerHTML = sections.join('');
}

export function renderEnvInfoLoading() {
  const envElement = document.getElementById(DOM_IDS.envInfo);
  if (!envElement) return;
  envElement.textContent = 'Loading environment info...';
}

function envSection(title, items) {
  return `<div class="env-section"><div class="env-section-title">${escapeHtml(title)}</div><div class="env-section-content">${items.join('')}</div></div>`;
}

function envItem(label, value) {
  const safeValue = value === undefined || value === null || value === '' ? 'N/A' : String(value);
  return `<div class="env-info-item"><span class="env-info-label">${escapeHtml(label)}</span> <span class="env-info-value">${escapeHtml(safeValue)}</span></div>`;
}

