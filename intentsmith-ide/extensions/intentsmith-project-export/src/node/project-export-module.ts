/**
 * @intentsmith/project-export — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithProjectExport,
  IntentSmithProjectExportPath,
} from '../common/project-export-protocol';
import { IntentSmithProjectExportService } from './project-export-service';

export default new ContainerModule(bind => {
  bind(IntentSmithProjectExportService).toSelf().inSingletonScope();
  bind(IntentSmithProjectExport).toService(IntentSmithProjectExportService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(IntentSmithProjectExportService);
    return new JsonRpcConnectionHandler(IntentSmithProjectExportPath, () => service);
  }).inSingletonScope();
});
