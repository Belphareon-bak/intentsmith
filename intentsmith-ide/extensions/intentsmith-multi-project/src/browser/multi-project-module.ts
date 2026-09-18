import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, KeybindingContribution } from '@theia/core/lib/common';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { IntentSmithMultiProject, IntentSmithMultiProjectPath } from '../common/multi-project-protocol';
import { IntentSmithProjectSwitcherContribution } from './project-switcher-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithMultiProject).toDynamicValue(ctx => {
    const connection = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
    return connection.createProxy<IntentSmithMultiProject>(IntentSmithMultiProjectPath);
  }).inSingletonScope();
  bind(IntentSmithProjectSwitcherContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(IntentSmithProjectSwitcherContribution);
  bind(KeybindingContribution).toService(IntentSmithProjectSwitcherContribution);
});
