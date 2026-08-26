// Routes Smoke Test — Module Loading & Export Verification
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies that all route modules:
//   1. Load without errors (no missing imports, syntax ok)
//   2. Export a createXxxRoutes(deps) factory function
//   3. Factory returns a route map (object with method+path keys)
//   4. The legacy API/WS listener cannot bind outside loopback
//   5. The owned legacy HTTP server rejects unauthorized browser requests
//
// ══════════════════════════════════════════════════════════════════════════════

import { request as httpRequest } from 'node:http';
import path from 'path';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'fs';
import { spawn, spawnSync } from 'child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'url';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { LLMProviderUnavailableError } from '../src/core/chat-turn-error.js';
import {
  LEGACY_LOCAL_ACCESS_REQUIRED,
  LEGACY_LOCAL_CAPABILITY_HEADER,
} from '../src/security/legacy-local-access-policy.js';
import {
  LEGACY_LISTENER_LOOPBACK_HOSTS,
  LEGACY_LISTENER_LOOPBACK_REQUIRED,
  isLegacyLoopbackHost,
  listenOnLegacyLoopback,
  requireLegacyLoopbackHost,
} from '../src/security/legacy-listener-policy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function assert(condition, label) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log('\n══ Routes Smoke Test ══\n');

// ─── Route modules to test ──────────────────────────────────────────────────

const ROUTE_MODULES = [
  { file: 'src/routes/agents.js',      export: 'createAgentPlatformRoutes' },
  { file: 'src/routes/architect.js',    export: 'createArchitectRoutes' },
  { file: 'src/routes/chat.js',         export: 'createChatRoutes' },
  { file: 'src/routes/expertises.js',   export: 'createExpertiseRoutes' },
  { file: 'src/routes/learning.js',     export: 'createLearningRoutes' },
  { file: 'src/routes/misc.js',         export: 'createMiscRoutes' },
  { file: 'src/routes/planner.js',      export: 'createPlannerRoutes' },
  { file: 'src/routes/privacy.js',      export: 'createPrivacyRoutes' },
  { file: 'src/routes/projects.js',     export: 'createProjectRoutes' },
  { file: 'src/routes/specialists.js',  export: 'createSpecialistRoutes' },
];

// ─── Test 1: Module loads ────────────────────────────────────────────────────

console.log('── 1. Module Loading ──\n');

const loaded = {};

for (const rm of ROUTE_MODULES) {
  const label = rm.file;
  try {
    const mod = await import(path.join(ROOT, rm.file));
    loaded[rm.file] = mod;
    assert(true, `${label} loads`);
    console.log(`  ✅ ${label}`);
  } catch (err) {
    assert(false, `${label} loads: ${err.message}`);
  }
}

// ─── Test 2: Exports factory function ────────────────────────────────────────

console.log('\n── 2. Factory Function Exports ──\n');

for (const rm of ROUTE_MODULES) {
  const mod = loaded[rm.file];
  if (!mod) continue;

  const fn = mod[rm.export];
  const label = `${rm.file} exports ${rm.export}()`;
  assert(typeof fn === 'function', label);
  console.log(`  ${typeof fn === 'function' ? '✅' : '❌'} ${label}`);
}

// ─── Test 3: Factory returns route map ───────────────────────────────────────

console.log('\n── 3. Route Map Shape ──\n');

// Minimal mock deps that routes typically need
const mockDeps = {
  db: { prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }) },
  sendJSON: () => {},
  parseBody: () => ({}),
  safeError: () => ({ error: 'Internal server error' }),
  learningService: {
    listProposalReviews: () => ({}),
    getProposalReview: () => ({}),
    approveProposal: () => ({}),
    rejectProposal: () => ({}),
    weakenLearning: () => ({}),
    rollbackLearning: () => ({}),
    deleteLearning: () => ({}),
  },
  privacyAuthority: {
    summary: () => ({}),
    recordRotation: () => ({}),
    recordHistory: () => ({}),
  },
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  config: { features: {} },
  path,
};

