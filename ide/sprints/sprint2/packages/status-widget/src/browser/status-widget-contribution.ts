/**
 * C3 Status Widget — Theia StatusBar contribution
 *
 * Displays in bottom statusbar:
 *   🟢 C3 Connected │ 📐 DESIGN (krok 12/?) │ 📱 Mobilní app
 *
 * Clicking opens quick pick menu with project actions.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  StatusBar,
  StatusBarAlignment,
  StatusBarEntry,
} from '@theia/core/lib/browser';
import { CommandRegistry, Command } from '@theia/core';
import { QuickInputService } from '@theia/core/lib/browser';

import './styles/status-widget.css';

// Using inline status items (Theia's StatusBar API, not a React widget)

const STATUS_CONNECTION_ID = 'c3.status.connection';
const STATUS_PHASE_ID = 'c3.status.phase';
const STATUS_PROJECT_ID = 'c3.status.project';

const PHASE_ICONS: Record<string, string> = {
  design: '📐',
  build: '🔨',
  pending_review: '🔍',
  review: '🔍',
  apply: '✅',
  idle: '💬',
};

const PHASE_LABELS: Record<string, string> = {
  design: 'DESIGN',
  build: 'BUILD',
  pending_review: 'REVIEW',
  review: 'REVIEW',
  apply: 'APPLY',
  idle: 'CHAT',
};

export const C3StatusQuickPickCommand: Command = {
  id: 'c3.status.quickpick',
  label: 'C3: Akce projektu',
};

@injectable()
export class C3StatusWidgetContribution implements FrontendApplicationContribution {

  @inject(StatusBar)
  protected readonly statusBar!: StatusBar;

  @inject(CommandRegistry)
  protected readonly commandRegistry!: CommandRegistry;

  @inject(QuickInputService)
  protected readonly quickInput!: QuickInputService;

  // State (updated from backend events)
  private connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private phase: string = 'idle';
  private projectName: string = '';
  private step: number = 0;
  private totalSteps: number = 0;

  @postConstruct()
  protected init(): void {
    this.registerCommands();
    this.updateStatusBar();
  }

  async onStart(): Promise<void> {
    // Initial render
    this.updateStatusBar();
  }

  // ─── State Updates (called from backend bridge) ────────

  setConnectionState(state: 'connected' | 'disconnected' | 'reconnecting'): void {
    this.connectionState = state;
    this.updateStatusBar();
  }

  setProjectState(phase: string, name: string, step?: number, totalSteps?: number): void {
    this.phase = phase;
    this.projectName = name;
    this.step = step || 0;
    this.totalSteps = totalSteps || 0;
    this.updateStatusBar();
  }

  clearProject(): void {
    this.phase = 'idle';
    this.projectName = '';
    this.step = 0;
    this.totalSteps = 0;
    this.updateStatusBar();
  }

  // ─── StatusBar Rendering ───────────────────────────────

  private updateStatusBar(): void {
    // Connection status
    const connIcon = this.connectionState === 'connected' ? '🟢' :
      this.connectionState === 'reconnecting' ? '🟡' : '🔴';
    const connLabel = this.connectionState === 'connected' ? 'C3' :
      this.connectionState === 'reconnecting' ? 'Reconnecting' : 'Offline';

    this.statusBar.setElement(STATUS_CONNECTION_ID, {
      text: `${connIcon} ${connLabel}`,
      alignment: StatusBarAlignment.LEFT,
      priority: 1000,
      command: C3StatusQuickPickCommand.id,
      tooltip: `C3 Backend: ${this.connectionState}`,
    });

    // Phase (only if project active)
    if (this.projectName) {
      const icon = PHASE_ICONS[this.phase] || '💬';
      const label = PHASE_LABELS[this.phase] || this.phase.toUpperCase();
      const stepInfo = this.step > 0
        ? ` (krok ${this.step}${this.totalSteps > 0 ? `/${this.totalSteps}` : '/?'})`
        : '';

      this.statusBar.setElement(STATUS_PHASE_ID, {
        text: `${icon} ${label}${stepInfo}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 999,
        command: C3StatusQuickPickCommand.id,
        tooltip: `Fáze: ${label}${stepInfo}`,
      });

      // Project name
      const truncatedName = this.projectName.length > 20
        ? this.projectName.slice(0, 19) + '…'
        : this.projectName;

      this.statusBar.setElement(STATUS_PROJECT_ID, {
        text: `📱 ${truncatedName}`,
        alignment: StatusBarAlignment.LEFT,
        priority: 998,
        command: C3StatusQuickPickCommand.id,
        tooltip: `Projekt: ${this.projectName}`,
      });
    } else {
      // Remove phase and project when no active project
      this.statusBar.removeElement(STATUS_PHASE_ID);
      this.statusBar.removeElement(STATUS_PROJECT_ID);
    }
  }

  // ─── Quick Pick Menu ───────────────────────────────────

  private registerCommands(): void {
    this.commandRegistry.registerCommand(C3StatusQuickPickCommand, {
      execute: () => this.showQuickPick(),
    });
  }

  private async showQuickPick(): Promise<void> {
    const items = [];

    if (this.projectName) {
      items.push(
        { label: '$(play) Pokračovat v návrhu', description: 'Resume DESIGN phase' },
        { label: '$(eye) Zobrazit projekt', description: 'Open Design Viewer' },
        { label: '$(export) Exportovat projekt', description: 'Export as ZIP' },
        { label: '$(close) Uzavřít projekt', description: 'Close project' },
      );
    } else {
      items.push(
        { label: '$(add) Nový projekt', description: 'Start new C3 project' },
      );
    }

    items.push(
      { label: '$(debug-disconnect) Reconnect', description: 'Znovu připojit k backendu' },
      { label: '$(history) Agent Log', description: 'Zobrazit agent log' },
    );

    const selected = await this.quickInput.showQuickPick(
      items.map(i => ({ label: i.label, description: i.description })),
      { placeholder: 'C3 — vyberte akci' },
    );

    if (selected) {
      // Dispatch to appropriate command
      const label = selected.label;
      if (label.includes('Nový')) {
        this.commandRegistry.executeCommand('c3.project.new');
      } else if (label.includes('Pokračovat')) {
        this.commandRegistry.executeCommand('c3.design.continue');
      } else if (label.includes('Zobrazit')) {
        this.commandRegistry.executeCommand('c3.design.show');
      } else if (label.includes('Exportovat')) {
        this.commandRegistry.executeCommand('c3.project.export');
      } else if (label.includes('Uzavřít')) {
        this.commandRegistry.executeCommand('c3.project.close');
      } else if (label.includes('Reconnect')) {
        this.commandRegistry.executeCommand('c3.backend.reconnect');
      } else if (label.includes('Agent')) {
        this.commandRegistry.executeCommand('c3.agent-log.toggle');
      }
    }
  }
}
