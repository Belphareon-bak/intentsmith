// IntentSmith Mobile — client
// ==============================================================================
//
// Implements the screen-state vocabulary from docs/mobile/SCREENS.md §2.  The
// three confusions that §2.1 says would break this app are the ones the code
// works hardest to prevent:
//
//   SS-02 vs SS-03  — "empty" is only ever rendered after a *successful*
//                     server response.  A failed load never produces an empty
//                     state, because "nothing here" and "couldn't ask" mean
//                     opposite things.
//   SS-03 vs SS-08  — offline and server-unreachable are separate banners with
//                     separate advice, decided by whether the request failed at
//                     the network layer or the server answered badly.
//   SS-06 expiry vs revocation — two screens.  Revocation wipes the cache
//                     *before* anything renders, because a revoked device must
//                     not keep showing content.
//
// MD-19 lives in `journal`: the client mints an operation key, keeps it across
// retries of the same conscious attempt, and never stores the payload with it.
// The message text lives separately as a draft (MD-14), which is what makes
// rule 3 of §4.1 satisfiable — retry with the same key only while the original
// request is still available.
//
// ==============================================================================

const API = '/m1';

// MR-05.  One screenful with room to scroll, not the whole history: the old
// `limit=100` was the server's ceiling, so a longer conversation was truncated
// to its *oldest* hundred messages with nothing saying so.
const THREAD_PAGE_SIZE = 50;

// ── Storage ─────────────────────────────────────────────────────────────────
// Keys are namespaced so the revocation wipe can clear domain data without
// touching UI preferences the user set on their own device.
const K = {
  token: 'is.auth.token',
  device: 'is.auth.device',
  scopes: 'is.auth.scopes',
  cache: 'is.cache.',
  journal: 'is.journal',
  drafts: 'is.drafts',
  prefs: 'is.prefs',
};

const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  delPrefix(prefix) {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(prefix)) localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  },
  /** Wipe domain data. Preferences survive; credentials and content do not. */
  wipeDomain() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('is.') && key !== K.prefs) localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  },
};

// ── ST-SECURE — the credential, once there is somewhere to put it (MR-22) ───
//
// `MD-11` says the device token is **S3** and belongs in `ST-SECURE`,
// "výhradně".  A browser has no such place: `localStorage` is the only option,
// it is readable by anything that reaches the profile, it goes out in backups,
// and it cannot be sealed while the app is in the background.  That is the
// whole reason `MR-22`/`MR-23` were `PARTIAL` "pod úložištním limitem PWA" —
// not a missing screen, a missing floor.
//
// The Android shell has a floor: an Android-Keystore-backed store that refuses
// to hand the credential out while the app is locked
// (`mobile-app/android/.../LockPolicy.java`).  This adapter is how the client
// uses it **without four thousand lines becoming async**: the credential is
// read once at boot into memory, and `auth` keeps exactly the synchronous
// shape it always had.
//
// Two rules make it honest rather than merely convenient:
//
//   * **Only the token and the device id go native.**  Scopes are `S1` and
//     `ST-DB` by `MD-12`; moving them would claim a protection the data model
//     does not ask for and would make the settings screen lie in the other
//     direction.
//
//   * **A failed vault is loud.**  If the shell is present and its vault will
//     not open, the client does *not* quietly fall back to `localStorage` while
//     still looking native.  It records why, says so on the settings screen,
//     and keeps working — degraded and labelled.  Silent downgrade is how a
//     user ends up trusting a phone they should have wiped.
const secure = {
  plugin: null,
  /** 'native' once the vault is open; 'browser' otherwise — including a failed shell. */
  mode: 'browser',
  /** Why not native, when a shell *was* present.  Rendered, not swallowed. */
  reason: null,
  lock: { hasPin: false, locked: false, maxFailures: 0, kind: 'none' },
  cache: { token: null, device: null },

  get native() { return this.mode === 'native'; },

  /**
   * Open the vault and read the credential into memory.  Called once, before
   * the first render, because every subsequent read is synchronous.
   */
  async hydrate() {
    const plugin = globalThis.Capacitor?.Plugins?.IntentSmithVault || null;
    if (!plugin) return;                       // a plain browser: nothing to say
    this.plugin = plugin;
    try {
      const state = await plugin.getState();
      this.lock = {
        hasPin: Boolean(state.hasPin),
        locked: Boolean(state.locked),
        maxFailures: state.maxFailures || 0,
        // 'system' — the phone's own screen lock, through BiometricPrompt;
        // 'pin' — this app's fallback for a phone that has none;
        // 'none' — nothing is locking anything, and the screen says so.
        kind: state.lockKind || (state.hasPin ? 'pin' : 'none'),
      };
      if (!state.available) {
        this.reason = state.error || 'vault_unavailable';
        return;
      }
      this.mode = 'native';
      if (state.hasCredential && !state.locked) {
        const held = await plugin.read();
        this.cache = { token: held.token || null, device: held.deviceId || null };
      }
    } catch (error) {
      this.reason = String(error?.message || error);
    }
  },

  async save({ token, deviceId }) {
    this.cache = { token, device: deviceId };
    if (!this.native) return;
    try {
      await this.plugin.save({ token, deviceId: deviceId || '' });
    } catch (error) {
      // The credential is in memory and the session works; what failed is its
      // durability.  Saying so is the difference between "you will have to pair
      // again tomorrow" and a mystery.
      this.reason = String(error?.message || error);
      this.mode = 'browser';
    }
  },

  async clear() {
    this.cache = { token: null, device: null };
    if (!this.native) return;
    try { await this.plugin.clear(); } catch { /* wiped locally regardless */ }
    this.lock = { ...this.lock, hasPin: false };
  },

  /**
   * Drop the credential from **memory only** — the vault keeps it.
   *
   * This is the difference between locking and logging out, and it is the
   * whole reason the credential is hydrated rather than read on demand: the
   * copy in this process is the one an attacker with the running app can
   * reach, and it is the copy a lock has to take away.  `clear()` wipes the
   * vault as well and is `E-LOGOUT`; this is `MR-23`.
   */
  forget() {
    this.cache = { token: null, device: null };
    this.lock = { ...this.lock, locked: true };
  },

  async setPin(pin) {
    if (!this.native) return { ok: false, reason: 'no_vault' };
    try {
      await this.plugin.setPin({ pin });
      this.lock = { ...this.lock, hasPin: true };
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  },

  async clearPin(pin) {
    if (!this.native) return { ok: false, reason: 'no_vault' };
    try {
      await this.plugin.clearPin({ pin });
      this.lock = { ...this.lock, hasPin: false };
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: 'pin_wrong' };
    }
  },
};

const auth = {
  // Reads stay synchronous.  In the shell they answer from the credential
  // hydrated at boot; in a browser they answer from `localStorage`, exactly as
  // before.  Nothing else in this file had to learn the difference.
  get token() { return secure.native ? secure.cache.token : store.get(K.token); },
  get device() { return secure.native ? secure.cache.device : store.get(K.device); },
  get scopes() { return store.get(K.scopes, []); },
  has(scope) { return (store.get(K.scopes, []) || []).includes(scope); },
  save({ token, deviceId, scopes }) {
    // A new credential is a lifecycle boundary.  No approval authority or
    // process-local attribution from the prior credential may cross it; the
    // durable MD-19 journal intentionally remains separate.
    invalidateApprovalSession();
    if (secure.native) {
      // Memory first so the caller's next synchronous read already sees it; the
      // durable write is awaited by nobody because failing it degrades the
      // session rather than ending it, and `secure.save` records that.
      secure.save({ token, deviceId });
    } else {
      store.set(K.token, token);
      store.set(K.device, deviceId);
    }
    replaceScopes(scopes || []);
  },
  clear() {
    invalidateApprovalSession();
    // `E-LOGOUT` (`MD-11`): the credential goes first, and it goes from
    // wherever it actually lives.  A wipe that only cleared `localStorage`
    // would leave a working token in the Keystore of a device the user just
    // logged out.
    secure.clear();
    store.wipeDomain();
  },
};

// ── Cache with the FRESH / STALE / EXPIRED lifecycle (DATA-MODEL §3) ────────
//
// The age thresholds decide what the user is *allowed to do*, not merely what
// they see: over STALE data every mutation is blocked, because deciding on
// stale state is how a user approves something that already changed.
const FRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;
const CACHE_WINDOWS = Object.freeze({
  memory: Object.freeze({ freshMs: 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 }),
  workers: Object.freeze({ freshMs: 5 * 60_000, staleMs: 7 * 24 * 60 * 60_000 }),
  specialists: Object.freeze({ freshMs: 60 * 60_000, staleMs: 7 * 24 * 60 * 60_000 }),
});

function cacheWindow(name) {
  return CACHE_WINDOWS[name] || { freshMs: FRESH_MS, staleMs: STALE_MS };
}

const cache = {
  read(name) {
    const entry = store.get(K.cache + name);
    if (!entry) return { status: 'MISSING', data: null, at: null };
    const age = Date.now() - entry.at;
    const window = cacheWindow(name);
    const status = age < window.freshMs ? 'FRESH' : age < window.staleMs ? 'STALE' : 'EXPIRED';
    return { status, data: entry.data, at: entry.at, age };
  },
  write(name, data) { store.set(K.cache + name, { at: Date.now(), data }); },
};

// ── MD-15 local preferences — the second exception to I-10 ──────────────────
//
// Appearance is device-shaped, not account-shaped (`R5-2`), so it lives here and
// nowhere else.  These survive `wipeDomain()` on purpose: a revoked device that
// forgets the token must not also forget how its owner likes the bar to behave.
const PREF_DEFAULTS = Object.freeze({
  // The operator's default: on the root the bar slides away and gives the
  // dashboard the whole screen (§3.2).  It is a choice because the effect that
  // makes it worth having is exactly the effect that annoys some people.
  hideBarOnHome: true,
});

