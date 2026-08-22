#!/usr/bin/env node
/**
 * Běhový režim — postaví prostředí a sady SPUSTÍ.
 *
 * `scripts/nightly-audit.js` je certifikátor: `server` a `state-blocked` jsou
 * v něm tvrdé blockery, které nelze obejít, protože Gate 0 nesmí označit za
 * prošlé to, co nespustil. Správné pro certifikaci, ale znamená to, že 82
 * registrovaných sad nejde spustit vůbec.
 *
 * Tenhle skript ten chybějící kus doplňuje: postaví runner-owned izolaci
 * (stejným `makeSuiteEnvironment()`, jaký používá audit), spustí server,
 * počká na jeho připravenost a sady na něm proběhnou.
 *
 * **Výstup není Gate 0 evidence a nikdy jí být nesmí.** Neaktualizuje registr,
 * nezapisuje `lastGreen` a nemění stav žádné sady. Je to měření, ne certifikace.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { loadTestRegistry } from './test-registry.js';
import { makeSuiteEnvironment } from './nightly-audit.js';

const ROOT = process.cwd();
const PRIVATE = '.intentsmith-artifacts';

function parseArgs(argv) {
  const opts = {
    suites: new Set(), profiles: new Set(), states: new Set(),
    timeoutScale: 1, logLevel: 'warn', keep: false, list: false,
  };
  for (const arg of argv) {
    const [key, raw] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const csv = () => String(raw || '').split(',').map(v => v.trim()).filter(Boolean);
    if (key === '--suite') csv().forEach(v => opts.suites.add(v));
    else if (key === '--profile') csv().forEach(v => opts.profiles.add(v));
    else if (key === '--state') csv().forEach(v => opts.states.add(v));
    else if (key === '--timeout-scale') opts.timeoutScale = Number(raw) || 1;
    else if (key === '--log-level') opts.logLevel = String(raw || 'warn');
    else if (key === '--keep-run-root') opts.keep = true;
    else if (key === '--list') opts.list = true;
    else if (key === '--help') opts.help = true;
    else throw new Error(`Neznámý argument: ${arg}`);
  }
  return opts;
}

function selectSuites(registry, opts) {
  return registry.suites.filter(s => {
    if (opts.suites.size && !opts.suites.has(s.id)) return false;
    if (opts.profiles.size && !opts.profiles.has(s.profile)) return false;
    if (opts.states.size && !opts.states.has(s.state)) return false;
    if (!opts.suites.size && !opts.profiles.size && !opts.states.size) return false;
    return true;
  });
}

function makeRunRoot(runId) {
  const root = path.join(ROOT, PRIVATE, 'run-suites', runId);
  rmSync(root, { recursive: true, force: true });
  const dirs = {
    root,
    home: path.join(root, 'home'),
    temp: path.join(root, 'tmp'),
    projects: path.join(root, 'projects'),
    artifacts: path.join(root, 'artifacts'),
    npmCache: path.join(root, 'artifacts', 'npm-cache'),
    runtime: path.join(root, 'runtime'),
    xdgConfig: path.join(root, 'xdg-config'),
    xdgCache: path.join(root, 'xdg-cache'),
    xdgData: path.join(root, 'xdg-data'),
    xdgState: path.join(root, 'xdg-state'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const gitConfig = path.join(root, 'gitconfig');
  writeFileSync(gitConfig, '[user]\n\tname = suite runner\n\temail = runner@localhost\n', { mode: 0o600 });
  return { ...dirs, gitConfig };
}

async function waitForReady(portFile, log, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      try {
        const parsed = JSON.parse(readFileSync(portFile, 'utf8'));
        if (Number.isInteger(parsed.port) && parsed.port > 0) return parsed;
      } catch { /* ještě se zapisuje */ }
    }
    if (existsSync(log)) {
      const text = readFileSync(log, 'utf8');
      if (/Error:|EADDRINUSE|Cannot find module/.test(text) && !/C3_READY:/.test(text)) {
        throw new Error(`Server selhal při startu:\n${text.slice(-800)}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Server nenaběhl do limitu');
}

function runSuite(suite, env, timeoutMs, outPath) {
  return new Promise(resolve => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(suite.argv[0], [suite.argv[1]], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    let killed = false;
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      writeFileSync(outPath, output, { mode: 0o600 });
      const durationMs = Date.now() - started;
      const status = code === 0 ? 'PASS' : (killed || signal === 'SIGKILL' ? 'TIMEOUT' : 'FAIL');
      const detail = (output.match(/❌[^\n]{0,110}/) || [])[0] || null;
      const stepsPassed = (output.match(/✅/g) || []).length;
      resolve({ status, exitCode: code, signal, durationMs, detail, stepsPassed });
    });
    child.stdout.on('data', c => chunks.push(c));
    child.stderr.on('data', c => chunks.push(c));
    setTimeout(() => { killed = true; }, timeoutMs);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Použití: node scripts/run-suites.js [--suite=ID,..] [--profile=..] [--state=..]
                                   [--timeout-scale=N] [--log-level=info] [--keep-run-root] [--list]

Spustí registrované sady proti skutečnému serveru v runner-owned izolaci.
Výstup NENÍ Gate 0 evidence — registr se nemění a lastGreen se nezapisuje.`);
    return 0;
  }

  const registry = await loadTestRegistry(ROOT);
  const selected = selectSuites(registry, opts);
  if (selected.length === 0) {
    console.error('Nevybrána žádná sada. Použij --suite, --profile nebo --state.');
    return 2;
  }
  if (opts.list) {
    selected.forEach(s => console.log(`${s.state.padEnd(6)} ${s.profile.padEnd(9)} ${String(Math.round(s.timeoutMs / 1000)).padStart(5)}s  ${s.id}  ${s.path}`));
    console.log(`\nvybráno: ${selected.length}`);
    return 0;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const dirs = makeRunRoot(runId);
  const serverLog = path.join(dirs.root, 'server.log');
  const sourceRevision = (process.env.INTENTSMITH_TEST_SOURCE_REVISION || '').trim()
    || (await import('node:child_process')).execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();

  const base = makeSuiteEnvironment({
    suite: { requirements: { server: true, ollama: true } },
    sourceRevision,
    homeDir: dirs.home, tempDir: dirs.temp, projectsDir: dirs.projects,
    artifactsDir: dirs.artifacts, npmCacheDir: dirs.npmCache, runtimeDir: dirs.runtime,
    xdgConfigDir: dirs.xdgConfig, xdgCacheDir: dirs.xdgCache,
    xdgDataDir: dirs.xdgData, xdgStateDir: dirs.xdgState,
    gitConfigPath: dirs.gitConfig,
  });
  const env = { ...base.env, C3_LOG_LEVEL: opts.logLevel };

  console.log(`══ běhový režim ── run ${runId}`);
  console.log(`   sad: ${selected.length} · izolace: ${path.relative(ROOT, dirs.root)}`);
  console.log('   POZOR: tohle není Gate 0 evidence. Registr se nemění.\n');

  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
  });
  const serverChunks = [];
  server.stdout.on('data', c => { serverChunks.push(c); writeFileSync(serverLog, Buffer.concat(serverChunks)); });
  server.stderr.on('data', c => { serverChunks.push(c); writeFileSync(serverLog, Buffer.concat(serverChunks)); });

  const results = [];
  let exitCode = 0;
  try {
    const ready = await waitForReady(env.C3_PORT_FILE, serverLog, 180_000);
    const url = `http://127.0.0.1:${ready.port}`;
    console.log(`   server: ${url}\n`);
    const suiteEnv = { ...env, C3_URL: url };

    for (const [index, suite] of selected.entries()) {
      const timeoutMs = Math.max(1000, Math.round(suite.timeoutMs * opts.timeoutScale));
      const outPath = path.join(dirs.artifacts, `${path.basename(suite.path)}.out`);
      const result = await runSuite(suite, suiteEnv, timeoutMs, outPath);
      results.push({ id: suite.id, path: suite.path, ...result });
      const mark = result.status === 'PASS' ? '✓' : '✗';
      const extra = result.status === 'TIMEOUT'
        ? ` (strop ${Math.round(timeoutMs / 1000)}s, ${result.stepsPassed} kroků prošlo)`
        : (result.detail ? ` :: ${result.detail.slice(0, 90)}` : '');
      console.log(`[${index + 1}/${selected.length}] ${mark} ${result.status} ${path.basename(suite.path)} (${Math.round(result.durationMs / 1000)}s)${extra}`);
    }
  } catch (error) {
    console.error(`CHYBA: ${error.message}`);
    exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (!server.killed) server.kill('SIGKILL');
  }

  const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const report = {
    schemaVersion: 1, runId, sourceRevision,
    evidenceType: 'intentsmith.suite-run',
    gateEvidence: false,
    note: 'Běhový režim mimo Gate 0. Neaktualizuje registr ani lastGreen.',
    summary, results,
  };
  writeFileSync(path.join(dirs.root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  console.log(`\n══ hotovo: ${JSON.stringify(summary)}`);
  console.log(`   report: ${path.relative(ROOT, path.join(dirs.root, 'report.json'))}`);
  if (!opts.keep && exitCode === 0) console.log('   (běhový kořen zůstává; --keep-run-root je default pro artefakty)');
  if (results.some(r => r.status !== 'PASS')) exitCode = exitCode || 1;
  return exitCode;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
