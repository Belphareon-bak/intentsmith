import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildIsolatedEnv } from '@intentsmith/process-runtime';
import type { InferenceGrant } from '@intentsmith/worker-sdk';

import {
  OpenCodeConfigError,
  REQUIRED_PERMISSION_POLICY,
  assertPermissionPolicy,
  assertRuntimeUsesConfig,
  buildOpenCodeConfig,
  createOpenCodeRuntime,
  inspectGeneratedConfig,
} from './runtime-config.js';

/**
 * Generated OpenCode configuration as a load-bearing boundary.
 *
 * The contract spike proved that OpenCode under its own defaults emits no
 * permission request at all and let bash write outside the workspace. Every
 * mediation guarantee therefore rests on this file being present, correct, and
 * the one the process actually reads. These tests are almost entirely about
 * refusing to start when it is not.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const grant: InferenceGrant = {
  baseUrl: 'http://127.0.0.1:41234',
  token: 'run-token-value',
  modelId: 'qwen3:14b',
};

function runtimeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-rt-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Writes an arbitrary config where the runtime expects one. */
function writeConfig(root: string, config: unknown): string {
  const dir = path.join(root, 'config', 'opencode');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'opencode.json');
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

describe('generated configuration', () => {
  it('contains the exact required permission policy', () => {
    const config = buildOpenCodeConfig(grant) as { permission: Record<string, string> };
    expect(config.permission).toEqual({ edit: 'ask', write: 'ask', bash: 'ask', webfetch: 'ask' });
    expect(() => assertPermissionPolicy(config)).not.toThrow();
  });

  it('never writes the token into the file', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    const raw = readFileSync(runtime.configPath, 'utf8');

    expect(raw).not.toContain(grant.token);
    expect(raw).toContain('{env:INTENTSMITH_GATEWAY_TOKEN}');
    expect(runtime.providedEnv.INTENTSMITH_GATEWAY_TOKEN).toBe(grant.token);
  });

  it('retains a hash of the exact bytes written', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    const expected = createHash('sha256').update(readFileSync(runtime.configPath, 'utf8')).digest('hex');

    expect(runtime.configSha256).toBe(expected);
    expect(runtime.configSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('what refuses to start', () => {
  it('refuses a configuration that is not there', () => {
    const root = runtimeRoot();
    expect(() => inspectGeneratedConfig(path.join(root, 'nothing.json'), grant.baseUrl)).toThrow(
      /configuration is missing/,
    );
  });

  it('refuses a configuration with no permission block', () => {
    const root = runtimeRoot();
    const config = buildOpenCodeConfig(grant);
    delete (config as { permission?: unknown }).permission;
    const file = writeConfig(root, config);

    // This is the exact shape that ran unmediated in the spike.
    expect(() => inspectGeneratedConfig(file, grant.baseUrl)).toThrow(/no permission block/);
  });

  it.each(['allow', 'deny', 'always', ''])('refuses a weakened edit policy: %s', value => {
    const root = runtimeRoot();
    const config = buildOpenCodeConfig(grant) as { permission: Record<string, string> };
    config.permission.edit = value;
    const file = writeConfig(root, config);

    expect(() => inspectGeneratedConfig(file, grant.baseUrl)).toThrow(/must be "ask"/);
  });

  it.each(Object.keys(REQUIRED_PERMISSION_POLICY))('refuses a policy missing %s', key => {
    const config = buildOpenCodeConfig(grant) as { permission: Record<string, string> };
    delete config.permission[key];
    expect(() => assertPermissionPolicy(config)).toThrow(new RegExp(`missing "${key}"`));
  });

  it('refuses a permission value that is not even a string', () => {
    const config = buildOpenCodeConfig(grant) as { permission: Record<string, unknown> };
    config.permission.bash = { mode: 'ask' };
    expect(() => assertPermissionPolicy(config)).toThrow(/not a string/);
  });

  it('refuses a permission block that is not an object', () => {
    expect(() => assertPermissionPolicy({ permission: 'ask' })).toThrow(/not an object/);
    expect(() => assertPermissionPolicy('nonsense')).toThrow(/not an object/);
  });

  it('refuses an unrecognized permission key rather than ignoring it', () => {
    const config = buildOpenCodeConfig(grant) as { permission: Record<string, string> };
    config.permission.experimental_shell = 'allow';
    // An unclassified capability is not something to leave enabled because it
    // happened to be spelled in a way this code does not recognize.
    expect(() => assertPermissionPolicy(config)).toThrow(/unrecognized keys: experimental_shell/);
  });

  it('refuses a configuration that was altered after generation', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    const tampered = JSON.parse(readFileSync(runtime.configPath, 'utf8')) as {
      permission: Record<string, string>;
    };
    tampered.permission.bash = 'allow';
    writeFileSync(runtime.configPath, JSON.stringify(tampered, null, 2));

    // Generation succeeded; the pre-spawn re-read is what catches this.
    expect(() => inspectGeneratedConfig(runtime.configPath, grant.baseUrl)).toThrow(/"bash" is "allow"/);
  });

  it('refuses a configuration that is no longer valid JSON', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    writeFileSync(runtime.configPath, '{ this is not json');
    expect(() => inspectGeneratedConfig(runtime.configPath, grant.baseUrl)).toThrow(/not valid JSON/);
  });

  it('refuses a configuration that reaches inference directly', () => {
    const root = runtimeRoot();
    const config = buildOpenCodeConfig(grant) as {
      provider: Record<string, { options: { baseURL: string } } | undefined>;
    };
    const provider = config.provider['intentsmith-local'];
    if (!provider) throw new Error('generated config lost its provider');
    provider.options.baseURL = 'http://127.0.0.1:11434/v1';
    const file = writeConfig(root, config);

    expect(() => inspectGeneratedConfig(file, grant.baseUrl)).toThrow(/Ollama port directly/);
  });
});

describe('the runtime must read the configuration that was checked', () => {
  it('accepts an environment pointing at the validated file', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    const env = buildIsolatedEnv({ runtimeRoot: root, provided: runtime.providedEnv });

    expect(() => assertRuntimeUsesConfig(env, runtime.configPath)).not.toThrow();
  });

  it('refuses when the environment points somewhere else', () => {
    const root = runtimeRoot();
    const other = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    const env = buildIsolatedEnv({ runtimeRoot: other, provided: {} });

    // A perfectly valid config in a directory the agent never opens mediates
    // exactly nothing.
    expect(() => assertRuntimeUsesConfig(env, runtime.configPath)).toThrow(OpenCodeConfigError);
  });

  it('refuses when the environment sets no XDG_CONFIG_HOME at all', () => {
    const root = runtimeRoot();
    const runtime = createOpenCodeRuntime({ runtimeRoot: root, grant });
    expect(() => assertRuntimeUsesConfig({ HOME: root }, runtime.configPath)).toThrow(
      /would read the user configuration/,
    );
  });
});
