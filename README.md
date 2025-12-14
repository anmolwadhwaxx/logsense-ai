# LogSense AI

Public, hackathon-safe incident intelligence powered by synthetic logs, Next.js, and Kestra autonomous agents.

> This project was built entirely during a hackathon using synthetic datasets and public tools. It is inspired by real-world engineering challenges but contains no proprietary systems, code, or data.

## Problem Statement

Operators need AI assistance to summarize noisy telemetry, flag risky clusters, and recommend the next action without touching sensitive production environments. LogSense AI rebuilds that experience with fully mocked data so teams can prototype, demo, and submit to global hackathons without compliance blockers.

## Architecture

| Layer | Tech | Notes |
| --- | --- | --- |
| Frontend | Next.js (App Router) | Minimal UI with a dropdown, "Analyze last 10 minutes" CTA, and live metrics. Optimized for Vercel preview deployments. |
| API Route | `/api/analyze` | Calls the synthetic generator in `lib/syntheticLogs.ts`, derives summaries, and mirrors the Kestra contract. |
| Synthetic Generator | `lib/syntheticLogs.ts` | Creates timestamped JSON logs with service, level, and message fields. No external data sources. |
| Workflow Orchestration | `kestra/logsense-ai.yaml` | Demonstrates how Kestra ingests synthetic logs, invokes its AI Agent, applies routing rules, and emits the frontend payload. |
| Collaboration | `workflows/api-contract.md` | Maintains the schema shared by both the Next.js API and the Kestra workflow. |

```
.
├── app
│   ├── api/analyze/route.ts       # Mocked API that mirrors the Kestra workflow output
│   ├── layout.tsx                 # Root layout and metadata
│   ├── page.tsx                   # UI + interactions
│   └── globals.css                # Minimal styling
├── lib
│   └── syntheticLogs.ts           # Synthetic log generator + AI-style summarizer
├── workflows
│   └── api-contract.md            # Request / response contract
├── kestra
│   └── logsense-ai.yaml           # Kestra workflow for Wakanda Data Award submissions
└── README.md
```

## Getting Started

1. Install dependencies with `npm install`.
2. Run the playground locally via `npm run dev` and open `http://localhost:3000`.
3. Click **Analyze last 10 minutes** (or choose a range from the dropdown). The UI will call `/api/analyze`, which synthesizes logs, derives AI summaries, and renders the decision badge.

When deploying to Vercel (Stormbreaker Deployment Award), no environment variables are required because the dataset is generated in-memory.

## Synthetic Log Generator

The generator (`lib/syntheticLogs.ts`) produces deterministic JSON entries containing:

- `timestamp`: ISO string for the last N minutes
- `service`: One of five mocked microservices
- `level`: `INFO`, `WARN`, or `ERROR` with weighted probabilities
- `message`: Short narrative string with placeholders for counts and milliseconds

`analyzeSyntheticLogs(range)` aggregates those entries, computes per-service stats, determines whether to escalate (error count > `0.6 * minutes`), and writes the same structure the workflow uses. Highlights and recommendations mimic Kestra's AI Agent behavior without calling real models.

## Kestra Workflow

`kestra/logsense-ai.yaml` shows how to reproduce the exact payload inside Kestra:

1. **`generate_logs`**: Python task that emits the same JSON shape created locally.
2. **`summarize_with_agent`**: Uses Kestra's AI Agent plugin with safe instructions to summarize the logs.
3. **`decide_next_step`**: Scripts the deterministic rule (error threshold vs. range).
4. **`respond_to_frontend`**: Outputs JSON that the Next.js UI can consume directly.

Trigger the workflow with an input (`window = 5 | 10 | 30`) to keep parity with the frontend dropdown.

## API Contract

The `/api/analyze` route and Kestra workflow both follow `workflows/api-contract.md`. This keeps autonomous agents, local mocks, and Vercel deployments aligned.

The live demo is deployed on Vercel and uses a mocked API that mirrors
the Kestra workflow output to ensure deterministic, hackathon-safe behavior.


## Sponsor Alignment

1. **Kestra (Wakanda Data Award)** – Workflow YAML demonstrates AI Agent usage, deterministic decisions, and synthetic ingestion.
2. **Vercel (Stormbreaker Deployment Award)** – Frontend is a single Next.js app that deploys without secrets or persistent storage.
3. **CodeRabbit (Captain Code Award)** – Repository is lint-friendly TypeScript with explicit contracts, making automated PR reviews straightforward.
4. **Optional: Cline CLI (Infinity Build Award)** – The API contract and Kestra workflow make it trivial for agentic CLIs to plug into the same interface.

## Security & Compliance

- 100% synthetic, in-memory data; no credentials, SSO flows, or production logs.
- No storage layer; each analysis is ephemeral and discarded after responding.
- No references to real customers, companies, or proprietary APIs.

## Next Steps

- Wire the Kestra workflow output to a hosted endpoint when running inside a Kestra Cloud project.
- Add visualization components (mini charts) if you want extra polish for demo day.
- Integrate CodeRabbit CI to auto-review pull requests and capture the Captain Code Award.