const prefs = {
  all() {
    const stored = store.get(K.prefs, {});
    return { ...PREF_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  },
  get(name) { return prefs.all()[name]; },
  set(name, value) {
    if (!(name in PREF_DEFAULTS)) return;
    store.set(K.prefs, { ...prefs.all(), [name]: value });
  },
};

// ── MD-19 client journal — the operation recovery index (U-9) ────────────────
//
// Decided in UI-DESIGN §17 (U-9): this is the **third exception to I-10**,
// alongside the draft (MD-14) and local preferences (MD-15).  Everything else
// in this client is derived and may be thrown away at any time; this is not.
// Losing it does not lose a cache — it loses the ability to ask how an
// operation ended, to repeat it safely under the same key, and to see what was
// never resolved.  `GET /m1/operations/:id` is asked *by key*, and the key
// lives only here.
//
// What an entry holds, and nothing more:
//
//   operationId      the key — the whole reason the index exists
//   operationType    what was attempted
//   createdAt        when the attempt was made
//   lastKnownState   the last state the *server* reported.  Named "last known"
//                    because it is a memory, not the truth; the truth is a
//                    lookup away and may already differ
//   lastCheckedAt    when that state was last read back
//   unknownReason    the server's code for why it is UNKNOWN (closed list)
//   displaySummary   a content-free label, so the recovery list is readable
//
// `displaySummary` deliberately does **not** contain the message text.  MD-19
// keeps the journal at S1 precisely by never storing the payload; a "summary"
// made of the user's words would quietly turn it into S2 and change what a lost
// phone gives away.  The text lives in the draft (MD-14), where it is meant to.
const JOURNAL_LIMIT = 200;

// The server's closed vocabulary for an operation state.  F-062: anything
// outside it is not a state, and writing it would be worse than ignoring it —
// `open()` filters on PENDING/UNKNOWN, so one malformed answer would drop the
// record out of the recovery list and take the only handle on an ambiguous
// effect with it.  There is no screen that lists a record in an invented state.
const OPERATION_STATES = new Set(['PENDING', 'UNKNOWN', 'CONFIRMED', 'REJECTED']);

const journal = {
  all() { return (store.get(K.journal, []) || []).map(normalizeEntry); },
  find(operationId) { return this.all().find(entry => entry.operationId === operationId) || null; },
  open() {
    return this.all().filter(entry => entry.lastKnownState === 'PENDING' || entry.lastKnownState === 'UNKNOWN');
  },
  /**
   * Write the recovery record.  Called *before* the request goes out — see
   * `doSend()`.  The reverse order loses exactly the case this index exists
   * for: the app dies between dispatch and write, and the operation becomes
   * unrecognisable to the phone that started it.
   */
  add({ operationId, operationType, displaySummary = null }) {
    const list = this.all();
    list.push({
      operationId,
      operationType,
      displaySummary,
      createdAt: Date.now(),
      lastKnownState: 'PENDING',
      lastCheckedAt: null,
      unknownReason: null,
    });
    store.set(K.journal, list.slice(-JOURNAL_LIMIT));
  },
  /**
   * Record what the server said, and when it said it.
   *
   * An unrecognised state is dropped rather than written (F-062).  A record
   * whose state the app cannot name is not resolved — it is a record whose
   * answer was unreadable, and it has to stay open so it can be asked about
   * again.  Silently accepting it is how a malformed 2xx closes the recovery
   * path for an effect that may well have happened.
   */
  setState(operationId, lastKnownState, { unknownReason = undefined } = {}) {
    if (!OPERATION_STATES.has(lastKnownState)) return false;
    const list = this.all();
    const found = list.find(entry => entry.operationId === operationId);
    if (!found) return false;
    found.lastKnownState = lastKnownState;
    found.lastCheckedAt = Date.now();
    if (unknownReason !== undefined) found.unknownReason = unknownReason;
    store.set(K.journal, list);
    return true;
  },
  /**
   * Removing an unresolved record is a deliberate act with a consequence:
   * the server-side effect stays unresolved and is no longer traceable from
   * this phone (MD-19 E-LOGOUT).  Never called automatically.
   *
   * A *resolved* record is not dropped on the spot — it stays as short history
   * until the cap above rolls it off, so "what happened to that one" is still
   * answerable a minute later.
   */
  discard(operationId) {
    store.set(K.journal, this.all().filter(entry => entry.operationId !== operationId));
    drafts.drop(operationId);
  },
};

/** Migrate known pre-U-9 aliases into the closed shape; never retain extras. */
function normalizeEntry(entry) {
  const hasOwn = key => Object.prototype.hasOwnProperty.call(entry, key);
  return {
    operationId: entry.operationId,
    operationType: hasOwn('operationType') ? entry.operationType : (entry.type || 'operace'),
    displaySummary: entry.displaySummary || null,
    createdAt: entry.createdAt,
    lastKnownState: hasOwn('lastKnownState') ? entry.lastKnownState : (entry.state || 'PENDING'),
    lastCheckedAt: entry.lastCheckedAt || null,
    unknownReason: entry.unknownReason || null,
  };
}

// Drafts hold the payload the journal deliberately does not (MD-19 §4.1).
const drafts = {
  get(operationId) { return (store.get(K.drafts, {}) || {})[operationId] || null; },
  put(operationId, payload) {
    const all = store.get(K.drafts, {}) || {};
    all[operationId] = payload;
    store.set(K.drafts, all);
  },
  drop(operationId) {
    const all = store.get(K.drafts, {}) || {};
    delete all[operationId];
    store.set(K.drafts, all);
  },
};

function newOperationId() {
  const bytes = new Uint8Array(16); // 128 bits, per MD-19
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── API client ──────────────────────────────────────────────────────────────
//
// Every failure is classified into exactly one cause.  `kind: 'offline'` is
// reserved for a request that never reached a server; anything the server
// answered — including 503 — is a server condition, and the two drive
// different screens (§8.3, SS-03 vs SS-08).
class ApiError extends Error {
  constructor(kind, { code = null, status = null, detail = {}, body = null } = {}) {
    super(code || kind);
    this.kind = kind;      // offline | server | auth | scope | conflict | protocol | client
    this.code = code;
    this.status = status;
    this.detail = detail;
    // The raw parsed body, because one route answers a *question* with a
    // non-2xx status: `GET /m1/operations/:id` reports "I do not hold this key"
    // as 404 with `{ok: true, data: {known: false}}` (handlers.js:360-367).
    // Only that exact shape means it; every other 404 is a failure, and telling
    // them apart requires the body, not the status.
    this.body = body;
  }
}

/**
 * F-059 — `response.ok` is a range, not an answer.
 *
 * For most reads a 2xx is good enough: the worst case is a screen that renders
 * nothing.  For the approval queue and for a decision it is not, because the two
 * things a 2xx can establish there are "nothing is waiting" (permission to put
 * the phone down) and "this is decided" (a grant that cannot be taken back).
 * Callers that establish either pass `strict`, and then only the server's own
 * envelope, delivered as an exact 200, counts as an answer.  Every other 2xx is
 * a protocol failure — which is a *failure*, not a quiet nothing.
 */
// ── The session epoch — MR-23, the half a curtain cannot do ─────────────────
//
// Hiding the WebView behind a native overlay stops a person from *reading* the
// screen.  It does not stop the page behind it: a request issued before the
// lock still lands, still carries a valid token, and still writes S2 data into
// memory that the next screenshot, crash dump or `about:blank` inspection can
// reach.  A lock that leaves that running is a curtain, not a lock.
//
// So locking bumps an epoch.  Three things follow from one number:
//
//   * every in-flight request is aborted, because the controllers are held
//     here rather than in the closures that created them;
//   * a response that was already in flight and lands anyway is **inert** — it
//     is compared against the epoch it was issued under and dropped, so a late
//     approval body cannot repopulate a locked session;
//   * a request *started* while locked never leaves, which is what keeps a
//     background timer from quietly refreshing a locked inbox.
//
// The credential is wiped in the same breath (`secure.forget()`); on unlock the
// shell reloads the page, so everything is re-read from the vault rather than
// resumed from memory.
const sessionEpoch = {
  value: 0,
  locked: false,
  inFlight: new Set(),

  /** Abort everything outstanding and make anything still arriving inert. */
  bump() {
    this.value += 1;
    for (const controller of this.inFlight) {
      try { controller.abort(); } catch { /* already settled */ }
    }
    this.inFlight.clear();
    return this.value;
  },
};

/**
 * Everything the phone must stop holding when it goes out of sight.
 *
 * Called from the native lock (`intentsmithLock`) and from `visibilitychange`,
 * on purpose: the native event is the authority, and the visibility event is
 * the belt — if the bridge ever misses one, the page still forgets.  Being
 * called twice is harmless; being called never is the failure.
 */
function lockDownSession() {
  sessionEpoch.locked = true;
  sessionEpoch.bump();
  secure.forget();
  // S2 in memory: conversation windows, approval bodies, diagnostics.  The
  // durable ST-DB cache is deliberately left alone — MD-07 governs its life,
  // and wiping it here would turn a lock into a logout.
  state.data = {};
  state.loading = {};
  state.error = {};
  state.opsLookup = {};
  state.thread = { cursor: null, end: false, loadingOlder: false, stickToBottom: true };
  invalidateApprovalSurface();
}

/** The shell reloads on unlock, so this exists for the paths that do not. */
function unlockSession() {
  sessionEpoch.locked = false;
  sessionEpoch.value += 1;
}

async function api(path, { method = 'GET', body = null, timeoutMs = 130_000, strict = false } = {}) {
  // A locked session issues nothing.  Reported as `offline` because that is
  // exactly what it is from the caller's point of view — no answer, nothing
  // claimed, retry later — and because every caller already handles it without
  // touching the credential.
  if (sessionEpoch.locked) {
    throw new ApiError('offline', { code: 'locked' });
  }

  const headers = {};
  const token = auth.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';

  const issuedAt = sessionEpoch.value;
  const controller = new AbortController();
  sessionEpoch.inFlight.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    // F-080 (client half). Approval bodies are S2 and authority-bearing.  The
    // app's logical cache and service-worker bypass do not control the browser's
    // HTTP cache, so every approval read and decision opts out explicitly.
    // Classify the route component, not the full request target: MR-05 cursor
    // pagination adds a query string and a fragment must not change cache policy.
    const routePath = path.split(/[?#]/, 1)[0];
    const approvalRequest = routePath === '/approvals' || routePath.startsWith('/approvals/');
    response = await fetch(API + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      ...(approvalRequest ? { cache: 'no-store' } : {}),
    });
  } catch (error) {
    // No HTTP response at all. Ambiguous for mutations — the caller decides.
    // An abort that came from the lock is not a timeout: saying `timeout` would
    // invite the recovery UI to offer a retry for something the user stopped.
    if (sessionEpoch.value !== issuedAt) {
      throw new ApiError('offline', { code: 'locked' });
    }
    throw new ApiError('offline', { code: error.name === 'AbortError' ? 'timeout' : 'network' });
  } finally {
    clearTimeout(timer);
    sessionEpoch.inFlight.delete(controller);
  }

  // The response outlived its session.  Dropped here rather than in each
  // caller: there are dozens of callers and one of them would forget.
  if (sessionEpoch.value !== issuedAt) {
    throw new ApiError('offline', { code: 'locked' });
  }

  let payload = null;
  try { payload = await response.json(); } catch { /* may legitimately be empty */ }

  if (response.ok) {
    if (strict && (response.status !== 200 || !payload || payload.ok !== true)) {
      throw new ApiError('protocol', {
        code: 'protocol_invalid_response',
        status: response.status,
        detail: { reason: response.status !== 200 ? 'unexpected_status' : 'missing_envelope' },
        body: payload,
      });
    }
    return payload;
  }

  const code = payload?.error?.code || `http_${response.status}`;
  const detail = payload?.error || {};

  // The taxonomy the server promises in §8.3, mapped to the screen it drives.
  const kind =
    code === 'token_revoked' || code === 'token_expired'
      || code === 'token_invalid' || code === 'token_missing' ? 'auth'
    : code === 'scope_required' ? 'scope'
    : code === 'protocol_mismatch' ? 'protocol'
    : response.status === 409 ? 'conflict'
    : response.status === 429 ? 'limit'
    : response.status >= 500 ? 'server'
    : 'client';

  throw new ApiError(kind, { code, status: response.status, detail, body: payload });
}

// ── Global session guard ────────────────────────────────────────────────────
//
// SS-06: revocation and expiry are different events with different handling.
// Revocation wipes before rendering; expiry keeps the journal so UNKNOWN
// operations can still be resolved after re-pairing (MD-19 E-EXPIRE).
function handleAuthFailure(error) {
  // SS-06 for MS-13: the queue is memory-only, so wiping storage does not
  // reach it.  It has to be dropped explicitly or a revoked device would keep
  // rendering approvals it is no longer allowed to see.
  // F-066: the bump also cuts loose any read still in flight, so a queue answer
  // that was already on the wire cannot hand a revoked device its approvals back.
  invalidateApprovalSession();

  if (error.code === 'token_revoked') {
    store.wipeDomain();
    state.session = 'revoked';
  } else if (error.code === 'token_expired') {
    const keptJournal = journal.all();
    store.wipeDomain();
    store.set(K.journal, keptJournal);
    state.session = 'expired';
  } else {
    store.wipeDomain();
    state.session = 'unpaired';
  }
  render();
}

// ── App state ───────────────────────────────────────────────────────────────
const state = {
  // §3.2 — from phase 3 the root of the app is Přehled.  Phases 0–1 have no
  // home screen at all, and that case is handled by `session`, not by this.
  route: 'overview',
  session: 'unknown',      // unknown | unpaired | active | expired | revoked
  conn: 'ok',              // ok | offline | server
  conversationId: null,
  projectId: null,
  projectState: 'active',
  pagination: {},
  data: {},
  loading: {},
  error: {},
  cacheAge: {},
  // When each cached dataset was last confirmed, so trust-bar zone 2 can say
  // *from when* rather than only *not fresh* (§4).  Kept beside `cacheAge`
  // rather than inside it because every existing reader compares the status as
  // a bare string.
  cacheAt: {},
  // §14 — `health.time` minus the phone's clock.  `null` until a health read
  // lands, and null is meaningful: it downgrades every countdown and every age
  // to words instead of numbers rather than trusting the device clock.
  serverOffsetMs: null,
  unread: 0,
  // MR-05 / SS-03.  The thread is a *window* onto the history, not the history:
  // `cursor` is the last cursor the server issued for reading further into the
  // past (never one this client computed, §8.2), `end` says the oldest message
  // is already on screen, and `loadingOlder` keeps the boundary control from
  // being tapped twice.  Kept beside `data.thread` because the cache stores the
  // window itself and these describe where that window sits.
  thread: { cursor: null, end: false, loadingOlder: false, stickToBottom: true },
  sending: false,
  sendingSince: null,
  // Which attempt the in-flight send belongs to, so the RunSilence strip on the
  // chat can offer the same read as the one on the root (§6.5).
  sendingOperationId: null,
  // MS-20 (§6.9).  Deliberately four separate fields rather than one per-row
  // object: each of them enforces a rule.  `opsConfirm` is single-valued
  // because only one attempt may be armed for abandoning at a time, and
  // `opsAbandoning` because only one abandon may be in flight.
  opsLookup: {},           // operationId → true while its one lookup is running
  opsNote: {},             // operationId → { tone, text } outcome of that lookup
  opsConfirm: null,        // the single attempt awaiting the second confirmation
  opsAbandoning: null,     // the single attempt whose abandon is in flight

  // MS-13 / MS-14.  The right to decide is not a flag the app owns; it belongs
  // to one confirmed read, of one approval, on one open screen.  Four fields
  // carry that, and each closes a different way the grant could be forged:
  approvalId: null,          // which approval the open decision screen is about
  approvalVerifiedAt: null,  // the stamp a *granting* read left behind
  approvalAuthEpoch: 0,      // bumped by every exit, disconnect and error, so a
                             // read still in flight can no longer land (F-063)
  approvalSending: false,
  approvalNote: null,
  approvalsGone: {},         // SS-09 — ids that left the queue between two loads
  approvalsDecidedHere: {},  // ids this device decided, confirmed by the server
  approvalAttempts: {},      // approvalId → { operationId, decision } (F-056)
};

// F-057.  Two reads of the queue can be in flight at once — entering the screen
// while the boot read runs, a reconnect on top of a manual refresh — and the
// network does not order their answers.  Only the newest read may publish; an
// older one that lands last is dropped whole, answer and failure alike.
let approvalsGeneration = 0;

// During one revalidation the previously confirmed surface may be needed only
// to compare what disappeared when the new answer lands.  It is never published
// while the request is pending and is dropped as soon as the newest request
// settles.  Concurrent reads share this private snapshot so a newer read does
// not lose the comparison merely because the older one already withdrew it.
let approvalsRevalidationSnapshot = null;

/**
 * F-063 — end the current decision authority.
 *
 * Bumping the epoch is what makes this retroactive: a read that was already in
 * flight captured the old epoch and will refuse to grant when it lands.  Every
 * lifecycle exit calls this, and "exit" is meant broadly — leaving the screen,
 * losing the connection, regaining it, any error, any auth failure.  A grant
 * that survives one of those is a grant about a world that has since moved.
 */
function invalidateApprovalAuthority() {
  state.approvalAuthEpoch = (state.approvalAuthEpoch || 0) + 1;
  state.approvalVerifiedAt = null;
}

/**
 * F-058 — a connectivity transition invalidates the whole approval surface, not
 * just the right to decide.  MD-07 already forbids a remembered queue; a queue
 * that outlives the connection which confirmed it is exactly that, and on this
 * screen it is also the sentence "nic nečeká" said about a server nobody can
 * reach.  The in-flight read is cut loose too: its answer predates the gap.
 */
function invalidateApprovalSurface() {
  invalidateApprovalAuthority();
  approvalsGeneration++;
  approvalsRevalidationSnapshot = null;
  state.data.approvals = undefined;
  state.error.approvals = null;
  state.loading.approvals = false;
  state.approvalsGone = {};
  state.approvalNote = null;
}

/** No approval-derived process state crosses an authentication identity. */
function invalidateApprovalSession() {
  invalidateApprovalSurface();
  state.approvalsDecidedHere = {};
  state.approvalAttempts = {};
  state.approvalId = null;
  state.approvalSending = false;
}

/**
 * Server-returned scopes replace, rather than extend, the credential's grants.
 * Losing read authority withdraws every published approval surface; losing
 * write authority withdraws the narrower decision grant immediately.
 */
function replaceScopes(scopes) {
  const next = Array.isArray(scopes) ? scopes : [];
  state.pagination ||= {};
  store.set(K.scopes, next);
  if (!next.includes('write:approvals')) invalidateApprovalAuthority();
  if (!next.includes('read:approvals')) invalidateApprovalSurface();
  if (!next.includes('read:projects')) {
    projectsGeneration++;
    projectGeneration++;
    delete state.data.projects;
    delete state.data.project;
    state.error.projects = null;
    state.error.project = null;
    state.loading.projects = false;
    state.loading.project = false;
    state.cacheAge.projects = null;
    state.cacheAge.project = null;
    state.cacheAt.projects = null;
    state.cacheAt.project = null;
    store.delPrefix(K.cache + 'projects.');
    store.delPrefix(K.cache + 'project.');
  }
  if (!next.includes('read:settings')) {
    settingsGeneration++;
    delete state.data.settings;
    state.error.settings = null;
    state.loading.settings = false;
  }
  if (!next.includes('read:memory')) {
    memoryGeneration++;
    delete state.data.memory;
    state.error.memory = null;
    state.loading.memory = false;
    state.cacheAge.memory = null;
    state.cacheAt.memory = null;
    store.del(K.cache + 'memory');
  }
  if (!next.includes('read:workers')) {
    workersGeneration++;
    delete state.data.workers;
    delete state.pagination.workers;
    state.error.workers = null;
    state.loading.workers = false;
    state.cacheAge.workers = null;
    state.cacheAt.workers = null;
    store.del(K.cache + 'workers');
  }
  if (!next.includes('read:specialists')) {
    specialistsGeneration++;
    delete state.data.specialists;
    delete state.pagination.specialists;
    state.error.specialists = null;
    state.loading.specialists = false;
    state.cacheAge.specialists = null;
    state.cacheAt.specialists = null;
    store.del(K.cache + 'specialists');
  }
}

// §8.11 — the server decides the cap; this is the fallback for the moment the
// client has not been told it yet (and the number the composer blocks on).
const OPEN_OPERATION_LIMIT = 32;
// §16 — warn *before* the cap is exhausted, because afterwards nothing sends.
const OPEN_OPERATION_WARN_AT = 24;

// ── DOM helpers ─────────────────────────────────────────────────────────────
const $app = document.getElementById('app');
const $toasts = document.getElementById('toasts');

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Minimal, escape-first markdown.  Input is escaped before any markup is
 * introduced, so no assistant output can inject HTML — the model's text is
 * data, never markup.
 */
function md(text) {
  let out = esc(text);
  const blocks = [];
  out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code data-lang="${esc(lang)}">${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out
    .split(/\n{2,}/)
    .map(para => {
      if (para.startsWith('\u0000BLOCK')) return para;
      const lines = para.split('\n');
      if (lines.every(line => /^\s*[-*]\s+/.test(line))) {
        return `<ul>${lines.map(line => `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`).join('')}</ul>`;
      }
      if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) {
        return `<ol>${lines.map(line => `<li>${line.replace(/^\s*\d+[.)]\s+/, '')}</li>`).join('')}</ol>`;
      }
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('');
  return out.replace(/\u0000BLOCK(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
}

/**
 * One reading of a server timestamp, for every place that compares one.
 *
 * The gateway sends SQL `DATETIME` text for some fields and ISO-8601 for
 * others, and a bare `Date.parse` reads "2026-08-09 20:00:00" as *local* time —
 * so the same instant would land hours apart depending on the field it arrived
 * in.  `NaN` when it cannot be read, so callers fall back to words rather than
 * to a number they invented (§14).
 */
function serverTimeMs(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '');
  if (!text) return NaN;
  return Date.parse(/[TZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
}

function timeAgo(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value).replace(' ', 'T') + 'Z');
  if (!ms || Number.isNaN(ms)) return '';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'právě teď';
  if (seconds < 3600) return `před ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `před ${Math.floor(seconds / 3600)} h`;
  if (seconds < 604800) return `před ${Math.floor(seconds / 86400)} d`;
  return new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' });
}

function clock(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value).replace(' ', 'T') + 'Z');
  if (!ms || Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function toast(message, tone = 'default') {
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.tone = tone;
  node.textContent = message;
  $toasts.appendChild(node);
  setTimeout(() => node.remove(), 3400);
}

const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
  back: '<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.8-.9L3 21l2-4.9A8.4 8.4 0 0121 11.5z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  gear: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15a2 2 0 11 0-4h.1A1.7 1.7 0 004.6 7a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 3h.1A2 2 0 1113 3v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>',
  wifi: '<path d="M5 12.5a10 10 0 0114 0M8.5 16a5.5 5.5 0 017 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor"/>',
  warn: '<path d="M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  clock: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19v-8.5z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2.5h9A1.5 1.5 0 0121 10v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18V7.5z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 3v4M9 3h6M8 12h.01M16 12h.01M8.5 16h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  spark: '<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
};

const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ── Connection state (SS-03 / SS-08) ────────────────────────────────────────
function setConn(kind) {
  if (state.conn === kind) return;
  state.conn = kind;
  // F-063: losing the connection — to the network or to a server that answers
  // badly — ends the right to decide, wherever in the app it was noticed.  This
  // is the catch-all behind the explicit invalidations: every failure path in
  // the client passes through here, so none of them can forget.
  //
  // Coming *back* is not handled here on purpose.  A successful load calls
  // `setConn('ok')` immediately before it decides whether to grant, and bumping
  // the epoch at that moment would make every grant impossible.  The reconnect
  // itself is invalidated by `handleCameOnline()`, which runs before any read.
  if (kind !== 'ok') invalidateApprovalAuthority();
  // Zone 1 of the trust bar lives inside the re-rendered screen now, so a
  // connection change repaints the screen rather than a separate element.
  // Every caller already renders afterwards; doing it here as well is what
  // makes "the bar is stale" unreachable rather than a matter of discipline.
  render();
}

// ── Trust bar (UI-DESIGN §4, D-UI-2) ────────────────────────────────────────
//
// §4 calls this "the component the whole design rests on", and the reason is
// not decorative: connection, data age and permission scope are the three
// things SCREENS.md §2.1 says must never be guessed, and the way they get lost
// is a screen that forgets to mention them.  So no `viewX()` renders it —
// `render()` does, once, for whatever the view returned (see `withTrustBar`).
// "I forgot to show that this is from cache" is therefore not a reachable
// state of this code, which is a stronger property than every view remembering
// to call it.
//
// An empty bar is a statement: fresh data, online, full access.  That is the
// only state in which it says nothing at all (§4.1, level "nenápadná" — zero
// height, not an empty strip).
//
// Three zones, never two truths (§4 rule 3).  Revocation and an EXPIRED cache
// are the blocking plane, and that plane is `viewSession()` — a revoked device
// renders no content at all, so the bar never has to argue with a screen that
// should not exist.

/**
 * Which cached dataset the screen in front of the user is actually showing.
 * A route missing from this map has no cached surface, so zone 2 stays silent
 * rather than reporting the age of something else — MS-13 in particular is
 * never served from cache (MD-07) and must never look as though it were.
 */
const TRUST_DATASET = {
  overview: 'conversations',
  conversations: 'conversations',
  chat: 'thread',
  projects: 'projects',
  project: 'project',
  notifications: 'notifications',
  operations: 'operations',
  workers: 'workers',
  specialists: 'specialists',
};

/**
 * Zone 3 — what is locked by scope on *this* screen.  §4 asks for a lock when
 * "something on the screen is locked by scope", so the answer is per route:
 * a device without `write:chat` is not locked out of the approval queue.
 */
function screenLocks(route = state.route) {
  const locked = [];
  const need = (scope, label) => { if (!auth.has(scope)) locked.push(label); };
  switch (route) {
    case 'overview':
      need('read:chat', 'konverzace');
      need('read:approvals', 'schválení');
      break;
    case 'conversations':
      need('read:chat', 'konverzace');
      break;
    case 'projects':
    case 'project':
      need('read:projects', 'projekty');
      break;
    case 'workers':
      need('read:workers', 'agenty');
      break;
    case 'specialists':
      need('read:specialists', 'specialisty');
      break;
    case 'chat':
      need('write:chat', 'psaní zpráv');
      break;
    case 'notifications':
      need('read:notifications', 'zprávy');
      break;
    case 'approvals':
    case 'approval':
      if (!auth.has('read:approvals')) locked.push('frontu schválení');
      else need('write:approvals', 'rozhodování');
      break;
    default:
      break;
  }
  return locked;
}

/**
 * §14 — the age of anything is measured against the server's clock, not the
 * phone's.  The offset is refreshed by every successful `health` read; until
 * one lands it is unknown, and an unknown offset means qualitative wording
 * instead of a number, never a silently corrected one.
 */
function serverNow() {
  return Date.now() + (state.serverOffsetMs || 0);
}

/**
 * The three zones as data, so the screen-reader summary and the markup are
 * built from one source and cannot drift apart (§10).
 */
function trustZones() {
  const zones = { conn: null, age: null, lock: null };

  if (state.conn === 'offline') {
    zones.conn = { icon: 'wifi', text: 'Bez sítě', detail: 'Zobrazují se jen uložená data. Odeslat teď nelze.' };
  } else if (state.conn === 'server') {
    zones.conn = { icon: 'warn', text: 'Server neodpovídá', detail: 'Gateway odpověděla chybou. Mutace jsou zablokované.', act: 'diagnostics' };
  }

  // Before pairing there is no cached surface and no scope to lock, so zone 1
  // is the only one with anything true to say — and it has to say it, because
  // otherwise a failing pairing looks the same as a phone with no network.
  if (state.session !== 'active') return zones;

  const dataset = TRUST_DATASET[state.route];
  const status = dataset ? state.cacheAge[dataset] : null;
  if (status === 'STALE' || status === 'EXPIRED') {
    const at = dataset ? state.cacheAt[dataset] : null;
    // §14: no fresh offset means no number.  A time rendered from a phone
    // clock that is known to be wrong is worse than "starší data".
    const stamp = at && state.serverOffsetMs !== null ? clock(at) : null;
    zones.age = {
      icon: 'clock',
      text: stamp ? `Data z ${stamp}` : 'Starší data',
      detail: status === 'EXPIRED'
        ? 'Uložená kopie překročila platnost. Než se obnoví, nerozhoduj podle ní.'
        : 'Zobrazená kopie není čerstvá.',
    };
  }

  const locks = screenLocks();
  if (locks.length) {
    zones.lock = {
      icon: 'lock',
      text: 'Část obrazovky uzamčena',
      detail: `Zařízení nemá oprávnění pro: ${locks.join(', ')}. Rozsah se mění jen novým párováním.`,
    };
  }

  return zones;
}

/**
 * §4.1 — three intensities.  The ordinary state is invisible; a stale copy or
 * a narrowed scope is one quiet line; a broken connection is the only thing
 * allowed to take two.  Anything that would want the whole screen belongs in a
 * `StateBlock` inside the content, not here.
 */
function trustBar() {
  // §4.1 — the blocking plane has exactly two triggers, and `viewSession()` is
  // that plane: a revoked device and an expired credential take the whole
  // screen.  The bar stays out of their way rather than arguing beside them
  // (§4 rule 3: never two truths).
  if (state.session === 'revoked' || state.session === 'expired') return '';
  const zones = trustZones();
  const present = [zones.conn, zones.age, zones.lock].filter(Boolean);
  if (!present.length) return '';

  const level = zones.conn ? 'expanded' : 'quiet';
  // §10 — the summary is one sentence in the order the zones are read, so a
  // screen reader announces "bez sítě, data z 14:02, část obrazovky uzamčena".
  const summary = present.map(zone => zone.text).join(', ');

  const zoneHtml = (zone, name) => zone
    ? `<span class="trust-zone" data-zone="${name}">${icon(zone.icon)}<span>${esc(zone.text)}</span></span>`
    : '';

  const detail = level === 'expanded'
    ? `<p class="trust-detail">${present.map(zone => esc(zone.detail)).join(' ')}
        ${zones.conn?.act ? `<button data-act="${esc(zones.conn.act)}">Diagnostika</button>` : ''}</p>`
    : '';

  return `<div class="trust-bar" data-level="${level}" role="status" aria-live="polite" aria-label="${esc(summary)}">
    <div class="trust-zones">${zoneHtml(zones.conn, 'conn')}${zoneHtml(zones.age, 'age')}${zoneHtml(zones.lock, 'lock')}</div>
    ${detail}
  </div>`;
}

/**
 * The single seam that makes §4 structural instead of a convention.  The bar
 * goes directly under the header — it pushes content, never covers it — and a
 * screen without a header (pairing, the revocation plane) gets it at the top.
 * There is exactly one call site, in `render()`, so no view can opt out and
 * none has to opt in.
 */
function withTrustBar(html) {
  const bar = trustBar();
  if (!bar) return html;
  const end = html.indexOf('</header>');
  if (end === -1) return bar + html;
  const cut = end + '</header>'.length;
  return html.slice(0, cut) + bar + html.slice(cut);
}

// ── Navigation model (UI-DESIGN §3.1, §3.4 · D-UI-3) ────────────────────────
//
// §3.4 refuses the rule "capability X → tab X", because it welds navigation to
// scope names and breaks on the first capability that has no screen.  Four
// steps sit between the server and the bar, and this is the third and fourth:
// the client's *supported* set, and the policy that turns it into items.
//
// One consequence is load-bearing for §3.2.  The homescreen is the only map of
// the app while the bar is retracted, so "every bar item has a tile on the
// root" cannot be a rule someone remembers — it has to be the same list twice.
// `navItems()` is that list; `viewOverview()` and the bar both iterate it, so a
// new item cannot appear in one and be missing from the other.
//
// Navigation follows the *scope* (the item exists) and activity follows the
// *feature flag* (it can be used now).  §3.4 is explicit about why they must not
// be merged: a tab that vanishes because a model is down looks like lost
// permission.

const NAV_ITEMS = [
  { id: 'overview', route: 'overview', label: 'Přehled', icon: 'home', scope: null },
  { id: 'conversations', route: 'conversations', label: 'Konverzace', icon: 'chat', scope: 'read:chat' },
  { id: 'projects', route: 'projects', label: 'Projekty', icon: 'folder', scope: 'read:projects' },
  { id: 'workers', route: 'workers', label: 'Agenti', icon: 'bot', scope: 'read:workers' },
  { id: 'specialists', route: 'specialists', label: 'Specialisté', icon: 'spark', scope: 'read:specialists' },
  { id: 'approvals', route: 'approvals', label: 'Approvaly', icon: 'shield', scope: 'read:approvals' },
  // §3.3 — MS-03, MS-04 and MS-20 live under Nastavení, which replaces the
  // former standalone "Stav" item (D-UI-3).
  { id: 'settings', route: 'diagnostics', label: 'Nastavení', icon: 'gear', scope: null },
];

/** Routes that belong to a section, for "exactly one highlighted" (§3.1). */
const ROUTE_SECTION = {
  overview: 'overview',
  // MS-05 hangs directly off the root in §3.3 and is not a bar item: the bell
  // has no production producer (F-111) and no per-device ACK (F-112), so
  // UI-REVIEW §3.5 keeps it off the bar.  It is reached by a row on the root
  // and therefore belongs to the root's section — a deep destination, like a
  // single conversation inside Konverzace.
  notifications: 'overview',
  conversations: 'conversations',
  chat: 'conversations',
  projects: 'projects',
  project: 'projects',
  workers: 'workers',
  specialists: 'specialists',
  approvals: 'approvals',
  approval: 'approvals',
  diagnostics: 'settings',
  operations: 'settings',
};

/** The scopes this client version knows how to act on (§3.4, step 2). */
const SUPPORTED_SCOPES = new Set([
  'read:chat', 'write:chat', 'read:notifications',
  'read:approvals', 'write:approvals', 'read:projects', 'read:settings', 'read:memory',
  'read:workers', 'read:specialists',
]);

/**
 * §3.4 — a capability this client version does not know is ignored, written to
 * diagnostics and never rendered.  Rendering an item the client cannot service
 * is the failure mode that rule exists to prevent.
 */
function unknownScopes() {
  return (auth.scopes || []).filter(scope => !SUPPORTED_SCOPES.has(scope));
}

function navItems() {
  return NAV_ITEMS.filter(item => item.scope === null || auth.has(item.scope));
}

/**
 * Which bar item owns the route on screen.  Never two, never none — including
 * the case that would break it by accident: a scope withdrawn while its section
 * is open takes that item out of the bar, and the highlight would then be on
 * nothing at all.  The root always exists, so it is where that falls back to.
 */
function currentSection() {
  const section = ROUTE_SECTION[state.route] || 'overview';
  return navItems().some(item => item.id === section) ? section : 'overview';
}

/** The route a section lands on — where "back" out of a deep screen goes. */
function sectionRoute(section) {
  return (NAV_ITEMS.find(item => item.id === section) || {}).route || 'overview';
}

// ── Views ───────────────────────────────────────────────────────────────────

function viewPairing({ error = null, busy = false } = {}) {
  const prefill = new URLSearchParams(location.hash.slice(1)).get('pair') || '';
  return `
    <div class="pair">
      <div class="pair-brand">
        <div class="pair-mark">IS</div>
        <div>
          <h1>Připojit zařízení</h1>
          <p class="pair-lead">Naskenuj QR kód z desktopu. Token se nikam neopisuje — kód je jednorázový a má omezenou platnost.</p>
        </div>
      </div>
      ${error ? `<div class="pair-error">${esc(error)}</div>` : ''}
      <div class="field">
        <label for="pair-code">Párovací kód</label>
        <input id="pair-code" type="text" inputmode="text" autocomplete="off"
               autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="vlož nebo naskenuj" value="${esc(prefill)}">
        <p class="field-hint">Z QR se vyplní sám. Ručně jen když skener selže.</p>
      </div>
      <div class="field">
        <label for="pair-name">Název zařízení</label>
        <input id="pair-name" type="text" placeholder="např. Pixel" value="${esc(guessDeviceName())}">
      </div>
      <button class="btn btn-primary btn-block" data-act="pair" ${busy ? 'disabled' : ''}>
        ${busy ? 'Připojuji…' : 'Připojit'}
      </button>
      <div class="pair-steps">
        <strong>Na desktopu:</strong>
        <ol>
          <li>Spusť gateway s <code>C3_MOBILE_PAIRING=on</code></li>
          <li><code>node scripts/mobile-pair.js</code></li>
          <li>Naskenuj zobrazený QR kód</li>
        </ol>
      </div>
    </div>`;
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone';
  return 'Telefon';
}

/**
 * D-UI-3 removed the drawer, and with it the hamburger.  A section screen has
 * nothing to open — the bar is already on screen — so `none` is the default and
 * `back` is for deep destinations inside a section (a chat, one approval,
 * MS-20).  There is deliberately no way to spell "menu" any more.
 */
function header({ title, left = 'none', right = '' }) {
  const leftBtn = left === 'back'
    ? `<button class="icon-btn" data-act="back" aria-label="Zpět">${icon('back')}</button>`
    : '<div style="width:40px"></div>';
  return `<header class="header">${leftBtn}<div class="header-title">${esc(title)}</div>${right || '<div style="width:40px"></div>'}</header>`;
}

/** State panels. SS-02 is only ever produced from a confirmed empty response. */
function statePanel(kind, title, text, actions = '') {
  const iconName = { empty: 'inbox', server: 'warn', offline: 'wifi', revoked: 'shield', expired: 'lock', scope: 'lock', conflict: 'warn' }[kind] || 'inbox';
  return `
    <div class="state" data-kind="${kind}">
      <div class="state-icon">${icon(iconName)}</div>
      <h2 class="state-title">${esc(title)}</h2>
      <p class="state-text">${esc(text)}</p>
      ${actions}
    </div>`;
}

function errorPanel(error, retryAct = 'reload') {
  if (!error) return '';
  if (error.kind === 'offline') {
    return statePanel('offline', 'Nejsi online',
      'Telefon nemá spojení. Zobrazená data mohou být z cache.',
      `<button class="btn btn-secondary" data-act="${retryAct}">Zkusit znovu</button>`);
  }
  if (error.kind === 'server') {
    return statePanel('server', 'Server neodpovídá',
      'Síť funguje, ale backend neodpovídá. To je jiná chyba než offline.',
      `<button class="btn btn-secondary" data-act="${retryAct}">Zkusit znovu</button>
       <button class="btn btn-secondary btn-sm" data-act="diagnostics">Diagnostika</button>`);
  }
  if (error.kind === 'scope') {
    return statePanel('scope', 'Zařízení nemá oprávnění',
      `Chybí scope „${error.detail?.requiredScope || '?'}". Rozsah se mění na desktopu novým párováním.`);
  }
  // UI-DESIGN §7 is a commitment that no code is lost in a generic message,
  // and §9 forbids "Něco se pokazilo" outright — it throws away a distinction
  // the backend went to trouble to make.
  const copy = ERROR_COPY[error.code];
  if (copy) {
    // The primary action of §7 is part of the code's meaning, not decoration:
    // `OPERATION_LIMIT` without a way to MS-20 is a dead end by definition.
    const primary = copy.action
      ? `<button class="btn btn-primary" data-act="${copy.action.act}">${esc(copy.action.label)}</button>`
      : '';
    return statePanel(copy.kind, copy.title, copy.text(error),
      primary + (copy.retry === false ? '' : `<button class="btn btn-secondary" data-act="${retryAct}">Zkusit znovu</button>`));
  }
  return statePanel('server', 'Neznámý stav',
    `Server odpověděl kódem ${error.code || '(bez kódu)'}. To je chyba, kterou aplikace ještě neumí vysvětlit.`,
    `<button class="btn btn-secondary" data-act="${retryAct}">Zkusit znovu</button>
     <button class="btn btn-secondary btn-sm" data-act="diagnostics">Diagnostika</button>`);
}

/**
 * Čtyři konce, ne dva (`M1-d`).
 *
 * Dřív tu stálo `decision === 'approve' ? 'schválen' : 'zamítnut'`, takže se
 * `invalidated` i `cancelled` uživateli ukázaly jako **zamítnutí** — tedy jako
 * rozhodnutí člověka, které nikdo neudělal.  Approval, který propadl, protože
 * se změnil cíl, není totéž co „někdo řekl ne", a plést to je právě ta lež,
 * kterou `025` rozlišením `invalidated`/`cancelled` odstraňuje.
 *
 * Věta proto u obou neosobních konců **výslovně říká, že to nikdo nezamítl** —
 * bez toho by si uživatel domyslel právě to.
 */
function decidedElsewhereSentence(detail) {
  const outcome = detail?.state || detail?.decision;
  const who = detail?.decidedBy ? ` (${detail.decidedBy})` : '';

  switch (outcome) {
    case 'approve':
      return `Požadavek byl mezitím schválen jinde${who}. Tvoje rozhodnutí se zahodilo.`;
    case 'reject':
      return `Požadavek byl mezitím zamítnut jinde${who}. Tvoje rozhodnutí se zahodilo.`;
    case 'invalidated':
      return 'Požadavek mezitím propadl, protože se změnil cíl. Nikdo ho nezamítl — '
        + 'musí vzniknout nový.';
    case 'cancelled':
      return 'Požadavek byl mezitím zrušen: běh, který se ptal, přestal čekat. '
        + 'Nikdo ho nezamítl.';
    default:
      return 'Požadavek byl mezitím rozhodnut jinde. Tvoje rozhodnutí se zahodilo.';
  }
}

/** UI-DESIGN §7 — every backend code maps to one sentence the user can act on. */
const ERROR_COPY = {
  state_conflict:      { kind: 'conflict', title: 'Stav se mezitím změnil',
    text: () => 'Načti aktuální stav a potvrď znovu.' },
  operation_conflict:  { kind: 'conflict', title: 'Tenhle pokus se liší od původního',
    text: () => 'Stejný klíč nese jinou zprávu. Odešli ji jako vědomě novou operaci.', retry: false },
  approval_expired:    { kind: 'conflict', title: 'Platnost approvalu vypršela',
    text: () => 'Vrať se na frontu approvalů.', retry: false },
  approval_superseded: { kind: 'conflict', title: 'Zadání se změnilo',
    text: () => 'Přečti si nové zadání, než rozhodneš.', retry: false },
  operation_limit:     { kind: 'conflict', title: 'Máš nerozřešené pokusy',
    text: error => `${error.detail?.open ?? '?'} pokusů čeká na rozřešení. Dokud je nerozřešíš, další odeslání neprojde.`,
    action: { act: 'operations', label: 'Zobrazit nerozřešené pokusy' },
    retry: false },
  rate_limited:        { kind: 'conflict', title: 'Moc rychle po sobě',
    text: error => error.detail?.retryAfterMs
      ? `Zkus to za ${Math.ceil(error.detail.retryAfterMs / 1000)} s.`
      : 'Chvíli počkej.' },
  protocol_invalid_response: { kind: 'server', title: 'Odpověď serveru nedává smysl',
    text: () => 'Server odpověděl něčím, co nejde bezpečně přečíst. Nic se nepovažuje za hotové ani za prázdné.' },
  protocol_mismatch:   { kind: 'server', title: 'Aplikace je starší než server',
    text: () => 'Načti aplikaci znovu; pokud to nepomůže, je potřeba aktualizovat klienta.', retry: false },
  not_found:           { kind: 'empty', title: 'Už neexistuje',
    text: () => 'Vrať se na seznam.', retry: false },
  route_not_allowed:   { kind: 'scope', title: 'Tuhle funkci telefon nemá',
    text: () => 'Gateway tuhle operaci nevystavuje.', retry: false },
  bad_request:         { kind: 'server', title: 'Požadavek server nepřijal',
    text: error => error.detail?.reason === 'too_long'
      ? `Zpráva je příliš dlouhá (max ${error.detail.max}).`
      : `Chyba ve vstupu: ${error.detail?.field || error.detail?.reason || 'neznámé pole'}.`,
    retry: false },
};

function skeletonList(rows = 6) {
  return `<div class="list">${Array.from({ length: rows }, () => `
    <div class="skel-row">
      <div class="skel" style="height:15px;width:${45 + Math.random() * 40}%"></div>
      <div class="skel" style="height:12px;width:${25 + Math.random() * 25}%"></div>
    </div>`).join('')}</div>`;
}

// ── Přehled — the root (UI-DESIGN §3.2 · D-UI-3) ────────────────────────────
//
// From phase 3 the root is `Přehled`, because that is the first point at which
// it has something to aggregate.  The bar is retracted here (A3), which makes
// this screen the **only map of the app** — hence §3.2's completeness
// condition: every bar item has a row or a tile here, or its section becomes
// unreachable from the root and the user never learns it exists.
//
// The condition is not enforced by review.  The section map below iterates
// `navItems()`, the same list the bar is built from, so a new item arrives in
// both places or in neither.
//
// Tiles and the bar do not duplicate each other because their granularity
// differs: tiles lead *deep* (this approval, this conversation), the bar
// switches section.
//
// What is deliberately absent: the `Aktivní běhy` section with percentages
// from the operator's design.  `D-UI-4` replaced it with `RunSilence` — a
// percentage needs a known whole, and no agent-log stream exists (`MR-07` is
// BLOCKED_BY_CONTRACT).

/** MS-13 on the root: live, never from cache, and never a remembered count. */
function overviewApprovals() {
  const list = state.data.approvals;
  const error = state.error.approvals;

  if (error) {
    // SS-03 / SS-08 — the one branch this section must never fall through to is
    // "Nic nečeká", which is permission to put the phone down.
    return `<p class="ov-note" data-tone="danger">${esc(error.kind === 'offline'
      ? 'Bez připojení nelze zobrazit, co čeká.'
      : 'Server frontu nevydal. Kolik jich čeká, teď nevíme.')}</p>
      <button class="btn btn-secondary btn-sm" data-act="load-approvals">Zkusit načíst</button>`;
  }
  if (!Array.isArray(list)) return skeletonList(2);
  if (list.length === 0) {
    return '<p class="ov-note">Nic nečeká. Potvrzená odpověď serveru, ne odhad z paměti.</p>';
  }
  // Deep links: a tile leads to *this* approval, not to the queue (§3.2).
  return `<ul class="ov-approvals">${list.slice(0, 3).map(item => `
    <li><button class="ov-appr" data-act="open-approval" data-approval="${esc(item.id)}">
      <span class="ov-appr-title">${esc(item.title || item.subjectType || 'Požadavek na schválení')}</span>
      <span class="ov-appr-meta">${esc(item.subjectType || 'neuvedeno')} · vzniklo ${timeAgo(item.createdAt)}</span>
    </button></li>`).join('')}</ul>
    ${list.length > 3 ? `<button class="btn btn-secondary btn-sm" data-act="go" data-route="approvals">Zobrazit celou frontu (${list.length})</button>` : ''}`;
}

/** Recent conversations, as deep links.  Empty only after a confirmed answer. */
function overviewConversations() {
  const list = state.data.conversations;
  if (!list && state.error.conversations) {
    return '<p class="ov-note" data-tone="danger">Seznam konverzací se nepodařilo načíst.</p>';
  }
  if (!list) return skeletonList(2);
  if (list.length === 0) return '<p class="ov-note">Zatím žádné konverzace.</p>';
  return `<ul class="ov-list">${list.slice(0, 3).map(item => `
    <li><button class="ov-row" data-act="open-chat" data-id="${esc(item.id)}">
      <span class="ov-row-title">${esc(item.title)}</span>
      <span class="ov-row-time">${timeAgo(item.updatedAt)}</span>
    </button></li>`).join('')}</ul>`;
}

/**
 * The completeness condition, as code.  One row per bar item — including the
 * locked ones, which is the honest rendering of "an item without a screen".
 */

/**
 * D-UI-4 — this is where `Aktivní běhy` with its percentages would have been.
 * Nothing is rendered when nothing is running: a permanent empty "runs" panel
 * would imply the phone is watching, which it is not (`/m1` is pull-only).
 */
function overviewRunSilence() {
  const running = runSilenceEntries();
  if (!running.length) return '';
  return `<section class="ov-section" aria-labelledby="ov-run-h">
      <h2 class="ov-h" id="ov-run-h">Právě běží</h2>
      ${running.map(entry => runSilence({
        operationId: entry.operationId, createdAt: entry.createdAt, source: entry.source,
      })).join('')}
    </section>`;
}

function viewOverview() {
  // Layout follows the operator's template
  // (docs/mobile/design/homescreen-1_schvaleni-3.png): the tiles sit at the top,
  // under them what is waiting, then the recent conversations.
  //
  // Two deliberate departures from that image, both because the backend cannot
  // support it: no greeting by name, and no counts for things nothing counts.
  // "3 agenti běží" has no accepted runtime data source, and a made-up number
  // on the root is the exact failure this whole design system exists to prevent.
  //
  // The tiles are also what keeps §3.2 true: with the bar retracted on the root
  // the homescreen is the only map of the app, so every section has to be
  // reachable from here.  Nastavení is the gear in the header, as in the
  // template.
  // Every bar item, because with the bar retracted the root is the only map
  // (§3.2) — not only the three the template happens to show, whose bar is
  // always on screen and needs no coverage.  Counts appear where a count is a
  // fact; Projekty and Nastavení simply lead somewhere.
  const stats = navItems()
    // Nastavení is the gear in the header, as in the template — a second tile
    // for it would be the same destination twice on one screen.  §3.2 coverage
    // is kept by the gear itself, which is a real control on the root.
    .filter(item => item.id !== 'overview' && item.id !== 'settings')
    // MS-05 is deliberately not a bar item (UI-REVIEW §3.5), which makes the
    // root the *only* place it can be reached from — so it is a tile here even
    // though `navItems()` never returns it.
    .concat(auth.has('read:notifications')
      ? [{ id: 'notifications', route: 'notifications', label: 'Zprávy', icon: 'bell' }]
      : [])
    .map(item => {
      if (item.id === 'conversations') {
        const list = state.data.conversations;
        return { ...item, value: Array.isArray(list) ? `${list.length}` : null };
      }
      if (item.id === 'approvals') {
        // D-S2 / MD-07 — the queue figure is only honest when it is live.  After
        // a failed read there is no confirmed queue, so the tile carries no
        // number rather than the last one it happened to remember.
        const list = state.data.approvals;
        const confirmed = !state.error.approvals && Array.isArray(list);
        return { ...item, value: confirmed ? `${list.length} čeká` : null };
      }
      if (item.id === 'notifications') {
        return { ...item, value: Array.isArray(state.data.notifications) ? `${state.unread}` : null };
      }
      if (item.id === 'workers' || item.id === 'specialists') {
        const list = state.data[item.id];
        const partial = state.pagination[item.id]?.hasMore === true;
        return { ...item, value: Array.isArray(list) ? `${list.length}${partial ? '+' : ''}` : null };
      }
      return { ...item, value: null };
    });

  const statTiles = stats.map(tile => {
    const body = `${icon(tile.locked ? 'lock' : tile.icon)}
      <span class="ov-tile-label">${esc(tile.label)}</span>
      ${tile.locked
        ? `<span class="ov-tile-note">${icon('lock')}Připravujeme</span>`
        : (tile.value === null ? '' : `<span class="ov-tile-note">${esc(tile.value)}</span>`)}`;
    if (tile.locked) {
      return `<li class="ov-tile" data-locked="true" data-section="${esc(tile.id)}">${body}</li>`;
    }
    return `<li><button class="ov-tile" data-act="go" data-route="${esc(tile.route)}" data-section="${esc(tile.id)}">${body}</button></li>`;
  }).join('');

  const gear = '<button class="icon-btn" data-act="go" data-route="diagnostics"'
    + ` data-section="settings" aria-label="Nastavení">${icon('gear')}</button>`;

  return header({ title: 'Přehled', left: 'none', right: gear }) + `<div class="scroll"><div class="container">
    ${statTiles ? `<section class="ov-section" aria-labelledby="ov-now-h">
      <h2 class="ov-h" id="ov-now-h">Co se právě děje</h2>
      <ul class="ov-tiles ov-tiles-top">${statTiles}</ul>
    </section>` : ''}

    <section class="ov-section" aria-labelledby="ov-appr-h">
      <h2 class="ov-h" id="ov-appr-h">Čeká na tebe</h2>
      ${overviewApprovals()}
    </section>

    ${overviewRunSilence()}

    <section class="ov-section" aria-labelledby="ov-conv-h">
      <h2 class="ov-h" id="ov-conv-h">Nedávné konverzace</h2>
      ${overviewConversations()}
      ${Array.isArray(state.data.conversations) && state.data.conversations.length
        ? '<button class="ov-more" data-act="go" data-route="conversations">Zobrazit všechny</button>' : ''}
    </section>

  </div></div>`;
}

function viewConversations() {
  const list = state.data.conversations;
  const error = state.error.conversations;
  const loading = state.loading.conversations;
  const age = state.cacheAge.conversations;

  const right = `<button class="icon-btn" data-act="new-chat" aria-label="Nová konverzace">${icon('plus')}</button>`;
  let body;

  if (loading && !list) {
    body = skeletonList();
  } else if (error && !list) {
    // No cached copy to fall back on, so the failure is the whole screen.
    body = errorPanel(error, 'load-conversations');
  } else if (list && list.length === 0) {
    // Reached only after a successful response — never from a failed load.
    body = statePanel('empty', 'Zatím žádné konverzace',
      'Začni novou konverzaci a objeví se tady.',
      `<button class="btn btn-primary" data-act="new-chat">Nová konverzace</button>`);
  } else if (list) {
    body = `<div class="list">${list.map(item => `
      <button class="row" data-act="open-chat" data-id="${esc(item.id)}">
        <div class="row-main">
          <div class="row-title">${esc(item.title)}</div>
          <div class="row-sub">${item.messageCount} ${plural(item.messageCount, 'zpráva', 'zprávy', 'zpráv')}</div>
        </div>
        <div class="row-time">${timeAgo(item.updatedAt)}</div>
      </button>`).join('')}
      ${age && age !== 'FRESH' ? `<div class="kv"><span class="kv-key">Data z cache</span><span class="pill" data-tone="${age === 'STALE' ? 'warn' : 'muted'}">${age === 'STALE' ? 'zastaralá' : 'stará'}</span></div>` : ''}
      </div>`;
  } else {
    body = skeletonList();
  }

  return header({ title: 'Konverzace', right }) + `<div class="scroll">${body}</div>`;
}

function projectStateLabel(value) {
  return value === 'archived' ? 'Archivovaný' : 'Aktivní';
}

function viewProjects() {
  const list = state.data.projects;
  const error = state.error.projects;
  const loading = state.loading.projects;
  const age = state.cacheAge.projects;
  const stateSwitch = `<div class="project-filter" role="group" aria-label="Stav projektu">
    <button class="btn btn-sm ${state.projectState === 'active' ? 'btn-primary' : 'btn-secondary'}"
      data-act="project-state" data-state="active">Aktivní</button>
    <button class="btn btn-sm ${state.projectState === 'archived' ? 'btn-primary' : 'btn-secondary'}"
      data-act="project-state" data-state="archived">Archivované</button>
  </div>`;
  let body;

  if (!auth.has('read:projects')) {
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:projects, takže seznam projektů nelze zobrazit.');
  } else if (loading && !list) {
    body = skeletonList();
  } else if (error && !list) {
    body = errorPanel(error, 'load-projects');
  } else if (Array.isArray(list) && list.length === 0) {
    body = statePanel('empty',
      state.projectState === 'archived' ? 'Archiv je prázdný' : 'Zatím žádné aktivní projekty',
      'Tohle je potvrzená odpověď backendu, ne odhad z lokální cache.');
  } else if (Array.isArray(list)) {
    body = `<div class="list">${list.map(project => `
      <button class="row" data-act="open-project" data-id="${esc(project.id)}">
        <div class="row-main">
          <div class="row-title">${esc(project.name)}</div>
          <div class="row-sub">${project.conversationCount === null
            ? 'Počet konverzací není dostupný'
            : `${project.conversationCount} ${plural(project.conversationCount, 'konverzace', 'konverzace', 'konverzací')}`}</div>
        </div>
        <div class="row-time">${timeAgo(project.updatedAt)}</div>
      </button>`).join('')}
      ${age && age !== 'FRESH' ? `<div class="kv"><span class="kv-key">Data z cache</span><span class="pill" data-tone="${age === 'STALE' ? 'warn' : 'muted'}">${age === 'STALE' ? 'zastaralá' : 'stará'}</span></div>` : ''}
    </div>`;
  } else {
    body = skeletonList();
  }

  return header({ title: 'Projekty' })
    + `<div class="scroll"><div class="container">${stateSwitch}${body}</div></div>`;
}

function viewProject() {
  const project = state.data.project;
  const error = state.error.project;
  const loading = state.loading.project;
  let body;

  if (!auth.has('read:projects')) {
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:projects, takže detail projektu nelze zobrazit.');
  } else if (loading && !project) {
    body = skeletonList(4);
  } else if (error && !project) {
    body = errorPanel(error, 'load-project');
  } else if (project) {
    const createdAt = serverTimeMs(project.createdAt);
    const createdLabel = Number.isNaN(createdAt)
      ? 'Není dostupné'
      : new Date(createdAt).toLocaleDateString('cs-CZ');
    body = `<div class="container project-detail">
      <section class="card" aria-labelledby="project-detail-h">
        <div class="card-head"><h2 class="card-title" id="project-detail-h">Přehled projektu</h2></div>
        <div class="kv"><span class="kv-key">Stav</span><span class="pill" data-tone="${project.state === 'active' ? 'ok' : 'muted'}">${projectStateLabel(project.state)}</span></div>
        <div class="kv"><span class="kv-key">Konverzace</span><span>${project.conversationCount === null ? 'Není dostupné' : esc(project.conversationCount)}</span></div>
        <div class="kv"><span class="kv-key">Vytvořeno</span><span>${esc(createdLabel)}</span></div>
        <div class="kv"><span class="kv-key">Poslední aktivita</span><span>${esc(timeAgo(project.updatedAt) || 'Není dostupná')}</span></div>
      </section>
      <p class="card-note">Mobilní projekce je zatím pouze pro čtení. Soubory, shell a správa cest zůstávají na desktopu.</p>
    </div>`;
  } else {
    body = skeletonList(4);
  }

  return header({ title: project?.name || 'Projekt', left: 'back' })
    + `<div class="scroll">${body}</div>`;
}

function configuredResourceCacheNote(name) {
  const age = state.cacheAge[name];
  if (!age || age === 'FRESH') return '';
  return `<div class="kv"><span class="kv-key">Data z cache</span>
    <span class="pill" data-tone="${age === 'STALE' ? 'warn' : 'muted'}">${age === 'STALE' ? 'zastaralá' : 'stará'}</span></div>`;
}

function configuredResourceMore(name) {
  const page = state.pagination[name];
  if (!page?.hasMore) return '';
  return `<div class="resource-more">
    <button class="btn btn-secondary" data-act="load-more-${name}" ${state.loading[name] ? 'disabled' : ''}>
      ${state.loading[name] ? 'Načítám…' : 'Načíst další'}
    </button>
    <p>Seznam je výřez. Backend potvrdil další položky.</p>
  </div>`;
}

function configuredResourceInlineError(name) {
  const error = state.error[name];
  if (!error || !state.data[name]) return '';
  const text = error.kind === 'offline'
    ? 'Další data teď nelze ověřit: telefon je offline.'
    : 'Aktualizace seznamu selhala. Zobrazená kopie může být starší.';
  return `<div class="resource-inline-error" role="status">${esc(text)}
    <button class="btn btn-secondary btn-sm" data-act="load-${name}">Zkusit znovu</button>
  </div>`;
}

function workerStatus(worker) {
  if (!worker.lastRun) return { tone: 'muted', text: 'bez ukončeného běhu' };
  if (worker.lastRun.status === 'success') return { tone: 'ok', text: 'poslední běh uspěl' };
  if (worker.lastRun.status === 'partial') return { tone: 'warn', text: 'poslední běh částečný' };
  return { tone: 'danger', text: 'poslední běh selhal' };
}

function scheduledAt(value) {
  const ms = serverTimeMs(value);
  if (Number.isNaN(ms)) return value || '';
  return new Date(ms).toLocaleString('cs-CZ', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function viewWorkers() {
  const list = state.data.workers;
  const error = state.error.workers;
  const loading = state.loading.workers;
  let body;

  if (!auth.has('read:workers')) {
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:workers, takže seznam agentů nelze zobrazit.');
  } else if (loading && !list) {
    body = skeletonList();
  } else if (error && !list) {
    body = errorPanel(error, 'load-workers');
  } else if (Array.isArray(list) && list.length === 0) {
    body = statePanel('empty', 'Zatím žádní agenti',
      'Backend potvrdil prázdný seznam nakonfigurovaných agentů.');
  } else if (Array.isArray(list)) {
    body = `<div class="list">${list.map(worker => {
      const last = workerStatus(worker);
      return `<article class="resource-row">
        <div class="resource-icon" aria-hidden="true">${esc(worker.icon || 'A')}</div>
        <div class="row-main">
          <div class="resource-title-line"><span class="row-title">${esc(worker.name)}</span>
            <span class="pill" data-tone="${worker.enabled ? 'ok' : 'muted'}">${worker.enabled ? 'zapnutý' : 'vypnutý'}</span></div>
          <div class="row-sub">${esc(worker.kind || 'typ neurčen')} · ${esc(worker.description || 'bez popisu')}</div>
          <div class="resource-meta">
            <span class="pill" data-tone="${last.tone}">${esc(last.text)}</span>
            ${worker.schedule?.nextRunAt ? `<span>Další běh ${esc(scheduledAt(worker.schedule.nextRunAt))}</span>` : ''}
          </div>
        </div>
      </article>`;
    }).join('')}${configuredResourceCacheNote('workers')}${configuredResourceInlineError('workers')}${configuredResourceMore('workers')}</div>`;
  } else {
    body = skeletonList();
  }

  return header({ title: 'Agenti' }) + `<div class="scroll"><div class="container resource-screen">
    <p class="resource-lead">Konfigurace a poslední ukončený běh. Živý stav se nezobrazuje, protože jej backend neumí po restartu spolehlivě potvrdit.</p>
    ${body}
  </div></div>`;
}

function specialistStatus(status) {
  return {
    enabled: { tone: 'ok', text: 'zapnutý' },
    disabled: { tone: 'muted', text: 'vypnutý' },
    installed: { tone: 'info', text: 'nainstalovaný' },
  }[status] || { tone: 'danger', text: 'neznámý stav' };
}

function viewSpecialists() {
  const list = state.data.specialists;
  const error = state.error.specialists;
  const loading = state.loading.specialists;
  let body;

  if (!auth.has('read:specialists')) {
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:specialists, takže seznam specialistů nelze zobrazit.');
  } else if (loading && !list) {
    body = skeletonList();
  } else if (error && !list) {
    body = errorPanel(error, 'load-specialists');
  } else if (Array.isArray(list) && list.length === 0) {
    body = statePanel('empty', 'Zatím žádní specialisté',
      'Backend potvrdil prázdný seznam nainstalovaných specialistů.');
  } else if (Array.isArray(list)) {
    body = `<div class="list">${list.map(specialist => {
      const status = specialistStatus(specialist.status);
      return `<article class="resource-row">
        <div class="resource-icon" aria-hidden="true">${icon('spark')}</div>
        <div class="row-main">
          <div class="resource-title-line"><span class="row-title">${esc(specialist.name)}</span>
            <span class="pill" data-tone="${status.tone}">${esc(status.text)}</span></div>
          <div class="row-sub">${esc(specialist.domain)} · ${esc(specialist.type)} · verze ${esc(specialist.packageVersion)}</div>
          <div class="resource-meta"><span>${esc(specialist.expertiseCount)} ${plural(specialist.expertiseCount, 'expertiza', 'expertizy', 'expertiz')}</span></div>
        </div>
      </article>`;
    }).join('')}${configuredResourceCacheNote('specialists')}${configuredResourceInlineError('specialists')}${configuredResourceMore('specialists')}</div>`;
  } else {
    body = skeletonList();
  }

  return header({ title: 'Specialisté' }) + `<div class="scroll"><div class="container resource-screen">
    <p class="resource-lead">Nainstalované balíčky a jejich uložený stav. Registrace v právě běžícím procesu není součástí tohoto přehledu.</p>
    ${body}
  </div></div>`;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/**
 * `SS-03` — the top of the window says what it is.
 *
 * The rule the whole thing exists for is I-2: a history that was cut off must
 * never look complete.  So the older edge of the window is always labelled, and
 * the label depends on whether more can be fetched *right now*:
 *
 *   more, online   → a control that fetches exactly one older page
 *   more, offline  → "older messages need a connection" — the SS-03 sentence
 *   nothing more   → the beginning of the conversation, stated plainly
 *
 * The third case matters as much as the first: without it "the top of the list"
 * and "the start of the conversation" look identical.
 */
function threadBoundary() {
  // Only a server-confirmed end may claim the history is whole.  Everything
  // else — including a cached window written before this client knew how to
  // page — falls through to the sentence that admits the window is partial.
  if (state.thread.end) {
    return '<p class="thread-edge thread-edge-start">Začátek konverzace</p>';
  }
  if (state.thread.cursor && state.conn !== 'offline') {
    return `<div class="thread-edge">
      <button class="btn btn-secondary btn-sm" data-act="load-older"
        ${state.thread.loadingOlder ? 'disabled' : ''}>
        ${state.thread.loadingOlder ? 'Načítám…' : 'Načíst starší zprávy'}
      </button>
    </div>`;
  }
  return '<p class="thread-edge">Starší zprávy vyžadují připojení</p>';
}

function viewChat() {
  const thread = state.data.thread;
  const error = state.error.thread;
  const loading = state.loading.thread;

  let body;
  if (loading && !thread) {
    body = `<div class="thread">${Array.from({ length: 3 }, (_, i) => `
      <div class="msg"><div class="skel" style="height:14px;width:${i % 2 ? 70 : 90}%;margin-bottom:8px"></div>
      <div class="skel" style="height:14px;width:${i % 2 ? 45 : 60}%"></div></div>`).join('')}</div>`;
  } else if (error && !thread) {
    body = errorPanel(error, 'load-thread');
  } else if (thread && thread.messages.length === 0) {
    body = statePanel('empty', 'Nová konverzace', 'Napiš zprávu dole a začni.');
  } else if (thread) {
    // UI-DESIGN §8 forbids a pulsing "typing" indicator (B-2): it implies
    // progress the backend cannot report — there is no token streaming
    // (PLAN.md §3).  RunSilence (§6.5) says the honest thing instead: it is
    // running, we do not know where, and silence is not a freeze.
    body = `<div class="thread">${threadBoundary()}${thread.messages.map(renderMessage).join('')}
      ${state.sending ? runSilence({ operationId: state.sendingOperationId, createdAt: state.sendingSince }) : ''}
    </div>`;
  } else {
    body = '';
  }

  return header({ title: thread?.conversation?.title || 'Konverzace', left: 'back' })
    + `<div class="scroll" id="thread-scroll">${body}</div>`
    + composer();
}

// ── RunSilence (UI-DESIGN §6.5 · D-UI-4) ────────────────────────────────────
//
// Until `/m1` has a surface for the agent log, `MS-15` is not a screen but a
// strip, and the honest sentence is: we know it is running; we do not know
// where.  That is the whole component.
//
// D-UI-4 put it where the operator's design had `Aktivní běhy` with `72 %` and
// `41 %`.  A percentage is a stronger claim than "something is running" — it
// needs a known whole — and no agent-log stream exists (`MR-07` is
// BLOCKED_BY_CONTRACT, PLAN.md §4 P6 is NESPLNĚNO).  So the elapsed time is
// reported, because it is a fact the phone owns, and nothing else is.  **No
// false progress is filled in, not even temporarily.**
//
// "Zjistit stav" performs exactly one thing: `GET /m1/operations/:id`.  It may
// answer `UNKNOWN` again, and the UI promises nothing about the result turning
// up in the conversation, in notes, or in a run state.  It is the same read
// MS-20 offers, under the same name, for the same reason (§9: `UNKNOWN` is
// read, never repeated).

/**
 * §14 — a duration is measured against the clock that stamped its start.  A
 * server row is corrected by the offset; a journal entry the phone wrote is
 * not, because both ends of that subtraction are the phone's own clock.
 */
function runSilenceSeconds(entry) {
  const raw = entry.createdAt;
  const started = typeof raw === 'number'
    ? raw
    : Date.parse(String(raw ?? '').replace(' ', 'T') + 'Z');
  if (!started || Number.isNaN(started)) return null;
  const now = entry.source === 'server' ? serverNow() : Date.now();
  return Math.max(0, Math.floor((now - started) / 1000));
}

/** UI-DESIGN §6.5 — RunSilence. Elapsed time is a fact; progress would not be. */
function runSilence({ operationId = null, createdAt = null, source = 'local' } = {}) {
  const seconds = runSilenceSeconds({ createdAt, source });
  const elapsed = seconds === null
    ? null
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `<div class="run-silence" role="status">
    <div class="run-silence-head"><span class="run-mark" aria-hidden="true"></span>Běží${elapsed ? ` · ${elapsed}` : ''}</div>
    <p>Průběh běhu není z telefonu dostupný. Ticho neznamená zamrznutí.</p>
    ${operationId ? `<button class="btn btn-secondary btn-sm" data-act="resolve-op" data-op="${esc(operationId)}">Zjistit stav</button>` : ''}
  </div>`;
}

/**
 * What is actually running, as far as anyone knows: attempts the *server* still
 * reports as `PENDING`, or that the journal has not heard back about.  An
 * `UNKNOWN` attempt is deliberately not here — it is not running, it ended in a
 * way nobody can name, and MS-20 is the screen for that.
 */
function runSilenceEntries() {
  return ms20Entries().filter(entry => entry.lastKnownState === 'PENDING');
}

function renderMessage(message) {
  if (message.role === 'user') {
    const entry = message.operationId ? journal.find(message.operationId) : null;
    // An unresolved send is labelled as such. Showing it as delivered is the
    // one thing MD-19 exists to prevent.
    const chip = entry && entry.lastKnownState !== 'CONFIRMED'
      ? `<span class="op-chip" data-state="${entry.lastKnownState}">${{
          PENDING: 'odesílám', UNKNOWN: 'neznámý výsledek', REJECTED: 'neodesláno',
        }[entry.lastKnownState] || entry.lastKnownState}</span>`
      : '';
    const retry = entry && entry.lastKnownState === 'UNKNOWN'
      ? `<button class="btn btn-secondary btn-sm" data-act="resolve-op" data-op="${esc(message.operationId)}">Zjistit stav</button>`
      : '';
    return `<div class="msg msg-user">
      <div>
        <div class="bubble">${esc(message.content)}</div>
        <div class="msg-meta" style="justify-content:flex-end">${chip}${retry}<span>${clock(message.createdAt)}</span></div>
      </div>
    </div>`;
  }
  return `<div class="msg msg-assistant">
    <div class="body">${md(message.content)}</div>
    <div class="msg-meta"><span>${clock(message.createdAt)}</span></div>
  </div>`;
}

/**
 * The composer is disabled — visibly and with a reason — rather than hidden
 * (SS-03, SS-04, SS-07).  A hidden control makes the user hunt for a bug.
 */
function composer() {
  const blockers = [];
  if (!auth.has('write:chat')) {
    blockers.push({ kind: 'scope', text: 'Zařízení nemá oprávnění psát. Změna vyžaduje nové párování na desktopu.' });
  }
  if (state.conn === 'offline') {
    blockers.push({ kind: 'offline', text: 'Offline — odeslat půjde po obnovení spojení.' });
  } else if (state.conn === 'server') {
    blockers.push({ kind: 'server', text: 'Server neodpovídá — odeslání je zablokované.' });
  }
  if (state.cacheAge.thread === 'STALE' || state.cacheAge.thread === 'EXPIRED') {
    blockers.push({ kind: 'stale', text: 'Data jsou zastaralá. Obnov je před odesláním.', action: 'load-thread' });
  }
  // The cap is refused by the server, so the blocked composer points at the one
  // screen that can release it (§6.9) — not at diagnostics, which only counts.
  const openOps = state.data.operationsMeta?.open ?? journal.open().length;
  if (openOps >= OPEN_OPERATION_LIMIT) {
    blockers.push({ kind: 'limit', text: `${openOps} nerozřešených operací — další odeslání je odmítnuto, dokud je nerozřešíš.`, action: 'operations' });
  }

  const blocked = blockers.length > 0;
  return `<div class="composer">
    ${blockers.map(blocker => `<div class="composer-blocked" data-kind="${blocker.kind}">
        <span>${esc(blocker.text)}</span>
        ${blocker.action ? `<button data-act="${blocker.action}">Otevřít</button>` : ''}
      </div>`).join('')}
    <div class="composer-inner">
      <textarea id="composer-input" rows="1" placeholder="${blocked ? 'Odesílání není dostupné' : 'Napiš zprávu…'}"
        ${blocked ? 'disabled' : ''}></textarea>
      <button class="send-btn" data-act="send" ${blocked || state.sending ? 'disabled' : ''} aria-label="Odeslat">${icon('send')}</button>
    </div>
  </div>`;
}

function viewNotifications() {
  const list = state.data.notifications;
  const error = state.error.notifications;

  let body;
  if (!auth.has('read:notifications')) {
    body = statePanel('scope', 'Bez oprávnění', 'Zařízení nemá scope read:notifications.');
  } else if (state.loading.notifications && !list) {
    body = skeletonList(4);
  } else if (error && !list) {
    body = errorPanel(error, 'load-notifications');
  } else if (list && list.length === 0) {
    body = statePanel('empty', 'Žádné notifikace', 'Až se něco stane, uvidíš to tady.');
  } else if (list) {
    body = `<div class="list">${list.slice().reverse().map(item => `
      <div class="notif" data-unread="${!item.read}">
        <div class="notif-dot"></div>
        <div class="row-main">
          <div class="notif-title">${esc(item.title)}</div>
          ${item.body ? `<div class="notif-body">${esc(item.body)}</div>` : ''}
          <div class="msg-meta"><span>${timeAgo(item.createdAt)}</span><span class="pill" data-tone="muted">${esc(item.kind)}</span></div>
        </div>
      </div>`).join('')}</div>`;
  } else {
    body = skeletonList(4);
  }

  const right = state.unread > 0
    ? `<button class="icon-btn" data-act="ack-all" aria-label="Označit přečtené">${icon('inbox')}</button>` : '';
  return header({ title: 'Zprávy', right, left: 'back' }) + `<div class="scroll">${body}</div>`;
}

/**
 * Where the credential actually lives — `MR-22`, `MD-11`.
 *
 * This card exists because the honest answer differs between two builds of the
 * same client, and the user cannot tell them apart by looking.  In the browser
 * the token is in `localStorage`, which `MD-11` does not accept as `ST-SECURE`;
 * in the Android shell it is in the Keystore and sealed while the app is
 * locked.  Showing the same screen in both would make one of them a lie.
 *
 * The third state is the one worth the code: a shell whose vault would not
 * open.  It looks native, behaves like a browser, and is the only case where a
 * user could reasonably believe a protection they do not have — so it is
 * spelled out, with the reason, rather than folded into "prohlížeč".
 */
function securityCard() {
  const native = secure.native;
  const degraded = Boolean(secure.plugin) && !native;
  const tone = native ? 'ok' : degraded ? 'danger' : 'warn';
  const where = native ? 'Android Keystore' : 'prohlížeč (localStorage)';

  const note = native
    ? 'Přihlášení je šifrované klíčem, který aplikace nemůže vynést ze zařízení, a nevydá se, dokud je aplikace zamčená.'
    : degraded
      ? 'Aplikace má trezor, ale nepodařilo se ho otevřít. Přihlášení je proto uložené jako v prohlížeči — bez ochrany, kterou by Keystore dal.'
      : 'Prohlížeč bezpečné úložiště nenabízí (MD-11 žádá ST-SECURE). Platí to i pro PWA přidanou na plochu.';

  // The lock the device actually enforces decides what this card offers.  A
  // PIN field on a phone that unlocks with a fingerprint would be a second
  // secret guarding the same door — and the weaker of the two.
  const systemLock = native && secure.lock.kind === 'system';
  const lockRow = !native ? '' : systemLock
    ? `<div class="kv"><span class="kv-key">Zámek aplikace</span>
        <span class="pill" data-tone="ok">zámek telefonu</span></div>
      <div class="kv-note">Aplikace se zamkne při odchodu do pozadí a otevře ji stejný otisk, obličej nebo PIN jako telefon. Nic dalšího si nastavovat nemusíš.</div>`
    : '';

  const pin = (!native || systemLock) ? '' : secure.lock.hasPin
    ? `<div class="kv"><span class="kv-key">PIN aplikace</span>
        <span class="pill" data-tone="ok">nastaven</span></div>
      <div class="kv"><span class="kv-key">Zrušit PIN</span>
        <span class="kv-val"><input class="pin-input" id="pin-old" type="password" inputmode="numeric"
          autocomplete="off" maxlength="12" placeholder="stávající PIN">
        <button class="btn btn-secondary btn-sm" data-act="pin-clear">Zrušit</button></span></div>`
    : `<div class="kv"><span class="kv-key">PIN aplikace</span>
        <span class="pill" data-tone="warn">není</span></div>
      <div class="kv"><span class="kv-key">Nastavit PIN</span>
        <span class="kv-val"><input class="pin-input" id="pin-new" type="password" inputmode="numeric"
          autocomplete="off" maxlength="12" placeholder="alespoň 4 číslice">
        <button class="btn btn-secondary btn-sm" data-act="pin-set">Nastavit</button></span></div>
      <div class="kv-note">Tenhle telefon nemá vlastní zámek obrazovky, takže aplikaci uzamkne jen tenhle PIN. Bez něj se po návratu z pozadí neuzamkne nic — a zámek je jediná obrana proti odemčenému ztracenému telefonu (P-4).</div>`;

  return `<div class="card">
      <div class="card-head"><h3 class="card-title">Zabezpečení</h3></div>
      <div class="kv"><span class="kv-key">Úložiště přihlášení</span>
        <span class="pill" data-tone="${tone}">${esc(where)}</span></div>
      <div class="kv-note">${esc(note)}</div>
      ${degraded && secure.reason ? `<div class="kv"><span class="kv-key">Důvod</span><span class="kv-val mono">${esc(secure.reason)}</span></div>` : ''}
      ${lockRow}
      ${pin}
      ${state.error.security ? `<div class="kv-note" data-tone="danger">${esc(state.error.security)}</div>` : ''}
    </div>`;
}

/**
 * Set the app lock.  The PIN is read from the field, handed to the vault, and
 * dropped — it is never stored in `state`, never cached, and never rendered
 * back.  `MR-23`'s lock is only as good as the shortest-lived copy of the
 * secret, and client state is the longest-lived place in this file.
 */
async function setAppPin() {
  const field = document.getElementById('pin-new');
  const pin = field ? field.value : '';
  state.error.security = null;
  if (!/^\d{4,12}$/.test(pin)) {
    state.error.security = 'PIN musí být 4 až 12 číslic.';
    render();
    return;
  }
  const result = await secure.setPin(pin);
  if (field) field.value = '';
  state.error.security = result.ok ? null : `PIN se nepodařilo nastavit (${result.reason}).`;
  if (result.ok) toast('PIN nastaven');
  render();
}

async function clearAppPin() {
  const field = document.getElementById('pin-old');
  const pin = field ? field.value : '';
  state.error.security = null;
  const result = await secure.clearPin(pin);
  if (field) field.value = '';
  // A wrong PIN here is not an error condition of the app: it is the lock
  // doing its job, so it says so plainly instead of offering a retry ritual.
  state.error.security = result.ok ? null : 'PIN nesouhlasí.';
  if (result.ok) toast('PIN zrušen');
  render();
}

function publicSettingRows(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return [];
  const rows = [];
  for (const [key, value] of Object.entries(document)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [child, childValue] of Object.entries(value)) {
        rows.push({ key: `/${key}/${child}`, value: childValue });
      }
    } else {
      rows.push({ key, value });
    }
  }
  return rows.sort((left, right) => left.key.localeCompare(right.key, 'cs'));
}

function publicSettingValue(value) {
  if (value === true) return 'zapnuto';
  if (value === false) return 'vypnuto';
  if (value === null) return 'nenastaveno';
  if (typeof value === 'string') return value || 'prázdná hodnota';
  try { return JSON.stringify(value); } catch { return 'nečitelná hodnota'; }
}

function serverSettingsCard() {
  const data = state.data.settings;
  const rows = publicSettingRows(data?.settings);
  let content;
  if (!auth.has('read:settings')) {
    content = '<div class="kv-note">Zařízení nemá scope <span class="mono">read:settings</span>. Veřejné nastavení backendu proto zůstává skryté.</div>';
  } else if (state.loading.settings && !data) {
    content = '<div class="skel skel-line"></div><div class="skel skel-line short"></div>';
  } else if (state.error.settings && !data) {
    content = errorPanel(state.error.settings, 'load-settings');
  } else if (data && rows.length === 0) {
    content = '<div class="kv-note">Backend potvrdil prázdné veřejné nastavení.</div>';
  } else if (data) {
    content = rows.map(row => `<div class="kv">
      <span class="kv-key mono">${esc(row.key)}</span>
      <span class="kv-val">${esc(publicSettingValue(row.value))}</span>
    </div>`).join('');
  } else {
    content = '<div class="skel skel-line"></div><div class="skel skel-line short"></div>';
  }

  return `<div class="card">
    <div class="card-head"><h3 class="card-title">Nastavení backendu</h3>
      <span class="pill" data-tone="${auth.has('read:settings') ? 'info' : 'muted'}">${auth.has('read:settings') ? 'jen ke čtení' : icon('lock') + 'zamčeno'}</span></div>
    ${data ? `<div class="kv"><span class="kv-key">Revize</span><span class="kv-val mono">${esc(data.revision)}</span></div>` : ''}
    ${content}
  </div>`;
}

function storedInformationValue(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return 'nečitelná hodnota'; }
}

function storedInformationCard() {
  const records = state.data.memory;
  let content;
  if (!auth.has('read:memory')) {
    content = '<div class="kv-note">Zařízení nemá scope <span class="mono">read:memory</span>. Uchovávané informace proto zůstávají skryté.</div>';
  } else if (state.loading.memory && !records) {
    content = '<div class="skel skel-line"></div><div class="skel skel-line short"></div>';
  } else if (state.error.memory && !records) {
    content = errorPanel(state.error.memory, 'load-memory');
  } else if (records && records.length === 0) {
    content = '<div class="kv-note">Backend potvrdil, že zatím není nic uloženo.</div>';
  } else if (records) {
    content = records.map(record => `<article class="memory-record">
      <div class="memory-record-head">
        <span class="memory-record-key mono">${esc(record.key)}</span>
        <span class="pill" data-tone="muted">${record.kind === 'task' ? 'úkolová' : 'dlouhodobá'}</span>
      </div>
      <p class="memory-record-value">${esc(storedInformationValue(record.value))}</p>
      <div class="memory-record-meta">
        <span>${esc(record.category)}</span>
        <span>Síla ${record.strength === null ? '—' : Math.round(record.strength * 100) + '%'}</span>
        ${record.projectId ? `<span>Projekt ${esc(record.projectId)}</span>` : ''}
      </div>
    </article>`).join('');
  } else {
    content = '<div class="skel skel-line"></div><div class="skel skel-line short"></div>';
  }

  const cacheNote = records && state.cacheAge.memory === 'STALE'
    ? '<div class="kv-note" data-tone="warn">Zobrazuje se starší uložená kopie. Obnoví se, až bude backend dostupný.</div>'
    : '';

  return `<div class="card">
    <div class="card-head"><h3 class="card-title">Paměť</h3>
      <span class="pill" data-tone="${auth.has('read:memory') ? 'info' : 'muted'}">${auth.has('read:memory') ? 'jen ke čtení' : icon('lock') + 'zamčeno'}</span></div>
    ${cacheNote}
    ${content}
  </div>`;
}

function viewDiagnostics() {
  const health = state.data.health;
  const caps = state.data.capabilities;
  // The server's list wins: the cap that blocks mutations is enforced there,
  // so showing only the local journal could claim room that does not exist.
  const open = state.data.operations || journal.open();
  const meta = state.data.operationsMeta || { open: open.length, limit: OPEN_OPERATION_LIMIT };

  const upstreamTone = health?.upstream === 'ok' ? 'ok' : 'danger';

  return header({ title: 'Nastavení' }) + `<div class="scroll"><div class="container">
    <div class="card">
      <div class="card-head"><h3 class="card-title">Vzhled</h3></div>
      <label class="pref">
        <span class="pref-text">
          <span class="pref-label">Skrýt lištu na domovské obrazovce</span>
          <span class="pref-note">Lišta sjede dolů, jakmile dojede na Domů, a uvolní
          celou plochu přehledu. Vypni, pokud ji chceš mít pořád po ruce.</span>
        </span>
        <input type="checkbox" data-act="pref-toggle" data-pref="hideBarOnHome"
          ${prefs.get('hideBarOnHome') ? 'checked' : ''}>
      </label>
    </div>

    ${serverSettingsCard()}

    ${storedInformationCard()}

    <div class="card">
      <div class="card-head"><h3 class="card-title">Spojení</h3></div>
      <div class="kv"><span class="kv-key">Gateway</span>
        <span class="pill" data-tone="${health ? 'ok' : 'danger'}">${health ? 'dostupná' : 'nedostupná'}</span></div>
      <div class="kv"><span class="kv-key">Backend (upstream)</span>
        <span class="pill" data-tone="${upstreamTone}">${health?.upstream === 'ok' ? 'dostupný' : 'nedostupný'}</span></div>
      ${health?.upstreamDetail ? `<div class="kv"><span class="kv-key">Důvod</span><span class="kv-val mono">${esc(health.upstreamDetail)}</span></div>` : ''}
      <div class="kv"><span class="kv-key">Protokol</span><span class="kv-val mono">${esc(health?.protocolVersion || '—')}</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">Zařízení</h3></div>
      <div class="kv"><span class="kv-key">Název</span><span class="kv-val">${esc(caps?.device?.name || '—')}</span></div>
      <div class="kv"><span class="kv-key">ID</span><span class="kv-val mono">${esc((auth.device || '—').slice(0, 20))}…</span></div>
      <div class="scope-list">
        ${(auth.scopes || []).map(scope => `<span class="pill" data-tone="info">${esc(scope)}</span>`).join('') || '<span class="pill" data-tone="muted">žádné</span>'}
      </div>
      <!-- §3.4: a capability this client version does not know is ignored by
           the navigation and written down here instead.  Rendering an item the
           client cannot service is the failure that rule prevents; saying
           nothing at all would hide a protocol that has moved on. -->
      ${unknownScopes().length ? `
      <div class="kv"><span class="kv-key">Neznámé capability</span>
        <span class="kv-val mono">${esc(unknownScopes().join(', '))}</span></div>
      <div class="kv-note">Server hlásí oprávnění, která tahle verze klienta neumí obsloužit. Navigace je ignoruje — nevykreslí položku, pod kterou by nic nebylo.</div>` : ''}
    </div>

    <!-- Until MS-20 existed this card *was* the recovery surface: it could look
         a state up and abandon an attempt, so the cap had a way out.  §6.9 says
         that substitute "zaniká s jejím dodáním" — the screen exists now, so
         what is left here is the diagnostic fact (how many hang) and the door
         to the place that resolves them. -->
    <div class="card">
      <div class="card-head"><h3 class="card-title">Nerozřešené pokusy</h3></div>
      <div class="kv"><span class="kv-key">Otevřené</span>
        <span class="pill" data-tone="${meta.atLimit ? 'danger' : open.length ? 'warn' : 'ok'}">${meta.open ?? open.length} / ${meta.limit}</span></div>
      ${open.length === 0
        ? '<div class="kv-note">Nic nevisí.</div>'
        : '<div class="kv-note">Nerozřešené záznamy nemizí časem. Uvolní je jen zjištění stavu ze serveru, nebo vědomé opuštění — obojí patří na obrazovku nerozřešených pokusů.</div>'}
      <div class="kv"><span class="kv-key">Obnova</span>
        <button class="btn btn-secondary btn-sm" data-act="operations">Otevřít nerozřešené pokusy</button></div>
    </div>

    ${securityCard()}

    <div class="card">
      <div class="card-head"><h3 class="card-title">Relace</h3></div>
      <div class="kv"><span class="kv-key">Odhlásit zařízení</span>
        <button class="btn btn-danger btn-sm" data-act="logout">Odhlásit</button></div>
    </div>
  </div></div>`;
}

/**
 * The server's closed vocabulary for "why is this UNKNOWN" turned into one
 * sentence a user can act on (GATEWAY.md §6).  The server never sends prose —
 * that is what makes this mapping possible at all, and what keeps an upstream
 * error string from ending up on the screen.
 *
 * Every sentence answers the same question: could the effect have happened?
 */
const UNKNOWN_REASON_COPY = {
  upstream_timeout:
    'Požadavek odešel, ale odpověď nepřišla včas. Efekt mohl proběhnout.',
  upstream_unreachable:
    'Spojení s backendem se vůbec nenavázalo. Efekt nejspíš nezačal, jisté to ale není.',
  connection_lost_after_dispatch:
    'Spojení spadlo až po odeslání. Efekt mohl proběhnout celý.',
  upstream_error_status:
    'Backend odpověděl chybou. Mohl přitom stihnout něco udělat.',
  process_terminated:
    'Gateway se ukončila, zatímco operace běžela. Výsledek se nestihl zapsat.',
  result_persistence_failed:
    'Operace doběhla, ale výsledek se nepodařilo uložit. Efekt nejspíš proběhl.',
  gateway_exception:
    'Gateway skončila chybou uprostřed operace. Výsledek není známý.',
  unspecified:
    'Server důvod nezaznamenal. Zbývá jen zjistit stav znovu.',
};

// ── MS-20 — unresolved attempts (UI-DESIGN §6.9) ────────────────────────────
//
// Not a list: a way out.  The server refuses every further mutation once the
// cap is reached, and PENDING/UNKNOWN never expire — `purgeResolved()` touches
// only CONFIRMED and REJECTED — so without this screen the app reaches a state
// it cannot leave on its own.
//
// Three things this screen must never do, each of which would be an ordinary
// product decision anywhere else:
//
//   * claim the shown state is live.  A lookup reads the *last recorded* state
//     and does not reconcile with upstream (MR-25), so every row says "ověřeno
//     před N" instead of implying continuous checking.
//   * repeat anything — one attempt or all of them.  A single tap that reissues
//     N ambiguous effects is the exact failure MD-19 exists to prevent, which
//     is why there is no retry button here at all and why the read is named
//     "Zjistit stav" (§9).
//   * abandon on the user's behalf, or in one tap.  Abandoning closes the
//     *record*, not the effect; the price is stated and then confirmed
//     separately, one attempt at a time (MD-19 §4.3).

const MS20_STATE_LABEL = {
  PENDING: 'čeká na výsledek',
  UNKNOWN: 'výsledek neznám',
};

/** Content-free labels for the operation types the journal can hold (MD-19). */
const OPERATION_TYPE_LABEL = {
  'chat.send': 'Odeslání zprávy',
  'approval.decide': 'Rozhodnutí approvalu',
};

/**
 * One list from two sources.  The server decides the cap, so its rows win; the
 * journal supplies the content-free label the server never stores, and — when
 * the list could not be fetched — the rows themselves.  A key only the phone
 * knows is marked as such: "the server did not return this key" and "the server
 * reports it open" are different facts, and MD-19 §4.1 rule 3 turns on exactly
 * that difference.
 */
function ms20Entries() {
  const local = new Map(journal.open().map(entry => [entry.operationId, entry]));
  const server = state.data.operations;

  if (!server) {
    return [...local.values()].map(entry => ({ ...entry, source: 'local' }));
  }

  const rows = server.map(row => {
    const mine = local.get(row.operationId) || {};
    return {
      operationId: row.operationId,
      operationType: row.operationType || mine.operationType || null,
      displaySummary: mine.displaySummary || null,
      lastKnownState: row.state,
      unknownReason: row.unknownReason || mine.unknownReason || null,
      unknownAt: row.unknownAt || null,
      createdAt: row.createdAt || mine.createdAt || null,
      lastCheckedAt: row.lastCheckedAt || mine.lastCheckedAt || null,
      source: 'server',
    };
  });
  const returned = new Set(rows.map(row => row.operationId));
  for (const [operationId, entry] of local) {
    if (!returned.has(operationId)) rows.push({ ...entry, source: 'local' });
  }
  return rows;
}

/**
 * Apply a single-attempt answer to the visible snapshot.  `GET /m1/operations`
 * is the authority on *which* attempts are open, but for one attempt the direct
 * lookup is newer, and the row must not keep describing a state the server has
 * just contradicted while a refresh is pending — or failing.
 */
function ms20PatchRow(operationId, patch) {
  const row = (state.data.operations || []).find(item => item.operationId === operationId);
  if (row) Object.assign(row, patch);
  ms20UpdateCachedSnapshot(snapshot => {
    const cachedRow = snapshot.list.find(item => item.operationId === operationId);
    if (cachedRow) Object.assign(cachedRow, patch);
    return snapshot;
  });
}

/**
 * A direct per-item answer is newer than the full-list snapshot for that one
 * item. Keep it across a restart, but retain the full list's original `at`:
 * changing one row cannot make the rest of the list fresh.
 */
function ms20UpdateCachedSnapshot(update) {
  const cached = store.get(K.cache + 'operations');
  if (!cached?.data || !Array.isArray(cached.data.list)) return;
  const snapshot = {
    ...cached.data,
    list: cached.data.list.map(item => ({ ...item })),
    meta: cached.data.meta ? { ...cached.data.meta } : cached.data.meta,
  };
  store.set(K.cache + 'operations', { at: cached.at, data: update(snapshot) });
}

/**
 * Take one attempt out of the snapshot and give its slot back to the cap.
 *
 * Called when a lookup resolves an attempt or an abandon succeeds — both are
 * authoritative single-item facts.  The count is corrected here rather than
 * left to the refresh, because a refresh that fails would otherwise leave the
 * screen claiming a slot that is provably free, on the one screen whose whole
 * job is to show what is holding the cap.
 */
function ms20ReleaseRow(operationId, { open = null, limit = null } = {}) {
  const hadServerRow = Array.isArray(state.data.operations)
    && state.data.operations.some(item => item.operationId === operationId);
  if (Array.isArray(state.data.operations)) {
    state.data.operations = state.data.operations.filter(item => item.operationId !== operationId);
  }
  const meta = state.data.operationsMeta;
  const nextLimit = limit ?? meta?.limit ?? OPEN_OPERATION_LIMIT;
  const nextOpen = open ?? (meta
    ? (hadServerRow ? Math.max(0, (meta.open ?? 0) - 1) : meta.open)
    : (state.data.operations?.length ?? 0));
  state.data.operationsMeta = { open: nextOpen, limit: nextLimit, atLimit: nextOpen >= nextLimit };
  ms20UpdateCachedSnapshot(snapshot => {
    const hadCachedServerRow = snapshot.list.some(item => item.operationId === operationId);
    snapshot.list = snapshot.list.filter(item => item.operationId !== operationId);
    const cachedLimit = limit ?? snapshot.meta?.limit ?? OPEN_OPERATION_LIMIT;
    const cachedOpen = open ?? (snapshot.meta
      ? (hadCachedServerRow ? Math.max(0, (snapshot.meta.open ?? 0) - 1) : snapshot.meta.open)
      : snapshot.list.length);
    snapshot.meta = { open: cachedOpen, limit: cachedLimit, atLimit: cachedOpen >= cachedLimit };
    return snapshot;
  });
}

function ms20Title(entry) {
  return entry.displaySummary
    || OPERATION_TYPE_LABEL[entry.operationType]
    || entry.operationType
    || 'operace';
}

/** The cap, said as a number and — at 24 and at 32 — as a consequence (§16). */
function ms20Cap(entries) {
  const meta = state.data.operationsMeta;
  const open = meta?.open ?? entries.length;
  const limit = meta?.limit ?? OPEN_OPERATION_LIMIT;
  const atLimit = meta?.atLimit ?? (open >= limit);
  const nearLimit = !atLimit && open >= OPEN_OPERATION_WARN_AT;
  const tone = atLimit ? 'danger' : (nearLimit || open) ? 'warn' : 'ok';

  return `<div class="ms20-cap" data-tone="${tone}" role="status" aria-live="polite">
    <div class="ms20-cap-count">
      <span>Nerozřešené pokusy</span>
      <span class="pill" data-tone="${tone}">${open} / ${limit}</span>
    </div>
    ${atLimit ? `<p class="ms20-cap-note">Strop je vyčerpaný. Dokud pokusy nerozřešíš nebo neopustíš, nejde nic odeslat ani schválit.</p>` : ''}
    ${nearLimit ? `<p class="ms20-cap-note">Zbývá ${limit - open} míst do stropu ${limit}. Po jeho vyčerpání neprojde žádná mutace.</p>` : ''}
  </div>`;
}

/**
 * Where the list came from and how old it is.  §9 forbids letting the age
 * disappear while a refresh runs — "Data z 14:02, aktualizuji", never
 * "Aktualizuji…" — because a screen about unresolved state is the last place
 * that may look more current than it is.
 */
function ms20Provenance() {
  const error = state.error.operations;
  if (error) {
    const text = error.kind === 'offline'
      ? 'Nejsi online. Tohle je poslední známý stav z telefonu, ne odpověď serveru.'
      : 'Server seznam nevrátil. Tohle je poslední známý stav z telefonu, ne odpověď serveru.';
    return `<div class="ms20-note" data-tone="${error.kind === 'offline' ? 'offline' : 'server'}" role="status">
      <span>${esc(text)}</span>
      <button class="btn btn-secondary btn-sm" data-act="load-operations">Zkusit znovu</button>
    </div>`;
  }

  const age = state.cacheAge.operations;
  if (!age || age === 'FRESH') return '';
  const from = state.data.operationsAt ? `Data z ${clock(state.data.operationsAt)}` : 'Data z dřívějška';
  const text = state.loading.operations
    ? `${from}, aktualizuji.`
    : `${from}. Seznam nemusí odpovídat tomu, co je na serveru teď.`;
  return `<div class="ms20-note" data-tone="stale" role="status">
    <span>${esc(text)}</span>
    ${state.loading.operations ? '' : '<button class="btn btn-secondary btn-sm" data-act="load-operations">Aktualizovat</button>'}
  </div>`;
}

/**
 * One attempt.  Everything a decision needs is on the row: what was attempted,
 * the last known state, why it is unknown, how long it has been unknown, and
 * when that state was last read back.  The last one is what keeps the row
 * honest — without it the screen reads like a live monitor (B-18).
 */
function ms20Row(entry) {
  const operationId = entry.operationId;
  const operationState = entry.lastKnownState || 'PENDING';
  const title = ms20Title(entry);
  const label = MS20_STATE_LABEL[operationState] || operationState;

  // §16: the age of an UNKNOWN is counted from `unknownAt`, not from creation.
  // An attempt that ran for an hour and then lost its answer is not an
  // hour-old UNKNOWN, and treating it as one would rush the escalation.
  const age = operationState === 'UNKNOWN' && entry.unknownAt
    ? `neznámé ${timeAgo(entry.unknownAt)}`
    : entry.createdAt ? `pokus ${timeAgo(entry.createdAt)}` : 'stáří pokusu neznámé';
  const checked = entry.lastCheckedAt
    ? `ověřeno ${timeAgo(entry.lastCheckedAt)}`
    : 'zatím neověřeno';
  const reason = operationState === 'UNKNOWN'
    ? UNKNOWN_REASON_COPY[entry.unknownReason] || UNKNOWN_REASON_COPY.unspecified
    : '';

  const note = state.opsNote[operationId];
  const looking = Boolean(state.opsLookup[operationId]);
  const confirming = state.opsConfirm === operationId;
  const abandoning = state.opsAbandoning === operationId;
  // One abandon at a time: while one is running every other row's abandon is
  // disabled *with a reason*, rather than silently doing nothing on tap.
  const otherAbandonRunning = Boolean(state.opsAbandoning) && !abandoning;

  const actions = confirming
    ? `<div class="ms20-confirm" role="alert">
        <p class="ms20-price">Efekt na serveru zůstane nerozřešený. Opuštěním se zavře jen záznam v telefonu — operace se tím neruší a z tohohle zařízení ji už nedohledáš.</p>
        <div class="op-actions">
          <button class="btn btn-danger btn-sm" data-act="ms20-abandon-confirm" data-op="${esc(operationId)}"
            aria-label="Potvrdit opuštění pokusu ${esc(title)} — efekt zůstane nerozřešený">Opustit natrvalo</button>
          <button class="btn btn-secondary btn-sm" data-act="ms20-abandon-cancel" data-op="${esc(operationId)}"
            aria-label="Zrušit opuštění pokusu ${esc(title)}">Zpět</button>
        </div>
      </div>`
    : `<div class="op-actions">
        <button class="btn btn-secondary btn-sm" data-act="ms20-lookup" data-op="${esc(operationId)}"
          aria-label="Zjistit stav pokusu ${esc(title)}" ${looking ? 'disabled aria-busy="true"' : ''}>
          ${looking ? 'Zjišťuji…' : 'Zjistit stav'}
        </button>
        <button class="btn btn-secondary btn-sm" data-act="ms20-abandon-ask" data-op="${esc(operationId)}"
          aria-label="Opustit pokus ${esc(title)}" ${abandoning || otherAbandonRunning ? 'disabled' : ''}>
          ${abandoning ? 'Opouštím…' : 'Opustit'}
        </button>
      </div>`;

  return `<li class="op-row ms20-row" data-op="${esc(operationId)}" data-state="${operationState}">
    <div class="row-main">
      <div class="ms20-title">${esc(title)}</div>
      <div class="ms20-line">
        <span class="op-chip" data-state="${operationState}">${esc(label)}</span>
        <span class="ms20-age">${esc(age)}</span>
      </div>
      ${reason ? `<p class="op-why">${esc(reason)}</p>` : ''}
      <div class="op-meta">${esc(checked)} · poslední zapsaný stav, ne živý${entry.source === 'local' ? ' · server tento klíč nevrátil' : ''}</div>
      <div class="op-id">${esc(operationId.slice(0, 20))}…</div>
      ${otherAbandonRunning ? '<p class="ms20-note" data-tone="muted">Probíhá opuštění jiného pokusu. Opouští se po jednom.</p>' : ''}
      ${note ? `<p class="ms20-note" data-tone="${esc(note.tone)}" role="status">${esc(note.text)}</p>` : ''}
    </div>
    ${actions}
  </li>`;
}

function viewOperations() {
  const list = state.data.operations;
  const error = state.error.operations;
  const loading = state.loading.operations;
  const entries = ms20Entries();

  let body;
  if (entries.length === 0 && (loading || (!list && !error))) {
    body = skeletonList(3);
  } else if (entries.length === 0 && error && !list) {
    // SS-02 vs SS-03/SS-08: a failed load never becomes "nic nevisí". Here the
    // two would be opposite advice — one says the cap is free, the other that
    // we could not ask.
    body = errorPanel(error, 'load-operations');
  } else if (entries.length === 0 && error) {
    // Different case, different screen: every attempt we knew of was resolved
    // or abandoned by an answer from the server, and only the refresh that
    // would confirm the new count failed.  Saying just "nic nevisí" would hide
    // the failure; showing only the failure would hide a cap that is provably
    // free.  Both, then.
    body = `<div class="container">
      ${ms20Cap(entries)}
      ${ms20Provenance()}
      <p class="ms20-foot">Podle posledních potvrzených odpovědí serveru už žádný pokus nečeká na rozřešení. Až budeš mít spojení, ověř to aktualizací.</p>
    </div>`;
  } else if (entries.length === 0) {
    body = statePanel('empty', 'Nic nevisí',
      'Žádný pokus nečeká na rozřešení. Strop je volný a odesílání nic neblokuje.');
  } else {
    body = `<div class="container">
      ${ms20Cap(entries)}
      ${ms20Provenance()}
      <p class="ms20-lead">Stav se čte, neopakuje. „Zjistit stav" přečte poslední zapsaný výsledek jednoho pokusu — nic neodesílá znovu.</p>
      <ul class="ms20-list card">${entries.map(ms20Row).join('')}</ul>
      <p class="ms20-foot">Nerozřešené záznamy nemizí časem. Uvolní je jen výsledek ze serveru, nebo vědomé opuštění.</p>
    </div>`;
  }

  return header({ title: 'Nerozřešené pokusy', left: 'back' }) + `<div class="scroll">${body}</div>`;
}

// ── MS-13 — approval queue (SCREENS §4 MS-13, MD-07) ────────────────────────
//
// Every other list in this app may fall back to cache.  This one must not, and
// the reason is not performance:
//
//   * `MD-07` says approvals are never cached, so `SS-04` (stale) "cannot
//     occur" here.  The only way to keep that true is to never write one.
//   * `SS-03` says that offline the queue is not shown **at all** — not an
//     empty list.  "Nic nečeká" is permission to walk away from the phone.
//     Showing it while the server is unreachable is the most dangerous lie
//     this screen could tell, so an empty queue is rendered only from a
//     confirmed 200.
//   * `SS-08` says the same about a server failure: the error, never a count.
//
// `MS-14` (deciding) is deliberately not here.  This screen reads.

/** Approvals that vanished from the queue between two confirmed loads (SS-09). */
function approvalsGone() {
  return Object.values(state.approvalsGone || {});
}

/**
 * §14 / F-100 — the countdown is information, the server is the authority.
 *
 * It is rendered from `expiresAt` corrected by the server offset, and it is
 * *approximate on purpose*.  Without a confirmed offset there is no number at
 * all: a countdown computed from a phone clock known to be wrong would either
 * grey the buttons out early or leave them lit after the window closed, and
 * §14 forbids silently correcting for that.
 */
function approvalCountdown(item) {
  if (item.expired === true) return { expired: true, text: 'vypršelo — rozhodnout už nelze' };
  // `025`: approval vázaný na cíl **nepropadá časem**, takže odpočet by byl
  // nepravda — a nepravda toho nejhoršího druhu, protože by tlačila k rychlému
  // rozhodnutí tam, kde na něj je čas.  Co ho ukončí, je změna cíle.
  if (item.validity === 'precondition') {
    return { expired: false, bound: true, text: 'platí, dokud se cíl nezmění' };
  }
  const expiresAt = serverTimeMs(item.expiresAt);
  if (Number.isNaN(expiresAt) || state.serverOffsetMs === null) {
    return { expired: false, text: 'vyprší brzy' };
  }
  const minutes = Math.max(0, Math.round((expiresAt - serverNow()) / 60000));
  return { expired: false, minutes, text: `zbývá ${minutes} min` };
}

/**
 * The length of the window, as the server actually set it — never a constant.
 *
 * `DR-011` is local 5 minutes and remote 15; the operator's design showed 10,
 * which matches neither, and that is what a number typed into a UI does.  The
 * two server timestamps already in the payload say it exactly, so the client
 * has no reason to hold an opinion (`UI-DESIGN.md` §14, F-100).
 */
function approvalWindowMinutes(item) {
  // U approvalu vázaného na cíl žádné okno neexistuje; `expiresAt` je strop
  // proti zapomenutému řádku, ne lhůta, kterou má člověk stihnout.  Vrátit tady
  // číslo by znamenalo napsat na obrazovku „z 30denního okna", což by znělo
  // jako pravidlo, a ono to je pojistka.
  if (item?.validity === 'precondition') return null;
  const created = serverTimeMs(item?.createdAt);
  const expires = serverTimeMs(item?.expiresAt);
  if (Number.isNaN(created) || Number.isNaN(expires) || expires <= created) return null;
  return Math.round((expires - created) / 60000);
}

function approvalRow(item) {
  const expired = item.expired === true;
  // R-3: the server's expiry is the authority.  The queue shows the countdown
  // but never computes a decision from it.
  const countdown = approvalCountdown(item);
  return `
  <li class="appr-row">
    <button class="appr-open" data-act="open-approval" data-approval="${esc(item.id)}">
    <div class="row-main">
      <div class="appr-title">${esc(item.title || item.subjectType || 'Požadavek na schválení')}</div>
      ${item.detail ? `<div class="appr-detail">${esc(item.detail)}</div>` : ''}
      <div class="msg-meta">
        <span>${esc(item.subjectType || 'neuvedeno')}</span>
        <span>vzniklo ${timeAgo(item.createdAt)}</span>
        <span class="pill" data-tone="${expired ? 'warn' : 'muted'}">${esc(countdown.text)}</span>
      </div>
    </div>
    </button>
  </li>`;
}

function viewApprovals() {
  const list = state.data.approvals;
  const error = state.error.approvals;
  const gone = approvalsGone();

  // SS-09: an approval decided elsewhere simply stops being returned.  The
  // list endpoint only returns undecided rows and carries no decided_by or
  // decided_at, so the note says what is known and refuses to invent the rest.
  const note = state.approvalNote;
  const outcome = note
    ? `<div class="appr-note" data-tone="${esc(note.tone)}" role="status"><p>${esc(note.text)}</p></div>`
    : '';

  const goneNote = gone.length === 0 ? '' : `
    <div class="appr-gone" role="status">
      ${gone.map(item => (item.ownAttempt
        // F-064: the honest sentence for an ambiguous own attempt.  It names the
        // one thing we know (we tried, and never learned the outcome), refuses
        // the one we do not (that anybody else acted), and ends where the answer
        // actually is.
        ? `<p>„${esc(item.title || item.id)}" už ve frontě není. Tvůj vlastní pokus o rozhodnutí zůstal nerozřešený, takže to mohl být právě on — a stejně dobře někdo jiný. Tahle odpověď to nerozliší. Stav svého pokusu zjistíš v Nerozřešených pokusech.</p>`
        : `<p>„${esc(item.title || item.id)}" už ve frontě není — byl mezitím rozhodnut jinde. Kým a kdy, to tahle odpověď neříká.</p>`)).join('')}
    </div>`;

  let body;
  if (!auth.has('read:approvals')) {
    // SS-07: fail-closed, and say which scope is missing rather than showing
    // an empty screen the user would read as "nothing waiting".
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:approvals, takže frontu schválení nelze zobrazit. Neznamená to, že je prázdná.');
  } else if (error && error.kind === 'scope') {
    // F-060.  The local check above has always denied the empty reading; the
    // server's own refusal fell through to the generic error panel, which says
    // only that permission is missing.  On this screen that silence is the same
    // dangerous one: a refusal to *look* says nothing whatever about what is
    // waiting, and the user must not be left to fill in the difference.
    body = statePanel('scope', 'Server frontu nevydal',
      `Server odmítl frontu schválení — chybí scope „${error.detail?.requiredScope || 'read:approvals'}". `
      + 'Neznamená to, že je prázdná; znamená to, že se na ni tohle zařízení nesmí zeptat. '
      + 'Rozsah se mění na desktopu novým párováním.');
  } else if (error) {
    // SS-03 and SS-08 both land here, and errorPanel already tells them apart.
    // What matters is that neither can reach the "nic nečeká" branch below.
    body = errorPanel(error, 'load-approvals');
  } else if (state.loading.approvals && !list) {
    body = skeletonList(3);
  } else if (!list) {
    body = skeletonList(3);
  } else if (list.length === 0) {
    // SS-02, and only from a confirmed empty response.
    body = statePanel('empty', 'Nic nečeká',
      'Žádný požadavek nečeká na schválení. Tohle je potvrzená odpověď serveru, ne odhad z paměti.');
  } else {
    body = `<div class="container">
      <p class="appr-lead">Fronta se načítá vždy ze serveru a nikdy se neukládá do zařízení. Proto ji offline neuvidíš — místo toho se to řekne nahlas.</p>
      <ul class="appr-list card">${list.map(approvalRow).join('')}</ul>
    </div>`;
  }

  return header({ title: 'Schválení' }) + `<div class="scroll">${outcome}${goneNote}${body}</div>`;
}

