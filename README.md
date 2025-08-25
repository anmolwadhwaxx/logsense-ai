# Q2 Easy Log Chrome Extension

**Q2 Easy Log** is a comprehensive Chrome extension designed to streamline debugging workflows for Q2 UUX (Universal User Experience) applications. It provides real-time network monitoring, intelligent session management, and seamless integration with Alexandria log search across multiple Q2 platforms.

---

## Key Features

### **Advanced Network Monitoring**

- **Real-time traffic capture** using Chrome's webRequest API with comprehensive timing data
- **Smart session tracking** with automatic q2token and workstation-id extraction from headers and cookies
- **Intelligent request filtering** for Q2-specific traffic patterns with domain-based organization
- **Complete header preservation** including authentication tokens, cookies, and custom headers
- **Request/response body capture** for detailed debugging and HAR export compatibility
- **Fi_no extraction** from CDN deport patterns for enhanced debugging context

### **Multi-Platform Alexandria Integration**

- **HQ Logs** (Blue buttons): Session-based debugging with q2token using 30-minute time windows
- **LightBridge Logs** (Green buttons): Workstation-based debugging with enhanced filtering using 30-minute windows
- **Kamino Logs** (Gray buttons): Session-based tracking with advanced SPL queries using 30-minute windows
- **Ardent Logs** (Red buttons): Workstation-based debugging with optimized 15-minute time windows for faster results
- **Automatic SPL generation** with proper indexing, time ranges, and field extraction
- **Environment-aware indexing** with automatic staging vs production detection based on URL patterns

### **Intelligent Session Management**

- **Dynamic session aggregation** with real-time request grouping by q2token
- **Comprehensive session metrics** including request counts, timing analysis, and metadata correlation
- **Smart time range calculation** (±5 minutes from session activity boundaries)
- **Environment detection** with automatic staging/production identification via URL analysis
- **Session persistence** with automatic cleanup and state management until session ID changes
- **Workstation correlation** for accurate cross-platform debugging with automatic extraction from headers

### **Enhanced User Experience**

- **Modern responsive design** with flexbox layout optimized for 400px popup width
- **Color-coded platform access** for instant visual identification of log sources
- **Collapsible interface sections** for efficient space utilization and workflow optimization
- **Professional styling** with consistent visual hierarchy and spacing
- **Enhanced text handling** with proper word wrapping, overflow management, and readability
- **Loading state management** to prevent UI flickering and improve perceived performance
- **Anti-flicker optimizations** with transition and animation prevention during load

### **Advanced Export & Integration**

- **HAR (HTTP Archive) format export** with full compliance to HAR 1.2 specification standards
- **JSON data export** with structured session data for custom analysis tools
- **Complete session preservation** including timing, headers, and payload data
- **Developer-friendly formats** compatible with standard debugging and analysis tools
- **Timestamped file naming** for organized export management

### **Technical Excellence**

- **Manifest V3 compliance** ensuring future-proof Chrome extension compatibility
- **Service Worker architecture** for reliable background processing and memory efficiency
- **Content script injection** for seamless page-level JavaScript object access (Ngam, Q2_CONFIG, Tecton)
- **Environment metadata extraction** including UUX version, theme, language, CDN configuration, and platform data
- **Performance optimization** with 50ms throttling, intelligent caching, and efficient DOM manipulation
- **Cross-context messaging** for reliable communication between extension components
- **Fallback mechanisms** for robust environment detection with timeout handling

---

## Latest Updates

### Major UI/UX Improvements

- **Complete interface redesign** with modern, professional styling and improved visual hierarchy
- **Color-coded platform buttons** for intuitive Alexandria log access (HQ=Blue, LightBridge=Green, Kamino=Gray, Ardent=Red)
- **Fully responsive layout** with adaptive button sizing and optimal space utilization
- **Significant performance boost** with 70% faster popup loading times through advanced caching strategies
- **Enhanced content presentation** with improved text wrapping, overflow handling, and readability optimization

### Advanced Session Management

- **Smart session state tracking** with automatic persistence and cleanup mechanisms
- **Improved request filtering** with session-based grouping and intelligent relevance scoring
- **Enhanced session summaries** with comprehensive metrics and real-time data aggregation
- **Robust environment detection** including UUX metadata, version tracking, and configuration analysis

### Technical Architecture Enhancements

