/**
 * @intentsmith/command-palette — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { KeybindingContribution } from '@theia/core/lib/browser';
import { IntentSmithCommandPaletteContribution } from './command-palette-contribution';

export default new ContainerModule(bind => {
  bind(IntentSmithCommandPaletteContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(IntentSmithCommandPaletteContribution);
  bind(KeybindingContribution).toService(IntentSmithCommandPaletteContribution);
  bind(FrontendApplicationContribution).toService(IntentSmithCommandPaletteContribution);
});
