import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {pathToFileURL} from 'node:url';
import {SpecialistLoader} from '../src/specialists/specialist-loader.js';
import {SpecialistRuntime} from '../src/expertises/specialist-runtime.js';
import db from '../src/db/database.js';
import { createSpecialistRoutes } from '../src/routes/specialists.js';

test('specialist creation preserves user text as data in its generated module', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio2-specialist-'));
  let result;
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db.db,runtime,{baseDir:dir,projectRoot:dir});
  const routes = createSpecialistRoutes({ specialistLoader: loader, specialistRuntime:runtime,
    sendJSON: (_res, status, body) => { result = { status, body }; },
    parseBody: async req => req.body, logger: { info() {}, error() {} } });
  const name = "Trader';globalThis.injected=true;//";
  const description = "Řádek 'jeden'\n`dva`; globalThis.injected=true";
  try {
    await routes['POST /api/specialists']({ body: { name, domain: 'finance', description, icon: '🧠' } }, {});
    assert.equal(result.status, 201);
    const source = readFileSync(join(dir, result.body.specialist.id, 'index.js'), 'utf8');
    const module = await import(pathToFileURL(join(dir,result.body.specialist.id,'index.js')).href);
    const context = await module.prepareContext({request:'Explain the supplied material'});
    assert.equal(globalThis.injected, undefined);
    assert.equal(context.data.expertise.name, name);
    assert.equal(context.data.expertise.description, description);
    assert.equal(context.data.expertise.systemPrompt, description);
    assert.equal(context.data.expertise.domain, 'finance');
    assert.equal(context.data.expertise.icon, '🧠');
    assert.equal(runtime.isSpecialist(result.body.specialist.id),true);
    assert.equal(loader.getManifest(result.body.specialist.id).tools.length,1);
    assert.equal((await module.prepareContext({request:''})).status,'error');
    await routes['POST /api/specialists']({ body: {name:'Invalid domain',domain:"finance'\n"} }, {});
    assert.equal(result.status,400);
    await routes['POST /api/specialists']({ body: { name: 'valid', description: 42 } }, {});
    assert.equal(result.status, 400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
