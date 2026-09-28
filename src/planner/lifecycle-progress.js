// Lifecycle Progress — Progress Computation & Display
// ══════════════════════════════════════════════════════════════════════════════
// Computes and formats lifecycle progress across milestones.
// Used by both API endpoints and chat handoff formatting.
// ══════════════════════════════════════════════════════════════════════════════

import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
} from '../db/database.js';
import { MilestoneStatus } from './lifecycle.js';

// ─── Compute Lifecycle Progress ─────────────────────────────────────────────

/**
 * Compute overall lifecycle progress from milestone data.
 *
 * @param {string} lifecycleId
 * @returns {{ percentage: number, phase: string, milestones: Object[], byStatus: Object, total: number }}
 */
export function computeLifecycleProgress(lifecycleId) {
  const lc = lifecycleRepo.findById.get(lifecycleId);
  if (!lc) throw new Error(`Lifecycle not found: ${lifecycleId}`);

  const allMs = msRepo.listByLifecycle(lifecycleId);
  const total = allMs.length;

  if (total === 0) {
    return {
      percentage: 0,
      phase: lc.phase,
      milestones: [],
      byStatus: {},
      total: 0,
    };
  }

  // Count by status
  const byStatus = {};
  for (const ms of allMs) {
    byStatus[ms.status] = (byStatus[ms.status] || 0) + 1;
  }

  // Weight: PASSED=1.0, SKIPPED=0.5, EXECUTING/TESTING/REVIEW=0.5, others=0
  const WEIGHTS = {
    [MilestoneStatus.PASSED]: 1.0,
    [MilestoneStatus.SKIPPED]: 0.5,
    [MilestoneStatus.EXECUTING]: 0.5,
    [MilestoneStatus.TESTING]: 0.6,
    [MilestoneStatus.REVIEW]: 0.8,
  };

  let weighted = 0;
  for (const ms of allMs) {
    weighted += WEIGHTS[ms.status] || 0;
  }

  const percentage = Math.round((weighted / total) * 100);

  return {
    percentage,
    phase: lc.phase,
    milestones: allMs,
    byStatus,
    total,
  };
}

// ─── Format Lifecycle Progress (multi-level) ────────────────────────────────

/**
 * Format lifecycle progress as multi-line display text.
 *
 * @param {string} lifecycleId
 * @param {'cs'|'en'} [lang='cs']
 * @returns {string}
 */
export function formatLifecycleProgress(lifecycleId, lang = 'cs') {
  const progress = computeLifecycleProgress(lifecycleId);
  const lines = [];

  // Header
  const headerLabel = lang === 'en' ? 'Project Progress' : 'Průběh projektu';
  lines.push(`📊 **${headerLabel}** — ${progress.phase}`);
  lines.push('');

  // Progress bar
  lines.push(`${progressBar(progress.percentage)} ${progress.percentage}%`);
  lines.push('');

  // Status summary
  const s = progress.byStatus;
  const parts = [];
  if (s.PASSED) parts.push(`✅ ${s.PASSED} ${lang === 'en' ? 'done' : 'hotovo'}`);
  if (s.EXECUTING) parts.push(`⚙️ ${s.EXECUTING} ${lang === 'en' ? 'running' : 'probíhá'}`);
  if (s.TESTING) parts.push(`🧪 ${s.TESTING} ${lang === 'en' ? 'testing' : 'testování'}`);
  if (s.REVIEW) parts.push(`🔍 ${s.REVIEW} ${lang === 'en' ? 'review' : 'review'}`);
  if (s.PENDING) parts.push(`⏳ ${s.PENDING} ${lang === 'en' ? 'pending' : 'čeká'}`);
  if (s.BLOCKED) parts.push(`🚫 ${s.BLOCKED} ${lang === 'en' ? 'blocked' : 'blokováno'}`);
  if (s.SKIPPED) parts.push(`⏭️ ${s.SKIPPED} ${lang === 'en' ? 'skipped' : 'přeskočeno'}`);
  if (s.FAILED) parts.push(`❌ ${s.FAILED} ${lang === 'en' ? 'failed' : 'selhalo'}`);

  if (parts.length > 0) lines.push(parts.join(' | '));

  return lines.join('\n');
}

