/**
 * C3 Review Panel Contribution
 *
 * Registers the Review Panel widget and auto-opens it
 * when phase === 'pending_review'.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { C3ReviewPanelWidget } from './review-panel-widget';

export const C3ReviewCommand: Command = {
  id: 'c3.review.panel',
  label: 'C3: Code Review Panel',
  category: 'C3',
};

@injectable()
export class C3ReviewPanelContribution
  extends AbstractViewContribution<C3ReviewPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: C3ReviewPanelWidget.ID,
      widgetName: C3ReviewPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'right',
        rank: 200,
      },
      toggleCommandId: C3ReviewCommand.id,
    });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(C3ReviewCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }

  /**
   * Called by rehydration logic when IDE starts with pending_review.
   */
  async autoOpenForPendingReview(): Promise<void> {
    await this.openView({ activate: true, reveal: true });
  }
}
