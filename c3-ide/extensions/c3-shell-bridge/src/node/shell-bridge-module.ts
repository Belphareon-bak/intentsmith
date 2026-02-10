/**
 * @c3/shell-bridge — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  C3ShellBridge,
  C3ShellBridgePath,
} from '../common/shell-bridge-protocol';
import { ShellToolService } from './shell-tool-service';

export default new ContainerModule(bind => {
  bind(ShellToolService).toSelf().inSingletonScope();
  bind(C3ShellBridge).toService(ShellToolService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(ShellToolService);

    return new JsonRpcConnectionHandler(
      C3ShellBridgePath,
      () => service,
    );
  }).inSingletonScope();
});
