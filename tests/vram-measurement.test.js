// tests/vram-measurement.test.js — naměřené umístění modelu a propustnost
// ══════════════════════════════════════════════════════════════════════════════
// Bez Ollamy: `fetch` je po dobu testu nahrazený atrapou.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  readPlacement, measureThroughput, measureModel, listResident,
  drainResident, intendedNumCtx,
} from '../src/upgrade/vram-measurement.js';

const GB = 2 ** 30;
const realFetch = globalThis.fetch;

/** Nahradí fetch obsluhou podle cesty; vrací zachycené požadavky. */
function stubFetch(handlers) {
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ path, body });
    const h = handlers[path];
    if (!h) return { ok: false, status: 404, json: async () => ({}) };
    const payload = typeof h === 'function' ? h(body, seen) : h;
    if (payload instanceof Error) throw payload;
    return { ok: true, status: 200, json: async () => payload };
  };
  return seen;
}
const restore = () => { globalThis.fetch = realFetch; };

// ─── Kontext měření ─────────────────────────────────────────────────────────

suite('intendedNumCtx');

test('měří se při kontextu, na kterém se reálně jede', () => {
  // KV cache roste s kontextem: `qwen2.5:32b` zabral 19.41 GB při 4k, ale
  // 29.28 GB při 32k. Měřit při menším kontextu by bránu obešlo.
  assertEqual(intendedNumCtx(), 32768);
});

// ─── Umístění ───────────────────────────────────────────────────────────────

suite('readPlacement');

await testAsync('model celý v GPU', async () => {
  stubFetch({ '/api/ps': { models: [{ name: 'a:7b', size: 10 * GB, size_vram: 10 * GB }] } });
  const p = await readPlacement('a:7b');
  assertEqual(p.fullyOnGpu, true);
  assertEqual(p.cpuBytes, 0);
  restore();
});

await testAsync('přetečení se spočítá', async () => {
  stubFetch({ '/api/ps': { models: [{ name: 'a:32b', size: 29 * GB, size_vram: 21 * GB }] } });
  const p = await readPlacement('a:32b');
  assertEqual(p.fullyOnGpu, false);
  assertEqual(p.cpuBytes, 8 * GB);
  restore();
});

await testAsync('shoda jména toleruje :latest', async () => {
  stubFetch({ '/api/ps': { models: [{ name: 'a:latest', size: GB, size_vram: GB }] } });
  assertEqual((await readPlacement('a')).loaded, true);
  restore();
});

await testAsync('nenačtený model se pozná', async () => {
  stubFetch({ '/api/ps': { models: [] } });
  const p = await readPlacement('a:7b');
  assertEqual(p.loaded, false);
  assertEqual(p.fullyOnGpu, false);
  restore();
});

// ─── Propustnost ────────────────────────────────────────────────────────────

suite('measureThroughput');

await testAsync('spočítá tokeny za sekundu z eval polí', async () => {
  stubFetch({ '/api/chat': { eval_count: 150, eval_duration: 2e9 } });
  assertEqual((await measureThroughput('a:7b')).tokensPerSecond, 75);
  restore();
});

await testAsync('bez eval dat vrátí null, ne nulu', async () => {
  // Nula by se dala splést s „velmi pomalý"; null znamená „neměřeno".
  stubFetch({ '/api/chat': { eval_count: 0, eval_duration: 0 } });
  assertEqual((await measureThroughput('a:7b')).tokensPerSecond, null);
  restore();
});

// ─── Kompletní měření ───────────────────────────────────────────────────────

suite('measureModel');

await testAsync('měří z prázdné paměti', async () => {
  // Kontence zkresluje: `qwen3.5:27b` vedle jiného rezidentního modelu vyšel
  // jako přetékající (17.7 tok/s), po vyprázdnění se vejde (33.6 tok/s).
  let psCalls = 0;
  const seen = stubFetch({
    '/api/ps': () => {
      psCalls++;
      if (psCalls === 1) return { models: [{ name: 'jiny:7b', size: GB, size_vram: GB }] };
      if (psCalls === 2) return { models: [] };
      return { models: [{ name: 'a:7b', size: 10 * GB, size_vram: 10 * GB }] };
    },
    '/api/chat': { eval_count: 100, eval_duration: 1e9 },
  });
  const r = await measureModel('a:7b');
  assertEqual(r.fits, true);
  assert(seen.some(s => s.path === '/api/chat' && s.body?.keep_alive === 0),
    'cizí model se musí uvolnit před měřením');
  restore();
});

await testAsync('přetékající model se neměří na rychlost', async () => {
  // Číslo by neměřilo model, ale rychlost sběrnice.
  stubFetch({
    '/api/ps': { models: [{ name: 'a:32b', size: 29 * GB, size_vram: 21 * GB }] },
    '/api/chat': { eval_count: 100, eval_duration: 1e9 },
  });
  const r = await measureModel('a:32b', { drain: false });
  assertEqual(r.fits, false);
  assertEqual(r.throughput, null);
  restore();
});

await testAsync('nenačtený model dá srozumitelnou chybu', async () => {
  stubFetch({ '/api/ps': { models: [] }, '/api/chat': { done: true } });
  const r = await measureModel('a:7b', { drain: false });
  assertEqual(r.fits, false);
  assert(/nenačetl/.test(r.error), r.error);
  restore();
});

await testAsync('výpadek Ollamy se vrátí jako chyba, ne výjimka', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await measureModel('a:7b', { drain: false });
  assertEqual(r.fits, false);
  assert(r.error, 'chyba musí být zachycená');
  restore();
});

// ─── Úklid paměti ───────────────────────────────────────────────────────────

suite('drainResident');

await testAsync('uvolní vše a počká na prázdno', async () => {
  let calls = 0;
  stubFetch({
    '/api/ps': () => (++calls === 1
      ? { models: [{ name: 'a:7b' }, { name: 'b:7b' }] }
      : { models: [] }),
    '/api/chat': { done: true },
  });
  assertEqual(await drainResident({ drainPollMs: 1 }), true);
  restore();
});

await testAsync('když se paměť neuvolní, ohlásí to a nezacyklí se', async () => {
  stubFetch({
    '/api/ps': { models: [{ name: 'zaseklo:7b' }] },
    '/api/chat': { done: true },
  });
  assertEqual(await drainResident({ drainTimeout: 50, drainPollMs: 10 }), false);
  restore();
});

await testAsync('listResident při výpadku vrátí prázdno', async () => {
  globalThis.fetch = async () => { throw new Error('down'); };
  assertEqual((await listResident()).length, 0);
  restore();
});

summary();
