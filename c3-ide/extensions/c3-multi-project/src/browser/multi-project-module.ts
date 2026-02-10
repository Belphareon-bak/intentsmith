import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, KeybindingContribution } from '@theia/core/lib/common';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { C3MultiProject, C3MultiProjectPath } from '../common/multi-project-protocol';
import { C3ProjectSwitcherContribution } from './project-switcher-contribution';

export default new ContainerModule(bind => {
  bind(C3MultiProject).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<C3MultiProject>(C3MultiProjectPath);
  }).inSingletonScope();
  bind(C3ProjectSwitcherContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(C3ProjectSwitcherContribution);
  bind(KeybindingContribution).toService(C3ProjectSwitcherContribution);
});
