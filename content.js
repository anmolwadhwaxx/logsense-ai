// Log to confirm content script is loaded
console.log('[content.js] loaded');

// Test chrome.runtime communication immediately
console.log('[content.js] Testing chrome.runtime communication...');
chrome.runtime.sendMessage({
  type: 'TEST_CONTENT_TO_BACKGROUND',
  data: 'Hello from content script'
}, (response) => {
  if (chrome.runtime.lastError) {
    console.error('[content.js] TEST: Error communicating with background:', chrome.runtime.lastError.message);
  } else {
    console.log('[content.js] TEST: Successfully communicated with background, response:', response);
  }
});

// This callback is temporarily stored to handle the async environment info request from popup.js
let contentEnvInfoCallback = null;

// Add a test postMessage listener to debug
console.log('[content.js] Setting up postMessage listener...');

// Test that postMessage is working at all
window.postMessage({ type: 'TEST_FROM_CONTENT', data: 'hello' }, '*');
console.log('[content.js] Sent test postMessage');

/**
 * Injects a script (usually inject.js) into the webpage's DOM.
 * This is used to access the page's JS context, which the content script itself cannot do directly.
 * 
 * @param {string} file - The path to the script file to inject.
 * @param {string} nodeTag - The tag to append the script into (e.g., "body" or "head").
 */
function fallbackInjectScript(file, nodeTag) {
  console.log(`[content.js] Attempting to inject ${file} into ${nodeTag}`);
  
  let target = document.getElementsByTagName(nodeTag)[0] || document.head;
  
  if (!target) {
    console.warn(`[content.js] Target ${nodeTag} not found, using document.head`);
    target = document.head;
  }
  
  if (!target) {
    console.error(`[content.js] No target element found for injection!`);
    return;
  }
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(file);
  script.onload = () => console.log(`[content.js] Successfully injected ${file} into ${nodeTag}`);
  script.onerror = (err) => console.error(`[content.js] Failed to inject ${file}:`, err);
  
  target.appendChild(script);
  console.log(`[content.js] Script element created and appended to ${target.tagName}`);
}

// Inject the script immediately if the page is already loaded, otherwise wait for DOMContentLoaded
console.log(`[content.js] Document ready state: ${document.readyState}`);

if (document.readyState !== 'loading') {
  console.log('[content.js] Document already loaded, injecting immediately');
  fallbackInjectScript('utils/inject.js', 'body');
} else {
  console.log('[content.js] Document still loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[content.js] DOMContentLoaded fired, injecting now');
    fallbackInjectScript('utils/inject.js', 'body');
  });
}

// --- UI Enhancement: Add a floating button to fetch network data ---

