import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { InferenceGrant } from '@intentsmith/worker-sdk';

/**
 * Throwaway OpenCode runtime.
 *
 * OpenCode reads global configuration from `~/.config/opencode/opencode.json`,
 * which sits under `XDG_CONFIG_HOME`. Redirecting that at a temporary directory
 * is what stops the worker from seeing the user's real provider logins: it does
 * not have to be *denied* access to them, it simply never learns they exist.
 *
 * The generated config names exactly one provider and one model, both pointed
 * at the IntentSmith gateway. OpenCode is given no route to Ollama at all.
 *
 * **Config keys are documentation-derived, not probed.** OpenCode is not
 * installed here, so the shape below comes from the official provider
 * documentation (see docs/third-party/opencode.md) and is verified only by the
 * opt-in real-OpenCode suite. It is deliberately isolated in this one module so
 * a probe can correct it in one place.
 */

/** Environment variable carrying the per-run gateway token. */
export const GATEWAY_TOKEN_ENV = 'INTENTSMITH_GATEWAY_TOKEN';

/** Provider id used inside the generated OpenCode config. */
export const PROVIDER_ID = 'intentsmith-local';

export type OpenCodeRuntimeOptions = {
  /** Temporary directory that becomes HOME and the XDG root. */
  runtimeRoot: string;
  grant: InferenceGrant;
};

export type GeneratedRuntime = {
  runtimeRoot: string;
  configPath: string;
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
    // Nothing may be auto-approved: Core owns permissions.
    autoshare: false,
    autoupdate: false,
  };
}

/**
 * Materializes a throwaway runtime directory.
 *
 * The token is returned in `providedEnv`, never written to the config file and
 * never placed in an argument vector.
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

  return {
    runtimeRoot,
    configPath,
    providedEnv: { [GATEWAY_TOKEN_ENV]: grant.token },
    cleanup: () => rmSync(runtimeRoot, { recursive: true, force: true }),
  };
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
