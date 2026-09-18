/**
 * IntentSmith Agent Log Panel Contribution — Registers agent panel with Theia
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { IntentSmithAgentPanelWidget } from './agent-panel-widget';

export const IntentSmithAgentLogCommand: Command = {
  id: 'intentsmith.agent-log.toggle',
  label: 'IntentSmith: Zobrazit Agent Log',
  category: 'IntentSmith',
};

@injectable()
export class IntentSmithAgentPanelContribution
  extends AbstractViewContribution<IntentSmithAgentPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: IntentSmithAgentPanelWidget.ID,
      widgetName: IntentSmithAgentPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'bottom',
        rank: 200,
      },
      toggleCommandId: IntentSmithAgentLogCommand.id,
    });
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    await this.openView({ activate: false, reveal: true });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);

    commands.registerCommand(IntentSmithAgentLogCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }
}
