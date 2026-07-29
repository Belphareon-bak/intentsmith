import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { InferenceGrant } from '@intentsmith/worker-sdk';

/**
 * Throwaway OpenCode runtime, and the configuration that makes it mediated.
 *
 * OpenCode reads global configuration from `~/.config/opencode/opencode.json`,
 * which sits under `XDG_CONFIG_HOME`. Redirecting that at a temporary directory
 * is what stops the worker from seeing the user's real provider logins: it does
 * not have to be *denied* access to them, it simply never learns they exist.
 *
 * The permission block is load-bearing, not decorative. The Phase 3B contract
 * spike ran the pinned real binary under OpenCode's own defaults and observed
 * **zero** permission requests, with a bash command writing outside the
 * disposable workspace. Mediation is a property of the configuration IntentSmith
 * writes. If that configuration is missing, altered, weakened, or simply not the
 * file the process ends up reading, the worker runs unmediated -- so this module
 * generates from one typed source, validates what actually landed on disk, and
 * refuses to start otherwise.
 */

/** Environment variable carrying the per-run gateway token. */
export const GATEWAY_TOKEN_ENV = 'INTENTSMITH_GATEWAY_TOKEN';

/** Provider id used inside the generated OpenCode config. */
export const PROVIDER_ID = 'intentsmith-local';

/**
 * The permission policy IntentSmith requires, as the canonical typed source.
 *
 * Every side-effecting tool asks. `ask` routes the decision to Core through
 * `session/request_permission`; anything else means the agent decides for
 * itself, which is the failure the spike recorded.
 */
export const REQUIRED_PERMISSION_POLICY = Object.freeze({
  edit: 'ask',
  write: 'ask',
  bash: 'ask',
  webfetch: 'ask',
} as const);

export type PermissionPolicy = typeof REQUIRED_PERMISSION_POLICY;
export type PermissionKey = keyof PermissionPolicy;

export class OpenCodeConfigError extends Error {
  readonly code = 'OPENCODE_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeConfigError';
  }
}

export type OpenCodeRuntimeOptions = {
  /** Temporary directory that becomes HOME and the XDG root. */
  runtimeRoot: string;
  grant: InferenceGrant;
};

export type GeneratedRuntime = {
  runtimeRoot: string;
  configPath: string;
  /** SHA-256 of the exact bytes written, retained as run evidence. */
  configSha256: string;
  /** Variables IntentSmith injects, including the token. */
  providedEnv: Record<string, string>;
  cleanup(): void;
};

/**
 * Builds the OpenCode provider config.
 *
 * The token is referenced as `{env:VAR}` rather than written into the file.
 * That is the documented indirection, and it matters: the config file lands on
 * disk inside the runtime directory, and a secret written there would outlive
 * the process in a way an environment variable does not.
 */
export function buildOpenCodeConfig(grant: InferenceGrant): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      [PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'IntentSmith Local Gateway',
        options: {
          // The only inference endpoint the worker is given.
          baseURL: `${grant.baseUrl}/v1`,
          apiKey: `{env:${GATEWAY_TOKEN_ENV}}`,
        },
        models: {
          [grant.modelId]: { name: grant.modelId },
        },
      },
    },
    model: `${PROVIDER_ID}/${grant.modelId}`,
    // Generated from the typed policy above rather than written out by hand, so
    // there is exactly one place where the required policy is stated.
    permission: { ...REQUIRED_PERMISSION_POLICY },
    // Nothing may be auto-approved: Core owns permissions.
    autoshare: false,
    autoupdate: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks that a config's permission block is exactly the required policy.
 *
 * Every failure mode is refused rather than repaired: a missing block, a
 * missing key, a weakened value, a non-string value, and any key IntentSmith
 * does not know about. The last one matters most -- an unrecognized permission
 * key is a capability whose behaviour nobody here has observed, and "unknown"
 * is not a safe thing to leave enabled.
 */
export function assertPermissionPolicy(config: unknown): void {
  if (!isRecord(config)) {
    throw new OpenCodeConfigError('OpenCode configuration is not an object.');
  }
  const permission = config.permission;
  if (permission === undefined) {
    throw new OpenCodeConfigError(
      'OpenCode configuration has no permission block. Under OpenCode defaults no permission is ever requested, so this would run the worker unmediated.',
    );
  }
  if (!isRecord(permission)) {
    throw new OpenCodeConfigError('OpenCode permission block is not an object.');
  }

  for (const [key, required] of Object.entries(REQUIRED_PERMISSION_POLICY)) {
    const actual = permission[key];
    if (actual === undefined) {
      throw new OpenCodeConfigError(`OpenCode permission policy is missing "${key}"; it must be "${required}".`);
    }
    if (typeof actual !== 'string') {
      throw new OpenCodeConfigError(`OpenCode permission "${key}" is not a string.`);
    }
    if (actual !== required) {
      throw new OpenCodeConfigError(
        `OpenCode permission "${key}" is "${actual}" but must be "${required}". A weakened policy lets the agent decide for itself.`,
      );
    }
  }

  const unexpected = Object.keys(permission).filter(key => !(key in REQUIRED_PERMISSION_POLICY));
  if (unexpected.length > 0) {
    throw new OpenCodeConfigError(
      `OpenCode permission policy contains unrecognized keys: ${unexpected.sort().join(', ')}. An unclassified capability is not something to leave enabled.`,
    );
  }
}

