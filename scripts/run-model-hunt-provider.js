#!/usr/bin/env node
// Own the evaluation sidecar only for the lifetime of one bounded hunt.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { analyzeHuntDecisions } from '../src/upgrade/model-hunt-diagnostics.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtime = process.env.INTENTSMITH_EVAL_RUNTIME || join(homedir(), '.local/share/intentsmith/evaluation-provider/0.34.0-intentsmith.1');
const binary = join(runtime, 'bin/ollama');
const expected = '8883245b864485a74ecccf62c4ce17d4538816cde4e37ea2107c2204d1d04ca7';
const state = process.env.INTENTSMITH_HUNT_STATE_DIR || join(homedir(), '.local/state/intentsmith/model-hunt');
mkdirSync(state, { recursive: true, mode: 0o700 });
const runDir = mkdtempSync(join(state, 'run-'));
mkdirSync(join(runDir, 'tmp'), { mode: 0o700 });
const startedAt = new Date().toISOString();
const currentFile = join(state, 'current.json');
const publish = values => {
  const next = `${currentFile}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify({ schemaVersion: 1, runId: basename(runDir), startedAt,
    sourceRoot: root, ...values }) + '\n', { mode: 0o600 });
  renameSync(next, currentFile);
};
const port = createServer();
try {
  await new Promise((ok, fail) => { port.once('error', fail); port.listen(11435, '127.0.0.1', ok); });
} catch (error) {
  if (error.code !== 'EADDRINUSE') throw error;
  const result = { generatedAt: new Date().toISOString(), status: 'SCHEDULED_SKIPPED', reason: 'EVALUATION_PROVIDER_PORT_BUSY', results: [] };
  publish({ status: result.status, finishedAt: result.generatedAt, reasons: [result.reason] });
  const requested = process.argv.slice(2).find(arg => arg.startsWith('--report='))?.slice(9);
  writeFileSync(requested || join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  rmSync(join(runDir, 'tmp'), { recursive: true, force: true });
  console.log(JSON.stringify(result));
  process.exit(0);
}
await new Promise(ok => port.close(ok));
publish({ status: 'RUNNING', phase: 'provider-start' });
let provider, hunt, providerError, stopping = false;
const delay = ms => new Promise(ok => setTimeout(ok, ms));
// Ollama's native runners inherit its process group. Killing only the Go
// parent can leave a llama-server holding GPU memory after cancellation.
const signalProviderGroup = signal => {
  if (!provider?.pid) return false;
  try { process.kill(-provider.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const stop = () => { stopping = true; hunt?.kill('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== expected) throw new Error('EVALUATION_PROVIDER_BINARY_MISMATCH');
  execFileSync('sha256sum', ['--check', '--quiet', 'native.sha256'], { cwd: runtime, timeout: 60_000 });
  const fd = openSync(join(runDir, 'provider.log'), 'w', 0o600);
  provider = spawn(binary, ['serve'], {
    detached: true,
    env: {
      ...process.env,
      OLLAMA_HOST: '127.0.0.1:11435',
      OLLAMA_MODELS: process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models',
      OLLAMA_NO_CLOUD: 'true', OLLAMA_NOPRUNE: 'true', OLLAMA_NUM_PARALLEL: '1',
      TMPDIR: join(runDir, 'tmp'),
    },
    stdio: ['ignore', fd, fd],
  });
  provider.on('error', error => { providerError = error; });
  closeSync(fd);
  let ready = false;
  for (let i = 0; i < 100 && !stopping; i++) {
    if (providerError) throw providerError;
    if (provider.exitCode !== null || provider.signalCode !== null) throw new Error(`Evaluation provider exited: ${provider.exitCode}`);
    try {
      const response = await fetch('http://127.0.0.1:11435/api/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).version === '0.34.0-intentsmith.1') { ready = true; break; }
    } catch { /* startup */ }
    await delay(100);
  }
  if (!ready) throw new Error('EVALUATION_PROVIDER_START_FAILED');
  const args = process.argv.slice(2);
  const reportArgs = args.some(arg => arg.startsWith('--report=')) ? [] : [`--report=${join(runDir, 'result.json')}`];
  hunt = spawn(process.execPath, [join(root, 'scripts/model-upgrade-hunt.js'), ...args, ...reportArgs], {
    cwd: root,
    env: { ...process.env, OLLAMA_URL: 'http://127.0.0.1:11435', INTENTSMITH_HUNT_PULL_URL: 'http://127.0.0.1:11434',
      INTENTSMITH_HUNT_PROGRESS_FILE: join(runDir, 'progress.json') },
    stdio: 'inherit',
  });
  const [code] = await once(hunt, 'exit');
  process.exitCode = code ?? 1;
  let report = null;
  try { report = JSON.parse(readFileSync(args.find(arg => arg.startsWith('--report='))?.slice(9) || join(runDir, 'result.json'), 'utf8')); }
  catch { /* Missing report is explicit; a successful exit alone is not a completed measurement. */ }
  publish({ status: stopping ? 'CANCELLED' : code !== 0 ? 'FAILED' : report?.status || (report ? 'COMPLETE' : 'REPORT_MISSING'),
    finishedAt: new Date().toISOString(), exitCode: code,
    reasons: report?.reasons || [], diagnostics: analyzeHuntDecisions(report?.results || []), results: (report?.results || []).map(r => ({
      model: r.model, stage: r.stage, error: r.error || null, roleErrors: r.roleErrors?.length || 0,
      decisions: (r.trials || []).map(t => ({ role: t.role, reason: t.decision?.reasonCode, winner: t.decision?.winner })),
    })) });
} catch (error) {
  publish({ status: stopping ? 'CANCELLED' : 'FAILED', finishedAt: new Date().toISOString(), error: error.message });
  throw error;
} finally {
  signalProviderGroup('SIGTERM');
  for (let i = 0; i < 50 && signalProviderGroup(0); i++) await delay(100);
  signalProviderGroup('SIGKILL');
  // Keep logs/results as evidence. The service cgroup also owns every child,
  // including on an uncatchable wrapper failure (systemd KillMode=control-group).
  rmSync(join(runDir, 'tmp'), { recursive: true, force: true });
}
