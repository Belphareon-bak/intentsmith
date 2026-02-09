/**
 * @c3/project-store — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3ProjectStore,
  C3ProjectStorePath,
} from '../common/project-store-protocol';
import { C3ProjectStoreService } from './project-store-service';

export default new ContainerModule(bind => {
  bind(C3ProjectStoreService).toSelf().inSingletonScope();
  bind(C3ProjectStore).toService(C3ProjectStoreService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3ProjectStoreService);

    return new JsonRpcConnectionHandler(
      C3ProjectStorePath,
      () => service,
    );
  }).inSingletonScope();
});
