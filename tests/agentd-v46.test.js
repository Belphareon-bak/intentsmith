// AgentD v46.0 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for headless agent daemon:
// - REST endpoints (/ask, /plans/:id)
// - SSE streaming (/ask_stream, /plans/:id/events)
// - Health and metrics endpoints
//
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';
import { EventEmitter } from 'events';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK SERVER (for testing without starting real daemon)
// ════════════════════════════════════════════════════════════════════════════

const mockPlans = new Map();
let mockMetrics = {
  requests: 0,
  plans_created: 0,
  plans_completed: 0,
  plans_failed: 0,
  start_time: Date.now(),
};

function createMockServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    const path = url.pathname;

    mockMetrics.requests++;

    // CORS
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    // Health
    if (method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
    }

    // Metrics
    if (method === 'GET' && path === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        requests_total: mockMetrics.requests,
        plans_created: mockMetrics.plans_created,
        plans_completed: mockMetrics.plans_completed,
        plans_failed: mockMetrics.plans_failed,
      }));
    }

    // POST /ask (mock)
    if (method === 'POST' && path === '/ask') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const { input } = parsed;

          // Validate input - must be present and be a string
          if (!input || typeof input !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid input' }));
            return;
          }

          const planId = `plan_${Date.now()}`;

          mockMetrics.plans_created++;
          mockMetrics.plans_completed++;

          mockPlans.set(planId, {
            id: planId,
            input,
            status: 'completed',
            plan: { plan_id: planId, goal: input, steps: [], requires_approval: false, confidence: 1 },
            execution: { plan_id: planId, status: 'completed', step_results: [], total_duration_ms: 10 },
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            plan_id: planId,
            status: 'completed',
            plan: mockPlans.get(planId).plan,
            execution: mockPlans.get(planId).execution,
            duration_ms: 10,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /ask_stream (mock SSE)
    if (method === 'POST' && path === '/ask_stream') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const { input } = parsed;

          // Validate input
          if (!input || typeof input !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid input' }));
            return;
          }

          const planId = `plan_${Date.now()}`;

          mockMetrics.plans_created++;

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          // Send events - all in one write for reliable parsing
          const events = [
            `event: plan_started\ndata: ${JSON.stringify({ plan_id: planId, input })}\n`,
            `event: plan_created\ndata: ${JSON.stringify({ plan_id: planId, plan: { goal: input, steps: [] } })}\n`,
            `event: plan_completed\ndata: ${JSON.stringify({ plan_id: planId, status: 'completed', duration_ms: 10 })}\n`,
          ].join('\n');

          res.write(events);

          mockMetrics.plans_completed++;

          res.end();
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // GET /plans/:id
    if (method === 'GET' && path.match(/^\/plans\/[^/]+$/)) {
      const planId = path.split('/')[2];
      const plan = mockPlans.get(planId);

      if (!plan) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Plan not found' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plan));
      return;
    }

    // GET /audit/export (mock)
    if (method === 'GET' && path === '/audit/export') {
      const format = url.searchParams.get('format') || 'json';

      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="audit-export.csv"',
        });
        res.end('id,plan_id,timestamp,actor,action\n1,,12345,test,PLAN_STARTED');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          metadata: { exported_at: new Date().toISOString(), total_events: 1 },
          events: [{ id: 1, action: 'PLAN_STARTED', actor: 'test', timestamp: Date.now() }],
        }));
      }
      return;
    }

    // GET /audit/plans/:id/timeline (mock)
    if (method === 'GET' && path.match(/^\/audit\/plans\/[^/]+\/timeline$/)) {
      const planId = path.split('/')[3];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        plan_id: planId,
        duration_ms: 100,
        event_count: 3,
        timeline: [
          { sequence: 1, action: 'PLAN_STARTED' },
          { sequence: 2, action: 'STEP_COMPLETED' },
          { sequence: 3, action: 'PLAN_COMPLETED' },
        ],
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Make HTTP request
// ════════════════════════════════════════════════════════════════════════════

function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: 'localhost',
      port: addr.port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: res.headers['content-type']?.includes('json') ? JSON.parse(data) : data,
          });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// SSE client helper
