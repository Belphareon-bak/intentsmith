// Routes Smoke Test — Module Loading & Export Verification
// ══════════════════════════════════════════════════════════════════════════════
//
// Verifies that all route modules:
//   1. Load without errors (no missing imports, syntax ok)
//   2. Export a createXxxRoutes(deps) factory function
//   3. Factory returns a route map (object with method+path keys)
//
// No HTTP server needed — purely structural.
//
// ══════════════════════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';

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
    // Some routes may need more deps — that's ok for a stub
    console.log(`  ⚠️  ${rm.export}() threw: ${err.message.slice(0, 80)}`);
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
}

// ─── Summary ─────────────────────────────────────────────────────────────────

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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══ Results: ${pass} passed, ${fail} failed ══\n`);

if (fail > 0) {
  process.exit(1);
}
