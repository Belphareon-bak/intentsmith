#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_OUT_DIR = 'data/artifacts/audit-runs';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DEADLINE_MS = 8 * 60 * 60 * 1000;
const RUNNABLE_BASENAMES = new Set(['output-gate.js']);
const RUNNABLE_SUFFIXES = ['.test.js', '.test.cjs', '.e2e.js'];
const CATEGORY_ORDER = [
  'unit',
  'integration',
  'database',
  'contract',
  'local-e2e',
  'ollama-e2e',
  'legacy',
  'python',
  'soak',
  'check',
];

const BLOCKER_PATTERNS = {
  ollama: /\b(ollama|OLLAMA(?:_[A-Z0-9_]+)?|real[-\s]?llm|localhost:11434|127\.0\.0\.1:11434|\/api\/(?:chat|generate|tags|ps))\b/i,
  network: /\b(?:fetch\(|WebSocket|request\(|https?\.request|net\.createConnection|rssSource\.fetch|C3_NTFY|SMTP|TELEGRAM|online-discovery|marketplace|registry-client)/i,
  ports: /\b(listen\(|localhost|127\.0\.0\.1|PORT|server\.listen|websocket|ws-bridge|rate-limit)\b/i,
  destructive: /\b(rm\s+-rf|unlinkSync|rmSync|DROP\s+TABLE|reset\s+--hard|deleteProject|rmdirSync)\b/i,
};

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    root: process.cwd(),
    outDir: DEFAULT_OUT_DIR,
    runId: null,
    dryRun: false,
    failFast: false,
    resume: false,
    concurrency: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    deadlineMs: DEFAULT_DEADLINE_MS,
    include: new Set(),
    exclude: new Set(),
    allowBlockers: new Set(),
    noBlock: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const eq = arg.indexOf('=');
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      return argv[i];
    };

    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--fail-fast') opts.failFast = true;
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--no-block') opts.noBlock = true;
    else if (arg.startsWith('--root')) opts.root = path.resolve(value());
    else if (arg.startsWith('--out-dir')) opts.outDir = value();
    else if (arg.startsWith('--run-id')) opts.runId = value();
    else if (arg.startsWith('--concurrency')) opts.concurrency = Math.max(1, Number(value()) || 1);
    else if (arg.startsWith('--timeout-ms')) opts.timeoutMs = Math.max(1, Number(value()) || DEFAULT_TIMEOUT_MS);
    else if (arg.startsWith('--timeout-minutes')) opts.timeoutMs = Math.max(1, Number(value()) || 10) * 60 * 1000;
    else if (arg.startsWith('--deadline-ms')) opts.deadlineMs = Math.max(1, Number(value()) || DEFAULT_DEADLINE_MS);
    else if (arg.startsWith('--deadline-hours')) opts.deadlineMs = Math.max(1, Number(value()) || 8) * 60 * 60 * 1000;
    else if (arg.startsWith('--include')) addCsv(opts.include, value());
    else if (arg.startsWith('--exclude')) addCsv(opts.exclude, value());
    else if (arg.startsWith('--allow-blocker')) addCsv(opts.allowBlockers, value());
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function addCsv(target, value) {
  for (const item of String(value || '').split(',')) {
    const trimmed = item.trim();
    if (trimmed) target.add(trimmed);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/nightly-audit.js [options]

Options:
  --dry-run                     Discover and classify inventory only
  --include=a,b                 Include only categories
  --exclude=a,b                 Exclude categories
  --allow-blocker=ollama,ports  Permit suites with blocker labels
  --no-block                    Execute suites regardless of detected blockers
  --timeout-minutes=N           Per-suite timeout, default 10
  --deadline-hours=N            Total deadline, default 8
  --concurrency=N               Default 1
  --fail-fast                   Stop scheduling after first required failure
  --resume --run-id=ID          Resume from checkpoint
  --out-dir=PATH                Default ${DEFAULT_OUT_DIR}
`);
}

export async function discoverInventory(root = process.cwd()) {
  const testsDir = path.join(root, 'tests');
  const files = await walk(testsDir);
  const suites = [];

  for (const absPath of files) {
    const relPath = normalizePath(path.relative(root, absPath));
    if (!isRunnable(relPath)) continue;
    const content = await safeRead(absPath);
    const category = classifyTestFile(relPath, content);
    const blockers = detectBlockers(relPath, content, category);
    suites.push({
      path: relPath,
      category,
      command: commandFor(relPath),
      blockers,
      required: true,
    });
  }

  suites.sort((a, b) => a.path.localeCompare(b.path));
  return suites;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function isRunnable(relPath) {
  const base = path.basename(relPath);
  if (RUNNABLE_BASENAMES.has(base)) return true;
  if (/^tests\/test_[^/]+\.py$/.test(relPath)) return true;
  return RUNNABLE_SUFFIXES.some(suffix => relPath.endsWith(suffix));
}

async function safeRead(absPath) {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return '';
  }
}

export function classifyTestFile(relPath, content = '') {
  if (relPath === 'tests/output-gate.js') return 'check';
  if (relPath.endsWith('.py')) return 'python';
  if (relPath.includes('/_legacy/')) return 'legacy';
  if (relPath.includes('/soak/')) return 'soak';
  if (relPath.includes('/e2e/')) {
    return BLOCKER_PATTERNS.ollama.test(`${relPath}\n${content}`) ? 'ollama-e2e' : 'local-e2e';
  }

  const text = `${relPath}\n${content}`;
  if (BLOCKER_PATTERNS.ollama.test(text)) return 'ollama-e2e';
  if (/\b(db|database|schema|migration|sqlite|ledger|storage)\b/i.test(text)) return 'database';
  if (/\b(contract|schema|invariant|security|capability|enforcement|validation|manifest|gatekeeper)\b/i.test(text)) return 'contract';
  if (/\b(integration|lifecycle|project|workflow|pipeline|server|route|api|executor|agent|specialist|expertise|notification|websocket|ws-bridge)\b/i.test(text)) {
    return 'integration';
  }
  return 'unit';
}

export function detectBlockers(relPath, content = '', category = classifyTestFile(relPath, content)) {
  const blockers = new Set();
  const text = `${relPath}\n${content}`;
  if (category === 'ollama-e2e' || BLOCKER_PATTERNS.ollama.test(text)) blockers.add('ollama');
  if (BLOCKER_PATTERNS.network.test(text)) blockers.add('network');
  if (BLOCKER_PATTERNS.ports.test(text)) blockers.add('ports');
  if (BLOCKER_PATTERNS.destructive.test(text)) blockers.add('destructive');
  return [...blockers].sort();
}

function commandFor(relPath) {
  if (relPath.endsWith('.py')) return ['python3', relPath];
  return ['node', relPath];
}

export function filterSuites(suites, opts) {
  return suites.filter(suite => {
    if (opts.include?.size && !opts.include.has(suite.category)) return false;
    if (opts.exclude?.has(suite.category)) return false;
    return true;
  });
}

export async function runAudit(options = {}) {
  const opts = {
    ...parseArgs([]),
    ...options,
    include: options.include instanceof Set ? options.include : new Set(options.include || []),
    exclude: options.exclude instanceof Set ? options.exclude : new Set(options.exclude || []),
    allowBlockers: options.allowBlockers instanceof Set ? options.allowBlockers : new Set(options.allowBlockers || []),
  };
  opts.root = path.resolve(opts.root);
  opts.outDir = path.resolve(opts.root, opts.outDir);
  const runId = opts.runId || makeRunId();
  const runDir = path.join(opts.outDir, runId);
  const logsDir = path.join(runDir, 'logs');
  await mkdir(logsDir, { recursive: true });

  const sourceRevision = await getSourceRevision(opts.root);
  const allSuites = await discoverInventory(opts.root);
  const selectedSuites = filterSuites(allSuites, opts);
  const counts = countByCategory(selectedSuites);
  const blockerCounts = countBlockers(selectedSuites);
  const checkpointPath = path.join(runDir, 'checkpoint.json');
  const reportPath = path.join(runDir, 'report.json');
  const inventoryPath = path.join(runDir, 'inventory.json');
  const startedAt = new Date().toISOString();
  const completedResults = opts.resume ? await readCheckpoint(checkpointPath) : [];
  const completedKeys = new Set(completedResults.map(resultKey));

  await writeJSON(inventoryPath, {
    runId,
    sourceRevision,
    generatedAt: startedAt,
    counts,
    blockerCounts,
    suites: selectedSuites,
  });

  if (opts.dryRun) {
    const report = makeReport({
      runId,
      sourceRevision,
      startedAt,
      endedAt: new Date().toISOString(),
      opts,
      inventory: selectedSuites,
      results: [],
      dryRun: true,
      counts,
      blockerCounts,
      runDir,
    });
    await writeJSON(reportPath, report);
    printInventorySummary(report);
    return report;
  }

  const deadlineAt = Date.now() + opts.deadlineMs;
  const pending = selectedSuites.filter(suite => !completedKeys.has(resultKey(suite)));
  const results = [...completedResults];
  let cursor = 0;
  let requiredFailureSeen = results.some(r => r.required !== false && ['FAIL', 'TIMEOUT'].includes(r.status));

  async function nextSuite() {
    if (opts.failFast && requiredFailureSeen) return null;
    if (Date.now() >= deadlineAt) return null;
    if (cursor >= pending.length) return null;
    const suite = pending[cursor];
    cursor += 1;
    return suite;
  }

  async function worker() {
    for (;;) {
      const suite = await nextSuite();
      if (!suite) return;

      const disallowedBlockers = opts.noBlock
        ? []
        : suite.blockers.filter(blocker => !opts.allowBlockers.has(blocker));
      let result;
      if (disallowedBlockers.length) {
        result = makeBlockedResult(suite, sourceRevision, disallowedBlockers);
      } else {
        result = await runSuite({ suite, opts, sourceRevision, logsDir });
      }

      results.push(result);
      if (result.required !== false && ['FAIL', 'TIMEOUT'].includes(result.status)) requiredFailureSeen = true;
      await writeJSON(checkpointPath, { runId, sourceRevision, updatedAt: new Date().toISOString(), results });
      printSuiteProgress(results.length, selectedSuites.length, result);
    }
  }

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));

  for (let i = cursor; i < pending.length; i++) {
    const suite = pending[i];
    const result = makeSkippedResult(suite, sourceRevision, Date.now() >= deadlineAt ? 'total_deadline' : 'fail_fast');
    results.push(result);
  }

  const endedAt = new Date().toISOString();
  const report = makeReport({
    runId,
    sourceRevision,
    startedAt,
    endedAt,
    opts,
    inventory: selectedSuites,
    results,
    dryRun: false,
    counts,
    blockerCounts,
    runDir,
  });
  await writeJSON(reportPath, report);
  printFinalSummary(report);
  return report;
}

async function runSuite({ suite, opts, sourceRevision, logsDir }) {
  const startMs = Date.now();
  const startedAt = new Date(startMs).toISOString();
  const logPath = path.join(logsDir, `${safeLogName(suite.path)}.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  const [cmd, ...args] = suite.command;
  let timedOut = false;

  log.write(`$ ${suite.command.join(' ')}\n`);
  log.write(`started_at=${startedAt}\n`);
  log.write(`source_revision=${sourceRevision}\n\n`);

  return await new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd: opts.root,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'test',
        C3_AUDIT_RUN: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000).unref();
    }, opts.timeoutMs);
    timer.unref();

    child.stdout.on('data', chunk => log.write(chunk));
    child.stderr.on('data', chunk => log.write(chunk));
    child.on('error', err => log.write(`\nspawn_error=${err.message}\n`));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const endMs = Date.now();
      const endedAt = new Date(endMs).toISOString();
      const status = timedOut ? 'TIMEOUT' : code === 0 ? 'PASS' : 'FAIL';
      log.write(`\nended_at=${endedAt}\nexit_code=${code}\nsignal=${signal || ''}\nstatus=${status}\n`);
      log.end();
      resolve({
        path: suite.path,
        category: suite.category,
        command: suite.command,
        blockers: suite.blockers,
        required: suite.required,
        start: startedAt,
        end: endedAt,
        durationMs: endMs - startMs,
        exitCode: code,
        signal,
        status,
        retryCount: 0,
        logPath: normalizePath(path.relative(opts.root, logPath)),
        sourceRevision,
      });
    });
  });
}

