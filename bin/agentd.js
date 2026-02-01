#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C.3 Agent Daemon (agentd)
// ══════════════════════════════════════════════════════════════════════════════
//
// Headless agent kernel exposing REST + SSE endpoints.
// Separates agent execution from UI concerns.
//
// Endpoints:
//   POST /ask           - Execute Golden Path (sync)
//   POST /ask_stream    - Execute Golden Path (SSE stream)
//   GET  /plans/:id     - Get plan status
//   GET  /plans/:id/events - SSE stream for plan events
//   GET  /health        - Health check
//   GET  /metrics       - Basic metrics
//
// Usage:
//   node bin/agentd.js [--port 3336]
//
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { runGoldenPath } from '../src/golden/goldenPipeline.js';
import { validate } from '../src/contracts/validate.js';
import { logger } from '../src/core/logger.js';
import { auditTrail } from '../src/audit/trail.js';

// ════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_PORT = 3336;
const port = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || DEFAULT_PORT);

// ════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STORES (Phase B - later move to DB)
// ════════════════════════════════════════════════════════════════════════════

const plans = new Map();           // plan_id → { plan, execution, status, events }
const sseConnections = new Map();  // plan_id → Set<response>
const metrics = {
  requests: 0,
  plans_created: 0,
  plans_completed: 0,
  plans_failed: 0,
  start_time: Date.now(),
};

// ════════════════════════════════════════════════════════════════════════════
// SSE HELPERS
// ════════════════════════════════════════════════════════════════════════════

function setupSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders();
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastEvent(planId, event, data) {
  const connections = sseConnections.get(planId);
  if (connections) {
    for (const res of connections) {
      try {
        sendSSE(res, event, data);
      } catch {
        connections.delete(res);
      }
    }
  }

  // Store event for late subscribers
  const plan = plans.get(planId);
  if (plan) {
    plan.events.push({ event, data, timestamp: Date.now() });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async function handleAsk(req, res) {
  metrics.requests++;

  const body = await readBody(req);
  const { input, options = {} } = JSON.parse(body);

  if (!input || typeof input !== 'string') {
    return sendJSON(res, 400, { error: 'Missing or invalid input' });
  }

  const planId = randomUUID();
  metrics.plans_created++;

  // Initialize plan storage
  plans.set(planId, {
    id: planId,
    input,
    status: 'running',
    plan: null,
    execution: null,
    events: [],
    created_at: Date.now(),
  });

  // Audit: plan started
  auditTrail.log({
    plan_id: planId,
    actor: 'agentd',
    action: 'PLAN_STARTED',
    payload: { input: input.substring(0, 100) },
  });

  broadcastEvent(planId, 'plan_started', { plan_id: planId, input });

  try {
    const result = await runGoldenPath(input, {
      autoApprove: options.autoApprove ?? true,
      context: options.context || {},
    });

    const stored = plans.get(planId);
    stored.status = result.status === 'SUCCESS' ? 'completed' :
                    result.status === 'ERROR' ? 'failed' : result.status.toLowerCase();
    stored.plan = result.plan;
    stored.execution = result.execution;
    stored.completed_at = Date.now();

    if (stored.status === 'completed') {
      metrics.plans_completed++;
    } else if (stored.status === 'failed') {
      metrics.plans_failed++;
    }

    // Audit: plan completed
    auditTrail.log({
      plan_id: planId,
      actor: 'agentd',
      action: stored.status === 'completed' ? 'PLAN_COMPLETED' : 'PLAN_FAILED',
      payload: { status: stored.status, duration_ms: result.duration_ms },
    });

    broadcastEvent(planId, 'plan_completed', {
      plan_id: planId,
      status: stored.status,
      duration_ms: result.duration_ms,
    });

    sendJSON(res, 200, {
      plan_id: planId,
      status: stored.status,
      plan: result.plan,
      execution: result.execution,
      duration_ms: result.duration_ms,
    });

  } catch (err) {
    const stored = plans.get(planId);
    stored.status = 'failed';
    stored.error = err.message;
    stored.completed_at = Date.now();
    metrics.plans_failed++;

    auditTrail.log({
      plan_id: planId,
      actor: 'agentd',
      action: 'PLAN_ERROR',
      payload: { error: err.message },
    });

    broadcastEvent(planId, 'plan_error', { plan_id: planId, error: err.message });

    sendJSON(res, 500, { plan_id: planId, error: err.message });
  }
}

async function handleAskStream(req, res) {
  metrics.requests++;

  const body = await readBody(req);
  const { input, options = {} } = JSON.parse(body);

  if (!input || typeof input !== 'string') {
    return sendJSON(res, 400, { error: 'Missing or invalid input' });
  }

  const planId = randomUUID();
  metrics.plans_created++;

  // Initialize plan storage
  plans.set(planId, {
    id: planId,
    input,
    status: 'running',
    plan: null,
    execution: null,
    events: [],
    created_at: Date.now(),
  });

  // Setup SSE
  setupSSE(res);

  // Register connection
  if (!sseConnections.has(planId)) {
    sseConnections.set(planId, new Set());
  }
  sseConnections.get(planId).add(res);

  // Cleanup on close
  req.on('close', () => {
    sseConnections.get(planId)?.delete(res);
  });

  // Send initial event
  sendSSE(res, 'plan_started', { plan_id: planId, input });

  // Audit
  auditTrail.log({
    plan_id: planId,
    actor: 'agentd',
    action: 'PLAN_STARTED',
    payload: { input: input.substring(0, 100), streaming: true },
  });

  try {
    const result = await runGoldenPath(input, {
      autoApprove: options.autoApprove ?? true,
      context: options.context || {},
    });

    const stored = plans.get(planId);
    stored.status = result.status === 'SUCCESS' ? 'completed' :
                    result.status === 'ERROR' ? 'failed' : result.status.toLowerCase();
    stored.plan = result.plan;
    stored.execution = result.execution;
    stored.completed_at = Date.now();

    if (stored.status === 'completed') {
      metrics.plans_completed++;
    } else if (stored.status === 'failed') {
      metrics.plans_failed++;
    }

    // Send plan details
    if (result.plan) {
      sendSSE(res, 'plan_created', { plan_id: planId, plan: result.plan });
    }

    // Send execution results step by step
    if (result.execution?.step_results) {
      for (const stepResult of result.execution.step_results) {
        sendSSE(res, 'step_completed', { plan_id: planId, step: stepResult });
      }
    }

    // Send completion
    sendSSE(res, 'plan_completed', {
      plan_id: planId,
      status: stored.status,
      duration_ms: result.duration_ms,
    });

    auditTrail.log({
      plan_id: planId,
      actor: 'agentd',
      action: stored.status === 'completed' ? 'PLAN_COMPLETED' : 'PLAN_FAILED',
      payload: { status: stored.status, duration_ms: result.duration_ms },
    });

    res.end();

  } catch (err) {
    const stored = plans.get(planId);
    stored.status = 'failed';
    stored.error = err.message;
    stored.completed_at = Date.now();
    metrics.plans_failed++;

    sendSSE(res, 'plan_error', { plan_id: planId, error: err.message });

    auditTrail.log({
      plan_id: planId,
      actor: 'agentd',
      action: 'PLAN_ERROR',
      payload: { error: err.message },
    });

    res.end();
  }
}

function handleGetPlan(planId, res) {
  metrics.requests++;

  const plan = plans.get(planId);
  if (!plan) {
    return sendJSON(res, 404, { error: 'Plan not found' });
  }

  sendJSON(res, 200, {
    plan_id: plan.id,
    status: plan.status,
    input: plan.input,
    plan: plan.plan,
    execution: plan.execution,
    error: plan.error,
    created_at: plan.created_at,
    completed_at: plan.completed_at,
  });
}

function handlePlanEvents(planId, req, res) {
  metrics.requests++;

  const plan = plans.get(planId);
  if (!plan) {
    return sendJSON(res, 404, { error: 'Plan not found' });
  }

  // Setup SSE
  setupSSE(res);

  // Register connection
  if (!sseConnections.has(planId)) {
    sseConnections.set(planId, new Set());
  }
  sseConnections.get(planId).add(res);

  // Send historical events
  for (const ev of plan.events) {
    sendSSE(res, ev.event, ev.data);
  }

  // Send current status if completed
  if (plan.status !== 'running') {
    sendSSE(res, 'plan_status', {
      plan_id: planId,
      status: plan.status,
      completed: true,
    });
  }

  // Cleanup on close
  req.on('close', () => {
    sseConnections.get(planId)?.delete(res);
  });
}

function handleHealth(res) {
  sendJSON(res, 200, {
    status: 'ok',
    version: '1.0.0',
    uptime_ms: Date.now() - metrics.start_time,
  });
}

function handleMetrics(res) {
  const uptime = Date.now() - metrics.start_time;
  const success_rate = metrics.plans_created > 0
    ? (metrics.plans_completed / metrics.plans_created * 100).toFixed(2)
    : 0;

  sendJSON(res, 200, {
    uptime_ms: uptime,
    requests_total: metrics.requests,
    plans_created: metrics.plans_created,
    plans_completed: metrics.plans_completed,
    plans_failed: metrics.plans_failed,
    plans_pending: metrics.plans_created - metrics.plans_completed - metrics.plans_failed,
    success_rate_percent: parseFloat(success_rate),
    active_sse_connections: Array.from(sseConnections.values()).reduce((sum, s) => sum + s.size, 0),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AUDIT EXPORT HANDLERS (C3.1)
// ════════════════════════════════════════════════════════════════════════════

function handleAuditExport(url, res) {
  metrics.requests++;

  const params = url.searchParams;
  const format = params.get('format') || 'json';
  const options = {
    plan_id: params.get('plan_id') || undefined,
    action: params.get('action') || undefined,
    since: params.get('since') ? parseInt(params.get('since')) : undefined,
    until: params.get('until') ? parseInt(params.get('until')) : undefined,
    limit: params.get('limit') ? parseInt(params.get('limit')) : 1000,
  };

  // Enforce max limit
  options.limit = Math.min(options.limit, 10000);

  if (format === 'csv') {
    const csv = auditTrail.exportCSV(options);
    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="audit-export.csv"',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(csv);
  } else {
    const data = auditTrail.exportJSON(options);
    sendJSON(res, 200, data);
  }
}

function handleAuditTimeline(planId, res) {
  metrics.requests++;

  const timeline = auditTrail.exportPlanTimeline(planId);
  sendJSON(res, 200, timeline);
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ════════════════════════════════════════════════════════════════════════════

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendCORS(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const path = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    return sendCORS(res);
  }

  // Routes
  if (method === 'POST' && path === '/ask') {
    return handleAsk(req, res);
  }

  if (method === 'POST' && path === '/ask_stream') {
    return handleAskStream(req, res);
  }

  if (method === 'GET' && path.match(/^\/plans\/[^/]+$/)) {
    const planId = path.split('/')[2];
    return handleGetPlan(planId, res);
  }

  if (method === 'GET' && path.match(/^\/plans\/[^/]+\/events$/)) {
    const planId = path.split('/')[2];
    return handlePlanEvents(planId, req, res);
  }

  if (method === 'GET' && path === '/health') {
    return handleHealth(res);
  }

  if (method === 'GET' && path === '/metrics') {
    return handleMetrics(res);
  }

  // Audit export endpoints (C3.1)
  if (method === 'GET' && path === '/audit/export') {
    return handleAuditExport(url, res);
  }

  if (method === 'GET' && path.match(/^\/audit\/plans\/[^/]+\/timeline$/)) {
    const planId = path.split('/')[3];
    return handleAuditTimeline(planId, res);
  }

  // 404
  sendJSON(res, 404, { error: 'Not found' });
}

// ════════════════════════════════════════════════════════════════════════════
// SERVER
// ════════════════════════════════════════════════════════════════════════════

const server = http.createServer(router);

server.listen(port, () => {
  logger.info('AgentD', `Headless agent daemon started on port ${port}`);
  logger.info('AgentD', `Endpoints: /ask, /ask_stream, /plans/:id, /health, /metrics, /audit/export`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('AgentD', 'Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

export { server };
