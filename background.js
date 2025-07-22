const requests = {};

// Helper to extract fi_no from URL
function extractFiNo(url) {
  const match = url.match(/cdn\/deport\/([^/]+)/);
  return match ? match[1] : null;
}

// Capture request details
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requests[details.requestId] = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      startTime: details.timeStamp,
      requestBody: details.requestBody || null,
      fi_no: extractFiNo(details.url)
    };
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Capture request headers and tokens
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (requests[details.requestId]) {
      requests[details.requestId].requestHeaders = details.requestHeaders;

      // Extract q2token and workstation-id from headers
      const q2tokenHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'q2token');
      requests[details.requestId].q2token = q2tokenHeader ? q2tokenHeader.value : null;

      // Extract from Cookie header
      const cookieHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'cookie');
      if (cookieHeader && cookieHeader.value) {
        // Extract workstation-id from cookie string
        const matchWorkstationId = cookieHeader.value.match(/(?:^|;\s*)workstation-id=([^;]*)/i);
        if (matchWorkstationId) {
          requests[details.requestId].workstationId = matchWorkstationId[1];
        }
        // Extract utcOffset from cookie string
        const matchUtcOffset = cookieHeader.value.match(/(?:^|;\s*)utcOffset=([-+]\d{4})/i);
        if (matchUtcOffset) {
          requests[details.requestId].utcOffset = matchUtcOffset[1];
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Capture response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (requests[details.requestId]) {
      requests[details.requestId].responseHeaders = details.responseHeaders;
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Capture response details
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (requests[details.requestId]) {
      requests[details.requestId].statusCode = details.statusCode;
      requests[details.requestId].endTime = details.timeStamp;
    }
  },
  { urls: ["<all_urls>"] }
);

// Respond to popup/content script requests for captured data or clearing data
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getNetworkData') {
    sendResponse({ data: Object.values(requests) });
  } else if (message.action === 'clearNetworkData') {
    for (const key in requests) {
      delete requests[key];
    }
    sendResponse({ success: true });
  }
});