// ── MS-14 — deciding an approval ★ (SCREENS §4 MS-14, MD-07, MD-12, MD-19) ──
//
// The most dangerous flow in the app, and the three rules SCREENS names are the
// whole design:
//
//   1. a decision is made only about state just loaded from the server, never
//      about anything remembered;
//   2. the decision is bound to the fingerprint of the payload that was on
//      screen — if the payload moved, the agreement is void;
//   3. a second send is a recognisable conflict, not a second approval.
//
// Everything below follows from those.  In particular there is **no retry
// control anywhere on this screen** (SS-10 forbids automatic retry, and a
// button labelled "zkusit znovu" next to an approval is how one grant becomes
// two).  What the screen offers after a failure is a *read*: load the current
// state and decide again, consciously, on whatever is true now.

/** The approval being decided, taken only from a confirmed load. */
function approvalUnderDecision() {
  const list = state.data.approvals;
  if (!Array.isArray(list)) return null;
  return list.find(item => item.id === state.approvalId) || null;
}

/**
 * F-056 — is there an attempt on this approval whose outcome we do not know?
 *
 * MD-19 rule 3 has two halves and the first suite only proved one of them.  The
 * key survives an ambiguous outcome: yes.  But an ambiguous outcome also means
 * the decision may already be recorded on the server, so the approval is *not*
 * decidable again — not under a new key, which would be a second grant from one
 * human "yes", and not under the old one, which would be a resend of something
 * that may already have taken effect.  Neither is recovery.  Recovery is MS-20's
 * read, and that read is exactly what resolves the journal entry consulted here.
 *
 * The journal is the authority, not the in-memory record: it is what MS-20
 * updates, so resolving an attempt there lifts this block without any coupling
 * between the two screens.  A record the user consciously abandoned (MD-19 §4.3,
 * with its price stated) is gone from the journal and lifts the block too —
 * abandoning is a decision about that record, made knowingly.
 */
