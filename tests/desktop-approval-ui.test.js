// Rozhodovací plocha na desktopu má rozhraní, ne jen routu
// ==============================================================================
//
// `desktop-approval-surface.test.js` dokazuje, že routy pod tím jsou správné.
// Tahle sada dokazuje, že se z nich dá **rozhodnout bez curlu** — protože
// plocha bez rozhraní je plocha jen na papíře: „telefon nesmí být jedinou
// možností" neplatí, když ta druhá možnost vyžaduje, aby si člověk pamatoval
// tvar JSONu a otisk opsal z jiné odpovědi.
//
// Stránka se testuje dvěma způsoby a ani jeden sám nestačí:
//
//   1. **Skript se spustí v minimálním DOMu** proti atrapě `fetch`, takže se dá
//      ověřit, co dělá s odpovědí serveru — hlavně co dělá se selháním.
//   2. **Rozhodnutí projde skutečnou routou** do skutečné databáze, takže se
//      neověřuje jen to, že se tlačítko překreslí.
//
// Nejostřejší tvrzení je to o prázdné frontě: **„nic nečeká" je povolení
// odložit to a smí ho dát jen potvrzená odpověď.**  Stránka, která po výpadku
// sítě nakreslí klid, pošle člověka od počítače ve chvíli, kdy běh čeká.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { createMobileApproval } from '../src/approvals/authority.js';
import { createApprovalRoutes } from '../src/routes/approvals.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Rozhodovací plocha na desktopu (P0-6) ===');

const pageUrl = new URL('../src/approvals/approvals.html', import.meta.url);
const page = readFileSync(pageUrl, 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];

// ── Minimální DOM ──────────────────────────────────────────────────────────

const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await tick();
}

function makeElement(id) {
  return {
    id, innerHTML: '', textContent: '',
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
  };
}

/**
 * Spusť skript stránky nad atrapou `fetch` a vrať, co nakreslil.
 *
 * `setInterval` se nahrazuje neaktivní atrapou: testuje se **jedno** vykreslení
 * na jednu odpověď, ne to, jak rychle se stránka ptá.
 */
async function renderPage(fetchImpl) {
  const els = { list: makeElement('list'), conn: makeElement('conn'), foot: makeElement('foot') };
  const sandbox = {
    document: { getElementById: id => els[id] || makeElement(id) },
    fetch: fetchImpl,
    setInterval: () => 0,
    clearInterval: () => {},
    window: {},
    console,
  };
  sandbox.window = sandbox;
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'fetch', 'setInterval', 'clearInterval', 'window', script);
  run(sandbox.document, sandbox.fetch, sandbox.setInterval, sandbox.clearInterval, sandbox.window);
  await flush();
  return { els, sandbox };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const APPROVAL = {
  id: 'ap-desktop-1',
  title: 'Přepsat soubor',
  detail: '/home/u/projekt/config.js',
  subjectType: 'effect.write',
  subjectId: '/home/u/projekt/config.js',
  runId: 'run-42',
  operationRef: 'fs.write:/home/u/projekt/config.js',
  payloadFingerprint: 'a'.repeat(64),
  createdAt: '2026-08-19 12:00:00',
  expiresAt: '2026-09-18 12:00:00',
  expired: false,
  validity: 'precondition',
  preconditionRef: '/home/u/projekt/config.js',
  decidable: true,
};

// ── 1. Prázdná fronta vs. neznámá fronta ───────────────────────────────────

await test('potvrzená prázdná fronta říká „nic nečeká"', async () => {
  const { els } = await renderPage(async () => jsonResponse(200, { approvals: [] }));
  assert.match(els.list.innerHTML, /Nic nečeká/);
  assert.equal(els.conn.textContent, 'připojeno');
});

await test('selhání dotazu NEříká „nic nečeká" — to je povolení odejít od počítače', async () => {
  const { els } = await renderPage(async () => jsonResponse(500, { error: 'Approval queue unavailable' }));
  assert.doesNotMatch(els.list.innerHTML, /Nic nečeká/,
    'stránka po selhání nakreslila klid');
  assert.match(els.list.innerHTML, /nepodařilo načíst/i);
  assert.equal(els.conn.textContent, 'nedostupné');
});

