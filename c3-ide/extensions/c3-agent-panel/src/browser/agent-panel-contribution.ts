/**
 * C3 Agent Log Panel Contribution — Registers agent panel with Theia
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { C3AgentPanelWidget } from './agent-panel-widget';

export const C3AgentLogCommand: Command = {
  id: 'c3.agent-log.toggle',
  label: 'C3: Zobrazit Agent Log',
  category: 'C3',
};

@injectable()
export class C3AgentPanelContribution
  extends AbstractViewContribution<C3AgentPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: C3AgentPanelWidget.ID,
      widgetName: C3AgentPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'bottom',
        rank: 200,
      },
      toggleCommandId: C3AgentLogCommand.id,
    });
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    await this.openView({ activate: false, reveal: true });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);

    commands.registerCommand(C3AgentLogCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }
}
