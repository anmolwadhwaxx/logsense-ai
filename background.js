// Store all captured request data by requestId
const requests = {};

// Store latest environment info sent from content script
let cachedEnvInfo = null;

// --- Helper function ---

// Extract `fi_no` from the request URL (used for CDN deport pattern)
function extractFiNo(url) {
  const match = url.match(/cdn\/deport\/([^/]+)/);
  return match ? match[1] : null;
}

// --- Web Request Listeners ---

// Capture initial request details
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Initialize tracking for this request
    requests[details.requestId] = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      startTime: details.timeStamp,
      fi_no: extractFiNo(details.url)
    };
  },
  { urls: ["<all_urls>"] } // Listen to all URLs
);

// Capture request headers to extract q2token, workstation-id, utcOffset
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.requestHeaders = details.requestHeaders;

      // Extract q2token from headers
      const q2tokenHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'q2token');
      req.q2token = q2tokenHeader?.value || null;

      // Extract from Cookie header
      const cookieHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
      if (cookieHeader?.value) {
        // Extract workstation-id from cookie string
        const matchWorkstationId = cookieHeader.value.match(/(?:^|;\s*)workstation-id=([^;]*)/i);
        if (matchWorkstationId) {
          req.workstationId = matchWorkstationId[1];
        }

        // Extract utcOffset (e.g. +0000) from cookie
        const matchUtcOffset = cookieHeader.value.match(/(?:^|;\s*)utcOffset=([-+]\d{4})/i);
        if (matchUtcOffset) {
          req.utcOffset = matchUtcOffset[1];
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"] // Required to access request headers
);

// Capture response headers for the request
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.responseHeaders = details.responseHeaders;
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"] // Required to access response headers
);

// Capture when request is completed to store status and end time
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.statusCode = details.statusCode;
      req.endTime = details.timeStamp;
    }
  },
  { urls: ["<all_urls>"] }
);

// --- Message Listener (handles messages from popup or content script) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return captured network data to popup
  if (message.action === 'getNetworkData') {
    sendResponse({ data: Object.values(requests) });

  // Clear all captured request data
  } else if (message.action === 'clearNetworkData') {
    for (const key in requests) delete requests[key];
    sendResponse({ success: true });

  // Cache environment info sent by content script
  } else if (message.type === 'UUX_ENV_INFO') {
    cachedEnvInfo = message.data;
    sendResponse({ success: true });

  // Provide cached env info when popup requests it
  } else if (message.type === 'GET_CACHED_ENV_INFO') {
    sendResponse({ data: cachedEnvInfo });
  }
});
