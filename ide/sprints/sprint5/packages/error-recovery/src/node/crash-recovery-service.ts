/**
 * @c3/error-recovery — Crash Recovery Service (node)
 *
 * Handles IDE crash detection and session restoration:
 *
 * 1. CRASH MARKER (.c3/running.lock)
 *    Written on startup, removed on clean shutdown.
 *    If present on next startup → previous session crashed.
 *
 * 2. CHAT HISTORY (chat/conversation.jsonl)
 *    Append-only JSONL file for all chat messages.
 *    Restored on crash recovery.
 *
 * 3. RECOVERY FLOW
 *    IDE starts → check .c3/running.lock
 *    If exists: crash recovery mode
 *      → Load project.json → phase, pending changes
 *      → Load conversation.jsonl → chat messages
 *      → Load events.jsonl → agent log events
 *      → If phase === pending_review → open Review Panel
 *      → Agent log: "🔄 Session restored from disk"
 *    If not: clean start
 *
 * All writes are atomic (tmp + fsync + rename) or append-only.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  C3ErrorRecovery,
  ChatHistoryEntry,
  CrashRecoveryResult,
} from '../common/error-recovery-protocol';

const LOCK_FILE = '.c3/running.lock';
const CHAT_DIR = 'chat';
const CHAT_FILE = 'chat/conversation.jsonl';
const AGENT_LOG_DIR = 'agent-log';
const AGENT_LOG_FILE = 'agent-log/events.jsonl';

export class C3CrashRecoveryService implements C3ErrorRecovery {

  // ─── Chat History ──────────────────────────────────────

  async appendChatMessage(projectPath: string, entry: ChatHistoryEntry): Promise<void> {
    const chatPath = path.join(projectPath, CHAT_FILE);
    await ensureDir(path.join(projectPath, CHAT_DIR));

    const line = JSON.stringify(entry) + '\n';

    // Append-only write (no atomic rename needed for JSONL append)
    const handle = await fs.promises.open(chatPath, 'a');
    try {
      await handle.writeFile(line, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async loadChatHistory(projectPath: string): Promise<ChatHistoryEntry[]> {
    const chatPath = path.join(projectPath, CHAT_FILE);
    if (!await pathExists(chatPath)) return [];

    try {
      const content = await fs.promises.readFile(chatPath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try { return JSON.parse(line); }
          catch { return null; }
        })
        .filter(Boolean) as ChatHistoryEntry[];
    } catch {
      return [];
    }
  }

  // ─── Crash Marker ─────────────────────────────────────

  async writeCrashMarker(projectPath: string): Promise<void> {
    const lockPath = path.join(projectPath, LOCK_FILE);
    await ensureDir(path.dirname(lockPath));

    const marker = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: require('os').hostname(),
    });

    const handle = await fs.promises.open(lockPath, 'w');
    try {
      await handle.writeFile(marker, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async removeCrashMarker(projectPath: string): Promise<void> {
    const lockPath = path.join(projectPath, LOCK_FILE);
    try {
      await fs.promises.unlink(lockPath);
    } catch {
      // Already removed or doesn't exist
    }
  }

  // ─── Crash Recovery Check ─────────────────────────────

  async checkCrashRecovery(projectPath: string): Promise<CrashRecoveryResult> {
    const lockPath = path.join(projectPath, LOCK_FILE);
    const projectJsonPath = path.join(projectPath, 'project.json');

    // Check if crash marker exists
    if (!await pathExists(lockPath)) {
      return {
        recovered: false,
        chatMessagesRestored: 0,
        agentEventsRestored: 0,
        hasPendingReview: false,
      };
    }

    // Crash marker exists → previous session didn't shut down cleanly
    let downtimeMs: number | undefined;
    try {
      const markerContent = await fs.promises.readFile(lockPath, 'utf-8');
      const marker = JSON.parse(markerContent);
      if (marker.startedAt) {
        downtimeMs = Date.now() - new Date(marker.startedAt).getTime();
      }
    } catch { /* ignore corrupt marker */ }

    // Load project state
    let projectName: string | undefined;
    let phase: string | undefined;
    let hasPendingReview = false;

    if (await pathExists(projectJsonPath)) {
      try {
        const projectData = JSON.parse(
          await fs.promises.readFile(projectJsonPath, 'utf-8'),
        );
        projectName = projectData.name;
        phase = projectData.phase;
        hasPendingReview = phase === 'pending_review';
      } catch { /* corrupt project.json */ }
    }

    // Count chat messages
    const chatMessages = await this.loadChatHistory(projectPath);

    // Count agent events
    let agentEventsRestored = 0;
    const agentLogPath = path.join(projectPath, AGENT_LOG_FILE);
    if (await pathExists(agentLogPath)) {
      try {
        const content = await fs.promises.readFile(agentLogPath, 'utf-8');
        agentEventsRestored = content.split('\n').filter(l => l.trim()).length;
      } catch { /* ignore */ }
    }

    // Clean up the crash marker
    await this.removeCrashMarker(projectPath);

    return {
      recovered: true,
      projectName,
      phase,
      chatMessagesRestored: chatMessages.length,
      agentEventsRestored,
      hasPendingReview,
      downtimeMs,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────

async function ensureDir(d: string): Promise<void> {
  await fs.promises.mkdir(d, { recursive: true });
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}
