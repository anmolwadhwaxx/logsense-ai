# LogSense AI

**Public, hackathon-safe incident intelligence powered by synthetic logs, AI agents, and workflow orchestration.**

LogSense AI helps teams move from noisy telemetry to clear decisions using **synthetic data only**, making it ideal for global hackathons and demos without compliance or privacy risks.

> This project was built entirely during a hackathon using synthetic datasets and public tools.  
> It is inspired by real-world engineering challenges but contains **no proprietary systems, code, or data**.

---

## 🧠 Problem Statement

During incidents, operators face thousands of log lines across services with little context.
They need fast answers to three questions:

1. What happened?
2. Which services are affected?
3. Should we escalate or monitor?

LogSense AI rebuilds this experience using **fully mocked telemetry** and **AI agents**, allowing teams to prototype, demo, and submit incident-intelligence systems safely in public hackathons.

---

## 🏗️ Architecture Overview

| Layer | Technology | Description |
|-------|-----------|-------------|
| Frontend | Next.js (App Router) | Minimal UI with a time-range dropdown, **Analyze last 10 minutes** CTA, and result cards. Optimized for Vercel deployment. |
| API Layer | `/api/analyze` | Local API that synthesizes logs, derives insights, and mirrors Kestra workflow output. |
| Synthetic Data | `lib/syntheticLogs.ts` | Deterministic generator producing timestamped JSON logs with service, level, and message fields. |
| Workflow Orchestration | Kestra | Workflow demonstrates ingestion, AI summarization, decision rules, and structured output. |
| Contract | `workflows/api-contract.md` | Shared schema between the Next.js API and the Kestra workflow. |

---

## 📁 Repository Structure
```
.
├── app
│   ├── api/analyze/route.ts     # Mocked API mirroring Kestra workflow output
│   ├── layout.tsx                # Root layout and metadata
│   ├── page.tsx                  # UI and interactions
│   └── globals.css               # Minimal styling
├── lib
│   └── syntheticLogs.ts          # Synthetic log generator and analyzer
├── workflows
│   └── api-contract.md           # Request / response contract
├── kestra
│   └── logsense-ai.yaml          # Kestra workflow for Wakanda Data Award
└── README.md
```

---

## 🚀 Getting Started
```bash
npm install
npm run dev
```

Open `http://localhost:3000` and:

1. Select a time window (5, 10, or 30 minutes)
2. Click **Analyze last 10 minutes**
3. View:
   - Total log count
   - AI-generated summary
   - Agent decision (Escalate or Monitor)

For Vercel deployment (Stormbreaker Deployment Award), no environment variables are required.

---

## 🧪 Synthetic Log Generator

The synthetic generator (`lib/syntheticLogs.ts`) creates JSON logs containing:

- **timestamp** – ISO timestamp within the selected window
- **service** – One of five mocked microservices
- **level** – INFO, WARN, or ERROR (weighted)
- **message** – Short narrative string

`analyzeSyntheticLogs(window)`:

- Aggregates per-service statistics
- Counts error events
- Applies a deterministic escalation rule  
  `(errorCount > 0.6 × minutes)`
- Produces the same structured payload used by the workflow

This mirrors AI-agent behavior without calling real models or systems.

---

## 🤖 Kestra Workflow (Wakanda Data Award)

The workflow in `kestra/logsense-ai.yaml` demonstrates:

1. **generate_logs**  
   Python task that emits synthetic logs in JSON format

2. **summarize_with_agent**  
   Kestra AI Agent summarizes events, affected services, and severity

3. **decide_next_step**  
   Rule-based logic determines Escalate vs Monitor

4. **respond_to_frontend**  
   Returns structured JSON consumed directly by the UI

The workflow accepts `window = 5 | 10 | 30`, keeping parity with the frontend dropdown.

---

## 🔗 API Contract

Both the `/api/analyze` route and the Kestra workflow follow the same contract defined in:

**`workflows/api-contract.md`**

This keeps local mocks, autonomous agents, and deployed demos fully aligned.

---

## 🏆 Sponsor Alignment (WeMakeDevs)

The live demo is deployed on Vercel and uses a mocked API that mirrors
the Kestra workflow output to ensure deterministic, hackathon-safe behavior.


## Sponsor Alignment
**Kestra – Wakanda Data Award**  
Demonstrates AI Agent summarization, decision-making, and workflow orchestration on synthetic data.

**Vercel – Stormbreaker Deployment Award**  
Single Next.js application, zero secrets, production-ready UX.

**CodeRabbit – Captain Code Award**  
Clean TypeScript, explicit contracts, and PR-friendly structure for automated code reviews.

---

## 🔐 Security & Compliance

- ✅ 100% synthetic, in-memory data
- ✅ No credentials, SSO, or production logs
- ✅ No persistence or storage layer
- ✅ No references to real companies or customers
