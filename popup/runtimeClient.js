/**
 * @file        runtimeClient.js
 * @description Thin abstraction over chrome.runtime messaging for popup <-> background communication and cookie helpers.
 *
 * @summary
 *  Functions:
 *    - initializePopupIdentity(): Register the popup instance and store returned identity details.
 *    - fetchNetworkData(): Request the latest captured network session data from the background script.
    - clearNetworkData(sessionId): Instruct the background to flush stored data for the active session.
    - requestCachedEnvInfo()/requestFreshEnvInfo(): Retrieve environment context from cache or by forcing refresh.
    - getCookieValue(url, name): Async helper that wraps chrome.cookies.get for popup consumption.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */
import { getState } from './state.js';

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function initializePopupIdentity() {
  const response = await sendMessage({ action: 'initializePopup' });
  if (!response || !response.popupId) {
    throw new Error('Popup identity could not be established');
  }
  return response;
}

export async function fetchNetworkData() {
  const { popupId } = getState();
  const payload = popupId
    ? { action: 'getNetworkData', popupId }
    : { action: 'getNetworkData' };
  const response = await sendMessage(payload);
  return response?.data ?? [];
}

export async function clearNetworkData(sessionId) {
  return sendMessage({
    action: 'clearNetworkData',
    sessionId
  });
}

export async function requestCachedEnvInfo() {
  const response = await sendMessage({ type: 'GET_CACHED_ENV_INFO' });
  return response?.data ?? null;
}

export async function requestFreshEnvInfo() {
  const tabId = await resolveActiveTabId();
  if (tabId === null) return null;
  return new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_UUX_ENV_INFO' }, response => {
        if (chrome.runtime.lastError) {
          const message = chrome.runtime.lastError.message || '';
          if (message.includes('Receiving end does not exist')) {
            resolve(null);
            return;
          }
          console.warn('[runtimeClient] Env info request failed:', message);
          resolve(null);
          return;
        }
        resolve(response?.data ?? null);
      });
    } catch (error) {
      console.warn('[runtimeClient] Env info request threw:', error);
      resolve(null);
    }
  });
}

export function getCookieValue(url, name) {
  return new Promise((resolve, reject) => {
    try {
      chrome.cookies.get({ url, name }, cookie => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(cookie?.value ?? null);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function resolveActiveTabId() {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs?.[0]?.id;
        resolve(typeof tabId === 'number' ? tabId : null);
      });
    } catch (error) {
      console.warn('[runtimeClient] Failed to resolve active tab id', error);
      resolve(null);
    }
  });
}


