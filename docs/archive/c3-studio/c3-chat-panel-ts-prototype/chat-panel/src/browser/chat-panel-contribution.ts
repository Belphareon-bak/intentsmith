/**
 * C3 Chat Panel Contribution — Registers chat panel with Theia
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { C3ChatPanelWidget } from './chat-panel-widget';

export const C3ChatCommand: Command = {
  id: 'c3.chat.toggle',
  label: 'C3: Zobrazit Chat',
  category: 'C3',
};

@injectable()
export class C3ChatPanelContribution
  extends AbstractViewContribution<C3ChatPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: C3ChatPanelWidget.ID,
      widgetName: C3ChatPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'right',
        rank: 100,
      },
      toggleCommandId: C3ChatCommand.id,
    });
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    // Open chat panel by default on first launch
    await this.openView({ activate: false, reveal: true });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);

    commands.registerCommand(C3ChatCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }
}
