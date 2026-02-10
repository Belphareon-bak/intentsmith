/**
 * @c3/context-menu — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core';
import { C3ContextMenuContribution } from './context-menu-contribution';

export default new ContainerModule(bind => {
  bind(C3ContextMenuContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(C3ContextMenuContribution);
  bind(MenuContribution).toService(C3ContextMenuContribution);
});