/**
 * Asserts a generated config exposes no route to anything but the gateway.
 *
 * Used as a self-check before spawning, so a future edit that reintroduces a
 * direct Ollama URL fails immediately rather than silently.
 */
export function assertConfigHasNoDirectInference(config: Record<string, unknown>, gatewayBaseUrl: string): void {
  const serialized = JSON.stringify(config);
  if (serialized.includes('11434')) {
    throw new Error('OpenCode config references the Ollama port directly; the gateway is the only permitted path.');
  }
  if (/ollama\.com|api\.openai\.com|anthropic\.com/i.test(serialized)) {
    throw new Error('OpenCode config references a cloud inference host.');
  }
  if (!serialized.includes(gatewayBaseUrl)) {
    throw new Error('OpenCode config does not point at the IntentSmith gateway.');
  }
}

export type ConfigInspection = {
  config: Record<string, unknown>;
  sha256: string;
};

/**
 * Reads the config file a spawn is about to rely on and proves it is safe.
 *
 * Validating the in-memory object would only prove that this code can build a
 * correct config. What matters is the bytes the agent will actually read, so
 * this parses the file from disk and hashes exactly those bytes.
 */
export function inspectGeneratedConfig(configPath: string, gatewayBaseUrl: string): ConfigInspection {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    throw new OpenCodeConfigError(
      `OpenCode configuration is missing at "${configPath}"; refusing to start the worker.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OpenCodeConfigError('OpenCode configuration on disk is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new OpenCodeConfigError('OpenCode configuration on disk is not an object.');

  assertPermissionPolicy(parsed);
  assertConfigHasNoDirectInference(parsed, gatewayBaseUrl);

  return { config: parsed, sha256: createHash('sha256').update(raw).digest('hex') };
}

/**
 * Proves the isolated environment points at the configuration that was checked.
 *
 * A perfectly valid config in a directory the agent never reads mediates
 * nothing. `XDG_CONFIG_HOME` decides which file OpenCode opens, so it is
 * compared against the file that was actually validated.
 */
export function assertRuntimeUsesConfig(env: Record<string, string>, configPath: string): void {
  const configHome = env.XDG_CONFIG_HOME;
  if (!configHome) {
    throw new OpenCodeConfigError(
      'The isolated environment sets no XDG_CONFIG_HOME, so OpenCode would read the user configuration.',
    );
  }
  const expected = path.resolve(configHome, 'opencode', 'opencode.json');
  if (path.resolve(configPath) !== expected) {
    throw new OpenCodeConfigError(
      `The isolated environment points at "${expected}" but the validated configuration is "${path.resolve(configPath)}".`,
    );
  }
}

/**
 * Materializes a throwaway runtime directory.
 *
 * The token is returned in `providedEnv`, never written to the config file and
 * never placed in an argument vector. The config is written, then read back and
 * validated: what is proven is the file, not the intention.
 *
 * The file is written `0600`, which stops another user reading it. It does not
 * stop this user's own processes rewriting it, and no claim is made that it
 * does -- see `docs/security/opencode-configuration.md`.
 */
export function createOpenCodeRuntime(options: OpenCodeRuntimeOptions): GeneratedRuntime {
  const { runtimeRoot, grant } = options;
  const configDir = path.join(runtimeRoot, 'config', 'opencode');
  mkdirSync(configDir, { recursive: true });
  for (const sub of ['data', 'cache', 'state']) {
    mkdirSync(path.join(runtimeRoot, sub), { recursive: true });
  }

  const configPath = path.join(configDir, 'opencode.json');
  writeFileSync(configPath, `${JSON.stringify(buildOpenCodeConfig(grant), null, 2)}\n`, { mode: 0o600 });

  const inspected = inspectGeneratedConfig(configPath, grant.baseUrl);

  return {
    runtimeRoot,
    configPath,
    configSha256: inspected.sha256,
    providedEnv: { [GATEWAY_TOKEN_ENV]: grant.token },
    cleanup: () => rmSync(runtimeRoot, { recursive: true, force: true }),
  };
}
