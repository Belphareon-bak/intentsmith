#!/usr/bin/env node
// Own the evaluation sidecar only for the lifetime of one bounded hunt.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { analyzeHuntDecisions, inspectHuntGpu, inspectHuntResources, watchHuntResources } from '../src/upgrade/model-hunt-diagnostics.js';
import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { EVALUATION_PROVIDER_BUILD, CONVERSATION_PROVIDER_BUILD } from '../src/eval/evaluation-provider-build.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const codePilot = process.argv.includes('--code-pilot');
const allRolePilot = process.argv.includes('--all-role-pilot');
const roleHandoff = process.argv.includes('--role-handoff');
const conversationHandoff = process.argv.includes('--conversation-handoff');
const gradeCollection = process.argv.includes('--grade-collection');
const collectionStage = process.argv.includes('--collection-stage');
if ([codePilot,allRolePilot,roleHandoff,conversationHandoff,gradeCollection,collectionStage].filter(Boolean).length > 1) throw new Error('Choose one evaluation entrypoint');
const providerBuild = conversationHandoff ? CONVERSATION_PROVIDER_BUILD : EVALUATION_PROVIDER_BUILD;
const providerVersion = providerBuild.version;
const runtime = process.env.INTENTSMITH_EVAL_RUNTIME || join(homedir(), '.local/share/intentsmith/evaluation-provider', providerVersion);
const binary = join(runtime, 'bin/ollama');
const expected = providerBuild.sha256;
const state = process.env.INTENTSMITH_HUNT_STATE_DIR || join(homedir(), '.local/state/intentsmith/model-hunt');
mkdirSync(state, { recursive: true, mode: 0o700 });
const runDir = mkdtempSync(join(state, 'run-'));
mkdirSync(join(runDir, 'tmp'), { mode: 0o700 });
const startedAt = new Date().toISOString();
const argument = name => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const request = { kind: collectionStage ? 'collection-stage' : gradeCollection ? 'grading' : conversationHandoff ? 'conversation-handoff' : roleHandoff ? 'role-handoff' : allRolePilot ? 'all-role-pilot' : codePilot ? 'code-pilot' : process.argv.includes('--evaluate-installed') ? 'evaluation' : 'hunt',
  model: argument('only'), role: argument('role') };
