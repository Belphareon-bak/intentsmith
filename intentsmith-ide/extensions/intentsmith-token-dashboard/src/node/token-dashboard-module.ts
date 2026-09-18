import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { IntentSmithTokenDashboard, IntentSmithTokenDashboardPath } from '../common/token-dashboard-protocol';
import { IntentSmithTokenDashboardService } from './token-dashboard-service';

export default new ContainerModule(bind => {
  bind(IntentSmithTokenDashboardService).toSelf().inSingletonScope();
  bind(IntentSmithTokenDashboard).toService(IntentSmithTokenDashboardService);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler(IntentSmithTokenDashboardPath, () =>
      ctx.container.get(IntentSmithTokenDashboardService))
  ).inSingletonScope();
});
