// Code Patch Runner — od promptu k pass_rate na skutečném testu
// ══════════════════════════════════════════════════════════════════════════════
//
// Jak se měří schopnost opravit kód:
//
//   zdroják PŘED opravou + hlášená vada  →  model vrátí opravenou funkci
//   funkce se vloží zpátky do souboru    →  spustí se **skrytý** test
//   test projde  =  1,  neprojde  =  0
//
// Žádná klíčová slova.  Model nevidí, čím se ověřuje, takže se nedá trefit
// tvarem odpovědi — na rozdíl od sady `code`, kde `isPrime`, který nepočítá
// prvočísla, dostal 1.0 za to, že obsahoval `return` a cyklus.
//
// ─── Proč se posílá funkce, a ne soubor ──────────────────────────────────────
//
// Zdrojáky úloh mají 249 až 3531 řádků.  Změřeno 2026-08-20 na `qwen3-coder`:
// funkce o 87 řádcích = 780 tokenů odpovědi za 88 s, funkce o 228 řádcích =
// 1781 tokenů za 110 s.  Celý soubor o 3531 řádcích by byl řádově dvacet tisíc
// tokenů — mimo `num_ctx` i mimo rozumný čas.
//
// Kontrolní bod 2026-08-20 (3 úlohy, `qwen3-coder`) ukázal, že formát „vrať
// celou opravenou funkci" model drží spolehlivě: **3× ze 3** přišel přesně
// jeden blok ```javascript, od hlavičky po uzavírací závorku, s původním
// odsazením a bez vysvětlování.  Ani jednou nepřišel unified diff.  Proto se
// parser diffů nepíše.
//
// ─── Izolace ─────────────────────────────────────────────────────────────────
//
// Spouští se kód, který napsal model.  Proto: odhozený worktree (ne pracovní
// strom), podproces s timeoutem a **síťový namespace** — `unshare -rn` s
// nahozeným `lo`.  Loopback zůstává funkční, protože ho některé testy
// potřebují; ven se model nedostane (ověřeno: `EAI_AGAIN`).
//
// ─── Past, která stála první pokus ───────────────────────────────────────────
//
// `git show <ref>:<cesta>` a ruční zápis, nikdy `git checkout <ref> -- <cesta>`:
// checkout mění index hlavního repa i při zápisu do jiného `--work-tree`.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSpanForLines, replaceSpan } from './function-span.js';

export const DEFAULT_TEST_TIMEOUT = 120_000;

function git(repo, args, opts = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}

/**
 * Řádky, které commit v souboru změnil — zvlášť ve verzi před a po.
 *
 * `-U0` dá hunky bez kontextu, takže rozsahy odpovídají skutečné změně.
 * Hunk s nulovou délkou na straně „před" je čistý přírůstek; bere se řádek,
 * za který se vkládalo, aby se dala najít obklopující funkce.
 */
export function changedLines(repo, hash, source) {
  const diff = git(repo, ['diff', '-U0', `${hash}~1`, hash, '--', source]);
  const before = [], after = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const oldStart = +m[1], oldLen = m[2] === undefined ? 1 : +m[2];
    const newStart = +m[3], newLen = m[4] === undefined ? 1 : +m[4];
    if (oldLen === 0) before.push(oldStart);
    else for (let i = 0; i < oldLen; i++) before.push(oldStart + i);
    if (newLen === 0) after.push(newStart);
    else for (let i = 0; i < newLen; i++) after.push(newStart + i);
  }
  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  return { before: uniq(before), after: uniq(after) };
}

/**
 * Sestaví úlohu z commitu — bez spouštění testů, takže je to levné.
 *
 * Vrací `null` s důvodem, když se oprava nedá vyjádřit jako přepis jediné
 * funkce: změna sahající do importů i do těla metody (`bbec7635`) nebo do tří
 * různých míst souboru (`344d6d73`) se jako „přepiš tuhle funkci" zadat nedá.
 *
 * @returns {{task: Object|null, reason: string|null}}
 */