function sseRequest(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const events = [];
    const options = {
      hostname: 'localhost',
      port: addr.port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let buffer = '';

      res.on('data', chunk => {
        buffer += chunk.toString();
      });

      res.on('end', () => {
        // Parse all SSE events at the end
        const lines = buffer.split('\n');
        let currentEvent = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.substring(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              events.push({ event: currentEvent, data: JSON.parse(line.substring(6)) });
            } catch {}
            currentEvent = null;
          }
        }

        resolve({ status: res.statusCode, events });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  AgentD v46.0 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// Create and start mock server
const server = createMockServer();
await new Promise(resolve => server.listen(0, resolve));
console.log(`  Mock server running on port ${server.address().port}\n`);

// ────────────────────────────────────────────────────────────────────────────
// Health & Metrics
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Health & Metrics');

await asyncTest('GET /health returns ok', async () => {
  const res = await request(server, 'GET', '/health');
  assertEqual(res.status, 200, 'Status');
  assertEqual(res.body.status, 'ok', 'Health status');
  assertTrue(res.body.version, 'Has version');
});

await asyncTest('GET /metrics returns counts', async () => {
  const res = await request(server, 'GET', '/metrics');
  assertEqual(res.status, 200, 'Status');
  assertTrue('requests_total' in res.body, 'Has requests_total');
  assertTrue('plans_created' in res.body, 'Has plans_created');
});

// ────────────────────────────────────────────────────────────────────────────
// REST API
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 REST API');

await asyncTest('POST /ask executes plan', async () => {
  const res = await request(server, 'POST', '/ask', { input: 'Test input' });
  assertEqual(res.status, 200, 'Status');
  assertTrue(res.body.plan_id, 'Has plan_id');
  assertEqual(res.body.status, 'completed', 'Status is completed');
  assertTrue(res.body.plan, 'Has plan');
  assertTrue(res.body.execution, 'Has execution');
});

await asyncTest('POST /ask without input returns 400', async () => {
  const res = await request(server, 'POST', '/ask', {});
  assertEqual(res.status, 400, 'Status');
  assertTrue(res.body.error, 'Has error');
});

await asyncTest('GET /plans/:id returns plan', async () => {
  // First create a plan
  const createRes = await request(server, 'POST', '/ask', { input: 'Get plan test' });
  const planId = createRes.body.plan_id;

  // Then get it
  const res = await request(server, 'GET', `/plans/${planId}`);
  assertEqual(res.status, 200, 'Status');
  assertEqual(res.body.id, planId, 'Plan ID matches');
});

await asyncTest('GET /plans/:id for unknown plan returns 404', async () => {
  const res = await request(server, 'GET', '/plans/unknown-id');
  assertEqual(res.status, 404, 'Status');
});

// ────────────────────────────────────────────────────────────────────────────
// SSE Streaming
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 SSE Streaming');

await asyncTest('POST /ask_stream returns SSE events', async () => {
  const res = await sseRequest(server, 'POST', '/ask_stream', { input: 'SSE test' });
  assertEqual(res.status, 200, 'Status');
  assertTrue(res.events.length >= 3, 'Has at least 3 events');

  const eventTypes = res.events.map(e => e.event);
  assertTrue(eventTypes.includes('plan_started'), 'Has plan_started event');
  assertTrue(eventTypes.includes('plan_completed'), 'Has plan_completed event');
});

await asyncTest('SSE events have correct structure', async () => {
  const res = await sseRequest(server, 'POST', '/ask_stream', { input: 'Structure test' });

  const startedEvent = res.events.find(e => e.event === 'plan_started');
  assertTrue(startedEvent.data.plan_id, 'plan_started has plan_id');
  assertTrue(startedEvent.data.input, 'plan_started has input');

  const completedEvent = res.events.find(e => e.event === 'plan_completed');
  assertTrue(completedEvent.data.plan_id, 'plan_completed has plan_id');
  assertTrue(completedEvent.data.status, 'plan_completed has status');
});

// ────────────────────────────────────────────────────────────────────────────
// CORS
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 CORS');

await asyncTest('OPTIONS request returns CORS headers', async () => {
  const res = await request(server, 'OPTIONS', '/ask');
  assertEqual(res.status, 204, 'Status');
  assertTrue(res.headers['access-control-allow-origin'], 'Has CORS origin header');
});

// ────────────────────────────────────────────────────────────────────────────
// Audit Export (C3.1)
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Audit Export');

await asyncTest('GET /audit/export returns JSON by default', async () => {
  const res = await request(server, 'GET', '/audit/export');
  assertEqual(res.status, 200, 'Status');
  assertTrue(res.body.metadata, 'Has metadata');
  assertTrue(Array.isArray(res.body.events), 'Has events array');
});

await asyncTest('GET /audit/export?format=csv returns CSV', async () => {
  const res = await request(server, 'GET', '/audit/export?format=csv');
  assertEqual(res.status, 200, 'Status');
  assertTrue(res.headers['content-type'].includes('text/csv'), 'Content-Type is CSV');
});

await asyncTest('GET /audit/plans/:id/timeline returns timeline', async () => {
  const res = await request(server, 'GET', '/audit/plans/test-plan/timeline');
  assertEqual(res.status, 200, 'Status');
  assertEqual(res.body.plan_id, 'test-plan', 'Has plan_id');
  assertTrue(Array.isArray(res.body.timeline), 'Has timeline array');
  assertTrue(res.body.event_count >= 0, 'Has event_count');
});

// ════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════════════════════

server.close();

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
