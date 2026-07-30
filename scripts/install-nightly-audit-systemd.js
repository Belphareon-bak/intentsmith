#!/usr/bin/env node

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
const artifactRoot = path.resolve(
  options.artifactRoot || path.join(repoRoot, '.intentsmith-artifacts', 'nightly'),
);
const worktreeRoot = path.resolve(
  options.worktreeRoot || path.join(repoRoot, '.intentsmith-artifacts', 'nightly', 'worktrees'),
);

const servicePath = path.join(unitDir, SERVICE_NAME);
const timerPath = path.join(unitDir, TIMER_NAME);

if (options.dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    status: 'DISABLED_GATE0',
    unitDir,
    servicePath,
    timerPath,
    artifactRoot,
    worktreeRoot,
    enableTimer: false,
    note: 'Legacy C3 unit installation is disabled until IntentSmith systemd migration is reviewed.',
  }, null, 2));
  process.exit(0);
}

throw new Error(
  'Systemd installation is disabled during Gate 0. Use --dry-run for inspection; ' +
  'migration and activation require a later reviewed change.',
);

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
  --enable               Legacy option; activation is disabled during Gate 0
  --no-enable            Legacy option; installation is disabled during Gate 0
  --dry-run              Inspect resolved legacy units without writing them
`);
}
