import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { C3TokenDashboard, C3TokenDashboardPath } from '../common/token-dashboard-protocol';

export default new ContainerModule(bind => {
  bind(C3TokenDashboard).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<C3TokenDashboard>(C3TokenDashboardPath);
  }).inSingletonScope();
});
