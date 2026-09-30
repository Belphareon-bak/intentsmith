// Shared M1 HTTP journey for a fake provider and an opt-in captured local model.
// The caller owns the isolated runtime, provider, product process and cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const JOURNEY = Object.freeze({
  a: Object.freeze({ label: 'a', file: 'README-A.md', canary: 'ORION_A_FILE_391',
    expertise: 'developer', weight: 0.7, rule: 'Piš čistý, čitelný kód' }),
  b: Object.freeze({ label: 'b', file: 'README-B.md', canary: 'LYRA_B_FILE_752',
    expertise: 'writer', weight: 0.8,
    rule: 'Udržuj konzistenci postav a světa napříč celým textem' }),
});

const children = new Set();
process.once('exit', () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});

// A registered suite runner may already own a server and database in the
// parent runtime. Every journey that starts its own product needs a separate
// child runtime so both model-binding baselines remain independent.
export function createOwnedJourneyRuntime(parent) {
  const root = mkdtempSync(path.join(parent.artifacts, 'm1-journey-'));
  const directories = Object.fromEntries([
    'home', 'temp', 'projects', 'artifacts', 'runtime',
    'xdgConfig', 'xdgCache', 'xdgData', 'xdgState', 'npmCache',
  ].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(directories)) mkdirSync(directory, { mode: 0o700 });
  return Object.freeze({ ...directories, root,
    repositoryRoot: parent.repositoryRoot,
    database: path.join(directories.runtime, 'c3.db'),
    portFile: path.join(directories.runtime, 'server.port'),
  });
}

export function productEnvironment(runtime, providerUrl, model, nonce) {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
    HOME: runtime.home, XDG_CONFIG_HOME: runtime.xdgConfig, XDG_CACHE_HOME: runtime.xdgCache,
    XDG_DATA_HOME: runtime.xdgData, XDG_STATE_HOME: runtime.xdgState,
    TMPDIR: runtime.temp, TMP: runtime.temp, TEMP: runtime.temp,
    npm_config_cache: runtime.npmCache, NODE_ENV: 'test', CI: '1', NO_COLOR: '1',
    DOTENV_CONFIG_PATH: `${runtime.runtime}/no-dotenv-file`, DOTENV_CONFIG_QUIET: 'true',
    INTENTSMITH_HOST: '127.0.0.1', INTENTSMITH_PORT: '0',
    INTENTSMITH_PORT_FILE: runtime.portFile, INTENTSMITH_DB_PATH: runtime.database,
    INTENTSMITH_PROJECTS_DIR: runtime.projects, INTENTSMITH_TEST_PROJECTS_DIR: runtime.projects,
    INTENTSMITH_TEST_ARTIFACT_DIR: runtime.artifacts, INTENTSMITH_TEST_SERVER_NONCE: nonce,
    INTENTSMITH_ENABLE_AGENTS: 'false', INTENTSMITH_ENABLE_LIFECYCLE: 'false',
    INTENTSMITH_ENABLE_COMFYUI: 'false', INTENTSMITH_ENABLE_AUTONOMY: 'false',
    INTENTSMITH_ENABLE_SKILLS: 'false', INTENTSMITH_ENABLE_TELEMETRY: 'false',
    INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false', INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false',
    INTENTSMITH_LOG_LEVEL: 'warn', INTENTSMITH_MODEL_D1: model, INTENTSMITH_MODEL_D2: model,
    INTENTSMITH_MODEL_CODE: model, INTENTSMITH_MODEL_R1: model, INTENTSMITH_MODEL_R2: model,
    INTENTSMITH_MODEL_CHAT: model, INTENTSMITH_MODEL_VISION: model, OLLAMA_URL: providerUrl,
  };
}

