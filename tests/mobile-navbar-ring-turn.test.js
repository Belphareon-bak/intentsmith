// The end of a turn of the ring — UI-DESIGN §3.1, open defect of 2026-08-11
// ==============================================================================
//
// **What this suite guards, and what it does not claim.**  The defect reported
// on 2026-08-11 — "tapping two places away sticks" — was measured and traced to
// the clone count, and fixed in `42d9c40f`: a ring that had run out of
// scrollable material could not bring the item to the middle at all.  This
// suite is about a **second, independent way for the same symptom to appear**,
// which that fix did not touch and which no test covered.
//
// The ring turns by native smooth scrolling, which takes longer the further it
// travels, but the "this is the app moving, not the user" flag came down after
// a constant 400 ms.  A turn long enough to outlast that estimate dropped the
// flag mid-movement, and then two things went wrong in the same instant:
//
//   * `normaliseNavRing` re-based the track by a whole set *under the running
//     animation* — precisely what its own comment forbids, because the target
//     the animation is heading for moves and the item lands one place off;
//   * the settle handler read the middle while a **different** item was still
//     sweeping through it, and navigated there — which started another turn.
//
// It is the same class as both the return-to-root defect and the screen
// transition that had to go back to a short clock, so a longer constant would
// only have moved the failure to the next item added to the bar — and the bar
// is getting longer, `Projekty` being the most recent.
//
// What is asserted here is therefore not a duration but a **rule**: the flag is
// held until the end of the turn is *observed*, and the observation has to
// survive an engine with no `scrollend`, a turn with nowhere to go, and a turn
// whose end never arrives at all.
//
// Same limit as the sibling UI suites (F-043): this is the state machine, not a
// browser.  That real smooth scrolling behaves as modelled here — events while
// moving, then `scrollend` — is the browser suite's job.
//
// ==============================================================================

import { strict as assert } from 'node:assert';

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

// ── A clock the test drives ─────────────────────────────────────────────────
//
// Installed *before* the client is imported, so every timer it sets is one this
// suite can step through.  Real waiting would make the ceiling assertion cost a
// second and a half and would still only prove that the machine sleeps.

let now = 0;
let issued = 0;
const timers = new Map();

globalThis.setTimeout = (fn, ms = 0) => {
  const id = ++issued;
  timers.set(id, { at: now + ms, order: id, fn });
  return id;
};
globalThis.clearTimeout = id => { timers.delete(id); };

/** Run every timer due within `ms`, in the order a real clock would. */
function advance(ms) {
  const until = now + ms;
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= until)
      .sort((a, b) => a[1].at - b[1].at || a[1].order - b[1].order)[0];
    if (!due) break;
    timers.delete(due[0]);
    now = due[1].at;
    due[1].fn();
  }
  now = until;
}

// ── Enough DOM for the client to load ───────────────────────────────────────

function makeStorage() {
  const data = {};
  const method = (name, value) => Object.defineProperty(data, name, { value, enumerable: false });
  method('getItem', key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null));
  method('setItem', (key, value) => { data[key] = String(value); });
  method('removeItem', key => { delete data[key]; });
  method('clear', () => { for (const key of Object.keys(data)) delete data[key]; });
  return data;
}

function element(tag = 'div') {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(),
    className: '', innerHTML: '', textContent: '', value: '',
    hidden: false, dataset: {}, style: {}, children: [],
    scrollTop: 0, scrollHeight: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    appendChild(child) { this.children.push(child); return child; },
    remove() {},
    addEventListener() {},
  };
}

const body = element('body');
const nodes = { app: element(), toasts: element() };

globalThis.localStorage = makeStorage();
// Replaced per test so `navElement()` finds the fixture bar rather than nothing.
let findNavbar = () => null;
const docListeners = {};
globalThis.document = {
  body,
  getElementById: id => nodes[id] || null,
  querySelector: selector => (selector === '.navbar' ? findNavbar() : null),
  createElement: tag => element(tag),
  addEventListener: (type, handler) => { (docListeners[type] ||= []).push(handler); },
  visibilityState: 'visible',
};
globalThis.window = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState: () => {} };
globalThis.fetch = async () => { throw new TypeError('this suite turns a ring; it does not call'); };

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  centreNavOnSelection, normaliseNavRing, state, store, K, prefs,
  navRingIsTurningItself, NAV_TURN_CEILING_MS, NAV_TURN_QUIET_MS,
  scheduleNavRetraction, NAV_TURN_MS,
} = __ms20;