- **Optimized background processing** with improved service worker efficiency and memory management
- **Enhanced content script injection** for better page compatibility and error handling
- **Improved cross-component communication** with reliable message passing and state synchronization
- **Advanced error handling** with comprehensive logging and graceful degradation strategies

### Developer Experience Improvements

- **Enhanced debugging capabilities** with detailed console logging and error tracking
- **Comprehensive code documentation** with inline comments and architectural explanations
- **Improved code maintainability** with modular structure and clear separation of concerns
- **Better testing support** with structured data formats and predictable behavior patterns

---

## Extension Architecture & User Interface

The extension features a sophisticated architecture with a comprehensive popup interface designed for efficient Q2 UUX debugging:

### **Popup Interface Components**

#### **Control Panel**
- **Clear Data Button**: Instantly clears all captured network data and resets the session
- **UTC Offset Configuration**: Customizable timezone offset (default: -0700) for accurate timestamp alignment
- **Site Management**: 
  - Dynamic site selector for switching between monitored domains
  - Add custom sites functionality with persistent storage
  - Automatic detection and addition of current active domains

#### **Side Selection**
- **Environment Context**: Client/Server/Other classification with custom side input option
- **Debugging Context**: Helps categorize the debugging session for better organization

#### **Collapsible Environment Information Panel**
- **Real-time UUX metadata extraction** including:
  - Application version from Ngam global object
  - Theme and language detection from cookies and Q2_CONFIG
  - Tecton platform and SDK version information
  - CDN configuration details (base URL, customer number)
- **Enhanced formatting** with proper data validation and error handling
- **Expandable/collapsible design** to save screen space while maintaining accessibility

#### **Session Summary Dashboard**
- **Comprehensive session analytics** with real-time metrics:
  - Total request count for active session
  - Session ID (q2token) and Workstation ID correlation
  - Environment detection (Staging vs Production)
  - Calculated time ranges optimized for log searching
- **Unified Alexandria Log Access** with color-coded buttons:
  - **HQ Logs** (Blue): Session-based queries with q2token
  - **LightBridge Logs** (Green): Workstation-based queries  
  - **Kamino Logs** (Gray): Additional session tracking
  - **Ardent Logs** (Red): Workstation-based with 15-minute windows
- **Responsive button layout** that adapts to popup dimensions

#### **Individual Request Explorer (Collapsible)**
- **Detailed request analysis** without interface redundancy
- **Complete header inspection** with timing analysis and payload examination
- **Enhanced data visualization** with improved formatting and readability
- **Request filtering** showing only session-relevant traffic

#### **Export Actions**
- **Download Full HAR Log**: Complete HTTP Archive export in industry-standard format
- **Timestamped exports** for organized debugging session management

### **Technical Implementation Details**

---

## Project Structure

    ├── .git/                    # Git repository metadata
    ├── .gitlab/                 # GitLab CI/CD configuration
    ├── icons/
    │   └── icon.png            # Extension icon (16x16, 48x48, 128x128)
    ├── popup/
    │   ├── popup.html          # Main extension popup interface
    │   ├── popup.css           # Responsive styling with color-coded elements
    │   └── popup.js            # Core popup logic and session management
    ├── utils/
    │   ├── har.js              # HAR (HTTP Archive) format utilities
    │   └── inject.js           # Page context script for UUX data extraction
    ├── background.js           # Service worker for network monitoring
    ├── content.js              # Content script for page integration
    ├── manifest.json           # Extension manifest (Manifest V3)
    └── README.md               # Comprehensive documentation

---

## File Descriptions

### Core Extension Files

- **`manifest.json`**: Extension configuration with Manifest V3 compliance, permissions, and resource definitions
- **`background.js`**: Service worker handling network request interception, data storage, and cross-component communication
- **`content.js`**: Content script providing page integration, script injection, and floating UI elements

### User Interface Components

- **`popup/popup.html`**: Main extension interface with collapsible sections, session dashboard, and control panel
- **`popup/popup.css`**: Professional responsive styling with:
  - Color-coded Alexandria log buttons (HQ=Blue, LightBridge=Green, Kamino=Gray, Ardent=Red)
  - Anti-flicker optimizations and layout containment
  - Enhanced text wrapping and overflow management
  - Flexbox responsive design optimized for 400px popup width
