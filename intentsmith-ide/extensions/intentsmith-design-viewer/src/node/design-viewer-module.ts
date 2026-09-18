/**
 * @intentsmith/design-viewer — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithDesignViewer,
  IntentSmithDesignViewerPath,
  IntentSmithDesignViewerClient,
} from '../common/design-viewer-protocol';
import { IntentSmithDesignViewerService } from './design-viewer-service';

export default new ContainerModule(bind => {
  bind(IntentSmithDesignViewerService).toSelf().inSingletonScope();
  bind(IntentSmithDesignViewer).toService(IntentSmithDesignViewerService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get<IntentSmithDesignViewerService>(IntentSmithDesignViewerService);
    return new JsonRpcConnectionHandler<IntentSmithDesignViewerClient>(
      IntentSmithDesignViewerPath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
