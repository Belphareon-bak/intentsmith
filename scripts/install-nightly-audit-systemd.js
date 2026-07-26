#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SERVICE_NAME = 'c3-nightly-audit.service';
const TIMER_NAME = 'c3-nightly-audit.timer';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const options = parseArgs(process.argv.slice(2));
const unitDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user');
const artifactRoot = path.resolve(options.artifactRoot || path.join(repoRoot, '..', 'c3-nightly-artifacts'));
const worktreeRoot = path.resolve(options.worktreeRoot || path.join(repoRoot, '..', 'c3-nightly-worktrees'));

const replacements = {
  '@PROJECT_ROOT@': repoRoot,
  '@NODE_BIN@': process.execPath,
  '@ARTIFACT_ROOT@': artifactRoot,
  '@WORKTREE_ROOT@': worktreeRoot,
};

const rendered = {
  service: render(await readFile(path.join(repoRoot, 'systemd', 'user', `${SERVICE_NAME}.in`), 'utf8'), replacements),
  timer: render(await readFile(path.join(repoRoot, 'systemd', 'user', `${TIMER_NAME}.in`), 'utf8'), replacements),
};

const servicePath = path.join(unitDir, SERVICE_NAME);
const timerPath = path.join(unitDir, TIMER_NAME);

if (options.dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    unitDir,
    servicePath,
    timerPath,
    artifactRoot,
    worktreeRoot,
    enableTimer: options.enable,
  }, null, 2));
  process.exit(0);
}

await mkdir(unitDir, { recursive: true });
await writeFile(servicePath, rendered.service);
await writeFile(timerPath, rendered.timer);

runSystemctl(['--user', 'daemon-reload']);
if (options.enable) {
  runSystemctl(['--user', 'enable', TIMER_NAME]);
}

console.log(JSON.stringify({
  servicePath,
  timerPath,
  artifactRoot,
  worktreeRoot,
  timerEnabled: options.enable,
  note: 'The service was not started by this installer.',
}, null, 2));

function parseArgs(argv) {
  const opts = {
    artifactRoot: null,
    worktreeRoot: null,
    enable: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const eq = arg.indexOf('=');
      if (eq !== -1) return arg.slice(eq + 1);
      i += 1;
      return argv[i];
    };

    if (arg === '--enable') opts.enable = true;
    else if (arg === '--no-enable') opts.enable = false;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--artifact-root')) opts.artifactRoot = value();
    else if (arg.startsWith('--worktree-root')) opts.worktreeRoot = value();
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/install-nightly-audit-systemd.js [options]

Options:
  --artifact-root=PATH   Durable audit artifact root
  --worktree-root=PATH   Disposable audit worktree root
  --enable               Enable the user timer after installing units
  --no-enable            Install units without enabling the timer, default
  --dry-run              Print resolved paths without writing units
`);
}

function render(template, values) {
  let output = template;
  for (const [token, value] of Object.entries(values)) {
    output = output.split(token).join(value);
  }
  return output;
}

function runSystemctl(args) {
  const result = spawnSync('systemctl', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`systemctl ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
}