function makeBlockedResult(suite, sourceRevision, blockers) {
  const now = new Date().toISOString();
  return {
    path: suite.path,
    category: suite.category,
    command: suite.command,
    blockers: suite.blockers,
    required: false,
    start: now,
    end: now,
    durationMs: 0,
    exitCode: null,
    signal: null,
    status: 'BLOCKED',
    blockedBy: blockers,
    retryCount: 0,
    logPath: null,
    sourceRevision,
  };
}

function makeSkippedResult(suite, sourceRevision, reason) {
  const now = new Date().toISOString();
  return {
    path: suite.path,
    category: suite.category,
    command: suite.command,
    blockers: suite.blockers,
    required: reason === 'total_deadline',
    start: now,
    end: now,
    durationMs: 0,
    exitCode: null,
    signal: null,
    status: 'SKIPPED',
    skipReason: reason,
    retryCount: 0,
    logPath: null,
    sourceRevision,
  };
}

function makeReport({ runId, sourceRevision, startedAt, endedAt, opts, inventory, results, dryRun, counts, blockerCounts, runDir }) {
  const statusCounts = {};
  for (const status of ['PASS', 'FAIL', 'TIMEOUT', 'BLOCKED', 'SKIPPED']) statusCounts[status] = 0;
  for (const result of results) statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
  const requiredFailures = results.filter(r => r.required !== false && ['FAIL', 'TIMEOUT', 'SKIPPED'].includes(r.status));
  return {
    runId,
    sourceRevision,
    startedAt,
    endedAt,
    dryRun,
    options: {
      concurrency: opts.concurrency,
      failFast: opts.failFast,
      timeoutMs: opts.timeoutMs,
      deadlineMs: opts.deadlineMs,
      include: [...opts.include],
      exclude: [...opts.exclude],
      allowBlockers: [...opts.allowBlockers],
      noBlock: opts.noBlock,
    },
    paths: {
      runDir: normalizePath(path.relative(opts.root, runDir)),
      report: normalizePath(path.relative(opts.root, path.join(runDir, 'report.json'))),
      checkpoint: normalizePath(path.relative(opts.root, path.join(runDir, 'checkpoint.json'))),
      inventory: normalizePath(path.relative(opts.root, path.join(runDir, 'inventory.json'))),
    },
    inventory: {
      total: inventory.length,
      counts,
      blockerCounts,
    },
    statusCounts,
    requiredFailureCount: requiredFailures.length,
    results,
  };
}

