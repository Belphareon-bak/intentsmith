import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { C3ChatSearch, C3ChatSearchPath } from '../common/chat-search-protocol';

export default new ContainerModule(bind => {
  bind(C3ChatSearch).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<C3ChatSearch>(C3ChatSearchPath);
  }).inSingletonScope();
});
