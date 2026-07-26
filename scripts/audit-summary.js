#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_TOP = 8;
const FAILURE_STATUSES = new Set(['FAIL', 'TIMEOUT']);
const STATUS_ORDER = ['FAIL', 'TIMEOUT', 'BLOCKED', 'SKIPPED', 'PASS'];

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    input: null,
    baseline: null,
    json: false,
    top: DEFAULT_TOP,
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const eq = arg.indexOf('=');
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      return argv[i];
    };

    if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--baseline')) opts.baseline = value();
    else if (arg.startsWith('--top')) opts.top = Math.max(1, Number(value()) || DEFAULT_TOP);
    else if (arg.startsWith('--out')) opts.out = value();
    else if (!opts.input) opts.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!opts.input) throw new Error('Usage: node scripts/audit-summary.js <run-dir|report.json|checkpoint.json> [--baseline=report.json] [--json] [--out=path]');
  return opts;
}

export async function summarizeAudit(inputPath, options = {}) {
  const loaded = await loadAudit(inputPath);
  const baseline = options.baseline ? await loadAudit(options.baseline) : null;
  const baselineKeys = new Set((baseline?.results || []).map(resultIdentity));
  const results = loaded.results || [];
  const statusCounts = countBy(results, r => r.status);
  const failures = results.filter(r => FAILURE_STATUSES.has(r.status));
  const timeouts = results.filter(r => r.status === 'TIMEOUT');
  const blocked = results.filter(r => r.status === 'BLOCKED');
  const envErrors = [];
  const clusters = new Map();

  for (const result of failures) {
    const logText = result.logPath ? await safeRead(path.resolve(loaded.root, result.logPath)) : '';
    const signature = failureSignature(result, logText);
    const envKind = classifyEnvironmentError(logText);
    if (envKind) envErrors.push({ path: result.path, status: result.status, kind: envKind, logPath: result.logPath });

    const key = `${result.status}:${signature.key}`;
    const cluster = clusters.get(key) || {
      id: stableId(key),
      status: result.status,
      signature: signature.summary,
      count: 0,
      paths: [],
      logPaths: [],
      environmentKind: envKind || null,
      firstCommand: result.command,
      newCount: 0,
      repeatedCount: 0,
      rerun: commandString(result.command),
    };
    cluster.count += 1;
    cluster.paths.push(result.path);
    if (result.logPath) cluster.logPaths.push(result.logPath);
    if (baselineKeys.has(resultIdentity(result))) cluster.repeatedCount += 1;
    else cluster.newCount += 1;
    clusters.set(key, cluster);
  }

  const failureClusters = [...clusters.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
  const blockedAnalysis = blocked.map(result => ({
    path: result.path,
    category: result.category,
    blockers: result.blockedBy || result.blockers || [],
    classification: classifyBlockedSuite(result),
  }));
  const preflightBlockedAnalysis = (loaded.inventorySuites || [])
    .filter(suite => (suite.blockers || []).length > 0)
    .map(suite => ({
      path: suite.path,
      category: suite.category,
      blockers: suite.blockers || [],
      classification: classifyBlockedSuite(suite),
    }));
  const blockedCounts = countBy(blockedAnalysis, item => item.classification);
  const preflightBlockedCounts = countBy(preflightBlockedAnalysis, item => item.classification);
  const requiredFailures = results.filter(r => r.required !== false && ['FAIL', 'TIMEOUT', 'SKIPPED'].includes(r.status));

  return {
    runId: loaded.runId,
    sourceRevision: loaded.sourceRevision,
    startedAt: loaded.startedAt,
    endedAt: loaded.endedAt || null,
    input: loaded.inputPath,
    mode: loaded.mode,
    inventory: loaded.inventory,
    statusCounts: orderedCounts(statusCounts),
    requiredFailureCount: requiredFailures.length,
    failures: {
      total: failures.length,
      clusters: failureClusters,
    },
    timeouts: {
      total: timeouts.length,
      paths: timeouts.map(r => r.path),
    },
    blocked: {
      total: blocked.length,
      counts: blockedCounts,
      suites: blockedAnalysis,
    },
    preflightBlockers: {
      total: preflightBlockedAnalysis.length,
      counts: preflightBlockedCounts,
      suites: preflightBlockedAnalysis,
    },
    environmentErrors: {
      total: envErrors.length,
      items: envErrors,
    },
    newVsRepeated: {
      baseline: baseline?.inputPath || null,
      newFailures: failureClusters.reduce((sum, c) => sum + c.newCount, 0),
      repeatedFailures: failureClusters.reduce((sum, c) => sum + c.repeatedCount, 0),
    },
    recommendedRerun: recommendRerun(failureClusters, timeouts),
  };
}

async function loadAudit(inputPath) {
  const absInput = path.resolve(inputPath);
  let reportPath = absInput;
  let mode = 'report';
  const statPath = await resolveExistingAuditFile(absInput);

  if (statPath.endsWith('/')) {
    reportPath = path.join(statPath, 'report.json');
  } else {
    reportPath = statPath;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    const checkpointPath = path.join(absInput, 'checkpoint.json');
    const inventoryPath = path.join(absInput, 'inventory.json');
    const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    parsed = {
      runId: checkpoint.runId || inventory.runId,
      sourceRevision: checkpoint.sourceRevision || inventory.sourceRevision,
      startedAt: inventory.generatedAt,
      endedAt: null,
      inventory: { total: inventory.suites.length, counts: inventory.counts, blockerCounts: inventory.blockerCounts },
      results: checkpoint.results || [],
    };
    reportPath = checkpointPath;
    mode = 'checkpoint';
  }

  const inventoryPath = path.join(path.dirname(reportPath), 'inventory.json');
  let inventorySuites = [];
  try {
    const inventoryFile = JSON.parse(await readFile(inventoryPath, 'utf8'));
    inventorySuites = Array.isArray(inventoryFile.suites) ? inventoryFile.suites : [];
  } catch {
    // Older reports may not have a sibling inventory file.
  }

  return {
    ...parsed,
    inputPath: reportPath,
    root: findAuditRoot(reportPath, parsed),
    mode,
    inventorySuites,
  };
}

async function resolveExistingAuditFile(absInput) {
  try {
    const text = await readFile(absInput, 'utf8');
    JSON.parse(text);
    return absInput;
  } catch {
    return absInput.endsWith(path.sep) ? absInput : `${absInput}${path.sep}`;
  }
}

function findAuditRoot(reportPath, report) {
  const marker = `${path.sep}data${path.sep}artifacts${path.sep}audit-runs${path.sep}`;
  const idx = reportPath.indexOf(marker);
  if (idx !== -1) return reportPath.slice(0, idx);
  if (report.paths?.runDir) return path.resolve(path.dirname(reportPath), '../../..');
  return process.cwd();
}

async function safeRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function failureSignature(result, logText) {
  if (result.status === 'TIMEOUT') {
    return {
      key: `timeout:${result.path}`,
      summary: `TIMEOUT after ${Math.round((result.durationMs || 0) / 1000)}s`,
    };
  }

  const lines = stripAnsi(logText)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const interesting = lines.filter(line =>
    /AssertionError|Error:|ERR_|expected|actual|not ok|FAIL|failed|Cannot find module|MODULE_NOT_FOUND|EADDRINUSE|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(line)
  );
  const selected = (interesting.length ? interesting : lines).slice(-6);
  const normalized = selected.map(normalizeVolatileText).join('\n') || `${result.status}:${result.exitCode}`;
  return {
    key: stableId(normalized),
    summary: selected.slice(-3).join(' | ') || `${result.status} exit ${result.exitCode}`,
  };
}

function classifyEnvironmentError(logText) {
  const text = stripAnsi(logText);
  if (/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(text)) return 'missing_dependency';
  if (/EADDRINUSE|address already in use/i.test(text)) return 'port_conflict';
  if (/ECONNREFUSED|fetch failed|EAI_AGAIN|ENOTFOUND|network/i.test(text)) return 'network_or_service_unavailable';
  if (/SQLITE_CANTOPEN|SQLITE_CORRUPT|no such table|database is locked/i.test(text)) return 'database_environment';
  if (/permission denied|EACCES|EPERM/i.test(text)) return 'permission';
  return null;
}

function classifyBlockedSuite(result) {
  const blockers = new Set(result.blockedBy || result.blockers || []);
  const p = result.path || '';

  if (blockers.has('destructive')) {
    if (/(_legacy|soak|e2e|project|lifecycle|artifact|harness|tmp|fixture|cleanup|storage|semantic|symbol|graph|knowledge|quality)/i.test(p)) {
      return 'SAFE_IN_DISPOSABLE_WORKTREE';
    }
    return 'ACTUALLY_DESTRUCTIVE';
  }
  if (blockers.has('ollama')) return 'REQUIRES_OLLAMA';
  if (blockers.has('ports')) return 'REQUIRES_FREE_PORT';
  if (blockers.has('network')) return 'REQUIRES_NETWORK';
  if (result.category === 'database') return 'REQUIRES_TEST_DB';
  return 'STATIC_FALSE_POSITIVE';
}

function recommendRerun(clusters, timeouts) {
  if (clusters.length === 0 && timeouts.length === 0) return null;
  const target = clusters[0] || { paths: [timeouts[0].path], firstCommand: timeouts[0].command };
  if (target.paths.length === 1) return commandString(target.firstCommand);
  if (target.paths.length <= 3) {
    return target.paths.map(p => commandString(commandForPath(p))).join(' && ');
  }
  const sample = target.paths[0];
  return `${commandString(commandForPath(sample))} # first representative of ${target.paths.length} similar failures`;
}

function commandForPath(filePath) {
  return filePath.endsWith('.py') ? ['python3', filePath] : ['node', filePath];
}

function commandString(command) {
  return Array.isArray(command) ? command.join(' ') : String(command || '');
}

function resultIdentity(result) {
  return `${result.status}\0${result.path}\0${result.exitCode ?? ''}\0${result.signal ?? ''}`;
}

function stableId(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
}

function normalizeVolatileText(text) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<timestamp>')
    .replace(/\b\d+ms\b/g, '<duration>')
    .replace(/\b\d+\.\d+s\b/g, '<duration>')
    .replace(/\/home\/[^ "'()]+/g, '<path>')
    .replace(/\b\d{4,}\b/g, '<number>');
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function orderedCounts(counts) {
  const ordered = {};
  for (const status of STATUS_ORDER) ordered[status] = counts[status] || 0;
  for (const [key, value] of Object.entries(counts)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  return ordered;
}

export function formatSummary(summary, top = DEFAULT_TOP) {
  const lines = [];
  lines.push(`audit summary ${summary.runId || '(unknown run)'}`);
  lines.push(`source: ${summary.sourceRevision || 'unknown'}`);
  lines.push(`mode: ${summary.mode}`);
  lines.push(`inventory: ${summary.inventory?.total ?? 'unknown'}`);
  lines.push(`status: ${JSON.stringify(summary.statusCounts)}`);
  lines.push(`required failures: ${summary.requiredFailureCount}`);
  lines.push(`failure clusters: ${summary.failures.clusters.length}`);
  for (const cluster of summary.failures.clusters.slice(0, top)) {
    lines.push(`  ${cluster.status} x${cluster.count} ${cluster.id}: ${cluster.signature}`);
    lines.push(`    first: ${cluster.paths[0]}`);
    lines.push(`    rerun: ${cluster.rerun}`);
  }
  lines.push(`timeouts: ${summary.timeouts.total}`);
  lines.push(`blocked: ${summary.blocked.total} ${JSON.stringify(summary.blocked.counts)}`);
  lines.push(`preflight blockers: ${summary.preflightBlockers.total} ${JSON.stringify(summary.preflightBlockers.counts)}`);
  lines.push(`environment errors: ${summary.environmentErrors.total}`);
  if (summary.recommendedRerun) lines.push(`recommended rerun: ${summary.recommendedRerun}`);
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs();
    const summary = await summarizeAudit(opts.input, opts);
    const output = opts.json ? `${JSON.stringify(summary, null, 2)}\n` : formatSummary(summary, opts.top);
    if (opts.out) {
      await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
      await writeFile(opts.out, output);
    }
    process.stdout.write(output);
  } catch (err) {
    console.error(`audit summary failed: ${err.stack || err.message}`);
    process.exitCode = 2;
  }
}

export async function makeTempAuditFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'c3-audit-summary-'));
  return root;
}
