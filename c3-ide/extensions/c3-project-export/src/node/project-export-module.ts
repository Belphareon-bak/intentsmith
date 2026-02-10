/**
 * @c3/project-export — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3ProjectExport,
  C3ProjectExportPath,
} from '../common/project-export-protocol';
import { C3ProjectExportService } from './project-export-service';

export default new ContainerModule(bind => {
  bind(C3ProjectExportService).toSelf().inSingletonScope();
  bind(C3ProjectExport).toService(C3ProjectExportService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(C3ProjectExportService);
    return new JsonRpcConnectionHandler(C3ProjectExportPath, () => service);
  }).inSingletonScope();
});