function createFloatingButton() {
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

  // Append button to the document body safely
  if (document.body) {
    document.body.appendChild(button);
    console.log('[content.js] Floating button added to page');
  } else {
    // Wait for body to be available
    const observer = new MutationObserver((mutations, obs) => {
      if (document.body) {
        document.body.appendChild(button);
        console.log('[content.js] Floating button added to page (after waiting)');
        obs.disconnect();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
}

// Call the function to create the button
createFloatingButton();

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
    <button id="export-har" style="
      margin-top:15px;margin-left:10px;padding:8px 12px;
      background-color:#28a745;color:#fff;border:none;
      border-radius:5px;cursor:pointer;
    ">Export as HAR</button>
  `;

  // Add event listeners to modal buttons
  modal.querySelector('#modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.querySelector('#export-har').addEventListener('click', () => {
    exportAsHAR(data);
  });

  // Display the modal
  document.body.appendChild(modal);
}

/**
 * Converts captured network data to HAR format and triggers download.
 * @param {Array} data - Network data array to export.
 */
function exportAsHAR(data) {
  const harData = {
    log: {
      version: "1.2",
      creator: { name: "Q2 Easy Log", version: "1.0" },
      entries: data.map(entry => ({
        startedDateTime: new Date(entry.startTime).toISOString(),
        time: (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime) : 0,
        request: {
          method: entry.method || 'GET',
          url: entry.url || '',
          httpVersion: "HTTP/1.1",
          headers: entry.requestHeaders ? entry.requestHeaders.map(h => ({name: h.name, value: h.value})) : [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1,
          postData: entry.postData ? { mimeType: 'application/json', text: entry.postData } : undefined
        },
        response: {
          status: entry.statusCode || 0,
          statusText: entry.statusText || '',
          httpVersion: "HTTP/1.1", 
          headers: entry.responseHeaders ? entry.responseHeaders.map(h => ({name: h.name, value: h.value})) : [],
          cookies: [],
          content: {
            size: entry.responseSize || 0,
            mimeType: entry.mimeType || 'text/plain',
            text: entry.responseBody || ''
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: -1
        },
        cache: {},
        timings: {
          send: 0,
          wait: (entry.endTime && entry.startTime) ? (entry.endTime - entry.startTime) : 0,
          receive: 0
        }
      }))
    }
  };

  const blob = new Blob([JSON.stringify(harData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `q2-network-data-${Date.now()}.har`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Cross-context communication using window.postMessage ---

/**
 * Listens for messages sent from the injected `inject.js` script (running in page context).
 * Forwards UUX_ENV_INFO back to the popup and invokes any stored callback.
 * Also handles LOGON_USER_RESPONSE messages from inject.js.
 */
window.addEventListener('message', event => {
  console.log('[content.js] *** RECEIVED ANY MESSAGE ***:', {
    type: event.data?.type,
    origin: event.origin,
    currentOrigin: window.location.origin,
    source: event.source,
    sameWindow: event.source === window,
    data: event.data
  });
  
  // Accept messages from the same origin (page context to content script)
  if (event.origin !== window.location.origin) {
    console.log('[content.js] Ignoring message from different origin:', event.origin, 'vs', window.location.origin);
    return;
  }

  // Check for the correct message type
  if (event.data?.type === 'TEST_FROM_INJECT') {
    console.log('[content.js] *** RECEIVED TEST MESSAGE FROM INJECT.JS! ***', event.data.data);
  } else if (event.data?.type === 'TEST_FROM_CONTENT') {
    console.log('[content.js] *** RECEIVED TEST MESSAGE FROM SELF ***', event.data.data);
  } else if (event.data?.type === 'UUX_ENV_INFO') {
    console.log('[content.js] forwarding UUX_ENV_INFO:', event.data.data);

    // Respond to the original popup message (if callback was stored)
    if (contentEnvInfoCallback) {
      contentEnvInfoCallback({ data: event.data.data });
      contentEnvInfoCallback = null;
    }

    // Also notify the background script (for caching or broadcasting)
    chrome.runtime.sendMessage({ type: 'UUX_ENV_INFO', data: event.data.data });
  } else if (event.data?.type === 'LOGON_USER_RESPONSE') {
    console.log('[content.js] *** RECEIVED LOGON_USER_RESPONSE! ***', event.data.data.url);
    
    // Test if chrome.runtime is available
    if (!chrome.runtime) {
      console.error('[content.js] chrome.runtime is not available!');
      return;
    }
    
    // Validate the message data
    const messageData = {
      type: 'LOGON_USER_RESPONSE',
      data: event.data.data
    };
    
    console.log('[content.js] Preparing to send message:', messageData);
    console.log('[content.js] Message data structure:', JSON.stringify(messageData, null, 2));
    
    console.log('[content.js] Attempting to send message to background...');
    
    // Forward logonUser response to background script
    try {
      chrome.runtime.sendMessage(messageData, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[content.js] Error sending to background:', chrome.runtime.lastError.message);
          // Don't return here - the error might be a timing issue but the message could still be received
        } else {
          console.log('[content.js] Successfully forwarded logonUser response to background, response:', response);
        }
      });
    } catch (error) {
      console.error('[content.js] Exception while sending message:', error);
    }
    
    // Also try to send without callback to avoid port closure issues
    try {
      chrome.runtime.sendMessage(messageData);
      console.log('[content.js] Sent logonUser response without callback as backup');
    } catch (error) {
      console.error('[content.js] Exception while sending backup message:', error);
    }
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
  } else if (message.type === 'TEST_INJECT_STATUS') {
    console.log('[content.js] Received TEST_INJECT_STATUS request');
    
    // Test if inject.js is working by sending a test message
    window.postMessage({ type: 'TEST_FROM_CONTENT_TO_INJECT' }, '*');
    
    sendResponse({ 
      status: 'Content script is working',
      timestamp: Date.now(),
      url: window.location.href
    });
    return true;
  }

  return false; // Don't keep the message channel open for other messages
});
