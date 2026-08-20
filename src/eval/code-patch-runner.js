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
import { findSpansForLines, replaceSpans } from './function-span.js';

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
 * Zadáním je **množina funkcí**, do kterých commit sáhl.  Jedna funkce je jen
 * nejčastější případ: měřeno na 805 commitech tohohle repa mění 19 z 29 jinak
 * použitelných kandidátů víc míst v jednom souboru, takže omezení na jedinou
 * funkci zahazovalo dvě třetiny materiálu.
 *
 * Vrací `null` s důvodem, když některý změněný řádek neleží v žádné funkci —
 * úprava importu nebo konstanty na nejvyšší úrovni se jako „přepiš tyhle
 * funkce" zadat nedá.
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
  const spansBefore = findSpansForLines(beforeFile, lines.before);
  if (!spansBefore) return { task: null, reason: 'změna zasahuje mimo funkce (verze před)' };
  const spansAfter = findSpansForLines(afterFile, lines.after);
  if (!spansAfter) return { task: null, reason: 'změna zasahuje mimo funkce (verze po)' };

  // Počet i hlavičky musí sedět, jinak commit funkce přidával nebo přejmenoval
  // a „přepiš tyhle funkce" by neodpovídalo tomu, co se ve skutečnosti stalo.
  if (spansBefore.length !== spansAfter.length) {
    return { task: null, reason: `počet dotčených funkcí se liší (${spansBefore.length} → ${spansAfter.length})` };
  }
  for (let i = 0; i < spansBefore.length; i++) {
    if (spansBefore[i].header !== spansAfter[i].header) {
      return { task: null, reason: 'oprava mění hlavičku funkce — jiná jednotka' };
    }
  }

  const functionLines = spansBefore.reduce((sum, sp) => sum + (sp.endLine - sp.startLine + 1), 0);

  return {
    task: {
      hash, source, test,
      subject: meta.subject,
      beforeFile,
      spans: spansBefore,
      functionTexts: spansBefore.map(sp => sp.text),   // co dostane model
      goldTexts: spansAfter.map(sp => sp.text),        // referenční oprava
      functionCount: spansBefore.length,
      functionLines,
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
 * Vada je popsaná předmětem commitu a názvy testů, které k ní autor napsal —
 * tedy tím, co má platit.  Test se **neukazuje** (anti-cheat pravidlo 3),
 * stejně jako se neukazuje gold patch.
 */
export function buildPrompt(task) {
  const fence = '```';
  const req = (task.requirements || []).length
    ? `\n\nPožadované chování:\n${task.requirements.map(r => `- ${r}`).join('\n')}`
    : '';

  const many = task.functionTexts.length > 1;
  const blocks = task.functionTexts
    .map((text, i) => `${many ? `Funkce ${i + 1}:\n\n` : ''}${fence}javascript\n${text}\n${fence}`)
    .join('\n\n');

  const instruction = many
    ? `Oprav vadu. Vrať POUZE ${task.functionTexts.length} bloků ${fence}javascript — každou funkci celou, `
      + 'od hlavičky po uzavírací závorku, ve stejném pořadí jako v zadání. '
      + 'Žádné vysvětlení, žádný zbytek souboru.'
    : `Oprav vadu. Vrať POUZE celou opravenou funkci v jednom bloku ${fence}javascript, `
      + 'od hlavičky po uzavírací závorku. Žádné vysvětlení, žádný zbytek souboru.';

  return `Soubor: ${task.source}

Hlášená vada: ${task.subject}${req}

${many ? 'Vadu obsahují tyto funkce:' : 'Následující funkce obsahuje tuto vadu:'}

${blocks}

${instruction}`;
}

/** Všechny bloky v trojitých zpětných apostrofech, v pořadí, jak přišly. */
function fencedBlocks(response) {
  return [...response.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map(m => m[1].trim());
}

/** Jméno funkce z hlavičky — slouží k přiřazení bloků k rozsahům. */
export function functionNameOf(header) {
  const m = header.match(/([A-Za-z_$#][\w$]*)\s*\(/);
  return m ? m[1] : null;
}

/**
 * Vytáhne z odpovědi kód jedné funkce.
 *
 * Bere **nejdelší** blok: když model přidá krátkou ukázku „špatně/správně",
 * je ta podstatná ta delší.  Bez bloku se zkusí celá odpověď — model, který
 * vrátí holý kód, není za formát trestán.
 */
export function extractFunctionCode(response) {
  if (!response || typeof response !== 'string') return null;
  const blocks = fencedBlocks(response);
  if (blocks.length) return blocks.reduce((a, b) => (b.length > a.length ? b : a));
  const bare = response.trim();
  if (bare.includes('{') && bare.includes('}')) return bare;
  return null;
}

/**
 * Vytáhne kód pro **každý** dotčený rozsah.
 *
 * Když bloků přijde přesně tolik, kolik se čekalo, berou se v pořadí.  Když
 * jich model pošle víc (rozepsal se, přidal ukázku), přiřadí se podle jména
 * funkce v hlavičce — pořadí samo o sobě není spolehlivé.  Když se ani tak
 * nepodaří obsadit všechny rozsahy, úloha propadá: neúplná odpověď se nedá
 * aplikovat a hádat, co model myslel, by měření zkreslilo.
 *
 * @returns {string[]|null} kód pro každý rozsah, ve stejném pořadí
 */
export function extractFunctionCodes(response, spans) {
  if (!response || typeof response !== 'string') return null;
  if (spans.length === 1) {
    const single = extractFunctionCode(response);
    return single ? [single] : null;
  }

  const blocks = fencedBlocks(response);
  if (blocks.length === spans.length) return blocks;
  if (blocks.length < spans.length) return null;

  const used = new Set();
  const matched = spans.map(span => {
    const name = functionNameOf(span.header);
    if (!name) return null;
    const idx = blocks.findIndex((b, i) => !used.has(i) && b.includes(name));
    if (idx === -1) return null;
    used.add(idx);
    return blocks[idx];
  });
  return matched.every(Boolean) ? matched : null;
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
  const inner = `ip link set lo up 2>/dev/null; exec node ${JSON.stringify(testFile)} 2>&1`;
  try {
    const out = execFileSync('unshare', ['-rn', 'sh', '-c', inner], {
      cwd: work, timeout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, timedOut: false, output: out || '' };
  } catch (err) {
    return {
      passed: false,
      timedOut: err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM',
      output: `${err.stdout || ''}${err.stderr || ''}`,
    };
  }
}

/**
 * Rozebere výstup testovacího harnessu na jednotlivé testy.
 *
 * Harness tiskne `  ✅ název` a `  ❌ název: chyba`, na konci ještě souhrn
 * selhání ve tvaru `    ❌ [sada] název: chyba` — proto množiny, aby se tentýž
 * test nezapočítal dvakrát.
 *
 * @returns {{passed: Set<string>, failed: Set<string>, totals: {passed, failed}|null}}
 */
export function parseTestOutput(output) {
  const passed = new Set();
  const failed = new Set();
  for (const line of (output || '').split('\n')) {
    const ok = line.match(/^\s*✅\s+(.+?)\s*$/);
    if (ok) { passed.add(ok[1]); continue; }
    const bad = line.match(/^\s*❌\s+(?:\[[^\]]*\]\s+)?(.+?):\s/);
    if (bad) failed.add(bad[1]);
  }
  const m = (output || '').match(/RESULTS:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  return { passed, failed, totals: m ? { passed: +m[1], failed: +m[2] } : null };
}

/**
 * Skóre z výsledků testů.
 *
 * Proč ne „prošel celý soubor / neprošel":
 *
 * Testový soubor úlohy obsahuje desítky testů, z nichž se opravy týkají jen ty,
 * které commit přidal — u `da03e8bd` je to 1 test z 34.  Binární hodnocení
 * celého souboru pak sype nulu i modelu, který z požadovaného chování zvládl
 * část, a stírá rozdíly mezi modely.  Skóre proto počítá **podíl splněných
 * požadavků**, tedy testů, které autor s opravou napsal.
 *
 * Regrese ruší zisk: oprava, která rozbije jiné chování, není oprava.  Proto
 * jakýkoli pád mimo cílové testy sráží skóre na nulu.
 *
 * Když se cílové testy nedají určit (commit je nepojmenoval), padá se zpátky na
 * binární výsledek celého souboru.
 */
export function scoreFromOutput(output, requirements, filePassed) {
  const targeted = (requirements || []).filter(Boolean);
  if (!targeted.length) {
    return { score: filePassed ? 1 : 0, passed: filePassed, targeted: 0, targetedPassed: 0, regressions: [] };
  }

  const parsed = parseTestOutput(output);
  const targetedPassed = targeted.filter(name => parsed.passed.has(name)).length;
  const regressions = [...parsed.failed].filter(name => !targeted.includes(name));

  const score = regressions.length ? 0 : targetedPassed / targeted.length;
  return {
    score,
    passed: score === 1,
    targeted: targeted.length,
    targetedPassed,
    regressions,
  };
}

/**
 * Vloží kód do souboru, spustí skrytý test a vrátí výsledek.
 *
 * Skóre je binární: test projde, nebo neprojde.  `syntaxOk` se sleduje zvlášť
 * jako diagnostika — říká, jestli model selhal na pochopení vady, nebo už na
 * tvaru odpovědi.
 *
 * @param {string[]|string|null} codes kód pro každý dotčený rozsah
 * @returns {{score, passed, applied, syntaxOk, timedOut, reason}}
 */
export function applyAndTest(repo, task, codes, opts = {}) {
  const timeout = opts.testTimeout ?? DEFAULT_TEST_TIMEOUT;
  const fail = (reason, extra = {}) => ({
    score: 0, passed: false, applied: false, syntaxOk: false, timedOut: false, reason, ...extra,
  });

  const list = codes == null ? null : (Array.isArray(codes) ? codes : [codes]);
  if (!list || list.some(c => !c)) return fail('odpověď neobsahuje použitelný kód');
  if (list.length !== task.spans.length) {
    return fail(`model vrátil ${list.length} funkcí místo ${task.spans.length}`);
  }

  let patched;
  try {
    patched = replaceSpans(task.beforeFile, task.spans, list);
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

    const run = runIsolatedTest(work, task.test, timeout);
    const scored = scoreFromOutput(run.output, task.requirements, run.passed);
    return {
      score: scored.score,
      passed: scored.passed,
      applied: true, syntaxOk, timedOut: run.timedOut,
      targeted: scored.targeted,
      targetedPassed: scored.targetedPassed,
      regressions: scored.regressions,
      reason: scored.passed ? null
        : run.timedOut ? 'test vypršel'
          : scored.regressions.length ? `oprava rozbila ${scored.regressions.length} jiných testů`
            : `splněno ${scored.targetedPassed}/${scored.targeted} požadavků`,
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
  const broken = applyAndTest(repo, task, task.functionTexts, opts);
  if (broken.passed) return { usable: false, reason: 'test projde i před opravou — úloha nic neměří' };
  if (!broken.applied || !broken.syntaxOk) return { usable: false, reason: `stav před opravou se nedá sestavit: ${broken.reason}` };

  const gold = applyAndTest(repo, task, task.goldTexts, opts);
  if (!gold.passed) return { usable: false, reason: `gold patch neprojde vlastním testem: ${gold.reason}` };

  return { usable: true, reason: null };
}

export default {
  changedLines, deriveTask, buildPrompt, extractFunctionCode, extractFunctionCodes, functionNameOf,
  applyAndTest, verifyTask, runIsolatedTest, parseTestOutput, scoreFromOutput, DEFAULT_TEST_TIMEOUT,
};