const currentFile = join(state, 'current.json');
const publish = values => {
  const next = `${currentFile}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify({ schemaVersion: 1, runId: basename(runDir), startedAt,
    sourceRoot: root, request, ...values }) + '\n', { mode: 0o600 });
  renameSync(next, currentFile);
  writeFileSync(join(runDir, 'summary.json'), readFileSync(currentFile), {mode:0o600});
};
// Manual and scheduled units must not race for the provider or overwrite the
// active run's status. The child separately owns the shared GPU evaluation lock.
const providerLease = (() => {
  try { return holdGpuEvaluationLock({ lockPath: join(state, 'provider.lock') }); }
  catch (error) {
    if (error.code !== 'GPU_EVALUATION_BUSY') throw error;
    const result = { generatedAt: new Date().toISOString(), status: 'SCHEDULED_SKIPPED', reason: 'EVALUATION_PROVIDER_BUSY', results: [] };
    writeFileSync(join(runDir, 'result.json'), JSON.stringify(result) + '\n', { mode: 0o600 });
    rmSync(join(runDir, 'tmp'), { recursive: true, force: true });
    console.log(JSON.stringify(result));
    process.exit(0);
  }
})();
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
let provider, hunt, providerError, resourceBlock, stopResourceWatch, killDeadline, stopping = false;
const cancellation = new AbortController();
const delay = ms => new Promise(ok => setTimeout(ok, ms));
// Ollama's native runners inherit its process group. Killing only the Go
// parent can leave a llama-server holding GPU memory after cancellation.
const signalGroup = (child, signal) => {
  if (!child?.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const signalProviderGroup = signal => signalGroup(provider, signal);
const stop = () => { stopping = true; cancellation.abort(); signalGroup(hunt, 'SIGTERM'); signalProviderGroup('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  const resourcePaths = [state, dirname(process.env.INTENTSMITH_DB_PATH || join(root, 'data/c3.db')),
    process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models'];
  const saveResources = snapshot => {
    const file = join(runDir, 'resources.json');
    writeFileSync(file + '.tmp', JSON.stringify(snapshot) + '\n', {mode:0o600});
    renameSync(file + '.tmp', file);
  };
  const initialResources = inspectHuntResources(resourcePaths, {starting:true});
  saveResources(initialResources);
  if (!initialResources.ready) throw Object.assign(new Error(initialResources.code), {code:initialResources.code});
  stopResourceWatch = watchHuntResources({inspect:() => inspectHuntResources(resourcePaths), onSnapshot:saveResources,
    onBlocked:snapshot => {
      resourceBlock = snapshot; stop(); signalProviderGroup('SIGTERM');
      killDeadline = setTimeout(() => { signalGroup(hunt, 'SIGKILL'); signalProviderGroup('SIGKILL'); }, 8000);
      killDeadline.unref();
    }});
  const gpu = await inspectHuntGpu();
  if (!gpu.available) throw Object.assign(new Error(gpu.message), { code: gpu.code });
  if (createHash('sha256').update(await readFile(binary)).digest('hex') !== expected) throw new Error('EVALUATION_PROVIDER_BINARY_MISMATCH');
  await promisify(execFile)('sha256sum', ['--check', '--quiet', 'native.sha256'], {
    cwd: runtime, timeout: 60_000, signal: cancellation.signal,
  });
  if (stopping) throw new Error('HUNT_CANCELLED');
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
      if (response.ok && (await response.json()).version === providerVersion) { ready = true; break; }
    } catch { /* startup */ }
    await delay(100);
  }
  if (stopping) throw new Error('HUNT_CANCELLED');
  if (!ready) throw new Error('EVALUATION_PROVIDER_START_FAILED');
  const args = process.argv.slice(2).filter(arg => !['--code-pilot','--all-role-pilot','--role-handoff','--conversation-handoff','--grade-collection','--collection-stage'].includes(arg));
  const reportArgs = args.some(arg => arg.startsWith('--report=')) ? [] : [`--report=${join(runDir, 'result.json')}`];
  let failureOutput = '';
  // Fixed manual CODE entrypoint only; no arbitrary command execution surface.
  const entrypoint = collectionStage ? 'scripts/manual/collect-chat-conversation.mjs' : gradeCollection ? 'scripts/grade-model-collection.js' : conversationHandoff ? 'scripts/manual/conversation-operational-handoff.mjs' : roleHandoff ? 'scripts/manual/role-operational-handoff.mjs' : allRolePilot ? 'scripts/manual/all-role-evaluation.mjs'
    : codePilot ? 'scripts/manual/c3-code-pilot.mjs' : 'scripts/model-upgrade-hunt.js';
  hunt = spawn(process.execPath, [join(root, entrypoint), ...args, ...reportArgs], {
    detached: true,
    cwd: root,
    env: { ...process.env, OLLAMA_URL: 'http://127.0.0.1:11435', INTENTSMITH_HUNT_PULL_URL: 'http://127.0.0.1:11434',
      INTENTSMITH_EVAL_PROVIDER_PID: String(provider.pid),
      INTENTSMITH_HUNT_PROGRESS_FILE: join(runDir, 'progress.json') },
    stdio: ['inherit', 'inherit', 'pipe'],
  });
  hunt.stderr.on('data', chunk => { process.stderr.write(chunk); failureOutput = (failureOutput + chunk.toString()).slice(-8192); });
  const [code] = await once(hunt, 'exit');
  // An operator cancellation is a recorded cancellation, not a crashed unit.
  process.exitCode = stopping ? 0 : code ?? 1;
  let report = null;
  try { report = JSON.parse(readFileSync(args.find(arg => arg.startsWith('--report='))?.slice(9) || join(runDir, 'result.json'), 'utf8')); }
  catch { /* Missing report is explicit; a successful exit alone is not a completed measurement. */ }
  publish({ status: resourceBlock ? 'BLOCKED' : stopping ? 'CANCELLED' : code !== 0 ? 'FAILED' : report?.status || (report ? 'COMPLETE' : 'REPORT_MISSING'),
    finishedAt: new Date().toISOString(), exitCode: code,
    ...(gradeCollection ? {request:{...request,model:report?.model || null,role:report?.role || null}} : {}),
    code: resourceBlock?.code || report?.code || /Error:\s*([A-Z][A-Z0-9_]{3,})/.exec(failureOutput)?.[1] || null,
    resources: resourceBlock || null,
    error: code !== 0 ? (report?.error || failureOutput.trim() || 'Proces měření skončil bez výsledku; podrobnosti jsou v systémovém logu.') : null,
    reasons: report?.reasons || [], blockedRoles: report?.blockedRoles || [],
    diagnostics: analyzeHuntDecisions(report?.results || []), results: (report?.results || []).map(r => ({
      model: r.model, stage: r.stage, error: r.error || null, roleErrors: r.roleErrors?.length || 0,
      roleFailures: (r.roleErrors || []).map(f => ({ role: f.role, model: f.model, code: f.code, error: f.error, failedTasks: f.failedTasks || [] })),
      evaluations: (r.trials || []).filter(t => t.evaluation).map(t => ({role:t.role, score:t.evaluation.score, collection:t.evaluation.collection||null, reused:t.evaluation.reused === true})),
      decisions: (r.trials || []).filter(t => t.decision).map(t => ({ role: t.role, reason: t.decision?.reasonCode, winner: t.decision?.winner })),
    })) });
} catch (error) {
  const blocked = Boolean(resourceBlock) || ['GPU_DRIVER_LIBRARY_MISMATCH','GPU_PROBE_UNAVAILABLE','HUNT_MEMORY_RESERVE_LOW','HUNT_DISK_RESERVE_LOW','HUNT_RESOURCE_PROBE_FAILED'].includes(error.code);
  const result = { status: blocked ? 'BLOCKED' : stopping ? 'CANCELLED' : 'FAILED', finishedAt: new Date().toISOString(), error: error.message, code: resourceBlock?.code || error.code || null, resources:resourceBlock || null, results: [] };
  publish(result);
  writeFileSync(join(runDir,'result.json'), JSON.stringify(result) + '\n', {mode:0o600});
  if (!stopping && !blocked) throw error;
  process.exitCode = 0;
} finally {
  stopResourceWatch?.(); clearTimeout(killDeadline);
  signalGroup(hunt, 'SIGTERM');
  signalProviderGroup('SIGTERM');
  for (let i = 0; i < 50 && (signalProviderGroup(0) || signalGroup(hunt, 0)); i++) await delay(100);
  signalGroup(hunt, 'SIGKILL');
  signalProviderGroup('SIGKILL');
  // Keep logs/results as evidence. The service cgroup also owns every child,
  // including on an uncatchable wrapper failure (systemd KillMode=control-group).
  rmSync(join(runDir, 'tmp'), { recursive: true, force: true });
  providerLease.release();
}
