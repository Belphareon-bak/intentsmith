/**
 * Design Immutability Guard — Marks design/*.md as read-only in editor.
 *
 * Contract:
 *   design/*.md files are READ-ONLY in the editor.
 *   Edit only via chat → C3 regenerates the file.
 *   Banner on open: "Tento soubor je generovaný C3. Upravte přes chat."
 *   Explicit unlock: "C3: Odemknout design soubory" with warning dialog.
 *
 * Prevents: user manual edit → broken project model → agent navigates
 * inconsistent state between chat context and design files.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MessageService } from '@theia/core';
import { CommandRegistry, Command } from '@theia/core';
import { DESIGN_FILE_PATTERN, DESIGN_READONLY_BANNER, UNLOCK_DESIGN_COMMAND } from '../common/design-viewer-protocol';

const UNLOCK_COMMAND: Command = {
  id: UNLOCK_DESIGN_COMMAND,
  label: 'C3: Odemknout design soubory',
  category: 'C3',
};

@injectable()
export class DesignImmutabilityGuard implements FrontendApplicationContribution {

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(CommandRegistry)
  protected readonly commandRegistry!: CommandRegistry;

  private unlocked: boolean = false;

  @postConstruct()
  protected init(): void {
    this.registerUnlockCommand();
    this.watchEditorOpen();
  }

  async onStart(): Promise<void> { }

  // ─── Watch editor opens ────────────────────────────────

  private watchEditorOpen(): void {
    this.editorManager.onCreated(widget => {
      this.checkAndGuard(widget);
    });
  }

  private checkAndGuard(widget: EditorWidget): void {
    if (this.unlocked) return;

    const uri = widget.editor.uri;
    const relativePath = this.getRelativePath(uri.toString());

    if (!relativePath || !DESIGN_FILE_PATTERN.test(relativePath)) return;

    // Make read-only
    const editor = widget.editor;
    if ('setReadOnly' in editor && typeof (editor as any).setReadOnly === 'function') {
      (editor as any).setReadOnly(true);
    }

    // Show info banner
    this.messageService.info(
      `📐 ${DESIGN_READONLY_BANNER}\n` +
      `Pro odemknutí: Ctrl+Shift+P → "C3: Odemknout design soubory"`,
    );
  }

  // ─── Unlock Command ────────────────────────────────────

  private registerUnlockCommand(): void {
    this.commandRegistry.registerCommand(UNLOCK_COMMAND, {
      execute: async () => {
        const confirmed = await this.showUnlockWarning();
        if (confirmed) {
          this.unlocked = true;
          this.messageService.warn(
            '⚠️ Design soubory odemknuty. Ruční úpravy mohou rozbít ' +
            'konzistenci projektu. Doporučujeme editovat přes chat.',
          );
        }
      },
    });
  }

  private async showUnlockWarning(): Promise<boolean> {
    const result = await this.messageService.warn(
      '⚠️ Opravdu chcete odemknout design soubory?\n\n' +
      'Ruční úpravy design/*.md mohou způsobit:\n' +
      '• Nekonzistenci mezi designem a projektem\n' +
      '• Agent bude navigovat neplatný stav\n' +
      '• project.json nebude odpovídat obsahu souborů\n\n' +
      'Doporučujeme editovat přes chat.',
      'Odemknout',
      'Zrušit',
    );
    return result === 'Odemknout';
  }

  // ─── Helpers ───────────────────────────────────────────

  /**
   * Extract relative path from URI.
   * URI format: file:///home/user/project/design/architecture.md
   * We need: design/architecture.md
   */
  private getRelativePath(uri: string): string | null {
    // Simple heuristic — look for 'design/' in path
    const match = uri.match(/(design\/[^?#]+)/);
    return match ? match[1] : null;
  }
}
