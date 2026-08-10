#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  assert,
  assertEqual,
  assertIncludes,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  ModelFailoverMeasurementError,
  requireExactLoopbackProviderOrigin,
  validateModelFailoverMeasurementArtifact,
} from '../scripts/run-model-failover-measurement.js';
import {
  MODEL_FAILOVER_PROOF_HANDOFF_REASON,
  canonicalizeModelFailoverContract,
  getModelFailoverMeasurementContract,
} from '../src/upgrade/model-failover-proof-policy.js';

const REPOSITORY_ROOT = isolatedTestRuntime.repositoryRoot;
const RUNNER_PATH = path.join(REPOSITORY_ROOT, 'scripts/run-model-failover-measurement.js');
const MODEL_NAME = 'fixture-model:latest';
const MODEL_DIGEST = '7'.repeat(64);
const SOURCE_REVISION = '1'.repeat(40);
const CHILD_TIMEOUT_MS = 20_000;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;
const CHAT_TEST_IDS = [
  'czech_quality',
  'instruction_follow',
  'summarization',
  'topic_awareness',
  'tone_formal',
  'creative',
  'multilingual',
  'factual',
];
const REASONING_TEST_IDS = [
  'json_compliance',
  'logic_puzzle',
  'math_basic',
  'multi_step_plan',
  'cause_effect',
  'categorization',
  'instruction_follow',
  'czech_json',
];
const LONG_CREATIVE_RESPONSE = [
  'Robot Karel se v tiché kuchyni rozhodl naučit vařit polévku podle starého rodinného receptu a pečlivě si připravil zeleninu, koření i velký hrnec.',
  'Nejdřív mu mrkev padala na podlahu a cibuli krájel příliš pomalu, ale po každém pokusu upravil pohyb kovových prstů a zapisoval si, co fungovalo.',
  'Když se polévka začala vařit, Karel ochutnal výsledek elektronickým senzorem, přidal špetku soli a pozval všechny sousedy ke stolu.',
  'Od toho večera robot každý týden zkoušel nový recept, kuchyně voněla čerstvým jídlem a lidé se těšili, jaké překvapení pro ně zase připraví.',
].join(' ');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to throw');
}

