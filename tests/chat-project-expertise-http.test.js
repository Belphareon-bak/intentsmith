#!/usr/bin/env node

// Real product HTTP routes and SQLite, with a test-owned local model fixture.
// This checks the final request sent to the configured provider; it is not a
// model-quality test or evidence that a physical model produced the reply.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { isolatedTestRuntime as parentRuntime } from './helpers/isolated-test-db.js';
import { createOwnedJourneyRuntime } from './helpers/chat-project-expertise-model-journey.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);
const PROJECT_A_CODE = 'EXPERT_A_ORION_391';
const PROJECT_B_CODE = 'EXPERT_B_LYRA_752';
const DEVELOPER_RULE = 'Piš čistý, čitelný kód';
const WRITER_RULE = 'Udržuj konzistenci postav a světa napříč celým textem';
const EXTENSION_ID = 'm3-http-expertise-journey';
const EXTENSION_MARKER = 'M3_HTTP_EXPERTISE_JOURNEY_MARKER';
const children = new Set();
// The registered runner already has a product server on parentRuntime. This
// journey starts another server, so its DB, port file and projects must differ.
const isolatedTestRuntime = createOwnedJourneyRuntime(parentRuntime);

process.once('exit', () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});

function sourceRevision() {
  return process.env.INTENTSMITH_TEST_SOURCE_REVISION || 'direct-run-unattested';
}

function appendTail(current, chunk) {
  return (current + String(chunk)).slice(-64_000);
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
  response.end(JSON.stringify(value));
}

async function startProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_000_000) {
        sendJson(response, 413, { error: 'fixture request too large' });
        return;
      }
    }
    if (request.method === 'GET' && request.url === '/api/tags') {
      sendJson(response, 200, { models: [{ name: MODEL, digest: DIGEST }] });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/show') {
      sendJson(response, 200, { model_info: { 'fixture.context_length': 4096 } });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/chat') {
      const payload = JSON.parse(body);
      requests.push(payload);
      sendJson(response, 200, {
        model: payload.model,
        digest: DIGEST,
        message: { role: 'assistant', content: JSON.stringify({ reply: 'Řízená fixture odpověď.', plan: null }) },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 96,
        eval_count: 12,
      });
      return;
    }
    sendJson(response, 503, { error: `Fixture endpoint unavailable: ${request.method} ${request.url}` });
  });
  server.keepAliveTimeout = 1;
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function serverEnvironment(providerUrl, nonce) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
    HOME: isolatedTestRuntime.home,
    XDG_CONFIG_HOME: isolatedTestRuntime.xdgConfig,
    XDG_CACHE_HOME: isolatedTestRuntime.xdgCache,
    XDG_DATA_HOME: isolatedTestRuntime.xdgData,
    XDG_STATE_HOME: isolatedTestRuntime.xdgState,
    TMPDIR: isolatedTestRuntime.temp,
    TMP: isolatedTestRuntime.temp,
    TEMP: isolatedTestRuntime.temp,
    npm_config_cache: isolatedTestRuntime.npmCache,
    NODE_ENV: 'test', CI: '1',
    DOTENV_CONFIG_PATH: `${isolatedTestRuntime.runtime}/no-dotenv-file`,
    DOTENV_CONFIG_QUIET: 'true',
    INTENTSMITH_HOST: '127.0.0.1',
    INTENTSMITH_PORT: '0',
    INTENTSMITH_PORT_FILE: isolatedTestRuntime.portFile,
    INTENTSMITH_DB_PATH: isolatedTestRuntime.database,
    INTENTSMITH_PROJECTS_DIR: isolatedTestRuntime.projects,
    INTENTSMITH_TEST_PROJECTS_DIR: isolatedTestRuntime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: isolatedTestRuntime.artifacts,
    INTENTSMITH_TEST_SERVER_NONCE: nonce,
    INTENTSMITH_ENABLE_AGENTS: 'false',
    INTENTSMITH_ENABLE_LIFECYCLE: 'false',
    INTENTSMITH_ENABLE_COMFYUI: 'false',
    INTENTSMITH_ENABLE_AUTONOMY: 'false',
    INTENTSMITH_ENABLE_SKILLS: 'false',
    INTENTSMITH_ENABLE_TELEMETRY: 'false',
    INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false',
    INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false',
    INTENTSMITH_LOG_LEVEL: 'warn',
    INTENTSMITH_MODEL_D1: MODEL,
    INTENTSMITH_MODEL_D2: MODEL,
    INTENTSMITH_MODEL_CODE: MODEL,
    INTENTSMITH_MODEL_R1: MODEL,
    INTENTSMITH_MODEL_R2: MODEL,
    INTENTSMITH_MODEL_CHAT: MODEL,
    INTENTSMITH_MODEL_VISION: MODEL,
    OLLAMA_URL: providerUrl,
  };
}

