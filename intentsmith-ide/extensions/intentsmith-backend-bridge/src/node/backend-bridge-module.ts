/**
 * @intentsmith/backend-bridge — Backend DI module
 *
 * Binds IntentSmithBackendBridgeService and exposes it via JSON-RPC
 * so the Theia frontend can call it.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithBackendBridge,
  IntentSmithBackendBridgePath,
  IntentSmithBackendBridgeClient,
} from '../common/backend-bridge-protocol';
import { IntentSmithBackendBridgeService } from './backend-bridge-service';

export default new ContainerModule(bind => {
  bind(IntentSmithBackendBridgeService).toSelf().inSingletonScope();
  bind(IntentSmithBackendBridge).toService(IntentSmithBackendBridgeService);

  // Expose as JSON-RPC service (frontend can call backend methods)
  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get<IntentSmithBackendBridgeService>(IntentSmithBackendBridgeService);

    return new JsonRpcConnectionHandler<IntentSmithBackendBridgeClient>(
      IntentSmithBackendBridgePath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
