import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { IntentSmithMultiProject, IntentSmithMultiProjectPath, IntentSmithMultiProjectClient } from '../common/multi-project-protocol';
import { IntentSmithMultiProjectService } from './multi-project-service';

export default new ContainerModule(bind => {
  bind(IntentSmithMultiProjectService).toSelf().inSingletonScope();
  bind(IntentSmithMultiProject).toService(IntentSmithMultiProjectService);
  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get<IntentSmithMultiProjectService>(IntentSmithMultiProjectService);
    return new JsonRpcConnectionHandler<IntentSmithMultiProjectClient>(
      IntentSmithMultiProjectPath, client => { service.setClient(client); return service; });
  }).inSingletonScope();
});