async function captureRejection(callback) {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

function assertMeasurementError(error, expectedCode = null) {
  assert(
    error instanceof ModelFailoverMeasurementError,
    `Expected ModelFailoverMeasurementError, got ${error}`,
  );
  if (expectedCode !== null) assertEqual(error.code, expectedCode);
}

async function createArtifactRoot(prefix) {
  const root = await mkdtemp(path.join(isolatedTestRuntime.artifacts, `${prefix}-`));
  await chmod(root, 0o700);
  return root;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('Fixture request exceeded 1 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
}

function chatResponse(index) {
  return [
    'Praha má bohaté dějiny a krásné památky. Český král zde založil významné město. Návštěvníci dodnes obdivují její věže a náměstí.',
    'ne',
    'Umělá inteligence je obor informatiky, který vytváří systémy schopné řešit úkoly vyžadující lidskou inteligenci.',
    'Toto je první zpráva, takže jsme se ještě o ničem nebavili.',
    'Vážený pane řediteli, dovoluji si Vás požádat o schůzku k projednání školního projektu. Prosím o sdělení vhodného termínu. S úctou, Jan Novák.',
    LONG_CREATIVE_RESPONSE,
    'Hello, how are you?',
    'Shakespeare',
  ][index];
}

function reasoningResponse(index, requestBody) {
  if (index === 2) {
    const prompt = requestBody?.messages?.[0]?.content || '';
    const match = prompt.match(/Kolik je (\d+) × (\d+)\?/u);
    if (!match) throw new Error(`Unexpected randomized math prompt: ${prompt}`);
    return String(Number(match[1]) * Number(match[2]));
  }
  return [
    '{"name":"Karel","age":35,"hobbies":["čtení","běh"]}',
    'Cynthia',
    null,
    '["Sestavit aplikaci","Spustit testy","Vytvořit build","Nasadit službu","Ověřit provoz"]',
    'Voda se začne vařit a přeměňovat v páru.',
    '{"zvířata":["pes","kočka"],"ovoce":["jablko","hruška"],"doprava":["auto","kolo"]}',
    'Rakety létají vysoko. Astronauti pracují ve vesmíru. Družice obíhají Zemi.',
    '{"město":"Praha","obyvatel":1300000,"pamětihodnosti":["Pražský hrad"]}',
  ][index];
}

async function startFixtureProvider({
  role,
  failChatAt = null,
  invalidUtf8At = null,
  driftInventoryAfter = false,
} = {}) {
  const requests = [];
  let inventoryRequestCount = 0;
  let chatRequestCount = 0;
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/tags') {
        inventoryRequestCount++;
        requests.push({ route: 'GET /api/tags', body: null });
        const models = [{ name: MODEL_NAME, digest: `sha256:${MODEL_DIGEST}` }];
        if (driftInventoryAfter && inventoryRequestCount > 1) {
          models.push({ name: 'inventory-drift:latest', digest: `sha256:${'8'.repeat(64)}` });
        }
        sendJson(response, 200, { models });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/chat') {
        const index = chatRequestCount++;
        const body = await readJsonBody(request);
        requests.push({ route: 'POST /api/chat', body });
        if (failChatAt === index) {
          sendJson(response, 503, { error: 'fixture provider unavailable' });
          return;
        }
        if (invalidUtf8At === index) {
          const invalidBody = Buffer.concat([
            Buffer.from('{"message":{"role":"assistant","content":"', 'utf8'),
            Buffer.from([0xc3]),
            Buffer.from('"},"done":true}', 'utf8'),
          ]);
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': invalidBody.length,
          });
          response.end(invalidBody);
          return;
        }
        const content = role === 'D1'
          ? reasoningResponse(index, body)
          : chatResponse(index);
        sendJson(response, 200, {
          message: { role: 'assistant', content },
          done: true,
          eval_count: 7,
          prompt_eval_count: 3,
        });
        return;
      }
      requests.push({ route: `${request.method} ${requestUrl.pathname}`, body: null });
      sendJson(response, 404, { error: 'fixture route not found' });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
}

function collectBounded(stream, child, label) {
  const chunks = [];
  let total = 0;
  let overflow = null;
  stream.on('data', chunk => {
    if (overflow) return;
    total += chunk.length;
    if (total > MAX_CHILD_OUTPUT_BYTES) {
      overflow = new Error(`${label} exceeded ${MAX_CHILD_OUTPUT_BYTES} bytes`);
      child.kill('SIGKILL');
      return;
    }
    chunks.push(chunk);
  });
  return {
    value: () => Buffer.concat(chunks, total).toString('utf8'),
    overflow: () => overflow,
  };
}

async function runMeasurementChild({
  role,
  providerOrigin,
  artifactRoot,
  startupEnvironmentExtra = {},
  nodeExecArgv = [],
}) {
  return new Promise((resolve, reject) => {
    const args = [
      ...nodeExecArgv,
      RUNNER_PATH,
      '--role', role,
      '--model-name', MODEL_NAME,
      '--digest-sha256', MODEL_DIGEST,
      '--provider-origin', providerOrigin,
    ];
    const child = spawn(process.execPath, args, {
      cwd: REPOSITORY_ROOT,
      env: {
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        TZ: 'UTC',
        INTENTSMITH_TEST_ARTIFACT_DIR: artifactRoot,
        INTENTSMITH_TEST_SOURCE_REVISION: SOURCE_REVISION,
        ...startupEnvironmentExtra,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = collectBounded(child.stdout, child, 'measurement stdout');
    const stderr = collectBounded(child.stderr, child, 'measurement stderr');
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CHILD_TIMEOUT_MS);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const collectionError = stdout.overflow() || stderr.overflow();
      if (collectionError) {
        reject(collectionError);
        return;
      }
      if (timedOut) {
        reject(new Error(`Measurement child timed out after ${CHILD_TIMEOUT_MS}ms`));
        return;
      }
      resolve({ code, signal, stdout: stdout.value(), stderr: stderr.value(), args });
    });
  });
}

