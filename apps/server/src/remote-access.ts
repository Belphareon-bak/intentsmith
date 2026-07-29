import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Remote access to the main API, for a single operator over a private VPN.
 *
 * The default is unchanged and stays unchanged: the API binds to `127.0.0.1`,
 * requires no configuration, and treats local access as the trust boundary.
 * Everything here is inert until an operator explicitly asks for something
 * else.
 *
 * ## What this is
 *
 * One operator, one bearer token, supplied at runtime. That is the whole
 * mechanism, and its smallness is the point: this alpha has exactly one human
 * with exactly one authority, so roles, sessions, refresh tokens, accounts and
 * key administration would all be surface with nothing behind it.
 *
 * ## What this is not
 *
 * This is **not** support for exposing IntentSmith to the internet. There is no
 * TLS here and no public listener: the token travels in a plaintext header, so
 * the transport underneath it must already be encrypted and already be private.
 * A WireGuard or Tailscale interface address is the supported deployment; a
 * port forward is not, whatever the token's strength.
 *
 * ## Fail closed
 *
 * Every path that could produce a listener reachable from off-machine without a
 * credential is a startup error rather than a warning:
 *
 * - a non-loopback bind without the explicit opt-in;
 * - the opt-in without a credential, or with a weak one;
 * - a credential without the opt-in, which would otherwise do nothing at all;
 * - a wildcard bind, which would include interfaces the operator did not name.
 *
 * Nothing here generates, stores or substitutes a credential. If the operator
 * did not supply one, IntentSmith does not start.
 */

export const REMOTE_ACCESS_ENV = {
  /** Bind address. Unset means loopback. */
  host: 'INTENTSMITH_HOST',
  /** Explicit remote-access opt-in. The only accepted value is `vpn`. */
  mode: 'INTENTSMITH_REMOTE_ACCESS',
  /** The operator credential, supplied at runtime. Never persisted. */
  token: 'INTENTSMITH_OPERATOR_TOKEN',
} as const;

/** The only supported opt-in value. It names the transport it assumes. */
export const REMOTE_ACCESS_MODE = 'vpn';

export const DEFAULT_API_HOST = '127.0.0.1';

/**
 * Credential floor.
 *
 * 32 characters with 8 distinct ones rejects the failures that actually happen
 * — a placeholder, a word, a repeated character, a truncated paste — without
 * pretending to measure entropy IntentSmith cannot see.
 */
const MIN_TOKEN_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 8;

/** Bind addresses that mean "every interface", including ones not named. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '::0']);

export class RemoteAccessConfigError extends Error {
  readonly code = 'REMOTE_ACCESS_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'RemoteAccessConfigError';
  }
}

export type RemoteAccessConfig =
  | { readonly authentication: 'none'; readonly host: string }
  | {
      readonly authentication: 'operator-token';
      readonly host: string;
      /** The operator credential. Never log, serialize, audit or persist this. */
      readonly token: string;
    };

/** The unconfigured default, and the value `buildServer` assumes. */
export const LOOPBACK_ONLY: RemoteAccessConfig = { authentication: 'none', host: DEFAULT_API_HOST };

/** Loopback literals. A hostname is never accepted: only the peer address is. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Classifies a *peer* address as loopback.
 *
 * A name is never accepted here, because a peer address is not a name: what
 * arrives on the socket is an address, and anything else is not one to trust.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (LOOPBACK.has(address)) return true;
  // The whole 127.0.0.0/8 block is loopback, including the mapped IPv6 form.
  const bare = address.startsWith('::ffff:') ? address.slice(7) : address;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * Classifies a *bind target* as loopback.
 *
 * Deliberately more permissive than the peer check: `localhost` is a legitimate
 * thing to have written in `INTENTSMITH_HOST` before this existed, and binding
 * it reaches loopback. Trusting the name of something that connects to us and
 * naming the interface we listen on are different acts.
 */
export function isLoopbackBindTarget(host: string): boolean {
  return host === 'localhost' || isLoopbackAddress(host);
}

/**
 * Reads the remote-access contract from the environment.
 *
 * Called before anything is opened, so an unusable configuration costs no
 * database, no listener and no process that half-works.
 */