function unresolvedApprovalAttempt(approvalId) {
  const attempt = (state.approvalAttempts || {})[approvalId];
  if (!attempt) return null;
  const entry = journal.find(attempt.operationId);
  if (!entry) return null;
  return entry.lastKnownState === 'PENDING' || entry.lastKnownState === 'UNKNOWN'
    ? { ...attempt, state: entry.lastKnownState }
    : null;
}

/**
 * F-090 — a cold process can retain an approval.decide journal record without
 * retaining the process-local approvalId association.  Absence of that volatile
 * association is uncertainty, never resolution: while such a key is open every
 * approval decision is blocked until MS-20 resolves it or the user deliberately
 * abandons that exact record.
 */
function unassociatedApprovalAttempt() {
  const associated = new Set(
    Object.values(state.approvalAttempts || {})
      .map(attempt => attempt?.operationId)
      .filter(Boolean),
  );
  return journal.open().find(entry => (
    entry.operationType === 'approval.decide' && !associated.has(entry.operationId)
  )) || null;
}

/**
 * SS-01 and SS-05.  Deciding is offered only when every one of these holds, and
 * each answers a different way the user could otherwise be lied to.
 */
function approvalDecidable(item) {
  if (!item) return { ok: false, why: 'missing' };
  // F-089 defence in depth: even a stale caller holding the former item and
  // verification stamp cannot emit after the screen has changed.
  if (state.route !== 'approval' || item.id !== state.approvalId) return { ok: false, why: 'route' };
  if (!auth.has('write:approvals')) return { ok: false, why: 'scope' };
  if (!item.payloadFingerprint) return { ok: false, why: 'fingerprint' };
  if (item.expired === true) return { ok: false, why: 'expired' };
  // F-056: checked before the verification stamp, because a fresh read does not
  // and must not clear it — the ambiguity is about an effect on the server, and
  // no amount of re-reading the queue resolves that.
  if (unresolvedApprovalAttempt(item.id)) return { ok: false, why: 'unresolved' };
  if (unassociatedApprovalAttempt()) return { ok: false, why: 'unassociated' };
  // SS-05: a reconnect invalidates the verification, so the control does not
  // come back until a fresh load has confirmed the approval still stands.
  if (!state.approvalVerifiedAt) return { ok: false, why: 'unverified' };
  if (state.approvalSending) return { ok: false, why: 'sending' };
  return { ok: true, why: null };
}