await test('rozbitá odpověď se počítá jako selhání, ne jako prázdno', async () => {
  const { els } = await renderPage(async () => ({
    ok: true, status: 200, text: async () => 'tohle není JSON',
  }));
  assert.doesNotMatch(els.list.innerHTML, /Nic nečeká/);
  assert.match(els.list.innerHTML, /nepodařilo načíst/i);
});

// ── 2. Co je na kartě ──────────────────────────────────────────────────────

await test('karta ukazuje cíl, běh, operaci i otisk', async () => {
  const { els } = await renderPage(async () => jsonResponse(200, { approvals: [APPROVAL] }));
  const html = els.list.innerHTML;
  assert.match(html, /Přepsat soubor/);
  assert.match(html, /config\.js/, 'cesta k cíli chybí — na desktopu je to nejužitečnější věta');
  assert.match(html, /run-42/);
  assert.match(html, /fs\.write:/);
  assert.match(html, /aaaaaaaaaaaa/, 'otisk se neukazuje, takže nejde poznat, o čem se rozhoduje');
});

await test('approval vázaný na cíl nemá odpočet — čas u něj není pravidlo', async () => {
  const { els } = await renderPage(async () => jsonResponse(200, { approvals: [APPROVAL] }));
  assert.match(els.list.innerHTML, /platí, dokud se nezmění cíl/);
  assert.doesNotMatch(els.list.innerHTML, /okno do/,
    'u precondition approvalu se kreslí okno — odpočet je tu mýlka, ne informace');
});

await test('approval s oknem odpočet má', async () => {
  const windowed = { ...APPROVAL, validity: 'window', expiresAt: '2026-08-19 12:05:00' };
  const { els } = await renderPage(async () => jsonResponse(200, { approvals: [windowed] }));
  assert.match(els.list.innerHTML, /okno do/);
});

await test('nerozhodnutelný požadavek se neschovává, ale nejde odsouhlasit (SS-02)', async () => {
  const unbound = { ...APPROVAL, decidable: false };
  const { els } = await renderPage(async () => jsonResponse(200, { approvals: [unbound] }));
  assert.match(els.list.innerHTML, /nejde rozhodnout/i,
    'nerozhodnutelný požadavek zmizel z fronty — pak „nic nečeká" lže');
  assert.doesNotMatch(els.list.innerHTML, /onclick="onDecide/,
    'nerozhodnutelný požadavek nabízí tlačítka, která nic neudělají');
});

