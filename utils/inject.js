/**
 * @file        inject.js
 * @description Page-context script injected by the content script to intercept logonUser traffic and forward data back to LogEasy.
 *
 * @summary
 *  Functions:
 *    - getCurrentSessionId(): Extract q2token from document cookies.
 *    - interceptLogonUser(): Wrap XHR/fetch to capture logonUser requests and responses.
 *    - captureResponseBody(response, requestId): Relay response body data via postMessage to the content script.
 *    - postLogonUserResponse(details): Normalize and dispatch captured logonUser payloads to the background.
 *
 * @author      Hitesh Singh Solanki
 * @version     4.0.0
 * @lastUpdated 2025-10-16
 */

// Self-invoking function to avoid polluting global scope
(function () {
  console.log('[inject.js] Script loaded and starting logonUser interception setup');

  // Test basic postMessage communication
  setTimeout(() => {
    window.postMessage({
      type: 'TEST_FROM_INJECT',
      data: 'Hello from inject.js'
    }, '*');
    console.log('[inject.js] Sent test postMessage to content script');
  }, 1000);

  // --- LogonUser Request Interception ---
  
    console.log('[inject.js] Script starting');

  // Function to extract q2token from cookies
  function getCurrentSessionId() {
    try {
      const cookies = document.cookie.split(';');
      for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'q2token') {
          return value;
        }
      }
      return null;
    } catch (error) {
      console.warn('[inject.js] Failed to extract session ID:', error);
      return null;
    }
  }

  // Store original functions IMMEDIATELY
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  console.log('[inject.js] Original functions stored');
  
  // Override fetch to capture logonUser response bodies
  window.fetch = async function(...args) {
    const [resource, config] = args;
    let url = resource;
    
    // Handle Request object
    if (resource instanceof Request) {
      url = resource.url;
    }
    
    console.log('[inject.js] Fetch intercepted for URL:', url);
    
    // Call original fetch
    const response = await originalFetch.apply(this, args);
    
    // Check if URL contains "logonUser?"
    if (url && url.includes('logonUser?')) {
      console.log('[inject.js] LogonUser request detected!', url);
      try {
        // Clone response to read body without consuming it
        const responseClone = response.clone();
        const responseBody = await responseClone.text();
        
        console.log('[inject.js] Response body captured:', responseBody.substring(0, 100) + '...');
        
        // Send response body to content script via postMessage
        const sessionId = getCurrentSessionId();
        const messageData = {
          type: 'LOGON_USER_RESPONSE',
          data: {
            url: url,
            method: config?.method || 'GET',
            status: response.status,
            statusText: response.statusText,
            responseBody: responseBody,
            timestamp: Date.now(),
            headers: Object.fromEntries(response.headers.entries()),
            q2token: sessionId,
            pageUrl: window.location.href
          }
        };
        
        window.postMessage(messageData, '*');
        console.log('[inject.js] PostMessage sent for logonUser response');
        
        // Also try sending directly to window.parent in case we're in an iframe
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(messageData, '*');
          console.log('[inject.js] PostMessage also sent to parent window');
        }
        
      } catch (error) {
        console.error('[inject.js] Failed to capture response body:', error);
      }
    }
    
    return response;
  };
  
  console.log('[inject.js] Fetch override installed');
  
  // Also intercept XMLHttpRequest for older Q2 applications
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    console.log('[inject.js] XHR open intercepted:', method, url);
    this._logEasyUrl = url;
    this._logEasyMethod = method;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._logEasyUrl && this._logEasyUrl.includes('logonUser?')) {
      console.log('[inject.js] LogonUser XHR request detected!', this._logEasyUrl);
      
      // Set up response handler
      this.addEventListener('loadend', () => {
        if (this.readyState === 4) {
          console.log('[inject.js] XHR loadend for logonUser, status:', this.status);
          try {
            const sessionId = getCurrentSessionId();
            const messageData = {
              type: 'LOGON_USER_RESPONSE',
              data: {
                url: this._logEasyUrl,
                method: this._logEasyMethod || 'GET',
                status: this.status,
                statusText: this.statusText,
                responseBody: this.responseText,
                timestamp: Date.now(),
                headers: this.getAllResponseHeaders(),
                q2token: sessionId,
                pageUrl: window.location.href
              }
            };
            
            window.postMessage(messageData, '*');
            console.log('[inject.js] XHR PostMessage sent for logonUser response');
            
            // Also try sending to parent window
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(messageData, '*');
              console.log('[inject.js] XHR PostMessage also sent to parent window');
            }
            
          } catch (error) {
            console.error('[inject.js] Failed to capture XHR response body:', error);
          }
        }
      });
    }
    
    return originalXHRSend.apply(this, args);
  };

  console.log('[inject.js] XHR override installed');

  // --- End LogonUser Interception ---

  // Helper function to read a cookie by name
  function readCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let c of ca) {
      c = c.trim();
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
    }
    return null;
  }

  // Collect environment information from global objects and cookies
  function collectUUXEnvInfo() {
    console.log('[inject.js] collecting UUX env info');

    // Fallback Tecton object if not available
    const tct = (typeof Tecton === "object" && Tecton !== null) ? Tecton : {
      TECTON_PLATFORM_VERSION: "N/A",
      TECTON_SDK_VERSION: "N/A"
    };

    // Build env info object from various sources
    const envInfo = {
      version: (typeof Ngam !== "undefined" && Ngam.appVersion) ? Ngam.appVersion : "N/A",
      theme: readCookie("themeName") || (typeof Q2_CONFIG !== "undefined" ? Q2_CONFIG.themeName || "N/A" : "N/A"),
      language: readCookie("languageCode") || "N/A",
      tectonPlatformVersion: tct.TECTON_PLATFORM_VERSION,
      tectonSdkVersion: tct.TECTON_SDK_VERSION,
      cdnBaseUrl: (typeof Q2_CONFIG !== "undefined" ? Q2_CONFIG.cdnBaseUrl || "N/A" : "N/A"),
      cdnCustomerNumber: (typeof Q2_CONFIG !== "undefined" ? Q2_CONFIG.cdnCustomerNumber || "N/A" : "N/A"),
    };

    // Send collected data to content.js via postMessage
    window.postMessage({ type: 'UUX_ENV_INFO', data: envInfo }, '*');
  }

  // Waits until required global variables are available (or timeout)
  function waitForGlobals(maxAttempts = 60, interval = 500) {
    let attempts = 0;

    const check = () => {
      console.log(`[inject.js] check ${attempts}`);

      // If any of the required globals exist or maxAttempts reached, proceed
      if (
        typeof Ngam !== "undefined" ||
        typeof Tecton !== "undefined" ||
        typeof Q2_CONFIG !== "undefined" ||
        attempts >= maxAttempts
      ) {
        collectUUXEnvInfo();
      } else {
        // Retry after interval
        attempts++;
        setTimeout(check, interval);
      }
    };

    check();
  }

  // Listen for a message from content.js requesting env info
  window.addEventListener('message', event => {
    // Ignore messages not from this window context
    if (event.source !== window) return;

    // Respond to request by collecting env info
    if (event.data?.type === 'REQUEST_UUX_ENV_INFO') {
      console.log('[inject.js] got REQUEST_UUX_ENV_INFO');
      waitForGlobals(); // Start waiting/checking for globals
    }
  });

  // Immediately start waiting/checking for env info on script load
  waitForGlobals();
})();


