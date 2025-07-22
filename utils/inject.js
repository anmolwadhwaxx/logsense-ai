// inject.js — runs in the page context

function logToContentScript(message) {
  window.postMessage({ type: 'INJECT_LOG', message }, '*');
}

logToContentScript('[inject.js] Loaded');

function readCookie(name) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i].trim();
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length);
  }
  return null;
}

function collectUUXEnvInfo() {
  logToContentScript('[inject.js] Collecting UUX env info');

  const tct = (typeof Tecton === "object" && Tecton !== null) ? Tecton : {
    "TECTON_PLATFORM_VERSION": "N/A",
    "TECTON_SDK_VERSION": "N/A"
  };
  logToContentScript(`[inject.js] Tecton object: ${JSON.stringify(tct)}`);

  const version = (typeof Ngam !== "undefined" && Ngam && Ngam.appVersion) ? Ngam.appVersion : "N/A";
  logToContentScript(`[inject.js] Ngam.appVersion: ${version}`);

  const themeFromCookie = readCookie("themeName");
  const theme = themeFromCookie || ((typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.themeName) ? Q2_CONFIG.themeName : "N/A");
  logToContentScript(`[inject.js] Theme: ${theme}`);

  const languageFromCookie = readCookie("languageCode");
  const language = languageFromCookie || "N/A";
  logToContentScript(`[inject.js] Language: ${language}`);

  const cdnBaseUrl = (typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.cdnBaseUrl) ? Q2_CONFIG.cdnBaseUrl : "N/A";
  const cdnCustomerNumber = (typeof Q2_CONFIG !== "undefined" && Q2_CONFIG.cdnCustomerNumber) ? Q2_CONFIG.cdnCustomerNumber : "N/A";
  logToContentScript(`[inject.js] CDN Base URL: ${cdnBaseUrl}, Customer #: ${cdnCustomerNumber}`);

  return {
    version,
    theme,
    language,
    tectonPlatformVersion: tct.TECTON_PLATFORM_VERSION,
    tectonSdkVersion: tct.TECTON_SDK_VERSION,
    cdnBaseUrl,
    cdnCustomerNumber,
  };
}

// Listen for messages from content script / popup
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data && event.data.type === 'REQUEST_UUX_ENV_INFO') {
    logToContentScript('[inject.js] REQUEST_UUX_ENV_INFO received, collecting env info');
    const envInfo = collectUUXEnvInfo();
    logToContentScript('[inject.js] Posting UUX_ENV_INFO: ' + JSON.stringify(envInfo));
    window.postMessage({ type: 'UUX_ENV_INFO', data: envInfo }, '*');
  }
});