const APPROVAL_BLOCK_COPY = {
  missing: 'Tenhle požadavek už ve frontě není. Načti aktuální stav.',
  route: 'Rozhodnutí je dostupné jen na právě otevřené obrazovce approvalu. Po jejím opuštění se oprávnění zahazuje.',
  scope: 'Zařízení nemá scope write:approvals, takže smí požadavek jen prohlížet.',
  fingerprint: 'Chybí otisk obsahu. Bez něj by rozhodnutí nešlo svázat s tím, co je na obrazovce.',
  expired: 'Okno vypršelo. Prodloužit ho nelze — musí vzniknout nový požadavek.',
  unresolved: 'Předchozí rozhodnutí o tomhle požadavku zůstalo nerozřešené — nevíme, jestli na server dorazilo. Znovu se neposílá a nový klíč se nezakládá: druhé odeslání by z jednoho souhlasu udělalo dvě. Stav prvního pokusu zjisti v Nerozřešených pokusech.',
  unassociated: 'Po restartu zůstal otevřený pokus o rozhodnutí, ale už ho nelze bezpečně přiřadit ke konkrétnímu approvalu. Dokud ho v Nerozřešených pokusech nerozřešíš nebo vědomě neopustíš, žádné další rozhodnutí se neodešle.',
  unverified: 'Stav se ještě neověřil proti serveru. Rozhodovat půjde až potom.',
  sending: 'Rozhodnutí se odesílá.',
};

// Where a read is worth offering.  For most of these it is also what unblocks
// the screen.  `unresolved` is the exception and is listed on purpose: the read
// will *not* unblock it — that is what the copy says — but a person whose
// decision is stuck still has to be able to see whether the request is even
// still open, and a read is never the dangerous act here.  `expired` and
// `scope` are left out because re-reading answers neither.
const APPROVAL_REREADABLE = new Set(['unverified', 'missing', 'fingerprint', 'unresolved', 'unassociated']);

function viewApproval() {
  const item = approvalUnderDecision();
  const error = state.error.approvals;
  const note = state.approvalNote;
  const gate = approvalDecidable(item);

  const noteHtml = note
    ? `<div class="appr-note" data-tone="${esc(note.tone)}" role="status"><p>${esc(note.text)}</p></div>`
    : '';

  let body;
  if (!auth.has('read:approvals')) {
    body = statePanel('scope', 'Bez oprávnění',
      'Zařízení nemá scope read:approvals, takže požadavek nelze zobrazit.');
  } else if (error) {
    // SS-03 and SS-08.  Neither may leave a decision control on screen, and
    // errorPanel offers a reload — a read — not a resend.
    body = errorPanel(error, 'load-approvals');
  } else if (!Array.isArray(state.data.approvals)) {
    body = skeletonList(2);
  } else if (!item) {
    // SS-09: decided elsewhere, expired away, or withdrawn while open.
    body = statePanel('conflict', 'Požadavek už není otevřený',
      'Mezitím byl rozhodnut nebo vypršel. Rozhodnutí se zahazuje — otevři frontu a podívej se na aktuální stav.');
  } else {
    const countdown = approvalCountdown(item);
    const windowMinutes = approvalWindowMinutes(item);
    body = `<div class="container">
      <div class="card appr-detail-card">
        <h2 class="appr-title">${esc(item.title || item.subjectType || 'Požadavek na schválení')}</h2>
        <div class="msg-meta">
          <span>${esc(item.subjectType || 'neuvedeno')}</span>
          <span>${esc(item.subjectId || '')}</span>
          <span class="pill" data-tone="${item.expired === true ? 'warn' : 'muted'}">${esc(countdown.text)}${
            !countdown.expired && windowMinutes ? ` z ${windowMinutes}minutového okna` : ''}</span>
        </div>
        ${item.detail ? `<p class="appr-body">${esc(item.detail)}</p>` : ''}
        <p class="appr-fingerprint">Otisk obsahu: <code>${esc(String(item.payloadFingerprint || '').slice(0, 16))}…</code><br>
          Rozhodnutí se váže na tenhle otisk. Když se obsah změní, rozhodnutí propadá a začíná se znovu.</p>
      </div>
      ${gate.ok ? `
      <div class="appr-actions">
        <button class="btn btn-danger" data-act="approval-reject">Zamítnout</button>
        <button class="btn btn-primary" data-act="approval-approve">Schválit</button>
      </div>
      <p class="appr-foot">Jednorázové oprávnění pro tento běh a tenhle obsah. Neprodlužuje se a neopakuje.</p>`
      : `<p class="appr-blocked" role="status">${esc(APPROVAL_BLOCK_COPY[gate.why] || 'Rozhodovat teď nelze.')}</p>
        ${gate.why === 'unresolved' || gate.why === 'unassociated' ? `
        <div class="appr-actions appr-actions-single">
          <button class="btn btn-primary" data-act="operations">Otevřít nerozřešené pokusy</button>
        </div>` : ''}
        ${APPROVAL_REREADABLE.has(gate.why) ? `
        <div class="appr-actions appr-actions-single">
          <button class="btn btn-secondary" data-act="approval-reread">Načíst aktuální stav</button>
        </div>
        <p class="appr-foot">${gate.why === 'unresolved' || gate.why === 'unassociated'
          ? 'Načíst aktuální stav můžeš i teď — je to čtení fronty a nic neodesílá. Rozhodnutí to ale neodemkne: to drží nerozřešený pokus, ne obrazovka.'
          : 'Načtení je čtení — nic se tím neodesílá a nic neopakuje. Rozhodovat půjde teprve o tom, co server vrátí.'}</p>`
        : ''}`}
    </div>`;
  }

  return header({ title: 'Rozhodnutí', left: 'back' }) + `<div class="scroll">${noteHtml}${body}</div>`;
}

function viewSession() {
  if (state.session === 'revoked') {
    // Cache was already wiped by handleAuthFailure before this rendered.
    return `<div class="scroll">${statePanel('revoked', 'Zařízení bylo odvoláno',
      'Přístup byl zrušen na serveru a lokální data byla smazána. Pro obnovení je potřeba nové párování.',
      `<button class="btn btn-primary" data-act="repair">Spárovat znovu</button>`)}</div>`;
  }
  if (state.session === 'expired') {
    return `<div class="scroll">${statePanel('expired', 'Platnost vypršela',
      'Token zařízení expiroval. Data zůstala, stačí se znovu přihlásit novým párováním.',
      `<button class="btn btn-primary" data-act="repair">Spárovat znovu</button>`)}</div>`;
  }
  return null;
}

// ── Bottom bar (UI-DESIGN §3.1 · D-UI-3) ────────────────────────────────────
//
// Replaces the drawer.  The mental model §3.1 gives it is a Stargate ring: the
// bar scrolls horizontally, carries **every** available item, and always turns
// so the chosen one sits in the middle and is the only one lit.  The user does
// not hunt for an item at a fixed coordinate — they read the centre.
//
// What that costs, knowingly (§3.1): the bar stops being a map you see at once.
// What it buys: no "Více" to tip the overflow into, and a bar that carries the
// variable set derived from `capabilities`, for which a fixed map could never
// be complete anyway.
//
// Three invariants, each of which would otherwise be a bug the user cannot name:
//
//   * exactly one item is highlighted — never zero, never two
//   * on the root the bar is retracted, and that is the signal "you are home",
//     not a lost control (§3.2).  No default centred item exists before the
//     first choice, because on the root there is nothing to centre
//   * every item stays in the accessibility tree while off-screen, and moving
//     focus to one scrolls it into view (D-UI-3, §10)
//
// §3.3: MS-03, MS-04 and MS-20 live under **Nastavení**, which replaces the
// former standalone "Stav" item.  MS-20 stays permanently reachable there even
// at zero open attempts — a recovery route you only find while stuck is a route
// you learn about while stuck.

/**
 * Looked up rather than cached.  A cached reference survives the element being
 * detached — by a test harness, by anything that clears the body — and then the
 * bar is silently absent while the code believes it is showing.  Querying keeps
 * the element's *identity* when it is there, which is what makes the retraction
 * a transition instead of a re-creation.
 */
function navElement() {
  return document.querySelector('.navbar');
}

/**
 * D-S2 — a badge is only honest while it is live.  A failed read or a withdrawn
 * surface leaves no number at all rather than a remembered one, which is the
 * rule the queue itself follows (MD-07).
 */
function navCount(item) {
  if (item.id !== 'approvals') return null;
  const list = state.data.approvals;
  if (!Array.isArray(list) || state.error.approvals) return null;
  return list.length || null;
}

