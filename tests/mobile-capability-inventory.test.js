import './helpers/isolated-test-db.js';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildInventory, compareOrdinal, scanDesktopRoutes,
  renderInventoryMarkdown, validateInventoryArtifacts,
} from '../scripts/mobile-capability-inventory.mjs';
import { M7_TRANSPORT_ROUTES } from '../src/remote/m7-transport-admission-policy.js';
import { M7_RUNTIME_OPERATION_DESCRIPTORS } from '../src/mobile/client/m7-runtime-contract-v1.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const inventory = buildInventory();
const json = readFileSync(new URL('../docs/mobile/backend-capability-inventory.json', import.meta.url), 'utf8');
const markdown = readFileSync(new URL('../docs/mobile/BACKEND-CAPABILITY-INVENTORY.md', import.meta.url), 'utf8');
validateInventoryArtifacts(inventory, json, markdown);
assert.deepEqual(JSON.parse(json), inventory);
assert.equal(markdown, renderInventoryMarkdown(inventory));
assert.throws(() => validateInventoryArtifacts(inventory, `${json} `, markdown), /INVENTORY_STALE/);
assert.throws(() => validateInventoryArtifacts(inventory, json, `${markdown} `), /INVENTORY_STALE/);
assert.equal(inventory.status, 'STATIC_SOURCE_INVENTORY_NOT_SESSION_AVAILABILITY');
assert.ok(inventory.summary.desktopRouteDeclarations > 100);
assert.equal(inventory.summary.legacyM1Declarations, 0, 'Do not resurrect the donor /m1 server');
assert.equal(inventory.summary.m7TransportRoutes, 7);
assert.deepEqual(inventory.transportRoutes.map(route => `${route.method} ${route.path}`).sort(compareOrdinal),
  M7_TRANSPORT_ROUTES.map(route => `${route.method} ${route.path}`).sort(compareOrdinal));
assert.equal(inventory.summary.m7Operations, 17);
assert.deepEqual(inventory.operations.map(operation => operation.operationId), Object.keys(M7_RUNTIME_OPERATION_DESCRIPTORS).sort(compareOrdinal));
assert.deepEqual(inventory.summary.capabilityIds, ['approvals', 'conversations', 'events', 'notifications', 'projects', 'settings', 'stored_information']);
assert.equal(inventory.summary.controlPlaneOperations, 3);
assert.equal(inventory.publicHealthOperation.operationId, 'remote-health.read');
assert.equal(inventory.publicHealthOperation.method, 'GET');
assert.equal(inventory.publicHealthOperation.path, '/remote/v1/health');
assert.deepEqual(inventory.publicHealthOperation.requiredScopes, []);
assert(inventory.desktopRoutes.some(route => route.path.startsWith('/api/specialists')));
assert(!inventory.operations.some(operation => /^(workers?|specialists?|devices?)\./u.test(operation.operationId)));
assert.equal(new Set(inventory.desktopRoutes.map(route => `${route.method} ${route.path}`)).size, inventory.desktopRoutes.length);

const fixture = [
  { source: 'z.js', contents: "{ 'GET /api/context': h, 'GET /api/chat': h, 'POST /api/chat': h }" },
  { source: 'a.js', contents: "{ 'GET /api/chat': h, 'GET /api/health': h }" },
];
const routes = scanDesktopRoutes(fixture);
assert.deepEqual(routes.map(route => `${route.method} ${route.path}`), [
  'GET /api/chat', 'POST /api/chat', 'GET /api/context', 'GET /api/health',
]);
assert.deepEqual(routes[0].sources, ['a.js', 'z.js']);
assert.deepEqual(scanDesktopRoutes([...fixture].reverse()), routes);
const oldLocaleCompare = String.prototype.localeCompare;
try {
  String.prototype.localeCompare = () => { throw new Error('locale-sensitive comparison forbidden'); };
  assert.deepEqual(buildInventory(), inventory);
} finally {
  String.prototype.localeCompare = oldLocaleCompare;
}

// Independent Node processes exercise Intl's locale selection, not just a
// process.env assignment after ICU has already initialized in this process.
for (const locale of ['C', 'en_US.UTF-8', 'cs_CZ.UTF-8', 'de_DE.UTF-8']) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { buildInventory, renderInventoryMarkdown } from './scripts/mobile-capability-inventory.mjs'; const i=buildInventory(); process.stdout.write(JSON.stringify([i,renderInventoryMarkdown(i)]));"], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LANG: locale, LC_ALL: locale, LC_CTYPE: locale },
  });
  assert.equal(child.status, 0, `${locale}: ${child.error?.message || child.stderr}`);
  assert.deepEqual(JSON.parse(child.stdout), [inventory, markdown], `${locale}: inventory bytes differ`);
}
console.log('Mobile inventory: PASS — separate route/operation authority, stale artifacts rejected, identical C/en_US/cs_CZ/de_DE bytes');
