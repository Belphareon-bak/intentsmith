import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EnvironmentPolicyError,
  assertNoLeakedCredentials,
  buildIsolatedEnv,
  isForbiddenEnvKey,
} from './isolated-env.js';
import { bubblewrapPlan, degradedPlan, planSandbox } from './sandbox.js';
import { SupervisedProcess } from './supervisor.js';

/**
 * Environment isolation, sandbox honesty and process supervision.
 *
 * The supervisor tests spawn real short-lived processes, because process-group
 * termination is exactly what they verify and it cannot be faked meaningfully.
 * Every one is bounded and cleaned up.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-iso-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A parent environment that looks like a real developer machine. */
const HOSTILE_PARENT: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/real-user',
  LANG: 'en_US.UTF-8',
  GITHUB_TOKEN: 'ghp_realsecret',
  GH_TOKEN: 'gh_realsecret',
  AWS_ACCESS_KEY_ID: 'AKIAREAL',
  AWS_SECRET_ACCESS_KEY: 'awssecret',
  OPENAI_API_KEY: 'sk-real',
  ANTHROPIC_API_KEY: 'sk-ant-real',
  OLLAMA_API_KEY: 'ollama-real',
  SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
  HTTPS_PROXY: 'http://corp-proxy:8080',
  NPM_CONFIG_TOKEN: 'npm-real',
  MY_SESSION_COOKIE: 'cookie-value',
  XDG_CONFIG_HOME: '/home/real-user/.config',
};

describe('isolated environment', () => {
  it('inherits only the small named set and nothing else', () => {
    const env = buildIsolatedEnv({ runtimeRoot: '/run/root', parentEnv: HOSTILE_PARENT });

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.LANG).toBe('en_US.UTF-8');
    // Everything credential-shaped is simply absent.
    for (const leaked of [
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OLLAMA_API_KEY',
      'SSH_AUTH_SOCK',
      'HTTPS_PROXY',
      'NPM_CONFIG_TOKEN',
      'MY_SESSION_COOKIE',
    ]) {
      expect(env[leaked]).toBeUndefined();
    }
    expect(JSON.stringify(env)).not.toContain('realsecret');
    expect(JSON.stringify(env)).not.toContain('sk-real');
  });

  it('redirects HOME and every XDG path into the runtime root', () => {
    const env = buildIsolatedEnv({ runtimeRoot: '/run/root', parentEnv: HOSTILE_PARENT });
    expect(env.HOME).toBe('/run/root');
    expect(env.XDG_CONFIG_HOME).toBe('/run/root/config');
    expect(env.XDG_DATA_HOME).toBe('/run/root/data');
    expect(env.XDG_CACHE_HOME).toBe('/run/root/cache');
    expect(env.XDG_STATE_HOME).toBe('/run/root/state');
    // The user's real config path is never visible.
    expect(JSON.stringify(env)).not.toContain('/home/real-user');
  });

  it('carries IntentSmith-provided variables through', () => {
    const env = buildIsolatedEnv({
      runtimeRoot: '/run/root',
      parentEnv: HOSTILE_PARENT,
      provided: { INTENTSMITH_GATEWAY_TOKEN: 'issued-token' },
    });
    expect(env.INTENTSMITH_GATEWAY_TOKEN).toBe('issued-token');
  });

  it('refuses a provided variable that would break isolation', () => {
    for (const key of ['HOME', 'XDG_CONFIG_HOME']) {
      expect(() =>
        buildIsolatedEnv({ runtimeRoot: '/run/root', provided: { [key]: '/somewhere/else' } }),
      ).toThrow(EnvironmentPolicyError);
    }
  });

  it('recognises credential-shaped names', () => {
    for (const key of ['GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'MY_API_KEY', 'DB_PASSWORD', 'SESSION_COOKIE']) {
      expect(isForbiddenEnvKey(key)).toBe(true);
    }
    for (const key of ['PATH', 'HOME', 'LANG', 'CI']) {
      expect(isForbiddenEnvKey(key)).toBe(false);
    }
  });

  it('fails loudly if a credential would reach the worker', () => {
    const env = buildIsolatedEnv({ runtimeRoot: '/run/root' });
    // Simulate a careless edit that reintroduced a secret.
    const leaky = { ...env, GITHUB_TOKEN: 'ghp_oops' };
    expect(() => assertNoLeakedCredentials(leaky)).toThrow(EnvironmentPolicyError);
  });

  it('permits exactly the one secret the run is meant to hold', () => {
    const env = buildIsolatedEnv({
      runtimeRoot: '/run/root',
      provided: { INTENTSMITH_GATEWAY_TOKEN: 'issued' },
    });
    // The gateway token is credential-shaped by design, so it must be named.
    expect(() => assertNoLeakedCredentials(env, ['INTENTSMITH_GATEWAY_TOKEN'])).not.toThrow();
    expect(() => assertNoLeakedCredentials(env)).toThrow(EnvironmentPolicyError);
  });
});

