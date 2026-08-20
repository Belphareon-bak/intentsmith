// Code Task Extractor — evaluační úlohy vytěžené z vlastní historie oprav
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč z historie a ne z HumanEval:
//
// Naměřeno na tomhle repu — 1463 úprav existujících souborů proti 229 novým,
// 961 souborů `.js` a **ani jeden Python**, medián souboru 280 řádků.  Syntéza
// izolované funkce (HumanEval, MBPP) měří přesně to, co se tu nedělá.  Reálná
// práce je „oprav chybu v existujícím souboru", a přesně tak vypadají úlohy
// vytěžené z `fix` commitů.
//
// Orákulum je test, ne klíčová slova:
//
//   stav PŘED opravou  =  starý zdroják + nový test   → test musí SELHAT
//   stav PO opravě     =  nový zdroják + nový test    → test musí PROJÍT
//
// Úloha, u které tohle neplatí, se zahodí.  Verifikace tím dělá kurátorskou
// práci: co projde, je zaručeně reprodukovatelné.  Sonda 2026-08-20 ukázala
// úspěšnost 3/3.
//
// Testy tohohle repa běží 34–87 ms, takže orákulum je prakticky zadarmo a
// dovoluje ověřit každou úlohu, ne jen vzorek.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_MAX_DIFF_LINES = 40;
const DEFAULT_TEST_TIMEOUT = 120_000;

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

/**
 * Projde historii a najde commity, které mění zdroják i jeho test.
 *
 * Filtr na velikost diffu je praktický, ne principiální: patch do ~40 řádků
 * model vygeneruje za sekundy, kdežto přepis souboru o 700 řádcích trvá minuty
 * a celá sada by se nedala proběhnout dost často.
 */
