import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { REMOTE_ACCESS_ENV } from './remote-access.js';

/**
 * Process-level startup-refusal regression.
 *
 * `remote-access.test.ts` proves the *contract*: given an environment,
 * `readRemoteAccessConfig` throws, and given a config, the hook answers 401.
 * Both are in-process, and neither can show what an operator actually gets when
 * they type the command. The claim that matters to a person putting this on a
 * VPN is a claim about a process:
 *
 * - the real entry point, spawned as a real child process;
 * - an unsafe remote configuration exits non-zero;
 * - **before** a listener exists, so there is no window in which an
 *   unauthenticated socket is reachable and then withdrawn;
 * - and the failure names the rule without ever naming the credential, because
 *   a startup error lands in a terminal, a log, a CI record and a bug report.
 *
 * ## Why the negative result is trustworthy here
 *
 * "No listener appeared" is only evidence if this harness could have seen one.
 * The first test is therefore a positive control: the same spawn, the same
 * probe, a configuration that *is* allowed — and it observes a real open TCP
 * port. Every refusal afterwards is measured with the instrument that just
 * demonstrated it works.
 *
 * Each refusal is checked three independent ways, so no single assumption
 * carries the result:
 *
 * 1. a non-zero exit;
 * 2. the entry point's own "listening on" line never printed — it is written
 *    only after `app.listen()` has resolved, which makes this proof
 *    interface-independent, including for the cases whose bind target is not
 *    reachable from this machine at all;
 * 3. a TCP connect to the port that would have been bound is refused.
 *
 * The database path is redirected into a throwaway directory and asserted
 * absent afterwards, which additionally shows the refusal happened before any
 * state was opened, not merely before `listen`.
 *
 * ## Determinism and independence
 *
 * Nothing here needs OpenCode, Ollama, a GPU or the network. The worker
 * selection is left unset, so the composition root builds the in-process fake
 * and the inference gateway stays off; every `INTENTSMITH_*` variable is
 * stripped from the child's environment before the case supplies its own, so an
 * ambient shell cannot change what is being tested. The entry point is executed
 * from source through `tsx` rather than from `dist`, so the test does not
 * depend on a build having happened first — `pnpm verify` runs tests before
 * `build`, and a test that silently skipped itself when `dist` was missing
 * would prove nothing on the run that matters.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ENTRY_POINT = fileURLToPath(new URL('./index.ts', import.meta.url));

/** The listen confirmation the entry point prints, and only after it listens. */
const LISTENING = 'listening on';

/**
 * A credential that satisfies every rule, used where the violation is about
 * something else. Distinctive on purpose: the assertion that it never appears
 * in the child's output is only meaningful if a match could not be coincidence.
 */
const STRONG_TOKEN = 'Kq7-vNz3_Rt9xLm2WcHb5PjD8sYg4FaU';
/** Long enough, but far too few distinct characters. */
const REPETITIVE_TOKEN = 'zqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzqzq';
/** Strong-looking and far too short. */
const SHORT_TOKEN = 'Xj4-Wp9!';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function throwawayDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-refusal-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state.db');
}

/**
 * Takes a port from the kernel and gives it straight back.
 *
 * Binding zero and reading the assignment is the only way to name a port that
 * is free *now*; asserting "refused" against a hardcoded one would be a race
 * against whatever else is on the machine.
 */
async function reserveFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = connect({ host, port });
    const settle = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(2_000, () => settle(false));
  });
}

/** Stdin is `ignore`d: nothing here ever writes to the server's input. */
type EntryPointProcess = ChildProcessByStdio<null, Readable, Readable>;

type SpawnedServer = {
  readonly child: EntryPointProcess;
  stdout(): string;
  stderr(): string;
  exit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

/**
 * Runs the real entry point with a controlled environment.
 *
 * The child inherits the ambient environment minus every `INTENTSMITH_*` key,
 * so the case describes the whole IntentSmith configuration and a developer's
 * shell cannot make a refusal pass or fail for the wrong reason.
 */
function spawnEntryPoint(caseEnv: Readonly<Record<string, string>>): SpawnedServer {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('INTENTSMITH_')),
  );
  const child = spawn(process.execPath, ['--import', 'tsx', ENTRY_POINT], {
    cwd: REPO_ROOT,
    env: { ...inherited, ...caseEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));

  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  return { child, stdout: () => stdout, stderr: () => stderr, exit: async () => await exit };
}

