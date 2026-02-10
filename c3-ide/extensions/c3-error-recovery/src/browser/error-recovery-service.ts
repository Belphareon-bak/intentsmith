/**
 * @c3/error-recovery — Reconnection, timeout handling, crash recovery.
 *
 * Backend disconnect:
 *   Backend crash → Statusbar 🔴 → Auto-reconnect (exp backoff 1/2/4/8/max 30s)
 *   → Rehydrate project → Agent log: "⚠️ Reconnected after Ns"
 *   → Chat: "(systém se znovu připojil)"
 *
 * LLM timeout:
 *   LLM > 60s → Agent log: "⏱️ LLM timeout" → Chat: "Trvá déle..."
 *   → [Cancel] aborts, agent → IDLE
 *
 * Crash recovery:
 *   IDE restart → load project.json → rehydrate
 *   → Chat history from conversation.jsonl
 *   → Agent log: "🔄 Session restored from disk"
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ILogger, Emitter, Event, Disposable } from '@theia/core';
import { MessageService } from '@theia/core';

// ─── Types ───────────────────────────────────────────────

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface ReconnectionConfig {
  initialDelayMs: number;       // 1000
  maxDelayMs: number;           // 30000
  backoffMultiplier: number;    // 2
  maxAttempts: number;          // 0 = unlimited
  jitterMs: number;             // 500 (random ± to avoid thundering herd)
}

export const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  maxAttempts: 0,
  jitterMs: 500,
};

export interface LlmTimeoutConfig {
  warningThresholdMs: number;   // 30000 — show "trvá déle" in chat
  hardTimeoutMs: number;        // 60000 — show Cancel button
  killTimeoutMs: number;        // 120000 — auto-cancel
}

export const DEFAULT_LLM_TIMEOUT_CONFIG: LlmTimeoutConfig = {
  warningThresholdMs: 30000,
  hardTimeoutMs: 60000,
  killTimeoutMs: 120000,
};

export interface RecoveryReport {
  type: 'reconnect' | 'crash_recovery';
  downtimeMs?: number;
  attempts?: number;
  projectRestored: boolean;
  chatHistoryRestored: boolean;
  pendingReview: boolean;
}

// ─── Reconnection Manager ────────────────────────────────

@injectable()
export class ReconnectionManager implements Disposable {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  private config: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG;
  private state: ConnectionState = 'disconnected';
  private currentDelay: number = 0;
  private attemptCount: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectedAt: number = 0;
  private disposed: boolean = false;

  /** Callback to actually perform WebSocket connect */
  private connectFn?: () => Promise<boolean>;

  /** Callback to rehydrate project after reconnect */
  private rehydrateFn?: () => Promise<RecoveryReport>;

  /** Callback to update statusbar */
  private statusFn?: (state: ConnectionState) => void;

  private readonly onStateChangeEmitter = new Emitter<ConnectionState>();
  readonly onStateChange: Event<ConnectionState> = this.onStateChangeEmitter.event;

  private readonly onReconnectedEmitter = new Emitter<RecoveryReport>();
  readonly onReconnected: Event<RecoveryReport> = this.onReconnectedEmitter.event;

  // ─── Configuration ─────────────────────────────────────

  configure(config: Partial<ReconnectionConfig>): void {
    this.config = { ...DEFAULT_RECONNECTION_CONFIG, ...config };
  }

  setConnectFunction(fn: () => Promise<boolean>): void {
    this.connectFn = fn;
  }

  setRehydrateFunction(fn: () => Promise<RecoveryReport>): void {
    this.rehydrateFn = fn;
  }

  setStatusFunction(fn: (state: ConnectionState) => void): void {
    this.statusFn = fn;
  }

  // ─── State Management ──────────────────────────────────

  notifyConnected(): void {
    if (this.state === 'reconnecting') {
      const downtimeMs = Date.now() - this.disconnectedAt;
      this.logger.info(`Reconnected after ${(downtimeMs / 1000).toFixed(1)}s (${this.attemptCount} attempts)`);
    }

    this.setState('connected');
    this.resetBackoff();
  }

  notifyDisconnected(): void {
    if (this.state === 'connected') {
      this.disconnectedAt = Date.now();
      this.logger.warn('Backend connection lost');
    }

    this.setState('disconnected');
    this.startReconnection();
  }

  // ─── Reconnection Loop ────────────────────────────────

  private startReconnection(): void {
    if (this.disposed) return;
    if (!this.connectFn) {
      this.logger.error('No connect function set, cannot reconnect');
      return;
    }

    this.setState('reconnecting');
    this.scheduleAttempt();
  }

  private scheduleAttempt(): void {
    if (this.disposed) return;

    // Calculate delay with jitter
    const delay = this.currentDelay === 0
      ? 0 // First attempt is immediate
      : this.currentDelay + (Math.random() * 2 - 1) * this.config.jitterMs;

    this.reconnectTimer = setTimeout(() => this.attempt(), Math.max(0, delay));

    // Advance backoff for next attempt
    if (this.currentDelay === 0) {
      this.currentDelay = this.config.initialDelayMs;
    } else {
      this.currentDelay = Math.min(
        this.currentDelay * this.config.backoffMultiplier,
        this.config.maxDelayMs,
      );
    }
  }

  private async attempt(): Promise<void> {
    if (this.disposed) return;

    this.attemptCount++;
    this.logger.info(`Reconnection attempt ${this.attemptCount} (delay: ${(this.currentDelay / 1000).toFixed(1)}s)`);

    try {
      const success = this.connectFn ? await this.connectFn() : false;

      if (success) {
        this.setState('connected');
        const downtimeMs = Date.now() - this.disconnectedAt;

        // Rehydrate project
        let report: RecoveryReport = {
          type: 'reconnect',
          downtimeMs,
          attempts: this.attemptCount,
          projectRestored: false,
          chatHistoryRestored: false,
          pendingReview: false,
        };

        if (this.rehydrateFn) {
          try {
            report = await this.rehydrateFn();
            report.type = 'reconnect';
            report.downtimeMs = downtimeMs;
            report.attempts = this.attemptCount;
          } catch (err: any) {
            this.logger.error(`Rehydration failed: ${err.message}`);
          }
        }

        this.resetBackoff();
        this.onReconnectedEmitter.fire(report);
        return;
      }
    } catch (err: any) {
      this.logger.warn(`Reconnection attempt ${this.attemptCount} failed: ${err.message}`);
    }

    // Check max attempts
    if (this.config.maxAttempts > 0 && this.attemptCount >= this.config.maxAttempts) {
      this.logger.error(`Max reconnection attempts (${this.config.maxAttempts}) reached`);
      this.setState('disconnected');
      this.messageService.error(
        '❌ Nepodařilo se připojit k backendu. Zkontrolujte, zda backend běží, a zkuste "C3: Reconnect".',
      );
      return;
    }

    // Schedule next attempt
    this.scheduleAttempt();
  }

  private resetBackoff(): void {
    this.currentDelay = 0;
    this.attemptCount = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.statusFn?.(state);
    this.onStateChangeEmitter.fire(state);
  }

  getState(): ConnectionState { return this.state; }
  getAttemptCount(): number { return this.attemptCount; }

  dispose(): void {
    this.disposed = true;
    this.resetBackoff();
    this.onStateChangeEmitter.dispose();
    this.onReconnectedEmitter.dispose();
  }
}