- **`popup/popup.js`**: Core application logic featuring:
  - Intelligent session aggregation and management
  - Real-time Alexandria log URL generation with environment detection
  - HAR export functionality with timestamp-based file naming
  - Environment metadata display and session persistence

### Utility Modules

- **`utils/inject.js`**: Page context script for extracting UUX environment data:
  - Ngam application version detection
  - Q2_CONFIG and Tecton platform information
  - Cookie-based theme and language detection
  - CDN configuration extraction with fallback handling
- **`utils/har.js`**: HAR (HTTP Archive) format utilities for:
  - Standard HAR 1.2 compliant export generation
  - Request/response data formatting and validation
  - Timing information preservation and entry structuring

### Visual Assets

- **`icons/icon.png`**: Multi-resolution extension icon supporting 16px, 48px, and 128px formats for various Chrome UI contexts

---

## Installation & Setup

### Prerequisites

- Google Chrome or Chromium-based browser
- Developer mode enabled for extension installation

### Installation Steps

1. **Download the Extension**
   - Clone the repository: `git clone <repository-url>`
   - Or download the ZIP file and extract it

2. **Enable Developer Mode**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle **"Developer mode"** in the top-right corner

3. **Load the Extension**
   - Click **"Load unpacked"**
   - Select the root folder of the Q2 Easy Log project
   - The extension icon should appear in your Chrome toolbar

4. **Verify Installation**
   - Click the extension icon to open the popup
   - The interface should display with collapsible sections and controls
   - Navigate to a Q2 UUX application to begin capturing network data

### Configuration

- **UTC Offset**: Set your timezone offset for accurate timestamp correlation
- **Site Management**: Add specific Q2 domains you want to monitor
- **Environment Detection**: The extension automatically detects staging vs production environments

---

## How It Works

The extension operates through a coordinated system of components:

### 1. **Background Service Worker**
- `background.js` uses Chrome’s `webRequest` API to capture:
  - Request/response headers
  - Timestamps
  - Status codes
- Stores request data and provides it to the popup or content scripts.

### 2. **Popup Interface**

- `popup.html`, `popup.js`, and `popup.css` power the extension UI.
- Shows a list of captured network requests and environment metadata.
- Generates Alexandria log search URLs for HQ, LightBridge, Kamino, and Ardent platforms.
- Features enhanced UI with color-coded interactive log buttons for easy platform identification.
- Improved text wrapping and collapsible environment info section for better usability.
- Responsive flexbox layout that adapts to different popup sizes.
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

    https://alexandria.shs.aws.q2e.io/logs/<SEARCH_STRING>

### LightBridge Logs

    https://alexandria.shs.aws.q2e.io/logs/<LIGHTBRIDGE_SEARCH_STRING>

### Kamino Logs

    https://alexandria.shs.aws.q2e.io/logs/<KAMINO_SEARCH_STRING>

### Ardent Logs

    https://alexandria.shs.aws.q2e.io/logs/<ARDENT_SEARCH_STRING>

Search strings are automatically generated with the following format:

**HQ & Kamino (Session-based):**

    search index="app_logs_{prod/stage}_{hq/kamino}" sessionId="..." earliest="..." latest="..." | fields * | extract | sort timestamp, seqId | head 10000

**LightBridge & Ardent (Workstation-based):**

    search index="app_logs_{prod/stage}_{lightbridge/ardent}" workstationId="..." earliest="..." latest="..." | fields * | extract | sort timestamp, seqId | head 10000

**Note:** Ardent logs use a 15-minute time window (`earliest="-15m"`) instead of the 30-minute window used by other platforms.

This enables comprehensive log lookup across all Q2 platforms for debugging user sessions.

---

## Development Notes

- `utils/har.js` includes functions to format request/response data into HAR format (can be extended for HAR export).
- `popup.js` has helper functions to extract, format, and render network request metadata with support for multiple log platforms.
- Content and popup scripts use `chrome.runtime.sendMessage()` for cross-context communication.
- The UI includes a collapsible panel for viewing environment info in detail with enhanced styling.
- Enhanced CSS styling provides better text wrapping and improved readability for long URLs and text content.
- Color-coded log buttons provide intuitive access to different Alexandria platforms:
  - HQ Logs: Blue (#007BFF)
  - LightBridge Logs: Green (#28A745)
  - Kamino Logs: Gray (#6C757D)
  - Ardent Logs: Red (#DC3545)
- Responsive button layout adapts to different popup sizes with flexbox design.

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