export function findCandidates(repo, opts = {}) {
  const limit = opts.limit ?? 400;
  const maxDiff = opts.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES;
  const hashes = git(repo, ['log', `-${limit}`, '--no-merges', '--pretty=format:%H'])
    .split('\n').filter(Boolean);

  const out = [];
  for (const hash of hashes) {
    let files;
    try {
      files = git(repo, ['show', '--name-only', '--format=', hash]).split('\n').filter(Boolean);
    } catch { continue; }

    const sources = files.filter(f => /^src\/.*\.js$/.test(f));
    const tests = files.filter(f => /^tests\/.*\.test\.js$/.test(f));
    if (sources.length !== 1 || tests.length !== 1) continue;

    // Přesně jeden zdroják a jeden test: u víc souborů není jednoznačné, co má
    // model opravit, a úloha by měřila spíš schopnost uhodnout zadání.
    const [source] = sources;
    const [test] = tests;

    // Commit, který zdroják teprve zakládá, není oprava — neexistuje stav
    // „před", takže není co opravovat a úloha by neměla zadání.
    try {
      git(repo, ['cat-file', '-e', `${hash}~1:${source}`], { stdio: 'ignore' });
    } catch { continue; }

    let changed = 0;
    try {
      const stat = git(repo, ['show', '--numstat', '--format=', hash, '--', source]);
      for (const line of stat.split('\n').filter(Boolean)) {
        const [add, del] = line.split('\t');
        changed += (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
      }
    } catch { continue; }
    if (changed === 0 || changed > maxDiff) continue;

    const subject = git(repo, ['log', '-1', '--pretty=format:%s', hash]).trim();
    out.push({ hash, source, test, changedLines: changed, subject });
  }
  return out;
}

/**
 * Ověří, že se kandidát reprodukuje, a vrátí hotovou úlohu.
 *
 * Pracuje v odhozeném worktree, aby se nesahalo na pracovní strom.
 */
export function verifyCandidate(repo, candidate, opts = {}) {
  const timeout = opts.testTimeout ?? DEFAULT_TEST_TIMEOUT;
  const work = mkdtempSync(path.join(tmpdir(), 'evaltask-'));
  const result = { ...candidate, usable: false, reason: null, before: null, after: null };

  try {
    git(repo, ['worktree', 'add', '-q', '--detach', work, candidate.hash]);
    linkDependencies(repo, work);

    const sourcePath = path.join(work, candidate.source);
    const testPath = path.join(work, candidate.test);
    if (!existsSync(sourcePath) || !existsSync(testPath)) {
      result.reason = 'soubor nebo test v commitu chybí';
      return result;
    }

    const after = readFileSync(sourcePath, 'utf8');

    // Stav po opravě musí projít — jinak je test nestabilní nebo závislý na
    // prostředí a jako orákulum se nedá použít.
    if (!runTest(work, candidate.test, timeout)) {
      result.reason = 'test neprojde ani po opravě — nespolehlivé orákulum';
      return result;
    }

    // Vrátit jen zdroják na stav před opravou; test zůstává nový.
    //
    // Zásadní je použít `git show` a soubor zapsat ručně.  `git checkout <ref>
    // -- <cesta>` sice umí zapsat do jiného work-tree, ale **zároveň mění index
    // hlavního repa** — což při prvním běhu 2026-08-20 zaneslo do stage staré
    // verze šesti zdrojáků (766 smazaných řádků).  Pracovní strom to nepoškodilo,
    // ale commit by tiše vrátil několik oprav.  Extrakce úloh nesmí mít žádný
    // vedlejší účinek na repozitář, ze kterého těží.
    const before = git(repo, ['show', `${candidate.hash}~1:${candidate.source}`]);
    writeFileSync(sourcePath, before);

    if (before === after) {
      result.reason = 'zdroják se opravou nezměnil';
      return result;
    }

    // A teď to podstatné: test musí selhat, jinak úloha nic neměří.
    if (runTest(work, candidate.test, timeout)) {
      result.reason = 'test projde i před opravou — úloha nic neměří';
      return result;
    }

    result.usable = true;
    result.before = before;
    result.after = after;
    return result;
  } catch (err) {
    result.reason = `chyba při ověřování: ${err.message}`;
    return result;
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', work]); } catch { /* uklidí se níž */ }
    try { rmSync(work, { recursive: true, force: true }); } catch { /* už je pryč */ }
  }
}

/**
 * Nasměruje worktree na závislosti hlavního repa.
 *
 * `git worktree add` vytvoří jen sledované soubory, takže `node_modules` chybí
 * a **každý test skončí `ERR_MODULE_NOT_FOUND`** — bez tohohle kroku vypadalo
 * 15 ze 17 kandidátů jako „nespolehlivé orákulum", přestože byly v pořádku.
 * Symlink stačí; kopírovat stovky MB pro každou úlohu nemá smysl.
 */
function linkDependencies(repo, work) {
  const target = path.join(repo, 'node_modules');
  if (!existsSync(target)) return;
  const link = path.join(work, 'node_modules');
  if (existsSync(link)) return;
  try { symlinkSync(target, link, 'dir'); } catch { /* bez závislostí to pozná test */ }
}

/** Spustí jeden testovací soubor. Vrací true, když projde. */
export function runTest(workdir, testFile, timeout = DEFAULT_TEST_TIMEOUT) {
  try {
    execFileSync('node', [testFile], {
      cwd: workdir,
      timeout,
      stdio: 'ignore',
      env: { ...process.env, C3_DB_PATH: path.join(workdir, 'eval-scratch.sqlite') },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Vytěží zadaný počet ověřených úloh.
 *
 * @returns {{tasks: Array, rejected: Array, examined: number}}
 */
export function extractTasks(repo, opts = {}) {
  const wanted = opts.count ?? 20;
  const candidates = findCandidates(repo, opts);
  const tasks = [];
  const rejected = [];
  let examined = 0;

  for (const candidate of candidates) {
    if (tasks.length >= wanted) break;
    examined++;
    opts.onProgress?.(examined, candidates.length, tasks.length);
    const verified = verifyCandidate(repo, candidate, opts);
    if (verified.usable) tasks.push(verified);
    else rejected.push({ hash: candidate.hash, subject: candidate.subject, reason: verified.reason });
  }

  return { tasks, rejected, examined };
}

export default { findCandidates, verifyCandidate, runTest, extractTasks };
