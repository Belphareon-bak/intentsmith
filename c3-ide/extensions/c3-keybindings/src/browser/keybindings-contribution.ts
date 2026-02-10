/**
 * @c3/keybindings — Comprehensive keyboard shortcut reference
 *
 * All C3-specific keybindings are registered in command-palette-contribution.ts.
 * This file serves as documentation and provides a cheat sheet widget.
 *
 * Keybinding philosophy:
 *   - Ctrl+Shift+X → Focus panel X
 *   - Ctrl+K → Quick actions (chat input)
 *   - F5 → Rerun
 *   - Escape → Cancel/Close
 *   - Enter → Submit in chat
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  QuickInputService,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser';

// ─── Keymap Reference ────────────────────────────────────

export interface KeymapEntry {
  keys: string;
  action: string;
  category: 'navigation' | 'agent' | 'chat' | 'editor' | 'theia';
  command: string;
}

export const C3_KEYMAP: KeymapEntry[] = [
  // Navigation
  { keys: 'Ctrl+Shift+C', action: 'Focus Chat panel',          category: 'navigation', command: 'c3.chat.focus' },
  { keys: 'Ctrl+Shift+A', action: 'Focus Agent Log panel',     category: 'navigation', command: 'c3.agent-log.focus' },
  { keys: 'Ctrl+Shift+D', action: 'Focus Design Viewer',       category: 'navigation', command: 'c3.design.focus' },
  { keys: 'Ctrl+`',       action: 'Focus Terminal',             category: 'theia',      command: 'terminal:toggle' },
  { keys: 'Ctrl+B',       action: 'Toggle Sidebar',             category: 'theia',      command: 'core.toggleSidebar' },
  { keys: 'Ctrl+J',       action: 'Toggle Bottom Panel',        category: 'theia',      command: 'core.toggleBottomPanel' },

  // Chat
  { keys: 'Ctrl+K',       action: 'Quick Chat Input',           category: 'chat',       command: 'c3.chat.quick' },
  { keys: 'Enter',        action: 'Odeslat zprávu (v chatu)',   category: 'chat',       command: 'c3.chat.send' },
  { keys: 'Shift+Enter',  action: 'Nový řádek (v chatu)',       category: 'chat',       command: 'c3.chat.newline' },
  { keys: 'Ctrl+Enter',   action: 'Odeslat (alternativa)',      category: 'chat',       command: 'c3.chat.send' },
  { keys: 'Ctrl+Up',      action: 'Předchozí zpráva (historie)', category: 'chat',     command: 'c3.chat.historyPrev' },

  // Agent
  { keys: 'F5',           action: 'Znovu spustit poslední příkaz', category: 'agent',  command: 'c3.agent.rerun' },
  { keys: 'Escape',       action: 'Zrušit operaci / Zavřít',   category: 'agent',      command: 'c3.agent.cancel' },

  // Editor (Theia defaults)
  { keys: 'Ctrl+Shift+P', action: 'Command Palette',           category: 'theia',      command: 'workbench.action.showCommands' },
  { keys: 'Ctrl+P',       action: 'Quick Open File',           category: 'theia',      command: 'workbench.action.quickOpen' },
  { keys: 'Ctrl+S',       action: 'Uložit soubor',             category: 'editor',     command: 'core.save' },
  { keys: 'Ctrl+Z',       action: 'Zpět',                      category: 'editor',     command: 'core.undo' },
];

// ─── Cheat Sheet Command ─────────────────────────────────

export const C3KeymapCommand: Command = {
  id: 'c3.keymap.show',
  label: 'C3: Zobrazit klávesové zkratky',
  category: 'C3',
};

@injectable()
export class C3KeybindingsContribution
  implements CommandContribution, FrontendApplicationContribution
{

  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  async onStart(): Promise<void> { }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(C3KeymapCommand, {
      execute: () => this.showKeymapCheatSheet(),
    });
  }

  private async showKeymapCheatSheet(): Promise<void> {
    const items = C3_KEYMAP.map(entry => ({
      label: `$(keyboard) ${entry.keys}`,
      description: entry.action,
      detail: entry.category,
    }));

    await this.quickInput.showQuickPick(items, {
      placeholder: 'C3 Klávesové zkratky',
    });
  }
}
