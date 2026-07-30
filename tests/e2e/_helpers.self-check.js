// Deterministic registry self-check for tests/e2e/_helpers.js.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isolatedTestRuntime } from '../helpers/isolated-test-db.js';

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function mode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

async function expectRejection(action, expectedMessage, label) {
  let actualMessage = null;
  try {
    await action();
  } catch (error) {
    actualMessage = error.message;
  }
  ensure(actualMessage === expectedMessage, `${label}: ${String(actualMessage)}`);
}

function childImport(envOverrides) {
  const env = {
    ...process.env,
    C3_AUDIT_RUN: '1',
    ...envOverrides,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const h = await import('./tests/e2e/_helpers.js'); console.log(h.BASE_URL);",
    ],
    {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
      env,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const runRoot = fs.mkdtempSync(
  path.join(isolatedTestRuntime.temp, 'intentsmith-helpers-check-'),
);
const artifactRoot = fs.mkdtempSync(
  path.join(isolatedTestRuntime.artifacts, 'helpers-check-'),
);
const artifactNpmCache = path.join(artifactRoot, 'npm-cache');
const legacyTranscript = path.join(runRoot, 'legacy-transcript.md');
let server;
const conversationFixtures = [
  { status: 200, data: { ok: true } },
  { status: 500, data: { error: 'fixture failure' } },
  { status: 201, data: { conversation: { id: 'nested-conversation-id' } } },
  { status: 200, data: { ok: true } },
  { status: 500, data: { error: 'fixture failure' } },
  { status: 201, data: { id: 'project-conversation-id' } },
];
const chatFixtures = [
  { status: 202, data: { response: 'queued chat response' } },
  { status: 200, data: { response: '   ' } },
  { status: 200, data: { response: 'chat-in-conv-response' } },
  { status: 202, data: { response: 'queued timeout response' } },
  { status: 200, data: { response: '   ' } },
  { status: 200, data: { response: 'chat-with-timeout-response' } },
];
const chatBodies = [];

try {
  fs.mkdirSync(artifactNpmCache, { recursive: true, mode: 0o700 });
  fs.chmodSync(artifactRoot, 0o700);
  fs.chmodSync(artifactNpmCache, 0o700);

  server = http.createServer((request, response) => {
    if (request.url === '/slow') return;
    if (request.method === 'POST' && request.url === '/api/chat') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => {
        body += chunk;
      });
      request.on('end', () => {
        chatBodies.push(JSON.parse(body));
        const fixture = chatFixtures.shift() || {
          status: 500,
          data: { error: 'unexpected fixture call' },
        };
        response.writeHead(fixture.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(fixture.data));
      });
      return;
    }
    const fixtureQueue = request.method === 'POST' && request.url === '/api/conversations'
      ? conversationFixtures
      : null;
    if (fixtureQueue) {
      const fixture = fixtureQueue.shift() || {
        status: 500,
        data: { error: 'unexpected fixture call' },
      };
      response.writeHead(fixture.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(fixture.data));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;
  process.env.C3_URL = `http://127.0.0.1:${port}`;
  process.env.C3_TRANSCRIPT = legacyTranscript;
  process.env.INTENTSMITH_TEST_ARTIFACT_DIR = artifactRoot;
  process.env.npm_config_cache = artifactNpmCache;
  process.env.INTENTSMITH_TEST_REQUEST_TIMEOUT_MS = '100';
  process.env.INTENTSMITH_TEST_SUITE_ID = 'helpers-self-check';
  process.env.INTENTSMITH_TEST_SOURCE_REVISION = 'a'.repeat(40);
  process.env.E2E_GPU_COOLDOWN = '0';

  ensure(mode(artifactNpmCache) === 0o700, 'nested npm cache mode is not 0700');
  const helpers = await import('./_helpers.js');
  ensure(helpers.BASE_URL === process.env.C3_URL, 'C3_URL was not preserved');
  ensure(
    helpers.WS_URL === `ws://127.0.0.1:${port}/c3/ws`,
    'WebSocket URL did not use the runner-owned port',
  );
  ensure(typeof WebSocket.prototype.on === 'function', 'Node WebSocket compatibility API missing');

  const json = await helpers.api('GET', '/api/health');
  ensure(json.status === 200 && json.data.ok === true, 'buffered JSON request failed');
  const raw = await helpers.apiRaw('GET', '/raw');
  ensure(raw.status === 200, 'buffered raw request lost status');
  ensure((await raw.json()).path === '/raw', 'buffered raw request lost body');

  await expectRejection(
    () => helpers.createConv('missing-id-fixture'),
    'createConv failed: 200 response did not contain a conversation id',
    'createConv accepted a successful response without an ID',
  );
  await expectRejection(
    () => helpers.createConv('server-error-fixture'),
    'createConv failed: 500',
    'createConv accepted HTTP 500',
  );
  ensure(
    await helpers.createConv('nested-id-fixture') === 'nested-conversation-id',
    'createConv rejected a valid nested conversation id',
  );
  await expectRejection(
    () => helpers.createProjectConv('project-fixture', 'missing-project-id-fixture'),
    'createProjectConv failed: 200 response did not contain a conversation id',
    'createProjectConv accepted a successful response without an ID',
  );
  await expectRejection(
    () => helpers.createProjectConv('project-fixture', 'server-error-fixture'),
    'createProjectConv failed: 500',
    'createProjectConv accepted HTTP 500',
  );
  ensure(
    await helpers.createProjectConv('project-fixture', 'valid-project-fixture')
      === 'project-conversation-id',
    'createProjectConv rejected a valid top-level conversation ID',
  );

  await expectRejection(
    () => helpers.chatInConv('fixture-conversation', 'queued status'),
    'chatInConv failed: 202',
    'chatInConv accepted HTTP 202',
  );
  await expectRejection(
    () => helpers.chatInConv('fixture-conversation', 'empty response'),
    'chatInConv failed: 200 response did not contain a non-empty response',
    'chatInConv accepted a whitespace-only response',
  );
  const chatResult = await helpers.chatInConv('fixture-conversation', 'valid response');
  ensure(
    chatResult.status === 200 && chatResult.response === 'chat-in-conv-response',
    'chatInConv rejected a valid exact-200 response',
  );

  await expectRejection(
    () => helpers.chatWithTimeout('fixture-conversation', 'queued status', 1_000),
    'chatWithTimeout failed: 202',
    'chatWithTimeout accepted HTTP 202',
  );
  await expectRejection(
    () => helpers.chatWithTimeout('fixture-conversation', 'empty response', 1_000),
    'chatWithTimeout failed: 200 response did not contain a non-empty response',
    'chatWithTimeout accepted a whitespace-only response',
  );
  const timeoutChatResult = await helpers.chatWithTimeout(
    'fixture-conversation',
    'valid response',
    1_000,
    { expertise_id: 'developer', conversation_id: 'cannot-override' },
  );
  ensure(
    timeoutChatResult.status === 200
      && timeoutChatResult.response === 'chat-with-timeout-response',
    'chatWithTimeout rejected a valid exact-200 response',
  );
  ensure(
    chatBodies.at(-1)?.expertise_id === 'developer'
      && chatBodies.at(-1)?.conversation_id === 'fixture-conversation',
    'chatWithTimeout did not forward safe options or allowed conversation override',
  );
  ensure(
    conversationFixtures.length === 0 && chatFixtures.length === 0,
    'not every fail-closed helper fixture was exercised',
  );

  let escapedOriginRejected = false;
  try {
    await helpers.api('GET', '//127.0.0.1:1/escape');
  } catch {
    escapedOriginRejected = true;
  }
  ensure(escapedOriginRejected, 'same-origin API boundary accepted an authority override');

  const timeoutStarted = Date.now();
  let timedOut = false;
  try {
    await helpers.apiRaw('GET', '/slow');
  } catch (error) {
    timedOut = error?.name === 'TimeoutError';
  }
  ensure(timedOut, 'request did not terminate through its bounded AbortController');
  ensure(Date.now() - timeoutStarted < 2000, 'bounded request timeout leaked or fired too late');

  helpers.transcriptSection('Private transcript');
  const transcriptDir = path.join(artifactRoot, 'transcripts');
  const transcriptPath = path.join(transcriptDir, 'helpers-self-check.md');
  ensure(fs.existsSync(transcriptPath), 'private transcript was not written');
  ensure(!fs.existsSync(legacyTranscript), 'legacy C3_TRANSCRIPT path was used');
  ensure(mode(transcriptDir) === 0o700, 'transcript directory mode is not 0700');
  ensure(mode(transcriptPath) === 0o600, 'transcript file mode is not 0600');

  const ownedTemp = helpers.makeOwnedTempDir('owned-fixture');
  ensure(mode(ownedTemp) === 0o700, 'owned temporary directory mode is not 0700');
  fs.writeFileSync(path.join(ownedTemp, 'fixture.txt'), 'owned');
  ensure(helpers.removeOwnedTempDir(ownedTemp) === true, 'owned temp removal did not run');
  ensure(!fs.existsSync(ownedTemp), 'owned temporary directory survived cleanup');

  let arbitraryRemovalRejected = false;
  try {
    helpers.removeOwnedTempDir(runRoot);
  } catch {
    arbitraryRemovalRejected = true;
  }
  ensure(arbitraryRemovalRejected, 'arbitrary recursive removal was accepted');

  const quality = await import('./_quality-evaluator.js');
  ensure(quality.checkJsSyntax('const valid = true;\n').ok, 'valid JS syntax was rejected');
  ensure(!quality.checkJsSyntax('const = broken;\n').ok, 'invalid JS syntax was accepted');
  ensure(
    fs.readdirSync(path.join(artifactRoot, 'tmp')).length === 0,
    'quality evaluator left a syntax fixture in the runner-owned temp root',
  );

  const stateStore = await import('./_e2e-state.js');
  const state = stateStore.initState('state-self-check');
  ensure(state.sourceRevision === 'a'.repeat(40), 'state did not bind the source SHA');

  delete process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  let missingRevisionRejected = false;
  try {
    stateStore.loadState('state-self-check');
  } catch (error) {
    missingRevisionRejected = error.message.includes('exact 40-character source SHA');
  }
  ensure(missingRevisionRejected, 'state accepted a missing source SHA');
  process.env.INTENTSMITH_TEST_SOURCE_REVISION = 'a'.repeat(40);

  for (const [label, mutation, expectedMessage] of [
    ['schema', value => { value.schemaVersion = 999; }, 'Unsupported E2E state schema'],
    ['suite', value => { value.suiteId = 'other-suite'; }, 'state suite mismatch'],
    ['source', value => { value.sourceRevision = 'c'.repeat(40); }, 'source revision mismatch'],
  ]) {
    const invalidState = structuredClone(state);
    mutation(invalidState);
    let invalidStateRejected = false;
    try {
      stateStore.saveState('state-self-check', invalidState);
    } catch (error) {
      invalidStateRejected = error.message.includes(expectedMessage);
    }
    ensure(invalidStateRejected, `state accepted a mismatched ${label}`);
  }

  state.phases.p2 = { completed: true };
  let nonContiguousPhaseRejected = false;
  try {
    stateStore.saveState('state-self-check', state);
  } catch (error) {
    nonContiguousPhaseRejected = error.message.includes('phase chain is not contiguous');
  }
  ensure(nonContiguousPhaseRejected, 'state accepted a non-contiguous completed phase');
  delete state.phases.p2;
  state.phases.p1 = { completed: true };
  stateStore.saveState('state-self-check', state);
  ensure(stateStore.isPhaseComplete('state-self-check', 1), 'completed phase was not persisted');

  process.env.INTENTSMITH_TEST_SOURCE_REVISION = 'b'.repeat(40);
  let staleRevisionRejected = false;
  try {
    stateStore.loadState('state-self-check');
  } catch (error) {
    staleRevisionRejected = error.message.includes('source revision mismatch');
  }
  ensure(staleRevisionRejected, 'state from another source SHA was accepted');
  process.env.INTENTSMITH_TEST_SOURCE_REVISION = 'a'.repeat(40);

  const statePath = path.join(artifactRoot, 'e2e-state', 'state-self-check.json');
  fs.writeFileSync(statePath, '{broken', { mode: 0o600 });
  let corruptStateRejected = false;
  try {
    stateStore.loadState('state-self-check');
  } catch (error) {
    corruptStateRejected = error.message.includes('Corrupt E2E state JSON');
  }
  ensure(corruptStateRejected, 'corrupt state was silently treated as absent');
  stateStore.cleanupAllStates();

  for (const contract of [
    ['200-s1-minic3-p1.e2e.js', 'p1', 'assert(avgResponseLength > 200'],
    ['201-s1-minic3-p2.e2e.js', 'p2', 'assert(codeScore >= 30'],
    ['202-s1-minic3-p3.e2e.js', 'p3', 'assert(codeScore >= 30'],
    ['203-s1-minic3-p4.e2e.js', 'p4', 'assert(codeScore >= 30'],
    ['204-s1-minic3-p5.e2e.js', 'p5', 'assert(testScore >= 30'],
    ['205-s1-minic3-p6.e2e.js', 'p6', 'assert(passCount >= 4'],
    ['206-s2-shopflow-p1.e2e.js', 'p1', 'assert(searchUsedCount >= 1'],
    ['207-s2-shopflow-p2.e2e.js', 'p2', 'assert(codeScore >= 30'],
    ['208-s2-shopflow-p3.e2e.js', 'p3', 'assert(codeScore >= 30'],
    ['209-s2-shopflow-p4.e2e.js', 'p4', 'assert(avgTemplateScore >= 30'],
    ['210-s2-shopflow-p5.e2e.js', 'p5', 'assert(testScore >= 30'],
    ['211-s2-shopflow-p6.e2e.js', 'p6', 'assert(passCount >= 4'],
  ]) {
    const [file, phase, terminalAssertion] = contract;
    const source = fs.readFileSync(path.join(repoRoot, 'tests', 'e2e', file), 'utf8');
    const assertionIndex = source.lastIndexOf(terminalAssertion);
    const mutationIndex = source.lastIndexOf(`state.phases.${phase} =`);
    const saveIndex = source.lastIndexOf('saveState(SUITE_ID, state)');
    ensure(assertionIndex >= 0, `${file} lost its terminal assertion`);
    ensure(mutationIndex > assertionIndex, `${file} persisted completion before final assertion`);
    ensure(saveIndex > mutationIndex, `${file} saved state before recording completion`);

    if (phase === 'p6') {
      const finallyIndex = source.indexOf('} finally {', assertionIndex);
      const conversationCleanupIndex = source.indexOf(
        'await cleanupConversation(convId)',
        finallyIndex,
      );
      const projectCleanupIndex = source.indexOf(
        'await cleanupProject(state.projectId)',
        conversationCleanupIndex,
      );
      ensure(finallyIndex > assertionIndex, `${file} cleanup is not protected by finally`);
      ensure(
        projectCleanupIndex > conversationCleanupIndex && projectCleanupIndex < mutationIndex,
        `${file} cleanup must finish before successful completion is persisted`,
      );
    }
  }

  for (const invalidUrl of [
    'https://127.0.0.1:4443',
    'http://example.com:3335',
    'http://127.0.0.1:3335/nested',
  ]) {
    const child = childImport({
      C3_URL: invalidUrl,
    });
    ensure(child.status !== 0, `unsafe C3_URL was accepted: ${invalidUrl}`);
  }

  const portFile = path.join(artifactRoot, 'runner.port');
  fs.writeFileSync(portFile, JSON.stringify({
    port,
    host: '127.0.0.1',
    pid: process.pid,
  }), { mode: 0o600 });
  const fromPortFile = childImport({
    C3_URL: undefined,
    C3_PORT: '0',
    C3_PORT_FILE: portFile,
  });
  ensure(
    fromPortFile.status === 0 && fromPortFile.stdout.includes(`http://127.0.0.1:${port}`),
    `private port-file resolution failed: ${fromPortFile.stderr}`,
  );

  console.log('E2E helper self-check: PASS');
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.rmSync(artifactRoot, { recursive: true, force: true });
}
