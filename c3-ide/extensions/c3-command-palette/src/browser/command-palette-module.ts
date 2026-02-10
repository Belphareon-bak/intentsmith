/**
 * @c3/command-palette — Frontend DI module
 */

import { ContainerModule } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { KeybindingContribution } from '@theia/core/lib/browser';
import { C3CommandPaletteContribution } from './command-palette-contribution';

export default new ContainerModule(bind => {
  bind(C3CommandPaletteContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(C3CommandPaletteContribution);
  bind(KeybindingContribution).toService(C3CommandPaletteContribution);
  bind(FrontendApplicationContribution).toService(C3CommandPaletteContribution);
});
