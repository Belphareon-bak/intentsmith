import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createSpecialistRoutes } from '../src/routes/specialists.js';

test('specialist creation preserves user text as data in its generated module', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio2-specialist-'));
  let result;
  const loader = { baseDir: dir, getInstalled: () => [], discoverAll() {}, installPending() {}, async enableAll() {} };
  const routes = createSpecialistRoutes({ specialistLoader: loader,
    sendJSON: (_res, status, body) => { result = { status, body }; },
    parseBody: async req => req.body, logger: { info() {}, error() {} } });
  const name = "Trader';globalThis.injected=true;//";
  const description = "Řádek 'jeden'\n`dva`; globalThis.injected=true";
  try {
    await routes['POST /api/specialists']({ body: { name, domain: "finance'\n", description, icon: '🧠' } }, {});
    assert.equal(result.status, 201);
    const source = readFileSync(join(dir, result.body.specialist.id, 'index.js'), 'utf8');
    const context = vm.createContext({});
    vm.runInContext(source.replaceAll('export ', '') + '\nglobalThis.generated = EXPERTISE;', context, { timeout: 1000 });
    assert.equal(context.injected, undefined);
    assert.equal(context.generated.name, name);
    assert.equal(context.generated.description, description);
    assert.equal(context.generated.systemPrompt, description);
    assert.equal(context.generated.domain, "finance'");
    assert.equal(context.generated.icon, '🧠');
    await routes['POST /api/specialists']({ body: { name: 'valid', description: 42 } }, {});
    assert.equal(result.status, 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