async function findMeasurementFiles(root) {
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === 'measurement.json') found.push(candidate);
    }
  }
  await visit(root);
  return found.sort();
}

function parseSuccessSummary(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  assertEqual(lines.length, 1, `Expected one stdout line, got ${stdout}`);
  return JSON.parse(lines[0]);
}

let chatArtifact = null;
let chatSummary = null;

suite('M1 model failover measurement — isolated role runner');

test('provider authority accepts only an exact IPv4 HTTP loopback origin', () => {
  assertEqual(
    requireExactLoopbackProviderOrigin('http://127.0.0.1:11434/'),
    'http://127.0.0.1:11434',
  );
  for (const invalid of [
    'https://127.0.0.1:11434',
    'http://localhost:11434',
    'http://[::1]:11434',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://user@127.0.0.1:11434',
    'http://127.0.0.1:11434/api',
    'http://127.0.0.1:11434?query=1',
    'http://127.0.0.1:11434#fragment',
    'http://192.0.2.10:11434',
  ]) {
    assertMeasurementError(
      captureError(() => requireExactLoopbackProviderOrigin(invalid)),
      'MODEL_MEASUREMENT_PROVIDER_INVALID',
    );
  }
});

test('runner static imports are Node-only and runtime authorities are an exact allowlist', () => {
  const source = readFileSyncCompat(RUNNER_PATH);
  const staticImports = [...source.matchAll(/^import\s+[\s\S]*?\sfrom\s+['"]([^'"]+)['"];$/gm)]
    .map(match => match[1]);
  const dynamicImports = [...source.matchAll(/import\(['"]([^'"]+)['"]\)/g)]
    .map(match => match[1]);
  assertEqual(JSON.stringify(staticImports), JSON.stringify([
    'node:crypto',
    'node:fs/promises',
    'node:path',
    'node:url',
  ]));
  assertEqual(JSON.stringify([...new Set(dynamicImports)].sort()), JSON.stringify([
    '../src/upgrade/model-failover-proof-policy.js',
    '../src/upgrade/model-identity.js',
    '../src/upgrade/validation-suites.js',
  ]));
  for (const forbidden of [
    "from '../src/db/",
    "from '../src/database",
    "import('../src/upgrade/model-registry.js')",
    "import('../src/upgrade/upgrade-manager.js')",
    "import('../src/server/ws-server.js')",
    'child_process',
    'worker_threads',
  ]) {
    assert(!source.includes(forbidden), `Runner contains prohibited authority: ${forbidden}`);
  }
  const writer = source.slice(
    source.indexOf('async function writeImmutableArtifact'),
    source.indexOf('async function writeSuccessSummary'),
  );
  const chmodPosition = writer.indexOf('await handle.chmod(0o400);');
  const fileSyncPosition = writer.indexOf('await handle.sync();');
  const linkPosition = writer.indexOf('await link(temporaryPath, finalPath);');
  const unlinkPosition = writer.indexOf('await unlink(temporaryPath);');
  const postLinkDirectorySync = writer.lastIndexOf('await syncDirectory(runDirectory);');
  assert(
    chmodPosition >= 0
      && fileSyncPosition > chmodPosition
      && linkPosition > fileSyncPosition
      && unlinkPosition > linkPosition
      && postLinkDirectorySync > unlinkPosition,
    'Artifact publication must fsync file metadata and final directory namespace in order',
  );
});

