/**
 * @intentsmith/keybindings — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IntentSmithKeybindingsContribution } from './keybindings-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithKeybindingsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(IntentSmithKeybindingsContribution);
  bind(FrontendApplicationContribution).toService(IntentSmithKeybindingsContribution);
});
