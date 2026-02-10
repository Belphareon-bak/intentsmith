/**
 * @c3/design-viewer — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3DesignViewer,
  C3DesignViewerPath,
  C3DesignViewerClient,
} from '../common/design-viewer-protocol';
import { C3DesignViewerService } from './design-viewer-service';

export default new ContainerModule(bind => {
  bind(C3DesignViewerService).toSelf().inSingletonScope();
  bind(C3DesignViewer).toService(C3DesignViewerService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3DesignViewerService);
    return new JsonRpcConnectionHandler<C3DesignViewerClient>(
      C3DesignViewerPath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
