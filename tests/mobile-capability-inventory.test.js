import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { REMOTE_CORE_FEATURE_IDS } from '../contracts/remote-core/index.js';
import { buildInventory } from '../scripts/mobile-capability-inventory.mjs';

const inventory = buildInventory();
const stored = JSON.parse(readFileSync(
  new URL('../docs/mobile/backend-capability-inventory.json', import.meta.url),
  'utf8',
));

assert.deepEqual(stored, inventory, 'generated backend inventory is stale');
assert.ok(inventory.summary.routes > 100, 'route scanner found implausibly few backend routes');
assert.equal(inventory.summary.mobileV1, 25, 'the current /m1 allow-list changed without review');
assert.equal(
  inventory.routes.filter(route => route.path.startsWith('/m1')).length,
  inventory.summary.mobileV1,
);

const keys = inventory.routes.map(route => `${route.method} ${route.path}`);
assert.equal(new Set(keys).size, keys.length, 'inventory contains duplicate route identities');
assert.equal(
  inventory.routes.find(route => route.path === '/m1/workers')?.remoteCoreFeature,
  'workers.read',
);
assert.equal(
  inventory.routes.find(route => route.path === '/m1/workers/:id/enabled')?.remoteCoreFeature,
  'workers.toggle',
);
assert.equal(
  inventory.routes.find(route => route.path === '/m1/workers/:id/runs')?.remoteCoreFeature,
  'workers.read',
);
assert.equal(
  inventory.routes.find(route => route.path === '/m1/specialists')?.remoteCoreFeature,
  'specialists.read',
);
for (const route of inventory.routes) {
  if (route.remoteCoreFeature !== null) {
    assert.ok(
      REMOTE_CORE_FEATURE_IDS.includes(route.remoteCoreFeature),
      `${route.method} ${route.path} maps to an unknown RemoteCorePort feature`,
    );
  }
  if (route.domain === 'security') {
    assert.equal(route.mobilePolicy, 'never-expose-admin');
    assert.equal(route.exposure, 'legacy-core');
  }
}

console.log(`Backend capability inventory: ${inventory.summary.routes} routes, ${inventory.routeDigest}`);