async function readCheckpoint(checkpointPath) {
  try {
    const parsed = JSON.parse(await readFile(checkpointPath, 'utf8'));
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

function resultKey(item) {
  return `${item.path}\0${Array.isArray(item.command) ? item.command.join(' ') : ''}`;
}

function countByCategory(suites) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0]));
  for (const suite of suites) counts[suite.category] = (counts[suite.category] || 0) + 1;
  return counts;
}

function countBlockers(suites) {
  const counts = {};
  for (const suite of suites) {
    for (const blocker of suite.blockers) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

async function getSourceRevision(root) {
  return await new Promise(resolve => {
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', code => resolve(code === 0 ? out.trim() : 'unknown'));
    child.on('error', () => resolve('unknown'));
  });
}

function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeLogName(relPath) {
  const hash = createHash('sha1').update(relPath).digest('hex').slice(0, 8);
  return `${relPath.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.${hash}`;
}

function normalizePath(p) {
  return p.split(path.sep).join('/');
}

async function writeJSON(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function printInventorySummary(report) {
  console.log(`audit dry-run ${report.runId}`);
  console.log(`inventory: ${report.inventory.total}`);
  for (const category of CATEGORY_ORDER) {
    console.log(`  ${category}: ${report.inventory.counts[category] || 0}`);
  }
  console.log(`blockers: ${JSON.stringify(report.inventory.blockerCounts)}`);
  console.log(`report: ${report.paths.report}`);
}

function printSuiteProgress(done, total, result) {
  const code = result.exitCode === null ? '-' : result.exitCode;
  console.log(`[${done}/${total}] ${result.status} ${result.path} (${result.durationMs}ms, exit ${code})`);
}

function printFinalSummary(report) {
  console.log(`audit run ${report.runId}`);
  console.log(`status: ${JSON.stringify(report.statusCounts)}`);
  console.log(`required failures: ${report.requiredFailureCount}`);
  console.log(`report: ${report.paths.report}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runAudit(parseArgs());
    if (!report.dryRun && report.requiredFailureCount > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`audit runner failed: ${err.stack || err.message}`);
    process.exitCode = 2;
  }
}
