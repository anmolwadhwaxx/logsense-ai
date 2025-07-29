# Q2 Easy Log

**Q2 Easy Log** is a Chrome extension designed to assist Implemention Engineers by capturing network requests related to Q2 UUX applications. It allows users to inspect request details, extract `q2token`, `workstation-id`, and other key headers, and conveniently generate Alexandria HQ debug log URLs.

---

## Features

- Captures network requests from the active tab.
- Parses and displays:
  - Request method, URL, and status
  - Response time and headers
  - `q2token` and `workstation-id` from headers or cookies
  - `fi_no` from CDN deport URLs
- Collects and displays UUX environment information from the page.
- Allows users to:
  - Set custom UTC offset
  - Manage list of sites
  - Select the request origin side (Client/Server/Other)
- Generates direct search URLs for multiple Alexandria log platforms:
  - **Alexandria HQ Logs** - Session-based debugging
  - **Alexandria LightBridge Logs** - Workstation-based debugging  
  - **Alexandria Kamino Logs** - Additional session tracking
- Auto-detects staging vs production environments for accurate log indexing
- Optional floating UI element inside the webpage to fetch network data dynamically
- Enhanced UI with improved text wrapping and collapsible sections
- User Info section for future functionality expansion

---

## Folder Structure

    ├── icons/
    │ └── icon.png
    ├── popup/
    │ ├── popup.html
    │ ├── popup.css
    │ └── popup.js
    ├── utils/
    │ ├── har.js
    │ └── inject.js
    ├── background.js
    ├── content.js
    ├── manifest.json
    └── README.md

---

## File Overview

- `popup.html` : Popup UI for displaying network data, sites selector, environment info, and controls.

- `popup.css` : Stylesheet for the popup UI with collapsible sections and responsive layout.

- `popup.js` : Popup logic: site management, environment info requests, display and formatting of captured requests.

- `background.js` : Background script capturing network requests and responses via Chrome `webRequest` API, stores requests, listens for messages.

- `content.js` : Content script injecting `inject.js` into the page to gather environment data and relay it back via messaging.

- `inject.js` : Injected script running in the page context to collect environment info from global objects and cookies, sends data back to content script.

- `har.js` : Utilities for creating HAR logs from captured request/response data (can be extended for exporting HAR files).


---

## How It Works

### 1. **Background Service Worker**
- `background.js` uses Chrome’s `webRequest` API to capture:
  - Request/response headers
  - Timestamps
  - Status codes
- Stores request data and provides it to the popup or content scripts.

### 2. **Popup Interface**

- `popup.html`, `popup.js`, and `popup.css` power the extension UI.
- Shows a list of captured network requests and environment metadata.
- Generates Alexandria log search URLs for HQ, LightBridge, and Kamino platforms.
- Features enhanced UI with improved text wrapping and collapsible environment info section.
- Includes User Info section and download functionality for future enhancements.

### 3. **Content Script**
- `content.js` injects a floating button into pages.
- Communicates with `inject.js` (which runs in the page context) to access global JS variables and cookies (like `Ngam`, `Q2_CONFIG`, etc.).
- Collects UUX environment details and forwards them to the popup and background.

### 4. **Script Injection**
- `inject.js` runs in the page’s JS context.
- Extracts UUX-specific metadata like:
  - UUX version
  - Theme
  - Language
  - CDN base URL
  - Platform/SDK version
- Sends data back via `window.postMessage`.

---

## Build & Deployment

No build step is required. The extension is built using vanilla JavaScript and HTML/CSS. To install it locally:

### Install in Chrome

1. Clone the repo or download it from GitLab.
2. Open **chrome://extensions/**
3. Enable **Developer Mode**
4. Click **"Load unpacked"**
5. Select the root folder of the project.

---

## Required Permissions

```json
"permissions": [
  "tabs",
  "storage",
  "cookies",
  "scripting",
  "activeTab",
  "webRequest"
],
"host_permissions": [
  "<all_urls>"
]
```
These permissions are necessary to monitor network traffic, read cookies, and interact with the current tab.

---

## Alexandria Log URLs

For each captured request, URLs are generated for multiple Alexandria log platforms:

### HQ Logs
```bash
https://alexandria.shs.aws.q2e.io/logs/<SEARCH_STRING>
```

### LightBridge Logs  
```bash
https://alexandria.shs.aws.q2e.io/logs/<LIGHTBRIDGE_SEARCH_STRING>
```

### Kamino Logs
```bash
https://alexandria.shs.aws.q2e.io/logs/<KAMINO_SEARCH_STRING>
```

Search strings are automatically generated with the following format:

**HQ & Kamino (Session-based):**
```spl
search index="app_logs_{prod/stage}_{hq/kamino}" sessionId="..." earliest="..." latest="..." | fields * | extract | sort timestamp, seqId | head 10000
```

**LightBridge (Workstation-based):**
```spl
search index="app_logs_{prod/stage}_lightbridge" workstationId="..." earliest="..." latest="..." | fields * | extract | sort timestamp, seqId | head 10000
```

This enables comprehensive log lookup across all Q2 platforms for debugging user sessions.

---

## Development Notes

- `utils/har.js` includes functions to format request/response data into HAR format (can be extended for HAR export).
- `popup.js` has helper functions to extract, format, and render network request metadata with support for multiple log platforms.
- Content and popup scripts use `chrome.runtime.sendMessage()` for cross-context communication.
- The UI includes a collapsible panel for viewing environment info in detail with enhanced styling.
- Enhanced CSS styling provides better text wrapping and improved readability for long URLs and text content.

---

## Authors

- **Hitesh Singh Solanki** - Responsible for maintaining the project as well as implementing updates and new features.
[hsolanki](https://gitlab.com/HiteshSingh.solanki)
- **Ashish Kumar** - Initial work.
[akumar2](ashish.kumar@q2.com)

## Contributing

We welcome contributions to improve the functionality or fix bugs. To contribute:

1. Fork the repository.
2. Create a new branch with a descriptive name (e.g. `feature/improve-logging` or `bugfix/env-parser`).
3. Commit your changes with clear messages.
4. Before merging, please contact the maintainers.

Reach out to [hsolanki](https://gitlab.com/HiteshSingh.solanki) to discuss your changes or open a merge request.