export function readRemoteAccessConfig(env: NodeJS.ProcessEnv = process.env): RemoteAccessConfig {
  const host = (env[REMOTE_ACCESS_ENV.host] ?? DEFAULT_API_HOST).trim();
  const rawMode = env[REMOTE_ACCESS_ENV.mode]?.trim() ?? '';
  const rawToken = env[REMOTE_ACCESS_ENV.token] ?? '';
  const optedIn = rawMode !== '';

  if (host === '') {
    throw new RemoteAccessConfigError(`${REMOTE_ACCESS_ENV.host} was set to an empty value.`);
  }
  if (optedIn && rawMode !== REMOTE_ACCESS_MODE) {
    throw new RemoteAccessConfigError(
      `${REMOTE_ACCESS_ENV.mode}="${rawMode}" is not supported. The only accepted value is "${REMOTE_ACCESS_MODE}", ` +
        'and it means the listener is reachable only across an already-encrypted private VPN.',
    );
  }

  if (!optedIn) {
    if (rawToken !== '') {
      // Partial configuration is a mistake with a security consequence: the
      // operator believes a credential is being enforced and it is not.
      throw new RemoteAccessConfigError(
        `${REMOTE_ACCESS_ENV.token} was supplied without ${REMOTE_ACCESS_ENV.mode}=${REMOTE_ACCESS_MODE}, so nothing ` +
          'would enforce it. Set both or neither.',
      );
    }
    if (!isLoopbackBindTarget(host)) {
      throw new RemoteAccessConfigError(
        `${REMOTE_ACCESS_ENV.host}="${host}" is not loopback, so the API would be reachable from the network with no ` +
          `authentication. Set ${REMOTE_ACCESS_ENV.mode}=${REMOTE_ACCESS_MODE} and ${REMOTE_ACCESS_ENV.token} to do ` +
          'that intentionally.',
      );
    }
    return { authentication: 'none', host };
  }

  if (WILDCARD_HOSTS.has(host)) {
    throw new RemoteAccessConfigError(
      `${REMOTE_ACCESS_ENV.host}="${host}" binds every interface, including ones that are not on the VPN. Name the ` +
        'VPN interface address explicitly.',
    );
  }
  if (!isLoopbackBindTarget(host) && isIP(host) === 0) {
    // A name is resolved by something IntentSmith does not control, so the
    // interface it lands on is not the one the operator named.
    throw new RemoteAccessConfigError(
      `${REMOTE_ACCESS_ENV.host}="${host}" is not an IP address. Bind the VPN interface address itself.`,
    );
  }

  assertUsableToken(rawToken);
  return { authentication: 'operator-token', host, token: rawToken };
}

/**
 * Validates the credential without ever quoting it.
 *
 * Every message here describes the rule that was broken, never the value that
 * broke it, so a startup failure cannot put the credential into a terminal, a
 * log file, a CI record or a bug report.
 */
function assertUsableToken(token: string): void {
  const problems: string[] = [];
  if (token.trim() === '') {
    problems.push(
      `${REMOTE_ACCESS_ENV.token} is required. IntentSmith never generates, stores or substitutes one for you.`,
    );
  } else {
    if (token.length < MIN_TOKEN_LENGTH) {
      problems.push(`${REMOTE_ACCESS_ENV.token} must be at least ${MIN_TOKEN_LENGTH} characters long.`);
    }
    // A credential carrying either could not be presented in a header at all,
    // so accepting it here would only move the failure somewhere confusing.
    if ([...token].some(character => (character.codePointAt(0) ?? 0) <= 0x20 || character.codePointAt(0) === 0x7f)) {
      problems.push(`${REMOTE_ACCESS_ENV.token} must not contain whitespace or control characters.`);
    }
    if (new Set(token).size < MIN_DISTINCT_CHARACTERS) {
      problems.push(
        `${REMOTE_ACCESS_ENV.token} must contain at least ${MIN_DISTINCT_CHARACTERS} distinct characters.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new RemoteAccessConfigError(
      `${REMOTE_ACCESS_ENV.mode}=${REMOTE_ACCESS_MODE} was requested but the operator credential is unusable:\n- ` +
        problems.join('\n- '),
    );
  }
}

type MaybeAuthenticated = FastifyRequest & { operatorAuthenticated?: boolean };

/** True once the central hook accepted this request's operator credential. */
export function isOperatorAuthenticated(request: FastifyRequest): boolean {
  return (request as MaybeAuthenticated).operatorAuthenticated === true;
}

/**
 * Installs the operator credential check.
 *
 * One `onRequest` hook, registered before any route, so authority is decided in
 * exactly one place and a route added later cannot forget to ask. It runs
 * before body parsing, before schema validation and before any handler, so an
 * unauthenticated caller never reaches a store, a stream or a decision.
 *
 * Missing, malformed and incorrect credentials produce one identical answer
 * that depends on nothing in the request but the credential itself. A caller
 * therefore cannot learn from a 401 whether the project, task, run or approval
 * it named exists.
 */
export function registerOperatorAuthentication(app: FastifyInstance, config: RemoteAccessConfig): void {
  if (config.authentication === 'none') return;
  const expected = digest(config.token);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!credentialMatches(request.headers.authorization, expected)) {
      // The credential is never echoed, and neither is what was presented.
      return await reply.status(401).header('www-authenticate', 'Bearer').send({
        error: {
          code: 'OPERATOR_AUTH_REQUIRED',
          message: 'A valid operator bearer token is required.',
          retryable: false,
        },
      });
    }
    (request as MaybeAuthenticated).operatorAuthenticated = true;
    return undefined;
  });
}

/** Safe to log: the shape of the boundary, never the secret behind it. */
export function describeRemoteAccess(config: RemoteAccessConfig): { host: string; authentication: string } {
  return { host: config.host, authentication: config.authentication };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Extracts exactly one `Bearer <token>`.
 *
 * Anything else — a missing header, another scheme, an empty credential, a
 * credential list, trailing content — is not a malformed token, it is no token.
 */
function presentedToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^bearer +(\S+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Compares in constant time.
 *
 * Both sides are hashed to a fixed 32 bytes first, so neither the comparison
 * nor the buffer lengths reveal how much of a guess was right.
 */
function credentialMatches(header: string | string[] | undefined, expected: Buffer): boolean {
  const presented = presentedToken(header);
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), expected);
}
