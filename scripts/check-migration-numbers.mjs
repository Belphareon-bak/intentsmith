#!/usr/bin/env node
// Migration number allocation — check a number against the rest of development.
// ==============================================================================
//
// `discoverMigrations()` sorts lexicographically over the whole file name, and
// `schema_migrations.version` is the file name.  Two branches can therefore each
// add `..._058_...` without either one noticing: both are green in isolation,
// and the conflict only surfaces at merge, in a place where renaming a migration
// means renaming a row that production databases have already stamped.
//
// It has happened here.  `d6fee86f` had to move the mobile gateway migrations
// from 046/047/048 to 055/056/057 because the main line had taken those numbers
// while the mobile branch was 294 commits behind — and moving them meant moving
// the date prefix too, or they would have run before 046.
//
// So the next free number is not "one more than the highest number in my tree".
// It is one more than the highest number **anywhere development is happening**,
// which is what this script reports.
//
// Usage:
//   node scripts/check-migration-numbers.mjs          # collisions + next free
//   node scripts/check-migration-numbers.mjs --next   # just the next free number
//   node scripts/check-migration-numbers.mjs --all-branches
//
// Exit code:
//   0  no number in this tree is claimed by a different migration elsewhere
//   1  collision — two different migrations share a number
//
// Scope: every registered git worktree (its working tree, so uncommitted
// migrations count) plus `main` and this repository's HEAD branch.  Worktrees
// are the scope that matters: they are where parallel work actually lives.
// `--all-branches` widens it to every local branch outside `archive/`, which
// is noisier — superseded branches keep their old numbers forever.
//
// ==============================================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const MIGRATIONS_SUBDIR = path.join('src', 'db', 'migrations');
const FILE_PATTERN = /^(\d{4}_\d{2}_\d{2})_(\d{3})_([a-z0-9_]+)\.js$/;

const args = new Set(process.argv.slice(2));
const nextOnly = args.has('--next');
const allBranches = args.has('--all-branches');

function git(cwd, ...argv) {
  try {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Migration file names in a worktree's *working tree*, so uncommitted files count. */
function fromWorkingTree(worktree) {
  const dir = path.join(worktree, MIGRATIONS_SUBDIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js'));
}

/** Migration file names committed on a ref. */
function fromRef(ref) {
  const out = git(REPO, 'ls-tree', '--name-only', ref, `${MIGRATIONS_SUBDIR}/`);
  return out.split('\n').filter(Boolean).map(p => path.basename(p));
}

function worktrees() {
  const out = git(REPO, 'worktree', 'list', '--porcelain');
  const found = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9), branch: null };
    else if (line.startsWith('branch ') && current) current.branch = line.slice(7).replace('refs/heads/', '');
    else if (line === '' && current) { found.push(current); current = null; }
  }
  if (current) found.push(current);
  return found;
}

// ─── Collect ─────────────────────────────────────────────────────────────────

/** number → Map<stem, Set<source>> */
const claims = new Map();
/** number → Set<stem> — what this tree itself claims */
const localClaims = new Map();

function record(file, source, isLocal) {
  const match = FILE_PATTERN.exec(file);
  if (!match) return;
  const [, , number, stem] = match;
  if (!claims.has(number)) claims.set(number, new Map());
  const stems = claims.get(number);
  if (!stems.has(stem)) stems.set(stem, new Set());
  stems.get(stem).add(source);
  if (isLocal) {
    if (!localClaims.has(number)) localClaims.set(number, new Set());
    localClaims.get(number).add(stem);
  }
}

const here = git(REPO, 'rev-parse', '--show-toplevel').trim() || REPO;
for (const file of fromWorkingTree(here)) record(file, 'tento strom', true);

for (const wt of worktrees()) {
  if (path.resolve(wt.path) === path.resolve(here)) continue;
  const label = `worktree ${path.basename(wt.path)}${wt.branch ? ` (${wt.branch})` : ''}`;
  for (const file of fromWorkingTree(wt.path)) record(file, label, false);
}

const refs = new Set(['main']);
const head = git(REPO, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
if (head && head !== 'HEAD') refs.add(head);
if (allBranches) {
  for (const branch of git(REPO, 'branch', '--format=%(refname:short)').split('\n')) {
    if (branch && !branch.startsWith('archive/')) refs.add(branch);
  }
}
for (const ref of refs) {
  if (!git(REPO, 'rev-parse', '--verify', '--quiet', ref).trim()) continue;
  for (const file of fromRef(ref)) record(file, `větev ${ref}`, false);
}

// ─── Report ──────────────────────────────────────────────────────────────────

const numbers = [...claims.keys()].sort();
const highest = numbers[numbers.length - 1] ?? '000';
const next = String(Number(highest) + 1).padStart(3, '0');

if (nextOnly) {
  console.log(next);
  process.exit(0);
}

/**
 * Two migrations sharing a number is only a *conflict* when the two claims live
 * in different places.  008 and 030 share a number in every tree that exists —
 * they shipped that way, their full versions differ, and `schema_migrations` is
 * keyed on the full version, so nothing is ambiguous and nothing can be renamed
 * anyway.  What must fail is the divergent case: this tree calls 058 one thing
 * and something else out there calls it another.
 */
function describe(number) {
  const stems = claims.get(number);
  const mine = localClaims.get(number) ?? new Set();
  const foreign = [...stems.keys()].filter(stem => !mine.has(stem));
  return { stems, mine, foreign };
}

const divergent = numbers
  .map(n => ({ number: n, ...describe(n) }))
  .filter(c => c.mine.size > 0 && c.foreign.length > 0);

const sharedHere = numbers.filter(n => (localClaims.get(n)?.size ?? 0) > 1);

console.log(`\nMigrace: ${numbers.length} obsazených čísel, nejvyšší ${highest}`);
console.log(`Další volné číslo: ${next}\n`);

function sources(set) {
  const list = [...set];
  return list.length > 3 ? `${list.slice(0, 3).join(', ')} a ${list.length - 3} dalších` : list.join(', ');
}

if (sharedHere.length > 0) {
  console.log(`Sdílené číslo uvnitř stromu (historie, nepřečíslovatelné): ${sharedHere.join(', ')}`);
  for (const number of sharedHere) {
    console.log(`    ${number}: ${[...localClaims.get(number)].join(' + ')}`);
  }
  console.log('');
}

if (divergent.length === 0) {
  console.log('Žádné číslo tohohle stromu si nenárokuje jiná migrace jinde.\n');
  process.exit(0);
}

for (const collision of divergent) {
  console.log(`KOLIZE — ${collision.number}:`);
  for (const [stem, where] of collision.stems) {
    const mark = collision.mine.has(stem) ? '  zde ' : '  jinde';
    console.log(`  ${mark}  ${stem}  ←  ${sources(where)}`);
  }
  console.log('');
}

console.log(
  `${divergent.length} × číslo z tohohle stromu drží jinde jiná migrace.\n` +
  'Přečíslovat po nasazení znamená přejmenovat řádek, který už je\n' +
  `orazítkovaný v schema_migrations — přečísluj teď, na ${next} a výš.\n`
);
process.exit(1);