for (const rm of ROUTE_MODULES) {
  const mod = loaded[rm.file];
  if (!mod) continue;

  const fn = mod[rm.export];
  if (typeof fn !== 'function') continue;

  try {
    const routes = fn(mockDeps);
    const isObj = routes && typeof routes === 'object' && !Array.isArray(routes);
    const label = `${rm.export}() returns route map`;
    assert(isObj, label);

    if (isObj) {
      const keys = Object.keys(routes);
      const hasRoutes = keys.length > 0;
      const routePattern = /^(GET|POST|PUT|DELETE|PATCH)\s+\//;
      const allValidKeys = keys.every(k => routePattern.test(k));
      assert(hasRoutes, `${rm.export} has routes`);
      assert(allValidKeys, `${rm.export} keys are METHOD /path format`);
      console.log(`  ✅ ${rm.export}() → ${keys.length} routes`);
    } else {
      console.log(`  ❌ ${rm.export}() → not an object`);
    }
  } catch (err) {
    assert(false, `${rm.export}() constructs a route map: ${err.message}`);
    console.log(`  ❌ ${rm.export}() threw: ${err.message.slice(0, 80)}`);
  }
}

// ─── Test 4: Chat validation fails before controller dispatch ───────────────

console.log('\n── 4. Chat Request Validation ──\n');

const chatFactory = loaded['src/routes/chat.js']?.createChatRoutes;
if (typeof chatFactory === 'function') {
  let controllerCalls = 0;
  const statuses = [];
  const chatRoutes = chatFactory({
    ...mockDeps,
    parseBody: async req => req.body,
    sendJSON: (_res, status) => statuses.push(status),
    ChatController: {
      handle: async () => {
        controllerCalls++;
        throw new Error('invalid request reached ChatController');
      },
    },
  });
  const response = {};

  await chatRoutes['POST /chat']({ body: { message: 12345 } }, response);
  await chatRoutes['POST /api/chat']({
    body: { conversation_id: 'fixture-conversation', message: 12345 },
  }, response);
  await chatRoutes['POST /api/chat']({
    body: { conversation_id: 'fixture-conversation', message: '   ' },
  }, response);

  assert(
    JSON.stringify(statuses) === JSON.stringify([400, 400, 400]),
    'chat routes reject non-string and blank messages with HTTP 400',
  );
  assert(controllerCalls === 0, 'invalid chat requests never reach ChatController');

  const providerFailureResponses = [];
  const providerFailureRoutes = chatFactory({
    ...mockDeps,
    db: {
      conversations: {
        findById: {
          get: id => ({ id, project_id: null }),
        },
      },
      projects: {
        findById: {
          get: () => null,
        },
      },
    },
    parseBody: async req => req.body,
    sendJSON: (_res, status, data) => providerFailureResponses.push({ status, data }),
    safeError: () => {
      throw new Error('typed provider failure reached generic safeError');
    },
    ChatController: {
      handle: async () => {
        throw new LLMProviderUnavailableError();
      },
    },
  });
  const providerFailureResponse = { writableEnded: false };

  await providerFailureRoutes['POST /chat']({
    body: { message: 'Require provider' },
    on: () => {},
  }, providerFailureResponse);
  await providerFailureRoutes['POST /api/chat']({
    body: {
      conversation_id: 'provider-failure-conversation',
      message: 'Require provider',
    },
    on: () => {},
  }, providerFailureResponse);

  const expectedProviderFailure = {
    status: 503,
    data: {
      error: 'Model provider is temporarily unavailable.',
      code: 'LLM_PROVIDER_UNAVAILABLE',
      recoverable: true,
    },
  };
  assert(
    JSON.stringify(providerFailureResponses)
      === JSON.stringify([expectedProviderFailure, expectedProviderFailure]),
    'both chat routes expose the exact stable HTTP 503 provider-failure contract',
  );

  const canonicalExpertise = {
    id: 'developer',
    name: 'Software Developer',
    systemPrompt: 'server-owned fixture prompt',
  };
  const expertiseLookups = [];
  const dispatchedRequests = [];
  const expertiseResponses = [];
  const projectLookups = [];
  const expertiseRoutes = chatFactory({
    ...mockDeps,
    db: {
      conversations: {
        findById: {
          get: id => ({
            id,
            project_id: id === 'fixture-conversation' ? 7 : null,
          }),
        },
      },
      projects: {
        findById: {
          get: id => {
            projectLookups.push(id);
            return id === 7 || id === 8 ? { id } : null;
          },
        },
      },
    },
    parseBody: async req => req.body,
    sendJSON: (_res, status, data) => expertiseResponses.push({ status, data }),
    expertiseLayer: {
      expertiseRegistry: {
        get: id => {
          expertiseLookups.push(id);
          return id === canonicalExpertise.id
            ? { toJSON: () => ({ ...canonicalExpertise }) }
            : null;
        },
      },
    },
    ChatController: {
      handle: async request => {
        dispatchedRequests.push(request);
        return {
          response: 'fixture response',
          mode: 'expert',
          confidence: 1,
          metadata: {},
        };
      },
    },
  });
  const validRequest = {
    body: {
      conversation_id: 'fixture-conversation',
      message: 'Explain this API.',
      expertise_id: ' developer ',
    },
    on: () => {},
  };

  await expertiseRoutes['POST /api/chat'](validRequest, { writableEnded: false });
  await expertiseRoutes['POST /api/chat']({
    body: {
      conversation_id: 'fixture-conversation',
      message: 'Explain this API.',
      expertise_id: {},
    },
    on: () => {},
  }, {});
  await expertiseRoutes['POST /api/chat']({
    body: {
      conversation_id: 'fixture-conversation',
      message: 'Explain this API.',
      expertise_id: 'missing-expertise',
    },
    on: () => {},
  }, {});
  await expertiseRoutes['POST /api/chat']({
    body: {
      conversation_id: 'fixture-conversation',
      project_id: 8,
      message: 'Explain this API.',
    },
    on: () => {},
  }, {});
  await expertiseRoutes['POST /api/chat']({
    body: {
      conversation_id: 'unbound-conversation',
      project_id: 'not-an-id',
      message: 'Explain this API.',
    },
    on: () => {},
  }, {});
  await expertiseRoutes['POST /api/chat']({
    body: {
      conversation_id: 'unbound-conversation',
      project_id: 999,
      message: 'Explain this API.',
    },
    on: () => {},
  }, {});

  assert(
    JSON.stringify(expertiseLookups) === JSON.stringify(['developer', 'missing-expertise']),
    'chat route normalizes expertise IDs and resolves them through the server registry',
  );
  assert(
    dispatchedRequests.length === 1
      && JSON.stringify(dispatchedRequests[0].expertise) === JSON.stringify(canonicalExpertise)
      && dispatchedRequests[0].context?.projectId === 7
      && dispatchedRequests[0].context?.hasActiveProject === true,
    'chat route dispatches canonical expertise and derives the stored conversation project',
  );
  assert(
    JSON.stringify(expertiseResponses.map(item => item.status))
      === JSON.stringify([200, 400, 404, 409, 400, 404]),
    'chat route rejects invalid expertise and project overrides with exact statuses',
  );
  assert(
    JSON.stringify(projectLookups) === JSON.stringify([8, 999]),
    'chat route validates requested projects before controller dispatch',
  );
  assert(
    dispatchedRequests.length === 1,
    'invalid, missing, or mismatched project bindings never reach ChatController',
  );
}