/** Resolves when the child prints its listen confirmation, or the deadline passes. */
async function waitForListening(server: SpawnedServer, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.stdout().includes(LISTENING)) return true;
    if (server.child.exitCode !== null) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

describe('the entry point can open a listener at all', () => {
  it(
    'binds loopback for an allowed configuration, and the probe sees the open port',
    async () => {
      const port = await reserveFreePort();
      const dbPath = throwawayDbPath();
      const server = spawnEntryPoint({
        INTENTSMITH_PORT: String(port),
        INTENTSMITH_DB_PATH: dbPath,
      });

      // This is the control. If it fails, every "no listener" result below is
      // uninterpretable, because the instrument itself would be broken.
      expect(await waitForListening(server, 25_000)).toBe(true);
      expect(await isPortOpen('127.0.0.1', port)).toBe(true);

      server.child.kill('SIGTERM');
      const { code, signal } = await server.exit();
      expect(code === 0 || signal === 'SIGTERM').toBe(true);
      expect(await isPortOpen('127.0.0.1', port)).toBe(false);
    },
    40_000,
  );
});

/**
 * Every case is a configuration an operator could plausibly write, paired with
 * the rule it breaks. The first four would bind loopback successfully if the
 * offending variable were removed, so for those the refused TCP connect is
 * measured against exactly the port the process would otherwise have opened.
 */
const REFUSALS: ReadonlyArray<{
  readonly name: string;
  readonly env: Readonly<Record<string, string>>;
  /** Stable fragments of the rule the operator needs to read. */
  readonly rule: readonly string[];
  /** The credential this case supplies, which must never be echoed. */
  readonly secret?: string;
  /** Whether the bind target this case would have used is loopback. */
  readonly wouldBindLoopback: boolean;
}> = [
  {
    name: 'the opt-in with no credential at all',
    env: { [REMOTE_ACCESS_ENV.mode]: 'vpn' },
    rule: [REMOTE_ACCESS_ENV.token, 'is required', 'never generates'],
    wouldBindLoopback: true,
  },
  {
    name: 'a credential too short to be one',
    env: { [REMOTE_ACCESS_ENV.mode]: 'vpn', [REMOTE_ACCESS_ENV.token]: SHORT_TOKEN },
    rule: [REMOTE_ACCESS_ENV.token, 'at least 32 characters'],
    secret: SHORT_TOKEN,
    wouldBindLoopback: true,
  },
  {
    name: 'a credential with almost no distinct characters',
    env: { [REMOTE_ACCESS_ENV.mode]: 'vpn', [REMOTE_ACCESS_ENV.token]: REPETITIVE_TOKEN },
    rule: [REMOTE_ACCESS_ENV.token, 'distinct characters'],
    secret: REPETITIVE_TOKEN,
    wouldBindLoopback: true,
  },
  {
    name: 'a credential that nothing would enforce',
    env: { [REMOTE_ACCESS_ENV.token]: STRONG_TOKEN },
    rule: [REMOTE_ACCESS_ENV.token, REMOTE_ACCESS_ENV.mode, 'Set both or neither'],
    secret: STRONG_TOKEN,
    wouldBindLoopback: true,
  },
  {
    name: 'an opt-in value naming a transport this does not support',
    env: { [REMOTE_ACCESS_ENV.mode]: 'tailscale', [REMOTE_ACCESS_ENV.token]: STRONG_TOKEN },
    rule: [REMOTE_ACCESS_ENV.mode, 'is not supported', 'vpn'],
    secret: STRONG_TOKEN,
    wouldBindLoopback: true,
  },
  {
    name: 'a wildcard bind that would include interfaces nobody named',
    env: {
      [REMOTE_ACCESS_ENV.host]: '0.0.0.0',
      [REMOTE_ACCESS_ENV.mode]: 'vpn',
      [REMOTE_ACCESS_ENV.token]: STRONG_TOKEN,
    },
    rule: [REMOTE_ACCESS_ENV.host, 'binds every interface', 'Name the'],
    secret: STRONG_TOKEN,
    // `0.0.0.0` includes loopback, so the refused connect is meaningful here.
    wouldBindLoopback: true,
  },
  {
    name: 'a non-loopback bind nobody opted into',
    env: { [REMOTE_ACCESS_ENV.host]: '10.8.0.4' },
    rule: [REMOTE_ACCESS_ENV.host, 'is not loopback', 'no authentication'],
    wouldBindLoopback: false,
  },
  {
    name: 'a name, which something outside IntentSmith resolves',
    env: {
      [REMOTE_ACCESS_ENV.host]: 'vpn.example.internal',
      [REMOTE_ACCESS_ENV.mode]: 'vpn',
      [REMOTE_ACCESS_ENV.token]: STRONG_TOKEN,
    },
    rule: [REMOTE_ACCESS_ENV.host, 'is not an IP address'],
    secret: STRONG_TOKEN,
    wouldBindLoopback: false,
  },
];

