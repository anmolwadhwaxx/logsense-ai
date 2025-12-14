# LogSense AI API Contract

This document keeps the interface between the Next.js frontend, the `/api/analyze` route, and the Kestra workflow consistent.

## Request

```
POST /api/analyze
Content-Type: application/json
{
  "minutes": 5 | 10 | 30
}
```

If an unsupported window is provided, the backend coerces the value to 10 minutes to preserve a predictable workflow execution.

## Response

```
{
  "rangeMinutes": number,
  "generatedAt": string (ISO timestamp),
  "totalLogs": number,
  "levelBreakdown": { "INFO": number, "WARN": number, "ERROR": number },
  "services": [
    { "name": string, "total": number, "warnings": number, "errors": number }
  ],
  "summary": string,
  "decision": "Escalate" | "Monitor",
  "recommendation": string,
  "highlights": string[],
  "sampleLogs": [
    { "timestamp": string, "service": string, "level": string, "message": string }
  ]
}
```

Kestra mirrors this schema in `kestra/logsense-ai.yaml` so the same payload can be returned directly from the workflow runner or from this local mock API.
