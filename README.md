# Q2 LogEasy

LogEasy is a Chrome extension that helps Q2 engineers diagnose Universal User Experience (UUX) issues in real time. It captures session traffic, assembles Alexandria-ready log queries, and presents the data through a modular interface aimed at fast triage and cross-team collaboration.

---

## Table of Contents

1. [Highlights](#highlights)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Daily Workflow](#daily-workflow)
6. [Feature Details](#feature-details)
7. [Alexandria Integration](#alexandria-integration)
8. [Importing and Exporting Data](#importing-and-exporting-data)
9. [Configuration Storage](#configuration-storage)
10. [Diagnostics and Troubleshooting](#diagnostics-and-troubleshooting)
11. [Development Guide](#development-guide)
12. [Testing Checklist](#testing-checklist)
13. [Release Process](#release-process)
14. [Authors](#authors)
15. [Contributing](#contributing)

---

## Highlights

- Modular popup built around ES modules and shared state.
- Automatic correlation between q2token sessions, workstation IDs and Alexandria search windows.
- Visualization tab that surfaces request counts, latency averages, error rates and top endpoints.
- Settings panel with site management, side selection, UTC overrides, HAR/CSV export, and HAR import.
- Full-session exports with timestamps and metadata suitable for further tooling.
- Alexandria AI workflow that gathers logs across HQ, LightBridge, Kamino and Ardent with prompt-aware summaries.

---

## Architecture at a Glance

| Layer | File(s) | Responsibilities |
|-------|---------|------------------|
| Service Worker | `background.js` | Captures network traffic, deduplicates sessions, persists state to storage, receives injection events. |
| Popup Shell | `popup/main.js`, `popup/state.js` | Initializes tabs, orchestrates polling, manages global popup state, routes user actions. |
| Tabs & UI Modules | `popup/logsTab.js`, `popup/userDetailsTab.js`, `popup/visualizationTab.js`, `popup/alexandria/*` | Render data for each tab and provide user interactions. |
| Utilities | `popup/utils.js`, `popup/runtimeClient.js`, `popup/sessionProcessor.js` | Formatting, hashing, runtime messaging, summary creation. |
| Content & Injection | `content.js`, `utils/inject.js` | Injects page-context helper, collects UUX metadata, forwards captured LogonUser responses. |

---

## Prerequisites

- Chrome 114 or newer (Manifest V3 support).
- Developer mode enabled for loading unpacked extensions.
- Access to Alexandria endpoints (authentication token required for AI summaries).

---

## Installation

1. Clone or download the repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked** and choose the project root (`easy-logs/` directory after this refactor).
5. Confirm that the action icon appears in the toolbar; pin it if necessary.

---

## Daily Workflow

1. Navigate to a UUX environment and open the LogEasy popup.
2. Browse the **Network Logs** tab to verify active sessions, logonUser responses, and Alexandria links.
3. Use the **Visualization** tab for latency and error outliers.
4. Switch to **AI Insights** to authenticate with Alexandria and request AI summaries or environment-specific searches.
5. Manage domains, sides, and exports within **Settings**. Use UTC override when collaborating across time zones.

---

## Feature Details

### Network Logs
- Session summary with total requests, session ID, workstation ID, UTC-aware timeframe.
- Alexandria shortcut buttons per platform with environment detection.
- Request list highlighting `logonUser` responses and providing JSON download/pretty view.
- Collapsible sections and search-friendly markup to keep the UI responsive.

### User Details
- Parses the latest `logonUser` response and surfaces profile, session, capability, and environment data.
- Normalizes field names (session token, timeouts, CSR flags) and fills common gaps where possible.
- Provides tabbed capability grids with click-to-toggle behaviour for features, transaction rights, and system flags.
- Re-renders on demand from the Settings or Logs tabs when new data is captured.

### Visualization
- Metrics panel for total requests, average response time, error rate, and transfer volume.
- Timeline canvas grouped by minute to spot spikes.
- Pie chart illustrating request type distribution.
- Endpoint analysis that normalizes IDs and surfaces top-ten paths.

### AI Insights
- Auth form caching tokens locally with eight-hour TTL.
- Buttons to summarize all environments or a single platform.
- Prompt previews, AI responses, failure handling, and `.log` downloads per environment.
- Comprehensive summary card with aggregate links, counts, and clipboard shortcuts.

### Settings
- Time configuration with validated UTC offset override; re-renders existing data on change.
- Site management that stores frequently visited domains and preferred sides in `chrome.storage.local`.
- Capture options controlling response body capture, deduplication, and timing visibility (future toggles).
- Export tools for HAR and CSV, plus HAR import that feeds captured data back through the session store.

---

## Alexandria Integration

When a session is active, LogEasy derives:

- Session ID (`q2token`) and workstation ID.
- Environment classification (staging vs production).
- Time window with automatic buffer (`±5 minutes`, or `-15m` for Ardent).

Generated URLs follow these templates:

```
search index="app_logs_{prod|stage}_{hq|lightbridge|kamino|ardent}"
  {sessionId|workstationId}="..."
  earliest="..."
  latest="..."
| fields *
| extract
| sort timestamp, seqId
| head 10000
```

The AI workflow builds upon this data: it fetches log entries, flattens each record, assembles prompts, and allows exporting flattened `.log` files that contain every field of the Alexandria response.

---

## Importing and Exporting Data

| Action | Location | Notes |
|--------|----------|-------|
| Export HAR | Settings tab | Uses background session data; filenames include timestamp and scope. |
| Export CSV | Settings tab | Provides a lean summary for spreadsheet review. |
| Import HAR | Settings tab | Converts entries into LogEasy request objects and injects them into the session store. |
| Download `logonUser` JSON | Network Logs tab | Metadata wrapper includes capture timestamp, URL, and source. |
| Download Alexandria Logs | AI Insights tab | Full-field flattened output per environment or batch download. |

---

## Configuration Storage

- **`logeasy_sessions`**: persisted sessions and their requests.
- **`logeasy_env_info`**: cached UUX metadata for quick reloads.
- **`logeasy_site_preferences`** (stored via Settings UI): site list, selected side, and user overrides.
- Alexandria token cached with expiry metadata for AI workflows.

Data is stored in `chrome.storage.local` and can be cleared from the Settings tab or Chrome's site data tools.

---

## Diagnostics and Troubleshooting

- **No requests captured**: ensure the target tab is active, then refresh the popup. LogEasy throttles updates if the hash has not changed.
- **`logonUser` response missing**: verify the site is not blocking injection. Open DevTools console to check for `[inject.js]` logs.
- **Alexandria errors**: inspect the AI Insights tab; the UI surfaces response codes and text when the API fails.
- **HAR import fails**: check the console for parsing issues. Only HAR 1.2 compliant files are supported.
- **Time offsets incorrect**: adjust the UTC offset in Settings; LogEasy will re-render all views with the new offset while preserving data.

For deeper debugging, run Chrome with the Extensions page open and inspect the **background page** or **popup** contexts via DevTools.

---

## Development Guide

1. **Install dependencies**: no build step is required, but Node tooling can be added if you plan to lint or test.
2. **Recommended tooling**: VS Code with ESLint and Prettier, Chrome DevTools for background/popup debugging.
3. **Module layout**: each tab has its own module; shared state lives in `popup/state.js`. When adding functionality, prefer creating a focused module rather than expanding `main.js`.
4. **Messaging**: runtime messaging (`chrome.runtime.sendMessage`) is centralized in `popup/runtimeClient.js` to keep the popup modules declarative.
5. **Formatting helpers**: `popup/utils.js` includes sanitization helpers (`escapeHtml`, `formatDateTimeWithOffset`, etc.). Extend these rather than re-implementing formatting logic.
6. **Alexandria helpers**: `popup/alexandria/helpers.js` should be the single source of truth for prompt manipulation and log selection heuristics.
7. **Background capture**: any new request metadata should be added through `background.js` so it automatically reaches both popup and exports.

---

## Testing Checklist

- Load the extension in developer mode and capture a real session (on staging and production).
- Confirm the Network Logs tab updates every two seconds when requests are flowing.
- Validate that `logonUser` responses render, can be toggled, and export JSON correctly.
- Run AI Insights: authenticate, summarize all environments, download logs, copy summaries.
- Exercise the Settings tab: change UTC offset, add/remove sites, export/import HAR, export CSV.
- Import a saved HAR file and verify it appears in the popup and visualizations.
- Review the background console for warnings or uncaught errors while performing the above steps.

---

## Release Process

1. Update `manifest.json` version and changelog in `README.md` or release notes.
2. Run through the testing checklist.
3. Commit changes and create a tagged release in Git.
4. Build a zipped package (from the project root) and upload to the Chrome Web Store or internal distribution channel.
5. Notify implementation teams with highlights and any required post-install actions (e.g., new permissions).

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
