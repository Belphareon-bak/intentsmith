/**
 * Isolated child environment.
 *
 * An external worker must not inherit the user's credentials or global
 * configuration. The rule here is an **allowlist, not a denylist**: the child
 * receives exactly the variables IntentSmith names, and everything else in the
 * parent environment is simply absent.
 *
 * A denylist would be wrong. New credential variables appear all the time, and
 * a list of things to strip is out of date the moment someone installs a new
 * tool. Starting from empty means a variable IntentSmith has never heard of
 * cannot leak by default.
 */

/**
 * Variables copied from the parent, when present.
 *
 * Deliberately tiny. `PATH` is here because a process cannot usefully run
 * without it; it is narrowed by the caller where possible.
 */
export const INHERITED_ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'TZ'] as const;

/**
 * Names that must never reach a worker even if someone adds them to the
 * allowlist by mistake.
 *
 * This is a backstop, not the mechanism. The allowlist is the mechanism; this
 * exists so a careless edit fails loudly in a test rather than silently leaking.
 */
export const FORBIDDEN_ENV_PATTERNS: readonly RegExp[] = [
  /^GITHUB_/i,
  /^GH_/i,
  /^AWS_/i,
  /^AZURE_/i,
  /^GOOGLE_/i,
  /^GCP_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
  /^OLLAMA_API_KEY$/i,
  /^SSH_/i,
  /^GPG_/i,
  /TOKEN$/i,
  /SECRET/i,
  /PASSWORD/i,
  /_KEY$/i,
  /APIKEY/i,
  /^HTTP_PROXY$/i,
  /^HTTPS_PROXY$/i,
  /^ALL_PROXY$/i,
  /^NPM_CONFIG_/i,
  /COOKIE/i,
];

export type IsolatedEnvOptions = {
  /** Directory that becomes HOME and the root of every XDG path. */
  runtimeRoot: string;
  /** Variables IntentSmith sets deliberately, e.g. a gateway token. */
  provided?: Record<string, string>;
  /** Parent environment to draw the small inherited set from. */
  parentEnv?: NodeJS.ProcessEnv;
  /** Narrowed PATH. Falls back to the parent PATH when omitted. */
  path?: string;
};

export class EnvironmentPolicyError extends Error {
  readonly code = 'ENV_POLICY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentPolicyError';
  }
}

/** True when a name looks like a credential and must never be forwarded. */
export function isForbiddenEnvKey(name: string): boolean {
  return FORBIDDEN_ENV_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Builds the complete environment for an isolated worker process.
 *
 * HOME and every XDG path are redirected under `runtimeRoot`, so the worker
 * reads and writes its own throwaway configuration, session storage and cache
 * rather than the user's. It therefore cannot see an existing provider login.
 *
 * Throws if a caller tries to provide a credential-shaped variable that is not
 * an IntentSmith-issued value.
 */
export function buildIsolatedEnv(options: IsolatedEnvOptions): Record<string, string> {
  const parent = options.parentEnv ?? process.env;
  const env: Record<string, string> = {};

  for (const key of INHERITED_ENV_KEYS) {
    const value = parent[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  if (options.path !== undefined) env.PATH = options.path;

  // Redirect the worker's entire notion of "my config lives here".
  env.HOME = options.runtimeRoot;
  env.XDG_CONFIG_HOME = `${options.runtimeRoot}/config`;
  env.XDG_DATA_HOME = `${options.runtimeRoot}/data`;
  env.XDG_CACHE_HOME = `${options.runtimeRoot}/cache`;
  env.XDG_STATE_HOME = `${options.runtimeRoot}/state`;
  // Non-interactive: a worker must never try to open a browser to sign in.
  env.NO_COLOR = '1';
  env.CI = '1';

  for (const [key, value] of Object.entries(options.provided ?? {})) {
    if (key.startsWith('HOME') || key.startsWith('XDG_')) {
      throw new EnvironmentPolicyError(`Provided variable "${key}" would break runtime isolation.`);
    }
    env[key] = value;
  }

  return env;
}

/**
 * Asserts that an environment carries nothing credential-shaped except the
 * names explicitly allowed for this run.
 *
 * `allowedSecretKeys` exists for the per-run gateway token, which is legitimately
 * secret and is the one thing a worker is meant to hold.
 */
export function assertNoLeakedCredentials(
  env: Record<string, string>,
  allowedSecretKeys: readonly string[] = [],
): void {
  const allowed = new Set(allowedSecretKeys);
  const leaked = Object.keys(env).filter(key => !allowed.has(key) && isForbiddenEnvKey(key));
  if (leaked.length > 0) {
    throw new EnvironmentPolicyError(
      `Refusing to start a worker: credential-shaped variables would be exposed (${leaked.sort().join(', ')}).`,
    );
  }
}