describe('sandbox honesty', () => {
  const request = {
    workspaceRoot: '/work/space',
    readOnlyPaths: ['/usr/bin'],
    executable: '/usr/bin/opencode',
    args: ['acp'] as const,
  };

  it('reports degraded, not sandboxed, when bubblewrap is missing', async () => {
    const plan = await planSandbox({ request, runtimeRoot: '/run/root', probe: async () => false });
    expect(plan.status.kind).toBe('none');
    expect(plan.status.level).toBe('degraded');
    expect(plan.status.networkIsolated).toBe(false);
    expect(plan.status.detail).toContain('not OS-level containment');
    // The command is unchanged when there is no sandbox to apply.
    expect(plan.executable).toBe(request.executable);
  });

  it('uses bubblewrap when it is available', async () => {
    const plan = await planSandbox({ request, runtimeRoot: '/run/root', probe: async () => true });
    expect(plan.status.kind).toBe('bubblewrap');
    expect(plan.status.level).toBe('enforced');
    expect(plan.executable).toBe('bwrap');
    expect(plan.args).toContain('--unshare-all');
    expect(plan.args).toContain('--die-with-parent');
  });

  it('binds only the workspace and runtime root as writable', () => {
    const plan = bubblewrapPlan(request, '/run/root');
    const bindPairs = plan.args.filter((_, index) => plan.args[index - 1] === '--bind');
    expect(bindPairs).toEqual(['/work/space', '/run/root']);
    expect(plan.status.writeRoots).toEqual(['/work/space', '/run/root']);
    // No unrelated home directory is exposed.
    expect(plan.args.join(' ')).not.toContain('/home/');
  });

  it('does not claim network isolation it does not enforce', () => {
    const plan = bubblewrapPlan(request, '/run/root');
    // Loopback must stay reachable for the gateway, so this is deliberately
    // not full network isolation and must not be reported as such.
    expect(plan.args).toContain('--share-net');
    expect(plan.status.networkIsolated).toBe(false);
    expect(plan.status.detail).toContain('not otherwise restricted');
  });

  it('degrades explicitly when sandboxing is not requested', async () => {
    const plan = await planSandbox({ request, runtimeRoot: '/run/root', preferSandbox: false });
    expect(plan.status.level).toBe('degraded');
    expect(plan.status.detail).toContain('not requested');
  });

  it('degrades rather than throwing when the probe fails', async () => {
    const plan = await planSandbox({
      request,
      runtimeRoot: '/run/root',
      probe: async () => {
        throw new Error('probe exploded');
      },
    });
    expect(plan.status.level).toBe('degraded');
  });
});

