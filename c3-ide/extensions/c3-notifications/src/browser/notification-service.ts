/**
 * @c3/notifications — Agent event notification system
 *
 * Subscribes to backend bridge agent events and shows notifications:
 *   - Agent completed task → toast
 *   - Agent error → persistent notification with "Zobrazit log"
 *   - Build success/failure → color-coded toast
 *   - Shell execution blocked → warning with reason
 *
 * Notification rules:
 *   - turn_end(ok) → info toast (auto-dismiss 5s)
 *   - turn_end(error) → persistent error with link to agent log
 *   - turn_end(cancelled) → info toast (auto-dismiss 3s)
 *   - shell_blocked → warning (auto-dismiss 8s)
 *   - gate_verdict(fail) → warning with details
 *   - phase_change → info toast
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { CommandRegistry } from '@theia/core';

/** Agent event (subset matching Sprint 1 protocol) */
interface AgentEvent {
  type: string;
  turnId: string;
  payload: Record<string, unknown>;
}

/** Notification config per event type */
interface NotificationRule {
  condition: (event: AgentEvent) => boolean;
  level: 'info' | 'warn' | 'error';
  message: (event: AgentEvent) => string;
  persistent: boolean;
  showLogAction: boolean;
}

@injectable()
export class C3NotificationService implements FrontendApplicationContribution {

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  @inject(CommandRegistry)
  protected readonly commandRegistry!: CommandRegistry;

  // ─── Notification Rules ────────────────────────────────

  private readonly rules: NotificationRule[] = [
    // Turn completed successfully
    {
      condition: (e) => e.type === 'turn_end' && e.payload.status === 'ok',
      level: 'info',
      message: (e) => {
        const duration = e.payload.durationMs as number;
        const sec = duration ? ` (${(duration / 1000).toFixed(1)}s)` : '';
        return `✅ Agent dokončil úkol${sec}`;
      },
      persistent: false,
      showLogAction: false,
    },

    // Turn cancelled
    {
      condition: (e) => e.type === 'turn_end' && e.payload.status === 'cancelled_by_user',
      level: 'info',
      message: () => '🚫 Operace zrušena',
      persistent: false,
      showLogAction: false,
    },

    // Turn error
    {
      condition: (e) => e.type === 'turn_end' && e.payload.status === 'error',
      level: 'error',
      message: (e) => {
        const err = e.payload.error as string || 'Neznámá chyba';
        return `❌ Agent narazil na chybu: ${err}`;
      },
      persistent: true,
      showLogAction: true,
    },

    // Turn timeout
    {
      condition: (e) => e.type === 'turn_end' && e.payload.status === 'timeout',
      level: 'warn',
      message: () => '⏰ Operace překročila časový limit',
      persistent: true,
      showLogAction: true,
    },

    // Shell execution blocked
    {
      condition: (e) => e.type === 'shell_blocked',
      level: 'warn',
      message: (e) => {
        const cmd = e.payload.command as string || '';
        const reason = e.payload.reason as string || '';
        return `🛡️ Shell blokován: ${cmd} — ${reason}`;
      },
      persistent: false,
      showLogAction: true,
    },

    // Gate verdict with failures
    {
      condition: (e) => {
        if (e.type !== 'gate_verdict') return false;
        const p = e.payload as Record<string, string>;
        return Object.values(p).some(v => v === 'fail' || v === 'suspicious');
      },
      level: 'warn',
      message: (e) => {
        const p = e.payload as Record<string, string>;
        const failures = Object.entries(p)
          .filter(([_, v]) => v === 'fail' || v === 'suspicious')
          .map(([k]) => k);
        return `⚠️ Gate check: ${failures.join(', ')} — výstup možná potřebuje review`;
      },
      persistent: false,
      showLogAction: true,
    },

    // CRE decision with low confidence
    {
      condition: (e) =>
        e.type === 'cre_decision' &&
        typeof e.payload.confidence === 'number' &&
        (e.payload.confidence as number) < 0.6,
      level: 'info',
      message: (e) => {
        const intent = e.payload.intent as string || '?';
        const conf = ((e.payload.confidence as number) * 100).toFixed(0);
        return `🤔 CRE → ${intent} (confidence: ${conf}%)`;
      },
      persistent: false,
      showLogAction: false,
    },

    // Error events
    {
      condition: (e) => e.type === 'error' && !(e.payload.recoverable),
      level: 'error',
      message: (e) => {
        const code = e.payload.code as string || '';
        const msg = e.payload.message as string || 'Chyba';
        return `❌ [${code}] ${msg}`;
      },
      persistent: true,
      showLogAction: true,
    },

    // Status change to disconnected
    {
      condition: (e) => e.type === 'status_change' && e.payload.to === 'disconnected',
      level: 'warn',
      message: () => '🔴 Spojení s backendem ztraceno',
      persistent: true,
      showLogAction: false,
    },
  ];

  @postConstruct()
  protected init(): void { }

  async onStart(): Promise<void> { }

  // ─── Public API ────────────────────────────────────────

  /**
   * Process an agent event and show notification if rules match.
   * Called by backend bridge proxy when events arrive.
   */
  handleAgentEvent(event: AgentEvent): void {
    for (const rule of this.rules) {
      if (rule.condition(event)) {
        this.showNotification(rule, event);
        break; // First matching rule wins
      }
    }
  }

  /**
   * Show a phase change notification.
   */
  notifyPhaseChange(oldPhase: string, newPhase: string, projectName: string): void {
    const phaseLabels: Record<string, string> = {
      design: '📐 DESIGN',
      build: '🔨 BUILD',
      pending_review: '🔍 REVIEW',
      review: '🔍 REVIEW',
      idle: '💬 CHAT',
    };

    const from = phaseLabels[oldPhase] || oldPhase;
    const to = phaseLabels[newPhase] || newPhase;

    this.messageService.info(
      `${projectName}: ${from} → ${to}`,
    );
  }

  /**
   * Show a build result notification.
   */
  notifyBuildResult(success: boolean, details?: string): void {
    if (success) {
      this.messageService.info(
        `🟢 Build úspěšný${details ? ': ' + details : ''}`,
      );
    } else {
      this.messageService.error(
        `🔴 Build selhal${details ? ': ' + details : ''}`,
        'Zobrazit log',
      ).then(action => {
        if (action === 'Zobrazit log') {
          this.commandRegistry.executeCommand('c3.agent-log.toggle');
        }
      });
    }
  }

  // ─── Private ───────────────────────────────────────────

  private showNotification(rule: NotificationRule, event: AgentEvent): void {
    const message = rule.message(event);

    if (rule.showLogAction) {
      // Show with action button
      const method = rule.level === 'error'
        ? this.messageService.error.bind(this.messageService)
        : rule.level === 'warn'
        ? this.messageService.warn.bind(this.messageService)
        : this.messageService.info.bind(this.messageService);

      method(message, 'Zobrazit log').then((action: string | undefined) => {
        if (action === 'Zobrazit log') {
          this.commandRegistry.executeCommand('c3.agent-log.toggle');
        }
      });
    } else {
      // Simple notification
      switch (rule.level) {
        case 'error':
          this.messageService.error(message);
          break;
        case 'warn':
          this.messageService.warn(message);
          break;
        default:
          this.messageService.info(message);
      }
    }
  }
}