describe('an unsafe remote configuration stops the process before it listens', () => {
  for (const refusal of REFUSALS) {
    it(
      `refuses ${refusal.name} without opening anything`,
      async () => {
        const port = await reserveFreePort();
        const dbPath = throwawayDbPath();
        const server = spawnEntryPoint({
          INTENTSMITH_PORT: String(port),
          INTENTSMITH_DB_PATH: dbPath,
          ...refusal.env,
        });

        const { code } = await server.exit();

        // Non-zero, so a supervisor, an init system or a shell script sees a
        // failure rather than a service it believes came up.
        expect(code).not.toBe(0);
        expect(code).not.toBeNull();

        // The listen confirmation is printed only after `app.listen()` resolves.
        // Its absence rules out a listener on any interface, including the ones
        // this machine does not have.
        expect(server.stdout()).not.toContain(LISTENING);

        // Refused before any state was opened, not merely before `listen`.
        expect(existsSync(dbPath)).toBe(false);

        if (refusal.wouldBindLoopback) {
          expect(await isPortOpen('127.0.0.1', port)).toBe(false);
        }

        // The operator is told which rule they broke.
        expect(server.stderr()).toContain('IntentSmith refused to start');
        for (const fragment of refusal.rule) expect(server.stderr()).toContain(fragment);

        // And is never told, or reminded, what they supplied.
        if (refusal.secret !== undefined) {
          expect(server.stderr()).not.toContain(refusal.secret);
          expect(server.stdout()).not.toContain(refusal.secret);
        }
      },
      30_000,
    );
  }

  it(
    'starts for the one remote configuration that is allowed, and never prints the credential',
    async () => {
      const port = await reserveFreePort();
      const dbPath = throwawayDbPath();
      // Loopback plus a credential: the default, strictly strengthened. It is
      // the only enabled remote-access configuration that can be exercised
      // without a VPN interface on the machine running the test.
      const server = spawnEntryPoint({
        INTENTSMITH_PORT: String(port),
        INTENTSMITH_DB_PATH: dbPath,
        [REMOTE_ACCESS_ENV.mode]: 'vpn',
        [REMOTE_ACCESS_ENV.token]: STRONG_TOKEN,
      });

      expect(await waitForListening(server, 25_000)).toBe(true);
      expect(await isPortOpen('127.0.0.1', port)).toBe(true);
      // The boundary is described; the secret behind it is not.
      expect(server.stdout()).toContain('operator token required');
      expect(server.stdout()).not.toContain(STRONG_TOKEN);
      expect(server.stderr()).not.toContain(STRONG_TOKEN);

      server.child.kill('SIGTERM');
      await server.exit();
    },
    40_000,
  );
});