function renderNavBar() {
  const items = state.session === 'active' ? navItems() : [];
  // §3.1 — with a single available item there is nothing to switch between, and
  // a bar whose only two entries are the root and Nastavení is worse than none.
  const switchable = items.filter(item => item.id !== 'overview' && item.id !== 'settings');
  if (!switchable.length) {
    navElement()?.remove();
    document.body.classList.remove('has-navbar');
    return;
  }

  const section = currentSection();
  // §3.2 — retracted on the root; entering a section slides it out, choosing
  // Přehled slides it back.  The element stays in the DOM so the transition is
  // a movement rather than a jump.
  //
  // Operator, 2026-08-10: the bar retracts **after** the ring has arrived at
  // Domů, not at the same time.  Both at once read as one confused motion —
  // something sliding sideways while it also slides down.  So the turn happens
  // first, in full, and the bar leaves only once it has landed.
  const wantsRetracted = section === 'overview' && prefs.get('hideBarOnHome');

  const tabs = items.map(item => {
    const current = item.id === section;
    const count = navCount(item);
    // §3.1 — a scope whose screen does not exist shows locked rather than
    // absent, and locked means not tappable, not merely paler (§10).
    if (item.locked) {
      return `<span class="nav-tab" data-nav="${esc(item.id)}" role="tab" aria-disabled="true" aria-selected="false">
        ${icon('lock')}<span class="nav-tab-label" data-label="${esc(item.label)}">${esc(item.label)}</span>
      </span>`;
    }
    return `<button class="nav-tab" data-act="go" data-route="${esc(item.route)}" data-nav="${esc(item.id)}"`
      + ` role="tab" aria-selected="${current}"${current ? ' aria-current="page"' : ''}>`
      + `${icon(item.icon)}<span class="nav-tab-label" data-label="${esc(item.label)}">${esc(item.label)}</span>`
      + `${count ? `<span class="nav-count">${count}</span>` : ''}</button>`;
  }).join('');

  let bar = navElement();
  if (!bar) {
    bar = document.createElement('nav');
    bar.className = 'navbar';
    document.body.appendChild(bar);
  }

  // Rebuilding the track on every render threw away its scroll position, so the
  // ring slid back from the left edge each time anything at all re-rendered —
  // including the RunSilence ticker, once per second.  It also undid any scroll
  // the user had made by hand.  The markup is therefore only replaced when the
  // *items* change; a change of selection is applied in place.
  const signature = items.map(item => `${item.id}:${item.label}:${navCount(item) || 0}:${item.locked ? 'L' : ''}`).join('|');
  // `querySelector` is absent in the markup-level test harness, where the bar's
  // contents live only as an innerHTML string.  Falling back to a rebuild there
  // keeps this readable in both worlds; the in-place path is what the browser
  // suite exercises, and it is the only place it can be exercised.
  let track = bar.querySelector?.('.navbar-track');
  if (!track || bar.dataset.signature !== signature) {
    bar.innerHTML = `<div class="navbar-track" role="tablist" aria-label="Sekce aplikace">${tabs}</div>`
      // The gate is drawn over the track, outside the tablist, so it is neither
      // a tab stop nor something a screen reader has to explain.
      + '<div class="navbar-gate" aria-hidden="true"></div>';
    bar.dataset.signature = signature;
    track = bar.querySelector?.('.navbar-track');
  } else {
    for (const tab of track.querySelectorAll('[data-nav]')) {
      const current = tab.dataset.nav === section;
      if (tab.getAttribute('aria-disabled') === 'true') continue;
      tab.setAttribute('aria-selected', String(current));
      if (current) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }

  // The ring turns in every case, including on the way home: Domů is an item of
  // the loop like any other and has to come to the middle before it is hidden.
  layoutNavRing(track);
  scheduleNavRetraction(bar, wantsRetracted);
}

/**
 * Retract after the turn, extend at once.
 *
 * Leaving is a two-beat movement — the ring arrives, then the bar goes — while
 * arriving must be immediate, because the bar has to be there before the screen
 * it belongs to is.
 */
let navRetractTimer = null;
let navRetractGeneration = 0;
function scheduleNavRetraction(bar, wantsRetracted) {
  clearTimeout(navRetractTimer);
  // Any retraction still waiting belongs to an older render and must not fire.
  const generation = ++navRetractGeneration;
  const already = bar.dataset.retracted === 'true';

  if (!wantsRetracted) {
    bar.dataset.retracted = 'false';
    document.body.classList.add('has-navbar');
    return;
  }
  if (already) {
    document.body.classList.remove('has-navbar');
    return;
  }
  // Still on screen, and staying there until the ring has finished turning.
  // Stated rather than left unset: "not retracted" is a position the bar is
  // holding, not an attribute nobody got round to writing.
  bar.dataset.retracted = 'false';
  document.body.classList.add('has-navbar');

  // Two beats, and they are two different kinds of thing.
  //
  // The **first** beat is the ring arriving, and its length is *variable* — it
  // is a native smooth scroll, so a turn from across the loop takes longer than
  // one to a neighbour.  It is therefore observed, never estimated; estimating
  // it with `NAV_TURN_MS` was the same defect as the one fixed in
  // `endNavTurnWhenItActuallyEnds`, and on a long turn home the bar began
  // sliding down while the ring was still travelling.
  //
  // The **second** beat is the bar's own slide, a CSS transition of known
  // length.  That one is legitimately fixed, so it stays a constant — but as a
  // **floor**, not as a guess about the ring: a ring with no distance to travel
  // still leaves a beat between the two movements, which is what stops them
  // reading as one confused motion (operator, 2026-08-10).
  //
  // So the bar leaves at `max(ring landed, one beat)`.
  let landed = false;
  let beatPassed = false;
  const leave = () => {
    if (!landed || !beatPassed) return;
    // Superseded by a newer render: that render owns the decision now.
    if (generation !== navRetractGeneration) return;
    // Only if the root is still where we are: a fast tap through Domů to
    // somewhere else must not be followed by a bar that hides itself anyway.
    if (currentSection() !== 'overview' || !prefs.get('hideBarOnHome')) return;
    bar.dataset.retracted = 'true';
    document.body.classList.remove('has-navbar');
  };

  whenNavTurnEnds(() => { landed = true; leave(); });
  navRetractTimer = setTimeout(() => { beatPassed = true; leave(); }, NAV_TURN_MS);
}

/**
 * How long the bar's own slide takes, in step with `--navbar-slide`.
 *
 * This one is legitimately fixed: it is a CSS transition of a known duration,
 * not a scroll whose length depends on how far it travels.  It is **not** the
 * length of a turn of the ring — that is variable and is now observed rather
 * than estimated (`endNavTurnWhenItActuallyEnds`).  The consequence is that on
 * a long turn to the root the bar begins retracting slightly before the ring
 * has landed; that is cosmetic, was not what was reported, and is left alone
 * on purpose (UI-DESIGN §3.1, operator 2026-08-11: fix nothing else with it).
 */
const NAV_TURN_MS = 420;

/**
 * §3.1 — the bar is a loop, and the middle of it is where "you are here" lives.
 *
 * Operator, 2026-08-10 (docs/mobile/design/spodni-lista.png, gold variant): the
 * set of items never changes, the bar only turns, and the active item is always
 * in the centre — read the middle, not a position.  So this is not a scroller
 * that happens to centre things; it is a ring that is always turnable, even
 * when every item would fit on screen.  An earlier version skipped the turning
 * whenever the set fitted, which is the opposite of the rule.
 *
 * Turning is native: `scroll-snap-type: x mandatory` gives momentum, snapping
 * and reduced-motion behaviour for free, and there is no animation code here at
 * all.  The loop is closed by flanking the real items with two hidden copies
 * and silently re-basing once a turn settles (`normaliseNavRing`).
 */
function layoutNavRing(track) {
  if (!track || typeof track.clientWidth !== 'number' || typeof track.querySelector !== 'function') return;
  const tabs = [...track.children].filter(child => !child.dataset?.clone);
  if (!tabs.length) return;

  track.dataset.ring = 'on';
  const fresh = ensureNavClones(track, tabs);
  if (fresh) {
    // Reading a layout property forces the browser to place the copies that
    // were just inserted.  Without it every offset below is still the one from
    // before they existed, and the ring centres on a position that has moved.
    void track.scrollWidth;
    // Start standing on the real set.  Left at zero the ring would be at the far
    // edge of the leading copies, and the shortest way round would be measured
    // from a position it never actually occupies.
    // Stand on the real set, wherever it now begins — the number of copies in
    // front of it depends on the window, so it is read, not assumed.
    withoutSmoothScroll(track, () => { track.scrollLeft = navRealSetStart(track); });
  }
  centreNavOnSelection();
}

/** Move the ring without animating it — used for re-basing, which must not be seen. */
function withoutSmoothScroll(track, change) {
  const behaviour = track.style.scrollBehavior;
  track.style.scrollBehavior = 'auto';
  change();
  track.style.scrollBehavior = behaviour;
}

const NAV_GAP_PX = 2;

/**
 * The ring is made continuous by flanking the real items with two hidden
 * copies, so scrolling past either end lands on identical material and can be
 * silently re-based.  The copies are `aria-hidden` and unfocusable: a screen
 * reader must hear each section once, not three times.
 */
function ensureNavClones(track, tabs) {
  // How many copies each side needs, measured — not fixed at one.
  //
  // One copy either side is enough on a phone, where the bar is far wider than
  // the screen.  In a wide window it is not: four items in three sets are
  // 1088 px against a 854 px viewport, which leaves 234 px of travel — less
  // than a single set.  The ring then cannot bring an arbitrary item to the
  // middle at all; it runs out of scroll and the last item stays pinned near
  // the edge, a fixed 20 px off centre.  And because the middle decides the
  // section, whatever is stuck there drags every navigation back to itself.
  // That is the bar "not switching", measured on the operator's recording.
  //
  // So there must always be at least a viewport's worth of material on each
  // side, whatever the window.
  const setWidth = tabs.reduce(
    (total, tab) => total + (tab.getBoundingClientRect?.().width ?? tab.offsetWidth ?? 0), 0,
  ) + tabs.length * NAV_GAP_PX;
  // Enough that the ring can always turn a whole set either way:
  //   (2n + 1) · set − viewport ≥ 2 · set
  // One copy per side on a phone, more as the window widens — and no more than
  // that, because every copy is real DOM.
  const needed = setWidth > 0
    ? Math.max(1, Math.ceil(0.5 + track.clientWidth / (2 * setWidth)))
    : 1;

  const already = track.querySelectorAll('[data-clone="before"]').length / (tabs.length || 1);
  if (already >= needed) return false;
  for (const stale of track.querySelectorAll('[data-clone]')) stale.remove();

  const clone = side => Array.from({ length: needed }, () => tabs).flat().map(tab => {
    const copy = tab.cloneNode(true);
    copy.dataset.clone = side;
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('tabindex', '-1');
    copy.removeAttribute('aria-current');
    return copy;
  });
  for (const copy of clone('before').reverse()) track.insertBefore(copy, track.firstChild);
  for (const copy of clone('after')) track.appendChild(copy);
  return true;
}


/** The width of one full set of items, used to re-base the ring. */
function navSetWidth(track) {
  const tabs = [...track.children].filter(child => !child.dataset?.clone);
  if (!tabs.length) return 0;
  const width = tabs.reduce((total, tab) => total + (tab.getBoundingClientRect?.().width ?? tab.offsetWidth ?? 0), 0);
  return width + tabs.length * NAV_GAP_PX;
}

/**
 * Bring the selected item to the middle by the shortest way round.
 *
 * Going the short way is what makes the ring read as a ring: stepping from the
 * last item to the first should turn one place forwards, not four places back.
 */
function centreNavOnSelection(target = null) {
  const track = navElement()?.querySelector?.('.navbar-track');
  const selected = target || track?.querySelector?.('[aria-current="page"]:not([data-clone])');
  if (!track || !selected || typeof selected.offsetLeft !== 'number') return;

  const centre = selected.offsetLeft - (track.clientWidth - selected.offsetWidth) / 2;
  let left = centre;
  if (track.dataset.ring === 'on') {
    const setWidth = navSetWidth(track);
    // Three candidates: this turn, one turn back, one turn on.  The nearest to
    // where the ring already stands is the short way round.
    left = [centre - setWidth, centre, centre + setWidth]
      .reduce((best, candidate) => (
        Math.abs(candidate - track.scrollLeft) < Math.abs(best - track.scrollLeft) ? candidate : best
      ));
  } else {
    left = Math.max(0, centre);
  }

  const from = typeof track.scrollLeft === 'number' ? track.scrollLeft : 0;
  navRingTurningItself = true;
  // The gate is about to move, so anything the ring had queued about where it
  // was standing is now stale.
  forgetNavSettle();

  if (typeof track.scrollTo === 'function') {
    track.scrollTo({ left, behavior: 'smooth' });
    endNavTurnWhenItActuallyEnds(track, Math.abs(left - from));
  } else {
    // No smooth scrolling to wait for: the ring is already where it was asked
    // to be by the time this line returns, so there is no end to watch for.
    track.scrollLeft = left;
    endNavTurn(track);
  }
}

// True while the ring is turning because the app asked it to, so the settle
// handler does not read that as the user choosing a section.
let navRingTurningItself = false;
let navTurnStopWatching = null;

/**
 * Ceiling on how long the ring may claim to be turning itself.
 *
 * **Not an estimate of the movement** — that is the mistake this replaces.  It
 * is a last resort: if the end of the scroll is never observed at all, the flag
 * has to come down anyway, or the bar would ignore the finger for good.
 */
const NAV_TURN_CEILING_MS = 1500;

/** No scroll event for this long, after at least one, means the ring is at rest. */
const NAV_TURN_QUIET_MS = 150;

/**
 * End the turn: the ring has landed, so it is the user's again.
 *
 * Re-basing happens here rather than on a timer, so the loop keeps its material
 * without ever moving under a running animation.
 */
function endNavTurn(track) {
  if (navTurnStopWatching) { navTurnStopWatching(); navTurnStopWatching = null; }
  navRingTurningItself = false;
  normaliseNavRing(track);
  // Whoever was waiting for the ring to land gets told once, after the re-base,
  // so they see the position the ring actually came to rest in.
  const waiting = navTurnEndWaiters;
  navTurnEndWaiters = [];
  for (const waiter of waiting) waiter();
}

/**
 * Run `callback` once the ring has come to rest.
 *
 * A ring that is already at rest has nothing to wait for, so the callback runs
 * at once — the alternative would be to invent a delay, which is the habit this
 * whole area is being cured of.
 */
let navTurnEndWaiters = [];
function whenNavTurnEnds(callback) {
  if (!navRingTurningItself) { callback(); return; }
  navTurnEndWaiters.push(callback);
}

/**
 * Hold the "this is the app moving" flag for **the whole turn**, however long
 * the turn takes.
 *
 * The flag used to be cleared after a fixed 400 ms, but a native smooth scroll
 * takes longer the further it travels.  A turn long enough to outlast the
 * estimate dropped the flag mid-movement, and then two things went wrong at
 * once: `normaliseNavRing` re-based the track by a whole set *under the running
 * animation* — exactly what its own comment forbids, because the target the
 * animation is heading for moves and the item lands one place off — and the
 * settle handler read the middle while a **different** item was still sweeping
 * through it, and navigated there, starting another turn.
 *
 * **Latent, not the defect reported on 2026-08-11.** That report ("tapping two
 * places away sticks") was measured and traced to the clone count instead, and
 * fixed in `42d9c40f`; a ring that had run out of scrollable material could not
 * bring the item to the middle at all.  This is a second, independent way for
 * the same symptom to appear, still reachable once a turn is long enough — and
 * the bar is getting longer, `Projekty` being the most recent item.
 *
 * It is the same class as both the return-to-root defect and the screen
 * transition that had to go back to a short clock: **a fixed estimate of a
 * movement whose length is variable.**  So the fix is not a bigger constant —
 * that only moves the failure to the next item added.  The end of the turn is
 * observed instead:
 *
 *   * `scrollend` where the engine has it — the exact answer;
 *   * otherwise rest detection: quiet for `NAV_TURN_QUIET_MS` **after** motion
 *     has been seen, never before, so a slow first frame cannot be mistaken for
 *     an arrival;
 *   * a turn with no distance to travel fires neither, and is over already;
 *   * and `NAV_TURN_CEILING_MS` behind all of it, so the flag cannot stick.
 */
function endNavTurnWhenItActuallyEnds(track, distance) {
  if (navTurnStopWatching) { navTurnStopWatching(); navTurnStopWatching = null; }

  // Asked to go where it already stands: no scroll event and no `scrollend`
  // will ever come, so waiting for one would hold the ring for the full ceiling
  // and make it ignore the finger meanwhile.
  if (!(distance >= 1)) { endNavTurn(track); return; }

  const canListen = typeof track.addEventListener === 'function'
    && typeof track.removeEventListener === 'function';
  if (!canListen) {
    // Nothing to observe the end with.  The ceiling is then the only honest
    // answer available — it is late rather than wrong, which is the right way
    // round for a flag that suppresses navigation.
    const alone = setTimeout(() => endNavTurn(track), NAV_TURN_CEILING_MS);
    navTurnStopWatching = () => clearTimeout(alone);
    return;
  }

  let quiet = null;
  const settle = () => endNavTurn(track);
  const onScroll = () => {
    clearTimeout(quiet);
    quiet = setTimeout(settle, NAV_TURN_QUIET_MS);
  };

  const ceiling = setTimeout(settle, NAV_TURN_CEILING_MS);
  track.addEventListener('scroll', onScroll);
  track.addEventListener('scrollend', settle);

  navTurnStopWatching = () => {
    clearTimeout(ceiling);
    clearTimeout(quiet);
    track.removeEventListener('scroll', onScroll);
    track.removeEventListener('scrollend', settle);
  };
}

/** Is the ring mid-turn because the app asked it to be?  For tests. */
function navRingIsTurningItself() {
  return navRingTurningItself;
}

/**
 * Re-base the ring once a turn has settled, so it never runs out of material.
 * The jump is invisible because the content one set away is identical.
 */
/** Where the canonical copies begin, past however many clones precede them. */
function navRealSetStart(track) {
  const first = track.querySelector?.('[data-nav]:not([data-clone])');
  return typeof first?.offsetLeft === 'number' ? first.offsetLeft : 0;
}

function normaliseNavRing(track) {
  if (!track || track.dataset.ring !== 'on') return;
  // Never while the ring is turning itself.  Re-basing shifts the whole track
  // by one set, and doing that under a smooth scroll leaves the animation
  // heading for a target that has moved — the item lands one place off.
  if (navRingTurningItself) return;
  const setWidth = navSetWidth(track);
  if (setWidth <= 0) return;
  // Re-base towards the real set: drift of more than half a set either way is
  // taken back a whole set, which is invisible because the material one set
  // away is identical.  Measured against where the real set actually starts,
  // because the number of copies in front of it varies with the window.
  const home = navRealSetStart(track);
  const drift = track.scrollLeft - home;
  if (Math.abs(drift) < setWidth * 0.5) return;
  const steps = Math.round(drift / setWidth);
  if (!steps) return;
  withoutSmoothScroll(track, () => { track.scrollLeft -= steps * setWidth; });
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  const sessionView = viewSession();
  if (sessionView) { $app.innerHTML = withTrustBar(sessionView); renderNavBar(); return; }

  if (state.session === 'unpaired') {
    $app.innerHTML = withTrustBar(viewPairing({ error: state.error.pairing, busy: state.loading.pairing }));
    renderNavBar();
    return;
  }

  const views = {
    overview: viewOverview,
    conversations: viewConversations,
    chat: viewChat,
    projects: viewProjects,
    project: viewProject,
    workers: viewWorkers,
    specialists: viewSpecialists,
    notifications: viewNotifications,
    approvals: viewApprovals,
    approval: viewApproval,
    operations: viewOperations,
    diagnostics: viewDiagnostics,
  };
  // How far the thread was scrolled from its *bottom*, measured before the
  // markup is replaced.  Distance from the bottom is the stable reference when
  // older messages are prepended: everything the reader is looking at keeps the
  // same offset from the end, so the view does not move under them.
  let threadFromBottom = null;
  if (state.route === 'chat') {
    const previous = document.getElementById('thread-scroll');
    if (previous) threadFromBottom = previous.scrollHeight - previous.scrollTop;
  }

  const screen = withTrustBar((views[state.route] || viewOverview)());
  $app.innerHTML = screen;
  renderNavBar();
  // §6.5 — the elapsed clock is the only thing that moves, and it moves only
  // while a strip is actually on screen.  Driving this from the painted markup
  // rather than from a caller means no screen can leave a timer running behind
  // it, and none has to remember to start one.
  syncRunSilenceTicker(screen.includes('class="run-silence"'));

  if (state.route === 'chat') {
    const scroll = document.getElementById('thread-scroll');
    if (scroll) {
      // Opening a conversation and sending a message both mean "show me the
      // newest".  Reading into the past does not: after MR-05 prepends a page,
      // jumping to the bottom would throw away exactly what the user asked for.
      scroll.scrollTop = (state.thread.stickToBottom || threadFromBottom === null)
        ? scroll.scrollHeight
        : Math.max(0, scroll.scrollHeight - threadFromBottom);
    }
    const input = document.getElementById('composer-input');
    if (input) autoGrow(input);
  }
}

let runSilenceTimer = null;

function syncRunSilenceTicker(active) {
  if (active && !runSilenceTimer) {
    runSilenceTimer = setInterval(render, 1000);
    // Node keeps the process alive for a pending interval; a clock nobody is
    // looking at must not be the reason a test run never ends.
    runSilenceTimer?.unref?.();
  } else if (!active && runSilenceTimer) {
    clearInterval(runSilenceTimer);
    runSilenceTimer = null;
  }
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 168) + 'px';
}

// ── Loads ───────────────────────────────────────────────────────────────────

async function loadConversations() {
  const cached = cache.read('conversations');
  if (cached.data) {
    state.data.conversations = cached.data;
    state.cacheAge.conversations = cached.status;
    state.cacheAt.conversations = cached.at;
  }
  state.loading.conversations = true;
  state.error.conversations = null;
  render();

  try {
    const response = await api('/conversations?limit=50');
    state.data.conversations = response.data;
    state.cacheAge.conversations = 'FRESH';
    state.cacheAt.conversations = Date.now();
    cache.write('conversations', response.data);
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.conversations = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    state.loading.conversations = false;
    render();
  }
}

let projectsGeneration = 0;
let projectGeneration = 0;

async function loadProjects(projectState = state.projectState) {
  if (!auth.has('read:projects')) return;
  const requestedState = projectState === 'archived' ? 'archived' : 'active';
  state.projectState = requestedState;
  const generation = ++projectsGeneration;
  const cacheKey = `projects.${requestedState}`;
  const cached = cache.read(cacheKey);
  state.data.projects = cached.data || undefined;
  state.cacheAge.projects = cached.data ? cached.status : null;
  state.cacheAt.projects = cached.data ? cached.at : null;
  state.loading.projects = true;
  state.error.projects = null;
  render();

  try {
    const response = await api(`/projects?state=${requestedState}&limit=100`);
    if (generation !== projectsGeneration || requestedState !== state.projectState) return;
    state.data.projects = response.data;
    state.cacheAge.projects = 'FRESH';
    state.cacheAt.projects = Date.now();
    cache.write(cacheKey, response.data);
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    if (generation !== projectsGeneration) return;
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.projects = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    if (generation === projectsGeneration) {
      state.loading.projects = false;
      render();
    }
  }
}

async function loadProject(projectId = state.projectId) {
  if (!auth.has('read:projects') || !projectId) return;
  const requestedId = String(projectId);
  const generation = ++projectGeneration;
  const cacheKey = `project.${requestedId}`;
  const cached = cache.read(cacheKey);
  state.data.project = cached.data || undefined;
  state.cacheAge.project = cached.data ? cached.status : null;
  state.cacheAt.project = cached.data ? cached.at : null;
  state.loading.project = true;
  state.error.project = null;
  render();

  try {
    const response = await api(`/projects/${encodeURIComponent(requestedId)}`);
    if (generation !== projectGeneration || state.projectId !== requestedId) return;
    state.data.project = response.data;
    state.cacheAge.project = 'FRESH';
    state.cacheAt.project = Date.now();
    cache.write(cacheKey, response.data);
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    if (generation !== projectGeneration || state.projectId !== requestedId) return;
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.project = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    if (generation === projectGeneration && state.projectId === requestedId) {
      state.loading.project = false;
      render();
    }
  }
}

/** The paging window recorded alongside a cached thread, if there is one. */
function threadWindowOf(cachedThread) {
  const window = cachedThread?.window;
  return {
    cursor: window?.cursor ?? null,
    end: window?.end === true,
    loadingOlder: false,
    stickToBottom: true,
  };
}

/** Cache the window together with the messages it describes — never apart. */
function writeThreadCache(conversationId) {
  cache.write(`thread.${conversationId}`, {
    ...state.data.thread,
    window: { cursor: state.thread.cursor, end: state.thread.end },
  });
}

async function loadThread(conversationId) {
  const key = `thread.${conversationId}`;
  const cached = cache.read(key);
  if (cached.data) {
    state.data.thread = cached.data;
    state.cacheAge.thread = cached.status;
    state.cacheAt.thread = cached.at;
  } else {
    state.data.thread = null;
    state.cacheAge.thread = null;
    state.cacheAt.thread = null;
  }
  state.loading.thread = true;
  state.error.thread = null;
  // The cached window remembers how far it reached, so a thread read offline
  // can still tell "this is the whole conversation" from "this is as much as
  // was downloaded".  An entry written before the window was recorded has
  // neither, and `threadBoundary` treats that as partial.
  state.thread = threadWindowOf(cached.data);
  render();

  try {
    // MR-05.  `anchor=latest` opens the walk at the newest message, which is
    // what a conversation screen must show first; the window is then extended
    // *into the past* on demand.  Asking without an anchor would return the
    // oldest page and hide the exchange the user came back for.
    const response = await api(
      `/conversations/${encodeURIComponent(conversationId)}?anchor=latest&limit=${THREAD_PAGE_SIZE}`);
    state.data.thread = response.data;
    state.thread = {
      cursor: response.nextCursor || null,
      end: response.end !== false && !response.nextCursor,
      loadingOlder: false,
      stickToBottom: true,
    };
    state.cacheAge.thread = 'FRESH';
    state.cacheAt.thread = Date.now();
    writeThreadCache(conversationId);
    setConn('ok');
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    if (error.code === 'not_found') {
      // A conversation that exists only locally is normal right after
      // "new chat" — an empty thread, not an error.
      state.data.thread = { conversation: { id: conversationId, title: 'Nová konverzace' }, messages: [] };
      // Nothing to page into: an empty thread is the whole history.
      state.thread = { cursor: null, end: true, loadingOlder: false, stickToBottom: true };
      state.cacheAge.thread = 'FRESH';
      state.cacheAt.thread = Date.now();
    } else {
      state.error.thread = error;
      setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
    }
  } finally {
    state.loading.thread = false;
    render();
  }
}

/**
 * MR-05 — extend the window into the past by exactly one server-issued page.
 *
 * Only ever follows `state.thread.cursor`.  Nothing here computes a position:
 * §8.2 makes that impossible anyway (the cursor is opaque and checksummed), and
 * the point of the rule is that a client which guesses invents history.
 */
async function loadOlderMessages() {
  const conversationId = state.conversationId;
  const cursor = state.thread.cursor;
  if (!conversationId || !cursor || state.thread.loadingOlder) return;

  state.thread.loadingOlder = true;
  // From here on the reader is in the past, so no render may drag them back to
  // the newest message — not this one, and not a reply arriving later.
  state.thread.stickToBottom = false;
  render();

  try {
    const response = await api(
      `/conversations/${encodeURIComponent(conversationId)}`
      + `?limit=${THREAD_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`);
    const older = response.data.messages || [];
    const thread = state.data.thread;
    // The page is older than everything held, so it goes on the front.  The
    // conversation head is refreshed from the same response rather than kept,
    // so a rename that happened elsewhere lands here too (SS-09).
    state.data.thread = {
      conversation: response.data.conversation || thread?.conversation,
      messages: [...older, ...(thread?.messages || [])],
    };
    state.thread = {
      cursor: response.nextCursor || null,
      end: response.end !== false && !response.nextCursor,
      loadingOlder: false,
      stickToBottom: false,
    };
    state.cacheAt.thread = Date.now();
    writeThreadCache(conversationId);
    setConn('ok');
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    if (error.code === 'cursor_unknown') {
      // SS-10 — the stream moved under us.  The only honest repair is to read
      // the thread again from the newest end.  Splicing a fresh page onto a
      // stale window would join two different versions of the history and look
      // seamless while doing it.
      state.thread = { cursor: null, end: false, loadingOlder: false, stickToBottom: true };
      return loadThread(conversationId);
    }
    // The window that is already on screen stays: it was true when it loaded,
    // and failing to extend it is not a reason to throw it away.
    state.error.thread = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    state.thread.loadingOlder = false;
    render();
  }
}

async function loadNotifications() {
  if (!auth.has('read:notifications')) return;
  const cached = cache.read('notifications');
  if (cached.data) {
    state.data.notifications = cached.data;
    // Previously the cached copy was published without recording its age, so
    // the screen showed a remembered inbox with nothing saying so.  Trust-bar
    // zone 2 reads this; leaving it unset is the exact silence §4 forbids.
    state.cacheAge.notifications = cached.status;
    state.cacheAt.notifications = cached.at;
  }
  state.loading.notifications = true;
  state.error.notifications = null;

  try {
    const response = await api('/notifications?limit=50');
    state.data.notifications = response.data;
    state.unread = response.data.filter(item => !item.read).length;
    state.cacheAge.notifications = 'FRESH';
    state.cacheAt.notifications = Date.now();
    cache.write('notifications', response.data);
    setConn('ok');
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.notifications = error;
  } finally {
    state.loading.notifications = false;
    render();
  }
}

/**
 * MS-13.  Deliberately unlike every other loader here: it neither reads nor
 * writes the cache, and on failure it *drops* whatever the queue previously
 * held.  Keeping the last list on screen would turn a failed refresh into a
 * claim about the present, which is the one thing this screen must never do.
 */
