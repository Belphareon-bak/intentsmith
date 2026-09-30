#!/usr/bin/env node

// Exercise the product M1 route and ProjectContext bridge with an owned server.
// The local provider is a tripwire: this deterministic specialist path must
// never substitute a model answer for the selected package tool.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);
const children = new Set();
process.once('exit', () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});

async function startProvider() {
  let modelCalls = 0;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_000_000) { response.writeHead(413).end(); return; }
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.url === '/api/chat' || request.url === '/api/generate') {
      modelCalls++;
      response.end(JSON.stringify({ model: MODEL, digest: DIGEST,
        message: { role: 'assistant', content: 'MODEL_FALLBACK_WAS_CALLED' },
        response: 'MODEL_FALLBACK_WAS_CALLED', done: true, done_reason: 'stop' }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected fixture endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  return { url: `http://127.0.0.1:${address.port}`, get modelCalls() { return modelCalls; },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function productEnvironment(providerUrl, nonce) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
    HOME: runtime.home, XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_CACHE_HOME: runtime.xdgCache, XDG_DATA_HOME: runtime.xdgData,
    XDG_STATE_HOME: runtime.xdgState, TMPDIR: runtime.temp, TMP: runtime.temp,
    TEMP: runtime.temp, npm_config_cache: runtime.npmCache,
    NODE_ENV: 'test', CI: '1', DOTENV_CONFIG_PATH: `${runtime.runtime}/no-dotenv-file`,
    DOTENV_CONFIG_QUIET: 'true', INTENTSMITH_HOST: '127.0.0.1', INTENTSMITH_PORT: '0',
    INTENTSMITH_PORT_FILE: runtime.portFile, INTENTSMITH_DB_PATH: runtime.database,
    INTENTSMITH_PROJECTS_DIR: runtime.projects, INTENTSMITH_TEST_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: runtime.artifacts, INTENTSMITH_TEST_SERVER_NONCE: nonce,
    INTENTSMITH_ENABLE_AGENTS: 'false', INTENTSMITH_ENABLE_LIFECYCLE: 'false',
    INTENTSMITH_ENABLE_COMFYUI: 'false', INTENTSMITH_ENABLE_AUTONOMY: 'false',
    INTENTSMITH_ENABLE_SKILLS: 'false', INTENTSMITH_ENABLE_TELEMETRY: 'false',
    INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false', INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false',
    INTENTSMITH_LOG_LEVEL: 'warn', INTENTSMITH_MODEL_D1: MODEL,
    INTENTSMITH_MODEL_D2: MODEL, INTENTSMITH_MODEL_CODE: MODEL,
    INTENTSMITH_MODEL_R1: MODEL, INTENTSMITH_MODEL_R2: MODEL,
    INTENTSMITH_MODEL_CHAT: MODEL, INTENTSMITH_MODEL_VISION: MODEL, OLLAMA_URL: providerUrl,
  };
}

async function startProduct(providerUrl) {
  const nonce = randomBytes(32).toString('base64url');
  if (existsSync(runtime.portFile)) unlinkSync(runtime.portFile);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: runtime.repositoryRoot, env: productEnvironment(providerUrl, nonce),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const state = { child, code: null, signal: null, output: '', port: null, capability: null };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { state.output = (state.output + String(chunk)).slice(-16_000); });
  }
  child.once('exit', (code, signal) => {
    state.code = code; state.signal = signal; children.delete(child);
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (state.code !== null || state.signal !== null) {
      throw new Error(`Product exited before ready: ${state.output.slice(-2500)}`);
    }
    if (existsSync(runtime.portFile)) {
      try {
        const ready = JSON.parse(readFileSync(runtime.portFile, 'utf8'));
        if (ready.pid === child.pid && ready.testRunNonce === nonce
          && Number.isSafeInteger(ready.port) && ready.port > 0
          && /^[A-Za-z0-9_-]{43}$/.test(ready.localCapability || '')) {
          state.port = ready.port; state.capability = ready.localCapability;
          return state;
        }
      } catch { /* atomic port-file write */ }
    }
    await delay(50);
  }
  await stopProduct(state);
  throw new Error(`Product readiness timeout: ${state.output.slice(-2500)}`);
}

async function stopProduct(state) {
  if (!state?.child || state.code !== null || state.signal !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && state.code === null && state.signal === null) await delay(25);
  if (state.code === null && state.signal === null) {
    state.child.kill('SIGKILL');
    throw new Error('Owned product required SIGKILL');
  }
  assert.equal(state.signal, null, state.output.slice(-2500));
  assert.equal(state.code, 0, state.output.slice(-2500));
}

async function requestJson(server, method, route, body = null) {
  const response = await fetch(`http://127.0.0.1:${server.port}${route}`, {
    method, headers: {
      'X-IntentSmith-Local-Capability': server.capability,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === null ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${method} ${route}: non-JSON ${response.status}: ${raw.slice(0, 300)}`); }
  return { status: response.status, data };
}

async function expect(server, method, route, body, status) {
  const result = await requestJson(server, method, route, body);
  assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.data).slice(0, 500)}`);
  return result.data;
}

async function createProjectConversation(server, {
  label, functionName, sourceLine, sourceCanary, findingId, findingName,
}) {
  const name = `specialist-${label}-${randomBytes(4).toString('hex')}`;
  const created = await expect(server, 'POST', '/api/projects', { name, description: `Private ${label}` }, 201);
  assert(Number.isSafeInteger(created.project?.id) && created.project.id > 0);
  assert(created.project.path.startsWith(runtime.projects + '/'));
  mkdirSync(path.join(created.project.path, 'src'), { recursive: true });
  const sourcePath = `src/${label}-auth.js`;
  const sourceContent = `export function ${functionName}(input) {\n${sourceLine}\n}\n`;
  assert(sourceContent.includes(sourceCanary));
  writeFileSync(path.join(created.project.path, sourcePath), sourceContent);
  const conversation = await expect(server, 'POST', '/api/conversations', {
    title: name, project_id: created.project.id, mode: 'chat',
  }, 201);
  assert.equal(typeof conversation.conversation?.id, 'string');
  return { projectId: created.project.id, conversationId: conversation.conversation.id,
    sourcePath, functionName, sourceContent, sourceCanary, sourceLine,
    sourceDigest: `sha256:${createHash('sha256').update(sourceContent).digest('hex')}`,
    findingId, findingName };
}

function command(conversationId, label, input) {
  return { contract: 'ConversationCommand', version: 1,
    requestId: `specialist-${label}-${randomBytes(5).toString('hex')}`,
    conversationId, turnId: `specialist-turn-${label}-${randomBytes(5).toString('hex')}`,
    action: 'send', input };
}

function assertDeterministicResult(result, fixture, foreignFixture) {
  assert.equal(result.status, 'ok');
  assert.equal(result.response?.metadata?.mode, 'specialist');
  assert.equal(result.response.metadata.specialist?.id, 'code-reviewer');
  assert.equal(result.response.metadata.specialistTool, 'code-reviewer.security_scan');
  assert.equal(result.response.metadata.deterministicPresentation, true);
  assert.equal(result.response.metadata.projectContext?.projectId, fixture.projectId);
  const contextItems = result.response.metadata.projectContext.items;
  assert(contextItems.some(item => item.path === fixture.sourcePath
    && item.contentDigest === fixture.sourceDigest),
  'ProjectContext must attest the exact bytes of this project source');
  assert(contextItems.every(item => item.path !== foreignFixture.sourcePath
    && item.contentDigest !== foreignFixture.sourceDigest));
  assert(result.response.content.includes(`**CRITICAL** \`${fixture.sourcePath}:2\` — ${fixture.findingName}`));
  assert(!result.response.content.includes(foreignFixture.sourcePath));
  assert(!result.response.content.includes(foreignFixture.findingName));
  const findings = result.response.metadata.toolResults[0].data.data.vulnerabilities;
  const ownFindings = findings.filter(item => item.path === fixture.sourcePath);
  assert.deepEqual(ownFindings.map(item => ({ id: item.id, name: item.name,
    severity: item.severity, line: item.line, snippet: item.snippet,
    projectId: item.provenance.projectId, contentDigest: item.provenance.contentDigest })), [{
    id: fixture.findingId, name: fixture.findingName, severity: 'critical', line: 2,
    snippet: fixture.sourceLine.trim(), projectId: fixture.projectId,
    contentDigest: fixture.sourceDigest,
  }]);
  assert(findings.every(item => item.path !== foreignFixture.sourcePath
    && item.provenance.projectId !== foreignFixture.projectId
    && item.provenance.contentDigest !== foreignFixture.sourceDigest
    && !item.snippet.includes(foreignFixture.sourceCanary)));
}

test('M1 specialist continuation uses conversation identity and keeps two projects isolated', {
  timeout: 180_000,
}, async t => {
  const provider = await startProvider();
  let server = null;
  t.after(async () => {
    if (server) await stopProduct(server);
    await provider.close();
  });
  server = await startProduct(provider.url);
  const a = await createProjectConversation(server, {
    label: 'a', functionName: 'validateSessionToken',
    sourceLine: "  return eval(input + 'ORION_A_SOURCE_713');",
    sourceCanary: 'ORION_A_SOURCE_713', findingId: 'EVAL_USAGE',
    findingName: 'Dynamic Code Execution',
  });
  const b = await createProjectConversation(server, {
    label: 'b', functionName: 'authorizeEditor',
    sourceLine: "  return document.write(input + 'VEGA_B_SOURCE_841');",
    sourceCanary: 'VEGA_B_SOURCE_841', findingId: 'XSS',
    findingName: 'Cross-Site Scripting (XSS)',
  });
  assert.notEqual(a.projectId, b.projectId);
  assert.notEqual(a.conversationId, b.conversationId);
  for (const fixture of [a, b]) {
    const selected = await expect(server, 'POST', '/api/chat/specialist', {
      sessionId: fixture.conversationId, specialistId: 'code-reviewer',
    }, 200);
    assert.equal(selected.specialistId, 'code-reviewer');
  }

  const firstA = command(a.conversationId, 'a-initial',
    `Proveď security audit ${a.functionName} v tomto projektu.`);
  const firstB = command(b.conversationId, 'b-initial',
    `Proveď security audit ${b.functionName} v tomto projektu.`);
  assertDeterministicResult(await expect(server, 'POST', '/api/chat', firstA, 200), a, b);
  assertDeterministicResult(await expect(server, 'POST', '/api/chat', firstB, 200), b, a);

  const followA = command(a.conversationId, 'a-followup', `A co ${a.functionName} teď?`);
  const followB = command(b.conversationId, 'b-followup', `A co ${b.functionName} teď?`);
  assert.equal(new Set([firstA.requestId, firstB.requestId,
    followA.requestId, followB.requestId]).size, 4);
  assert.equal(new Set([firstA.turnId, firstB.turnId,
    followA.turnId, followB.turnId]).size, 4);
  assertDeterministicResult(await expect(server, 'POST', '/api/chat', followA, 200), a, b);
  assertDeterministicResult(await expect(server, 'POST', '/api/chat', followB, 200), b, a);
  assert.equal(provider.modelCalls, 0, 'deterministic specialist turns must not call the model');
  writeFileSync(path.join(runtime.artifacts, 'chat-specialist-followup-http.json'),
    `${JSON.stringify({ schemaVersion: 1,
      sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION || 'direct-run-unattested',
      fixture: 'owned-local-provider', projectIds: [a.projectId, b.projectId],
      conversationCount: 2, m1TurnCount: 4, distinctRequestIds: 4,
      providerModelCalls: provider.modelCalls, status: 'PASS',
    }, null, 2)}\n`, { mode: 0o600 });
});