await testAsync('startup environment contamination is rejected before provider or artifact effects', async () => {
  const provider = await startFixtureProvider({ role: 'CHAT' });
  const artifactRoot = await createArtifactRoot('measurement-startup-env');
  try {
    for (const contamination of [
      {
        startupEnvironmentExtra: {
          NODE_OPTIONS: '--trace-warnings',
          OPENAI_API_KEY: 'must-not-survive',
        },
      },
      {
        nodeExecArgv: [
          '--import=data:text/javascript,globalThis.__measurementPreload%3Dtrue',
        ],
      },
    ]) {
      const result = await runMeasurementChild({
        role: 'CHAT',
        providerOrigin: provider.origin,
        artifactRoot,
        ...contamination,
      });
      assertEqual(result.code, 1);
      assertIncludes(result.stderr, 'MODEL_MEASUREMENT_STARTUP_ENVIRONMENT_INVALID');
    }
    assertEqual(provider.requests.length, 0);
    assertEqual((await findMeasurementFiles(artifactRoot)).length, 0);
  } finally {
    await provider.close();
  }
}, 60_000);

await testAsync('CHAT executes all eight ordered tests and publishes one full immutable non-proof artifact', async () => {
  const provider = await startFixtureProvider({ role: 'CHAT' });
  const artifactRoot = await createArtifactRoot('measurement-chat');
  try {
    const result = await runMeasurementChild({
      role: 'CHAT',
      providerOrigin: provider.origin,
      artifactRoot,
    });
    assertEqual(result.code, 0, result.stderr);
    assertEqual(result.signal, null);
    assertEqual(result.stderr, '');
    chatSummary = parseSuccessSummary(result.stdout);
    assertEqual(chatSummary.measurementStatus, 'COMPLETE');
    assertEqual(chatSummary.proofStatus, 'NOT_ISSUED');
    assertEqual(path.dirname(path.dirname(chatSummary.artifactPath)), artifactRoot);

    const files = await findMeasurementFiles(artifactRoot);
    assertEqual(files.length, 1);
    assertEqual(files[0], chatSummary.artifactPath);
    const metadata = await lstat(files[0]);
    assertEqual(metadata.isFile(), true);
    assertEqual(metadata.isSymbolicLink(), false);
    assertEqual(metadata.mode & 0o777, 0o400);
    assertEqual(metadata.nlink, 1);

    const persisted = await readFile(files[0], 'utf8');
    assert(!persisted.endsWith('\n'), 'Canonical artifact must not have a trailing newline');
    assertEqual(Buffer.byteLength(persisted), chatSummary.artifactByteLength);
    assertEqual(sha256(persisted), chatSummary.artifactSha256);
    chatArtifact = JSON.parse(persisted);
    assertEqual(persisted, canonicalizeModelFailoverContract(chatArtifact));
    assertEqual(chatArtifact.sourceRevisionClaim, SOURCE_REVISION);
    assert(chatArtifact.producer.pid !== process.pid, 'Measurement must execute in a fresh child');
    assertEqual(chatArtifact.measurementStatus, 'COMPLETE');
    assertEqual(chatArtifact.proofStatus, 'NOT_ISSUED');
    assertEqual(chatArtifact.proofIssued, false);
    assertEqual(chatArtifact.proofBlockReason, MODEL_FAILOVER_PROOF_HANDOFF_REASON);
    assertEqual(chatArtifact.proofBlockReason, 'SEPARATE_OPERATOR_PROOF_COMMIT_REQUIRED');
    assertEqual(chatArtifact.effectBoundary.proofIssuance, 'SEPARATE_OPERATOR_COMMIT_REQUIRED');
    assertEqual(Object.hasOwn(chatArtifact, 'proofId'), false);
    assertEqual(JSON.stringify(chatArtifact.results.map(resultEntry => resultEntry.testId)), JSON.stringify(CHAT_TEST_IDS));
    assertEqual(chatArtifact.results.length, 8);
    assertEqual(chatArtifact.aggregate.totalCount, 8);
    assertEqual(chatArtifact.aggregate.passedCount, 8);
    assertEqual(chatArtifact.provider.inventoryRequestCount, 2);
    assertEqual(chatArtifact.provider.chatRequestCount, 8);
    assertEqual(chatArtifact.results[5].response.content, LONG_CREATIVE_RESPONSE);
    assert(chatArtifact.results[5].response.content.length > 500);
    assertIncludes(chatArtifact.results[5].response.rawBody, LONG_CREATIVE_RESPONSE);
    assertEqual(chatArtifact.results[5].response.content.length, LONG_CREATIVE_RESPONSE.length);
    for (const resultEntry of chatArtifact.results) {
      assertEqual(resultEntry.passed, true);
      assertEqual(resultEntry.score, 1);
      assertEqual(resultEntry.response.evalCount, 7);
      assertEqual(resultEntry.response.promptEvalCount, 3);
    }
    assertEqual(
      JSON.stringify(chatArtifact.environment.activeKeys),
      JSON.stringify([
        'C3_ENABLE_AUTONOMY',
        'C3_ENABLE_COMFYUI',
        'C3_ENABLE_ONLINE_DISCOVERY',
        'HOME',
        'INTENTSMITH_TEST_SOURCE_REVISION',
        'LANG',
        'LC_ALL',
        'NODE_ENV',
        'TEMP',
        'TMP',
        'TMPDIR',
        'TZ',
        'XDG_CACHE_HOME',
        'XDG_CONFIG_HOME',
        'XDG_DATA_HOME',
        'XDG_STATE_HOME',
      ]),
    );
    assertEqual(chatArtifact.environment.activeKeys.includes('OPENAI_API_KEY'), false);
    assertEqual(chatArtifact.environment.activeKeys.includes('HTTPS_PROXY'), false);
    assertEqual(chatArtifact.environment.activeKeys.includes('INTENTSMITH_MEASUREMENT_ENV_CANARY'), false);
    assertEqual(
      JSON.stringify(chatArtifact.environment.startupKeys),
      JSON.stringify([
        'INTENTSMITH_TEST_ARTIFACT_DIR',
        'INTENTSMITH_TEST_SOURCE_REVISION',
        'LANG',
        'LC_ALL',
        'TZ',
      ]),
    );
    assertEqual(
      JSON.stringify(provider.requests.map(request => request.route)),
      JSON.stringify([
        'GET /api/tags',
        ...Array(8).fill('POST /api/chat'),
        'GET /api/tags',
      ]),
    );
    const contract = getModelFailoverMeasurementContract('CHAT').contract;
    for (const request of provider.requests.filter(entry => entry.body !== null)) {
      assertEqual(request.body.model, MODEL_NAME);
      assertEqual(request.body.stream, false);
      assertEqual(request.body.think, false);
      assertEqual(request.body.options.num_ctx, 4096);
      assertEqual(request.body.options.temperature, contract.runner.temperature);
      assertEqual(request.body.options.top_p, contract.runner.topP);
      assertEqual(request.body.options.num_predict, contract.runner.numPredict);
    }
    assertEqual(
      JSON.stringify(await validateModelFailoverMeasurementArtifact(chatArtifact, {
        role: 'CHAT',
        modelName: MODEL_NAME,
        digestSha256: MODEL_DIGEST,
        providerOrigin: provider.origin,
        sourceRevisionClaim: SOURCE_REVISION,
      })),
      JSON.stringify({
        valid: true,
        validationScope: 'PARENT_PINS_VERIFIED',
        measurementStatus: 'COMPLETE',
        proofStatus: 'NOT_ISSUED',
      }),
    );
    const structural = await validateModelFailoverMeasurementArtifact(chatArtifact);
    assertEqual(structural.validationScope, 'STRUCTURAL_ONLY');
  } finally {
    await provider.close();
  }
}, 60_000);

