/**
 * C3 Design Viewer Contribution
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core';
import { C3DesignViewerWidget } from './design-viewer-widget';

export const C3DesignCommand: Command = {
  id: 'c3.design.show',
  label: 'C3: Zobrazit Design',
  category: 'C3',
};

@injectable()
export class C3DesignViewerContribution
  extends AbstractViewContribution<C3DesignViewerWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: C3DesignViewerWidget.ID,
      widgetName: C3DesignViewerWidget.LABEL,
      defaultWidgetOptions: {
        area: 'main',
        rank: 300,
      },
      toggleCommandId: C3DesignCommand.id,
    });
  }

  registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(C3DesignCommand, {
      execute: () => this.openView({ activate: true, reveal: true }),
    });
  }
}
