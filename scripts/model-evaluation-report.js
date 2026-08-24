#!/usr/bin/env node

// Read-only report over the same exact-contract authority used by HTTP/Studio.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { createModelFailoverRepository } from '../src/upgrade/model-failover.js';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';
import { resolveCurrentBindings } from '../src/upgrade/model-upgrade-prototype.js';
import { normalizeModelDigestSha256 } from '../src/upgrade/model-identity.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const allowedFlags = new Set(['--json']);
  const unknown = argv.filter(arg => !allowedFlags.has(arg) && !arg.startsWith('--db='));
  const dbArgs = argv.filter(arg => arg.startsWith('--db='));
  if (unknown.length || dbArgs.length > 1) {
    throw new Error('Použití: node scripts/model-evaluation-report.js [--json] [--db=/cesta/c3.db]');
  }
  return Object.freeze({
    json: argv.includes('--json'),
    dbPath: dbArgs[0]?.slice('--db='.length)
      || process.env.C3_DB_PATH
      || resolve(REPOSITORY_ROOT, 'data', 'c3.db'),
  });
}

async function fetchInventory(baseUrl = config.ollama?.baseUrl || 'http://127.0.0.1:11434') {
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Ollama inventory HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.models)) throw new Error('Ollama inventory má neplatný tvar');
  return body.models.map(model => ({
    name: model.name,
    digestSha256: normalizeModelDigestSha256(model.digest),
    digest: model.digest,
    size: model.size,
    modified_at: model.modified_at,
  }));
}

export function renderEvaluationReport(readModel) {
  const lines = [
    `Autorita: ${readModel.authority.tables.join(' + ')}; current contract only; legacy fallback OFF`,
    `Vygenerováno: ${readModel.generatedAt}`,
    `Binding autorita: ${readModel.bindingAuthority?.status || 'UNKNOWN'}`,
    '',
  ];
  for (const [role, state] of Object.entries(readModel.roles)) {
    lines.push(`${role}  ${state.binding || '—'}  ${state.suiteName}@${state.suiteVersion}`);
    for (const row of state.artifacts) {
      const score = row.score == null ? '—' : `${Math.round(row.score * 100)}%`;
      lines.push(`  ${row.model}  ${row.digestSha256?.slice(0, 12) || 'NO_DIGEST'}  ${row.status}  ${score}  ${row.testedAt || '—'}`);
    }
    if (state.latestDecision) {
      const decision = state.latestDecision;
      lines.push(`  DECISION ${decision.outcome}  ${decision.incumbentModel} -> ${decision.candidateModel}  ${decision.createdAt}  ${decision.actionability}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function buildEvaluationReport(options = {}) {
  if (!existsSync(options.dbPath)) throw new Error(`DB nenalezena: ${options.dbPath}`);
  const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
  try {
    const repository = createModelFailoverRepository(db);
    const roles = Object.keys(config.models);
    const bindingState = resolveCurrentBindings(config.models, repository, roles);
    const inventory = await (options.inventory
      ? Promise.resolve(options.inventory)
      : fetchInventory(options.baseUrl));
    return new ModelEvaluationReadModel(db).read({
      inventory,
      bindings: bindingState.bindings,
      bindingAuthority: {
        status: Object.keys(bindingState.durable).length === roles.length
          ? 'DURABLE'
          : 'DURABLE_WITH_BOOTSTRAP_FALLBACK',
        durableRoles: Object.keys(bindingState.durable).sort(),
      },
    });
  } finally {
    db.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildEvaluationReport(options);
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderEvaluationReport(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`MODEL_EVALUATION_REPORT_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