// ── 3. Rozhodnutí jde přes skutečnou routu ─────────────────────────────────

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-desktop-ui-'));
const db = new Database(path.join(runtimeDir, 'ui.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

function routes() {
  return createApprovalRoutes({
    db,
    sendJSON: (res, status, body) => { res.status = status; res.body = body; },
    parseBody: async req => req.body,
    sendStaticFile: async () => {},
  });
}

await test('otisk ze seznamu prochází rozhodovací routou beze změny', async () => {
  const payload = { path: '/tmp/x.txt', content: 'obsah' };
  const minted = createMobileApproval(db, {
    id: 'ap-live', origin: 'local', runId: 'run-live', operationRef: 'fs.write:/tmp/x.txt',
    subjectType: 'effect.write', subjectId: '/tmp/x.txt', title: 'Přepsat soubor', payload,
  });

  const r = routes();
  const listRes = {};
  r['GET /api/approvals']({}, listRes);
  const shown = listRes.body.approvals.find(a => a.id === minted.id);
  assert.ok(shown, 'approval není ve frontě, kterou plocha čte');

  // Přesně to, co dělá stránka: vezme otisk, který dostala, a pošle ho zpátky.
  const decideRes = {};
  await r['POST /api/approvals/:id/decide'](
    { body: { decision: 'approve', payloadFingerprint: shown.payloadFingerprint } },
    decideRes, { id: minted.id },
  );

  assert.equal(decideRes.status, 200, `routa odmítla otisk, který sama vydala: ${JSON.stringify(decideRes.body)}`);
  const row = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.equal(row.decision, 'approve');
  assert.equal(row.decided_by, 'desktop');
});

// ── 4. Stránka je dosažitelná a chová se jako plocha ───────────────────────

await test('routa plochy existuje a servíruje stránku', () => {
  const r = routes();
  assert.ok(typeof r['GET /approvals-ui'] === 'function',
    'plocha nemá rozhraní — rozhodovat se dá dál jen curlem');
});

await test('chat ukazuje čekající rozhodnutí tam, kde se pracuje', () => {
  const chat = readFileSync(new URL('../src/chat/chat.html', import.meta.url), 'utf8');
  assert.match(chat, /approvalBar/, 'v chatu není vidět, že něco čeká');
  assert.match(chat, /\/approvals-ui/, 'ukazatel nikam nevede');
  // Do postranní lišty patří počet, ne popis: ten je S2.
  assert.match(chat, /pollApprovals/);
});

await test('stránka nekreslí frontu z paměti po neúspěšném obnovení', async () => {
  // Nejdřív úspěch, pak selhání — a to selhání se vyvolá **v téže instanci
  // stránky**, průchodem přes rozhodnutí, které si samo vyžádá obnovení.
  // Renderovat dvakrát načisto by nedokázalo nic: stará fronta by v paměti ani
  // nebyla.  Je to totéž pravidlo jako `MD-07` na mobilu.
  let call = 0;
  const { els, sandbox } = await renderPage(async (url, opts) => {
    call += 1;
    if (call === 1) return jsonResponse(200, { approvals: [APPROVAL] });
    // Rozhodnutí i následné obnovení selžou.
    return jsonResponse(503, { error: 'down' });
  });

  assert.match(els.list.innerHTML, /Přepsat soubor/, 'první vykreslení frontu neukázalo');
  assert.ok(typeof sandbox.onDecide === 'function', 'stránka nevystavuje rozhodovací akci');

  sandbox.onDecide(APPROVAL.id, 'reject');
  await flush(20);

  assert.ok(call > 1, 'rozhodnutí se vůbec neodeslalo, takže se nic neobnovovalo');
  assert.doesNotMatch(els.list.innerHTML, /Přepsat soubor/,
    'po selhaném obnovení zůstala nakreslená stará fronta a tváří se jako živá');
  assert.match(els.list.innerHTML, /nepodařilo načíst/i);
});


await test('M1-d propadlý a zrušený approval nejsou zamítnutí člověkem', async () => {
  // Skript stránky se spustí a rozhodne; server odpoví replayem s neosobním
  // koncem.  Uživatel nesmí odejít s dojmem, že to někdo zamítl.
  for (const [state, musi, nesmi] of [
    ['invalidated', /Propadlo/i, /Zamítnuto/i],
    ['cancelled', /Zrušeno/i, /Zamítnuto/i],
  ]) {
    let call = 0;
    const { els, sandbox } = await renderPage(async () => {
      call += 1;
      if (call === 1) return jsonResponse(200, { approvals: [APPROVAL] });
      if (call === 2) return jsonResponse(200, { replay: true, decision: state, state });
      return jsonResponse(200, { approvals: [] });
    });
    sandbox.onDecide(APPROVAL.id, 'approve');
    await flush(20);

    assert.match(els.list.innerHTML, musi, `${state} se neukázal jako ${state}`);
    assert.doesNotMatch(els.list.innerHTML, nesmi,
      `${state} se vydává za zamítnutí člověkem`);
    assert.match(els.list.innerHTML, /Nikdo to nezamítl/i,
      `chybí věta, která brání domyslet si zamítnutí (${state})`);
  }
});

await test('M1-d rozhodnutí člověkem jinde říká kdo', async () => {
  let call = 0;
  const { els, sandbox } = await renderPage(async () => {
    call += 1;
    if (call === 1) return jsonResponse(200, { approvals: [APPROVAL] });
    if (call === 2) {
      return jsonResponse(200, {
        replay: true, decision: 'reject', state: 'reject', decidedBy: 'device-telefon',
      });
    }
    return jsonResponse(200, { approvals: [] });
  });
  sandbox.onDecide(APPROVAL.id, 'approve');
  await flush(20);

  assert.match(els.list.innerHTML, /Zamítnuto jinde/i);
  assert.match(els.list.innerHTML, /device-telefon/);
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nRozhodovací plocha: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
