import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { IntentSmithChatSearch, IntentSmithChatSearchPath } from '../common/chat-search-protocol';
import { IntentSmithChatSearchService } from './chat-search-service';

export default new ContainerModule(bind => {
  bind(IntentSmithChatSearchService).toSelf().inSingletonScope();
  bind(IntentSmithChatSearch).toService(IntentSmithChatSearchService);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler(IntentSmithChatSearchPath, () =>
      ctx.container.get(IntentSmithChatSearchService))
  ).inSingletonScope();
});
