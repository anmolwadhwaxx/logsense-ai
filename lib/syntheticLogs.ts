export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface SyntheticLog {
  timestamp: string;
  service: string;
  level: LogLevel;
  message: string;
}

export interface ServiceBreakdown {
  name: string;
  total: number;
  warnings: number;
  errors: number;
}

export interface AnalysisPayload {
  rangeMinutes: number;
  generatedAt: string;
  totalLogs: number;
  levelBreakdown: Record<LogLevel, number>;
  services: ServiceBreakdown[];
  summary: string;
  decision: 'Escalate' | 'Monitor';
  recommendation: string;
  highlights: string[];
  sampleLogs: SyntheticLog[];
}

const SERVICES = [
  'payments-core',
  'auth-gateway',
  'reporting-engine',
  'alert-orchestrator',
  'data-collector'
];

const MESSAGE_TEMPLATES: Record<LogLevel, string[]> = {
  INFO: [
    'Heartbeat received successfully',
    'Latency steady within target band',
    'Background sync finished with {count} records',
    'Cache warm event processed',
    'Synthetic log ingestion acknowledged'
  ],
  WARN: [
    'Retrying request because upstream latency exceeded {ms} ms',
    'Partial degradation detected on {service}',
    'Circuit breaker nearing threshold',
    'Synthetic payload missing optional metadata'
  ],
  ERROR: [
    'Workflow timeout exceeded for {service}',
    'Failed to deliver webhook batch',
    'Unhandled exception bubbled to orchestrator',
    'Synthetic incident triggered for {service}'
  ]
};

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  INFO: 0.6,
  WARN: 0.25,
  ERROR: 0.15
};

const ERROR_THRESHOLD_BY_MINUTE = (minutes: number) => Math.max(4, Math.round(minutes * 0.6));

const randomOf = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

const pickLevel = (): LogLevel => {
  const r = Math.random();
  let cumulative = 0;
  for (const level of Object.keys(LEVEL_WEIGHTS) as LogLevel[]) {
    cumulative += LEVEL_WEIGHTS[level];
    if (r <= cumulative) {
      return level;
    }
  }
  return 'ERROR';
};

const hydrateTemplate = (template: string, service: string) => {
  return template
    .replace('{service}', service)
    .replace('{count}', String(50 + Math.floor(Math.random() * 50)))
    .replace('{ms}', String(200 + Math.floor(Math.random() * 400)));
};

export const generateSyntheticLogs = (rangeMinutes: number): SyntheticLog[] => {
  const now = Date.now();
  const eventsPerMinute = 12;
  const total = rangeMinutes * eventsPerMinute;
  return Array.from({ length: total }, () => {
    const service = randomOf(SERVICES);
    const level = pickLevel();
    const skew = Math.random() * rangeMinutes * 60 * 1000;
    return {
      timestamp: new Date(now - skew).toISOString(),
      service,
      level,
      message: hydrateTemplate(randomOf(MESSAGE_TEMPLATES[level]), service)
    };
  }).sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
};

export const analyzeSyntheticLogs = (rangeMinutes: number): AnalysisPayload => {
  const logs = generateSyntheticLogs(rangeMinutes);
  const levelBreakdown: Record<LogLevel, number> = {
    INFO: 0,
    WARN: 0,
    ERROR: 0
  };
  const serviceMap: Record<string, ServiceBreakdown> = {};

  logs.forEach((log) => {
    levelBreakdown[log.level] += 1;
    if (!serviceMap[log.service]) {
      serviceMap[log.service] = {
        name: log.service,
        total: 0,
        warnings: 0,
        errors: 0
      };
    }
    serviceMap[log.service].total += 1;
    if (log.level === 'WARN') serviceMap[log.service].warnings += 1;
    if (log.level === 'ERROR') serviceMap[log.service].errors += 1;
  });

  const services = Object.values(serviceMap).sort((a, b) => b.total - a.total);
  const errorThreshold = ERROR_THRESHOLD_BY_MINUTE(rangeMinutes);
  const decision = levelBreakdown.ERROR > errorThreshold ? 'Escalate' : 'Monitor';

  const highlights = buildHighlights(levelBreakdown, services, decision, rangeMinutes);
  const summary = buildSummary(levelBreakdown, services, decision, rangeMinutes);

  return {
    rangeMinutes,
    generatedAt: new Date().toISOString(),
    totalLogs: logs.length,
    levelBreakdown,
    services,
    summary,
    decision,
    recommendation:
      decision === 'Escalate'
        ? 'Route to the incident channel and spin up on-call automation.'
        : 'Continue synthetic monitoring and auto-close if metrics stay flat for 20 minutes.',
    highlights,
    sampleLogs: logs.slice(-5)
  };
};

const buildSummary = (
  levelBreakdown: Record<LogLevel, number>,
  services: ServiceBreakdown[],
  decision: 'Escalate' | 'Monitor',
  minutes: number
): string => {
  const leadService = services[0];
  const affectedServices = services.filter((service) => service.errors > 0).length;
  const totalEvents = levelBreakdown.INFO + levelBreakdown.WARN + levelBreakdown.ERROR;
  const severityPhrase = decision === 'Escalate' ? 'high severity spike' : 'contained activity';
  return [
    `${levelBreakdown.ERROR} errors and ${levelBreakdown.WARN} warnings observed in the last ${minutes} minutes.`,
    leadService
      ? `${leadService.name} is driving ${Math.round((leadService.total / Math.max(1, totalEvents)) * 100)}% of total traffic.`
      : 'No services reported activity.',
    affectedServices > 0
      ? `${affectedServices} services affected with ${severityPhrase}.`
      : 'No services show degradation; continue synthetic watching.'
  ].join(' ');
};

const buildHighlights = (
  levelBreakdown: Record<LogLevel, number>,
  services: ServiceBreakdown[],
  decision: 'Escalate' | 'Monitor',
  minutes: number
): string[] => {
  const busiest = services[0];
  const noisy = services.find((service) => service.warnings > service.errors && service.warnings > 0);
  const highError = services.find((service) => service.errors >= 3);
  const highlights = [
    `${levelBreakdown.INFO} informational events kept baseline context fresh.`,
    `Decision: ${decision} (threshold ${ERROR_THRESHOLD_BY_MINUTE(minutes)} errors).`
  ];
  if (busiest) {
    highlights.push(`${busiest.name} handled ${busiest.total} calls and is the primary candidate for deeper tracing.`);
  }
  if (noisy) {
    highlights.push(`${noisy.name} raised ${noisy.warnings} warnings suggesting config follow-up.`);
  }
  if (highError) {
    highlights.push(`${highError.name} crossed the red line with ${highError.errors} synthetic errors.`);
  }
  return highlights;
};
