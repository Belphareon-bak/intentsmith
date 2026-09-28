/**
 * @intentsmith/diff-viewer — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithDiffViewer,
  IntentSmithDiffViewerPath,
  IntentSmithDiffViewerClient,
} from '../common/diff-viewer-protocol';
import { IntentSmithDiffViewerService } from './diff-viewer-service';

export default new ContainerModule(bind => {
  bind(IntentSmithDiffViewerService).toSelf().inSingletonScope();
  bind(IntentSmithDiffViewer).toService(IntentSmithDiffViewerService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get<IntentSmithDiffViewerService>(IntentSmithDiffViewerService);
    return new JsonRpcConnectionHandler<IntentSmithDiffViewerClient>(
      IntentSmithDiffViewerPath,
      client => {
        service.setClient(client);
        return service;
      },
    );
  }).inSingletonScope();
});
