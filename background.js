// Store all captured request data by requestId - using persistent storage
const requests = {};
const MAX_STORED_REQUESTS = 1000; // Limit to prevent storage overflow
const STORAGE_KEY = 'easylog_requests';
const ENV_STORAGE_KEY = 'easylog_env_info';

// Store latest environment info sent from content script
let cachedEnvInfo = null;

// Add throttling for popup requests
let lastPopupRequestTime = 0;
const POPUP_REQUEST_THROTTLE = 50; // Reduced to 50ms throttle

// Load stored requests on startup
chrome.storage.local.get([STORAGE_KEY], (result) => {
  if (result[STORAGE_KEY]) {
    Object.assign(requests, result[STORAGE_KEY]);
    console.log('[background.js] Restored', Object.keys(requests).length, 'requests from storage');
  }
});

// Load cached environment info on startup
chrome.storage.local.get([ENV_STORAGE_KEY], (result) => {
  if (result[ENV_STORAGE_KEY]) {
    cachedEnvInfo = result[ENV_STORAGE_KEY];
    console.log('[background.js] Restored environment info from storage');
  }
});

// Persist requests to storage (debounced)
let saveTimeout = null;
function saveRequestsToStorage() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    // Keep only the most recent requests to prevent storage overflow
    const requestArray = Object.values(requests);
    if (requestArray.length > MAX_STORED_REQUESTS) {
      // Sort by timestamp and keep the most recent ones
      requestArray.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
      const recentRequests = requestArray.slice(0, MAX_STORED_REQUESTS);
      
      // Clear and rebuild requests object
      for (const key in requests) delete requests[key];
      recentRequests.forEach(req => {
        requests[req.requestId] = req;
      });
    }
    
    chrome.storage.local.set({
      [STORAGE_KEY]: requests
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[background.js] Failed to save requests:', chrome.runtime.lastError);
      }
    });
  }, 1000); // Save after 1 second of inactivity
}

// Clean up old requests (older than 24 hours)
function cleanupOldRequests() {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  let cleaned = 0;
  
  for (const requestId in requests) {
    const request = requests[requestId];
    if (request.startTime && request.startTime < oneDayAgo) {
      delete requests[requestId];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[background.js] Cleaned up ${cleaned} old requests`);
    saveRequestsToStorage();
  }
}

// Run cleanup every hour
setInterval(cleanupOldRequests, 60 * 60 * 1000);

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
      fi_no: extractFiNo(details.url),
      postData: details.requestBody ? JSON.stringify(details.requestBody) : null
    };
    saveRequestsToStorage(); // Persist to storage
  },
  { urls: ["<all_urls>"] }, // Listen to all URLs
  ["requestBody"] // Capture request body for HAR
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
      saveRequestsToStorage(); // Persist to storage
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
      req.statusText = details.statusLine;
      
      // Extract content type for HAR
      const contentTypeHeader = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type');
      req.mimeType = contentTypeHeader?.value || 'text/plain';
      saveRequestsToStorage(); // Persist to storage
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
      req.responseSize = details.responseSize;
      saveRequestsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] }
);

// Capture error information
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const req = requests[details.requestId];
    if (req) {
      req.error = details.error;
      req.endTime = details.timeStamp;
      saveRequestsToStorage(); // Persist to storage
    }
  },
  { urls: ["<all_urls>"] }
);

// --- Message Listener (handles messages from popup or content script) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return captured network data to popup (with throttling)
  if (message.action === 'getNetworkData') {
    const now = Date.now();
    if (now - lastPopupRequestTime < POPUP_REQUEST_THROTTLE) {
      // Too soon, return cached response
      sendResponse({ data: Object.values(requests) });
      return;
    }
    lastPopupRequestTime = now;
    
    sendResponse({ data: Object.values(requests) });

  // Clear all captured request data
  } else if (message.action === 'clearNetworkData') {
    for (const key in requests) delete requests[key];
    lastPopupRequestTime = 0; // Reset throttle
    // Clear storage as well
    chrome.storage.local.set({
      [STORAGE_KEY]: {}
    }, () => {
      console.log('[background.js] Cleared storage');
    });
    sendResponse({ success: true });

  // Cache environment info sent by content script
  } else if (message.type === 'UUX_ENV_INFO') {
    cachedEnvInfo = message.data;
    // Persist environment info to storage
    chrome.storage.local.set({
      [ENV_STORAGE_KEY]: message.data
    });
    sendResponse({ success: true });

  // Provide cached env info when popup requests it
  } else if (message.type === 'GET_CACHED_ENV_INFO') {
    sendResponse({ data: cachedEnvInfo });
  }
});
