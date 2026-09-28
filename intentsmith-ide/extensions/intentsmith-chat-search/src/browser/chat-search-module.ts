import { ContainerModule } from '@theia/core/shared/inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { IntentSmithChatSearch, IntentSmithChatSearchPath } from '../common/chat-search-protocol';

export default new ContainerModule(bind => {
  bind(IntentSmithChatSearch).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<IntentSmithChatSearch>(IntentSmithChatSearchPath);
  }).inSingletonScope();
});
