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
// green".  Since MM5-D the registry row is `ACTIVE`, retains
// `requirements.toolchain: ["chromium-runtime"]`, and makes that runtime a hard
// prerequisite of the mobile gate.  A fresh host provisions the browser version
// resolved by the installed Puppeteer package with `npm run mobile:a11y:setup`;
// absence or launch failure stops the gate.
//
// **What this still does not prove.**  A headless Chrome is not a phone.  It
// does not prove what VoiceOver or TalkBack say out loud, how the bar behaves
// under a real OS font setting (the browser-level 200% simulation is not that),
// or anything about iOS Safari.  Contrast
// here is computed for opaque and alpha-composited backgrounds; a colour behind
// `backdrop-filter` is approximated by the stack underneath it.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

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
    // Selection and theme colours transition for 120 ms.  Measuring during
    // that interpolation compares the new background with the old foreground
    // and fabricates a contrast failure that no settled frame contains.
    await new Promise(resolve => setTimeout(resolve, 160));
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

  // ── MR-05 · SS-03 — reading into the past must not move the reader ────────
  //
  // Only measurable here.  `render()` replaces the whole screen, so prepending
  // a page of older messages and then restoring the scroll position is a real
  // layout operation; from markup it is invisible either way.

  await test('MR-05 dotažení starších zpráv nechá čtenáře na místě', async () => {
    await page.evaluate(ACTIVATE);
    const measured = await page.evaluate(() => {
      const S = window.__is;
      const message = n => ({ id: String(n), role: n % 2 ? 'user' : 'assistant', content: `zpráva ${n}` });
      const range = (from, to) =>
        Array.from({ length: to - from + 1 }, (_, i) => message(from + i));

      S.state.route = 'chat';
      S.state.conn = 'ok';
      S.state.conversationId = 'c1';
      S.state.data.thread = { conversation: { id: 'c1', title: 'Dlouhá' }, messages: range(201, 250) };
      S.state.thread = { cursor: 'c1.a.b', end: false, loadingOlder: false, stickToBottom: true };
      S.render();

      // The reader scrolls back to the older edge and starts reading there.
      const scroll = document.getElementById('thread-scroll');
      scroll.scrollTop = 0;
      const anchoredOn = scroll.scrollHeight - scroll.scrollTop;

      // A page of older messages arrives, exactly as loadOlderMessages lands it.
      S.state.data.thread = {
        conversation: S.state.data.thread.conversation,
        messages: [...range(151, 200), ...S.state.data.thread.messages],
      };
      S.state.thread = { cursor: 'c1.c.d', end: false, loadingOlder: false, stickToBottom: false };
      S.render();

      const after = document.getElementById('thread-scroll');
      return {
        fromBottomBefore: anchoredOn,
        fromBottomAfter: after.scrollHeight - after.scrollTop,
        scrollTop: after.scrollTop,
        grew: after.scrollHeight,
      };
    });

    assert.ok(measured.grew > measured.fromBottomBefore,
      'the prepended page must actually make the thread taller');
    assert.ok(Math.abs(measured.fromBottomAfter - measured.fromBottomBefore) < 2,
      `the reading position moved: ${Math.round(measured.fromBottomBefore)} dp from the bottom `
      + `became ${Math.round(measured.fromBottomAfter)}`);
    assert.ok(measured.scrollTop > 0,
      'the view must sit below the newly prepended messages, not back at the top');
  });

  await test('MR-05 otevření konverzace naopak ukáže nejnovější zprávu', async () => {
    await page.evaluate(ACTIVATE);
    const atBottom = await page.evaluate(() => {
      const S = window.__is;
      S.state.route = 'chat';
      S.state.conversationId = 'c1';
      S.state.data.thread = {
        conversation: { id: 'c1', title: 'Dlouhá' },
        messages: Array.from({ length: 50 }, (_, i) => ({
          id: String(i + 201), role: i % 2 ? 'user' : 'assistant', content: `zpráva ${i + 201}`,
        })),
      };
      S.state.thread = { cursor: 'c1.a.b', end: false, loadingOlder: false, stickToBottom: true };
      S.render();
      const scroll = document.getElementById('thread-scroll');
      return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    });
    assert.ok(atBottom < 2, `opening a thread must land on the newest message, was ${atBottom} dp short`);
  });

  await test('MR-05 doscrollování k hornímu okraji dotáhne starší zprávy samo', async () => {
    // The behaviour every chat has.  Only provable here: it depends on a real
    // scroller emitting a real scroll event to a capture-phase listener.
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      // Keep the browser fixture on the same exact public DTO boundary as the
      // client.  MM3-I made thread pages fail closed on missing/private fields;
      // a shorthand rendering fixture here would therefore test protocol
      // rejection instead of the real scroll-triggered paging behaviour.
      const message = number => ({
        id: String(number),
        role: number % 2 ? 'user' : 'assistant',
        content: `zpráva ${number}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, number)).toISOString(),
        metadata: null,
        version: `v1:message-${number}`,
      });
      const range = (from, to) => Array.from(
        { length: to - from + 1 }, (_, i) => message(from + i));
      const conversation = {
        id: 'c1', title: 'Dlouhá', messageCount: 200, state: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T01:00:00.000Z',
        version: 'v1:conversation-c1',
      };

      const requests = [];
      const realFetch = window.fetch;
      window.fetch = async (url, options) => {
        requests.push(String(url));
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            ok: true, protocolVersion: 'm1.2026-07-30', scopes: ['read:chat'],
            hasMore: true, nextCursor: 'c1.next.page', end: false, direction: 'backward',
            data: {
              conversation,
              messages: range(101, 150),
            },
          }),
        };
      };

      try {
        S.state.route = 'chat';
        S.state.conn = 'ok';
        S.state.conversationId = 'c1';
        S.state.data.thread = {
          conversation,
          messages: range(151, 200),
        };
        S.state.thread = { cursor: 'c1.a.b', end: false, loadingOlder: false, stickToBottom: true };
        S.render();

        const scroll = document.getElementById('thread-scroll');
        const before = S.state.data.thread.messages.length;

        // The reader scrolls up to the older edge.  Nothing is tapped.
        scroll.scrollTop = 0;
        scroll.dispatchEvent(new Event('scroll', { bubbles: false }));
        await new Promise(resolve => setTimeout(resolve, 120));

        return {
          before,
          after: S.state.data.thread.messages.length,
          requests: requests.length,
          carriedCursor: requests.some(url => url.includes('cursor=c1.a.b')),
          oldestNow: S.state.data.thread.messages[0].content,
        };
      } finally {
        window.fetch = realFetch;
      }
    });

    assert.equal(outcome.requests, 1, 'scrolling to the top asks once, not per event');
    assert.ok(outcome.carriedCursor, 'the request must follow the cursor the server issued');
    assert.equal(outcome.after, outcome.before + 50, 'the older page must be added');
    assert.equal(outcome.oldestNow, 'zpráva 101', 'and prepended, not appended');
  });

  // ── §3.1 the ring turns only when there is something to turn ──────────────

  await test('§3.1 aktivní polo\u017eka je v\u017edy uprost\u0159ed, i kdy\u017e se cel\xe1 li\u0161ta vejde', async () => {
    // The rule the operator gave: read the middle, not a position.  An earlier
    // version skipped the turning whenever the set fitted on screen, which is
    // the opposite of it.
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      const offCentre = () => {
        const track = document.querySelector('.navbar-track');
        const sel = track.querySelector('[aria-current="page"]:not([data-clone])');
        const tr = track.getBoundingClientRect();
        const sr = sel.getBoundingClientRect();
        return Math.round((sr.left + sr.width / 2) - (tr.left + tr.width / 2));
      };
      const seen = [];
      for (const route of ['conversations', 'approvals', 'diagnostics', 'conversations']) {
        S.navigate(route);
        await new Promise(r => setTimeout(r, 700));
        seen.push({ route, off: offCentre() });
      }
      const track = document.querySelector('.navbar-track');
      const tabs = [...track.children].filter(c => !c.dataset.clone);
      const setWidth = tabs.reduce((sum, t) => sum + t.getBoundingClientRect().width, 0)
        + (tabs.length - 1) * 2;
      return { seen, ring: track.dataset.ring, fits: setWidth <= track.clientWidth };
    });

    assert.equal(outcome.fits, true, 'precondition: this set does fit, and must turn anyway');
    assert.equal(outcome.ring, 'on', 'the bar is always a ring');
    for (const step of outcome.seen) {
      assert.ok(Math.abs(step.off) <= 2,
        `${step.route}: the active item sat ${step.off} dp off the middle`);
    }
  });

  await test('§3.1 smy\u010dka je uzav\u0159en\xe1 — za posledn\xed polo\u017ekou p\u0159ich\xe1z\xed prvn\xed', async () => {
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      S.navigate('conversations');
      await new Promise(r => setTimeout(r, 600));
      const track = document.querySelector('.navbar-track');
      const nodes = [...track.querySelectorAll('[data-nav]')];
      const real = nodes.filter(t => !t.dataset.clone).map(t => t.dataset.nav);
      // Clones carry the same `data-nav` as the item they copy, so the boundary
      // is found by the clone flag, never by searching for the id.
      const firstReal = nodes.findIndex(t => !t.dataset.clone);
      const before = nodes.slice(0, firstReal).map(t => t.dataset.nav);
      return {
        real, clones: track.querySelectorAll('[data-clone]').length,
        before: before.join(','),
        wraps: before.length > 0 && before.length % real.length === 0
          && before.every((id, i) => id === real[i % real.length]),
        snap: getComputedStyle(track).scrollSnapType,
        gate: !!document.querySelector('.navbar-gate'),
      };
    });

    assert.ok(outcome.clones >= outcome.real.length * 2,
      'a closed loop needs a full copy on each side');
    assert.equal(outcome.wraps, true,
      `the run before the real set must be whole copies of it, was "${outcome.before}"`);
    assert.equal(outcome.snap, 'x mandatory', 'turning is native snapping, not scripted animation');
    assert.equal(outcome.gate, true, 'the middle is a fixed frame the items travel through');
  });

  await test('§3.1 oto\u010den\xed li\u0161ty prstem p\u0159epne sekci podle st\u0159edu', async () => {
    // "Active is always in the middle, and the rest of the app follows it."
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      S.navigate('conversations');
      await new Promise(r => setTimeout(r, 700));
      const track = document.querySelector('.navbar-track');
      const before = S.state.route;
      track.scrollLeft = track.scrollLeft + 90;
      track.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 800));
      return { before, after: S.state.route };
    });
    assert.notEqual(outcome.after, outcome.before,
      'what comes to rest in the middle must become the current section');
  });

  await test('§3.1 přebývající položky lištu promění v prstenec', async () => {
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      S.navigate('conversations');
      await new Promise(r => setTimeout(r, 300));
      const track = document.querySelector('.navbar-track');
      // Narrow the bar rather than invent capabilities: same measurement, same
      // code path, no pretend scopes.
      track.style.maxWidth = '200px';
      S.layoutNavRing(track);
      await new Promise(r => setTimeout(r, 600));

      const clones = track.querySelectorAll('[data-clone]').length;
      const hiddenClones = [...track.querySelectorAll('[data-clone]')]
        .every(c => c.getAttribute('aria-hidden') === 'true' && c.getAttribute('tabindex') === '-1');
      const selected = track.querySelector('[aria-current="page"]:not([data-clone])');
      const sr = selected.getBoundingClientRect();
      const tr = track.getBoundingClientRect();
      const result = {
        ring: track.dataset.ring, clones, hiddenClones,
        offCentre: Math.round(Math.abs((sr.left + sr.width / 2) - (tr.left + tr.width / 2))),
      };
      track.style.maxWidth = '';
      S.layoutNavRing(track);
      return result;
    });

    assert.equal(outcome.ring, 'on', 'a crowded bar must turn');
    assert.ok(outcome.clones > 0, 'the ring needs material on both sides to be continuous');
    assert.equal(outcome.hiddenClones, true,
      'a screen reader must hear each section once, not three times');
    assert.ok(outcome.offCentre <= 3,
      `the chosen item must reach the middle, was ${outcome.offCentre} dp off`);
  });

  await test('§3.1 překreslení nesmí lištu vrátit na začátek', async () => {
    // The bar was rebuilt on every render, which reset its scroll to zero and
    // animated back — once a second while anything was in flight, and it undid
    // any scrolling done by hand.
    await page.evaluate(ACTIVATE);
    const outcome = await page.evaluate(async () => {
      const S = window.__is;
      S.navigate('conversations');
      await new Promise(r => setTimeout(r, 400));
      const track = () => document.querySelector('.navbar-track');
      const before = track();
      S.render();
      await new Promise(r => setTimeout(r, 50));
      return {
        elementSurvived: before === track(),
        selectionStillMarked: !!track().querySelector('[aria-current="page"]:not([data-clone])'),
      };
    });
    assert.equal(outcome.elementSurvived, true,
      'an unchanged item set must not be rebuilt — that is what lost the position');
    assert.equal(outcome.selectionStillMarked, true, 'and the highlight must survive it');
  });

  await test('§10 popisky lišty po ustálení motivu drží kontrast 4.5:1', async () => {
    // Theme and selection changes animate the foreground for 120 ms.  The old
    // characterisation sampled that transition immediately after turning the
    // background dark, mixed a light-theme foreground with a dark-theme
    // background, then called the resulting 2.2:1 an open product defect.
    // Measure a settled frame, as the complete contrast sweep above now does.
    await page.evaluate(ACTIVATE);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.evaluate(`window.__is.state.route = 'conversations'; window.__is.render();`);
    await new Promise(resolve => setTimeout(resolve, 160));
    const measured = await page.evaluate(`(() => {
      ${MEASURE}
      return [...document.querySelectorAll('.nav-tab-label')]
        .filter(visible)
        .map(el => {
          const fg = parse(getComputedStyle(el).color);
          const bg = effectiveBg(el);
          return { text: el.textContent.trim(), ratio: round(ratio(over(fg, bg), bg)) };
        });
    })()`);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    assert.ok(measured.length >= 2, 'the labels must be on screen at all — that was the bar bug');
    assert.deepEqual(measured.filter(item => item.ratio < 4.5), [],
      `every visible label needs 4.5:1 after the transition settles: ${JSON.stringify(measured)}`);
  });

  await test('§3.1 prstenec se ot\xe1\u010d\xed i v \u0161irok\xe9m okn\u011b, ne jen na telefonu', async () => {
    // The defect this pins, from the operator's recording: in a wide window the
    // bar would not switch at all and Nastavení stayed put.  Three sets of items
    // are 1088 dp; against an 854 dp viewport that leaves 234 dp of travel —
    // less than one set — so the ring could not bring an arbitrary item to the
    // middle.  It ran out of scroll, the last item stayed pinned 20 dp off
    // centre, and since the middle decides the section, whatever was stuck
    // there pulled every navigation back to itself.
    //
    // The number of copies is therefore measured against the viewport, and this
    // walks the ring at the width where it used to fail.
    await page.setViewport({ width: 854, height: 480, deviceScaleFactor: 1 });
    await page.evaluate(async (base) => {
      window.__is = (await import(`${base}/app.js`)).__ms20;
    }, origin);
    await page.evaluate(ACTIVATE);

    const wrong = await page.evaluate(async () => {
      const S = window.__is;
      const expected = { conversations: 'conversations', approvals: 'approvals', diagnostics: 'settings', overview: 'overview' };
      const bad = [];
      for (const route of ['conversations', 'approvals', 'diagnostics', 'overview', 'conversations', 'diagnostics']) {
        S.navigate(route);
        await new Promise(r => setTimeout(r, 1300));
        const track = document.querySelector('.navbar-track');
        const box = track.getBoundingClientRect();
        const nearest = [...track.querySelectorAll('[data-nav]')]
          .map(node => { const r = node.getBoundingClientRect();
            return { id: node.dataset.nav, gap: Math.abs(r.left + r.width / 2 - (box.left + box.width / 2)) }; })
          .sort((a, b) => a.gap - b.gap)[0];
        if (S.state.route !== route) bad.push(`${route}: landed on ${S.state.route}`);
        else if (nearest.id !== expected[route]) bad.push(`${route}: ${nearest.id} in the gate`);
        else if (nearest.gap > 3) bad.push(`${route}: ${Math.round(nearest.gap)} dp off centre`);
      }
      return bad;
    });

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.evaluate(async (base) => {
      window.__is = (await import(`${base}/app.js`)).__ms20;
    }, origin);
    await page.evaluate(ACTIVATE);
    assert.deepEqual(wrong, [], 'the ring failed to turn in a wide window');
  });

  // ── §10 what a screen reader is handed ────────────────────────────────────

  await test('§10 trust bar se čtečce ohlásí jednou větou o všech třech zónách', async () => {
    await page.evaluate(ACTIVATE);
    // Freeze the network before staging the state, then let anything already in
    // flight land.
    //
    // This suite's fixture answers 503 for every non-client path, and the app
    // turns a 503 into `state.conn = 'server'`.  A request started by an earlier
    // test could therefore settle *after* this test had set `conn = 'offline'`
    // and overwrite it — the bar then truthfully announced "Server neodpovídá",
    // which is not the zone-1 wording this test asserts.  On an idle machine the
    // response always landed first and the suite was green; under load it did
    // not, which is exactly the intermittent failure that was being chased.
    // Captured by trace: `conn: "server"`, load average 13.6.
    //
    // Stubbing alone is not enough — it stops new requests, not the ones already
    // out — so what makes the staged state stick is *observing* that the ones
    // already out have drained.
    //
    // An earlier version of this fix waited a fixed 250 ms here, which was the
    // same mistake in miniature: a constant standing in for a variable-length
    // wait.  Twelve loaded runs passed with it, but a request slower than the
    // constant would put the flake straight back.  `waitForNetworkIdle` with
    // `concurrency: 0` is the real barrier — it returns when nothing is in
    // flight — and the round-trip after it drains the microtask that a
    // just-settled response would have queued in the renderer.
    await page.evaluate(`(() => {
      window.__fetchBeforeTrustBar = window.fetch;
      window.fetch = () => new Promise(() => {});
    })()`);
    try {
    await page.waitForNetworkIdle({ concurrency: 0, idleTime: 100, timeout: 5_000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    await page.evaluate(`(() => {
      const S = window.__is;
      S.state.route = 'chat';
      S.state.conversationId = 'c-1';
      S.state.conn = 'offline';
      S.state.cacheAge.thread = 'STALE';
      S.store.set(S.K.scopes, ['read:chat']);
      S.render();
    })()`);
    // The state this test is about, asserted as staged rather than assumed.
    const staged = await page.evaluate(() => window.__is.state.conn);
    assert.equal(staged, 'offline',
      'a late response overwrote the staged connection state before it was read');
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.trust-bar');
      return el ? { role: el.getAttribute('role'), live: el.getAttribute('aria-live'), name: el.getAttribute('aria-label') } : null;
    });
    assert.ok(bar, 'offline + stale + a missing scope must raise the bar');
    assert.equal(bar.role, 'status', '§10 — the bar is a status region, so a change is announced');
    assert.equal(bar.live, 'polite', 'it must not interrupt; it is context, not an alert');

    // The accessibility tree is recomputed off the main thread, so a snapshot
    // taken in the same tick as `render()` can describe the *previous* surface,
    // and `find(role === 'status')` would then return a stale node — or one
    // belonging to something else entirely.  Waiting for the tree to agree with
    // the DOM removes that race.  The condition waited for is exactly the one
    // the last assertion states anyway — the announced name *is* the bar's
    // summary — so nothing is weakened.
    //
    // This wait is hardening only.  It did **not** cause the intermittent
    // failure that used to happen here, and did not fix it: the cause was a
    // late 503 overwriting `state.conn`, and it is handled at the top of this
    // test.  The wait stays because taking a snapshot in the same tick as
    // `render()` is genuinely racy, not because it closed anything.
    const statusNodes = async () => {
      const snapshot = await page.accessibility.snapshot();
      const flat = [];
      (function walk(node) { if (!node) return; flat.push(node); (node.children || []).forEach(walk); })(snapshot);
      return flat.filter(node => node.role === 'status');
    };
    let status = null;
    for (let attempt = 0; attempt < 40 && !status; attempt++) {
      status = (await statusNodes()).find(node => node.name === bar.name) || null;
      if (!status) await new Promise(resolve => setTimeout(resolve, 50));
    }
    // Never settled: fall through to whatever status node is there, so the
    // assertions below report the zone that is actually missing rather than
    // failing with "no status node" and hiding which one it was.
    //
    // WP-0 bounded diagnostic (2026-08-12).  Two hypotheses for the measured
    // intermittency were tested and both failed, so instead of a third guess
    // this records the state at the moment of the miss.  Enabled only by
    // `MOBILE_A11Y_TRACE=<dir>`, writes outside the source tree, and is
    // deliberately cheap to delete once the cause is known.
    if (!status) [status] = await statusNodes();
    {
      const traceDir = process.env.MOBILE_A11Y_TRACE;
      const zonesOk = status && /sít|offline/i.test(status.name || '')
        && /data|starší/i.test(status.name || '') && /uzamčen/i.test(status.name || '');
      if (traceDir && !zonesOk) {
        const seen = await statusNodes();
        const live = await page.evaluate(() => {
          const S = window.__is;
          const el = document.querySelector('.trust-bar');
          return {
            route: S.state.route,
            conn: S.state.conn,
            cacheAge: S.state.cacheAge,
            scopes: S.store.get(S.K.scopes),
            label: el && el.getAttribute('aria-label'),
            text: el && el.textContent.replace(/\s+/g, ' ').trim(),
            present: !!el,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            animations: typeof document.getAnimations === 'function'
              ? document.getAnimations().map(a => `${a.constructor.name}:${a.playState}`)
              : null,
            readyState: document.readyState,
          };
        }).catch(error => ({ evaluateFailed: String(error) }));
        const record = {
          at: new Date().toISOString(),
          barName: bar.name,
          statusNodesSeen: seen.map(node => node.name),
          live,
          pageErrors: [...pageErrors],
          loadAverage: os.loadavg(),
        };
        fs.mkdirSync(traceDir, { recursive: true });
        const file = path.join(traceDir, `trust-bar-miss-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(record, null, 2));
        console.log(`  TRACE trust-bar miss recorded: ${file}`);
      }
    }
    assert.ok(status, 'the bar must reach the accessibility tree, not just the DOM');
    // §10 names the shape outright: "offline, data z 14:02, část obrazovky
    // uzamčena".  A name that drops a zone is a zone the user never hears.
    assert.match(status.name, /sít|offline/i, 'zone 1 (connection) is missing from the announced name');
    assert.match(status.name, /data|starší/i, 'zone 2 (age) is missing from the announced name');
    assert.match(status.name, /uzamčen/i, 'zone 3 (lock) is missing from the announced name');
    assert.equal(status.name, bar.name, 'the announced name must be the summary, not the visual text order');
    } finally {
      // Restore in `finally`, never after the assertions.  The harness catches a
      // failure and carries on to the next test, so a frozen `fetch` left behind
      // by the first failing assertion would silently starve every test after
      // it — turning one honest failure into a cascade with a different cause.
      await page.evaluate(`(() => {
        if (window.__fetchBeforeTrustBar) {
          window.fetch = window.__fetchBeforeTrustBar;
          delete window.__fetchBeforeTrustBar;
        }
      })()`);
    }
  });

  await test('§3.1 každá položka lišty je ve stromu přístupnosti i mimo viewport', async () => {
    await page.evaluate(ACTIVATE);
    await page.evaluate(`window.__is.state.route = 'conversations'; window.__is.render();`);
    // Off-screen items only exist once the bar is genuinely crowded.  Until the
    // ring was made conditional, a padding bug kept every bar scrollable and
    // this test ran on that accident.
    const layout = await page.evaluate(async () => {
      const track = document.querySelector('.navbar-track');
      track.style.maxWidth = '200px';
      window.__is.layoutNavRing(track);
      await new Promise(r => setTimeout(r, 500));
      const tabs = [...document.querySelectorAll('.nav-tab')].filter(t => !t.dataset.clone);
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
    await page.evaluate(() => {
      const track = document.querySelector('.navbar-track');
      track.style.maxWidth = '';
      window.__is.layoutNavRing(track);
    });
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
      track.style.maxWidth = '200px';
      window.__is.layoutNavRing(track);
      await new Promise(r => setTimeout(r, 500));
      const tabs = [...document.querySelectorAll('.nav-tab')].filter(t => !t.dataset.clone);
      // The bar is narrower than the viewport here, so "out of sight" means
      // outside the *track*, which is what actually clips it.
      const edge = () => track.getBoundingClientRect().right;
      const hidden = tabs.find(t => t.getBoundingClientRect().right > edge() + 1);
      if (!hidden) return { skipped: true };
      const before = hidden.getBoundingClientRect().right;
      hidden.focus();
      await new Promise(r => setTimeout(r, 450));
      const after = hidden.getBoundingClientRect().right;
      const result = { skipped: false, before, after, width: edge(), scrollLeft: track.scrollLeft, focused: document.activeElement === hidden };
      track.style.maxWidth = '';
      window.__is.layoutNavRing(track);
      return result;
    });
    assert.equal(moved.skipped, false, 'nothing was off-viewport to focus');
    assert.equal(moved.focused, true, 'the item must be focusable at all — it is a real control');
    assert.ok(moved.after <= moved.width + 1,
      `focus left the item off-screen (right edge ${Math.round(moved.after)} of ${moved.width}); a keyboard or switch user cannot see what they are on`);
  });

  // ── §10 dynamic type — recorded, not asserted away ────────────────────────

  await test('§10 klient roste s velikost\xed p\xedsma, kterou si \u010dten\xe1\u0159 nastavil', async () => {
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

    // This was a characterisation test — it pinned "the client is in px and does
    // not react" so that the day someone converted the stylesheet it would fail
    // rather than let the finding sit open next to code that had fixed it.
    // 2026-08-11 is that day: it now asserts the opposite.
    assert.equal(at200.body, '32px',
      'body ignored the reader\'s font size — something is back to a fixed px root');
    assert.ok(parseFloat(at200.rowTime) > parseFloat(at100.rowTime),
      `component type must grow too: ${at100.rowTime} → ${at200.rowTime}`);

    // Scaling the text without the box it lives in is worse than not scaling at
    // all, because the letters then collide with the frame.
    const grew = await page.evaluate(async () => {
      const read = () => {
        const el = document.querySelector('.nav-tab');
        return el ? el.getBoundingClientRect().height : null;
      };
      return read();
    });
    assert.ok(grew && grew > 48,
      `the bar's touch target must grow with the text, measured ${Math.round(grew ?? 0)} dp`);
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
