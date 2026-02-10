/**
 * @c3/token-dashboard — Backend Service
 *
 * In-memory token usage tracker with JSONL persistence.
 * Records each turn's token usage and provides aggregated stats.
 *
 * Storage: .c3/token-usage.jsonl (append-only)
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  C3TokenDashboard,
  TokenUsageRecord,
  TokenStats,
  IntentBreakdown,
  ModelBreakdown,
  DailyUsage,
  DEFAULT_PRICING,
} from '../common/token-dashboard-protocol';

export class C3TokenDashboardService implements C3TokenDashboard {

  private records: TokenUsageRecord[] = [];
  private storagePath: string | null = null;

  /**
   * Initialize with a project path for persistence.
   */
  async init(projectPath: string): Promise<void> {
    this.storagePath = path.join(projectPath, '.c3', 'token-usage.jsonl');
    await this.loadFromDisk();
  }

  // ─── Record ────────────────────────────────────────────

  async recordUsage(record: TokenUsageRecord): Promise<void> {
    // Estimate cost if not provided
    if (record.estimatedCostUsd === undefined) {
      record.estimatedCostUsd = this.estimateCost(record);
    }

    this.records.push(record);

    // Persist
    if (this.storagePath) {
      await ensureDir(path.dirname(this.storagePath));
      const handle = await fs.promises.open(this.storagePath, 'a');
      try {
        await handle.writeFile(JSON.stringify(record) + '\n', 'utf-8');
        await handle.sync();
      } finally { await handle.close(); }
    }
  }

  // ─── Stats ─────────────────────────────────────────────

  async getStats(projectSlug?: string): Promise<TokenStats> {
    let filtered = this.records;
    if (projectSlug) {
      filtered = filtered.filter(r => r.projectSlug === projectSlug);
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - (now.getDay() * 86400000);

    const today = filtered
      .filter(r => new Date(r.timestamp).getTime() >= todayStart)
      .reduce((s, r) => s + r.totalTokens, 0);

    const thisWeek = filtered
      .filter(r => new Date(r.timestamp).getTime() >= weekStart)
      .reduce((s, r) => s + r.totalTokens, 0);

    const project = filtered.reduce((s, r) => s + r.totalTokens, 0);
    const allTime = this.records.reduce((s, r) => s + r.totalTokens, 0);

    // By intent
    const intentMap = new Map<string, { tokens: number; count: number }>();
    for (const r of filtered) {
      const key = r.intent || 'UNKNOWN';
      const prev = intentMap.get(key) || { tokens: 0, count: 0 };
      intentMap.set(key, { tokens: prev.tokens + r.totalTokens, count: prev.count + 1 });
    }
    const byIntent: IntentBreakdown[] = [...intentMap.entries()]
      .map(([intent, data]) => ({
        intent,
        tokens: data.tokens,
        percentage: project > 0 ? (data.tokens / project) * 100 : 0,
        count: data.count,
      }))
      .sort((a, b) => b.tokens - a.tokens);

    // By model
    const modelMap = new Map<string, number>();
    for (const r of filtered) {
      modelMap.set(r.model, (modelMap.get(r.model) || 0) + r.totalTokens);
    }
    const byModel: ModelBreakdown[] = [...modelMap.entries()]
      .map(([model, tokens]) => ({
        model,
        tokens,
        percentage: project > 0 ? (tokens / project) * 100 : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens);

    // Daily usage (last 30 days)
    const dailyMap = new Map<string, { tokens: number; turns: number }>();
    const thirtyDaysAgo = todayStart - (30 * 86400000);
    for (const r of filtered) {
      const ts = new Date(r.timestamp).getTime();
      if (ts < thirtyDaysAgo) continue;
      const date = new Date(r.timestamp).toISOString().slice(0, 10);
      const prev = dailyMap.get(date) || { tokens: 0, turns: 0 };
      dailyMap.set(date, { tokens: prev.tokens + r.totalTokens, turns: prev.turns + 1 });
    }
    const dailyUsage: DailyUsage[] = [...dailyMap.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Cost
    const estimatedCostUsd = filtered.reduce(
      (s, r) => s + (r.estimatedCostUsd || 0), 0,
    );

    return {
      today, thisWeek, project, allTime,
      byIntent, byModel, dailyUsage,
      estimatedCostUsd,
    };
  }

  // ─── Records ───────────────────────────────────────────

  async getRecords(
    projectSlug?: string,
    after?: string,
    before?: string,
  ): Promise<TokenUsageRecord[]> {
    let filtered = this.records;
    if (projectSlug) filtered = filtered.filter(r => r.projectSlug === projectSlug);
    if (after) {
      const t = new Date(after).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() >= t);
    }
    if (before) {
      const t = new Date(before).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() <= t);
    }
    return filtered;
  }

  // ─── Clear ─────────────────────────────────────────────

  async clearProject(projectSlug: string): Promise<void> {
    this.records = this.records.filter(r => r.projectSlug !== projectSlug);
    // Rewrite storage
    if (this.storagePath) {
      const content = this.records.map(r => JSON.stringify(r)).join('\n') + '\n';
      const tmp = this.storagePath + '.tmp';
      const handle = await fs.promises.open(tmp, 'w');
      try { await handle.writeFile(content, 'utf-8'); await handle.sync(); }
      finally { await handle.close(); }
      await fs.promises.rename(tmp, this.storagePath);
    }
  }

  // ─── Cost Estimation ──────────────────────────────────

  private estimateCost(record: TokenUsageRecord): number {
    const pricing = DEFAULT_PRICING.find(p =>
      record.model.toLowerCase().includes(p.model),
    ) || DEFAULT_PRICING[DEFAULT_PRICING.length - 1]; // fallback to 'local' (free)

    return (
      (record.inputTokens / 1000) * pricing.inputPer1k +
      (record.outputTokens / 1000) * pricing.outputPer1k
    );
  }

  // ─── Persistence ───────────────────────────────────────

  private async loadFromDisk(): Promise<void> {
    if (!this.storagePath) return;
    if (!await pathExists(this.storagePath)) return;

    try {
      const content = await fs.promises.readFile(this.storagePath, 'utf-8');
      this.records = content
        .split('\n')
        .filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch { /* ignore */ }
  }
}

async function ensureDir(d: string): Promise<void> {
  await fs.promises.mkdir(d, { recursive: true });
}
async function pathExists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}
