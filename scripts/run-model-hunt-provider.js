#!/usr/bin/env node
// Own the evaluation sidecar only for the lifetime of one bounded hunt.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const runtime = process.env.INTENTSMITH_EVAL_RUNTIME || join(homedir(), '.local/share/intentsmith/evaluation-provider/0.34.0-intentsmith.1');
const binary = join(runtime, 'bin/ollama');
const expected = '8883245b864485a74ecccf62c4ce17d4538816cde4e37ea2107c2204d1d04ca7';
if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== expected) throw new Error('EVALUATION_PROVIDER_BINARY_MISMATCH');
execFileSync('sha256sum', ['--check', '--quiet', 'native.sha256'], { cwd: runtime, timeout: 60_000 });
const state = process.env.INTENTSMITH_HUNT_STATE_DIR || join(homedir(), '.local/state/intentsmith/model-hunt');
mkdirSync(state, { recursive: true, mode: 0o700 });
const runDir = mkdtempSync(join(state, 'run-'));
for (const name of ['home', 'tmp']) mkdirSync(join(runDir, name), { mode: 0o700 });
const port = createServer();
try {
  await new Promise((ok, fail) => { port.once('error', fail); port.listen(11435, '127.0.0.1', ok); });
} catch (error) {
  if (error.code !== 'EADDRINUSE') throw error;
  const result = { generatedAt: new Date().toISOString(), status: 'SCHEDULED_SKIPPED', reason: 'EVALUATION_PROVIDER_PORT_BUSY', results: [] };
  const requested = process.argv.slice(2).find(arg => arg.startsWith('--report='))?.slice(9);
  writeFileSync(requested || join(runDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  for (const name of ['home', 'tmp']) rmSync(join(runDir, name), { recursive: true, force: true });
  console.log(JSON.stringify(result));
  process.exit(0);
}
await new Promise(ok => port.close(ok));
let provider, hunt, stopping = false;
const stop = () => { stopping = true; hunt?.kill('SIGTERM'); provider?.kill('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  const fd = openSync(join(runDir, 'provider.log'), 'w', 0o600);
  provider = spawn('bwrap', [
    '--die-with-parent', '--new-session', '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc',
    '--bind', join(runDir, 'home'), join(homedir(), '.ollama'), '--bind', join(runDir, 'tmp'), '/tmp',
    '--setenv', 'OLLAMA_HOST', '127.0.0.1:11435',
    '--setenv', 'OLLAMA_MODELS', process.env.OLLAMA_MODELS || '/usr/share/ollama/.ollama/models',
    '--setenv', 'OLLAMA_NO_CLOUD', 'true', '--setenv', 'OLLAMA_NOPRUNE', 'true',
    '--setenv', 'OLLAMA_NUM_PARALLEL', '1', binary, 'serve',
  ], { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  let ready = false;
  for (let i = 0; i < 100 && !stopping; i++) {
    if (provider.exitCode !== null || provider.signalCode !== null) throw new Error(`Evaluation provider exited: ${provider.exitCode}`);
    try {
      const response = await fetch('http://127.0.0.1:11435/api/version', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).version === '0.34.0-intentsmith.1') { ready = true; break; }
    } catch { /* startup */ }
    await new Promise(ok => setTimeout(ok, 100));
  }
  if (!ready) throw new Error('EVALUATION_PROVIDER_START_FAILED');
  const args = process.argv.slice(2);
  const reportArgs = args.some(arg => arg.startsWith('--report=')) ? [] : [`--report=${join(runDir, 'result.json')}`];
  hunt = spawn(process.execPath, [join(root, 'scripts/model-upgrade-hunt.js'), ...args, ...reportArgs], {
    cwd: root,
    env: { ...process.env, OLLAMA_URL: 'http://127.0.0.1:11435', INTENTSMITH_HUNT_PULL_URL: 'http://127.0.0.1:11434' },
    stdio: 'inherit',
  });
  const [code] = await once(hunt, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (provider && provider.exitCode === null && provider.signalCode === null) {
    const ended = once(provider, 'exit');
    provider.kill('SIGTERM');
    await ended;
  }
  // Provider logs/results remain evidence; generated home keys and temp files do not.
  for (const name of ['home', 'tmp']) rmSync(join(runDir, name), { recursive: true, force: true });
}