await testAsync('D1 captures the actual randomized math prompt and its exact grading context', async () => {
  const provider = await startFixtureProvider({ role: 'D1' });
  const artifactRoot = await createArtifactRoot('measurement-d1');
  try {
    const result = await runMeasurementChild({
      role: 'D1',
      providerOrigin: provider.origin,
      artifactRoot,
    });
    assertEqual(result.code, 0, result.stderr);
    const output = parseSuccessSummary(result.stdout);
    const artifact = JSON.parse(await readFile(output.artifactPath, 'utf8'));
    assertEqual(JSON.stringify(artifact.results.map(entry => entry.testId)), JSON.stringify(REASONING_TEST_IDS));
    assertEqual(artifact.aggregate.totalCount, 8);
    assertEqual(artifact.aggregate.passedCount, 8);
    const math = artifact.results.find(entry => entry.testId === 'math_basic');
    assert(math, 'Missing randomized math result');
    const prompt = math.request.body.messages[0].content;
    const operands = prompt.match(/Kolik je (\d+) × (\d+)\?/u);
    assert(operands, `Unexpected math prompt: ${prompt}`);
    const expected = String(Number(operands[1]) * Number(operands[2]));
    assertEqual(math.gradeContext._expected, expected);
    assertEqual(math.response.content, expected);
    assertEqual(math.passed, true);
    assertEqual(math.score, 1);
    const wireMath = provider.requests.filter(entry => entry.body !== null)[2];
    assertEqual(wireMath.body.messages[0].content, prompt);
    assertEqual(
      canonicalizeModelFailoverContract(wireMath.body),
      canonicalizeModelFailoverContract(math.request.body),
    );
  } finally {
    await provider.close();
  }
}, 60_000);