async function loadApprovals({ grantFor = null } = {}) {
  if (!auth.has('read:approvals')) {
    invalidateApprovalSurface();
    render();
    return;
  }

  if (!approvalsRevalidationSnapshot && Array.isArray(state.data.approvals)) {
    approvalsRevalidationSnapshot = {
      list: state.data.approvals,
      gone: { ...(state.approvalsGone || {}) },
      note: state.approvalNote,
    };
  }
  const comparison = approvalsRevalidationSnapshot || { list: undefined, gone: {}, note: null };

  // F-057 / F-061.  Two facts are captured before the request and checked after
  // it, because both can change while it is in flight:
  //   generation — whether a newer read has since started (only the newest may
  //                publish anything at all)
  //   epoch      — whether the decision authority was invalidated meanwhile, in
  //                which case this answer may not grant even if it is newest
  const generation = ++approvalsGeneration;
  // F-077/F-093: revalidation withdraws the old grant before it can render a
  // loading state.  This read captures the new epoch and may grant only when it
  // was explicitly requested for the still-open decision screen.
  invalidateApprovalAuthority();
  const epoch = state.approvalAuthEpoch || 0;
  const requestedFor = grantFor;

  state.loading.approvals = true;
  state.error.approvals = null;
  state.data.approvals = undefined;
  state.approvalsGone = {};
  state.approvalNote = null;

  const previous = comparison.list;
  render();

  try {
    const response = await api('/approvals', { strict: true });
    // F-059: a queue is a list.  A 200 whose `data` is anything else is a
    // protocol failure, and it must reach the failure path rather than becoming
    // an empty queue — "nic nečeká" is permission to put the phone down.
    if (!Array.isArray(response.data)) {
      throw new ApiError('protocol', {
        code: 'protocol_invalid_response',
        status: 200,
        detail: { reason: 'data_not_a_list' },
        body: response,
      });
    }
    if (generation !== approvalsGeneration) return;   // superseded: publish nothing
    const list = response.data;

    // SS-09: anything that was in the previous *confirmed* list and is absent
    // from this one was decided elsewhere.  Only a list-to-list comparison can
    // say that, so it happens here rather than in the view.
    if (Array.isArray(previous)) {
      const present = new Set(list.map(item => item.id));
      const gone = { ...(comparison.gone || {}) };
      const decidedHere = state.approvalsDecidedHere || {};
      for (const item of previous) {
        if (present.has(item.id)) continue;
        // It left the queue because *this device* decided it moments ago.
        // Reporting that as "rozhodnut jinde" would be a lie about the user's
        // own action, and would make a real decision-elsewhere unremarkable.
        if (decidedHere[item.id]) continue;
        // F-064.  The same lie, one step subtler: our own decision went
        // ambiguous, the row is gone, and the likeliest explanation by far is
        // that our attempt landed.  "Rozhodl to někdo jiný" is a claim about
        // another person, made from evidence that says only that we do not
        // know.  It is recorded as *our own unresolved attempt*, which is the
        // one thing here that is true and the one that leads somewhere (MS-20).
        const mine = unresolvedApprovalAttempt(item.id);
        gone[item.id] = mine ? { ...item, ownAttempt: mine.operationId } : item;
      }
      // An approval that came back (a new request for the same subject would
      // carry a new id) must not stay in the note.
      for (const id of Object.keys(gone)) if (present.has(id)) delete gone[id];
      state.approvalsGone = gone;
      // An id the server is still offering was not decided by us after all, so
      // the marker goes: a later disappearance has to be judged on its own
      // evidence rather than excused by an old attempt.
      for (const id of Object.keys(decidedHere)) if (present.has(id)) delete decidedHere[id];
      state.approvalsDecidedHere = decidedHere;
    }

    state.data.approvals = list;
    // Outcome/disappearance notes are published again only after a new
    // authoritative response.  A failed/offline/out-of-scope surface keeps them
    // withdrawn rather than pairing old approval content with a current error.
    state.approvalNote = comparison.note;
    setConn('ok');

    // SS-05 / F-061.  A read grants the right to decide only if it was made
    // *for* the screen that is open, and only if nothing invalidated that screen
    // while the answer was in flight.  Five conditions, and each one is a way the
    // grant could otherwise be forged:
    //
    //   requestedFor           this read was asked to verify a decision, not to
    //                          refresh a list or fill in a menu count
    //   === state.approvalId   and it is still the same approval on screen
    //   route === 'approval'   and the decision screen is still the open one
    //   epoch unchanged        and no exit, disconnect or error happened since
    //   list contains it       and the server still says it is undecided
    //
    // Anything else sets the stamp to null rather than leaving it: fail-closed
    // is the only safe default when the question is whether a person consented.
    const granted = requestedFor !== null
      && requestedFor === state.approvalId
      && state.route === 'approval'
      && epoch === (state.approvalAuthEpoch || 0)
      && list.some(item => item.id === requestedFor);
    state.approvalVerifiedAt = granted ? Date.now() : null;
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    if (generation !== approvalsGeneration) return;   // superseded: publish nothing
    state.error.approvals = error;
    // A failed load withdraws permission to decide.  SS-05 wants the state
    // re-verified *before* the control returns, and the only honest way to
    // enforce that is to drop the stamp the control depends on.
    invalidateApprovalAuthority();
    // MD-07 / SS-03 / SS-08: no queue survives a failed load.  A stale list is
    // indistinguishable on screen from a live one, and here that difference is
    // whether the user may walk away.
    state.data.approvals = undefined;
    setConn(error.kind === 'offline' ? 'offline'
      : error.kind === 'server' || error.kind === 'protocol' ? 'server'
      : state.conn);
  } finally {
    // Only the newest read owns the screen, including the part of it that says
    // a read is running at all.
    if (generation === approvalsGeneration) {
      state.loading.approvals = false;
      approvalsRevalidationSnapshot = null;
      render();
    }
  }
}

/**
 * F-059 / F-062 — is this 200 actually a decision about the approval on screen?
 *
 * `api(…, { strict })` has already refused everything that is not an exact 200
 * carrying the server's envelope.  What is left to check is whether the payload
 * says anything: a state from the closed vocabulary, and an `approvalId` that is
 * the one the user was looking at.  The second matters more than it looks — an
 * answer about a different approval arriving on this request would otherwise
 * close *this* key and announce a grant nobody gave.
 */
function decisionOutcome(response, approvalId, requestedDecision) {
  const data = response?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { valid: false };
  if (data.approvalId !== approvalId) return { valid: false };
  if (!OPERATION_STATES.has(data.state)) return { valid: false };

  const replayed = Object.prototype.hasOwnProperty.call(response, 'replayed');
  if (!replayed) {
    // A fresh successful decision has exactly one permitted terminal state and
    // carries the verb at the top level (handlers.js:632-634).  PENDING,
    // UNKNOWN and REJECTED are never fresh success envelopes.
    if (data.state !== 'CONFIRMED') return { valid: false };
    if (data.decision !== requestedDecision) return { valid: false };
    if (Object.prototype.hasOwnProperty.call(data, 'result')) return { valid: false };
    return { valid: true, state: data.state, replayed: false };
  }

  if (response.replayed !== true) return { valid: false };
  if (Object.prototype.hasOwnProperty.call(data, 'decision')) return { valid: false };

  // A replay moves the original result under `data.result`.  A confirmed replay
  // must prove that the recorded result is for this approval and the verb the
  // user submitted now.  Open/rejected records carry a null result and can only
  // preserve or close recovery; they never announce a grant.
  if (data.state === 'CONFIRMED') {
    const result = data.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return { valid: false };
    if (result.approvalId !== approvalId || result.decision !== requestedDecision) return { valid: false };
  } else if (data.result !== null) {
    return { valid: false };
  }
  return { valid: true, state: data.state, replayed: true };
}

/**
 * MS-14 ★.  One conscious decision, one operation key, bound to one fingerprint.
 *
 * The key is written to the journal *before* the request, exactly as `doSend()`
 * does and for the same reason: if the app dies between dispatch and write, an
 * approval may already be decided on the server and the phone would no longer
 * recognise it.  What the key buys is the ability to *ask*; it never extends
 * the grant (I-11), and repeating it can only ever return the same decision.
 */
async function decideApproval(decision) {
  const item = approvalUnderDecision();
  const gate = approvalDecidable(item);
  if (!gate.ok) {
    state.approvalNote = { tone: 'warn', text: APPROVAL_BLOCK_COPY[gate.why] || 'Rozhodovat teď nelze.' };
    return render();
  }

  const operationId = newOperationId();
  const fingerprint = item.payloadFingerprint;
  journal.add({
    operationId,
    operationType: 'approval.decide',
    // MD-19: content-free, like every other summary in this index.
    displaySummary: decision === 'approve' ? 'Schválení požadavku' : 'Zamítnutí požadavku',
  });

  // F-056: the attempt is registered against the approval *before* dispatch, so
  // an app death between the two still leaves the key discoverable and this
  // approval blocked from a second one on the next load.  It holds a key and a
  // verb, never the payload — MD-19's rule about what may be remembered applies
  // here exactly as it does to the journal.
  state.approvalAttempts = {
    ...(state.approvalAttempts || {}),
    [item.id]: { operationId, decision },
  };

  state.approvalSending = true;
  state.approvalNote = null;
  render();

  try {
    const response = await api(`/approvals/${encodeURIComponent(item.id)}/decide`, {
      method: 'POST',
      body: { decision, operationId, payloadFingerprint: fingerprint },
      strict: true,
    });

    state.approvalSending = false;
    const outcome = decisionOutcome(response, item.id, decision);

    if (!outcome.valid) {
      // F-059 / F-062.  A 200 that is not the server's decision envelope decides
      // nothing — and, crucially, it does not *fail* either.  The request went
      // out; the effect may have happened.  Recording CONFIRMED here (which is
      // what `response.data?.state || 'CONFIRMED'` did) closes the only handle
      // the recovery screen has on a grant that may be real.  So the key stays
      // open, ambiguous, and answerable.
      journal.setState(operationId, 'UNKNOWN', { unknownReason: 'unspecified' });
      invalidateApprovalAuthority();
      setConn('server');
      state.approvalNote = {
        tone: 'danger',
        text: 'Server odpověděl něčím, co není platné rozhodnutí. Jestli rozhodnutí dorazilo, se z téhle odpovědi poznat nedá — znovu se nic neposílá a stav zjistíš v Nerozřešených pokusech.',
      };
      return render();
    }

    if (outcome.state === 'PENDING' || outcome.state === 'UNKNOWN') {
      // The server answered, and its answer is "I do not know yet either".  That
      // is not a grant and must never be rendered as one.
      journal.setState(operationId, outcome.state);
      invalidateApprovalAuthority();
      setConn('ok');
      state.approvalNote = {
        tone: 'danger',
        text: 'Server rozhodnutí přijal, ale výsledek zatím nezná. Znovu se nic neposílá — stav zjistíš v Nerozřešených pokusech.',
      };
      return render();
    }

    if (outcome.state === 'REJECTED') {
      journal.setState(operationId, 'REJECTED');
      invalidateApprovalAuthority();
      setConn('ok');
      state.approvalNote = {
        tone: 'warn',
        text: 'Server vrátil dříve zaznamenaný neúspěšný pokus. Rozhodnutí se neprovedlo; před dalším rozhodnutím načti aktuální stav.',
      };
      return render();
    }

    journal.setState(operationId, outcome.state);
    setConn('ok');

    // SS-10: a replay is the same decision answered from the record.  Saying
    // "schváleno" twice would describe one grant as two.
    state.approvalNote = response.replayed
      ? { tone: 'muted', text: 'Tohle rozhodnutí už bylo zaznamenané dřív. Tohle je jeho zopakování ze záznamu, ne druhé schválení.' }
      : { tone: 'ok', text: decision === 'approve' ? 'Schváleno.' : 'Zamítnuto.' };

    state.approvalsDecidedHere = { ...(state.approvalsDecidedHere || {}), [item.id]: true };
    transitionRoute('approvals');
    await loadApprovals();
  } catch (error) {
    state.approvalSending = false;
    if (error.kind === 'auth') return handleAuthFailure(error);
    // F-063: whatever went wrong, the screen no longer holds a verified state,
    // so the controls go before the explanation arrives.
    invalidateApprovalAuthority();

    if (error.kind === 'offline') {
      // I-4 and SS-03: never a queue, never "odešle se později".  The request
      // may or may not have landed, so the key stays alive as UNKNOWN and the
      // way out is the recovery screen — a read, not another send.
      journal.setState(operationId, 'UNKNOWN');
      setConn('offline');
      state.approvalNote = {
        tone: 'danger',
        text: 'Spojení se ztratilo a není jisté, jestli rozhodnutí dorazilo. Neodesílá se znovu — stav zjistíš v Nerozřešených pokusech.',
      };
    } else if (error.detail?.state === 'UNKNOWN') {
      journal.setState(operationId, 'UNKNOWN', { unknownReason: error.detail.reason || null });
      setConn('server');
      state.approvalNote = {
        tone: 'danger',
        text: 'Server rozhodnutí nedokončil a výsledek je neznámý. Zjisti stav v Nerozřešených pokusech; znovu se nic neposílá.',
      };
    } else if (error.code === 'protocol_invalid_response') {
      // F-062.  A 2xx the client cannot read is neither a success nor a failure.
      // It is the request having left and the answer being unusable — the exact
      // shape of an ambiguous mutation, and it is recorded as one.
      journal.setState(operationId, 'UNKNOWN', { unknownReason: 'unspecified' });
      setConn('server');
      state.approvalNote = {
        tone: 'danger',
        text: 'Server odpověděl něčím, co není platné rozhodnutí. Jestli rozhodnutí dorazilo, se z téhle odpovědi poznat nedá — znovu se nic neposílá a stav zjistíš v Nerozřešených pokusech.',
      };
    } else if (error.code === 'approval_superseded') {
      // Rule 2.  The agreement was about a payload that no longer exists.
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = {
        tone: 'warn',
        text: 'Obsah se mezitím změnil, takže rozhodnutí propadlo — souhlasil bys s něčím jiným, než co jsi viděl. Načti aktuální stav a rozhodni znovu.',
      };
      await loadApprovals();
    } else if (error.code === 'approval_expired') {
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = {
        tone: 'warn',
        text: 'Okno vypršelo dřív, než rozhodnutí dorazilo. Prodloužit ho nelze — musí vzniknout nový požadavek.',
      };
      await loadApprovals();
    } else if (error.code === 'state_conflict') {
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = { tone: 'warn', text: decidedElsewhereSentence(error.detail) };
      await loadApprovals();
    } else if (error.code === 'operation_conflict') {
      // Rule 3.  The same key already carries a different decision — that is a
      // conflict to show, not something to smooth over.
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = {
        tone: 'danger',
        text: 'Konflikt klíče operace — pod tímhle klíčem je zaznamenané jiné rozhodnutí. Druhé odeslání není druhé schválení.',
      };
    } else if (error.kind === 'limit') {
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = {
        tone: 'danger',
        text: 'Strop nerozřešených pokusů je vyčerpaný, takže rozhodnutí neprošlo. Uvolni ho v Nerozřešených pokusech.',
      };
    } else if (error.kind === 'scope') {
      journal.setState(operationId, 'REJECTED');
      state.approvalNote = { tone: 'warn', text: APPROVAL_BLOCK_COPY.scope };
    } else {
      journal.setState(operationId, 'REJECTED');
      setConn(error.kind === 'server' ? 'server' : state.conn);
      // SS-08: no hint that anything will be attempted again.
      state.approvalNote = { tone: 'danger', text: 'Rozhodnutí se nepodařilo odeslat. Znovu se nic neposílá.' };
    }
    render();
  }
}

function openApproval(approvalId) {
  // SS-01/SS-05/F-063: opening never trusts the list that got us here, and it
  // is itself a lifecycle transition — whatever the previous screen held dies
  // before anything is loaded.  Bumping the epoch also disowns any read still
  // in flight for the approval we are leaving.
  transitionRoute('approval');
  state.approvalId = approvalId;
  state.approvalNote = null;
  render();
  // F-061: the one read in this client that is allowed to grant, and it says so
  // in the call.  Everything else that reads this queue reads it as a list.
  loadApprovals({ grantFor: approvalId });
}

let settingsGeneration = 0;
let memoryGeneration = 0;
let workersGeneration = 0;
let specialistsGeneration = 0;

async function loadSettings() {
  if (!auth.has('read:settings')) return;
  const generation = ++settingsGeneration;
  // This surface is deliberately live-only: do not let settings from a prior
  // identity or an earlier connection masquerade as the current backend.
  state.data.settings = undefined;
  state.loading.settings = true;
  state.error.settings = null;
  render();

  try {
    const response = await api('/settings');
    if (generation !== settingsGeneration) return;
    state.data.settings = response.data;
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    if (generation !== settingsGeneration) return;
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.settings = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    if (generation === settingsGeneration) {
      state.loading.settings = false;
      render();
    }
  }
}

async function loadStoredInformation() {
  if (!auth.has('read:memory')) return;
  const generation = ++memoryGeneration;
  const cached = cache.read('memory');
  if (cached.status === 'EXPIRED') {
    store.del(K.cache + 'memory');
    state.data.memory = undefined;
    state.cacheAge.memory = null;
    state.cacheAt.memory = null;
  } else {
    state.data.memory = cached.data || undefined;
    state.cacheAge.memory = cached.data ? cached.status : null;
    state.cacheAt.memory = cached.data ? cached.at : null;
  }
  state.loading.memory = true;
  state.error.memory = null;
  render();

  try {
    const response = await api('/memory?kind=all&limit=50');
    if (generation !== memoryGeneration) return;
    state.data.memory = response.data;
    state.cacheAge.memory = 'FRESH';
    state.cacheAt.memory = Date.now();
    cache.write('memory', response.data);
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    if (generation !== memoryGeneration) return;
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error.memory = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    if (generation === memoryGeneration) {
      state.loading.memory = false;
      render();
    }
  }
}

