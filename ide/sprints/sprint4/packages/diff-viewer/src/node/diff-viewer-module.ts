/**
 * @c3/diff-viewer — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3DiffViewer,
  C3DiffViewerPath,
  C3DiffViewerClient,
} from '../common/diff-viewer-protocol';
import { C3DiffViewerService } from './diff-viewer-service';

export default new ContainerModule(bind => {
  bind(C3DiffViewerService).toSelf().inSingletonScope();
  bind(C3DiffViewer).toService(C3DiffViewerService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3DiffViewerService);
    return new JsonRpcConnectionHandler<C3DiffViewerClient>(
      C3DiffViewerPath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