async function startServer(providerUrl) {
  const nonce = randomBytes(32).toString('base64url');
  if (existsSync(isolatedTestRuntime.portFile)) unlinkSync(isolatedTestRuntime.portFile);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: isolatedTestRuntime.repositoryRoot,
    env: serverEnvironment(providerUrl, nonce),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const state = { child, stdout: '', stderr: '', code: null, signal: null, port: null, capability: null };
  child.stdout.on('data', chunk => { state.stdout = appendTail(state.stdout, chunk); });
  child.stderr.on('data', chunk => { state.stderr = appendTail(state.stderr, chunk); });
  child.once('exit', (code, signal) => {
    state.code = code;
    state.signal = signal;
    children.delete(child);
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (state.code !== null || state.signal !== null) {
      throw new Error(`Product server exited before ready (${state.code ?? state.signal}): ${(state.stdout + state.stderr).slice(-2500)}`);
    }
    if (existsSync(isolatedTestRuntime.portFile)) {
      try {
        const ready = JSON.parse(readFileSync(isolatedTestRuntime.portFile, 'utf8'));
        if (ready.pid === child.pid && ready.testRunNonce === nonce
          && Number.isSafeInteger(ready.port) && ready.port > 0
          && /^[A-Za-z0-9_-]{43}$/.test(ready.localCapability || '')) {
          state.port = ready.port;
          state.capability = ready.localCapability;
          return state;
        }
      } catch { /* atomic port file write */ }
    }
    await delay(50);
  }
  await stopServer(state);
  throw new Error(`Product server did not become ready: ${state.stderr.slice(-2500)}`);
}

async function stopServer(state) {
  if (!state?.child || state.code !== null || state.signal !== null) return;
  state.child.kill('SIGTERM');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && state.code === null && state.signal === null) await delay(25);
  if (state.code === null && state.signal === null) {
    state.child.kill('SIGKILL');
    throw new Error('Owned product server did not stop gracefully');
  }
  assert.equal(state.signal, null, `Product server stopped by signal: ${state.signal}`);
  assert.equal(state.code, 0, state.stderr.slice(-2500));
}

