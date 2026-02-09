/**
 * @c3/keybindings — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { C3KeybindingsContribution } from './keybindings-contribution';

export default new ContainerModule(bind => {
  bind(C3KeybindingsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(C3KeybindingsContribution);
  bind(FrontendApplicationContribution).toService(C3KeybindingsContribution);
});
