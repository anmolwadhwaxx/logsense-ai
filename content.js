console.log('[content.js] script loaded');

// Because content scripts can't directly inject page scripts using executeScript without tabId,
// fallback to injecting a <script> tag into page context:

function fallbackInjectScript(file, node) {
  let target = document.getElementsByTagName(node)[0];
  if (!target) {
    console.warn(`[content.js] ${node} not found, trying <head>`);
    target = document.head;
    if (!target) {
      console.error('[content.js] No valid node to inject script');
      return;
    }
  }
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = chrome.runtime.getURL(file);
  target.appendChild(script);
  console.log(`[content.js] Fallback Injected ${file} into <${target.tagName.toLowerCase()}>`);
}

// Inject 'inject.js' on page context by adding script tag
if (document.readyState !== 'loading') {
  fallbackInjectScript('utils/inject.js', 'body');
} else {
  document.addEventListener('DOMContentLoaded', () => {
    fallbackInjectScript('utils/inject.js', 'body');
  });
}

// Create Fetch Network Data button UI
const button = document.createElement('button');
button.textContent = 'Fetch Network Data';
Object.assign(button.style, {
  position: 'fixed',
  bottom: '10px',
  right: '10px',
  zIndex: '10000',
  padding: '10px',
  backgroundColor: '#007bff',
  color: 'white',
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer',
});
document.body.appendChild(button);

button.addEventListener('click', function () {
  console.log('[content.js] Fetch Network Data button clicked');
  chrome.runtime.sendMessage({ action: 'getNetworkData' }, function (response) {
    if (response && response.data) {
      console.log('[content.js] Received network data:', response.data);
      displayNetworkData(response.data);
    } else {
      alert('No network data captured.');
      console.warn('[content.js] No network data received.');
    }
  });
});

function displayNetworkData(data) {
  const modal = document.createElement('div');
  Object.assign(modal.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'white',
    padding: '20px',
    boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
    zIndex: '10001',
    maxHeight: '80vh',
    overflowY: 'auto',
    width: '80vw',
    borderRadius: '8px',
  });

  const title = document.createElement('h2');
  title.textContent = 'Captured Network Data';
  modal.appendChild(title);

  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(data, null, 2);
  Object.assign(pre.style, {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  modal.appendChild(pre);

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  Object.assign(closeButton.style, {
    marginTop: '15px',
    padding: '8px 12px',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  });
  closeButton.addEventListener('click', function () {
    document.body.removeChild(modal);
  });
  modal.appendChild(closeButton);

  document.body.appendChild(modal);
}

// Listen for messages from inject.js (page context)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data && event.data.type === 'INJECT_LOG') {
    console.log('[inject.js]', event.data.message);
  }

  if (event.data && event.data.type === 'UUX_ENV_INFO') {
    console.log('[content.js] Received UUX_ENV_INFO:', event.data.data);
    // Forward to background or popup
    chrome.runtime.sendMessage({ type: 'UUX_ENV_INFO', data: event.data.data });
  }
});

// Listen for requests from popup to get UUX env info
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_UUX_ENV_INFO') {
    console.log('[content.js] Received REQUEST_UUX_ENV_INFO from popup');
    // Ask the page (inject.js) to send the info
    window.postMessage({ type: 'REQUEST_UUX_ENV_INFO' }, '*');
  }
});