// A scroll event, delivered the way the browser delivers it: to **every**
// registered listener.  The client has more than one — the message thread reads
// scroll too — and picking the first by index quietly tested the wrong handler.
const scrollListeners = docListeners.scroll || [];
assert.ok(scrollListeners.length, 'the client registered no scroll handler');
function scrollEvent(target) {
  for (const handler of [...scrollListeners]) handler({ target });
}

// Whatever `boot()` queued on import is not this suite's subject.
advance(0);

// ── A ring with real numbers on it ──────────────────────────────────────────
//
// Five items of 100 px with the 2 px gap the client uses, flanked by a full
// hidden copy on each side — the shape `layoutNavRing` builds.  `scrollTo` is
// deliberately inert: a smooth scroll does not arrive by the time the call
// returns, and modelling it as if it did would hide the very gap the defect
// lived in.

const ITEM_W = 100;
const GAP = 2;
const ITEMS = ['conversations', 'approvals', 'overview', 'diagnostics', 'settings'];
const SET_W = ITEMS.length * ITEM_W + ITEMS.length * GAP;

function ring({ at = 0 } = {}) {
  const handlers = {};
  const tabs = [];

  const track = {
    className: 'navbar-track',
    classList: { contains: name => name === 'navbar-track' },
    dataset: { ring: 'on' },
    style: {},
    clientWidth: 320,
    scrollLeft: at,
    asked: [],
    // The bar is fixed on screen, so the track's own box never moves; what
    // moves under it is the material, by `scrollLeft`.
    getBoundingClientRect: () => ({ left: 0, width: track.clientWidth }),
    scrollTo({ left }) { track.asked.push(left); },      // smooth: it has not moved yet
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      handlers[type] = (handlers[type] || []).filter(entry => entry !== fn);
    },
    listeners(type) { return (handlers[type] || []).length; },
    /** One frame of the native scroll, as the engine would report it. */
    emit(type) { for (const fn of [...(handlers[type] || [])]) fn(); },
    querySelector: () => tabs.find(tab => !tab.dataset.clone) || null,
    querySelectorAll: () => tabs,
  };

  let x = 0;
  const push = (id, clone) => {
    const at = x;                                        // captured per tab
    tabs.push({
      dataset: clone ? { nav: id, clone: 'true' } : { nav: id },
      offsetLeft: at,
      offsetWidth: ITEM_W,
      getBoundingClientRect: () => ({ left: at - track.scrollLeft, width: ITEM_W }),
    });
    x += ITEM_W + GAP;
  };
  for (const id of ITEMS) push(id, true);
  for (const id of ITEMS) push(id, false);
  for (const id of ITEMS) push(id, true);

  track.children = tabs;
  findNavbar = () => ({ querySelector: sel => (sel === '.navbar-track' ? track : null) });
  return track;
}

/** The real (non-clone) copy of an item, as `centreNavOnSelection` is given it. */
function realTab(track, id) {
  return track.children.find(tab => tab.dataset.nav === id && !tab.dataset.clone);
}

/** Turn the ring towards `id` and report how far it was asked to travel. */
function turnTo(track, id) {
  const before = track.scrollLeft;
  centreNavOnSelection(realTab(track, id));
  const asked = track.asked[track.asked.length - 1];
  return Math.abs(asked - before);
}

/** Drive a native smooth scroll of `ms`, reporting a frame every 16 ms. */
function scrollFor(track, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    advance(16);
    track.emit('scroll');
  }
}

console.log('\n=== The end of a turn of the ring (UI-DESIGN §3.1) ===');

// ── The defect itself ───────────────────────────────────────────────────────

await test('a turn longer than the old 400 ms estimate is still the app moving, not the user', () => {
  const track = ring({ at: SET_W });
  const distance = turnTo(track, 'diagnostics');

  assert.ok(distance > ITEM_W, `precondition: a two-place turn must be a long one, was ${distance}px`);
  assert.equal(navRingIsTurningItself(), true, 'the turn did not start');

  // 640 ms of real movement: comfortably past the constant that used to end the
  // turn, which is the exact moment the bar used to start fighting itself.
  scrollFor(track, 640);
  assert.equal(navRingIsTurningItself(), true,
    'the flag fell while the ring was still moving — this is the reported defect');
});

await test('re-basing cannot happen under a running turn, however long the turn is', () => {
  const track = ring({ at: SET_W * 2 });         // drifted a full set: normally re-based at once
  turnTo(track, 'conversations');
  const parked = track.scrollLeft;

  scrollFor(track, 640);
  normaliseNavRing(track);
  assert.equal(track.scrollLeft, parked,
    're-based mid-turn: the animation is now heading for a target that moved');
});

await test('once the movement stops, the ring is the user’s again', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');
  scrollFor(track, 640);

  advance(NAV_TURN_QUIET_MS + 16);               // the frames stop; the ring is at rest
  assert.equal(navRingIsTurningItself(), false, 'the turn never ended');
});