console.log('\n── 5. Specialist Disable Ordering ──\n');

const specialistFactory = loaded['src/routes/specialists.js']?.createSpecialistRoutes;
if (typeof specialistFactory === 'function') {
  let resolveDisable;
  let disableCalls = 0;
  const responses = [];
  const specialistRoutes = specialistFactory({
    ...mockDeps,
    specialistLoader: {
      disable: async () => {
        disableCalls++;
        await new Promise(resolve => {
          resolveDisable = resolve;
        });
      },
    },
    sendJSON: (_res, status, data) => responses.push({ status, data }),
  });

  const disablePromise = specialistRoutes['POST /api/specialists/:id/disable'](
    {},
    {},
    { id: 'dummy-logger' },
  );
  await Promise.resolve();

  assert(disableCalls === 1, 'specialist disable invokes loader exactly once');
  assert(responses.length === 0, 'specialist disable does not respond before loader settles');

  resolveDisable();
  await disablePromise;

  assert(
    responses.length === 1
      && responses[0].status === 200
      && responses[0].data?.status === 'disabled',
    'specialist disable responds with HTTP 200 only after loader settles',
  );
}

console.log('\n── 6. Notification Query Adapter ──\n');

const agentFactory = loaded['src/routes/agents.js']?.createAgentPlatformRoutes;
if (typeof agentFactory === 'function') {
  let capturedRequest = null;
  const responseBodies = [];
  const agentRoutes = agentFactory({
    ...mockDeps,
    agentRoutes: {
      markAllNotificationsRead: async (req, res) => {
        capturedRequest = req;
        res.json({ success: true });
      },
    },
    createMockResponse: () => ({
      status() {
        return this;
      },
      json(data) {
        responseBodies.push(data);
        return this;
      },
    }),
  });

  await agentRoutes['POST /api/notifications/read-all']({
    url: '/api/notifications/read-all?agent=fixture-agent',
    headers: { host: '127.0.0.1' },
  }, {});

  assert(
    capturedRequest?.query?.agent === 'fixture-agent',
    'notification read-all forwards the agent query filter',
  );
  assert(
    responseBodies.length === 1 && responseBodies[0]?.success === true,
    'notification read-all preserves the adapter response',
  );
}

