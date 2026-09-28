/**
 * @intentsmith/project-store — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithProjectStore,
  IntentSmithProjectStorePath,
} from '../common/project-store-protocol';
import { IntentSmithProjectStoreService } from './project-store-service';

export default new ContainerModule(bind => {
  bind(IntentSmithProjectStoreService).toSelf().inSingletonScope();
  bind(IntentSmithProjectStore).toService(IntentSmithProjectStoreService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(IntentSmithProjectStoreService);

    return new JsonRpcConnectionHandler(
      IntentSmithProjectStorePath,
      () => service,
    );
  }).inSingletonScope();
});