// ── The observation has to hold in every engine ─────────────────────────────

await test('`scrollend` ends the turn at once, without waiting out the quiet window', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');
  scrollFor(track, 300);

  track.emit('scrollend');
  assert.equal(navRingIsTurningItself(), false, '`scrollend` was not believed');
});

await test('quiet is only an arrival after motion — a slow first frame is not one', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');

  // The engine has not reported a single frame yet.  Reading this as "at rest"
  // would reintroduce the defect through the back door.
  advance(NAV_TURN_QUIET_MS * 3);
  assert.equal(navRingIsTurningItself(), true,
    'silence before the scroll began was mistaken for the end of it');

  scrollFor(track, 100);
  advance(NAV_TURN_QUIET_MS + 16);
  assert.equal(navRingIsTurningItself(), false, 'the turn never ended once it had really moved');
});

await test('a turn with nowhere to go is over already, not held for the ceiling', () => {
  const track = ring({ at: 0 });
  const target = realTab(track, 'overview');
  // Park the ring exactly where centring this item would put it.
  track.scrollLeft = target.offsetLeft - (track.clientWidth - target.offsetWidth) / 2;

  centreNavOnSelection(target);
  assert.equal(navRingIsTurningItself(), false,
    'a turn of zero distance fires no scroll and no `scrollend`, so it must not wait for one');
});

await test('an end that never arrives still brings the flag down', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');

  advance(NAV_TURN_CEILING_MS - 1);
  assert.equal(navRingIsTurningItself(), true, 'the ceiling fired early');
  advance(2);
  assert.equal(navRingIsTurningItself(), false,
    'no ceiling: a lost `scrollend` would leave the bar deaf to the finger for good');
});

// ── And it must not accumulate ──────────────────────────────────────────────

await test('each turn watches once; a tap during a turn does not leave the old watch behind', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');
  scrollFor(track, 100);
  turnTo(track, 'settings');                     // second tap, mid-turn
  scrollFor(track, 100);

  assert.equal(track.listeners('scroll'), 1, 'the previous turn is still listening');
  assert.equal(track.listeners('scrollend'), 1, 'the previous turn is still listening');

  advance(NAV_TURN_QUIET_MS + 16);
  assert.equal(navRingIsTurningItself(), false, 'the second turn never ended');
  assert.equal(track.listeners('scroll'), 0, 'the finished turn left its listeners on the track');
  assert.equal(track.listeners('scrollend'), 0, 'the finished turn left its listeners on the track');
});

await test('the ceiling of one turn cannot end the next one', () => {
  const track = ring({ at: SET_W });
  turnTo(track, 'diagnostics');
  advance(NAV_TURN_CEILING_MS - 40);             // first turn nearly out of time
  turnTo(track, 'settings');                     // second tap restarts the watch
  advance(80);                                   // the first ceiling would have fired in here

  assert.equal(navRingIsTurningItself(), true,
    'the ceiling left over from the previous turn ended this one');
});

// ── The settle the ring had queued must not outlive the gate it read ────────
//
// Found while measuring this change against the browser suite, which went from
// one failure in five runs to four.  The cause was next door: the capture-phase
// scroll handler cleared its pending settle only *after* deciding the ring was
// not turning itself, so a settle scheduled 140 ms before a tap survived the
// tap.  It then fired mid-turn, read the gate while another item was sweeping
// through it, and navigated there — the same "bar fights itself" symptom, by a
// different road.  `Přehled` sits in the middle of the set, which is why that
// is where it usually ended up.

await test('a settle queued before a tap does not fire during the turn the tap starts', () => {
  // A session the bar will actually build items for, so `followNavRingToCentre`
  // reaches `navigate` rather than falling out on a missing item.
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, ['read:chat', 'write:chat', 'read:notifications', 'read:approvals', 'write:approvals']);
  Object.assign(state, {
    session: 'active', route: 'conversations', conn: 'ok', conversationId: null, sending: false,
    data: {}, loading: {}, error: {}, cacheAge: {}, cacheAt: {}, serverOffsetMs: 0, unread: 0,
    opsLookup: {}, opsNote: {}, approvalsGone: {}, approvalAttempts: {},
  });

  const track = ring({ at: 0 });
  advance(NAV_TURN_CEILING_MS + 1);          // no turn left over from the test above
  assert.equal(navRingIsTurningItself(), false, 'precondition: the ring starts at rest');

  // Park the gate on `Přehled` while the route is Konverzace — the state a turn
  // sweeps through, and the one the stale settle used to act on.
  const gate = realTab(track, 'overview');
  track.scrollLeft = gate.offsetLeft + ITEM_W / 2 - track.clientWidth / 2;
  scrollEvent(track);                         // at rest, so a settle is queued

  // The tap lands before that settle is due.
  advance(60);
  turnTo(track, 'diagnostics');

  // The moment the stale settle would have fired, mid-turn.  If it does fire it
  // navigates, and rendering that screen in this bare DOM throws — so the throw
  // is caught and the *rule* is asserted first, rather than surfacing as a
  // rendering error that says nothing about what went wrong.
  let renderBlewUp = null;
  try { advance(200); } catch (error) { renderBlewUp = error; }

  assert.equal(state.route, 'conversations',
    'a settle decided before the tap navigated in the middle of the turn');
  assert.equal(navRingIsTurningItself(), true, 'precondition: the turn is still running here');
  assert.equal(renderBlewUp, null, `nothing should have rendered: ${renderBlewUp?.message}`);
});


