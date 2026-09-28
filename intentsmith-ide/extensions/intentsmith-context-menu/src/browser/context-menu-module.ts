/**
 * @intentsmith/context-menu — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core';
import { IntentSmithContextMenuContribution } from './context-menu-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithContextMenuContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(IntentSmithContextMenuContribution);
  bind(MenuContribution).toService(IntentSmithContextMenuContribution);
});
