#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX_NAMES = new Set(['runtime', 'home', 'repo', 'node_modules']);
const DEFAULT_CEILING = 3;

function parseArgs(argv) {
  const options = {
    mode: 'report',
    apply: false,
    json: false,
    repo: SCRIPT_ROOT,
    ceiling: DEFAULT_CEILING,
  };
  let modeSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === 'report' || argument === 'clean') {
      if (modeSeen) throw new Error('workspace-budget mode may be specified only once');
      options.mode = argument;
      modeSeen = true;
    } else if (argument === '--yes') {
      options.apply = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--repo') {
      index += 1;
      if (index >= argv.length) throw new Error('--repo requires a path');
      options.repo = argv[index];
    } else if (argument.startsWith('--repo=')) {
      options.repo = argument.slice('--repo='.length);
    } else if (argument === '--ceiling') {
      index += 1;
      if (index >= argv.length) throw new Error('--ceiling requires an integer');
      options.ceiling = Number(argv[index]);
    } else if (argument.startsWith('--ceiling=')) {
      options.ceiling = Number(argument.slice('--ceiling='.length));
    } else {
      throw new Error(`unknown workspace-budget argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.ceiling) || options.ceiling < 1) {
    throw new Error('--ceiling must be a positive integer');
  }
  if (options.mode !== 'clean' && options.apply) {
    throw new Error('--yes is valid only with clean');
  }
  return options;
}

function git(repo, args, { allowFailure = false, encoding = 'utf8' } = {}) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    encoding,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : String(result.stderr || '');
    throw new Error(`git ${args.join(' ')} failed: ${detail.trim()}`);
  }
  return result;
}

function canonicalRepo(requested) {
  const candidate = path.resolve(requested);
  const result = git(candidate, ['rev-parse', '--show-toplevel']);
  return realpathSync(String(result.stdout).trim());
}

function parseWorktrees(buffer) {
  const entries = [];
  let current = null;
  for (const field of buffer.toString('utf8').split('\0')) {
    if (field === '') {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }
    current ||= { path: null, head: null, branch: null, detached: false, prunable: false };
    if (field.startsWith('worktree ')) current.path = field.slice('worktree '.length);
    else if (field.startsWith('HEAD ')) current.head = field.slice('HEAD '.length);
    else if (field.startsWith('branch ')) current.branch = field.slice('branch '.length);
    else if (field === 'detached') current.detached = true;
    else if (field.startsWith('prunable')) current.prunable = true;
  }
  if (current?.path) entries.push(current);
  return entries;
}

function listWorktrees(repo) {
  const result = git(repo, ['worktree', 'list', '--porcelain', '-z'], { encoding: null });
  return parseWorktrees(result.stdout);
}

function gitStatus(worktreePath) {
  const result = git(worktreePath, ['status', '--porcelain=v1', '-z'], {
    allowFailure: true,
    encoding: null,
  });
  if (result.status !== 0) return { readable: false, dirty: true };
  return { readable: true, dirty: result.stdout.length > 0 };
}

function isAncestor(repo, ancestor, descendant) {
  if (!ancestor || !descendant || ancestor === descendant) return false;
  return git(repo, ['merge-base', '--is-ancestor', ancestor, descendant], {
    allowFailure: true,
  }).status === 0;
}

function activeCwds() {
  const roots = [];
  let entries = [];
  try {
    entries = readdirSync('/proc', { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const processRoot = `/proc/${entry.name}`;
    try {
      if (typeof process.getuid === 'function' && statSync(processRoot).uid !== process.getuid()) {
        continue;
      }
      roots.push(readlinkSync(`${processRoot}/cwd`));
    } catch {
      // Short-lived, foreign and non-dumpable desktop processes may hide cwd.
    }
  }
  return roots;
}

function pathContains(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function hasActiveProcess(target, cwdList) {
  return cwdList.some(cwd => pathContains(target, cwd));
}

function findNull(args) {
  const result = spawnSync('find', args, {
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`find failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function evidenceFiles(artifactRoot, { stopAfterFirst = false } = {}) {
  try {
    if (!lstatSync(artifactRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  const args = [
    artifactRoot,
    '-type', 'f',
    '(',
    '-name', 'report.json',
    '-o', '-name', 'checkpoint.json',
    '-o', '-name', 'inventory.json',
    '-o', '-path', '*/logs/*',
    ')',
  ];
  if (stopAfterFirst) args.push('-print', '-quit');
  else args.push('-print0');
  if (stopAfterFirst) {
    const result = spawnSync('find', args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error || result.status !== 0) return ['UNREADABLE'];
    return result.stdout.trim() ? [result.stdout.trim()] : [];
  }
  return findNull(args);
}

function directoryBytes(target) {
  const result = spawnSync('du', ['-x', '-s', '-B1', target], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  const value = Number(result.stdout.trim().split(/\s+/u)[0]);
  return Number.isFinite(value) ? value : null;
}

function worktreeReport(repo, ceiling) {
  const cwdList = activeCwds();
  const worktrees = listWorktrees(repo);
  const branchEntries = worktrees.filter(item => item.branch && item.head && !item.prunable);
  const equalHeadKeeper = new Map();
  for (const item of branchEntries) {
    const existing = equalHeadKeeper.get(item.head);
    if (!existing || item.path === repo || (existing.path !== repo && item.path.localeCompare(existing.path) < 0)) {
      equalHeadKeeper.set(item.head, item);
    }
  }
  const canonicalBranches = [...equalHeadKeeper.values()];
  const liveBranches = canonicalBranches.filter(item => !canonicalBranches.some(other => (
    other !== item && isAncestor(repo, item.head, other.head)
  )));

  const rows = worktrees.map(item => {
    const status = item.prunable ? { readable: false, dirty: true } : gitStatus(item.path);
    const inUse = !item.prunable && hasActiveProcess(item.path, cwdList);
    const artifactRoot = path.join(item.path, '.intentsmith-artifacts');
    const evidence = item.prunable ? ['UNREADABLE'] : evidenceFiles(artifactRoot, { stopAfterFirst: true });
    const containsEvidence = evidence.length > 0;
    let absorbedBy = null;
    if (item.branch && item.head) {
      const containers = liveBranches
        .filter(other => other !== item && (
          other.head === item.head || isAncestor(repo, item.head, other.head)
        ))
        .sort((left, right) => left.path.localeCompare(right.path));
      absorbedBy = containers[0]?.branch || null;
    }

    const reasons = [];
    if (item.detached || !item.branch) reasons.push('detached');
    if (item.prunable || !status.readable) reasons.push('unreadable');
    if (status.dirty) reasons.push('dirty');
    if (inUse) reasons.push('in-use');
    if (containsEvidence) reasons.push('evidence');
    if (!absorbedBy && item.branch) reasons.push('live-branch');
    const retirable = Boolean(absorbedBy) && reasons.length === 0;
    return {
      path: item.path,
      branch: item.branch ? item.branch.replace(/^refs\/heads\//u, '') : null,
      head: item.head,
      absorbedBy: absorbedBy?.replace(/^refs\/heads\//u, '') || null,
      retirable,
      reasons,
      dirty: status.dirty,
      inUse,
      containsEvidence,
      bytes: item.prunable ? null : directoryBytes(item.path),
    };
  });
  return {
    schemaVersion: 1,
    repo,
    ceilingIncludingPrimary: ceiling + 1,
    worktreeCount: rows.length,
    retirableCount: rows.filter(row => row.retirable).length,
    protectedCount: rows.filter(row => !row.retirable).length,
    rows,
  };
}

function sandboxDirectories(worktreePath) {
  const artifactRoot = path.join(worktreePath, '.intentsmith-artifacts');
  try {
    if (!lstatSync(artifactRoot).isDirectory()) return [];
  } catch {
    return [];
  }
  return findNull([
    artifactRoot,
    '-type', 'd',
    '(',
    '-name', 'runtime',
    '-o', '-name', 'home',
    '-o', '-name', 'repo',
    '-o', '-name', 'node_modules',
    ')',
    '-prune',
    '-print0',
  ]);
}

function assertSafeSandbox(worktreePath, target, cwdList) {
  const artifactRoot = realpathSync(path.join(worktreePath, '.intentsmith-artifacts'));
  const parent = realpathSync(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  if (!pathContains(artifactRoot, resolved) || !SANDBOX_NAMES.has(path.basename(target))) {
    throw new Error(`unsafe sandbox target: ${target}`);
  }
  const metadata = lstatSync(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`sandbox target is not an exact directory: ${target}`);
  }
  if (evidenceFiles(target, { stopAfterFirst: true }).length > 0) {
    throw new Error(`sandbox contains protected evidence: ${target}`);
  }
  if (hasActiveProcess(target, cwdList)) {
    throw new Error(`sandbox is in use by a live process: ${target}`);
  }
}

function sandboxPlan(repo) {
  const worktrees = listWorktrees(repo).filter(item => !item.prunable);
  const cwdList = activeCwds();
  const keep = [];
  const remove = [];
  const protectedTargets = [];
  for (const worktree of worktrees) {
    const status = gitStatus(worktree.path);
    const worktreeInUse = worktree.path !== repo && hasActiveProcess(worktree.path, cwdList);
    const worktreeReasons = [
      worktree.detached || !worktree.branch ? 'worktree-detached' : null,
      !status.readable ? 'worktree-unreadable' : null,
      status.dirty ? 'worktree-dirty' : null,
      worktreeInUse ? 'worktree-in-use' : null,
    ].filter(Boolean);
    const candidates = sandboxDirectories(worktree.path).map(target => ({
      target,
      runRoot: path.dirname(target),
      mtimeMs: statSync(target).mtimeMs,
      bytes: directoryBytes(target),
      evidence: evidenceFiles(target, { stopAfterFirst: true }).length > 0,
      inUse: hasActiveProcess(target, cwdList),
    }));
    const runTimes = new Map();
    for (const candidate of candidates) {
      runTimes.set(candidate.runRoot, Math.max(runTimes.get(candidate.runRoot) || 0, candidate.mtimeMs));
    }
    const newestRun = [...runTimes.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
    for (const candidate of candidates) {
      const record = { worktree: worktree.path, path: candidate.target, bytes: candidate.bytes };
      if (worktreeReasons.length > 0 || candidate.evidence || candidate.inUse) {
        protectedTargets.push({
          ...record,
          reasons: [
            ...worktreeReasons,
            candidate.evidence ? 'evidence' : null,
            candidate.inUse ? 'in-use' : null,
          ].filter(Boolean),
        });
      } else if (candidate.runRoot === newestRun) {
        keep.push(record);
      } else {
        remove.push(record);
      }
    }
  }
  return { cwdList, keep, remove, protectedTargets };
}

function cleanSandboxes(repo, apply) {
  const plan = sandboxPlan(repo);
  const removed = [];
  if (apply) {
    for (const target of plan.remove) {
      assertSafeSandbox(target.worktree, target.path, plan.cwdList);
      rmSync(target.path, { recursive: true, force: false, maxRetries: 0 });
      removed.push(target.path);
    }
  }
  return {
    schemaVersion: 1,
    repo,
    apply,
    outcome: apply ? 'APPLIED' : 'DRY_RUN',
    removable: plan.remove.map(item => item.path),
    removableBytes: plan.remove.reduce((total, item) => total + (item.bytes || 0), 0),
    removed,
    kept: plan.keep.map(item => item.path),
    protected: plan.protectedTargets,
  };
}

function humanBytes(bytes) {
  if (bytes === null) return '?';
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function printReport(report) {
  console.log(`Worktrees: ${report.worktreeCount} (guideline ${report.ceilingIncludingPrimary} including primary)`);
  console.log(`Retirable: ${report.retirableCount}; protected/live: ${report.protectedCount}`);
  for (const row of report.rows) {
    const state = row.retirable ? 'RETIRABLE' : 'PROTECTED';
    const branch = row.branch || `DETACHED@${row.head?.slice(0, 8) || 'unknown'}`;
    const reason = row.retirable ? `absorbed-by=${row.absorbedBy}` : row.reasons.join(',');
    console.log(`${state}\t${humanBytes(row.bytes)}\t${branch}\t${reason}\t${JSON.stringify(row.path)}`);
  }
}

function printClean(result) {
  console.log(
    `${result.outcome}: ${result.removable.length} removable (${humanBytes(result.removableBytes)}), `
      + `${result.kept.length} kept, ${result.protected.length} protected`,
  );
  for (const target of result.removable) console.log(`REMOVE\t${JSON.stringify(target)}`);
  for (const target of result.protected) console.log(`PROTECTED\t${target.reasons.join(',')}\t${JSON.stringify(target.path)}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = canonicalRepo(options.repo);
  const result = options.mode === 'report'
    ? worktreeReport(repo, options.ceiling)
    : cleanSandboxes(repo, options.apply);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (options.mode === 'report') printReport(result);
  else printClean(result);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`workspace-budget: ${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  assertSafeSandbox,
  cleanSandboxes,
  parseArgs,
  parseWorktrees,
  worktreeReport,
};