// ── The bar's retraction is the second beat, and waits for the first ────────
//
// Operator, 2026-08-10: two beats, not one — the ring arrives, *then* the bar
// goes; sliding sideways and downwards at once reads as one confused motion.
//
// The two beats are different kinds of thing, which is what the old code missed.
// The ring's arrival is variable-length and must be observed.  The bar's own
// slide is a CSS transition of known length and stays a constant — but as a
// floor, so a ring with no distance to travel still leaves a gap between the
// movements.  The bar therefore leaves at `max(ring landed, one beat)`.

function rootBar() {
  state.route = 'overview';
  prefs.set('hideBarOnHome', true);
  return { dataset: {} };
}

await test('the bar leaves the root only after the ring lands, however long the turn', () => {
  const track = ring({ at: SET_W });
  advance(NAV_TURN_CEILING_MS + 1);            // nothing left over from above
  const bar = rootBar();

  turnTo(track, 'diagnostics');                // a long turn is under way
  scheduleNavRetraction(bar, true);
  assert.equal(bar.dataset.retracted, 'false', 'the bar left before the ring had arrived');

  // Past the bar's own beat — but the ring is still travelling.
  scrollFor(track, NAV_TURN_MS + 200);
  assert.equal(bar.dataset.retracted, 'false',
    'the bar slid down while the ring was still turning');

  advance(NAV_TURN_QUIET_MS + 16);             // the ring comes to rest
  assert.equal(bar.dataset.retracted, 'true', 'the bar never left once the ring had landed');
});

await test('a ring with nothing to turn still leaves a beat between the two movements', () => {
  ring({ at: 0 });
  advance(NAV_TURN_CEILING_MS + 1);
  const bar = rootBar();

  scheduleNavRetraction(bar, true);            // ring already at rest
  assert.equal(bar.dataset.retracted, 'false', 'the bar went in the same instant as the render');
  advance(NAV_TURN_MS - 1);
  assert.equal(bar.dataset.retracted, 'false', 'the two movements collapsed into one');
  advance(2);
  assert.equal(bar.dataset.retracted, 'true', 'the bar never left at all');
});

await test('a retraction armed on the root does not fire after a newer render says stay', () => {
  ring({ at: 0 });
  advance(NAV_TURN_CEILING_MS + 1);
  const bar = rootBar();

  scheduleNavRetraction(bar, true);            // armed on the root
  state.route = 'conversations';               // a fast tap straight through
  scheduleNavRetraction(bar, false);

  advance(NAV_TURN_MS * 3);
  assert.equal(bar.dataset.retracted, 'false',
    'a retraction armed on the root fired over a section');
});

// ── The fix is a rule, not a bigger constant ────────────────────────────────

await test('no fixed estimate of the turn survives where the defect lived', async () => {
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('../src/mobile/client/app.js', import.meta.url), 'utf8');

  // The defect was a `setTimeout` inside the function that starts the turn.
  // The behavioural tests above already prove the rule; this one guards against
  // it being undone by someone tuning a constant to chase a flake.
  const from = client.indexOf('function centreNavOnSelection');
  const body = client.slice(from, client.indexOf('\n}', from));
  assert.ok(from >= 0 && body.length > 0, 'the centring code moved; this guard is now blind');

  assert.ok(!/setTimeout/.test(body),
    'starting a turn schedules a timer again — the length of a turn is not knowable in advance');
  assert.ok(!/navRingTurningItself\s*=\s*false/.test(body),
    'the turn is ended where it is started, rather than where it is observed to finish');
  assert.match(client, /addEventListener\('scrollend'/,
    'the end of the turn is not observed; a constant would put the defect straight back');
});

console.log(`\nRing turn: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
