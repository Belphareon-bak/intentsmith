/**
 * IntentSmith Review Panel Contribution
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
import { IntentSmithReviewPanelWidget } from './review-panel-widget';

export const IntentSmithReviewCommand: Command = {
  id: 'intentsmith.review.panel',
  label: 'IntentSmith: Code Review Panel',
  category: 'IntentSmith',
};

@injectable()
export class IntentSmithReviewPanelContribution
  extends AbstractViewContribution<IntentSmithReviewPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: IntentSmithReviewPanelWidget.ID,
      widgetName: IntentSmithReviewPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'right',
        rank: 200,
      },
      toggleCommandId: IntentSmithReviewCommand.id,
    });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(IntentSmithReviewCommand, {
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