async function loadConfiguredResources(name, { append = false } = {}) {
  const config = {
    workers: { scope: 'read:workers', generation: () => ++workersGeneration },
    specialists: { scope: 'read:specialists', generation: () => ++specialistsGeneration },
  }[name];
  if (!config || !auth.has(config.scope)) return;

  const generation = config.generation();
  state.pagination ||= {};
  if (!append) {
    const cached = cache.read(name);
    if (cached.status === 'EXPIRED') {
      store.del(K.cache + name);
      state.data[name] = undefined;
      delete state.pagination[name];
      state.cacheAge[name] = null;
      state.cacheAt[name] = null;
    } else {
      const snapshot = cached.data && Array.isArray(cached.data.items) ? cached.data : null;
      state.data[name] = snapshot?.items || undefined;
      state.pagination[name] = snapshot?.page || { hasMore: false, nextCursor: null };
      state.cacheAge[name] = snapshot ? cached.status : null;
      state.cacheAt[name] = snapshot ? cached.at : null;
    }
  }

  const cursor = append ? state.pagination[name]?.nextCursor : null;
  if (append && !cursor) return;
  state.loading[name] = true;
  state.error[name] = null;
  render();

  try {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await api(`/${name}?limit=50${suffix}`);
    const currentGeneration = name === 'workers' ? workersGeneration : specialistsGeneration;
    if (generation !== currentGeneration) return;
    const prior = append && Array.isArray(state.data[name]) ? state.data[name] : [];
    const joined = [...prior, ...response.data];
    const seen = new Set();
    state.data[name] = joined.filter(item => {
      if (!item || typeof item.id !== 'string' || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    state.pagination[name] = {
      hasMore: response.hasMore === true,
      nextCursor: response.nextCursor || null,
      end: response.end === true,
    };
    state.cacheAge[name] = 'FRESH';
    state.cacheAt[name] = Date.now();
    cache.write(name, { items: state.data[name], page: state.pagination[name] });
    if (response.scopes) replaceScopes(response.scopes);
    setConn('ok');
  } catch (error) {
    const currentGeneration = name === 'workers' ? workersGeneration : specialistsGeneration;
    if (generation !== currentGeneration) return;
    if (error.kind === 'auth') return handleAuthFailure(error);
    state.error[name] = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    const currentGeneration = name === 'workers' ? workersGeneration : specialistsGeneration;
    if (generation === currentGeneration) {
      state.loading[name] = false;
      render();
    }
  }
}

function loadWorkers(options) {
  return loadConfiguredResources('workers', options);
}

function loadSpecialists(options) {
  return loadConfiguredResources('specialists', options);
}

async function loadDiagnostics() {
  try {
    const health = await api('/health');
    state.data.health = health.data;
    // §14 — the offset is refreshed on every successful health read and is the
    // only clock this client trusts for ages and countdowns.  A malformed or
    // missing `time` leaves it unknown rather than zero: "no offset" produces
    // qualitative wording, while a wrong zero produces confident wrong numbers.
    const serverTime = Date.parse(health.data?.time ?? '');
    state.serverOffsetMs = Number.isNaN(serverTime) ? null : serverTime - Date.now();
    setConn('ok');
  } catch (error) {
    state.data.health = null;
    setConn(error.kind === 'offline' ? 'offline' : 'server');
  }
  try {
    const caps = await api('/capabilities');
    state.data.capabilities = caps.data;
    replaceScopes(caps.data.scopes || []);
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
  }
  if (auth.has('read:settings')) await loadSettings();
  if (auth.has('read:memory')) await loadStoredInformation();
  render();
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function doPair() {
  const code = document.getElementById('pair-code')?.value.trim();
  const name = document.getElementById('pair-name')?.value.trim() || guessDeviceName();
  if (!code) { state.error.pairing = 'Zadej párovací kód.'; return render(); }

  state.loading.pairing = true;
  state.error.pairing = null;
  render();

  try {
    const response = await fetch(`${API}/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName: name }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      // Each pairing failure gets its own sentence: the user's next action is
      // different for "already used" than for "disabled".
      state.error.pairing = {
        pairing_already_used: 'Tento kód už byl použit. Vygeneruj na desktopu nový.',
        pairing_expired: 'Platnost kódu vypršela. Vygeneruj nový.',
        pairing_disabled: 'Párování je na serveru vypnuté (C3_MOBILE_PAIRING=on).',
        token_invalid: 'Kód nesouhlasí. Zkontroluj, že jsi naskenoval aktuální QR.',
        rate_limited: 'Příliš mnoho pokusů. Vygeneruj nový kód.',
      }[payload?.error?.code] || `Párování selhalo (${payload?.error?.code || response.status}).`;
      return;
    }

    auth.save(payload.data);
    state.session = 'active';
    transitionRoute('conversations');
    history.replaceState(null, '', location.pathname);
    toast('Zařízení připojeno');
    await loadConversations();
    loadDiagnostics();
  } catch {
    state.error.pairing = 'Server není dostupný. Zkontroluj, že jsi na stejné síti / VPN.';
  } finally {
    state.loading.pairing = false;
    render();
  }
}

async function doSend() {
  const input = document.getElementById('composer-input');
  const text = input?.value.trim();
  if (!text || state.sending) return;

  const conversationId = state.conversationId;
  // One conscious attempt → one key, minted here and reused by every retry of
  // this same attempt (MD-19).  A re-edited message would get a new key.
  //
  // The order below is the contract, not a coincidence (U-9):
  //   1. mint the key   2. persist the recovery record   3. only then send.
  // Reversed, a process death between dispatch and write leaves an operation
  // running on the server that this phone can no longer name, and therefore can
  // neither verify nor safely repeat.
  const operationId = newOperationId();

  journal.add({
    operationId,
    operationType: 'chat.send',
    // Content-free by design — the text belongs to the draft, not the journal.
    displaySummary: 'Odeslání zprávy',
  });
  drafts.put(operationId, { conversationId, message: text });

  input.value = '';
  autoGrow(input);
  state.sending = true;
  state.sendingSince = Date.now();
  state.sendingOperationId = operationId;

  if (!state.data.thread) {
    state.data.thread = { conversation: { id: conversationId }, messages: [] };
    state.thread = { cursor: null, end: true, loadingOlder: false, stickToBottom: true };
  }
  state.data.thread.messages.push({
    id: `local-${operationId}`, role: 'user', content: text,
    createdAt: Date.now(), operationId,
  });
  // Writing is an act at the newest end of the conversation: whatever the
  // reader had scrolled back to, they want to see what they just sent.
  state.thread.stickToBottom = true;
  render();

  // The elapsed clock is advanced by the one ticker in `render()`, which starts
  // and stops from what is on screen — including the strips that outlive this
  // send, such as an attempt still open after the app was killed.
  await sendOperation(operationId);
}

/**
 * Perform (or re-perform) one operation under its existing key.  Safe to call
 * again for the same key: the server replays rather than repeats (§8.8).
 */
async function sendOperation(operationId) {
  const payload = drafts.get(operationId);
  if (!payload) {
    // MD-19 §4.1 rule 4: without the original request there is no safe retry,
    // and we must not synthesise a replacement.
    toast('Obsah pokusu už není k dispozici — pošli zprávu znovu vědomě.', 'danger');
    state.sending = false;
    return render();
  }

  try {
    const response = await api('/chat', {
      method: 'POST',
      body: { conversationId: payload.conversationId, message: payload.message, operationId },
    });

    journal.setState(operationId, response.data.state || 'CONFIRMED');
    drafts.drop(operationId);
    setConn('ok');
    state.sending = false;
    state.sendingSince = null;
    state.sendingOperationId = null;
    await loadThread(payload.conversationId);
    loadConversations();
  } catch (error) {
    state.sending = false;
    state.sendingSince = null;
    state.sendingOperationId = null;
    if (error.kind === 'auth') return handleAuthFailure(error);

    if (error.kind === 'offline') {
      // Never assume it did not happen. UNKNOWN keeps the key alive so the
      // user can resolve it by reading, not by sending again.
      journal.setState(operationId, 'UNKNOWN');
      setConn('offline');
      toast('Výsledek neznámý — zjisti stav v diagnostice.', 'danger');
    } else if (error.detail?.state === 'UNKNOWN') {
      // The server names the cause in the same closed vocabulary it will report
      // later on a lookup, so the sentence shown now and the one shown in
      // recovery are the same sentence.
      journal.setState(operationId, 'UNKNOWN', { unknownReason: error.detail.reason || null });
      setConn('server');
      toast(UNKNOWN_REASON_COPY[error.detail.reason] || 'Server nedokončil odpověď. Výsledek je neznámý.', 'danger');
    } else if (error.kind === 'limit') {
      journal.setState(operationId, 'REJECTED');
      if (error.code === 'operation_limit') {
        // §6.9: a mutation refused by the cap leads straight to the only place
        // that releases it.  The refusal already carries the open list
        // (handlers.js:243), so the screen has something to show even if the
        // list request that follows fails.
        if (Array.isArray(error.detail?.openOperations)) {
          state.data.operations = error.detail.openOperations;
          state.data.operationsMeta = {
            open: error.detail.open ?? error.detail.openOperations.length,
            limit: error.detail.limit ?? OPEN_OPERATION_LIMIT,
            atLimit: true,
          };
          state.data.operationsAt = Date.now();
          state.cacheAge.operations = 'FRESH';
        }
        toast(`${error.detail?.open ?? '?'} nerozřešených pokusů — dokud je nerozřešíš, další odeslání neprojde.`, 'danger');
        return navigate('operations');
      }
      toast('Příliš mnoho operací — zkus to za chvíli.', 'danger');
    } else if (error.kind === 'conflict') {
      journal.setState(operationId, 'REJECTED');
      toast('Konflikt operace — klíč už nese jinou zprávu.', 'danger');
    } else {
      journal.setState(operationId, 'REJECTED');
      setConn(error.kind === 'server' ? 'server' : state.conn);
      toast('Odeslání selhalo.', 'danger');
    }
    render();
  }
}

/**
 * SS-10 — the status action outside MS-20 (the chip under an unresolved
 * message).  It is the same read as MS-20's, reported through a toast because
 * a chat row has nowhere to put a sentence.
 *
 * It used to do more: on `known: false` it re-sent under the same key when a
 * draft was still held, and abandoned the record silently when it was not.
 * Both are gone.  A control labelled "Zjistit stav" that dispatches a mutation
 * is the failure MD-19 exists to prevent (C-6), and an abandon nobody asked for
 * closes a record whose effect may well have happened (MD-19 §4.3).  Repeating
 * and abandoning are now separate, explicit decisions: a new send from the
 * composer, or the two-step abandon in MS-20.
 */
async function resolveOperation(operationId) {
  await lookupOperation(operationId);
  const note = state.opsNote[operationId];
  // MS-20 shows the outcome on the row itself; anywhere else it needs saying.
  if (note && state.route !== 'operations') {
    toast(note.text, note.tone === 'server' || note.tone === 'offline' ? 'danger' : 'default');
  }
  if (state.route === 'chat' && state.conversationId) await loadThread(state.conversationId);
}

/**
 * §12 — the only recovery a lifecycle transition may perform is a read.  Run at
 * start, one attempt after another rather than in parallel, and never mutating:
 * the app may have been killed mid-flight, and the answer matters most exactly
 * then.  "Žádný přechod nikdy nezpůsobí mutaci" is the rule this implements.
 */
async function reconcileOpenOperations() {
  for (const entry of journal.open()) {
    await lookupOperation(entry.operationId).catch(() => {});
  }
}

/** Pull the server's view of open operations so the cap shown is the real one. */
async function loadOperations() {
  const cached = cache.read('operations');
  if (cached.data && !state.data.operations) {
    state.data.operations = cached.data.list;
    state.data.operationsMeta = cached.data.meta;
    state.data.operationsAt = cached.at;
    state.cacheAge.operations = cached.status;
    state.cacheAt.operations = cached.at;
  }
  state.loading.operations = true;
  state.error.operations = null;
  render();

  try {
    const response = await api('/operations');
    state.data.operations = response.data;
    state.data.operationsMeta = {
      open: response.open, limit: response.limit, atLimit: response.atLimit,
    };
    state.data.operationsAt = Date.now();
    state.cacheAge.operations = 'FRESH';
    state.cacheAt.operations = Date.now();
    cache.write('operations', { list: response.data, meta: state.data.operationsMeta });
    // The server is the authority on state; reconcile the local journal to it,
    // reason included — the index has to survive the app being killed with the
    // same explanation the server would give (U-9).
    for (const entry of response.data) {
      journal.setState(entry.operationId, entry.state, { unknownReason: entry.unknownReason || null });
    }
    setConn('ok');
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    // The previous list is kept on purpose and labelled as last known (§9).
    // Dropping it would turn a failed refresh into an empty recovery screen —
    // the one screen where "nothing hangs" must never be a guess.
    state.error.operations = error;
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    state.loading.operations = false;
    render();
  }
}

/**
 * The frozen shape of "I do not hold this key" (handlers.js:360-367):
 *
 *     404  { ok: true, protocolVersion, data: { operationId, known: false, state: null } }
 *
 * The status alone must not be read as that answer.  A 404 from a mistyped
 * route, a proxy, or a `NOT_FOUND` error envelope carries no statement about
 * the attempt at all, and turning one into "the server never saw it" would
 * invent the most consequential fact on this screen.  So the body is validated,
 * not the status.
 */
function isUnknownKeyAnswer(error, operationId) {
  const body = error?.body;
  if (error?.status !== 404 || !body || body.ok !== true) return false;
  const data = body.data;
  if (!data || data.known !== false) return false;
  return data.operationId === operationId;
}

/**
 * Attribute a confirmed approval operation only from evidence bound to this
 * exact key: either the live association created before dispatch, or the frozen
 * operation lookup result persisted by the gateway.  Generic CONFIRMED rows do
 * not become approval attribution by inference.
 */
function approvalForConfirmedOperation(operationId, data) {
  if (data?.operationId !== operationId || data.state !== 'CONFIRMED') return null;

  for (const [approvalId, attempt] of Object.entries(state.approvalAttempts || {})) {
    if (attempt?.operationId === operationId) return approvalId;
  }

  const result = data.result;
  if (data.operationType !== 'approval.decide'
      || !result || typeof result !== 'object' || Array.isArray(result)
      || typeof result.approvalId !== 'string' || result.approvalId.length === 0
      || (result.decision !== 'approve' && result.decision !== 'reject')) {
    return null;
  }
  return result.approvalId;
}

/**
 * MS-20's status lookup: strictly a read of one attempt (§6.9, MR-25).
 *
 * Never sends, never abandons, and never leaves the row describing a state the
 * server has just contradicted: whatever comes back is applied to the visible
 * snapshot immediately, because this single-item answer is more authoritative
 * about this attempt than the list it came from — and the list refresh that
 * follows may itself fail.
 */
async function lookupOperation(operationId) {
  if (state.opsLookup[operationId]) return;   // one lookup per attempt, no queue
  state.opsLookup[operationId] = true;
  delete state.opsNote[operationId];
  render();

  try {
    const response = await api(`/operations/${encodeURIComponent(operationId)}`);
    const data = response.data;

    if (data.known === false) {
      // `known: false` is only meaningful in the frozen 404 answer checked in
      // isUnknownKeyAnswer(). On a 2xx it is a malformed protocol response,
      // not evidence that this operation key never reached the server.
      state.opsNote[operationId] = {
        tone: 'server',
        text: 'Stav se nepodařilo zjistit. Server poslal neplatnou odpověď; pokus zůstává nerozřešený.',
      };
      setConn('server');
      return;
    }

    const previousState = journal.find(operationId)?.lastKnownState
      || (state.data.operations || []).find(item => item.operationId === operationId)?.state
      || null;
    const ownApprovalId = approvalForConfirmedOperation(operationId, data);
    journal.setState(operationId, data.state, { unknownReason: data.unknownReason || null });
    setConn('ok');

    if (data.state === 'CONFIRMED' || data.state === 'REJECTED') {
      if (data.state === 'CONFIRMED' && ownApprovalId) {
        state.approvalsDecidedHere = {
          ...(state.approvalsDecidedHere || {}),
          [ownApprovalId]: true,
        };
        delete state.approvalsGone?.[ownApprovalId];
      }
      drafts.drop(operationId);
      state.opsNote[operationId] = {
        tone: 'ok',
        text: data.state === 'CONFIRMED' ? 'Rozřešeno — proběhlo.' : 'Rozřešeno — neproběhlo.',
      };
      // The slot is free as of this answer, so the row goes and the count drops
      // now — not "once the list comes back", which it may never do.
      ms20ReleaseRow(operationId);
      if (state.route === 'operations') {
        toast(data.state === 'CONFIRMED' ? 'Pokus rozřešen — proběhl.' : 'Pokus rozřešen — neproběhl.');
      }
      // The server still decides the exact count, so the list is re-read on top
      // of the local correction rather than instead of it.
      await loadOperations();
      return;
    }

    // Still open: merge the fresh state, reason and check time into the row, so
    // "ověřeno před N" advances and a PENDING that has become UNKNOWN says so
    // without waiting for the list.
    ms20PatchRow(operationId, {
      state: data.state,
      unknownReason: data.unknownReason ?? null,
      unknownAt: data.unknownAt ?? null,
      lastCheckedAt: Date.now(),
    });
    state.opsNote[operationId] = {
      tone: 'muted',
      text: data.state === 'UNKNOWN'
        ? (previousState === 'UNKNOWN'
          ? 'Stav se nezměnil: výsledek je pořád neznámý. Tohle je poslední zapsaný stav, ne živé ověření u backendu.'
          : 'Výsledek je nyní neznámý. Tohle je poslední zapsaný stav, ne živé ověření u backendu.')
        : 'Pokus na serveru pořád čeká na výsledek.',
    };
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    if (isUnknownKeyAnswer(error, operationId)) {
      // An answer that arrives with a non-2xx status, not a failed request.
      unknownKeyNote(operationId);
      setConn('ok');
      return;
    }
    // A failed lookup changes nothing about the attempt — it stays exactly as
    // unresolved as it was, and the row says so instead of looking checked.
    state.opsNote[operationId] = {
      tone: error.kind === 'offline' ? 'offline' : 'server',
      text: error.kind === 'offline'
        ? 'Bez spojení se stav zjistit nedá. Pokus zůstává nerozřešený.'
        : 'Stav se nepodařilo zjistit. Pokus zůstává nerozřešený.',
    };
    setConn(error.kind === 'offline' ? 'offline' : error.kind === 'server' ? 'server' : state.conn);
  } finally {
    delete state.opsLookup[operationId];
    render();
  }
}

/**
 * "The server does not hold this key" is its own fact, distinct from every
 * outcome — and MS-20 states it without acting on it.  Repeating the attempt
 * (MD-19 §4.1 rule 3) or releasing the record is the user's next tap, made
 * knowingly; doing either here would be the automatic retry or the automatic
 * abandon this screen must not have.
 */
function unknownKeyNote(operationId) {
  state.opsNote[operationId] = {
    tone: 'warn',
    text: 'Server tenhle klíč nezná. Efekt z něj tedy nejspíš nevznikl, jistota to ale není — záznam můžeš opustit.',
  };
}

/** First step: arm exactly one attempt for abandoning, and say the price. */
function askAbandon(operationId) {
  if (state.opsAbandoning) return;            // one at a time, including arming
  state.opsConfirm = operationId;
  delete state.opsNote[operationId];
  render();
}

function cancelAbandon() {
  state.opsConfirm = null;
  render();
}

/**
 * Second step (MD-19 §4.3, UI-DESIGN §6.9).  Reached only from the confirmation
 * that states the price, never automatically and never in bulk: the cap is
 * released by resolution or by a deliberate act, one attempt at a time.
 */
async function confirmAbandon(operationId) {
  if (state.opsAbandoning) return;
  if (state.opsConfirm !== operationId) return;   // no abandon without its own confirmation
  state.opsConfirm = null;
  state.opsAbandoning = operationId;
  render();

  try {
    const response = await api(`/operations/${encodeURIComponent(operationId)}/abandon`, { method: 'POST' });
    journal.discard(operationId);
    // The response carries the count *after* the abandon (handlers.js:445-455),
    // so the screen is corrected from the server's own numbers before anything
    // is re-read.  A refresh that fails afterwards then costs freshness, not
    // truth: the abandoned row is already gone and the cap already lower.
    ms20ReleaseRow(operationId, {
      open: response.data?.open ?? null,
      limit: response.data?.limit ?? null,
    });
    // Never "zrušeno": the record closed, the effect did not (§6.9).
    toast(`Pokus opuštěn · zbývá ${response.data.open}/${response.data.limit}. Efekt na serveru zůstává nerozřešený.`);
    delete state.opsNote[operationId];
    await loadOperations();
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    if (error.code === 'not_found') {
      // The server holds no such record, so the local entry is all there is and
      // dropping it loses nothing.
      journal.discard(operationId);
      ms20ReleaseRow(operationId);
      await loadOperations();
    } else if (error.code === 'state_conflict') {
      // It resolved underneath us. Read the real outcome instead of insisting.
      state.opsNote[operationId] = {
        tone: 'muted',
        text: 'Pokus se mezitím rozřešil, takže už není co opouštět. Zjisti jeho stav.',
      };
      await loadOperations();
    } else {
      state.opsNote[operationId] = {
        tone: error.kind === 'offline' ? 'offline' : 'server',
        text: error.kind === 'offline'
          ? 'Bez spojení opustit nelze — opuštění potvrzuje server. Pokus zůstává otevřený.'
          : 'Opuštění se nepodařilo. Pokus zůstává otevřený.',
      };
    }
  } finally {
    state.opsAbandoning = null;
    render();
  }
}

async function ackAll() {
  const unread = (state.data.notifications || []).filter(item => !item.read).map(item => item.id);
  if (unread.length === 0) return;
  try {
    await api('/notifications/ack', { method: 'POST', body: { ids: unread } });
    await loadNotifications();
  } catch (error) {
    if (error.kind === 'auth') return handleAuthFailure(error);
    toast('Nepodařilo se označit jako přečtené.', 'danger');
  }
}

function logout() {
  const open = journal.open();
  // MD-19 E-LOGOUT: the warning must state the consequence, not just ask.
  const message = open.length
    ? `Máš ${open.length} nerozřešených operací. Odhlášením zmizí lokální klíče, ale efekt na serveru může zůstat nerozřešený a z telefonu ho už nedohledáš.\n\nOpravdu odhlásit?`
    : 'Odhlásit zařízení a smazat lokální data?';
  if (!confirm(message)) return;
  auth.clear();
  state.session = 'unpaired';
  state.data = {};
  render();
}

/**
 * F-089 — every route assignment passes one lifecycle choke point.  Authority
 * is revoked before the new screen renders, including same-route reloads; a
 * direct/stale caller is separately stopped by approvalDecidable's route gate.
 */
function transitionRoute(route) {
  if (route !== state.route) state.opsConfirm = null;
  invalidateApprovalAuthority();
  state.route = route;
  if (route !== 'approval') state.approvalId = null;
}

function navigate(route) {
  // An armed confirmation does not survive leaving the row it belongs to: the
  // second step must be a decision about what is on screen now.
  transitionRoute(route);
  render();
  // §3.2 — the root aggregates two live surfaces.  The queue is read here for
  // the same reason MS-13 reads it on entry: a remembered count is not an
  // answer about what is waiting now (D-S2, MD-07).
  if (route === 'overview') { loadConversations(); loadApprovals(); }
  if (route === 'conversations') loadConversations();
  if (route === 'projects') loadProjects();
  if (route === 'workers') loadWorkers();
  if (route === 'specialists') loadSpecialists();
  if (route === 'notifications') loadNotifications();
  // SS-01/SS-05/SS-10: entering the screen always re-reads the queue from the
  // server, including after a reconnect.  It is a read, so repeating is safe —
  // and it is a read of a *list*, so it grants nothing (F-061).
  if (route === 'approvals') loadApprovals();
  // SS-06: a decision in progress is not carried anywhere.  Leaving the screen
  // is leaving the decision, and the verification stamp goes with it.
  if (route === 'approval' && state.approvalId) {
    // Re-entering the decision screen — which is what a reconnect does — brings
    // the payload back and the buttons not.  Re-arming is a separate, conscious
    // read the user asks for ("Načíst aktuální stav"), never a side effect of
    // the app noticing it has a connection again (F-063).
    loadApprovals();
  }
  if (route === 'operations') loadOperations();
  if (route === 'diagnostics') { loadDiagnostics(); loadOperations(); }
}

function openProject(projectId) {
  transitionRoute('project');
  state.projectId = String(projectId);
  state.data.project = undefined;
  loadProject(state.projectId);
}

function openChat(conversationId) {
  transitionRoute('chat');
  state.conversationId = conversationId;
  loadThread(conversationId);
}

function newChat() {
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  transitionRoute('chat');
  state.conversationId = id;
  state.data.thread = { conversation: { id, title: 'Nová konverzace' }, messages: [] };
  // A conversation that starts here has no past, so the window is complete from
  // the first message on — otherwise its first reply would sit under a boundary
  // offering to load history that never existed.
  state.thread = { cursor: null, end: true, loadingOlder: false, stickToBottom: true };
  state.cacheAge.thread = 'FRESH';
  render();
}

// ── Events ──────────────────────────────────────────────────────────────────
document.addEventListener('click', event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;

  const actions = {
    // §3.3 — "back" leaves a deep destination for the root of the section it
    // belongs to, so a chat returns to Konverzace and MS-20 returns to
    // Nastavení.  Sending every screen to the conversation list was a drawer-era
    // shortcut; with a bar, leaving a section by accident is a navigation bug.
    back: () => navigate(sectionRoute(currentSection())),
    go: () => navigate(target.dataset.route),
    'open-approval': () => openApproval(target.dataset.approval),
    'approval-approve': () => { decideApproval('approve'); },
    'approval-reject': () => { decideApproval('reject'); },
    'new-chat': newChat,
    'open-chat': () => openChat(target.dataset.id),
    'open-project': () => openProject(target.dataset.id),
    'project-state': () => loadProjects(target.dataset.state),
    send: doSend,
    pair: doPair,
    repair: () => { auth.clear(); state.session = 'unpaired'; render(); },
    logout,
    diagnostics: () => navigate('diagnostics'),
    operations: () => navigate('operations'),
    'ack-all': ackAll,
    // A read, wherever it is offered.  There is deliberately no action that
    // abandons in one step — the only abandon is MS-20's confirmed one.
    'resolve-op': () => resolveOperation(target.dataset.op),
    // MS-20: a read, then a two-step abandon. No action here repeats anything.
    'ms20-lookup': () => lookupOperation(target.dataset.op),
    'ms20-abandon-ask': () => askAbandon(target.dataset.op),
    'ms20-abandon-cancel': cancelAbandon,
    'ms20-abandon-confirm': () => confirmAbandon(target.dataset.op),
    // A read of the queue, and nothing more.  It was rendered by the error panel
    // and wired to nothing at all, which made the only way out of a failed queue
    // a control that did nothing when tapped (F-066).
    // The lock is set from here and nowhere else.  Both actions read the field
    // next to their own button rather than any remembered value: a PIN that
    // lingered in client state between renders would be a copy of the secret
    // living exactly where the vault exists to prevent.
    'pin-set': () => setAppPin(),
    'pin-clear': () => clearAppPin(),
    'load-approvals': () => loadApprovals(),
    // The one user-initiated read that may re-arm the decision screen: it is the
    // conscious "load the current state and decide again" that SS-10 offers
    // instead of a retry.  It sends nothing and repeats nothing.
    'approval-reread': () => {
      if (state.route === 'approval' && state.approvalId) {
        loadApprovals({ grantFor: state.approvalId });
      }
    },
    'load-operations': loadOperations,
    'load-conversations': loadConversations,
    'load-projects': () => loadProjects(),
    'load-project': () => loadProject(),
    'load-settings': () => loadSettings(),
    'load-memory': () => loadStoredInformation(),
    'load-workers': () => loadWorkers(),
    'load-specialists': () => loadSpecialists(),
    'load-more-workers': () => loadWorkers({ append: true }),
    'load-more-specialists': () => loadSpecialists({ append: true }),
    'load-thread': () => loadThread(state.conversationId),
    'load-older': () => loadOlderMessages(),
    // MD-15 — a local preference, written the moment it is changed.  There is
    // no "save": the switch *is* the setting.
    'pref-toggle': () => {
      const name = target.dataset.pref;
      if (!name) return;
      prefs.set(name, !prefs.get(name));
      render();
    },
    'load-notifications': loadNotifications,
    reload: () => navigate(state.route),
  };
  (actions[act] || (() => {}))();
});

// D-UI-3 accessibility: every bar item is in the tree even while scrolled out
// of sight, so reaching one by keyboard or screen reader has to bring it into
// view.  Centring is what the ring does anyway — this just makes focus the
// second thing that turns it.
document.addEventListener('focusin', event => {
  const tab = event.target?.closest?.('.nav-tab');
  if (tab) centreNavOnSelection(tab);
});

document.addEventListener('input', event => {
  if (event.target.id === 'composer-input') autoGrow(event.target);
});

// MR-05 — reading into the past is a scroll, not an errand.
//
// Every chat works this way: you scroll up and older messages arrive.  The
// boundary control stays, because a thread shorter than the viewport has
// nothing to scroll and because a button is reachable by keyboard, but nobody
// should have to find it.
//
// Capture phase: `scroll` does not bubble, so a delegated listener only sees it
// on the way down.  That keeps this working across `render()`, which replaces
// the scroller element on every state change.
const OLDER_TRIGGER_PX = 240;
document.addEventListener('scroll', event => {
  const scroller = event.target;
  if (!scroller || scroller.id !== 'thread-scroll') return;
  if (scroller.scrollTop > OLDER_TRIGGER_PX) return;
  // Known-offline: the boundary already says so, and scrolling into a wall
  // should not fire a request per scroll event to be told the same thing.
  if (state.conn === 'offline') return;
  // `loadOlderMessages` is itself guarded against re-entry, so a burst of
  // scroll events near the top costs one request, not one per event.
  loadOlderMessages();
}, true);

// §3.1 — the ring under a finger.
//
// Two things have to happen when the bar is turned by hand rather than tapped:
// it must never run out of material (`normaliseNavRing`), and whatever comes to
// rest in the middle becomes the current section, because the middle *is* the
// selection.  The section is switched only once the turn has settled — doing it
// per scroll event would fire a navigation for every item that swept past.
let navSettleTimer = null;
document.addEventListener('scroll', event => {
  const track = event.target;
  if (!track?.classList?.contains?.('navbar-track')) return;
  normaliseNavRing(track);
  // Cancel first, decide second.  A settle scheduled by an earlier scroll is
  // stale the moment another scroll arrives — and if *this* scroll is the app
  // turning the ring, the stale one must not outlive it either.  Clearing
  // after the guard, as this did, let a settle scheduled 140 ms before a tap
  // fire in the middle of the turn it started: it read the gate while another
  // item was sweeping through, and navigated there.  `Přehled` sits in the
  // middle of the set, so that is usually where the bar ended up.
  clearTimeout(navSettleTimer);
  if (navRingTurningItself) return;
  navSettleTimer = setTimeout(() => followNavRingToCentre(track), 140);
}, true);

/**
 * Drop any settle the ring has queued.
 *
 * Called when the app starts turning the ring itself: the pending settle was
 * decided on a gate that is about to move, so acting on it would be answering
 * a question nobody is asking any more.
 */
function forgetNavSettle() {
  clearTimeout(navSettleTimer);
}

/** Which item is standing in the gate, clones included. */
function navItemAtCentre(track) {
  const middle = track.getBoundingClientRect().left + track.clientWidth / 2;
  let best = null;
  let bestGap = Infinity;
  for (const tab of track.querySelectorAll('[data-nav]')) {
    const rect = tab.getBoundingClientRect();
    const gap = Math.abs(rect.left + rect.width / 2 - middle);
    if (gap < bestGap) { bestGap = gap; best = tab; }
  }
  return best;
}

/**
 * The middle decides.  A locked item is a legitimate place for the ring to
 * rest — it is in the loop precisely so its absence is visible — but it has no
 * screen, so resting on it changes nothing but the highlight.
 */
function followNavRingToCentre(track) {
  const centred = navItemAtCentre(track);
  if (!centred) return;
  const id = centred.dataset.nav;
  if (!id || id === currentSection()) return;
  const item = navItems().find(entry => entry.id === id);
  if (!item || item.locked || !item.route) return;
  navigate(item.route);
}

document.addEventListener('keydown', event => {
  if (event.target.id === 'composer-input' && event.key === 'Enter' && !event.shiftKey) {
    // Desktop-style send; on a soft keyboard Enter usually inserts a newline
    // anyway, so this only helps hardware keyboards.
    if (!event.isComposing && window.matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      doSend();
    }
  }
  if (event.target.id === 'pair-code' && event.key === 'Enter') { event.preventDefault(); doPair(); }
});

// SS-05: coming back online refreshes the head of the screen. An interrupted
// turn is marked, never resumed — PLAN.md §3 is explicit that resume does not
// exist upstream.
/**
 * F-058 / F-063 — the two connectivity transitions, named so they can be tested
 * and so the approval surface is invalidated in one place rather than in two
 * one-line listeners.
 *
 * Both directions invalidate.  Going offline is obvious.  Coming back is the
 * less obvious and more dangerous one: the queue on screen was confirmed before
 * a gap of unknown length, so it is a memory, and MD-07 says this screen does
 * not keep memories.  Everything is re-read; nothing is restored.
 */
function handleWentOffline() {
  invalidateApprovalSurface();
  setConn('offline');
  render();
}

function handleCameOnline() {
  invalidateApprovalSurface();
  setConn('ok');
  if (state.session === 'active') navigate(state.route);
  else render();
}

window.addEventListener('online', handleCameOnline);
window.addEventListener('offline', handleWentOffline);

// Opening a pairing link while the app is already running is a hash-only
// navigation: the document does not reload, so boot() never re-runs.  Without
// this the user scans a QR, the app visibly does nothing, and the code they
// just burned looks like the thing that failed.
window.addEventListener('hashchange', () => {
  const code = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (!code) return;
  invalidateApprovalSession();
  state.session = 'unpaired';
  state.error.pairing = null;
  render();
});

/**
 * F-093 / UI-DESIGN §12.  Backgrounding first withdraws all approval content
 * and disowns reads already on the wire.  Foregrounding never restores a grant:
 * it refreshes health/scopes, reads every open operation, then reads approvals
 * without `grantFor`.  A decision therefore still needs the user's explicit
 * on-screen re-read after reconciliation.
 */
let visibilityGeneration = 0;

async function handleVisibilityChange() {
  const generation = ++visibilityGeneration;
  invalidateApprovalSurface();
  render();

  if (document.visibilityState !== 'visible' || state.session !== 'active') return;
  const stillForeground = () => generation === visibilityGeneration
    && document.visibilityState === 'visible'
    && state.session === 'active';

  await loadDiagnostics();
  if (!stillForeground()) return;
  await reconcileOpenOperations().catch(() => {});
  if (!stillForeground()) return;

  if (auth.has('read:approvals')) await loadApprovals();
  else {
    invalidateApprovalSurface();
    render();
  }
  if (!stillForeground()) return;

  if (state.route === 'notifications') await loadNotifications();
  if (state.route === 'conversations') await loadConversations();
  if (state.route === 'projects') await loadProjects();
  if (state.route === 'project') await loadProject();
  if (state.route === 'workers') await loadWorkers();
  if (state.route === 'specialists') await loadSpecialists();
}

document.addEventListener('visibilitychange', handleVisibilityChange);

// ── The two ways the phone tells us it is out of sight (MR-23) ─────────────
//
// The shell fires `intentsmithLock` from `onPause`, which is the authoritative
// one: it happens before the system takes the recents thumbnail and before
// another app is in front.  `visibilitychange` is the belt — it also fires in a
// plain browser tab, where there is no shell to fire anything, and it costs
// nothing to forget twice.
//
// Only the *native* build wipes on hide.  Doing it in a browser tab would make
// switching tabs feel like being logged out, and a browser has no lock to
// unlock with afterwards — it would be a cost with no protection bought.
window.addEventListener('intentsmithLock', () => {
  lockDownSession();
  render();
});

window.addEventListener('intentsmithUnlock', () => {
  unlockSession();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && secure.native && state.session === 'active') {
    lockDownSession();
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // Before anything reads `auth.token`.  In the shell the credential lives in
  // the Keystore, so a boot that rendered first would show the pairing screen
  // to a paired device for one frame — and `SS-06` treats "unpaired" as a
  // destination, not a flicker.
  //
  // A boot is also the end of a lock: the shell reloads the page after
  // unlocking, and this is the line that lets the new page issue requests.
  unlockSession();
  await secure.hydrate();

  const hashCode = new URLSearchParams(location.hash.slice(1)).get('pair');

  if (hashCode || !auth.token) {
    state.session = 'unpaired';
    render();
    return;
  }

  state.session = 'active';
  render();
  await loadConversations();
  if (auth.has('read:projects')) loadProjects();
  if (auth.has('read:workers')) loadWorkers();
  if (auth.has('read:specialists')) loadSpecialists();
  loadDiagnostics();
  loadNotifications();
  // D-S2: the approval count is only honest if it is live, so it is read at
  // boot rather than inferred once the screen is opened.
  loadApprovals();

  // Reading unresolved keys on start is safe *because* it is only a read, and
  // it is the moment the answer matters most (after a crash or a restart).
  reconcileOpenOperations().catch(() => {});
}

// The browser loads this file as a module already (index.html), so naming a
// test surface costs nothing at runtime and keeps tests/mobile-ms20-ui.test.js
// from re-implementing the screen it is supposed to be checking.
export const __ms20 = {
  state, journal, drafts, store, secure, auth, cache, prefs, K, api,
  securityCard, setAppPin, clearAppPin,
  sessionEpoch, lockDownSession, unlockSession,
  render, navigate, viewOperations, ms20Entries,
  trustBar, trustZones, withTrustBar, screenLocks, serverNow,
  viewOverview, navItems, currentSection, sectionRoute, unknownScopes, NAV_ITEMS, ROUTE_SECTION,
  viewProjects, viewProject, loadProjects, loadProject, openProject,
  viewWorkers, viewSpecialists, loadWorkers, loadSpecialists,
  serverSettingsCard, publicSettingRows, loadSettings,
  storedInformationCard, storedInformationValue, loadStoredInformation,
  renderNavBar, navCount, newChat, layoutNavRing, normaliseNavRing, centreNavOnSelection,
  navRingIsTurningItself, NAV_TURN_CEILING_MS, NAV_TURN_QUIET_MS,
  scheduleNavRetraction, whenNavTurnEnds, NAV_TURN_MS,
  viewChat, threadBoundary, loadThread, loadOlderMessages, threadWindowOf, THREAD_PAGE_SIZE,
  runSilence, runSilenceEntries, overviewRunSilence,
  approvalCountdown, approvalWindowMinutes, approvalRow, serverTimeMs,
  viewApprovals, loadApprovals, approvalsGone,
  viewApproval, decideApproval, openApproval, approvalDecidable,
  unresolvedApprovalAttempt, unassociatedApprovalAttempt,
  handleWentOffline, handleCameOnline, handleVisibilityChange,
  invalidateApprovalAuthority, invalidateApprovalSurface, replaceScopes,
  loadOperations, lookupOperation, resolveOperation, reconcileOpenOperations,
  askAbandon, cancelAbandon, confirmAbandon, isUnknownKeyAnswer,
  OPEN_OPERATION_LIMIT, OPEN_OPERATION_WARN_AT, UNKNOWN_REASON_COPY,
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
