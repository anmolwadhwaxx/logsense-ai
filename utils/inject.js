// Self-invoking function to avoid polluting global scope
(function () {

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
