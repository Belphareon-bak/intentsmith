#!/usr/bin/env node
// Import an already measured CODE calibration panel into exact-artifact
// history. This closes the no-rescoring loop: calibration is a real model run,
// so the hunt must reuse it instead of paying for the same active tasks again.

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.js';
import { getSystemProfile } from '../system/gpu-detector.js';
import { fetchInstalledModels } from '../upgrade/model-discovery.js';
import {
  artifactFromInventory, modelEvaluationHistory,
} from '../upgrade/model-evaluation-history.js';
import { createRoleEvaluationPlans } from './role-evaluation-plan.js';
import { buildPanelSummaries } from './calibrate-code-suite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(HERE, 'code-suite-tasks.json');
const args = process.argv.slice(2);
const dbArg = args.find(arg => arg.startsWith('--db='));
const reportPaths = args.filter(arg => !arg.startsWith('--'));
if (!reportPaths.length) {
  console.error('použití: node src/eval/import-code-panel-history.js <panel.json> [panel.json…] [--db=cesta]');
  process.exit(1);
}
const dbPath = dbArg?.slice('--db='.length) || path.resolve(HERE, '..', '..', 'data', 'c3.db');
if (!existsSync(dbPath)) throw new Error(`DB nenalezena: ${dbPath}`);

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const reports = reportPaths.map(file => JSON.parse(readFileSync(path.resolve(file), 'utf8')));
const db = new Database(dbPath);
try {
  await runMigrations(db);
  modelEvaluationHistory.setDb(db);
  const inventory = await fetchInstalledModels();
  let hardware = {};
  try {
    const profile = await getSystemProfile();
    const gpu = profile.gpus?.reduce((best, item) => (
      !best || (item.vram_mb || 0) > (best.vram_mb || 0) ? item : best
    ), null);
    if (gpu) hardware = { model: gpu.gpu_model, vramMb: gpu.vram_mb };
  } catch { /* history remains valid without optional hardware metadata */ }
  const plan = createRoleEvaluationPlans().CODE;
  const summaries = buildPanelSummaries(fixture, reports);
  for (const summary of summaries) {
    const artifact = artifactFromInventory(summary.model, inventory);
    if (!artifact) throw new Error(`přesný lokální artefakt nenalezen: ${summary.model}`);
    const row = modelEvaluationHistory.recordComplete({
      artifact,
      role: 'CODE',
      suiteName: plan.suiteName,
      suiteVersion: plan.suiteVersion,
      contractSha256: plan.suiteContractSha256,
      summary,
      hardware,
      metadata: { source: 'code-patch-calibration-panel', reports: reportPaths },
    });
    console.log(`${row.reused ? 'reused' : 'recorded'} ${summary.model}: ${summary.score.toFixed(4)} (${summary.tasks.length} active tasks)`);
  }
} finally {
  db.close();
}
