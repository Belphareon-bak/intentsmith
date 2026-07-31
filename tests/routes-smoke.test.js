// Routes Smoke Test — Module Loading & Export Verification
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies that all route modules:
//   1. Load without errors (no missing imports, syntax ok)
//   2. Export a createXxxRoutes(deps) factory function
//   3. Factory returns a route map (object with method+path keys)
//   4. The legacy API/WS listener cannot bind outside loopback
//
// No HTTP server needed — purely structural.
//
// ══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { LLMProviderUnavailableError } from '../src/core/chat-turn-error.js';
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
  { file: 'src/routes/misc.js',         export: 'createMiscRoutes' },
  { file: 'src/routes/planner.js',      export: 'createPlannerRoutes' },
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

for (const host of LEGACY_LISTENER_LOOPBACK_HOSTS) {
  assert(
    isLegacyLoopbackHost(host)
      && requireLegacyLoopbackHost(` ${host.toUpperCase()} `) === host,
    `legacy listener accepts and canonicalizes ${host}`,
  );
}

for (const host of [
  '0.0.0.0',
  '::',
  '192.168.1.10',
  '10.0.0.2',
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
  { port: 47831, host: ' LOCALHOST ' },
  callback,
);
assert(
  listenResult === listeningSentinel
    && acceptedListenCalls.length === 1
    && acceptedListenCalls[0][0] === 47831
    && acceptedListenCalls[0][1] === 'localhost'
    && acceptedListenCalls[0][2] === callback,
  'loopback check and bind use the same canonical host',
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${pass} passed, ${fail} failed ══\n`);

if (fail > 0) {
  process.exit(1);
}
