// Log to confirm content script is loaded
console.log('[content.js] loaded');

// This callback is temporarily stored to handle the async environment info request from popup.js
let contentEnvInfoCallback = null;

/**
 * Injects a script (usually inject.js) into the webpage's DOM.
 * This is used to access the page's JS context, which the content script itself cannot do directly.
 * 
 * @param {string} file - The path to the script file to inject.
 * @param {string} nodeTag - The tag to append the script into (e.g., "body" or "head").
 */
function fallbackInjectScript(file, nodeTag) {
  let target = document.getElementsByTagName(nodeTag)[0] || document.head;
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(file);
  script.onload = () => console.log(`[content.js] injected ${file} into ${nodeTag}`);
  target.appendChild(script);
}

// Inject the script immediately if the page is already loaded, otherwise wait for DOMContentLoaded
if (document.readyState !== 'loading') {
  fallbackInjectScript('utils/inject.js', 'body');
} else {
  document.addEventListener('DOMContentLoaded', () => fallbackInjectScript('utils/inject.js', 'body'));
}

// --- UI Enhancement: Add a floating button to fetch network data ---

// Create and style the floating button
const button = document.createElement('button');
Object.assign(button.style, {
  position: 'fixed',
  bottom: '10px',
  right: '10px',
  zIndex: '10000',
  padding: '10px',
  backgroundColor: '#007bff',
  color: '#fff',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
  display: 'none'
});
button.textContent = 'Fetch Network Data';

// Handle click: request network data from background, then display in a modal
button.addEventListener('click', () => {
  console.log('[content.js] button click');
  chrome.runtime.sendMessage({ action: 'getNetworkData' }, response => {
    console.log('[content.js] getNetworkData response:', response.data);
    if (response?.data) displayNetworkData(response.data);
    else alert('No network data captured.');
  });
});

// Append button to the document body
document.body.appendChild(button);

/**
 * Creates and shows a modal dialog with the captured network data.
 * @param {Array} data - Network data array to show.
 */
function displayNetworkData(data) {
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: '#fff',
    padding: '20px',
    boxShadow: '0 0 10px rgba(0,0,0,0.5)',
    zIndex: '10001',
    maxHeight: '80vh',
    overflowY: 'auto',
    width: '80vw',
    borderRadius: '8px'
  });

  // Inject content into the modal
  modal.innerHTML = `
    <h2>Captured Network Data</h2>
    <pre style="white-space:pre-wrap;word-break:break-word;">${JSON.stringify(data, null, 2)}</pre>
    <button id="modal-close" style="
      margin-top:15px;padding:8px 12px;
      background-color:#dc3545;color:#fff;border:none;
      border-radius:5px;cursor:pointer;
    ">Close</button>
  `;

  // Close button logic
  modal.querySelector('#modal-close').addEventListener('click', () => modal.remove());

  // Add modal to the DOM
  document.body.appendChild(modal);
}

// --- Cross-context communication using window.postMessage ---

/**
 * Listens for messages sent from the injected `inject.js` script (running in page context).
 * Forwards UUX_ENV_INFO back to the popup and invokes any stored callback.
 */
window.addEventListener('message', event => {
  // Only allow messages from the same window
  if (event.source !== window) return;

  // Check for the correct message type
  if (event.data?.type === 'UUX_ENV_INFO') {
    console.log('[content.js] forwarding UUX_ENV_INFO:', event.data.data);

    // Respond to the original popup message (if callback was stored)
    if (contentEnvInfoCallback) {
      contentEnvInfoCallback({ data: event.data.data });
      contentEnvInfoCallback = null;
    }

    // Also notify the background script (for caching or broadcasting)
    chrome.runtime.sendMessage({ type: 'UUX_ENV_INFO', data: event.data.data });
  }
});

/**
 * Handles messages from popup.js (via background or directly).
 * When popup requests environment info, forwards request to injected `inject.js` via window.postMessage.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_UUX_ENV_INFO') {
    console.log('[content.js] RECEIVED REQUEST_UUX_ENV_INFO from popup');

    // Store callback so we can reply asynchronously after the injected script responds
    contentEnvInfoCallback = sendResponse;

    // Ask the injected script (running in page context) to collect and post UUX env info
    window.postMessage({ type: 'REQUEST_UUX_ENV_INFO' }, '*');

    return true; // Required to keep the message channel open for async response
  }
});
