import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { C3MultiProject, C3MultiProjectPath, C3MultiProjectClient } from '../common/multi-project-protocol';
import { C3MultiProjectService } from './multi-project-service';

export default new ContainerModule(bind => {
  bind(C3MultiProjectService).toSelf().inSingletonScope();
  bind(C3MultiProject).toService(C3MultiProjectService);
  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get<C3MultiProjectService>(C3MultiProjectService);
    return new JsonRpcConnectionHandler<C3MultiProjectClient>(
      C3MultiProjectPath, client => { service.setClient(client); return service; });
  }).inSingletonScope();
});
