/**
 * @intentsmith/command-palette — IntentSmith-specific commands registered with Theia's Command Palette
 *
 * UX INVARIANT:
 *   Command Palette = ALWAYS structured command → direct handler (BYPASSES CRE)
 *   Chat Input      = ALWAYS natural language  → CRE routing
 *
 * Commands send { type: 'intentsmith_command', name: '...', payload: {...} }
 * Chat sends    { type: 'chat_message', content: '...' }
 *
 * NEVER send raw text from Command Palette.
 * NEVER send structured commands from Chat Input.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  QuickInputService,
} from '@theia/core/lib/browser';
import { Command, CommandContribution, CommandRegistry } from '@theia/core';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';

// ─── IntentSmith Command Definitions ─────────────────────────────

export namespace IntentSmithCommands {
  // Project commands
  export const NEW_PROJECT: Command = {
    id: 'intentsmith.project.new',
    label: 'IntentSmith: Nový projekt',
    category: 'IntentSmith',
  };
  export const CONTINUE_DESIGN: Command = {
    id: 'intentsmith.design.continue',
    label: 'IntentSmith: Pokračovat v návrhu',
    category: 'IntentSmith',
  };
  export const SHOW_DESIGN: Command = {
    id: 'intentsmith.design.show',
    label: 'IntentSmith: Zobrazit design',
    category: 'IntentSmith',
  };
  export const START_BUILD: Command = {
    id: 'intentsmith.build.start',
    label: 'IntentSmith: Spustit build',
    category: 'IntentSmith',
  };
  export const START_REVIEW: Command = {
    id: 'intentsmith.review.start',
    label: 'IntentSmith: Code review',
    category: 'IntentSmith',
  };
  export const CLOSE_PROJECT: Command = {
    id: 'intentsmith.project.close',
    label: 'IntentSmith: Uzavřít projekt',
    category: 'IntentSmith',
  };
  export const EXPORT_PROJECT: Command = {
    id: 'intentsmith.project.export',
    label: 'IntentSmith: Exportovat projekt',
    category: 'IntentSmith',
  };

  // View commands
  export const SHOW_HISTORY: Command = {
    id: 'intentsmith.history.show',
    label: 'IntentSmith: Zobrazit historii',
    category: 'IntentSmith',
  };
  export const SHOW_AGENT_LOG: Command = {
    id: 'intentsmith.agent-log.toggle',
    label: 'IntentSmith: Zobrazit Agent Log',
    category: 'IntentSmith',
  };
  export const FOCUS_CHAT: Command = {
    id: 'intentsmith.chat.focus',
    label: 'IntentSmith: Focus Chat',
    category: 'IntentSmith',
  };
  export const FOCUS_AGENT: Command = {
    id: 'intentsmith.agent-log.focus',
    label: 'IntentSmith: Focus Agent Log',
    category: 'IntentSmith',
  };
  export const FOCUS_DESIGN: Command = {
    id: 'intentsmith.design.focus',
    label: 'IntentSmith: Focus Design Viewer',
    category: 'IntentSmith',
  };

  // Action commands
  export const CLEAR_CHAT: Command = {
    id: 'intentsmith.chat.clear',
    label: 'IntentSmith: Vyčistit chat',
    category: 'IntentSmith',
  };
  export const RECONNECT: Command = {
    id: 'intentsmith.backend.reconnect',
    label: 'IntentSmith: Reconnect k backendu',
    category: 'IntentSmith',
  };
  export const RERUN_LAST: Command = {
    id: 'intentsmith.agent.rerun',
    label: 'IntentSmith: Znovu spustit poslední příkaz',
    category: 'IntentSmith',
  };

  // Quick Chat Input (this one IS for natural language → CRE)
  export const QUICK_CHAT: Command = {
    id: 'intentsmith.chat.quick',
    label: 'IntentSmith: Quick Chat',
    category: 'IntentSmith',
  };
}

// ─── IntentSmith Command Descriptor ──────────────────────────────

interface IntentSmithCommandMessage {
  type: 'intentsmith_command';
  name: string;
  payload: Record<string, unknown>;
}

// ─── Contribution ────────────────────────────────────────

@injectable()
export class IntentSmithCommandPaletteContribution
  implements CommandContribution, KeybindingContribution, FrontendApplicationContribution
{

  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  /** Handler for IntentSmith structured commands (injected by backend bridge) */
  private commandHandler?: (msg: IntentSmithCommandMessage) => Promise<void>;

  /** Handler for chat messages (injected by chat panel) */
  private chatHandler?: (content: string) => Promise<void>;

  async onStart(): Promise<void> { }

  // ─── Handler Registration ──────────────────────────────

  setCommandHandler(handler: (msg: IntentSmithCommandMessage) => Promise<void>): void {
    this.commandHandler = handler;
  }

  setChatHandler(handler: (content: string) => Promise<void>): void {
    this.chatHandler = handler;
  }

  // ─── Command Registration ──────────────────────────────

  registerCommands(registry: CommandRegistry): void {

    // ── Override Theia's File → Open Folder to use IntentSmith workspace ──
    for (const cmdId of ['workspace:openFolder', 'workspace:open']) {
      try {
        registry.registerHandler(cmdId, {
          execute: () => {
            document.dispatchEvent(new CustomEvent('intentsmith-open-folder'));
          },
          isEnabled: () => true,
          isVisible: () => true,
        });
      } catch (_e) { /* command may not exist */ }
    }

    // ── Project commands (structured → bypass CRE) ─────

    registry.registerCommand(IntentSmithCommands.NEW_PROJECT, {
      execute: () => this.sendCommand('new_project'),
    });

    registry.registerCommand(IntentSmithCommands.CONTINUE_DESIGN, {
      execute: () => this.sendCommand('continue_design'),
    });

    registry.registerCommand(IntentSmithCommands.START_BUILD, {
      execute: () => this.sendCommand('start_build'),
    });

    registry.registerCommand(IntentSmithCommands.START_REVIEW, {
      execute: () => this.sendCommand('start_review'),
    });

    registry.registerCommand(IntentSmithCommands.CLOSE_PROJECT, {
      execute: async () => {
        const confirmed = await this.messageService.warn(
          'Opravdu chcete uzavřít projekt?',
          'Uzavřít',
          'Zrušit',
        );
        if (confirmed === 'Uzavřít') {
          await this.sendCommand('close_project');
        }
      },
    });

    registry.registerCommand(IntentSmithCommands.EXPORT_PROJECT, {
      execute: () => this.sendCommand('export_project'),
    });

    // ── View commands (local IDE actions) ──────────────

    registry.registerCommand(IntentSmithCommands.CLEAR_CHAT, {
      execute: () => this.sendCommand('clear_chat'),
    });

    registry.registerCommand(IntentSmithCommands.RECONNECT, {
      execute: () => this.sendCommand('reconnect'),
    });

    registry.registerCommand(IntentSmithCommands.RERUN_LAST, {
      execute: () => this.sendCommand('rerun_last'),
    });

    // ── Quick Chat Input (natural language → CRE) ──────

    registry.registerCommand(IntentSmithCommands.QUICK_CHAT, {
      execute: () => this.openQuickChatInput(),
    });
  }

  // ─── Keybindings ───────────────────────────────────────

  registerKeybindings(registry: KeybindingRegistry): void {
    // Panel focus shortcuts
    registry.registerKeybinding({
      command: IntentSmithCommands.FOCUS_CHAT.id,
      keybinding: 'ctrlcmd+shift+c',
    });
    registry.registerKeybinding({
      command: IntentSmithCommands.FOCUS_AGENT.id,
      keybinding: 'ctrlcmd+shift+a',
    });
    registry.registerKeybinding({
      command: IntentSmithCommands.FOCUS_DESIGN.id,
      keybinding: 'ctrlcmd+shift+d',
    });

    // Quick Chat Input
    registry.registerKeybinding({
      command: IntentSmithCommands.QUICK_CHAT.id,
      keybinding: 'ctrlcmd+k',
    });

    // Rerun last command
    registry.registerKeybinding({
      command: IntentSmithCommands.RERUN_LAST.id,
      keybinding: 'f5',
    });
  }

  // ─── Send Structured Command (bypasses CRE) ───────────

  private async sendCommand(
    name: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const msg: IntentSmithCommandMessage = {
      type: 'intentsmith_command',
      name,
      payload,
    };

    if (this.commandHandler) {
      await this.commandHandler(msg);
    } else {
      this.messageService.error(
        'IntentSmith backend nepřipojen. Použijte "IntentSmith: Reconnect k backendu".',
      );
    }
  }

  // ─── Quick Chat Input (natural language → CRE) ────────

  /**
   * Ctrl+K → Quick input for chat message.
   *
   * This IS a chat message that goes through CRE.
   * It's clearly labeled "💬 Napište zprávu..." to distinguish
   * from Command Palette ("Vyberte příkaz...").
   */
  private async openQuickChatInput(): Promise<void> {
    const value = await this.quickInput.input({
      placeHolder: '💬 Napište zprávu... (jde přes CRE)',
      prompt: 'Quick Chat — přirozený jazyk → CRE routing',
    });

    if (value && value.trim()) {
      if (this.chatHandler) {
        await this.chatHandler(value.trim());
      } else {
        this.messageService.error('Chat nepřipojen.');
      }
    }
  }
}
