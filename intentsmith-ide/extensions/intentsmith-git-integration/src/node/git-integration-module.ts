/**
 * @intentsmith/git-integration — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithGitIntegration,
  IntentSmithGitIntegrationPath,
} from '../common/git-integration-protocol';
import { IntentSmithGitIntegrationService } from './git-integration-service';

export default new ContainerModule(bind => {
  bind(IntentSmithGitIntegrationService).toSelf().inSingletonScope();
  bind(IntentSmithGitIntegration).toService(IntentSmithGitIntegrationService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(IntentSmithGitIntegrationService);
    return new JsonRpcConnectionHandler(IntentSmithGitIntegrationPath, () => service);
  }).inSingletonScope();
});
