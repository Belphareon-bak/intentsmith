/**
 * @c3/error-recovery — Reconnection Manager (browser)
 *
 * Handles WebSocket reconnection with exponential backoff + jitter.
 *
 * State machine:
 *   connected ──[ws close]──→ disconnected
 *   disconnected ──[auto]──→ reconnecting
 *   reconnecting ──[success]──→ connected
 *   reconnecting ──[fail, retries left]──→ reconnecting (next delay)
 *   reconnecting ──[fail, no retries]──→ failed
 *   failed ──[manual reconnect]──→ reconnecting
 *
 * Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (max)
 * Jitter: ±10% to prevent thundering herd
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger, Emitter, Event, Disposable } from '@theia/core';
import {
  ConnectionState,
  ReconnectConfig,
  ReconnectStatus,
  DEFAULT_RECONNECT_CONFIG,
} from '../common/error-recovery-protocol';

@injectable()
export class C3ReconnectionManager implements Disposable {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  // ─── State ─────────────────────────────────────────────

  private _state: ConnectionState = 'disconnected';
  private _attempt = 0;
  private _disconnectedAt = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _config: ReconnectConfig = { ...DEFAULT_RECONNECT_CONFIG };
  private _connectFn?: () => Promise<boolean>;

  // ─── Events ────────────────────────────────────────────

  private readonly _onStatusChanged = new Emitter<ReconnectStatus>();
  readonly onStatusChanged: Event<ReconnectStatus> = this._onStatusChanged.event;

  private readonly _onReconnected = new Emitter<{ downtimeMs: number }>();
  readonly onReconnected: Event<{ downtimeMs: number }> = this._onReconnected.event;

  // ─── Configuration ─────────────────────────────────────

  configure(config: Partial<ReconnectConfig>): void {
    Object.assign(this._config, config);
  }

  /**
   * Set the function that attempts reconnection.
   * Must return true on success, false on failure.
   */
  setConnectFunction(fn: () => Promise<boolean>): void {
    this._connectFn = fn;
  }

  // ─── State Transitions ─────────────────────────────────

  get state(): ConnectionState {
    return this._state;
  }

  get status(): ReconnectStatus {
    return {
      state: this._state,
      attempt: this._attempt,
      nextRetryMs: this.calculateDelay(this._attempt),
      totalDowntimeMs: this._disconnectedAt > 0
        ? Date.now() - this._disconnectedAt
        : 0,
    };
  }

  /**
   * Called when connection is established.
   */
  markConnected(): void {
    const wasDisconnected = this._state !== 'connected';
    const downtimeMs = this._disconnectedAt > 0
      ? Date.now() - this._disconnectedAt
      : 0;

    this._state = 'connected';
    this._attempt = 0;
    this.clearTimer();

    if (wasDisconnected && downtimeMs > 0) {
      this.logger.info(`Reconnected after ${downtimeMs}ms downtime`);
      this._onReconnected.fire({ downtimeMs });
    }

    this._disconnectedAt = 0;
    this.fireStatus();
  }

  /**
   * Called when connection is lost.
   * Starts automatic reconnection.
   */
  markDisconnected(error?: string): void {
    if (this._state === 'disconnected' || this._state === 'reconnecting') {
      return; // Already handling
    }

    this._state = 'disconnected';
    this._disconnectedAt = Date.now();
    this._attempt = 0;

    this.logger.warn(`Connection lost${error ? ': ' + error : ''}`);
    this.fireStatus(error);

    // Start auto-reconnect
    this.scheduleReconnect();
  }

  /**
   * Manually trigger reconnection (e.g. from "Reconnect" command).
   */
  manualReconnect(): void {
    this._attempt = 0;
    if (this._disconnectedAt === 0) {
      this._disconnectedAt = Date.now();
    }
    this.clearTimer();
    this.attemptReconnect();
  }

  // ─── Reconnection Logic ────────────────────────────────

  private scheduleReconnect(): void {
    if (this._attempt >= this._config.maxRetries) {
      this._state = 'failed';
      this.logger.error(`Reconnection failed after ${this._attempt} attempts`);
      this.fireStatus('Max retries exceeded');
      return;
    }

    const delay = this.calculateDelay(this._attempt);
    this._state = 'reconnecting';
    this.fireStatus();

    this.logger.info(
      `Reconnecting in ${delay}ms (attempt ${this._attempt + 1}/${this._config.maxRetries})`,
    );

    this._timer = setTimeout(() => this.attemptReconnect(), delay);
  }

  private async attemptReconnect(): Promise<void> {
    this._state = 'reconnecting';
    this._attempt++;
    this.fireStatus();

    if (!this._connectFn) {
      this.logger.error('No connect function set');
      this._state = 'failed';
      this.fireStatus('No connect function');
      return;
    }

    try {
      const success = await this._connectFn();
      if (success) {
        this.markConnected();
      } else {
        this.scheduleReconnect();
      }
    } catch (err: any) {
      this.logger.warn(`Reconnect attempt ${this._attempt} failed: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Calculate delay with exponential backoff + jitter.
   *
   * delay = min(initialDelay * multiplier^attempt, maxDelay)
   * jittered = delay * (1 ± jitter)
   */
  private calculateDelay(attempt: number): number {
    const { initialDelay, maxDelay, multiplier, jitter } = this._config;

    const raw = Math.min(
      initialDelay * Math.pow(multiplier, attempt),
      maxDelay,
    );

    // Add jitter: ±jitter%
    const jitterRange = raw * jitter;
    const jittered = raw + (Math.random() * 2 - 1) * jitterRange;

    return Math.round(Math.max(0, jittered));
  }

  // ─── Helpers ───────────────────────────────────────────

  private fireStatus(error?: string): void {
    const status: ReconnectStatus = {
      ...this.status,
      lastError: error,
    };
    this._onStatusChanged.fire(status);
  }

  private clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  dispose(): void {
    this.clearTimer();
    this._onStatusChanged.dispose();
    this._onReconnected.dispose();
  }
}