// ─── LLM Timeout Manager ────────────────────────────────

@injectable()
export class LlmTimeoutManager implements Disposable {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private config: LlmTimeoutConfig = DEFAULT_LLM_TIMEOUT_CONFIG;
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private hardTimer: ReturnType<typeof setTimeout> | null = null;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTurnId: string | null = null;
  private startedAt: number = 0;
  private disposed: boolean = false;

  /** Callback to show warning in chat */
  private onWarningFn?: (turnId: string, elapsedMs: number) => void;
  /** Callback to show cancel button */
  private onHardTimeoutFn?: (turnId: string, elapsedMs: number) => void;
  /** Callback to auto-cancel */
  private onKillFn?: (turnId: string, elapsedMs: number) => void;

  configure(config: Partial<LlmTimeoutConfig>): void {
    this.config = { ...DEFAULT_LLM_TIMEOUT_CONFIG, ...config };
  }

  setCallbacks(cbs: {
    onWarning?: (turnId: string, elapsedMs: number) => void;
    onHardTimeout?: (turnId: string, elapsedMs: number) => void;
    onKill?: (turnId: string, elapsedMs: number) => void;
  }): void {
    this.onWarningFn = cbs.onWarning;
    this.onHardTimeoutFn = cbs.onHardTimeout;
    this.onKillFn = cbs.onKill;
  }

