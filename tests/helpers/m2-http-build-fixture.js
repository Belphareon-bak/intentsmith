// Controlled HTTP composition for the registered M2 lifecycle journey. The
// production routes/service, SQLite authority and Git/bwrap providers are real;
// authentication, project registry and model output are explicit test fixtures.
// This is neither src/server.js startup evidence nor a physical model test.
import { isolatedTestRuntime } from './isolated-test-db.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { up as applyEffectAuthority } from '../../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectHardening } from '../../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as applyLifecycleAuthority } from '../../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import { createDefaultM2LifecycleApplicationService } from '../../src/lifecycle/m2-lifecycle-application-service.js';
import { createM2LifecycleRoutes } from '../../src/routes/m2-lifecycle.js';

export const HTTP_BUILD_PROJECT_ID = 9027;
export const HTTP_BUILD_BEFORE = 'export const classifyYear = () => "before";\n';
export const HTTP_BUILD_OUTPUTS = Object.freeze({
  'src/calendar.mjs': 'export const isLeapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);\n',
  'src/app.mjs': 'import { isLeapYear } from "./calendar.mjs";\nexport const classifyYear = year => isLeapYear(year) ? "leap" : "common";\n',
});
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'controlled-http-operator' });
const HELPER_PATH = fileURLToPath(import.meta.url);

export function httpBuildBlueprint() {
  return {
    instruction: 'Build a Gregorian leap-year classifier from two dependent modules.',
    files: [
      { path: 'src/app.mjs', instruction: 'Import isLeapYear and export classifyYear returning leap or common.', dependsOn: ['src/calendar.mjs'] },
      { path: 'src/calendar.mjs', instruction: 'Export isLeapYear implementing the Gregorian century rule.', dependsOn: [] },
    ],
    focusedTest: {
      binary: process.execPath,
      argv: ['--input-type=module', '-e', "import assert from 'node:assert/strict';import { classifyYear } from './src/app.mjs';for(const [year,want] of [[1900,'common'],[2000,'leap'],[2024,'leap'],[2023,'common'],[2100,'common'],[2400,'leap']])assert.equal(classifyYear(year),want,String(year));console.log('6 controlled HTTP behavioural assertions passed');"],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000,
    },
    gitCommit: {
      message: 'M2 controlled HTTP project build',
      identity: { authorName: 'IntentSmith Test', authorEmail: 'test@example.invalid', authorDate: '2026-09-12T00:00:00Z',
        committerName: 'IntentSmith Test', committerEmail: 'test@example.invalid', committerDate: '2026-09-12T00:00:00Z' },
    },
  };
}

export async function startControlledM2HttpFixture({ fixtureRoot, defect = false, restart = false, token }) {
  const configPath = path.join(fixtureRoot, restart ? 'restart.json' : 'initial.json');
  const config = { fixtureRoot, defect, restart, token: token ?? randomBytes(32).toString('hex') };
  fs.writeFileSync(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  const child = spawn(process.execPath, [HELPER_PATH, '--serve', configPath], {
    cwd: isolatedTestRuntime.repositoryRoot, env: { ...process.env, INTENTSMITH_AUDIT_RUN: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-128_000); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  // Install the exit observer immediately; no shutdown race loses the event.
  exited.catch(() => {});
  const server = { child, exited, token: config.token, output: () => output };
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Controlled M2 HTTP fixture startup timed out')), 30_000);
      timer.unref();
      const onMessage = message => {
        if (message?.type !== 'm2-http-ready') return;
        clearTimeout(timer);
        child.off('message', onMessage);
        resolve(message);
      };
      child.on('message', onMessage);
      exited.then(result => { clearTimeout(timer); reject(new Error(`Controlled HTTP fixture exited before ready: ${JSON.stringify(result)}\n${output}`)); }, reject);
    });
    assert.equal(ready.pid, child.pid);
    assert.ok(Number.isSafeInteger(ready.port) && ready.port > 0 && ready.port <= 65535);
    assert.equal(ready.databasePath, path.join(fixtureRoot, 'authority.sqlite'));
    return { ...server, ready, base: `http://127.0.0.1:${ready.port}` };
  } catch (error) {
    await stopControlledM2HttpFixture(server);
    throw error;
  }
}

export async function stopControlledM2HttpFixture(server) {
  if (!server) return null;
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGTERM');
  let timeout;
  const result = await Promise.race([server.exited, new Promise(resolve => {
    timeout = setTimeout(() => resolve(null), 5_000);
  })]);
  clearTimeout(timeout);
  if (result) return { ...result, forced: false };
  server.child.kill('SIGKILL');
  const forced = await server.exited;
  return { ...forced, forced: true };
}

