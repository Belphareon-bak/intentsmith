// Browser-level accessibility — the limit every other mobile UI suite records.
// ==============================================================================
//
// `tests/mobile-trust-bar.test.js`, `mobile-overview`, `mobile-navbar`,
// `mobile-run-silence` and `mobile-ms20-ui` all end with the same paragraph:
// *"there is no browser here.  Contrast, the real dp band, focus order and what
// a screen reader actually says remain unverified"* (`F-043`).  They assert the
// contract in the markup and the stylesheet, which is the right thing to assert
// without a renderer — but four requirements in `UI-DESIGN.md` §8 and §10 are
// not statements about markup at all:
//
//   * **§10 contrast** — 4.5:1 for text, in *both* modes.  A ratio is a fact
//     about two resolved colours over a resolved background stack; a stylesheet
//     that mentions `var(--text-faint)` says nothing about it.
//   * **§8 touch targets** — 48 × 48 dp.  A rule with `padding: 7px 13px` does
//     not tell you the box it produces.
//   * **§4 the bar pushes, never covers** — that is geometry.
//   * **§10 screen reader** — the accessible *name* of the trust bar, and
//     whether a nav item outside the viewport is still in the tree, are
//     computed by the browser from ARIA plus layout, not read off the HTML.
//
// This suite renders the real client in Chrome and measures those four.  What
// it found on the first run is recorded in `WP-MOBILE-027-RESULT.md` §7: six
// contrast failures (down to 2.88:1) and two targets under 48 dp, none of which
// any markup assertion could have seen.
//
// **Fail-closed** (`TEST-STRATEGY.md` §5, condition 1; `G0-R016`).  No browser
// means a non-zero exit and a named prerequisite, never "skipped, therefore
// green".  The registry row carries `state: BLOCKED` with
// `requirements.toolchain: ["chromium-runtime"]` for exactly that reason
// (condition 5: a suite that needs a toolchain the ordinary run does not have
// is not `offline`).
//
// **What this still does not prove.**  A headless Chrome is not a phone.  It
// does not prove what VoiceOver or TalkBack say out loud, how the bar behaves
// under a real OS font setting (see the last test — the client is px-based, so
// it does not respond to one at all), or anything about iOS Safari.  Contrast
// here is computed for opaque and alpha-composited backgrounds; a colour behind
// `backdrop-filter` is approximated by the stack underneath it.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLIENT = path.join(ROOT, 'src/mobile/client');

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

// ── Prerequisite, fail-closed ───────────────────────────────────────────────
//
// Both halves are checked before anything else runs: the module has to import
// *and* the browser it points at has to exist on disk.  A cache that was never
// populated is the common case on a fresh clone, and it must not read as green.

