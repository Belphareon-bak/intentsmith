/**
 * @c3/error-recovery — LLM Timeout Manager (browser)
 *
 * Tracks LLM response time and provides:
 *   - Warning after warningMs (30s default): "Odpověď trvá déle..."
 *   - Timeout after timeoutMs (60s default): auto-cancel or user decides
 *   - Cancel action: aborts request, agent returns to IDLE
 *
 * Usage:
 *   const handle = llmTimeout.startTracking(turnId);
 *   // ... wait for response ...
 *   handle.resolve(); // or handle.cancel();
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger, Emitter, Event, Disposable } from '@theia/core';
import {
  LlmTimeoutConfig,
  LlmTimeoutAction,
  DEFAULT_LLM_TIMEOUT,
} from '../common/error-recovery-protocol';

export interface TimeoutHandle {
  turnId: string;
  resolve(): void;
  cancel(): void;
  readonly elapsed: number;
}

export interface TimeoutEvent {
  turnId: string;
  type: 'warning' | 'timeout';
  elapsedMs: number;
}

@injectable()
export class C3LlmTimeoutManager implements Disposable {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private config: LlmTimeoutConfig = { ...DEFAULT_LLM_TIMEOUT };
  private activeHandles = new Map<string, {
    startTime: number;
    warningTimer: ReturnType<typeof setTimeout> | null;
    timeoutTimer: ReturnType<typeof setTimeout> | null;
    resolve: () => void;
    cancel: () => void;
  }>();

  private readonly _onWarning = new Emitter<TimeoutEvent>();
  readonly onWarning: Event<TimeoutEvent> = this._onWarning.event;

  private readonly _onTimeout = new Emitter<TimeoutEvent>();
  readonly onTimeout: Event<TimeoutEvent> = this._onTimeout.event;

  private readonly _onCancelled = new Emitter<string>(); // turnId
  readonly onCancelled: Event<string> = this._onCancelled.event;

  configure(config: Partial<LlmTimeoutConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Start tracking a turn's LLM response.
   */
  startTracking(turnId: string): TimeoutHandle {
    // Clean up any existing handle for this turn
    this.stopTracking(turnId);

    const startTime = Date.now();
    let resolveOuter: () => void;
    let cancelOuter: () => void;

    const warningTimer = setTimeout(() => {
      this._onWarning.fire({
        turnId,
        type: 'warning',
        elapsedMs: Date.now() - startTime,
      });
      this.logger.warn(`LLM warning: turn ${turnId} taking > ${this.config.warningMs}ms`);
    }, this.config.warningMs);

    const timeoutTimer = setTimeout(() => {
      this._onTimeout.fire({
        turnId,
        type: 'timeout',
        elapsedMs: Date.now() - startTime,
      });
      this.logger.error(`LLM timeout: turn ${turnId} exceeded ${this.config.timeoutMs}ms`);
    }, this.config.timeoutMs);

    const handle: TimeoutHandle = {
      turnId,
      get elapsed() { return Date.now() - startTime; },
      resolve: () => {
        this.stopTracking(turnId);
      },
      cancel: () => {
        this.stopTracking(turnId);
        this._onCancelled.fire(turnId);
      },
    };

    this.activeHandles.set(turnId, {
      startTime,
      warningTimer,
      timeoutTimer,
      resolve: handle.resolve,
      cancel: handle.cancel,
    });

    return handle;
  }

  /**
   * Stop tracking (on success or cancel).
   */
  stopTracking(turnId: string): void {
    const handle = this.activeHandles.get(turnId);
    if (handle) {
      if (handle.warningTimer) clearTimeout(handle.warningTimer);
      if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
      this.activeHandles.delete(turnId);
    }
  }

  /**
   * User action: cancel or wait.
   */
  handleUserAction(turnId: string, action: LlmTimeoutAction): void {
    if (action === 'cancel') {
      const handle = this.activeHandles.get(turnId);
      if (handle) {
        handle.cancel();
      }
    }
    // 'wait' — just dismiss the UI, timers continue
  }

  get activeCount(): number {
    return this.activeHandles.size;
  }

  dispose(): void {
    for (const handle of this.activeHandles.values()) {
      if (handle.warningTimer) clearTimeout(handle.warningTimer);
      if (handle.timeoutTimer) clearTimeout(handle.timeoutTimer);
    }
    this.activeHandles.clear();
    this._onWarning.dispose();
    this._onTimeout.dispose();
    this._onCancelled.dispose();
  }
}