export async function controlledM2Request(server, method, requestPath, body = null, token = server.token) {
  const response = await fetch(new URL(requestPath, server.base), {
    method, headers: { 'Content-Type': 'application/json', Connection: 'close', Authorization: `Bearer ${token}` },
    body: body === null ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  return { status: response.status, data: JSON.parse(raw), raw };
}

async function serveControlledFixture(configPath) {
  assert.ok(process.send, 'fixture must be spawned with an owned IPC channel');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const root = fs.realpathSync(config.fixtureRoot);
  assert.equal(root, config.fixtureRoot);
  assert.ok(root.startsWith(isolatedTestRuntime.artifacts + path.sep), 'fixture authority must be under isolated artifacts');
  assert.equal(path.dirname(configPath), root);
  assert.match(config.token, /^[a-f0-9]{64}$/);
  const projectRoot = fs.realpathSync(path.join(root, 'project'));
  const databasePath = path.join(root, 'authority.sqlite');
  assert.equal(fs.existsSync(databasePath), config.restart, 'restart must reopen an existing database; initial boot must create one');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  if (!config.restart) database.transaction(() => {
    applyEffectAuthority(database); applyEffectHardening(database); applyEffectClaims(database);
    applyEffectClaimTruth(database); applyExecutionAuthority(database); applyLifecycleAuthority(database);
  })();
  const calls = [];
  const service = createDefaultM2LifecycleApplicationService({ database,
    projects: { findById: { get: id => id === HTTP_BUILD_PROJECT_ID ? { id, path: projectRoot, status: 'active' } : null } },
    generateCodeDraft: async ({ prompt }) => {
      const input = JSON.parse(prompt);
      calls.push(input.path);
      assert.equal(config.restart, false, 'restart must not regenerate a completed build');
      assert.equal(input.path, ['src/calendar.mjs', 'src/app.mjs'][calls.length - 1]);
      assert.equal(fs.readFileSync(path.join(projectRoot, 'src/app.mjs'), 'utf8'), HTTP_BUILD_BEFORE);
      assert.equal(fs.existsSync(path.join(projectRoot, 'src/calendar.mjs')), false, 'generation must not write proposed dependencies');
      const outputs = { ...HTTP_BUILD_OUTPUTS };
      if (config.defect) outputs['src/calendar.mjs'] = 'export const isLeapYear = year => year % 4 === 0;\n';
      assert.deepEqual(input.peerFiles ?? [], input.path === 'src/app.mjs'
        ? [{ path: 'src/calendar.mjs', content: outputs['src/calendar.mjs'], state: 'proposed' }] : []);
      return { content: JSON.stringify({ afterContent: outputs[input.path] }), finishReason: 'stop' };
    },
  });
  const recovered = await service.recoverIncompleteSmallProjectChanges();
  const sendJSON = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
    response.end(JSON.stringify(value));
  };
  const routes = createM2LifecycleRoutes({ m2LifecycleService: service, sendJSON,
    safeError: () => ({ error: 'Internal controlled fixture error' }),
    parseBody: async request => {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 64 * 1024, 'fixture request body exceeds limit');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${config.token}`) return sendJSON(response, 403, { error: 'Controlled fixture authentication required' });
      request.authenticatedSubject = SUBJECT; // Explicit fixture identity, never production authentication evidence.
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/fixture/evidence') {
        const authority = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'm2_%' ORDER BY name").all().map(({ name }) => {
          assert.match(name, /^m2_[a-z_]+$/);
          const rows = database.prepare(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row)).sort();
          return { table: name, count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
        });
        return sendJSON(response, 200, { fixture: 'controlled-auth-project-registry-and-model', pid: process.pid, databasePath,
          recovered: recovered.length, generationCalls: calls, authority });
      }
      const handler = routes[`${request.method} ${url.pathname}`];
      if (!handler) return sendJSON(response, 404, { error: 'Controlled fixture route not found' });
      await handler(request, response);
    } catch (error) {
      console.error(error.stack || error.message);
      if (!response.headersSent) sendJSON(response, 500, { error: 'Controlled fixture failure' });
      else response.destroy(error);
    }
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { database.close(); process.disconnect?.(); });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', shutdown);
  process.on('disconnect', shutdown);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  process.send({ type: 'm2-http-ready', pid: process.pid, port: server.address().port, databasePath, recovered: recovered.length });
}

if (process.argv[1] === HELPER_PATH && process.argv[2] === '--serve') {
  serveControlledFixture(process.argv[3]).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
    process.disconnect?.();
  });
}
