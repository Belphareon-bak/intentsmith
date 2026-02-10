/**
 * @c3/backend-bridge — Frontend DI module
 *
 * Creates JSON-RPC proxy to backend service and binds the frontend proxy.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import {
  C3BackendBridge,
  C3BackendBridgePath,
  C3BackendBridgeClient,
} from '../common/backend-bridge-protocol';
import { C3BackendBridgeProxy } from './backend-bridge-proxy';

export default new ContainerModule(bind => {
  bind(C3BackendBridgeProxy).toSelf().inSingletonScope();

  // Create JSON-RPC proxy to backend, with frontend as event listener
  bind(C3BackendBridge).toDynamicValue(ctx => {
    const proxy = ctx.container.get(C3BackendBridgeProxy);
    const connection = ctx.container.get(WebSocketConnectionProvider);

    return connection.createProxy<C3BackendBridge>(
      C3BackendBridgePath,
      proxy as unknown as C3BackendBridgeClient,
    );
  }).inSingletonScope();
});
