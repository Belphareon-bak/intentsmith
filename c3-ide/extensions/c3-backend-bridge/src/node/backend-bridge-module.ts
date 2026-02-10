/**
 * @c3/backend-bridge — Backend DI module
 *
 * Binds C3BackendBridgeService and exposes it via JSON-RPC
 * so the Theia frontend can call it.
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3BackendBridge,
  C3BackendBridgePath,
  C3BackendBridgeClient,
} from '../common/backend-bridge-protocol';
import { C3BackendBridgeService } from './backend-bridge-service';

export default new ContainerModule(bind => {
  bind(C3BackendBridgeService).toSelf().inSingletonScope();
  bind(C3BackendBridge).toService(C3BackendBridgeService);

  // Expose as JSON-RPC service (frontend can call backend methods)
  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3BackendBridgeService);

    return new JsonRpcConnectionHandler<C3BackendBridgeClient>(
      C3BackendBridgePath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
