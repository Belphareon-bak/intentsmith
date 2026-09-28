// Migration 038 — Add benchmark_source to discovered_models (v132)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_25_038_v132_benchmark_source';
export const description = 'Add benchmark_source column to discovered_models for L5 WhatLLM tracking';

export function up(db) {
  const cols = db.prepare("PRAGMA table_info('discovered_models')").all();
  if (!cols.some(c => c.name === 'benchmark_source')) {
    db.exec("ALTER TABLE discovered_models ADD COLUMN benchmark_source TEXT DEFAULT NULL");
  }
}
