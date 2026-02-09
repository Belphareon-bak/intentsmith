/**
 * @c3/multi-project — Project Switcher Contribution (browser)
 *
 * Registers:
 *   - "C3: Přepnout projekt" command (Ctrl+Shift+W)
 *   - "C3: Nový projekt" quick-create
 *   - QuickPick with project list, phase icons, active marker
 *
 * QuickPick layout:
 *   📐 Mobilní aplikace (DESIGN, krok 12) ← aktivní
 *   🔨 E-shop backend (BUILD, sprint 3)
 *   💬 Bez projektu (volná konverzace)
 *   ─────────────────────────────────────
 *   + Nový projekt...
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
  CommandContribution,
  CommandRegistry,
  Command,
} from '@theia/core';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import {
  C3MultiProject,
  ProjectEntry,
  PHASE_ICONS,
  PHASE_LABELS,
} from '../common/multi-project-protocol';

export const C3SwitchProjectCommand: Command = {
  id: 'c3.project.switch',
  label: 'C3: Přepnout projekt',
  category: 'C3',
};

export const C3NewProjectCommand: Command = {
  id: 'c3.project.new',
  label: 'C3: Nový projekt',
  category: 'C3',
};

@injectable()
export class C3ProjectSwitcherContribution
  implements CommandContribution, KeybindingContribution
{
  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(C3MultiProject)
  protected readonly multiProject!: C3MultiProject;

  private workspacePath: string = '';

  /** Called by application startup to set workspace root */
  setWorkspacePath(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  /** Callback invoked when project changes */
  private onSwitchCallback?: (project: ProjectEntry | null) => Promise<void>;

  setOnSwitch(callback: (project: ProjectEntry | null) => Promise<void>): void {
    this.onSwitchCallback = callback;
  }

  // ─── Command Registration ──────────────────────────────

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(C3SwitchProjectCommand, {
      execute: () => this.showProjectPicker(),
    });

    commands.registerCommand(C3NewProjectCommand, {
      execute: () => this.showNewProjectDialog(),
    });
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: C3SwitchProjectCommand.id,
      keybinding: 'ctrlcmd+shift+w',
    });
  }

  // ─── Project Picker ────────────────────────────────────

  async showProjectPicker(): Promise<void> {
    if (!this.workspacePath) {
      this.messageService.warn('Workspace není nastaven');
      return;
    }

    const workspace = await this.multiProject.scanWorkspace(this.workspacePath);
    const items: QuickPickItem[] = [];

    // Project entries
    for (const project of workspace.projects) {
      const isActive = project.slug === workspace.activeProjectSlug;
      const icon = PHASE_ICONS[project.phase] || '💤';
      const phaseLabel = PHASE_LABELS[project.phase] || project.phase;
      const stepInfo = project.currentSprint > 0
        ? `sprint ${project.currentSprint}`
        : `krok ${project.currentStep}`;

      items.push({
        label: `${icon} ${project.name}`,
        description: `${phaseLabel}, ${stepInfo}${isActive ? ' ← aktivní' : ''}`,
        detail: project.path,
        id: project.slug,
      });
    }

    // "No project" option
    items.push({
      label: `${PHASE_ICONS.none} Bez projektu`,
      description: 'volná konverzace',
      id: '__none__',
    });

    // Separator + new project
    items.push({
      label: '$(add) Nový projekt...',
      id: '__new__',
      type: 'separator',
    });

    const selected = await this.quickInput.showQuickPick(items, {
      placeholder: 'Vyberte projekt...',
    });

    if (!selected) return;

    const id = (selected as any).id;

    if (id === '__new__') {
      await this.showNewProjectDialog();
      return;
    }

    const slug = id === '__none__' ? null : id;
    const project = await this.multiProject.switchProject(this.workspacePath, slug);

    if (this.onSwitchCallback) {
      await this.onSwitchCallback(project);
    }

    if (project) {
      this.messageService.info(
        `${PHASE_ICONS[project.phase]} Přepnuto na: ${project.name} (${PHASE_LABELS[project.phase]})`,
      );
    } else {
      this.messageService.info('💬 Režim volné konverzace');
    }
  }

  // ─── New Project Dialog ────────────────────────────────

  async showNewProjectDialog(): Promise<void> {
    const name = await this.quickInput.input({
      prompt: 'Název nového projektu',
      placeHolder: 'např. Mobilní aplikace, E-shop backend...',
      validateInput: (value: string) => {
        if (!value.trim()) return 'Název je povinný';
        if (value.length > 100) return 'Max 100 znaků';
        return undefined;
      },
    });

    if (!name) return;

    try {
      const project = await this.multiProject.createProject(
        this.workspacePath,
        name.trim(),
      );

      // Auto-switch to new project
      await this.multiProject.switchProject(this.workspacePath, project.slug);

      if (this.onSwitchCallback) {
        await this.onSwitchCallback(project);
      }

      this.messageService.info(
        `📐 Vytvořen a aktivován: ${project.name}`,
      );
    } catch (err: any) {
      this.messageService.error(`Chyba: ${err.message}`);
    }
  }
}
