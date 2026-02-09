/**
 * @c3/git-integration — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3GitIntegration,
  C3GitIntegrationPath,
} from '../common/git-integration-protocol';
import { C3GitIntegrationService } from './git-integration-service';

export default new ContainerModule(bind => {
  bind(C3GitIntegrationService).toSelf().inSingletonScope();
  bind(C3GitIntegration).toService(C3GitIntegrationService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3GitIntegrationService);
    return new JsonRpcConnectionHandler(C3GitIntegrationPath, () => service);
  }).inSingletonScope();
});
