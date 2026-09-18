/**
 * @intentsmith/backend-bridge — Frontend DI module
 *
 * Creates JSON-RPC proxy to backend service and binds the frontend proxy.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import {
  IntentSmithBackendBridge,
  IntentSmithBackendBridgePath,
  IntentSmithBackendBridgeClient,
} from '../common/backend-bridge-protocol';
import { IntentSmithBackendBridgeProxy } from './backend-bridge-proxy';

export default new ContainerModule(bind => {
  bind(IntentSmithBackendBridgeProxy).toSelf().inSingletonScope();

  // Create JSON-RPC proxy to backend, with frontend as event listener
  bind(IntentSmithBackendBridge).toDynamicValue(ctx => {
    const proxy = ctx.container.get<IntentSmithBackendBridgeProxy>(IntentSmithBackendBridgeProxy);
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);

    return connection.createProxy<IntentSmithBackendBridge>(
      IntentSmithBackendBridgePath,
      proxy as unknown as IntentSmithBackendBridgeClient,
    );
  }).inSingletonScope();
});
