import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { IntentSmithTokenDashboard, IntentSmithTokenDashboardPath } from '../common/token-dashboard-protocol';

export default new ContainerModule(bind => {
  bind(IntentSmithTokenDashboard).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<IntentSmithTokenDashboard>(IntentSmithTokenDashboardPath);
  }).inSingletonScope();
});
