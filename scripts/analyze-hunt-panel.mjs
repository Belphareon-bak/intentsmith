#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { analyzeHuntDecisions } from '../src/upgrade/model-hunt-diagnostics.js';
if (process.argv.length !== 3) throw new Error('Usage: node scripts/analyze-hunt-panel.mjs /path/to/panel.json');
const bytes = await readFile(process.argv[2]);
const report = JSON.parse(bytes);
if (!Array.isArray(report.results)) throw new Error('HUNT_PANEL_RESULTS_REQUIRED');
console.log(JSON.stringify({ schemaVersion: 1, sourceGeneratedAt: report.generatedAt,
  sourceSha256: createHash('sha256').update(bytes).digest('hex'), ...analyzeHuntDecisions(report.results) }, null, 2));
