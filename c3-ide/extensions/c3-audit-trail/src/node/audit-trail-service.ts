/**
 * @c3/audit-trail — Append-only event log service
 *
 * Logs ALL agent events to agent-log/events.jsonl.
 * Purpose: deterministic replay without LLM, regression testing, debugging.
 *
 * Features:
 *   - Append-only JSONL (one JSON object per line)
 *   - Monotonic seq counter (survives within session)
 *   - turn_start / turn_end lifecycle events
 *   - Graceful flush on shutdown
 *   - File rotation when size exceeds threshold
 *
 * Future (not in this sprint):
 *   - c3-replay CLI tool
 *   - Regression comparison between versions
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import * as path from 'path';
import * as fs from 'fs-extra';

const EVENTS_FILE = 'events.jsonl';
const MAX_FILE_SIZE_MB = 50;

export interface AuditEvent {
  seq: number;
  turnId: string;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
}

@injectable()
export class AuditTrailService {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private seq: number = 0;
  private stream: fs.WriteStream | null = null;
  private logDir: string = '';
  private currentFile: string = '';
  private initialized: boolean = false;

  // ─── Lifecycle ─────────────────────────────────────────

  async init(projectPath: string): Promise<void> {
    this.logDir = path.join(projectPath, 'agent-log');
    await fs.ensureDir(this.logDir);

    this.currentFile = path.join(this.logDir, EVENTS_FILE);

    // Resume seq from existing file
    await this.resumeSeq();

    // Open append stream
    this.stream = fs.createWriteStream(this.currentFile, {
      flags: 'a',
      encoding: 'utf-8',
    });

    this.initialized = true;
    this.logger.info(`AuditTrail initialized: ${this.currentFile} (seq starts at ${this.seq})`);
  }

  async close(): Promise<void> {
    if (this.stream) {
      return new Promise((resolve) => {
        this.stream!.end(() => {
          this.stream = null;
          this.initialized = false;
          resolve();
        });
      });
    }
  }

  // ─── Logging ───────────────────────────────────────────

  /**
   * Log an event. Thread-safe (JSONL append is atomic for small writes).
   */
  log(turnId: string, type: string, payload: Record<string, unknown> = {}): void {
    if (!this.initialized || !this.stream) {
      this.logger.warn(`AuditTrail not initialized, dropping event: ${type}`);
      return;
    }

    const event: AuditEvent = {
      seq: ++this.seq,
      turnId,
      type,
      ts: new Date().toISOString(),
      payload,
    };

    const line = JSON.stringify(event) + '\n';
    this.stream.write(line);

    // Check rotation
    this.checkRotation();
  }

  /**
   * Log turn start — convenience method.
   */
  logTurnStart(turnId: string, input: string): void {
    this.log(turnId, 'turn_start', { input });
  }

  /**
   * Log turn end — convenience method.
   */
  logTurnEnd(
    turnId: string,
    status: 'ok' | 'cancelled_by_user' | 'timeout' | 'error' | 'interrupted',
    durationMs: number,
    error?: string,
  ): void {
    this.log(turnId, 'turn_end', { status, durationMs, ...(error && { error }) });
  }

  /**
   * Log shell execution — includes command, args, exit code.
   */
  logShellExec(
    turnId: string,
    command: string,
    args: string[],
    exitCode: number,
    durationMs: number,
    flagged: boolean = false,
  ): void {
    this.log(turnId, 'shell_exec', {
      command,
      args,
      exitCode,
      durationMs,
      flagged,
    });
  }

  /**
   * Log shell security block — when ShellTool denies execution.
   */
  logShellBlocked(
    turnId: string,
    command: string,
    args: string[],
    reason: string,
  ): void {
    this.log(turnId, 'shell_blocked', {
      command,
      args,
      reason,
    });
  }

  /**
   * Log git dirty tree block.
   */
  logGitDirtyTree(turnId: string, dirtyFiles: string): void {
    this.log(turnId, 'git_dirty_tree', {
      blocked: true,
      dirtyFiles,
    });
  }

  // ─── Seq Resumption ────────────────────────────────────

  /**
   * Resume seq counter from existing events file.
   * Reads last line to find highest seq.
   */
  private async resumeSeq(): Promise<void> {
    if (!await fs.pathExists(this.currentFile)) {
      this.seq = 0;
      return;
    }

    try {
      const content = await fs.readFile(this.currentFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());

      if (lines.length === 0) {
        this.seq = 0;
        return;
      }

      // Read last line to get highest seq
      const lastLine = lines[lines.length - 1];
      const lastEvent = JSON.parse(lastLine);
      this.seq = lastEvent.seq || 0;

      this.logger.info(`AuditTrail resumed: ${lines.length} existing events, seq=${this.seq}`);
    } catch (err: any) {
      this.logger.warn(`Failed to resume seq from ${this.currentFile}: ${err.message}`);
      this.seq = 0;
    }
  }

  // ─── File Rotation ─────────────────────────────────────

  private async checkRotation(): Promise<void> {
    try {
      const stat = await fs.stat(this.currentFile);
      if (stat.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        await this.rotate();
      }
    } catch {
      // Ignore stat errors
    }
  }

  private async rotate(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `events-${timestamp}.jsonl`;
    const archivePath = path.join(this.logDir, archiveName);

    // Close current stream
    await this.close();

    // Rename current file to archive
    await fs.rename(this.currentFile, archivePath);

    // Open new stream
    this.stream = fs.createWriteStream(this.currentFile, {
      flags: 'a',
      encoding: 'utf-8',
    });
    this.initialized = true;

    this.logger.info(`AuditTrail rotated: ${archiveName}`);
  }

  // ─── Query (for future replay tool) ────────────────────

  /**
   * Read all events from current log file.
   * Used by replay tool / debugging.
   */
  async readAll(): Promise<AuditEvent[]> {
    if (!await fs.pathExists(this.currentFile)) {
      return [];
    }

    const content = await fs.readFile(this.currentFile, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  }

  /**
   * Read events for a specific turn.
   */
  async readTurn(turnId: string): Promise<AuditEvent[]> {
    const all = await this.readAll();
    return all.filter(e => e.turnId === turnId);
  }

  /**
   * Get summary statistics.
   */
  async getStats(): Promise<AuditStats> {
    const events = await this.readAll();

    const turns = new Set(events.map(e => e.turnId));
    const turnEnds = events.filter(e => e.type === 'turn_end');
    const errors = turnEnds.filter(e => (e.payload as any).status === 'error');
    const shellExecs = events.filter(e => e.type === 'shell_exec');
    const shellBlocks = events.filter(e => e.type === 'shell_blocked');

    return {
      totalEvents: events.length,
      totalTurns: turns.size,
      successfulTurns: turnEnds.filter(e => (e.payload as any).status === 'ok').length,
      errorTurns: errors.length,
      cancelledTurns: turnEnds.filter(e => (e.payload as any).status === 'cancelled_by_user').length,
      shellExecutions: shellExecs.length,
      shellBlocks: shellBlocks.length,
    };
  }
}

export interface AuditStats {
  totalEvents: number;
  totalTurns: number;
  successfulTurns: number;
  errorTurns: number;
  cancelledTurns: number;
  shellExecutions: number;
  shellBlocks: number;
}
