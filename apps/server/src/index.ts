import { buildServer } from './app.js';
import { isGatewayEnabled, readGatewayPort, startGateway, type GatewayHandle } from './gateway/lifecycle.js';
import { StartupRecoveryError } from './recovery.js';
import { createRuntime } from './runtime.js';
import {
  DEFAULT_API_HOST,
  describeRemoteAccess,
  readRemoteAccessConfig,
  type RemoteAccessConfig,
} from './remote-access.js';

export { buildServer, type ServerRuntime } from './app.js';
export { createRuntime, defaultDbPath, type RuntimeOptions } from './runtime.js';
export { StartupRecoveryError, runStartupRecovery, type RecoverySummary } from './recovery.js';
export { createTestServerRuntime } from './test-runtime.js';
export {
  isGatewayEnabled,
  readGatewayPort,
  startGateway,
  type GatewayHandle,
  type StartGatewayOptions,
} from './gateway/lifecycle.js';
export { buildGateway, GATEWAY_DEFAULT_HOST } from './gateway/gateway.js';
export {
  OPENCODE_ENV,
  WORKER_SELECTION_ENV,
  WorkerConfigError,
  readOpenCodeConfig,
  readWorkerSelection,
  type OpenCodeConfig,
  type WorkerSelection,
} from './opencode/config.js';
export {
  createOpenCodeStack,
  type OpenCodeOverrides,
  type OpenCodeStack,
} from './opencode/composition.js';
export {
  ApprovalDesk,
  ApprovalDeskError,
  describePending,
  type ApprovalVerdict,
  type DecisionResult,
  type PendingApprovalView,
} from './opencode/approval-desk.js';
export { registerApprovalRoutes } from './approval-routes.js';
export {
  DEFAULT_API_HOST,
  LOOPBACK_ONLY,
  REMOTE_ACCESS_ENV,
  REMOTE_ACCESS_MODE,
  RemoteAccessConfigError,
  describeRemoteAccess,
  isLoopbackAddress,
  isLoopbackBindTarget,
  isOperatorAuthenticated,
  readRemoteAccessConfig,
  registerOperatorAuthentication,
  type RemoteAccessConfig,
} from './remote-access.js';
export {
  GatewayGrantIssuer,
  WorkerAuthorityError,
  createRunScopedWorker,
  type RunScopedWorkerOptions,
} from './opencode/run-grant-worker.js';
export { GatewayTokenStore, describeToken, type GatewayToken, type GatewayTokenInfo } from './gateway/token-store.js';
export const DEFAULT_HOST = DEFAULT_API_HOST;

if (import.meta.url === `file://${process.argv[1]}`) {
  // Read first, before a database is opened or a socket exists. A bind that
  // would be reachable off this machine without a credential, a credential that
  // nothing would enforce, or a credential too weak to be one, all stop the
  // process here rather than becoming a listener somebody has to notice.
  let remoteAccess: RemoteAccessConfig;
  try {
    remoteAccess = readRemoteAccessConfig();
  } catch (error) {
    console.error(`IntentSmith refused to start: ${(error as Error).message}`);
    process.exit(1);
  }

  const runtime = createRuntime();
  const app = buildServer(runtime, remoteAccess);
  const host = remoteAccess.host;
  const port = Number(process.env.INTENTSMITH_PORT ?? 47831);
  let gateway: GatewayHandle | undefined;
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      // Close the gateway first so no token outlives the listener.
      await gateway?.close();
      await app.close();
    } catch (error) {
      console.error('IntentSmith server shutdown failed', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    // Startup recovery runs before listen so no client can ever observe a
    // stale `running` row as live work. A failure here must stop the process:
    // serving from a half-recovered database is the ambiguity the policy
    // exists to remove.
    const summary = await runtime.prepare?.();
    if (summary) {
      console.log(
        summary.recoveredRunCount === 0
          ? 'Startup recovery: no interrupted runs found.'
          : `Startup recovery: closed ${summary.recoveredRunCount} interrupted run(s) across ${summary.affectedTaskIds.length} task(s). None were restarted.`,
      );
    }
    await app.listen({ host, port });
    // `describeRemoteAccess` is the only thing about this configuration that
    // may be printed: the shape of the boundary, never the credential.
    const boundary = describeRemoteAccess(remoteAccess);
    console.log(
      boundary.authentication === 'operator-token'
        ? `IntentSmith server listening on http://${host}:${port} (operator token required; private VPN transport assumed)`
        : `IntentSmith server listening on http://${host}:${port}`,
    );

    // The worker inference gateway stays off unless explicitly enabled: for the
    // fake worker there is nothing to serve, and an unused listener is attack
    // surface. A worker that needs a mediated inference path is the exception —
    // it cannot start a run without one, so the gateway is not optional there.
    if (isGatewayEnabled() || runtime.bindWorkerGateway) {
      gateway = await startGateway({
        runtime,
        tokens: runtime.gatewayTokens,
        port: readGatewayPort(),
      });
      runtime.bindWorkerGateway?.(gateway.url);
      console.log(`Worker inference gateway listening on ${gateway.url} (per-run token required)`);
    }
  } catch (error) {
    if (error instanceof StartupRecoveryError) {
      console.error(`IntentSmith refused to start: ${error.message}`);
    } else {
      app.log.error(error);
    }
    await shutdown();
    process.exitCode = 1;
  }
}