console.log('\n── 7. Legacy Listener Loopback Boundary ──\n');

const expectedLegacyBindHosts = ['127.0.0.1'];
assert(
  JSON.stringify(LEGACY_LISTENER_LOOPBACK_HOSTS)
    === JSON.stringify(expectedLegacyBindHosts),
  'legacy listener pins the exact numeric bind allowlist',
);

for (const host of expectedLegacyBindHosts) {
  assert(
    isLegacyLoopbackHost(host)
      && requireLegacyLoopbackHost(` ${host.toUpperCase()} `) === host,
    `legacy listener accepts and canonicalizes ${host}`,
  );
}

for (const host of [
  '0.0.0.0',
  '::',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
  '192.168.1.10',
  '10.0.0.2',
  '127.0.0.2',
  '203.0.113.77',
  'example.test',
  '',
  ' ',
  null,
  undefined,
]) {
  let rejection = null;
  try {
    requireLegacyLoopbackHost(host);
  } catch (error) {
    rejection = error;
  }
  assert(
    rejection?.code === LEGACY_LISTENER_LOOPBACK_REQUIRED,
    `legacy listener rejects ${String(host)} with the stable boundary code`,
  );
}

let rejectedListenCalls = 0;
const rejectedServer = {
  listen() {
    rejectedListenCalls++;
    throw new Error('non-loopback request reached server.listen');
  },
};
let rejectedBindError = null;
try {
  listenOnLegacyLoopback(
    rejectedServer,
    { port: 0, host: '0.0.0.0' },
    () => {
      throw new Error('non-loopback listener invoked its callback');
    },
  );
} catch (error) {
  rejectedBindError = error;
}
assert(
  rejectedBindError?.code === LEGACY_LISTENER_LOOPBACK_REQUIRED
    && rejectedListenCalls === 0,
  'non-loopback host is rejected before server.listen',
);

const listeningSentinel = {};
const callback = () => {};
const acceptedListenCalls = [];
const acceptedServer = {
  listen(...args) {
    acceptedListenCalls.push(args);
    return listeningSentinel;
  },
};
const listenResult = listenOnLegacyLoopback(
  acceptedServer,
  { port: 47831, host: ' 127.0.0.1 ' },
  callback,
);
assert(
  listenResult === listeningSentinel
    && acceptedListenCalls.length === 1
    && acceptedListenCalls[0][0] === 47831
    && acceptedListenCalls[0][1] === '127.0.0.1'
    && acceptedListenCalls[0][2] === callback,
  'loopback check and bind use the same canonical host',
);