function prerequisiteMissing(reason) {
  console.log('\n=== Mobile browser accessibility ===');
  console.log(`  BLOCKED: ${reason}`);
  console.log('  prerequisite: chromium-runtime (npx puppeteer browsers install chrome)');
  console.log('\nMobile browser accessibility: 0 passed, prerequisite missing');
  process.exit(1);
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch (error) {
  prerequisiteMissing(`puppeteer is not installed (${error.code || error.message})`);
}

let executablePath;
try {
  executablePath = puppeteer.executablePath();
} catch (error) {
  prerequisiteMissing(`puppeteer cannot resolve a browser (${error.message})`);
}
if (!fs.existsSync(executablePath)) {
  prerequisiteMissing(`no browser at ${executablePath}`);
}

// ── The client, served the way the gateway serves it ────────────────────────
//
// `index.html` links `/app.css` and `/app.js` absolutely and the client is an
// ES module, so `file://` cannot load it.  A loopback static server is the same
// shape the gateway uses and reaches nothing outside this machine.  Every path
// that is not a client file answers 503, so a request that escapes the fixture
// fails loudly instead of quietly returning data the test did not intend.

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const full = path.join(CLIENT, url === '/' ? '/index.html' : url);
  if (!full.startsWith(CLIENT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NO_BACKEND', message: 'the fixture serves files only' } }));
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
// A 390 × 844 CSS-pixel phone at dpr 3 — dp and CSS px coincide, which is what
// lets §8's "48 dp" be checked as 48 units of `getBoundingClientRect()`.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
await page.evaluate(async (base) => {
  // The module registry is shared with the one index.html loaded, so this is
  // the running app's own state, not a second copy of it.
  window.__is = (await import(`${base}/app.js`)).__ms20;
}, origin);

// ── Measurement, evaluated in the page ──────────────────────────────────────

const MEASURE = `
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (value) => {
    const m = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
  // Walk up compositing every translucent layer until an opaque one is found —
  // the bar and the navbar both sit on colour-mix() surfaces, so "the parent's
  // background" is not the colour that is actually behind the text.
  const effectiveBg = (el) => {
    const stack = [];
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      node = node.parentElement;
    }
    let base = [255, 255, 255];
    const last = stack[stack.length - 1];
    if (last && last.a === 1) { base = last.rgb; stack.pop(); }
    for (const layer of stack.reverse()) base = over(layer, base);
    return base;
  };
  const ratio = (a, b) => {
    const l1 = luminance(a), l2 = luminance(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
    return el.tagName.toLowerCase() + cls;
  };
  const round = (n) => Math.round(n * 100) / 100;
`;

// Wrapped in an IIFE: `page.evaluate(string)` runs at global scope, so a bare
// `const` would collide with itself on the second surface.
const CONTRAST = `(() => {
  ${MEASURE}
  const issues = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (!visible(el)) continue;
    // Only elements owning a text node: an ancestor's colour is the child's
    // problem, and counting both would report one failure twice.
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    // WCAG "large text": 24 px, or 18.66 px when bold.
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const value = ratio(over(fg, bg), bg);
    if (value + 0.005 < need) {
      issues.push(label(el) + ' "' + el.textContent.trim().slice(0, 30) + '" ' + round(size) + 'px = ' + round(value) + ':1 < ' + need);
    }
  }
  return issues;
})()`;

const TARGETS = `(() => {
  ${MEASURE}
  const small = [];
  for (const el of document.body.querySelectorAll('button, a[href], [role="button"], [role="tab"], input, select, textarea')) {
    if (!visible(el)) continue;
    // A locked item is deliberately not tappable (§3.1), so it is not a target.
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 48 || r.height < 48) {
      small.push(label(el) + ' "' + (el.textContent || '').trim().slice(0, 24) + '" ' + Math.round(r.width) + '×' + Math.round(r.height));
    }
  }
  return small;
})()
`;

// ── Fixtures ────────────────────────────────────────────────────────────────

const ACTIVATE = `(() => {
  const S = window.__is;
  localStorage.clear();
  S.store.set(S.K.token, 'token');
  S.store.set(S.K.device, 'device-1');
  S.store.set(S.K.scopes, ['read:chat', 'write:chat', 'read:notifications', 'read:approvals', 'write:approvals']);
  Object.assign(S.state, {
    session: 'active', conn: 'ok', drawer: false, conversationId: null, sending: false,
    data: {}, loading: {}, error: {}, cacheAge: {}, cacheAt: {}, serverOffsetMs: 0, unread: 0,
    opsLookup: {}, opsNote: {}, approvalsGone: {}, approvalAttempts: {},
  });
  S.state.data.conversations = [{ id: 'c-1', title: 'Refaktor gateway', messageCount: 12, updatedAt: Date.now() - 60000 }];
  S.state.data.approvals = [{
    id: 'ap-1', title: 'Zapsat soubor do repozitáře', subjectType: 'file.write', subjectId: 'src/x.js',
    createdAt: Date.now() - 120000, expiresAt: new Date(Date.now() + 12 * 60000).toISOString(),
    expired: false, payloadFingerprint: 'f'.repeat(64),
  }];
  S.state.data.operations = [{
    deviceId: 'device-1', operationId: 'o'.repeat(20), operationType: 'chat.send',
    state: 'PENDING', createdAt: new Date(Date.now() - 90000).toISOString(),
  }];
})()`;

const SURFACES = [
  ['Přehled (kořen)', `window.__is.state.route = 'overview'; window.__is.render();`],
  ['Konverzace', `window.__is.state.route = 'conversations'; window.__is.render();`],
  ['MS-13 approvaly', `window.__is.state.route = 'approvals'; window.__is.render();`],
  ['MS-14 rozhodnutí', `window.__is.state.route = 'approval'; window.__is.state.approvalId = 'ap-1'; window.__is.render();`],
  ['MS-20 operace', `window.__is.state.route = 'operations'; window.__is.render();`],
  ['trust bar — offline a starší data', `
    window.__is.state.route = 'conversations';
    window.__is.state.conn = 'offline';
    window.__is.state.cacheAge.conversations = 'STALE';
    window.__is.state.cacheAt.conversations = Date.now() - 900000;
    window.__is.render();`],
  // MS-07 with a partial window: the SS-03 boundary control is a real touch
  // target and a real piece of muted text, so it is measured like any other.
  ['MS-07 okno historie — lze načíst starší', `
    window.__is.state.route = 'chat';
    window.__is.state.conn = 'ok';
    window.__is.state.conversationId = 'c1';
    window.__is.state.data.thread = {
      conversation: { id: 'c1', title: 'Dlouhá konverzace' },
      messages: [
        { id: '201', role: 'user', content: 'starší zpráva' },
        { id: '202', role: 'assistant', content: 'odpověď' },
      ],
    };
    window.__is.state.thread = { cursor: 'c1.abc.def', end: false, loadingOlder: false };
    window.__is.render();`],
  ['MS-07 okno historie — začátek konverzace', `
    window.__is.state.route = 'chat';
    window.__is.state.thread = { cursor: null, end: true, loadingOlder: false };
    window.__is.render();`],
];

async function onEachSurface(collect) {
  const found = [];
  await page.evaluate(ACTIVATE);
  for (const [name, setup] of SURFACES) {
    await page.evaluate(setup);
    const issues = await page.evaluate(collect);
    for (const issue of issues) found.push(`${name} — ${issue}`);
  }
  return found;
}

console.log('\n=== Mobile browser accessibility (UI-DESIGN §4, §8, §10) ===');
console.log(`  chrome: ${executablePath}`);

try {
  // ── §10 contrast ──────────────────────────────────────────────────────────

  for (const theme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    const issues = await onEachSurface(CONTRAST);
    await test(`§10 kontrast 4.5:1 na každém textu — režim ${theme}`, () => {
      assert.deepEqual(issues, [],
        `§8 says the muted role is "nikdy pod 4.5:1" and §10 repeats it for every text; both modes are equal, not derived`);
    });
  }
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // ── §8 touch targets ──────────────────────────────────────────────────────

  await test('§8 každý aktivní dotykový cíl má aspoň 48 × 48 dp', async () => {
    const small = await onEachSurface(TARGETS);
    assert.deepEqual(small, [], 'a control smaller than the floor is a miss the user pays for, not a style choice');
  });

  await test('§8 rozhodovací tlačítka MS-14 mají 56 dp na výšku a 12 dp mezeru', async () => {
    await page.evaluate(ACTIVATE);
    // `approvalDecidable` fails closed on `unverified` (B3 / `F-100`): until the
    // queue has been confirmed against the server there are no decision
    // controls to measure.  Granting that is the fixture's job, not a relaxation
    // of the gate — the gate itself is `mobile-ms14-decision`'s subject.
    await page.evaluate(`
      window.__is.state.route = 'approval';
      window.__is.state.approvalId = 'ap-1';
      window.__is.state.approvalVerifiedAt = Date.now();
      window.__is.render();
    `);
    const geometry = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-act="approval-approve"], [data-act="approval-reject"]')]
        .filter(b => b.getBoundingClientRect().height > 0);
      const rects = buttons.map(b => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim().slice(0, 20), top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; });
      let gap = null;
      if (rects.length >= 2) {
        const [a, b] = rects;
        gap = a.bottom <= b.top ? b.top - a.bottom : (a.right <= b.left ? b.left - a.right : 0);
      }
      return { count: rects.length, rects, gap };
    });
    assert.ok(geometry.count >= 2, `MS-14 must offer both decisions; found ${geometry.count}`);
    for (const rect of geometry.rects) {
      assert.ok(rect.h >= 56, `"${rect.text}" is ${Math.round(rect.h)} dp tall, §8 wants 56`);
    }
    assert.ok(geometry.gap >= 12, `§8 wants 12 dp between them so the thumb cannot miss; measured ${Math.round(geometry.gap)}`);
  });

  // ── §4 the bar pushes, never covers ───────────────────────────────────────

  await test('§4 trust bar posouvá obsah, nepřekrývá ho', async () => {
    await page.evaluate(ACTIVATE);
    const geometry = await page.evaluate(() => {
      const S = window.__is;
      const contentTop = () => document.querySelector('.scroll')?.getBoundingClientRect().top ?? null;
      S.state.route = 'conversations';
      S.render();
      const clean = { bar: !!document.querySelector('.trust-bar'), content: contentTop() };
      S.state.conn = 'offline';
      S.state.cacheAge.conversations = 'STALE';
      S.render();
      const bar = document.querySelector('.trust-bar');
      const rect = bar.getBoundingClientRect();
      const header = document.querySelector('header')?.getBoundingClientRect();
      return {
        clean,
        position: getComputedStyle(bar).position,
        barTop: rect.top, barHeight: rect.height,
        headerBottom: header ? header.bottom : null,
        content: contentTop(),
      };
    });
    assert.equal(geometry.clean.bar, false, '§4.1 — fresh, online and unlocked renders no bar at all');
    assert.equal(geometry.position, 'static',
      'a fixed or absolute bar would sit *over* the content; §4 says it pushes');
    assert.ok(Math.abs(geometry.barTop - geometry.headerBottom) < 1,
      `the bar belongs directly under the header (bar ${geometry.barTop}, header ends ${geometry.headerBottom})`);
    assert.ok(geometry.barHeight >= 32, `§4 asks for a 32 dp band; measured ${Math.round(geometry.barHeight)}`);
    // The load-bearing one: content moved down by exactly the bar, so nothing
    // is hidden underneath it.
    const pushed = geometry.content - geometry.clean.content;
    assert.ok(Math.abs(pushed - geometry.barHeight) < 1,
      `content moved ${Math.round(pushed)} dp for a ${Math.round(geometry.barHeight)} dp bar — the difference is what it covers`);
  });

  await test('§4.1 prázdný trust bar nezabírá ani pixel', async () => {
    await page.evaluate(ACTIVATE);
    const height = await page.evaluate(() => {
      const S = window.__is;
      S.state.route = 'conversations';
      S.render();
      const bar = document.querySelector('.trust-bar');
      return bar ? bar.getBoundingClientRect().height : 0;
    });
    assert.equal(height, 0, '§4.1 "nenápadná" is zero height, not an empty strip');
  });

  // ── §10 what a screen reader is handed ────────────────────────────────────

  await test('§10 trust bar se čtečce ohlásí jednou větou o všech třech zónách', async () => {
    await page.evaluate(ACTIVATE);
    await page.evaluate(`
      const S = window.__is;
      S.state.route = 'chat';
      S.state.conversationId = 'c-1';
      S.state.conn = 'offline';
      S.state.cacheAge.thread = 'STALE';
      S.store.set(S.K.scopes, ['read:chat']);
      S.render();
    `);
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.trust-bar');
      return el ? { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), name: el.getAttribute('aria-label') } : null;
    });
    assert.ok(bar, 'offline + stale + a missing scope must raise the bar');
    assert.equal(bar.role, 'status', '§10 — the bar is a status region, so a change is announced');
    assert.equal(bar.live, 'polite', 'it must not interrupt; it is context, not an alert');

    const snapshot = await page.accessibility.snapshot();
    const flat = [];
    (function walk(node) { if (!node) return; flat.push(node); (node.children || []).forEach(walk); })(snapshot);
    const status = flat.find(node => node.role === 'status');
    assert.ok(status, 'the bar must reach the accessibility tree, not just the DOM');
    // §10 names the shape outright: "offline, data z 14:02, část obrazovky
    // uzamčena".  A name that drops a zone is a zone the user never hears.
    assert.match(status.name, /sít|offline/i, 'zone 1 (connection) is missing from the announced name');
    assert.match(status.name, /data|starší/i, 'zone 2 (age) is missing from the announced name');
    assert.match(status.name, /uzamčen/i, 'zone 3 (lock) is missing from the announced name');
    assert.equal(status.name, bar.name, 'the announced name must be the summary, not the visual text order');
  });

  await test('§3.1 každá položka lišty je ve stromu přístupnosti i mimo viewport', async () => {
    await page.evaluate(ACTIVATE);
    await page.evaluate(`window.__is.state.route = 'conversations'; window.__is.render();`);
    const layout = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.nav-tab')];
      return {
        total: tabs.length,
        outside: tabs.filter(t => { const r = t.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; })
          .map(t => t.textContent.trim()),
      };
    });
    // If everything happened to fit, the test would pass without testing
    // anything — say so rather than quietly proving nothing.
    assert.ok(layout.outside.length > 0,
      'no item is off-viewport at 390 dp, so this assertion is vacuous — widen the fixture');

    const snapshot = await page.accessibility.snapshot();
    const flat = [];
    (function walk(node) { if (!node) return; flat.push(node); (node.children || []).forEach(walk); })(snapshot);
    const tabs = flat.filter(node => node.role === 'tab');
    assert.equal(tabs.length, layout.total,
      `${layout.total} items in the bar, ${tabs.length} in the tree — an item that scrolled out must not leave it`);
    const selected = tabs.filter(node => node.selected);
    assert.equal(selected.length, 1, '§3.3 — exactly one item is highlighted, never zero and never two');
    assert.equal(selected[0].name.startsWith('Konverzace'), true,
      `the selected item must be the current section, got "${selected[0].name}"`);
  });

  await test('§10 zvýraznění v liště nese text i tvar, ne jen barvu', async () => {
    const styles = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.nav-tab')];
      const read = (el) => {
        const s = getComputedStyle(el);
        return { weight: s.fontWeight, borderTop: s.borderTopWidth, borderColor: s.borderTopColor, color: s.color };
      };
      const current = tabs.find(t => t.getAttribute('aria-current') === 'page');
      const other = tabs.find(t => t !== current && t.getAttribute('aria-disabled') !== 'true');
      return { current: read(current), other: read(other) };
    });
    assert.notEqual(styles.current.weight, styles.other.weight,
      '§10 — greyscale must still show which item is selected; weight is the text half');
    assert.notEqual(styles.current.borderColor, styles.other.borderColor,
      'the rule above the label is the shape half');
  });

  await test('§3.3 fokus na položku mimo viewport ji odscrolluje do viditelna', async () => {
    const moved = await page.evaluate(async () => {
      const track = document.querySelector('.navbar-track');
      const tabs = [...document.querySelectorAll('.nav-tab')];
      const hidden = tabs.find(t => t.getBoundingClientRect().right > window.innerWidth + 1);
      if (!hidden) return { skipped: true };
      const before = hidden.getBoundingClientRect().right;
      hidden.focus();
      await new Promise(r => setTimeout(r, 250));
      const after = hidden.getBoundingClientRect().right;
      return { skipped: false, before, after, width: window.innerWidth, scrollLeft: track.scrollLeft, focused: document.activeElement === hidden };
    });
    assert.equal(moved.skipped, false, 'nothing was off-viewport to focus');
    assert.equal(moved.focused, true, 'the item must be focusable at all — it is a real control');
    assert.ok(moved.after <= moved.width + 1,
      `focus left the item off-screen (right edge ${Math.round(moved.after)} of ${moved.width}); a keyboard or switch user cannot see what they are on`);
  });

  // ── §10 dynamic type — recorded, not asserted away ────────────────────────

  await test('§10 OTEVŘENÉ: klient je v px, takže na 200 % písma nereaguje', async () => {
    const client = await page.createCDPSession();
    const sizes = async (standard) => {
      await client.send('Page.setFontSizes', { fontSizes: { standard, fixed: standard } });
      return page.evaluate(() => ({
        root: getComputedStyle(document.documentElement).fontSize,
        body: getComputedStyle(document.body).fontSize,
        rowTime: (() => { const el = document.querySelector('.row-time, .ov-row-time'); return el ? getComputedStyle(el).fontSize : null; })(),
      }));
    };
    await page.evaluate(ACTIVATE);
    await page.evaluate(`window.__is.state.route = 'conversations'; window.__is.render();`);
    const at100 = await sizes(16);
    const at200 = await sizes(32);
    await client.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 16 } });

    assert.equal(at100.root, '16px');
    assert.equal(at200.root, '32px', 'the browser preference did not apply — the probe itself is broken');

    // This is a *characterisation* test, the same device the F-100 producer
    // test uses: it pins today's truth so the day someone converts the
    // stylesheet to rem, this fails and the finding gets reclassified instead
    // of quietly staying "open" next to code that fixed it.
    assert.equal(at200.body, '16px',
      'body now follows the browser font size — the client became scalable, reclassify the §10 dynamic-type gap');
    assert.equal(at200.rowTime, at100.rowTime,
      'component type now scales — reclassify the §10 dynamic-type gap and delete this test');
  });

  await test('žádná chyba v konzoli během celé sady', () => {
    assert.deepEqual(pageErrors, [], 'a page error means the measurements above ran against a half-rendered app');
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\nMobile browser accessibility: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
