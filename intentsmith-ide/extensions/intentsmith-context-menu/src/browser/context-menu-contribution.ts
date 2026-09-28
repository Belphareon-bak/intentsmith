/**
 * @intentsmith/context-menu — File tree context menu with IntentSmith actions.
 *
 * Right-click on a file:
 *   ├── IntentSmith: Review tento soubor
 *   ├── IntentSmith: Vysvětli tento soubor
 *   ├── IntentSmith: Refaktoruj tento soubor
 *   └── IntentSmith: Přidej testy pro tento soubor
 *
 * Click → sends structured command to backend with file path as context.
 * These go as intentsmith_command (bypass CRE) with explicit intent.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  CommandRegistry,
  Command,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core';
import { CommonMenus } from '@theia/core/lib/browser';
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler';
import { SelectionService } from '@theia/core';
import URI from '@theia/core/lib/common/uri';

// ─── Menu Group ──────────────────────────────────────────

const INTENTSMITH_CONTEXT_MENU = [...CommonMenus.NAVIGATOR_CONTEXT_MENU, '9_intentsmith'];

// ─── Commands ────────────────────────────────────────────

export namespace IntentSmithContextMenuCommands {
  export const REVIEW_FILE: Command = {
    id: 'intentsmith.context.reviewFile',
    label: 'IntentSmith: Review tento soubor',
  };
  export const EXPLAIN_FILE: Command = {
    id: 'intentsmith.context.explainFile',
    label: 'IntentSmith: Vysvětli tento soubor',
  };
  export const REFACTOR_FILE: Command = {
    id: 'intentsmith.context.refactorFile',
    label: 'IntentSmith: Refaktoruj tento soubor',
  };
  export const ADD_TESTS: Command = {
    id: 'intentsmith.context.addTests',
    label: 'IntentSmith: Přidej testy pro tento soubor',
  };
}

// ─── Handler Factory ─────────────────────────────────────

/**
 * Creates a handler that extracts file path from selection
 * and sends a structured IntentSmith command.
 */
function createFileCommandHandler(
  commandName: string,
  selectionService: SelectionService,
  sendCommand: (name: string, payload: Record<string, unknown>) => void,
) {
  return UriAwareCommandHandler.MonoSelect(selectionService, {
    execute: (uri: URI) => {
      sendCommand(commandName, { filePath: uri.path.toString() });
    },
    isEnabled: (uri: URI) => {
      // Only for actual files, not directories
      const path = uri.path.toString();
      return path.includes('.') && !path.endsWith('/');
    },
  });
}

// ─── Contribution ────────────────────────────────────────

@injectable()
export class IntentSmithContextMenuContribution implements CommandContribution, MenuContribution {

  @inject(SelectionService)
  protected readonly selectionService!: SelectionService;

  private commandHandler?: (name: string, payload: Record<string, unknown>) => void;

  setCommandHandler(handler: (name: string, payload: Record<string, unknown>) => void): void {
    this.commandHandler = handler;
  }

  private sendCommand = (name: string, payload: Record<string, unknown>): void => {
    if (this.commandHandler) {
      this.commandHandler(name, payload);
    }
  };

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(
      IntentSmithContextMenuCommands.REVIEW_FILE,
      createFileCommandHandler('review_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      IntentSmithContextMenuCommands.EXPLAIN_FILE,
      createFileCommandHandler('explain_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      IntentSmithContextMenuCommands.REFACTOR_FILE,
      createFileCommandHandler('refactor_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      IntentSmithContextMenuCommands.ADD_TESTS,
      createFileCommandHandler('add_tests', this.selectionService, this.sendCommand),
    );
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(INTENTSMITH_CONTEXT_MENU, {
      commandId: IntentSmithContextMenuCommands.REVIEW_FILE.id,
      order: '1',
    });
    menus.registerMenuAction(INTENTSMITH_CONTEXT_MENU, {
      commandId: IntentSmithContextMenuCommands.EXPLAIN_FILE.id,
      order: '2',
    });
    menus.registerMenuAction(INTENTSMITH_CONTEXT_MENU, {
      commandId: IntentSmithContextMenuCommands.REFACTOR_FILE.id,
      order: '3',
    });
    menus.registerMenuAction(INTENTSMITH_CONTEXT_MENU, {
      commandId: IntentSmithContextMenuCommands.ADD_TESTS.id,
      order: '4',
    });
  }
}
