/**
 * @c3/command-palette — C3-specific commands registered with Theia's Command Palette
 *
 * UX INVARIANT:
 *   Command Palette = ALWAYS structured command → direct handler (BYPASSES CRE)
 *   Chat Input      = ALWAYS natural language  → CRE routing
 *
 * Commands send { type: 'c3_command', name: '...', payload: {...} }
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

// ─── C3 Command Definitions ─────────────────────────────

export namespace C3Commands {
  // Project commands
  export const NEW_PROJECT: Command = {
    id: 'c3.project.new',
    label: 'C3: Nový projekt',
    category: 'C3',
  };
  export const CONTINUE_DESIGN: Command = {
    id: 'c3.design.continue',
    label: 'C3: Pokračovat v návrhu',
    category: 'C3',
  };
  export const SHOW_DESIGN: Command = {
    id: 'c3.design.show',
    label: 'C3: Zobrazit design',
    category: 'C3',
  };
  export const START_BUILD: Command = {
    id: 'c3.build.start',
    label: 'C3: Spustit build',
    category: 'C3',
  };
  export const START_REVIEW: Command = {
    id: 'c3.review.start',
    label: 'C3: Code review',
    category: 'C3',
  };
  export const CLOSE_PROJECT: Command = {
    id: 'c3.project.close',
    label: 'C3: Uzavřít projekt',
    category: 'C3',
  };
  export const EXPORT_PROJECT: Command = {
    id: 'c3.project.export',
    label: 'C3: Exportovat projekt',
    category: 'C3',
  };

  // View commands
  export const SHOW_HISTORY: Command = {
    id: 'c3.history.show',
    label: 'C3: Zobrazit historii',
    category: 'C3',
  };
  export const SHOW_AGENT_LOG: Command = {
    id: 'c3.agent-log.toggle',
    label: 'C3: Zobrazit Agent Log',
    category: 'C3',
  };
  export const FOCUS_CHAT: Command = {
    id: 'c3.chat.focus',
    label: 'C3: Focus Chat',
    category: 'C3',
  };
  export const FOCUS_AGENT: Command = {
    id: 'c3.agent-log.focus',
    label: 'C3: Focus Agent Log',
    category: 'C3',
  };
  export const FOCUS_DESIGN: Command = {
    id: 'c3.design.focus',
    label: 'C3: Focus Design Viewer',
    category: 'C3',
  };

  // Action commands
  export const CLEAR_CHAT: Command = {
    id: 'c3.chat.clear',
    label: 'C3: Vyčistit chat',
    category: 'C3',
  };
  export const RECONNECT: Command = {
    id: 'c3.backend.reconnect',
    label: 'C3: Reconnect k backendu',
    category: 'C3',
  };
  export const RERUN_LAST: Command = {
    id: 'c3.agent.rerun',
    label: 'C3: Znovu spustit poslední příkaz',
    category: 'C3',
  };

  // Quick Chat Input (this one IS for natural language → CRE)
  export const QUICK_CHAT: Command = {
    id: 'c3.chat.quick',
    label: 'C3: Quick Chat',
    category: 'C3',
  };
}

// ─── C3 Command Descriptor ──────────────────────────────

interface C3CommandMessage {
  type: 'c3_command';
  name: string;
  payload: Record<string, unknown>;
}

// ─── Contribution ────────────────────────────────────────

@injectable()
export class C3CommandPaletteContribution
  implements CommandContribution, KeybindingContribution, FrontendApplicationContribution
{

  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  /** Handler for C3 structured commands (injected by backend bridge) */
  private commandHandler?: (msg: C3CommandMessage) => Promise<void>;

  /** Handler for chat messages (injected by chat panel) */
  private chatHandler?: (content: string) => Promise<void>;

  async onStart(): Promise<void> { }

  // ─── Handler Registration ──────────────────────────────

  setCommandHandler(handler: (msg: C3CommandMessage) => Promise<void>): void {
    this.commandHandler = handler;
  }

  setChatHandler(handler: (content: string) => Promise<void>): void {
    this.chatHandler = handler;
  }

  // ─── Command Registration ──────────────────────────────

  registerCommands(registry: CommandRegistry): void {

    // ── Override Theia's File → Open Folder to use C3 workspace ──
    for (const cmdId of ['workspace:openFolder', 'workspace:open']) {
      try {
        registry.registerHandler(cmdId, {
          execute: () => {
            document.dispatchEvent(new CustomEvent('c3-open-folder'));
          },
          isEnabled: () => true,
          isVisible: () => true,
        });
      } catch (_e) { /* command may not exist */ }
    }

    // ── Project commands (structured → bypass CRE) ─────

    registry.registerCommand(C3Commands.NEW_PROJECT, {
      execute: () => this.sendCommand('new_project'),
    });

    registry.registerCommand(C3Commands.CONTINUE_DESIGN, {
      execute: () => this.sendCommand('continue_design'),
    });

    registry.registerCommand(C3Commands.START_BUILD, {
      execute: () => this.sendCommand('start_build'),
    });

    registry.registerCommand(C3Commands.START_REVIEW, {
      execute: () => this.sendCommand('start_review'),
    });

    registry.registerCommand(C3Commands.CLOSE_PROJECT, {
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

    registry.registerCommand(C3Commands.EXPORT_PROJECT, {
      execute: () => this.sendCommand('export_project'),
    });

    // ── View commands (local IDE actions) ──────────────

    registry.registerCommand(C3Commands.CLEAR_CHAT, {
      execute: () => this.sendCommand('clear_chat'),
    });

    registry.registerCommand(C3Commands.RECONNECT, {
      execute: () => this.sendCommand('reconnect'),
    });

    registry.registerCommand(C3Commands.RERUN_LAST, {
      execute: () => this.sendCommand('rerun_last'),
    });

    // ── Quick Chat Input (natural language → CRE) ──────

    registry.registerCommand(C3Commands.QUICK_CHAT, {
      execute: () => this.openQuickChatInput(),
    });
  }

  // ─── Keybindings ───────────────────────────────────────

  registerKeybindings(registry: KeybindingRegistry): void {
    // Panel focus shortcuts
    registry.registerKeybinding({
      command: C3Commands.FOCUS_CHAT.id,
      keybinding: 'ctrlcmd+shift+c',
    });
    registry.registerKeybinding({
      command: C3Commands.FOCUS_AGENT.id,
      keybinding: 'ctrlcmd+shift+a',
    });
    registry.registerKeybinding({
      command: C3Commands.FOCUS_DESIGN.id,
      keybinding: 'ctrlcmd+shift+d',
    });

    // Quick Chat Input
    registry.registerKeybinding({
      command: C3Commands.QUICK_CHAT.id,
      keybinding: 'ctrlcmd+k',
    });

    // Rerun last command
    registry.registerKeybinding({
      command: C3Commands.RERUN_LAST.id,
      keybinding: 'f5',
    });
  }

  // ─── Send Structured Command (bypasses CRE) ───────────

  private async sendCommand(
    name: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const msg: C3CommandMessage = {
      type: 'c3_command',
      name,
      payload,
    };

    if (this.commandHandler) {
      await this.commandHandler(msg);
    } else {
      this.messageService.error(
        'C3 backend nepřipojen. Použijte "C3: Reconnect k backendu".',
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