describe('process supervisor', () => {
  const baseEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' };

  it('runs a process with an environment that replaces the parent', async () => {
    const root = tempRoot();
    const outPath = path.join(root, 'env.txt');
    const proc = new SupervisedProcess({
      executable: process.execPath,
      args: ['-e', `require('fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(process.env))`],
      cwd: root,
      env: { ...baseEnv, MARKER: 'present' },
    });
    const exit = await proc.exited;
    expect(exit.code).toBe(0);

    const childEnv = JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, string>;
    expect(childEnv.MARKER).toBe('present');
    // Nothing from this test process leaked in.
    expect(childEnv.INTENTSMITH_TEST_LEAK).toBeUndefined();
  });

  it('reports a missing executable as its own reason', async () => {
    const root = tempRoot();
    const proc = new SupervisedProcess({
      executable: path.join(root, 'definitely-not-here'),
      args: [],
      cwd: root,
      env: baseEnv,
    });
    await proc.exited;
    expect(proc.failureReason).toBe('executable_missing');
  });

  it('kills the whole process group, leaving no orphan', async () => {
    const root = tempRoot();
    const markerPath = path.join(root, 'child-alive.txt');
    // The grandchild is written to a file so the test is readable and there is
    // no nested escaping to get wrong.
    const grandchildPath = path.join(root, 'grandchild.cjs');
    writeFileSync(
      grandchildPath,
      `setInterval(() => require('fs').writeFileSync(${JSON.stringify(markerPath)}, String(Date.now())), 20);`,
    );
    const parentPath = path.join(root, 'parent.cjs');
    writeFileSync(
      parentPath,
      [
        `const { spawn } = require('child_process');`,
        `spawn(process.execPath, [${JSON.stringify(grandchildPath)}], { stdio: 'ignore' });`,
        `setInterval(() => {}, 1000);`,
        `process.stdout.write('ready\\n');`,
      ].join('\n'),
    );

    const proc = new SupervisedProcess({
      executable: process.execPath,
      args: [parentPath],
      cwd: root,
      env: baseEnv,
      limits: { terminationGraceMs: 200 },
    });

    await new Promise<void>(resolve => {
      const detach = proc.onStdout(chunk => {
        if (chunk.toString().includes('ready')) {
          detach();
          resolve();
        }
      });
    });
    // Let the grandchild write at least once.
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(existsSync(markerPath)).toBe(true);

    await proc.terminate('cancelled');
    const afterKill = readFileSync(markerPath, 'utf8');
    // A survivor would keep writing; give it a clear chance to prove it.
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(readFileSync(markerPath, 'utf8')).toBe(afterKill);
  });

  it('fails a process that floods stdout', async () => {
    const root = tempRoot();
    const proc = new SupervisedProcess({
      executable: process.execPath,
      args: ['-e', 'while (true) process.stdout.write("x".repeat(4096));'],
      cwd: root,
      env: baseEnv,
      limits: { maxStdoutBytes: 32 * 1024, terminationGraceMs: 200 },
    });
    await proc.exited;
    expect(proc.failureReason).toBe('stdout_overflow');
  });

  it('retains only a bounded stderr tail', async () => {
    const root = tempRoot();
    const proc = new SupervisedProcess({
      executable: process.execPath,
      args: ['-e', 'process.stderr.write("e".repeat(20000));'],
      cwd: root,
      env: baseEnv,
      limits: { maxStderrBytes: 1024 * 1024 },
    });
    await proc.exited;
    expect(proc.stderr.length).toBeLessThanOrEqual(4096);
  });

  it('terminates a hung process on the injected idle timer', async () => {
    const root = tempRoot();
    let fire: (() => void) | undefined;
    const proc = new SupervisedProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      cwd: root,
      env: baseEnv,
      limits: { terminationGraceMs: 200 },
      schedule: (fn, ms) => {
        // Only capture the idle timer, not the overall one.
        if (ms === 120_000) fire = fn;
        return () => undefined;
      },
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    fire?.();
    await proc.exited;
    expect(proc.failureReason).toBe('idle_timeout');
  });
});
