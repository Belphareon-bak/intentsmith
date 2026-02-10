import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { C3TokenDashboard, C3TokenDashboardPath } from '../common/token-dashboard-protocol';
import { C3TokenDashboardService } from './token-dashboard-service';

export default new ContainerModule(bind => {
  bind(C3TokenDashboardService).toSelf().inSingletonScope();
  bind(C3TokenDashboard).toService(C3TokenDashboardService);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler(C3TokenDashboardPath, () =>
      ctx.container.get(C3TokenDashboardService))
  ).inSingletonScope();
});