export async function startProduct(runtime, providerUrl, model,
  { enableAgents = false, productionAdminToken = null } = {}) {
  const nonce = randomBytes(32).toString('base64url');
  if (existsSync(runtime.portFile)) unlinkSync(runtime.portFile);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: runtime.repositoryRoot,
    env: { ...productEnvironment(runtime, providerUrl, model, nonce),
      ...(enableAgents ? { INTENTSMITH_ENABLE_AGENTS: 'true' } : {}),
      ...(productionAdminToken ? { NODE_ENV: 'production',
        INTENTSMITH_ADMIN_TOKEN: productionAdminToken } : {}) },
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
  child.once('error', error => {
    state.code = -1;
    state.output = `${state.output}\nSpawn error: ${error.message}`;
    children.delete(child);
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

export async function stopProduct(state) {
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

export async function requestJson(server, method, route, body = null) {
  const response = await fetch(`http://127.0.0.1:${server.port}${route}`, {
    method, headers: {
      'X-IntentSmith-Local-Capability': server.capability,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    }, body: body === null ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${method} ${route}: non-JSON ${response.status}: ${raw.slice(0, 300)}`); }
  return { status: response.status, data };
}

export async function expectJson(server, method, route, body, status) {
  const result = await requestJson(server, method, route, body);
  assert.equal(result.status, status, `${method} ${route}: ${JSON.stringify(result.data).slice(0, 500)}`);
  return result.data;
}

async function createProjectConversation(server, runtime, fixture) {
  const name = `expertise-model-${fixture.label}-${randomBytes(4).toString('hex')}`;
  const folder = path.join(runtime.projects, name);
  mkdirSync(folder, { mode: 0o700 });
  const source = `# ${name}\n\nProjektový kontrolní kód: ${fixture.canary}.\nTento soubor je jediný zdroj kódu pro projekt ${fixture.label.toUpperCase()}.\n`;
  writeFileSync(path.join(folder, fixture.file), source, { mode: 0o600 });
  const imported = await expectJson(server, 'POST', '/api/projects/open-folder', {
    folderPath: folder, name,
  }, 201);
  assert.equal(imported.project.path, folder);
  assert.equal(imported.project.is_external, 1);
  assert(imported.analysis?.excerpts?.some(item => item.path === fixture.file && item.text === source),
    'project inspection must read the distinct owned file');
  const conversation = await expectJson(server, 'POST', '/api/conversations', {
    title: `${name}-chat`, project_id: imported.project.id, mode: 'chat',
  }, 201);
  const id = conversation.conversation?.id;
  assert.equal(typeof id, 'string');
  const route = `/api/conversations/${id}/expertises`;
  const current = await expectJson(server, 'GET', route, null, 200);
  assert.deepEqual(current.expertises, []);
  const selected = await expectJson(server, 'PUT', route, {
    projectId: imported.project.id, expectedRevision: current.revision,
    expertises: [{ id: fixture.expertise, weight: fixture.weight }],
  }, 200);
  assert.deepEqual(selected.expertises, [{ id: fixture.expertise, weight: fixture.weight }]);
  return { ...fixture, id: imported.project.id, conversationId: id, source,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    selectionRevision: selected.revision };
}

export async function prepareJourney(server, runtime) {
  const a = await createProjectConversation(server, runtime, JOURNEY.a);
  const b = await createProjectConversation(server, runtime, JOURNEY.b);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.conversationId, b.conversationId);
  return { a, b };
}

export function journeySteps(a, b) {
  return [
    { label: 'a-first', own: a, foreign: b,
      input: `Jaký je stav projektu? Uveď přesný projektový kontrolní kód z ${a.file} a jednu vývojářskou prioritu.` },
    { label: 'b-first', own: b, foreign: a,
      input: `Jaký je stav projektu? Uveď přesný projektový kontrolní kód z ${b.file} a jednu prioritu pro autora textu.` },
    { label: 'a-return', own: a, foreign: b,
      input: `Jaký je stav projektu? Zopakuj přesný projektový kontrolní kód z ${a.file} a vývojářské hledisko.` },
  ];
}

export function makeM1Command(conversationId, label, input) {
  return { contract: 'ConversationCommand', version: 1,
    requestId: `expertise-live-${label}-${randomBytes(5).toString('hex')}`,
    conversationId, turnId: `expertise-live-turn-${label}-${randomBytes(5).toString('hex')}`,
    action: 'send', input };
}

export function assertFinalTurn(request, result, { own, foreign, input, label }) {
  assert.equal(result.status, 'ok');
  assert.equal(result.response?.metadata?.handler, 'project.collaboration');
  assert.deepEqual(result.response.metadata.expertiseIds, [own.expertise]);
  assert.equal(typeof result.response.content, 'string');
  assert(result.response.content.includes(own.canary), `${label}: own code missing in M1 response`);
  assert(!result.response.content.includes(foreign.canary), `${label}: foreign code in M1 response`);
  assert.equal(request.stream, false);
  assert(Array.isArray(request.messages) && request.messages.length >= 2);
  const userMessage = request.messages.at(-1);
  assert.equal(userMessage.role, 'user');
  const prompt = JSON.parse(userMessage.content);
  assert.equal(prompt.request, input);
  assert.equal(prompt.project.id, own.id);
  assert.equal(prompt.project.description?.includes(own.canary), false,
    'file-derived code must not be smuggled through project description');
  assert.equal(input.includes(own.canary), false);
  assert.equal(input.includes(foreign.canary), false);
  assert.equal(prompt.analysis.excerpts.find(item => item.path === own.file)?.text, own.source,
    `${label}: exact source file bytes must reach the final provider request`);
  const wire = JSON.stringify(request.messages);
  assert(wire.includes(own.canary), `${label}: own code missing in final provider request`);
  assert(!wire.includes(foreign.canary), `${label}: foreign code in final provider request`);
  assert(!wire.includes(foreign.file), `${label}: foreign file path in final provider request`);
  assert(prompt.expertiseGuidance?.includes(own.rule), `${label}: own expertise rule missing`);
  assert(!prompt.expertiseGuidance.includes(foreign.rule), `${label}: foreign expertise rule present`);
  return prompt;
}

export async function assertDurableJourney(server, a, b) {
  for (const [fixture, expectedCount, foreign] of [[a, 4, b], [b, 2, a]]) {
    const data = await expectJson(server, 'GET',
      `/api/conversations/${fixture.conversationId}/messages`, null, 200);
    assert(Array.isArray(data.messages), 'durable conversation messages missing');
    assert.equal(data.messages.length, expectedCount);
    const answers = data.messages.filter(message => message.role === 'assistant');
    assert.equal(answers.length, expectedCount / 2, 'durable assistant turn count mismatch');
    for (const answer of answers) {
      assert(String(answer.content || '').includes(fixture.canary),
        'own code missing from a durable answer');
    }
    const combined = data.messages.map(message => String(message.content || '')).join('\n');
    assert(combined.includes(fixture.canary), 'own code missing from durable answer history');
    assert(!combined.includes(foreign.canary), 'foreign code leaked into durable history');
  }
}
