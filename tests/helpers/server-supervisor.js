// Owned listener supervisor for tests.
// ==============================================================================
//
// The registry marks a suite `requirements.server: true` when it needs a
// listener it does **not** own — an externally started process on a fixed
// port.  `blockersFor()` turns that into the hard blocker `server`, which is
// why every such suite reports BLOCKED.  That classification is correct: a
// test that depends on an unowned process cannot prove anything.
//
// This module removes the dependency rather than the classification.  A suite
// that spawns its listener through `startOwnedServer()` owns the process, the
// port, and the database, so it has no external server requirement at all and
// is registered with `requirements.server: false`.
//
// Guarantees the supervisor must provide for that claim to hold:
//
//   1. Ephemeral port (`:0`) — never a fixed port, so parallel suites and a
//      developer's own running server cannot collide or be mistaken for the
//      process under test.
//   2. Loopback bind only — enforced here as well as in the listener.
//   3. Isolated database per supervisor — no shared state between suites.
//   4. Readiness is *observed*, never slept on.
//   5. Deterministic teardown, including on throw, with SIGKILL escalation so
//      a wedged child cannot outlive the suite.
//
// ==============================================================================

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 50;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/**
 * A supervised child listener.
 *
 * @typedef {Object} OwnedServer
 * @property {string}   baseUrl   e.g. `http://127.0.0.1:4123`
 * @property {number}   port      OS-assigned port
 * @property {string}   host      always loopback
 * @property {string}   dbPath    isolated SQLite file
 * @property {Function} stop      async () => exit info; idempotent
 * @property {Function} stderr    () => captured stderr so far
 * @property {Function} stdout    () => captured stdout so far
 */

/**
 * Spawn a listener the caller owns end to end.
 *
 * @param {Object}  opts
 * @param {string}  opts.entry        Script to run, relative to the repo root.
 * @param {string} [opts.host]        Loopback host to bind (default 127.0.0.1).
 * @param {Object} [opts.env]         Extra environment for the child.
 * @param {string} [opts.readyLine]   Substring on stdout meaning "listening".
 *                                    The child is expected to print its port.
 * @param {number} [opts.readyTimeoutMs]
 * @param {string} [opts.dbPath]      Share a database with another supervised
 *   process.  Isolation (guarantee 3) is the default and stays the default; a
 *   caller opts out only to test what *happens* when two gateways share one
 *   file, which cannot be observed from two isolated databases.  A supplied
 *   path is never deleted on teardown — it belongs to the caller.
 * @param {number|string} [opts.port] Fixed port instead of `:0`.  Only for
 *   provoking a deliberate collision; every other caller must keep the
 *   ephemeral default so suites cannot collide by accident.
 * @returns {Promise<OwnedServer>}
 */
export async function startOwnedServer({
  entry,
  host = '127.0.0.1',
  env = {},
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  dbPath: sharedDbPath = null,
  port: fixedPort = 0,
} = {}) {
  if (!entry) throw new Error('startOwnedServer requires an entry script');
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`Supervisor refuses non-loopback host "${host}"`);
  }

  const ownsRuntimeDir = !sharedDbPath;
  const runtimeDir = ownsRuntimeDir ? mkdtempSync(path.join(tmpdir(), 'is-owned-server-')) : null;
  const dbPath = sharedDbPath || path.join(runtimeDir, 'supervised.sqlite');

  const child = spawn(process.execPath, [entry], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
      NODE_ENV: 'test',
      NODE_NO_WARNINGS: '1',
      C3_DB_PATH: dbPath,
      C3_LOG_LEVEL: 'warn',
      // Port 0 makes the OS pick; the child reports what it got.
      C3_MOBILE_PORT: String(fixedPort),
      C3_MOBILE_HOST: host,
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  const cleanup = () => {
    // A caller-supplied database is the caller's to remove; deleting it here
    // would destroy the very state a shared-database test exists to inspect.
    if (!ownsRuntimeDir) return;
    try { rmSync(runtimeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const waitForExit = async (timeoutMs = DEFAULT_STOP_TIMEOUT_MS) => {
    const deadline = Date.now() + timeoutMs;
    while (!exited && Date.now() < deadline) await delay(POLL_INTERVAL_MS);
    return exited;
  };

  /**
   * Kill without letting the child shut down cleanly.
   *
   * SIGKILL cannot be trapped, so the process cannot run its shutdown path.
   * That is the point: it is the only way to produce the state a *crash*
   * leaves behind, as opposed to the state an orderly stop leaves behind.
   */
  const kill = async (signal = 'SIGKILL') => {
    if (exited) return exited;
    child.kill(signal);
    return (await waitForExit()) || { code: null, signal };
  };

  let stopped = false;
  const stop = async () => {
    if (stopped) return exited || { code: null, signal: null };
    stopped = true;
    if (exited) { cleanup(); return exited; }

    child.kill('SIGTERM');
    const deadline = Date.now() + DEFAULT_STOP_TIMEOUT_MS;
    while (!exited && Date.now() < deadline) await delay(POLL_INTERVAL_MS);
    // A listener that ignores SIGTERM must not outlive the suite.
    if (!exited) {
      child.kill('SIGKILL');
      const killDeadline = Date.now() + DEFAULT_STOP_TIMEOUT_MS;
      while (!exited && Date.now() < killDeadline) await delay(POLL_INTERVAL_MS);
    }
    cleanup();
    return exited || { code: null, signal: 'SIGKILL' };
  };

  // ── Readiness: observed, not slept on ────────────────────────────────────
  // The child prints a single machine-readable line once bound.  Waiting for
  // that line (rather than a timer) is what makes the port assignment safe to
  // read: the OS has already assigned it.
  const deadline = Date.now() + readyTimeoutMs;
  let port = null;

  while (Date.now() < deadline) {
    if (exited) {
      cleanup();
      throw new Error(
        `Supervised listener exited before becoming ready `
        + `(code=${exited.code} signal=${exited.signal})\n${tail(stderr)}`,
      );
    }
    const match = /MOBILE_GATEWAY_LISTENING\s+(\{.*\})/.exec(stdout);
    if (match) {
      try {
        port = JSON.parse(match[1]).port;
      } catch {
        port = null;
      }
      if (Number.isInteger(port) && port > 0) break;
    }
    await delay(POLL_INTERVAL_MS);
  }

  if (!Number.isInteger(port) || port <= 0) {
    await stop();
    throw new Error(
      `Supervised listener did not report a port within ${readyTimeoutMs}ms\n`
      + `stdout: ${tail(stdout)}\nstderr: ${tail(stderr)}`,
    );
  }

  const hostForUrl = host === '::1' ? '[::1]' : host;

  return {
    baseUrl: `http://${hostForUrl}:${port}`,
    port,
    host,
    dbPath,
    runtimeDir,
    pid: child.pid,
    stop,
    kill,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

/**
 * Run `fn` against an owned listener and always tear it down.
 *
 * Teardown runs in `finally` so a throwing assertion cannot leak the process —
 * the failure mode that makes suites flaky and ports unreclaimable.
 */
export async function withOwnedServer(opts, fn) {
  const server = await startOwnedServer(opts);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tail(text, lines = 20) {
  return text.split('\n').slice(-lines).join('\n');
}

export default { startOwnedServer, withOwnedServer };