export function deriveTask(repo, meta) {
  const { hash, source, test } = meta;
  let beforeFile, afterFile;
  try {
    beforeFile = git(repo, ['show', `${hash}~1:${source}`]);
    afterFile = git(repo, ['show', `${hash}:${source}`]);
  } catch (err) {
    return { task: null, reason: `zdroják nelze načíst: ${err.message}` };
  }

  const lines = changedLines(repo, hash, source);
  const spanBefore = findSpanForLines(beforeFile, lines.before);
  if (!spanBefore) return { task: null, reason: 'změna není uvnitř jediné funkce (verze před)' };
  const spanAfter = findSpanForLines(afterFile, lines.after);
  if (!spanAfter) return { task: null, reason: 'změna není uvnitř jediné funkce (verze po)' };
  if (spanBefore.header !== spanAfter.header) {
    return { task: null, reason: 'oprava mění hlavičku funkce — jiná jednotka' };
  }

  return {
    task: {
      hash, source, test,
      subject: meta.subject,
      beforeFile,
      span: spanBefore,
      functionText: spanBefore.text,     // co dostane model
      goldText: spanAfter.text,          // referenční oprava
      functionLines: spanBefore.endLine - spanBefore.startLine + 1,
      requirements: addedTestNames(repo, hash, test),
    },
    reason: null,
  };
}

/**
 * Názvy testů, které commit přidal — použijí se jako popis požadovaného chování.
 *
 * Proč to tam musí být:
 *
 * Sonda 2026-08-20 na třech úlohách skončila 0/3, přestože model pokaždé vrátil
 * syntakticky platnou funkci a viditelně se o opravu pokusil.  Příčina nebyla
 * neschopnost, ale **nedostatečné zadání**: u `da03e8bd` zní předmět commitu
 * „preserve verification abort boundary", kdežto skrytý test vyžaduje, aby se
 * `clearTimeout` zavolalo *před* parsováním těla odpovědi.  To se z předmětu
 * uhodnout nedá a úloha by měřila čtení myšlenek, ne programování.
 *
 * Kde vede hranice anti-cheatu: model se dozví **co má platit** (požadavek,
 * přesně jak ho popisuje hlášení vady), ale ne **čím se to ověřuje** — vidí
 * název testu, ne jeho tělo, fixtury ani aserce.  Hodnocení zůstává spuštění
 * skutečného testu, takže v hodnoticí logice žádný termín z promptu není.
 */