function runRejectedNetworkBoundary(environment, prefix) {
  const runtime = mkdtempSync(
    path.join(isolatedTestRuntime.temp, `${prefix}-`),
  );
  const metadata = lstatSync(runtime);
  let entries = [];
  let result;
  try {
    result = spawnSync(
      process.execPath,
      ['src/server.js'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          C3_HOST: '127.0.0.1',
          C3_CORS_ORIGINS: '',
          C3_DB_PATH: path.join(runtime, 'c3.sqlite'),
          C3_PORT_FILE: path.join(runtime, 'port.json'),
          C3_PROJECTS_DIR: path.join(runtime, 'projects'),
          C3_ENABLE_AGENTS: 'false',
          C3_ENABLE_EXPERTISES: 'false',
          C3_ENABLE_LIFECYCLE: 'false',
          C3_ENABLE_COMFYUI: 'false',
          ...environment,
        },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    entries = readdirSync(runtime);
  } finally {
    const current = lstatSync(runtime);
    if (
      current.isDirectory()
      && !current.isSymbolicLink()
      && current.dev === metadata.dev
      && current.ino === metadata.ino
      && realpathSync(runtime) === runtime
    ) {
      rmSync(runtime, { recursive: true, force: false });
    } else {
      throw new Error(`Refusing to remove a substituted ${prefix} fixture`);
    }
  }
  return {
    rejected: result?.status !== 0 && !result?.error,
    entries,
    runtime,
  };
}

const invalidHost = runRejectedNetworkBoundary(
  { C3_HOST: '0.0.0.0' },
  'legacy-invalid-host',
);
assert(
  invalidHost.rejected
    && invalidHost.entries.length === 0
    && !existsSync(invalidHost.runtime),
  'invalid C3_HOST fails before database, backup, project, or port-file state',
);

const invalidCorsOrigin = runRejectedNetworkBoundary(
  { C3_CORS_ORIGINS: 'https://attacker.example' },
  'legacy-invalid-cors',
);
assert(
  invalidCorsOrigin.rejected
    && invalidCorsOrigin.entries.length === 0
    && !existsSync(invalidCorsOrigin.runtime),
  'invalid C3_CORS_ORIGINS fails before database, backup, project, or port-file state',
);

const serverSource = readFileSync(
  new URL('../src/server.js', import.meta.url),
  'utf8',
);
assert(
  serverSource.includes(
    'listenOnLegacyLoopback(server, config.server, async () => {',
  )
    && !/\bserver\.listen\s*\(/.test(serverSource),
  'server startup uses only the fail-closed legacy listener boundary',
);
assert(
  serverSource.indexOf("import './runtime-environment.js';")
    < serverSource.indexOf("import db from './db/database.js';"),
  'server evaluates the network boundary bootstrap before the database module',
);

console.log('\n── 8. Owned Legacy HTTP Browser Boundary ──\n');

function makePrivateDirectory(parent, name) {
  const directory = path.join(parent, name);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
    || realpathSync(directory) !== directory
  ) {
    throw new Error(`Owned HTTP fixture directory is unsafe: ${name}`);
  }
  return directory;
}

function boundedTail(previous, chunk) {
  return (previous + String(chunk)).slice(-20_000);
}

async function waitForChildExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null) {
    if (Date.now() >= deadline) return false;
    await delay(25);
  }
  return true;
}

async function waitForOwnedPortFile({
  child,
  nonce,
  portFile,
  runtimeDirectory,
  stderrTail,
  stdoutTail,
}) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Owned HTTP server exited before readiness: `
        + `${stdoutTail()} ${stderrTail()}`.trim().slice(-2_000),
      );
    }
    if (existsSync(portFile)) {
      const metadata = lstatSync(portFile);
      if (
        !metadata.isFile()
        || metadata.isSymbolicLink()
        || (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600)
        || path.dirname(realpathSync(portFile)) !== runtimeDirectory
      ) {
        throw new Error('Owned HTTP server port file failed its private-file contract');
      }

      let payload;
      try {
        payload = JSON.parse(readFileSync(portFile, 'utf8'));
      } catch {
        await delay(25);
        continue;
      }
      if (
        payload?.pid !== child.pid
        || payload?.host !== '127.0.0.1'
        || payload?.testRunNonce !== nonce
        || !Number.isInteger(payload?.port)
        || payload.port < 1
        || payload.port > 65535
        || !/^[A-Za-z0-9_-]{43}$/.test(payload?.localCapability || '')
      ) {
        throw new Error('Owned HTTP server port payload failed its identity contract');
      }
      return payload;
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for the owned HTTP server: `
    + `${stdoutTail()} ${stderrTail()}`.trim().slice(-2_000),
  );
}

