import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import { C3ChatSearch, C3ChatSearchPath } from '../common/chat-search-protocol';
import { C3ChatSearchService } from './chat-search-service';

export default new ContainerModule(bind => {
  bind(C3ChatSearchService).toSelf().inSingletonScope();
  bind(C3ChatSearch).toService(C3ChatSearchService);
  bind(ConnectionHandler).toDynamicValue(ctx =>
    new JsonRpcConnectionHandler(C3ChatSearchPath, () =>
      ctx.container.get(C3ChatSearchService))
  ).inSingletonScope();
});
