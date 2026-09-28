/**
 * IntentSmith Onboarding Contribution
 *
 * Auto-shows onboarding on first IDE start.
 * Commands:
 *   - IntentSmith: Znovu spustit onboarding
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { IntentSmithOnboardingWidget } from './onboarding-widget';

export const IntentSmithOnboardingCommand: Command = {
  id: 'intentsmith.onboarding.restart',
  label: 'IntentSmith: Znovu spustit onboarding',
  category: 'IntentSmith',
};

@injectable()
export class IntentSmithOnboardingContribution
  implements FrontendApplicationContribution, CommandContribution
{
  @inject(IntentSmithOnboardingWidget)
  protected readonly widget!: IntentSmithOnboardingWidget;

  async onStart(app: FrontendApplication): Promise<void> {
    if (this.widget.shouldShow()) {
      // Delay to let other widgets load first
      setTimeout(() => this.widget.show(), 1500);
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(IntentSmithOnboardingCommand, {
      execute: () => this.widget.reset(),
    });
  }
}
