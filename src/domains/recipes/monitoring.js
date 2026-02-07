// Monitoring Recipes
// ══════════════════════════════════════════════════════════════════════════════

export const monitoringRecipes = [
  // ─── Prometheus + Node.js ─────────────────────────────────────────────────
  {
    id: 'prometheus-node',
    name: 'Prometheus — Node.js Metrics',
    description: 'Expose /metrics endpoint with prom-client',
    tags: ['monitoring', 'node', 'api'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'shell',
        action: 'Install prom-client',
        detail: 'npm install prom-client',
      },
      {
        id: 2,
        type: 'code',
        action: 'Create metrics middleware',
        template: `import client from 'prom-client';

// Collect default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ prefix: 'app_' });

// Custom metrics
export const httpRequestDuration = new client.Histogram({
  name: 'app_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const httpRequestTotal = new client.Counter({
  name: 'app_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

// Middleware
export function metricsMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path || req.path;
    end({ method: req.method, route, status: res.statusCode });
    httpRequestTotal.inc({ method: req.method, route, status: res.statusCode });
  });
  next();
}

// Endpoint
export async function metricsHandler(req, res) {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}`,
      },
    ],
  },

  // ─── Health Check Endpoint ────────────────────────────────────────────────
  {
    id: 'healthcheck',
    name: 'Health Check — Structured',
    description: 'Health check with DB, memory, and uptime',
    tags: ['monitoring', 'api', 'node'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'code',
        action: 'Create health check handler',
        template: `export function healthHandler(db = null) {
  return async (req, res) => {
    const health = {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1048576),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1048576),
      },
      checks: {},
    };

    // DB check
    if (db) {
      try {
        await db.query('SELECT 1');
        health.checks.database = { status: 'ok' };
      } catch (e) {
        health.checks.database = { status: 'error', message: e.message };
        health.status = 'degraded';
      }
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
  };
}`,
      },
    ],
  },

  // ─── Structured Logging ───────────────────────────────────────────────────
  {
    id: 'structured-logging',
    name: 'Structured Logging — JSON',
    description: 'JSON logging with request ID tracking',
    tags: ['logging', 'monitoring', 'node'],
    complexity: 'SIMPLE',
    steps: [
      {
        id: 1,
        type: 'code',
        action: 'Create structured logger',
        template: `const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
    pid: process.pid,
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + '\\n');
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};`,
      },
      {
        id: 2,
        type: 'code',
        action: 'Create request ID middleware',
        template: `import { randomUUID } from 'crypto';

export function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}`,
      },
    ],
  },

  // ─── Grafana + Prometheus Stack ───────────────────────────────────────────
  {
    id: 'grafana-stack',
    name: 'Grafana + Prometheus — Docker Compose',
    description: 'Full monitoring stack with Grafana dashboards',
    tags: ['monitoring', 'docker', 'logging'],
    complexity: 'MEDIUM',
    steps: [
      {
        id: 1,
        type: 'file',
        action: 'Add monitoring services to docker-compose',
        template: `  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - grafana-data:/var/lib/grafana`,
      },
      {
        id: 2,
        type: 'file',
        action: 'Create monitoring/prometheus.yml',
        template: `global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'app'
    static_configs:
      - targets: ['app:3000']
    metrics_path: /metrics`,
      },
    ],
  },
];
