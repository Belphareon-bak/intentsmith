/**
 * @c3/context-menu — File tree context menu with C3 actions.
 *
 * Right-click on a file:
 *   ├── C3: Review tento soubor
 *   ├── C3: Vysvětli tento soubor
 *   ├── C3: Refaktoruj tento soubor
 *   └── C3: Přidej testy pro tento soubor
 *
 * Click → sends structured command to backend with file path as context.
 * These go as c3_command (bypass CRE) with explicit intent.
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

const C3_CONTEXT_MENU = [...CommonMenus.NAVIGATOR_CONTEXT_MENU, '9_c3'];

// ─── Commands ────────────────────────────────────────────

export namespace C3ContextMenuCommands {
  export const REVIEW_FILE: Command = {
    id: 'c3.context.reviewFile',
    label: 'C3: Review tento soubor',
  };
  export const EXPLAIN_FILE: Command = {
    id: 'c3.context.explainFile',
    label: 'C3: Vysvětli tento soubor',
  };
  export const REFACTOR_FILE: Command = {
    id: 'c3.context.refactorFile',
    label: 'C3: Refaktoruj tento soubor',
  };
  export const ADD_TESTS: Command = {
    id: 'c3.context.addTests',
    label: 'C3: Přidej testy pro tento soubor',
  };
}

// ─── Handler Factory ─────────────────────────────────────

/**
 * Creates a handler that extracts file path from selection
 * and sends a structured C3 command.
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
export class C3ContextMenuContribution implements CommandContribution, MenuContribution {

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
      C3ContextMenuCommands.REVIEW_FILE,
      createFileCommandHandler('review_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      C3ContextMenuCommands.EXPLAIN_FILE,
      createFileCommandHandler('explain_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      C3ContextMenuCommands.REFACTOR_FILE,
      createFileCommandHandler('refactor_file', this.selectionService, this.sendCommand),
    );
    registry.registerCommand(
      C3ContextMenuCommands.ADD_TESTS,
      createFileCommandHandler('add_tests', this.selectionService, this.sendCommand),
    );
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(C3_CONTEXT_MENU, {
      commandId: C3ContextMenuCommands.REVIEW_FILE.id,
      order: '1',
    });
    menus.registerMenuAction(C3_CONTEXT_MENU, {
      commandId: C3ContextMenuCommands.EXPLAIN_FILE.id,
      order: '2',
    });
    menus.registerMenuAction(C3_CONTEXT_MENU, {
      commandId: C3ContextMenuCommands.REFACTOR_FILE.id,
      order: '3',
    });
    menus.registerMenuAction(C3_CONTEXT_MENU, {
      commandId: C3ContextMenuCommands.ADD_TESTS.id,
      order: '4',
    });
  }
}