function requestOwnedHttpServer({
  body = null,
  headers = {},
  method,
  pathname,
  port,
}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers,
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBody += chunk;
        if (responseBody.length > 1_000_000) {
          request.destroy(new Error('Owned HTTP response exceeded 1 MB'));
        }
      });
      response.on('end', () => {
        resolve({
          body: responseBody,
          headers: response.headers,
          status: response.statusCode,
        });
      });
    });
    request.setTimeout(5_000, () => {
      request.destroy(new Error('Owned HTTP boundary request timed out'));
    });
    request.on('error', reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

function parseJsonResponse(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

function assertBoundaryRejection(response, label) {
  const parsed = parseJsonResponse(response);
  assert(
    response.status === 403
      && parsed?.code === LEGACY_LOCAL_ACCESS_REQUIRED
      && parsed?.error === 'Local access boundary rejected the request.',
    `${label} receives the exact stable HTTP 403 boundary contract`,
  );
  assert(
    JSON.stringify(Object.keys(parsed || {}).sort()) === '["code","error"]',
    `${label} rejection contains no additional response fields`,
  );
  assert(
    response.headers['access-control-allow-origin'] === undefined,
    `${label} is not granted a readable CORS response`,
  );
}

async function runOwnedLegacyHttpBoundary() {
  const fixtureRoot = mkdtempSync(
    path.join(isolatedTestRuntime.temp, 'legacy-owned-http-'),
  );
  chmodSync(fixtureRoot, 0o700);
  const fixtureMetadata = lstatSync(fixtureRoot);
  if (
    !fixtureMetadata.isDirectory()
    || fixtureMetadata.isSymbolicLink()
    || realpathSync(fixtureRoot) !== fixtureRoot
  ) {
    throw new Error('Owned HTTP fixture root failed its identity contract');
  }

  const runtimeDirectory = makePrivateDirectory(fixtureRoot, 'runtime');
  const projectsDirectory = makePrivateDirectory(fixtureRoot, 'projects');
  const artifactsDirectory = makePrivateDirectory(fixtureRoot, 'artifacts');
  const homeDirectory = makePrivateDirectory(fixtureRoot, 'home');
  const xdgConfigDirectory = makePrivateDirectory(fixtureRoot, 'xdg-config');
  const xdgCacheDirectory = makePrivateDirectory(fixtureRoot, 'xdg-cache');
  const xdgDataDirectory = makePrivateDirectory(fixtureRoot, 'xdg-data');
  const xdgStateDirectory = makePrivateDirectory(fixtureRoot, 'xdg-state');
  const tempDirectory = makePrivateDirectory(fixtureRoot, 'tmp');
  const npmCacheDirectory = makePrivateDirectory(artifactsDirectory, 'npm-cache');
  const portFile = path.join(runtimeDirectory, 'server.port');
  const databasePath = path.join(runtimeDirectory, 'server.sqlite');
  const nonce = 'routes-smoke-owned-http-boundary-0001';
  let child = null;
  let stdout = '';
  let stderr = '';
  let forcedTermination = false;
  let shutdownExitCode = null;
  let shutdownSignal = null;
  let portFileRemovedByServer = false;
  let observedLocalCapability = null;

  try {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH || '',
        LANG: 'C.UTF-8',
        TZ: 'UTC',
        HOME: homeDirectory,
        XDG_CONFIG_HOME: xdgConfigDirectory,
        XDG_CACHE_HOME: xdgCacheDirectory,
        XDG_DATA_HOME: xdgDataDirectory,
        XDG_STATE_HOME: xdgStateDirectory,
        TMPDIR: tempDirectory,
        TMP: tempDirectory,
        TEMP: tempDirectory,
        npm_config_cache: npmCacheDirectory,
        NODE_ENV: 'test',
        CI: '1',
        DOTENV_CONFIG_PATH: path.join(runtimeDirectory, 'no-dotenv-file'),
        DOTENV_CONFIG_QUIET: 'true',
        C3_HOST: '127.0.0.1',
        C3_PORT: '0',
        C3_PORT_FILE: portFile,
        C3_DB_PATH: databasePath,
        C3_PROJECTS_DIR: projectsDirectory,
        INTENTSMITH_TEST_PROJECTS_DIR: projectsDirectory,
        INTENTSMITH_TEST_ARTIFACT_DIR: artifactsDirectory,
        INTENTSMITH_TEST_SERVER_NONCE: nonce,
        C3_CORS_ORIGINS: 'http://localhost:3000',
        C3_ENABLE_AGENTS: 'false',
        C3_ENABLE_EXPERTISES: 'false',
        C3_ENABLE_LIFECYCLE: 'false',
        C3_ENABLE_COMFYUI: 'false',
        C3_ENABLE_AUTONOMY: 'false',
        C3_ENABLE_SKILLS: 'false',
        C3_ENABLE_TELEMETRY: 'false',
        C3_SPECIALIST_TELEMETRY: 'false',
        C3_MODEL_UNIVERSE_ENABLED: 'false',
        C3_LIFECYCLE_AUTO_COMMIT: 'false',
        C3_UPDATE_REPO: '',
        C3_TRACE: '0',
        C3_LOG_LEVEL: 'warn',
        OLLAMA_URL: 'invalid://routes-smoke-no-model-provider',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout = boundedTail(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = boundedTail(stderr, chunk);
    });

    const {
      localCapability,
      port,
    } = await waitForOwnedPortFile({
      child,
      nonce,
      portFile,
      runtimeDirectory,
      stderrTail: () => stderr,
      stdoutTail: () => stdout,
    });
    observedLocalCapability = localCapability;
    const wrongLocalCapability = `${
      localCapability[0] === 'A' ? 'B' : 'A'
    }${localCapability.slice(1)}`;
    const exactOrigin = `http://127.0.0.1:${port}`;
    const allowedOrigin = 'http://localhost:3000';
    const blockedPath = path.join(projectsDirectory, 'blocked-sentinel.txt');
    const writeBody = (filename, content) => JSON.stringify({
      root: projectsDirectory,
      path: filename,
      content,
    });
    const mutationHeaders = {
      'Content-Type': 'text/plain',
    };

    const nativeHealth = await requestOwnedHttpServer({
      method: 'GET',
      pathname: '/api/health',
      port,
    });
    assert(
      nativeHealth.status === 200
        && nativeHealth.headers['access-control-allow-origin'] === undefined,
      'native loopback health request remains authorized without CORS',
    );

    const foreign = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'foreign-origin-must-not-write'),
      headers: {
        ...mutationHeaders,
        Origin: 'https://attacker.example',
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(foreign, 'foreign browser origin');
    assert(!existsSync(blockedPath), 'foreign browser origin cannot mutate the workspace');

    const hostileTargetHost = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'host-rebind-must-not-write'),
      headers: {
        ...mutationHeaders,
        Host: `attacker.example:${port}`,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(hostileTargetHost, 'host-header rebinding request');
    assert(
      !existsSync(blockedPath),
      'host-header rebinding cannot mutate the workspace',
    );

    const foreignWithCapability = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'foreign-capability-must-not-write'),
      headers: {
        ...mutationHeaders,
        Origin: 'https://attacker.example',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: localCapability,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(
      foreignWithCapability,
      'foreign origin with a copied capability',
    );
    assert(
      !existsSync(blockedPath),
      'a copied capability cannot authorize a foreign origin mutation',
    );

    const opaqueWithoutCapability = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'opaque-missing-must-not-write'),
      headers: {
        ...mutationHeaders,
        Origin: 'null',
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(
      opaqueWithoutCapability,
      'opaque origin without capability',
    );
    assert(
      !existsSync(blockedPath),
      'opaque origin without capability cannot mutate the workspace',
    );

    const opaqueWithWrongCapability = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'opaque-wrong-must-not-write'),
      headers: {
        ...mutationHeaders,
        Origin: 'null',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: wrongLocalCapability,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(
      opaqueWithWrongCapability,
      'opaque origin with the wrong capability',
    );
    assert(
      !existsSync(blockedPath),
      'wrong opaque capability cannot mutate the workspace',
    );

    const crossSiteWithoutOrigin = await requestOwnedHttpServer({
      body: writeBody('blocked-sentinel.txt', 'cross-site-must-not-write'),
      headers: {
        ...mutationHeaders,
        'Sec-Fetch-Site': 'cross-site',
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assertBoundaryRejection(
      crossSiteWithoutOrigin,
      'cross-site request without Origin',
    );
    assert(
      !existsSync(blockedPath),
      'cross-site request without Origin cannot mutate the workspace',
    );

    const exactContent = 'exact-target-origin-write';
    const exactTarget = await requestOwnedHttpServer({
      body: writeBody('exact-target.txt', exactContent),
      headers: {
        ...mutationHeaders,
        Origin: exactOrigin,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assert(
      exactTarget.status === 200
        && parseJsonResponse(exactTarget)?.ok === true
        && exactTarget.headers['access-control-allow-origin'] === exactOrigin
        && readFileSync(
          path.join(projectsDirectory, 'exact-target.txt'),
          'utf8',
        ) === exactContent,
      'exact backend origin preserves the workspace mutation contract',
    );

    const allowedContent = 'configured-local-origin-write';
    const configuredLocal = await requestOwnedHttpServer({
      body: writeBody('configured-local.txt', allowedContent),
      headers: {
        ...mutationHeaders,
        Origin: allowedOrigin,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assert(
      configuredLocal.status === 200
        && parseJsonResponse(configuredLocal)?.ok === true
        && configuredLocal.headers['access-control-allow-origin'] === allowedOrigin
        && readFileSync(
          path.join(projectsDirectory, 'configured-local.txt'),
          'utf8',
        ) === allowedContent,
      'explicitly configured local origin preserves the mutation contract',
    );

    const directWriteHead = await requestOwnedHttpServer({
      headers: {
        Origin: allowedOrigin,
      },
      method: 'GET',
      pathname: '/api/logs/export',
      port,
    });
    const directWriteHeadVary = new Set(
      String(directWriteHead.headers.vary || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean),
    );
    assert(
      directWriteHead.status === 200
        && directWriteHead.headers['access-control-allow-origin'] === allowedOrigin
        && directWriteHeadVary.size === 4
        && directWriteHeadVary.has('origin')
        && directWriteHeadVary.has('access-control-request-headers')
        && directWriteHeadVary.has(
          LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase(),
        )
        && directWriteHeadVary.has('sec-fetch-site'),
      'authorized CORS headers survive a direct writeHead response',
    );

    const opaquePreflight = await requestOwnedHttpServer({
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          `content-type, ${LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase()}`,
      },
      method: 'OPTIONS',
      pathname: '/api/workspace/file',
      port,
    });
    const allowHeaders = String(
      opaquePreflight.headers['access-control-allow-headers'] || '',
    ).toLowerCase();
    const allowMethods = String(
      opaquePreflight.headers['access-control-allow-methods'] || '',
    );
    assert(
      opaquePreflight.status === 204
        && opaquePreflight.headers['access-control-allow-origin'] === 'null'
        && allowHeaders.includes('content-type')
        && allowHeaders.includes(
          LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase(),
        )
        && allowMethods.includes('PATCH'),
      'opaque capability preflight receives only the explicit local CORS contract',
    );

    const opaqueContent = 'authorized-opaque-origin-write';
    const opaqueAuthorized = await requestOwnedHttpServer({
      body: writeBody('opaque-authorized.txt', opaqueContent),
      headers: {
        ...mutationHeaders,
        Origin: 'null',
        [LEGACY_LOCAL_CAPABILITY_HEADER]: localCapability,
      },
      method: 'POST',
      pathname: '/api/workspace/file',
      port,
    });
    assert(
      opaqueAuthorized.status === 200
        && parseJsonResponse(opaqueAuthorized)?.ok === true
        && opaqueAuthorized.headers['access-control-allow-origin'] === 'null'
        && readFileSync(
          path.join(projectsDirectory, 'opaque-authorized.txt'),
          'utf8',
        ) === opaqueContent,
      'opaque Electron origin requires the exact private capability',
    );
  } finally {
    if (
      child
      && child.exitCode === null
      && child.signalCode === null
    ) {
      child.kill('SIGTERM');
      if (!(await waitForChildExit(child, 10_000))) {
        forcedTermination = true;
        child.kill('SIGKILL');
        if (!(await waitForChildExit(child, 5_000))) {
          throw new Error(
            `Owned HTTP server did not stop after SIGKILL; preserving ${fixtureRoot}`,
          );
        }
      }
    }
    shutdownExitCode = child?.exitCode ?? null;
    shutdownSignal = child?.signalCode ?? null;
    portFileRemovedByServer = !existsSync(portFile);

    const current = lstatSync(fixtureRoot);
    if (
      !current.isDirectory()
      || current.isSymbolicLink()
      || current.dev !== fixtureMetadata.dev
      || current.ino !== fixtureMetadata.ino
      || realpathSync(fixtureRoot) !== fixtureRoot
    ) {
      throw new Error('Refusing to remove a substituted owned HTTP fixture');
    }
    rmSync(fixtureRoot, { recursive: true, force: false });
  }

  assert(!forcedTermination, 'owned HTTP server stops on SIGTERM without SIGKILL');
  assert(
    shutdownExitCode === 0 && shutdownSignal === null,
    'owned HTTP server exits cleanly after the boundary matrix',
  );
  assert(
    portFileRemovedByServer,
    'owned HTTP server removes its private port file before fixture cleanup',
  );
  assert(
    typeof observedLocalCapability === 'string'
      && !stdout.includes(observedLocalCapability)
      && !stderr.includes(observedLocalCapability),
    'owned HTTP server never writes the local capability to captured logs',
  );
}

try {
  await runOwnedLegacyHttpBoundary();
} catch (error) {
  assert(false, `owned legacy HTTP boundary completes safely: ${error.message}`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${pass} passed, ${fail} failed ══\n`);

if (fail > 0) {
  process.exit(1);
}