  /**
   * Start tracking a new LLM request.
   */
  startTracking(turnId: string): void {
    this.clear();
    this.activeTurnId = turnId;
    this.startedAt = Date.now();

    this.warningTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) {
        this.onWarningFn?.(turnId, Date.now() - this.startedAt);
      }
    }, this.config.warningThresholdMs);

    this.hardTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) {
        this.onHardTimeoutFn?.(turnId, Date.now() - this.startedAt);
      }
    }, this.config.hardTimeoutMs);

    this.killTimer = setTimeout(() => {
      if (this.activeTurnId === turnId) {
        this.logger.warn(`LLM auto-killed after ${this.config.killTimeoutMs}ms`);
        this.onKillFn?.(turnId, Date.now() - this.startedAt);
        this.clear();
      }
    }, this.config.killTimeoutMs);
  }

  /**
   * LLM responded — cancel all timers.
   */
  stopTracking(): void {
    this.clear();
  }

  getElapsedMs(): number {
    return this.startedAt > 0 ? Date.now() - this.startedAt : 0;
  }

  isTracking(): boolean {
    return this.activeTurnId !== null;
  }

  private clear(): void {
    if (this.warningTimer) { clearTimeout(this.warningTimer); this.warningTimer = null; }
    if (this.hardTimer) { clearTimeout(this.hardTimer); this.hardTimer = null; }
    if (this.killTimer) { clearTimeout(this.killTimer); this.killTimer = null; }
    this.activeTurnId = null;
    this.startedAt = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}

// ─── Crash Recovery Service ──────────────────────────────

@injectable()
export class CrashRecoveryService {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(MessageService)
  protected readonly messageService!: MessageService;

  /** Callback to load project.json */
  private loadProjectFn?: (projectPath: string) => Promise<any>;
  /** Callback to load chat history */
  private loadChatHistoryFn?: (chatDir: string) => Promise<any[]>;
  /** Callback to check pending review */
  private checkPendingReviewFn?: (projectPath: string) => Promise<boolean>;

  setLoaders(loaders: {
    loadProject?: (projectPath: string) => Promise<any>;
    loadChatHistory?: (chatDir: string) => Promise<any[]>;
    checkPendingReview?: (projectPath: string) => Promise<boolean>;
  }): void {
    this.loadProjectFn = loaders.loadProject;
    this.loadChatHistoryFn = loaders.loadChatHistory;
    this.checkPendingReviewFn = loaders.checkPendingReview;
  }

  /**
   * Attempt full recovery on IDE startup.
   * Reads project.json, chat history, pending review state.
   */
  async recover(projectPath: string): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      type: 'crash_recovery',
      projectRestored: false,
      chatHistoryRestored: false,
      pendingReview: false,
    };

    // 1. Load project
    if (this.loadProjectFn) {
      try {
        const project = await this.loadProjectFn(projectPath);
        report.projectRestored = !!project;
        if (project) {
          this.logger.info(`Project restored: ${project.name} (phase: ${project.phase})`);
        }
      } catch (err: any) {
        this.logger.error(`Project recovery failed: ${err.message}`);
      }
    }

    // 2. Load chat history
    if (this.loadChatHistoryFn) {
      try {
        const chatDir = require('path').join(projectPath, 'chat');
        const history = await this.loadChatHistoryFn(chatDir);
        report.chatHistoryRestored = history.length > 0;
        if (history.length > 0) {
          this.logger.info(`Chat history restored: ${history.length} messages`);
        }
      } catch (err: any) {
        this.logger.warn(`Chat history recovery failed: ${err.message}`);
      }
    }

    // 3. Check pending review
    if (this.checkPendingReviewFn) {
      try {
        report.pendingReview = await this.checkPendingReviewFn(projectPath);
        if (report.pendingReview) {
          this.logger.info('Pending review found — Review Panel will auto-open');
        }
      } catch {
        // Not critical
      }
    }

    // Notify user
    if (report.projectRestored) {
      this.messageService.info('🔄 Session obnovena z disku.');
    }

    return report;
  }
}
