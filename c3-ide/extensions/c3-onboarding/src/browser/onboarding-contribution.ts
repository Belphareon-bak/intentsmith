/**
 * C3 Onboarding Contribution
 *
 * Auto-shows onboarding on first IDE start.
 * Commands:
 *   - C3: Znovu spustit onboarding
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { C3OnboardingWidget } from './onboarding-widget';

export const C3OnboardingCommand: Command = {
  id: 'c3.onboarding.restart',
  label: 'C3: Znovu spustit onboarding',
  category: 'C3',
};

@injectable()
export class C3OnboardingContribution
  implements FrontendApplicationContribution, CommandContribution
{
  @inject(C3OnboardingWidget)
  protected readonly widget!: C3OnboardingWidget;

  async onStart(app: FrontendApplication): Promise<void> {
    if (this.widget.shouldShow()) {
      // Delay to let other widgets load first
      setTimeout(() => this.widget.show(), 1500);
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(C3OnboardingCommand, {
      execute: () => this.widget.reset(),
    });
  }
}