await testAsync('artifact validator rejects incompleteness, reordering, false scores and authority drift', async () => {
  assert(chatArtifact, 'CHAT fixture must be produced by the preceding test');
  const mutations = [
    ['missing result', artifact => { artifact.results.pop(); }],
    ['duplicate result', artifact => { artifact.results[1] = clone(artifact.results[0]); }],
    ['swapped results', artifact => {
      [artifact.results[0], artifact.results[1]] = [artifact.results[1], artifact.results[0]];
    }],
    ['non-finite score', artifact => { artifact.results[0].score = Number.NaN; }],
    ['non-boolean pass', artifact => { artifact.results[0].passed = 'true'; }],
    ['aggregate drift', artifact => { artifact.aggregate.passedCount = 0; }],
    ['inventory canonical-name forgery', artifact => {
      artifact.inventoryBefore.models[0].canonicalName = 'forged-model';
      artifact.inventoryBefore.sha256 = sha256(
        canonicalizeModelFailoverContract(artifact.inventoryBefore.models),
      );
    }],
    ['prompt forgery with matching request hash', artifact => {
      artifact.results[0].request.body.messages[0].content = 'Jiný prompt se stejným test ID.';
      artifact.results[0].request.sha256 = sha256(
        canonicalizeModelFailoverContract(artifact.results[0].request.body),
      );
    }],
    ['non-terminal provider response', artifact => {
      const payload = JSON.parse(artifact.results[0].response.rawBody);
      payload.done = false;
      artifact.results[0].response.rawBody = JSON.stringify(payload);
      artifact.results[0].response.sha256 = sha256(artifact.results[0].response.rawBody);
    }],
    ['non-assistant provider response', artifact => {
      const payload = JSON.parse(artifact.results[0].response.rawBody);
      payload.message.role = 'user';
      artifact.results[0].response.rawBody = JSON.stringify(payload);
      artifact.results[0].response.sha256 = sha256(artifact.results[0].response.rawBody);
    }],
    ['response counter forgery', artifact => { artifact.results[0].response.evalCount = 999; }],
    ['non-canonical role', artifact => { artifact.candidate.role = 'chat'; }],
    ['empty producer version', artifact => { artifact.producer.nodeVersion = ''; }],
    ['contract drift', artifact => { artifact.measurementContractSha256 = '0'.repeat(64); }],
    ['proof issuance', artifact => { artifact.proofIssued = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const artifact = clone(chatArtifact);
    mutate(artifact);
    const error = await captureRejection(() => validateModelFailoverMeasurementArtifact(artifact));
    assertMeasurementError(error);
    assert(
      error.code === 'MODEL_MEASUREMENT_ARTIFACT_INVALID'
        || error.code === 'MODEL_MEASUREMENT_INPUT_INVALID',
      `${label} returned unexpected code ${error.code}`,
    );
  }
  for (const invalidExpectation of [
    { role: '' },
    {
      role: 'CHAT',
      modelName: MODEL_NAME,
      digestSha256: '',
      providerOrigin: chatArtifact.provider.origin,
      sourceRevisionClaim: SOURCE_REVISION,
    },
    {
      role: 'CHAT',
      modelName: MODEL_NAME,
      digestSha256: MODEL_DIGEST,
      providerOrigin: chatArtifact.provider.origin,
      sourceRevisionTypo: SOURCE_REVISION,
    },
  ]) {
    const error = await captureRejection(
      () => validateModelFailoverMeasurementArtifact(chatArtifact, invalidExpectation),
    );
    assertMeasurementError(error, 'MODEL_MEASUREMENT_EXPECTATION_INVALID');
  }
});

await testAsync('inventory drift fails closed and leaves no complete measurement artifact', async () => {
  const provider = await startFixtureProvider({ role: 'CHAT', driftInventoryAfter: true });
  const artifactRoot = await createArtifactRoot('measurement-inventory-drift');
  try {
    const result = await runMeasurementChild({
      role: 'CHAT',
      providerOrigin: provider.origin,
      artifactRoot,
    });
    assertEqual(result.code, 1);
    assertIncludes(result.stderr, 'MODEL_MEASUREMENT_INVENTORY_DRIFT');
    assertEqual((await findMeasurementFiles(artifactRoot)).length, 0);
    assertEqual(provider.requests.filter(request => request.route === 'POST /api/chat').length, 8);
  } finally {
    await provider.close();
  }
}, 60_000);

await testAsync('provider failure fails closed and leaves no complete measurement artifact', async () => {
  const provider = await startFixtureProvider({ role: 'CHAT', failChatAt: 0 });
  const artifactRoot = await createArtifactRoot('measurement-provider-failure');
  try {
    const result = await runMeasurementChild({
      role: 'CHAT',
      providerOrigin: provider.origin,
      artifactRoot,
    });
    assertEqual(result.code, 1);
    assertIncludes(result.stderr, 'MODEL_MEASUREMENT_PROVIDER_HTTP_ERROR');
    assertEqual((await findMeasurementFiles(artifactRoot)).length, 0);
    assertEqual(provider.requests.filter(request => request.route === 'POST /api/chat').length, 1);
  } finally {
    await provider.close();
  }
}, 60_000);

await testAsync('invalid provider UTF-8 fails closed before JSON normalization or artifact publication', async () => {
  const provider = await startFixtureProvider({ role: 'CHAT', invalidUtf8At: 0 });
  const artifactRoot = await createArtifactRoot('measurement-invalid-utf8');
  try {
    const result = await runMeasurementChild({
      role: 'CHAT',
      providerOrigin: provider.origin,
      artifactRoot,
    });
    assertEqual(result.code, 1);
    assertIncludes(result.stderr, 'MODEL_MEASUREMENT_PROVIDER_RESPONSE_INVALID');
    assertEqual((await findMeasurementFiles(artifactRoot)).length, 0);
    assertEqual(provider.requests.filter(request => request.route === 'POST /api/chat').length, 1);
  } finally {
    await provider.close();
  }
}, 60_000);

summary();

function readFileSyncCompat(filePath) {
  return process.getBuiltinModule('node:fs').readFileSync(filePath, 'utf8');
}
