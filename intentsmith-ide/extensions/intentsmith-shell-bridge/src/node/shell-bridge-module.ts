/**
 * @intentsmith/shell-bridge — Backend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core';
import {
  IntentSmithShellBridge,
  IntentSmithShellBridgePath,
} from '../common/shell-bridge-protocol';
import { ShellToolService } from './shell-tool-service';

export default new ContainerModule(bind => {
  bind(ShellToolService).toSelf().inSingletonScope();
  bind(IntentSmithShellBridge).toService(ShellToolService);

  bind(ConnectionHandler).toDynamicValue(ctx => {
    const service = ctx.container.get(ShellToolService);

    return new JsonRpcConnectionHandler(
      IntentSmithShellBridgePath,
      () => service,
    );
  }).inSingletonScope();
});
