// Executed only by the authorized host run, with private HOME/XDG paths.
// Canonical product detector performs read-only nvidia-smi observations.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [backend, state] = process.argv.slice(2);
assert.equal(process.env.XDG_STATE_HOME, state);
assert.ok(path.isAbsolute(state));
const { getSystemProfile } = await import(pathToFileURL(path.join(backend, 'src/system/gpu-detector.js')));
const observed = getSystemProfile();
assert.equal(observed.capacityOnly, true);
assert.equal(observed.inventoryStale, false);
assert.ok(Date.parse(observed.checkedAt) > 0);
assert.ok(observed.gpus.some(g => !g.is_igpu && Number.isSafeInteger(g.vram_mb) && g.vram_mb > 0));
const record = JSON.parse(fs.readFileSync(path.join(state, 'intentsmith/gpu-inventory.json')));
assert.equal(new Date(record.checkedAt).toISOString(), observed.checkedAt);
process.stdout.write(JSON.stringify({observed, inventoryRecord: record, capturedUtc: new Date().toISOString()}));