// ─── Format Milestone Table ─────────────────────────────────────────────────

/**
 * Format milestones as a table for display.
 *
 * @param {Object[]} milestones
 * @returns {string}
 */
export function formatMilestoneTable(milestones) {
  if (!milestones || milestones.length === 0) return '(žádné milníky)';

  const STATUS_ICONS = {
    PENDING: '⏳',
    PLANNING: '📝',
    AWAITING_PLAN: '📋',
    EXECUTING: '⚙️',
    TESTING: '🧪',
    REVIEW: '🔍',
    PASSED: '✅',
    FAILED: '❌',
    BLOCKED: '🚫',
    SKIPPED: '⏭️',
  };

  const lines = [];
  lines.push('| # | Milník | Status | LOC | Commit |');
  lines.push('|---|--------|--------|-----|--------|');

  for (const ms of milestones) {
    const icon = STATUS_ICONS[ms.status] || '?';
    const loc = ms.estimated_loc || '-';
    const commit = ms.commit_hash ? ms.commit_hash.substring(0, 7) : '-';
    const title = (ms.title || ms.id).substring(0, 30);
    lines.push(`| ${ms.sequence} | ${icon} ${title} | ${ms.status} | ${loc} | ${commit} |`);
  }

  return lines.join('\n');
}

// ─── Format Health Score History ────────────────────────────────────────────

/**
 * Format health scores across milestones as a trend display.
 *
 * @param {Object[]} milestones - Milestones with health_score
 * @returns {string}
 */
export function formatHealthScoreHistory(milestones) {
  const withHealth = (milestones || []).filter(m => m.health_score);
  if (withHealth.length === 0) return '(žádné health score data)';

  const lines = [];
  lines.push('🏥 **Health Score History**');
  lines.push('');
  lines.push('| Milník | Scope | Tests | Complexity | Debt |');
  lines.push('|--------|-------|-------|------------|------|');

  for (const ms of withHealth) {
    const h = ms.health_score;
    const title = (ms.title || ms.id).substring(0, 20);
    const scope = formatMetric(h.scope_adherence);
    const tests = formatMetric(h.test_coverage);
    const complexity = formatMetric(h.complexity_delta, true);
    const debt = formatMetric(h.tech_debt_delta, true);
    lines.push(`| ${title} | ${scope} | ${tests} | ${complexity} | ${debt} |`);
  }

  // Trend arrows
  if (withHealth.length >= 2) {
    const first = withHealth[0].health_score;
    const last = withHealth[withHealth.length - 1].health_score;
    lines.push('');
    lines.push('**Trendy:**');
    lines.push(`  Scope: ${trendArrow(first.scope_adherence, last.scope_adherence)}`);
    lines.push(`  Testy: ${trendArrow(first.test_coverage, last.test_coverage)}`);
    lines.push(`  Debt: ${trendArrow(last.tech_debt_delta, first.tech_debt_delta)}`); // inverted: lower debt = better
  }

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function formatMetric(value, lowerIsBetter = false) {
  if (value === undefined || value === null) return '-';
  const v = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(v)) return '-';
  return v.toFixed(2);
}

function trendArrow(first, last) {
  if (first === undefined || last === undefined) return '?';
  const diff = last - first;
  if (Math.abs(diff) < 0.05) return '→ stabilní';
  return diff > 0 ? '↑ zlepšení' : '↓ zhoršení';
}

export default {
  computeLifecycleProgress,
  formatLifecycleProgress,
  formatMilestoneTable,
  formatHealthScoreHistory,
};
