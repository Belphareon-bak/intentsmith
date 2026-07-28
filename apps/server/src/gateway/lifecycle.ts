import type { FastifyInstance } from 'fastify';

import type { ServerRuntime } from '../app.js';
import { buildGateway, GATEWAY_DEFAULT_HOST } from './gateway.js';
import type { GatewayTokenStore } from './token-store.js';

/**
 * Worker inference gateway lifecycle.
 *
 * The gateway is **off by default**. No external worker exists yet, and an
 * unused listener is attack surface with no benefit, so it binds only when the
 * operator asks for it. When a Phase 3 worker needs it, the composition root
 * starts it explicitly.
 *
 * It always binds to loopback. The port is ephemeral unless one is configured,
 * so the usual case leaves nothing predictable to aim at.
 */

export type GatewayHandle = {
  /** Base URL a worker should be pointed at, e.g. `http://127.0.0.1:41234`. */
  url: string;
  port: number;
  /** Issues a token scoped to one run. The secret is returned once. */
  issueToken(runId: string, taskId?: string, ttlMs?: number): string;
  /** Revokes the token for a run, e.g. when the run ends. */
  revokeRun(runId: string): boolean;
  close(): Promise<void>;
};

export type StartGatewayOptions = {
  runtime: ServerRuntime;
  tokens: GatewayTokenStore;
  /** 0 (the default) asks the OS for an ephemeral port. */
  port?: number;
};

/** True when the operator explicitly enabled the gateway. */
export function isGatewayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INTENTSMITH_GATEWAY === '1' || env.INTENTSMITH_GATEWAY_PORT !== undefined;
}

/** Reads the configured port, or 0 for ephemeral. Rejects nonsense values. */
export function readGatewayPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INTENTSMITH_GATEWAY_PORT;
  if (raw === undefined) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) return 0;
  return parsed;
}

/**
 * Starts the gateway on loopback and returns a handle.
 *
 * Closing the handle revokes every outstanding token, so no token can outlive
 * the listener that honours it.
 */
export async function startGateway(options: StartGatewayOptions): Promise<GatewayHandle> {
  const app: FastifyInstance = buildGateway({ runtime: options.runtime, tokens: options.tokens });
  const port = options.port ?? 0;

  // Loopback is not negotiable: the host is never taken from configuration.
  await app.listen({ host: GATEWAY_DEFAULT_HOST, port });

  const address = app.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://${GATEWAY_DEFAULT_HOST}:${boundPort}`,
    port: boundPort,
    issueToken: (runId, taskId, ttlMs) => options.tokens.issue(runId, taskId, ttlMs).value,
    revokeRun: runId => options.tokens.revokeRun(runId),
    close: async () => {
      options.tokens.revokeAll();
      await app.close();
    },
  };
}