async function requestJson(server, method, route, body = null) {
  const response = await fetch(`http://127.0.0.1:${server.port}${route}`, {
    method,
    headers: {
      'X-IntentSmith-Local-Capability': server.capability,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${method} ${route}: non-JSON HTTP ${response.status}: ${raw.slice(0, 300)}`); }
  return { status: response.status, data };
}

async function expect(server, method, route, body, status) {
  const response = await requestJson(server, method, route, body);
  assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(response.data).slice(0, 600)}`);
  return response.data;
}

function command(conversationId, label, input = 'Jaký je stav projektu?') {
  return {
    contract: 'ConversationCommand', version: 1,
    requestId: `expertise-http-${label}-${randomBytes(5).toString('hex')}`,
    conversationId,
    turnId: `expertise-turn-${label}-${randomBytes(5).toString('hex')}`,
    action: 'send', input,
  };
}

async function project(server, label, code) {
  const name = `expertise-${label}-${randomBytes(4).toString('hex')}`;
  const created = await expect(server, 'POST', '/api/projects', { name, description: `Soukromý projekt ${code}` }, 201);
  assert(Number.isSafeInteger(created.project?.id) && created.project.id > 0);
  assert(created.project.path.startsWith(isolatedTestRuntime.projects + '/'));
  writeFileSync(`${created.project.path}/README.md`, `# ${name}\n\nAktuální projektový kód: ${code}.\n`);
  const conversation = await expect(server, 'POST', '/api/conversations', {
    title: `${name}-chat`, project_id: created.project.id, mode: 'chat',
  }, 201);
  assert.equal(typeof conversation.conversation?.id, 'string');
  return { id: created.project.id, path: created.project.path, conversationId: conversation.conversation.id, code };
}

function providerPrompt(request) {
  assert.equal(request.model, MODEL);
  assert.equal(request.stream, false);
  assert(Array.isArray(request.messages) && request.messages.length >= 2);
  const userMessage = request.messages.at(-1);
  assert.equal(userMessage?.role, 'user', 'final provider message must be the project prompt');
  const payload = JSON.parse(userMessage.content);
  assert.equal(typeof request.options?.num_ctx, 'number');
  return payload;
}

async function chatAndCapture(server, provider, conversationId, label) {
  const before = provider.requests.length;
  const result = await expect(server, 'POST', '/api/chat', command(conversationId, label), 200);
  assert.equal(result.status, 'ok');
  assert.equal(result.response?.content, 'Řízená fixture odpověď.');
  assert.equal(result.response?.metadata?.handler, 'project.collaboration');
  assert.equal(provider.requests.length, before + 1, 'one final provider request per project chat turn');
  return { result, request: provider.requests.at(-1), prompt: providerPrompt(provider.requests.at(-1)) };
}

function extensionManifest() {
  return {
    contract: 'ExtensionManifest', version: 1, kind: 'expertise', id: EXTENSION_ID,
    moduleVersion: '1.0.0', coreContract: '>=136.0.0 <137.0.0',
    requiredCapabilities: [], optionalCapabilities: [],
    payload: { definition: {
      name: 'HTTP project expertise fixture', description: 'Deterministic routing and prompt fixture',
      domain: 'project_guidance', systemPrompt: 'Use current project evidence.',
      temperature: 0.2, modules: {
        domain_rules: [`${EXTENSION_MARKER}: use current project evidence`], emphasis: ['Current project revision'],
        constraints: ['Do not invent files'], vocabulary: ['fixture project'],
        antipatterns: ['Stale project facts'], disclaimer: null,
      },
    }, enabledByDefault: false },
  };
}

test('project expertise selection reaches final provider prompt and remains project-bound across restart', {
  timeout: 240_000,
}, async t => {
  const provider = await startProvider();
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await provider.close();
  });

  server = await startServer(provider.url);
  const a = await project(server, 'a', PROJECT_A_CODE);
  const b = await project(server, 'b', PROJECT_B_CODE);
  const routeA = `/api/conversations/${a.conversationId}/expertises`;
  const routeB = `/api/conversations/${b.conversationId}/expertises`;
  const emptyA = await expect(server, 'GET', routeA, null, 200);
  const emptyB = await expect(server, 'GET', routeB, null, 200);
  assert.deepEqual(emptyA.expertises, []);
  assert.deepEqual(emptyB.expertises, []);

  const selectedA = await expect(server, 'PUT', routeA, {
    projectId: a.id, expectedRevision: emptyA.revision,
    expertises: [{ id: 'developer', weight: 0.7 }],
  }, 200);
  const selectedB = await expect(server, 'PUT', routeB, {
    projectId: b.id, expectedRevision: emptyB.revision,
    expertises: [{ id: 'writer', weight: 0.8 }],
  }, 200);
  assert.notEqual(selectedA.revision, emptyA.revision);
  assert.notEqual(selectedB.revision, emptyB.revision);
  assert.deepEqual((await expect(server, 'GET', routeA, null, 200)).expertises, [{ id: 'developer', weight: 0.7 }]);
  assert.deepEqual((await expect(server, 'GET', routeB, null, 200)).expertises, [{ id: 'writer', weight: 0.8 }]);

  const stale = await expect(server, 'PUT', routeA, {
    projectId: a.id, expectedRevision: emptyA.revision, expertises: [],
  }, 409);
  assert.equal(stale.code, 'EXPERTISE_REVISION_CONFLICT');
  const wrongProject = await expect(server, 'PUT', routeA, {
    projectId: b.id, expectedRevision: selectedA.revision, expertises: [],
  }, 409);
  assert.equal(wrongProject.code, 'CONVERSATION_PROJECT_CONFLICT');
  assert.deepEqual((await expect(server, 'GET', routeA, null, 200)).expertises, selectedA.expertises);

  const firstA = await chatAndCapture(server, provider, a.conversationId, 'a-initial');
  const firstB = await chatAndCapture(server, provider, b.conversationId, 'b-initial');
  assert.equal(firstA.prompt.project.id, a.id);
  assert.equal(firstB.prompt.project.id, b.id);
  assert.match(JSON.stringify(firstA.prompt), new RegExp(PROJECT_A_CODE));
  assert.match(JSON.stringify(firstB.prompt), new RegExp(PROJECT_B_CODE));
  assert.doesNotMatch(JSON.stringify(firstA.prompt), new RegExp(PROJECT_B_CODE));
  assert.doesNotMatch(JSON.stringify(firstB.prompt), new RegExp(PROJECT_A_CODE));
  assert.equal(typeof firstA.prompt.expertiseGuidance, 'string');
  assert.equal(typeof firstB.prompt.expertiseGuidance, 'string');
  assert(firstA.prompt.expertiseGuidance.length > 50 && firstB.prompt.expertiseGuidance.length > 50);
  assert.notEqual(firstA.prompt.expertiseGuidance, firstB.prompt.expertiseGuidance);
  assert(firstA.prompt.expertiseGuidance.includes(DEVELOPER_RULE), 'developer rule must reach project A provider prompt');
  assert(!firstA.prompt.expertiseGuidance.includes(WRITER_RULE), 'writer rule must not reach project A provider prompt');
  assert(firstB.prompt.expertiseGuidance.includes(WRITER_RULE), 'writer rule must reach project B provider prompt');
  assert(!firstB.prompt.expertiseGuidance.includes(DEVELOPER_RULE), 'developer rule must not reach project B provider prompt');
  assert.deepEqual(firstA.result.response.metadata.expertiseIds, ['developer']);
  assert.deepEqual(firstB.result.response.metadata.expertiseIds, ['writer']);

  await stopServer(server);
  server = null;
  server = await startServer(provider.url);
  assert.deepEqual(await expect(server, 'GET', routeA, null, 200), {
    conversationId: a.conversationId, expertises: selectedA.expertises, revision: selectedA.revision,
  });
  assert.deepEqual(await expect(server, 'GET', routeB, null, 200), {
    conversationId: b.conversationId, expertises: selectedB.expertises, revision: selectedB.revision,
  });
  const afterRestart = await chatAndCapture(server, provider, a.conversationId, 'a-restart');
  assert.equal(afterRestart.prompt.project.id, a.id);
  assert.equal(afterRestart.prompt.expertiseGuidance, firstA.prompt.expertiseGuidance);

  const clearedA = await expect(server, 'PUT', routeA, {
    projectId: a.id, expectedRevision: selectedA.revision, expertises: [],
  }, 200);
  assert.deepEqual(clearedA.expertises, []);
  const withoutExpertise = await chatAndCapture(server, provider, a.conversationId, 'a-cleared');
  assert.equal(Object.hasOwn(withoutExpertise.prompt, 'expertiseGuidance'), false);
  assert.deepEqual(withoutExpertise.result.response.metadata.expertiseIds, []);
  const bStillSelected = await chatAndCapture(server, provider, b.conversationId, 'b-still-selected');
  assert.equal(bStillSelected.prompt.expertiseGuidance, firstB.prompt.expertiseGuidance);

  const installed = await expect(server, 'POST', '/api/extensions/expertises/install', {
    manifest: extensionManifest(),
  }, 201);
  assert.equal(installed.extension.status, 'disabled');
  await expect(server, 'POST', `/api/extensions/expertises/${EXTENSION_ID}/enable`, {}, 200);
  const selectedDynamic = await expect(server, 'PUT', routeA, {
    projectId: a.id, expectedRevision: clearedA.revision,
    expertises: [{ id: EXTENSION_ID, weight: 0.8 }],
  }, 200);
  const dynamicTurn = await chatAndCapture(server, provider, a.conversationId, 'a-extension');
  assert.match(dynamicTurn.prompt.expertiseGuidance, new RegExp(EXTENSION_MARKER));
  assert.deepEqual(dynamicTurn.result.response.metadata.expertiseIds, [EXTENSION_ID]);

  await expect(server, 'POST', `/api/extensions/expertises/${EXTENSION_ID}/disable`, {}, 200);
  const beforeUnavailable = provider.requests.length;
  const unavailable = await expect(server, 'POST', '/api/chat', command(a.conversationId, 'a-disabled'), 200);
  assert.equal(unavailable.status, 'ok');
  assert.equal(unavailable.response?.metadata?.error, 'EXPERTISE_UNAVAILABLE');
  assert.equal(unavailable.response?.metadata?.fallbackSuppressed, true);
  assert.equal(provider.requests.length, beforeUnavailable, 'disabled selection must not reach provider');

  await expect(server, 'DELETE', `/api/extensions/expertises/${EXTENSION_ID}`, null, 200);
  assert.deepEqual((await expect(server, 'GET', routeA, null, 200)).expertises, []);
  const removedChoice = await expect(server, 'PUT', routeA, {
    projectId: a.id, expectedRevision: selectedDynamic.revision,
    expertises: [{ id: EXTENSION_ID, weight: 0.8 }],
  }, 404);
  assert.equal(removedChoice.code, 'EXPERTISE_NOT_FOUND');
  assert.deepEqual((await expect(server, 'GET', routeB, null, 200)).expertises, selectedB.expertises);

  const evidence = {
    schemaVersion: 1, sourceRevision: sourceRevision(), fixture: 'test-owned-local-provider',
    model: MODEL, providerRequestCount: provider.requests.length,
    providerRequestsSha256: createHash('sha256').update(JSON.stringify(provider.requests)).digest('hex'),
    projectIds: [a.id, b.id], selectedExpertises: ['developer', 'writer', EXTENSION_ID],
    restoredRevision: selectedA.revision, disabledProviderCalls: provider.requests.length - beforeUnavailable,
    status: 'PASS',
  };
  writeFileSync(`${parentRuntime.artifacts}/chat-project-expertise-http.json`,
    `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
});

test('the second file in the immediately preceding ordered user list proposes only that private read', {
  timeout: 120_000,
}, async t => {
  const provider = await startProvider();
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await provider.close();
  });
  server = await startServer(provider.url);
  const own = await project(server, 'ordinal-read', 'ORDINAL_A_391');
  writeFileSync(`${own.path}/alpha.md`, 'FIRST_FILE_SHOULD_STAY_PRIVATE');
  writeFileSync(`${own.path}/beta.md`, 'DRUHY_SOUBOR_752');
  const first = await expect(server, 'POST', '/api/chat', command(
    own.conversationId, 'ordered-list',
    'Napiš jednu větu, která uvádí soubory alpha.md a beta.md v tomto pořadí. Nic nečti ani neměň.',
  ), 200);
  assert.equal(first.status, 'ok');
  assert.equal(first.response.metadata?.effectId, undefined);
  const providerCallsBeforeTerminalReads = provider.requests.length;

  const read = await expect(server, 'POST', '/api/chat', command(
    own.conversationId, 'read-second', 'Přečti ten druhý soubor.',
  ), 200);
  assert.equal(read.status, 'ok');
  assert.equal(read.response.metadata?.handler, 'file.read');
  assert.equal(read.response.metadata?.approvalRequired, true);
  assert.equal(read.response.metadata?.filePath, 'beta.md');
  assert.match(read.response.metadata?.effectId || '', /^effect:[a-f0-9]{64}$/u);
  assert.doesNotMatch(read.response.content, /DRUHY_SOUBOR_752|FIRST_FILE_SHOULD_STAY_PRIVATE/u);

  const approved = await expect(server, 'POST', '/api/chat', command(
    own.conversationId, 'approve-second-read', `schválit efekt ${read.response.metadata.effectId}`,
  ), 200);
  assert.equal(approved.status, 'ok');
  assert.match(approved.response.content, /DRUHY_SOUBOR_752/u);
  assert.doesNotMatch(approved.response.content, /FIRST_FILE_SHOULD_STAY_PRIVATE/u);

  const listing = await expect(server, 'POST', '/api/chat', command(
    own.conversationId, 'list-project', 'Vypiš obsah projektu.',
  ), 200);
  assert.equal(listing.status, 'ok');
  assert.equal(listing.response.metadata?.approvalRequired, true);
  assert.match(listing.response.metadata?.effectId || '', /^effect:[a-f0-9]{64}$/u);
  const approvedList = await expect(server, 'POST', '/api/chat', command(
    own.conversationId, 'approve-list', `schválit efekt ${listing.response.metadata.effectId}`,
  ), 200);
  assert.equal(approvedList.status, 'ok');
  assert.match(approvedList.response.content, /alpha\.md/u);
  assert.match(approvedList.response.content, /beta\.md/u);
  assert.doesNotMatch(approvedList.response.content, /DRUHY_SOUBOR_752/u,
    'a directory listing must not disclose file bytes');
  assert.equal(provider.requests.length, providerCallsBeforeTerminalReads,
    'the read, its approval and the listing must use the exact M2 authority without model fallback');

  const sqlite = new Database(isolatedTestRuntime.database, { readonly: true, fileMustExist: true });
  try {
    const row = sqlite.prepare('SELECT request_json FROM m2_effect_requests WHERE effect_id = ?')
      .get(read.response.metadata.effectId);
    assert(row, 'the read proposal must be durable');
    const effect = JSON.parse(row.request_json);
    assert.equal(effect.kind, 'fs.read');
    assert.equal(effect.target.canonicalRoot, own.path);
    assert.equal(effect.target.relativePath, 'beta.md');
    const storedAssistantTexts = sqlite.prepare(`
      SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id
    `).all(own.conversationId).map(row => row.content);
    assert(storedAssistantTexts.some(content => content.includes('DRUHY_SOUBOR_752')),
      'the verified read content must survive in the actual conversation history');
    const before = sqlite.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n;
    const fresh = await project(server, 'ordinal-unbound', 'ORDINAL_B_752');
    const unsupported = await expect(server, 'POST', '/api/chat', command(
      fresh.conversationId, 'read-without-anchor', 'Přečti ten druhý soubor.',
    ), 200);
    assert.equal(unsupported.status, 'ok');
    assert.notEqual(unsupported.response.metadata?.approvalRequired, true);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n, before,
      'unbound ordinal must not create an effect');
    for (const [label, source] of [
      ['three-files', 'Napiš větu o souborech alpha.md, beta.md a gamma.md v tomto pořadí.'],
      ['qualified-paths', 'Napiš jednu větu, která uvádí soubory docs/alpha.md a docs/beta.md v tomto pořadí.'],
      ['invalid-example', 'To byl jen neplatný příklad: soubory alpha.md a beta.md v tomto pořadí vůbec nejsou můj seznam. Nic nečti ani neměň.'],
      ['quoted-example', 'Cituj jen příklad „soubory alpha.md a beta.md v tomto pořadí“, nikoli můj seznam.'],
    ]) {
      const ambiguous = await project(server, label, `ORDINAL_${label}`);
      await expect(server, 'POST', '/api/chat', command(ambiguous.conversationId, `${label}-source`, source), 200);
      const unresolved = await expect(server, 'POST', '/api/chat', command(
        ambiguous.conversationId, `${label}-read`, 'Přečti ten druhý soubor.',
      ), 200);
      assert.notEqual(unresolved.response.metadata?.approvalRequired, true, label);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n, before,
        `${label} must not silently select a basename or a value from an ambiguous list`);
    }
  } finally {
    sqlite.close();
  }
});

test('review mutants: negation, quotation, stale reference and cross-project approval never disclose project bytes', {
  timeout: 180_000,
}, async t => {
  const provider = await startProvider();
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await provider.close();
  });
  server = await startServer(provider.url);
  const sqlite = new Database(isolatedTestRuntime.database, { readonly: true, fileMustExist: true });
  t.after(() => sqlite.close());
  const count = () => sqlite.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n;
  const source = 'Napiš jednu větu, která uvádí soubory alpha.md a beta.md v tomto pořadí. Nic nečti ani neměň.';

  const projectA = await project(server, 'review-cross-a', 'REVIEW_CROSS_A');
  writeFileSync(`${projectA.path}/alpha.md`, 'REVIEW_FIRST_PRIVATE');
  writeFileSync(`${projectA.path}/beta.md`, 'REVIEW_SECOND_PRIVATE');
  await expect(server, 'POST', '/api/chat', command(projectA.conversationId, 'cross-source', source), 200);
  const preview = await expect(server, 'POST', '/api/chat', command(projectA.conversationId, 'cross-read', 'Přečti ten druhý soubor.'), 200);
  assert.equal(preview.response.metadata?.filePath, 'beta.md');
  assert.equal(preview.response.metadata?.approvalRequired, true);
  const projectB = await project(server, 'review-cross-b', 'REVIEW_CROSS_B');
  const rejected = await requestJson(server, 'POST', '/api/chat', command(projectB.conversationId, 'cross-approve', `schválit efekt ${preview.response.metadata.effectId}`));
  assert.doesNotMatch(JSON.stringify(rejected.data), /REVIEW_SECOND_PRIVATE|REVIEW_FIRST_PRIVATE/u);
  const ownerApproved = await expect(server, 'POST', '/api/chat', command(projectA.conversationId, 'own-approve', `schválit efekt ${preview.response.metadata.effectId}`), 200);
  assert.match(ownerApproved.response.content, /REVIEW_SECOND_PRIVATE/u);

  const cases = [
    ['invalid-example-tail', 'To byl jen příklad: soubory alpha.md a beta.md v tomto pořadí. Nejde o můj seznam.', 'Přečti ten druhý soubor.'],
    ['negated-list', 'Mám soubory alpha.md a beta.md v tomto pořadí, ale tento seznam neplatí.', 'Přečti ten druhý soubor.'],
    ['question-list', 'Mám soubory alpha.md a beta.md v tomto pořadí?', 'Přečti ten druhý soubor.'],
    ['condition-list', 'Mám soubory alpha.md a beta.md v tomto pořadí pouze pokud je ověříš.', 'Přečti ten druhý soubor.'],
    ['quoted-list', 'Napiš příklad „soubory alpha.md a beta.md v tomto pořadí“.', 'Přečti ten druhý soubor.'],
    ['negated-command', source, 'Nepřečti ten druhý soubor.'],
    ['quoted-command', source, 'Cituj jen větu „Přečti ten druhý soubor.“'],
    ['conditional-command', source, 'Přečti ten druhý soubor jen pokud je to moje schválená žádost.'],
  ];
  for (const [label, first, second] of cases) {
    const p = await project(server, `review-${label}`, `REVIEW_${label}`);
    writeFileSync(`${p.path}/alpha.md`, 'REVIEW_NEG_FIRST_PRIVATE');
    writeFileSync(`${p.path}/beta.md`, 'REVIEW_NEG_SECOND_PRIVATE');
    await expect(server, 'POST', '/api/chat', command(p.conversationId, `${label}-source`, first), 200);
    const before = count();
    const result = await expect(server, 'POST', '/api/chat', command(p.conversationId, `${label}-read`, second), 200);
    assert.equal(count(), before, `${label} created a durable effect: ${JSON.stringify(result.response.metadata)}`);
    assert.doesNotMatch(JSON.stringify(result.response), /REVIEW_NEG_(FIRST|SECOND)_PRIVATE/u, label);
  }
  const stale = await project(server, 'review-stale', 'REVIEW_STALE');
  await expect(server, 'POST', '/api/chat', command(stale.conversationId, 'stale-source', source), 200);
  await expect(server, 'POST', '/api/chat', command(stale.conversationId, 'stale-interim', 'Kolik je dvě plus dvě?'), 200);
  const before = count();
  const staleResult = await expect(server, 'POST', '/api/chat', command(stale.conversationId, 'stale-read', 'Přečti ten druhý soubor.'), 200);
  assert.equal(count(), before, `stale reference created a durable effect: ${JSON.stringify(staleResult.response.metadata)}`);
});

test('review mutant: conversation project reassignment must not carry ordinal file authority', {
  timeout: 120_000,
}, async t => {
  const provider = await startProvider();
  let server = null;
  t.after(async () => {
    if (server) await stopServer(server);
    await provider.close();
  });
  server = await startServer(provider.url);
  const a = await project(server, 'review-reassign-a', 'REVIEW_REASSIGN_A');
  const b = await project(server, 'review-reassign-b', 'REVIEW_REASSIGN_B');
  writeFileSync(`${a.path}/alpha.md`, 'A_FIRST');
  writeFileSync(`${a.path}/beta.md`, 'A_SECOND');
  writeFileSync(`${b.path}/alpha.md`, 'B_FIRST');
  writeFileSync(`${b.path}/beta.md`, 'B_SECOND_PRIVATE');
  const source = 'Napiš jednu větu, která uvádí soubory alpha.md a beta.md v tomto pořadí. Nic nečti ani neměň.';
  await expect(server, 'POST', '/api/chat', command(a.conversationId, 'reassign-source', source), 200);
  await expect(server, 'PUT', `/api/conversations/${encodeURIComponent(a.conversationId)}`, { project_id: b.id }, 200);
  const read = await expect(server, 'POST', '/api/chat', command(a.conversationId, 'reassign-read', 'Přečti ten druhý soubor.'), 200);
  if (read.response.metadata?.approvalRequired === true) {
    const approved = await expect(server, 'POST', '/api/chat', command(a.conversationId,
      'reassign-approve', `schválit efekt ${read.response.metadata.effectId}`), 200);
    assert.match(approved.response.content, /B_SECOND_PRIVATE/u,
      'the misresolved B target is actually disclosed after explicit approval');
    assert.doesNotMatch(approved.response.content, /A_SECOND/u);
  }
  assert.notEqual(read.response.metadata?.approvalRequired, true,
    `older A-context must not resolve to a private B read: ${JSON.stringify(read.response.metadata)}`);
});
