'use client';

import { useState } from 'react';

interface ServiceBreakdown {
  name: string;
  total: number;
  warnings: number;
  errors: number;
}

interface AnalysisResponse {
  rangeMinutes: number;
  generatedAt: string;
  totalLogs: number;
  levelBreakdown: Record<'INFO' | 'WARN' | 'ERROR', number>;
  services: ServiceBreakdown[];
  summary: string;
  decision: 'Escalate' | 'Monitor';
  recommendation: string;
  highlights: string[];
  sampleLogs: { timestamp: string; service: string; level: string; message: string }[];
}

const RANGE_OPTIONS = [5, 10, 30];

export default function HomePage() {
  const [selectedRange, setSelectedRange] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const triggerAnalysis = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: selectedRange })
      });
      if (!response.ok) {
        throw new Error('Unable to run synthetic analysis.');
      }
      const payload = (await response.json()) as AnalysisResponse;
      setAnalysis(payload);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main style={{ padding: '4rem 1.5rem' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', color: '#f4f4f5' }}>
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ textTransform: 'uppercase', letterSpacing: '0.4rem', color: '#7d7da1', fontSize: '0.8rem' }}>
            LogSense AI
          </p>
          <h1 style={{ fontSize: '3.25rem', margin: '0.35rem 0' }}>Synthetic incident intelligence</h1>
          <p style={{ color: '#b3b3c0', maxWidth: 640 }}>
            Aggregates sandbox logs, drafts AI summaries, and recommends the next workflow action using a fully mocked
            Kestra pipeline built for open hackathons.
          </p>
        </div>

        <section className="card" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label htmlFor="range" style={{ display: 'block', color: '#b3b3c0', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
              Time range
            </label>
            <select
              id="range"
              value={selectedRange}
              onChange={(event) => setSelectedRange(Number(event.target.value))}
              style={{
                width: '100%',
                padding: '0.95rem 1rem',
                borderRadius: '0.8rem',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)',
                color: '#fff'
              }}
            >
              {RANGE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
            <small style={{ display: 'block', marginTop: '0.6rem', color: '#8686a5' }}>
              Button triggers synthetic workflow using the selected window.
            </small>
          </div>

          <button
            type="button"
            onClick={triggerAnalysis}
            disabled={isLoading}
            style={{
              background: '#6366f1',
              border: 'none',
              color: '#fff',
              padding: '1rem 1.5rem',
              borderRadius: '999px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: isLoading ? 0.6 : 1,
              minWidth: 220
            }}
          >
            {isLoading ? 'Analyzing…' : 'Analyze last 10 minutes'}
          </button>
        </section>

        {errorMessage && (
          <p style={{ color: '#ff6b6b', marginTop: '1.5rem' }} role="alert">
            {errorMessage}
          </p>
        )}

        {analysis ? (
          <section style={{ marginTop: '2rem' }} className="grid grid-two">
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="metric">
                  <span className="metric-label">Aggregated log count</span>
                  <span className="metric-value">{analysis.totalLogs}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Error events</span>
                  <span className="metric-value">{analysis.levelBreakdown.ERROR}</span>
                </div>
                <div className="metric">
                  <span className="metric-label">Warnings</span>
                  <span className="metric-value">{analysis.levelBreakdown.WARN}</span>
                </div>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '1.75rem 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '1.1rem', margin: 0, color: '#b3b3c0' }}>Agent decision</p>
                  <p style={{ fontSize: '1.8rem', margin: 0 }}>{analysis.decision}</p>
                </div>
                <span className={`badge ${analysis.decision === 'Escalate' ? 'escalate' : 'monitor'}`}>
                  {analysis.decision === 'Escalate' ? 'Escalate' : 'Monitor'}
                </span>
              </div>
              <p style={{ color: '#b3b3c0', marginTop: '1rem' }}>{analysis.recommendation}</p>
            </div>

            <div className="card">
              <h2 style={{ margin: '0 0 0.5rem 0' }}>AI-generated summary</h2>
              <p style={{ color: '#b3b3c0' }}>{analysis.summary}</p>
              <ul style={{ marginTop: '1rem', paddingLeft: '1.2rem', color: '#ccc' }}>
                {analysis.highlights.map((highlight, index) => (
                  <li key={highlight + index}>{highlight}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h2 style={{ margin: 0 }}>Service snapshot</h2>
              <p style={{ color: '#b3b3c0', marginBottom: '1rem' }}>Top synthetic services ordered by activity.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {analysis.services.map((service) => (
                  <div key={service.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div>
                      <strong>{service.name}</strong>
                      <p style={{ margin: 0, color: '#8c8ca6', fontSize: '0.85rem' }}>
                        {service.total} logs · {service.warnings} warnings · {service.errors} errors
                      </p>
                    </div>
                    <span style={{ color: '#b3b3c0' }}>{Math.round(service.errors * 1.5 + service.warnings)} pts</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2 style={{ margin: 0 }}>Latest synthetic logs</h2>
              <p style={{ color: '#b3b3c0', marginBottom: '1rem' }}>Last five events shared for transparency.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {analysis.sampleLogs.map((log) => (
                  <div key={`${log.timestamp}-${log.service}-${log.level}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8c8ca6', fontSize: '0.85rem' }}>
                      <span>{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span>{log.service}</span>
                      <span>{log.level}</span>
                    </div>
                    <p style={{ margin: '0.4rem 0 0 0' }}>{log.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section style={{ marginTop: '2rem' }} className="card">
            <p style={{ color: '#b3b3c0', margin: 0 }}>Trigger an analysis to populate AI summaries and routing recommendations.</p>
          </section>
        )}

        <footer style={{ marginTop: '3rem', color: '#6d6d84', fontSize: '0.85rem' }}>
          This project was built entirely during a hackathon using synthetic datasets and public tools. It is inspired by
          real-world engineering challenges but contains no proprietary systems, code, or data.
        </footer>
      </div>
    </main>
  );
}
