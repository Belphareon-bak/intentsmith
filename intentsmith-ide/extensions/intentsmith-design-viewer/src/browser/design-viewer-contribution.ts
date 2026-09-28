/**
 * IntentSmith Design Viewer Contribution
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { IntentSmithDesignViewerWidget } from './design-viewer-widget';

export const IntentSmithDesignCommand: Command = {
  id: 'intentsmith.design.show',
  label: 'IntentSmith: Zobrazit Design',
  category: 'IntentSmith',
};

@injectable()
export class IntentSmithDesignViewerContribution
  extends AbstractViewContribution<IntentSmithDesignViewerWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: IntentSmithDesignViewerWidget.ID,
      widgetName: IntentSmithDesignViewerWidget.LABEL,
      defaultWidgetOptions: {
        area: 'main',
        rank: 300,
      },
      toggleCommandId: IntentSmithDesignCommand.id,
    });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(IntentSmithDesignCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }
}