export function addedTestNames(repo, hash, testFile) {
  let diff;
  try { diff = git(repo, ['show', hash, '--', testFile]); } catch { return []; }
  const names = [];
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+')) continue;
    const m = line.match(/^\+\s*(?:await\s+)?(?:test|testAsync|it)\(\s*(['"`])([^'"`]+)\1/);
    if (m) names.push(m[2]);
  }
  return names;
}

/**
 * Zadání pro model.
 *
 * Vada je popsaná předmětem commitu — tedy tím, co o ní bylo známo v okamžiku
 * opravy.  Test se **neukazuje** (anti-cheat pravidlo 3), stejně jako se
 * neukazuje gold patch.
 */
export function buildPrompt(task) {
  const fence = '```';
  const req = (task.requirements || []).length
    ? `\n\nPožadované chování:\n${task.requirements.map(r => `- ${r}`).join('\n')}`
    : '';
  return `Soubor: ${task.source}

Hlášená vada: ${task.subject}${req}

Následující funkce obsahuje tuto vadu:

${fence}javascript
${task.functionText}
${fence}

Oprav vadu. Vrať POUZE celou opravenou funkci v jednom bloku ${fence}javascript, `
    + `od hlavičky po uzavírací závorku. Žádné vysvětlení, žádný zbytek souboru.`;
}

/**
 * Vytáhne z odpovědi kód funkce.
 *
 * Bere **nejdelší** blok v trojitých zpětných apostrofech: když model přidá
 * krátkou ukázku „špatně/správně", je ta podstatná ta delší.  Bez bloku se
 * zkusí celá odpověď — model, který vrátí holý kód, není za formát trestán.
 */
export function extractFunctionCode(response) {
  if (!response || typeof response !== 'string') return null;
  const blocks = [...response.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map(m => m[1]);
  if (blocks.length) {
    return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trim();
  }
  const bare = response.trim();
  if (bare.includes('{') && bare.includes('}')) return bare;
  return null;
}

/** Nasměruje worktree na závislosti hlavního repa (bez toho každý test spadne). */
function linkDependencies(repo, work) {
  const target = path.join(repo, 'node_modules');
  if (!existsSync(target)) return;
  const link = path.join(work, 'node_modules');
  if (existsSync(link)) return;
  try { symlinkSync(target, link, 'dir'); } catch { /* pozná se na testu */ }
}

/** Spustí testový soubor v síťovém namespace bez cesty ven. */
export function runIsolatedTest(work, testFile, timeout = DEFAULT_TEST_TIMEOUT) {
  const env = { ...process.env, C3_DB_PATH: path.join(work, 'eval-scratch.sqlite') };
  const inner = `ip link set lo up 2>/dev/null; exec node ${JSON.stringify(testFile)}`;
  try {
    execFileSync('unshare', ['-rn', 'sh', '-c', inner], {
      cwd: work, timeout, stdio: 'ignore', env,
    });
    return { passed: true, timedOut: false };
  } catch (err) {
    return { passed: false, timedOut: err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM' };
  }
}

/**
 * Vloží kód do souboru, spustí skrytý test a vrátí výsledek.
 *
 * Skóre je binární: test projde, nebo neprojde.  `syntaxOk` se sleduje zvlášť
 * jako diagnostika — říká, jestli model selhal na pochopení vady, nebo už na
 * tvaru odpovědi.
 *
 * @returns {{score, passed, applied, syntaxOk, timedOut, reason}}
 */
export function applyAndTest(repo, task, code, opts = {}) {
  const timeout = opts.testTimeout ?? DEFAULT_TEST_TIMEOUT;
  const fail = (reason, extra = {}) => ({
    score: 0, passed: false, applied: false, syntaxOk: false, timedOut: false, reason, ...extra,
  });

  if (!code) return fail('odpověď neobsahuje použitelný kód');

  let patched;
  try {
    patched = replaceSpan(task.beforeFile, task.span.startLine, task.span.endLine, code, task.span.tail);
  } catch (err) {
    return fail(`vložení selhalo: ${err.message}`);
  }

  const work = mkdtempSync(path.join(tmpdir(), 'codepatch-'));
  try {
    git(repo, ['worktree', 'add', '-q', '--detach', work, task.hash]);
    linkDependencies(repo, work);

    const sourcePath = path.join(work, task.source);
    writeFileSync(sourcePath, patched);

    let syntaxOk = true;
    try { execFileSync('node', ['--check', sourcePath], { stdio: 'ignore', timeout: 30_000 }); }
    catch { syntaxOk = false; }
    if (!syntaxOk) return fail('vložený kód není syntakticky platný', { applied: true });

    const { passed, timedOut } = runIsolatedTest(work, task.test, timeout);
    return {
      score: passed ? 1 : 0,
      passed, applied: true, syntaxOk, timedOut,
      reason: passed ? null : (timedOut ? 'test vypršel' : 'test neprošel'),
    };
  } catch (err) {
    return fail(`chyba při aplikaci: ${err.message}`);
  } finally {
    try { git(repo, ['worktree', 'remove', '--force', work]); } catch { /* uklidí rmSync */ }
    try { rmSync(work, { recursive: true, force: true }); } catch { /* už je pryč */ }
  }
}

/**
 * Ověří, že je úloha použitelná: před opravou test padá, gold patch ho spraví.
 *
 * Tohle je kurátorský krok — co neprojde, se do sady nedostane.  Zásadní je,
 * že se gold patch ověřuje **stejnou cestou a ve stejné izolaci**, jakou
 * projde odpověď modelu.  Kdyby se ověřovalo volněji, sada by obsahovala
 * úlohy, které model nemůže splnit z důvodů mimo jeho schopnosti.
 */
export function verifyTask(repo, task, opts = {}) {
  const broken = applyAndTest(repo, task, task.functionText, opts);
  if (broken.passed) return { usable: false, reason: 'test projde i před opravou — úloha nic neměří' };
  if (!broken.applied || !broken.syntaxOk) return { usable: false, reason: `stav před opravou se nedá sestavit: ${broken.reason}` };

  const gold = applyAndTest(repo, task, task.goldText, opts);
  if (!gold.passed) return { usable: false, reason: `gold patch neprojde vlastním testem: ${gold.reason}` };

  return { usable: true, reason: null };
}

export default {
  changedLines, deriveTask, buildPrompt, extractFunctionCode,
  applyAndTest, verifyTask, runIsolatedTest, DEFAULT_TEST_TIMEOUT,
};
