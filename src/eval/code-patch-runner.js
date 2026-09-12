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
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findSpansForLines, regionForLines, mergeSpans, replaceSpans } from './function-span.js';
import { testFilesOf } from './code-task-extractor.js';

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
 * Hunky commitu jako **dvojice** rozsahů — co bylo a co je místo toho.
 *
 * `changedLines()` obě strany rozsype do jednoho pytle čísel, čímž se ztratí
 * to podstatné: který úsek „před" odpovídá kterému „po".  Dokud se páry
 * odvozovaly zpětně z počtu nalezených úseků, propadl každý commit, který
 * vedle opravy něco **přidal** — nový `const`, nový pomocník — protože na
 * straně „po" byl úsek navíc a počty nesedly.  Změřeno 2026-08-22: takhle
 * padlo 10 z 32 kandidátů, zdaleka nejvíc ze všech důvodů.
 *
 * Hunk přitom párování nese sám a zadarmo.  U čistého přírůstku (`-N,0`) je
 * stranou „před" kotevní řádek N, za který se vkládalo.
 *
 * @returns {Array<{beforeStart, beforeLen, afterStart, afterLen}>}
 */
export function changedHunks(repo, hash, source) {
  const diff = git(repo, ['diff', '-U0', `${hash}~1`, hash, '--', source]);
  const hunks = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      beforeStart: +m[1], beforeLen: m[2] === undefined ? 1 : +m[2],
      afterStart: +m[3], afterLen: m[4] === undefined ? 1 : +m[4],
    });
  }
  return hunks;
}

const rangeOf = (start, len) => (len
  ? Array.from({ length: len }, (_, i) => start + i)
  : [Math.max(1, start)]);   // čistý přírůstek/úbytek — kotevní řádek

/**
 * Holý úsek přes zadané řádky, bez ohledu na to, co na nich stojí.
 *
 * Používá se jen pro **kotvu čistého přírůstku**: commit vložil kód za řádek N
 * a před opravou tam žádná konstrukce není — často je to prázdný řádek mezi
 * dvěma funkcemi.  Kotva se přesto musí do zadání dostat, jinak není kam
 * přírůstek vložit; slitím se sousední skupinou z ní vznikne souvislý úsek,
 * který přírůstek obklopí.  Bez tohohle padalo 12 z 32 kandidátů (2026-08-22).
 */
function bareRegion(src, lines) {
  const startLine = Math.min(...lines);
  const endLine = Math.max(...lines);
  const all = src.split('\n');
  const text = all.slice(startLine - 1, endLine).join('\n');
  return { kind: 'region', name: null, startLine, endLine, text, header: text.split('\n')[0].trim(), tail: '' };
}

/**
 * Spáruje úseky před opravou s úseky po opravě, hunk po hunku.
 *
 * Skupiny se slévají, jakmile se překryjí na **kterékoli** straně: dva hunky
 * v jedné funkci musí dát jednu jednotku zadání, jinak by se do souboru
 * vkládal její text dvakrát.  Slévá se do ustálení, protože slitím může
 * vzniknout překryv s další skupinou.
 *
 * @returns {{units: Array<{before, after}>|null, reason: string|null}}
 */
export function pairUnits(beforeFile, afterFile, hunks) {
  if (!hunks.length) return { units: null, reason: 'commit v souboru nic nezměnil' };

  const groups = [];
  for (const h of hunks) {
    const beforeLines = rangeOf(h.beforeStart, h.beforeLen);
    const afterLines = rangeOf(h.afterStart, h.afterLen);
    let before = regionForLines(beforeFile, beforeLines);
    let after = regionForLines(afterFile, afterLines);

    // Kosmetický hunk (jen prázdné řádky nebo komentáře) nenese chování a
    // zadání by jen zašuměl; o platnost úlohy se stará round-trip gold patche.
    if (!before && !after) continue;

    // Kotva přírůstku nebo úbytku na řádku, kde žádná konstrukce nezačíná.
    if (!before && !h.beforeLen) before = bareRegion(beforeFile, beforeLines);
    if (!after && !h.afterLen) after = bareRegion(afterFile, afterLines);
    if (!before || !after) {
      return { units: null, reason: 'změnu se nedaří přiřadit úseku souboru' };
    }
    groups.push({ before, after });
  }
  if (!groups.length) return { units: null, reason: 'commit mění jen komentáře a prázdné řádky' };

  groups.sort((a, b) => a.before.startLine - b.before.startLine);

  const overlaps = (x, y) => x.startLine <= y.endLine && y.startLine <= x.endLine;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length - 1; i++) {
      const a = groups[i], b = groups[i + 1];
      if (!overlaps(a.before, b.before) && !overlaps(a.after, b.after)) continue;
      groups.splice(i, 2, {
        before: mergeSpans(beforeFile, a.before, b.before),
        after: mergeSpans(afterFile, a.after, b.after),
      });
      merged = true;
      break;
    }
  }

  // Kotva na prázdném řádku dá prázdný úsek — zadat „přepiš tenhle nic" nejde
  // a `applyAndTest()` ho odmítne jako nepoužitelný kód.  Slije se proto se
  // sousedem: slití dvou skupin je vždycky bezpečné, protože obě strany
  // zůstanou souvislé a nezměněné řádky mezi nimi si odpovídají.
  let blank = groups.findIndex(g => !g.before.text.trim() || !g.after.text.trim());
  while (blank !== -1) {
    if (groups.length === 1) return { units: null, reason: 'úsek zadání by byl prázdný' };
    const other = blank > 0 ? blank - 1 : blank + 1;
    const [lo, hi] = [Math.min(blank, other), Math.max(blank, other)];
    groups.splice(lo, 2, {
      before: mergeSpans(beforeFile, groups[lo].before, groups[hi].before),
      after: mergeSpans(afterFile, groups[lo].after, groups[hi].after),
    });
    blank = groups.findIndex(g => !g.before.text.trim() || !g.after.text.trim());
  }

  // Pořadí na obou stranách musí být stejné, jinak by se gold text vložil do
  // nesprávného úseku.  Po slití to platí, ale ověřit se to musí — hunky můžou
  // přijít v pořadí, které se mezi verzemi liší (přesunutá funkce).
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].after.startLine <= groups[i - 1].after.startLine) {
      return { units: null, reason: 'úseky se mezi verzemi přeskládaly' };
    }
  }
  return { units: groups, reason: null };
}

/**
 * Je to před opravou a po opravě tentýž úsek?
 *
 * U funkce je totožností hlavička — když se změnila, commit funkci přejmenoval
 * nebo jí sáhl na signaturu a jednotka zadání neodpovídá tomu, co se stalo.
 *
 * U vrcholové konstrukce hlavička použít nejde: `const MAX = 40;` → `= 60;` je
 * oprava *uvnitř* hlavičky a porovnání textu by ji zahodilo právě proto, že
 * úloha je zajímavá.  Rozhoduje proto deklarované jméno; text až tam, kde se
 * žádné jméno vyčíst nedá.
 */
function sameUnit(before, after) {
  // Region vznikl slitím a jeho hranice určuje hunk, ne deklarace — porovnávat
  // jeho první řádek by zahodilo právě ty úlohy, kvůli kterým vznikl.
  // Za správnost ručí párování hunků a round-trip gold patche.
  if (before.kind === 'region' || after.kind === 'region') return true;
  if ((before.kind ?? 'function') !== (after.kind ?? 'function')) return false;
  if (before.kind === 'top-level') {
    return before.name ? before.name === after.name : before.header === after.header;
  }
  return before.header === after.header;
}

/**
 * Sestaví úlohu z commitu — bez spouštění testů, takže je to levné.
 *
 * Zadáním je **množina úseků**, do kterých commit sáhl — funkcí i vrcholových
 * konstrukcí (import, konstanta, `export default`).  Jediná funkce je jen
 * nejčastější případ: měřeno na 852 commitech tohohle repa mění 19 z 29 jinak
 * použitelných kandidátů víc míst v jednom souboru, takže omezení na jedinou
 * funkci zahazovalo dvě třetiny materiálu, a omezení na *funkce* zahazovalo
 * dalších 20 kandidátů z 32 (2026-08-22) — commit typicky mění import nahoře
 * a zároveň tělo metody dole.
 *
 * Vrací `null` s důvodem, když se změněný řádek nepodaří přiřadit žádnému
 * úseku ani zahodit jako kosmetický — viz `findSpansForLines()`.
 *
 * @returns {{task: Object|null, reason: string|null}}
 */
export function deriveTask(repo, meta) {
  const { hash, source } = meta;
  const tests = testFilesOf(meta);
  if (!tests.length) return { task: null, reason: 'úloha nemá testový soubor' };
  let beforeFile, afterFile;
  try {
    beforeFile = git(repo, ['show', `${hash}~1:${source}`]);
    afterFile = git(repo, ['show', `${hash}:${source}`]);
  } catch (err) {
    return { task: null, reason: `zdroják nelze načíst: ${err.message}` };
  }

  const { units, reason } = pairUnits(beforeFile, afterFile, changedHunks(repo, hash, source));
  if (!units) return { task: null, reason };

  const spansBefore = units.map(u => u.before);
  const spansAfter = units.map(u => u.after);
  for (let i = 0; i < units.length; i++) {
    if (!sameUnit(spansBefore[i], spansAfter[i])) {
      return { task: null, reason: 'oprava mění jednotku — jiný úsek před a po' };
    }
  }

  const functionLines = spansBefore.reduce((sum, sp) => sum + (sp.endLine - sp.startLine + 1), 0);

  return {
    task: {
      hash, source,
      taskFingerprint: meta.taskFingerprint || null,
      test: tests[0],   // pro zpětnou slučitelnost se staršími fixturami
      tests,
      subject: meta.subject,
      beforeFile,
      spans: spansBefore,
      functionTexts: spansBefore.map(sp => sp.text),   // co dostane model
      goldTexts: spansAfter.map(sp => sp.text),        // referenční oprava
      functionCount: spansBefore.length,
      functionLines,
      requirements: [...new Set(tests.flatMap(t => addedTestNames(repo, hash, t)))],
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
 *
 * Proč se druh úseku pojmenovává:
 *
 * Od chvíle, kdy jsou jednotkou i vrcholové konstrukce, může v zadání stát
 * `import { X } from './y.js';` vedle metody o osmdesáti řádcích.  Holý
 * fragment importu sám o sobě neřekne nic — model musí vidět, že jde o vrchol
 * souboru, a dostat ho **spolu s dotčenými funkcemi**, aby bylo z čeho vadu
 * odvodit.  Pořadí úseků je zároveň smlouvou o pořadí bloků v odpovědi.
 */
export function buildPrompt(task) {
  const fence = '```';
  const req = (task.requirements || []).length
    ? `\n\nPožadované chování:\n${task.requirements.map(r => `- ${r}`).join('\n')}`
    : '';

  const kinds = task.functionTexts.map((_, i) => task.spans?.[i]?.kind ?? 'function');
  const many = task.functionTexts.length > 1;
  const label = (kind, i) => {
    if (kind === 'top-level') return `Kód na nejvyšší úrovni souboru ${i + 1}:`;
    if (kind === 'region') return `Úsek souboru ${i + 1}:`;
    return `Funkce ${i + 1}:`;
  };

  const blocks = task.functionTexts
    .map((text, i) => `${many ? `${label(kinds[i], i)}\n\n` : ''}${fence}javascript\n${text}\n${fence}`)
    .join('\n\n');

  // Úsek smí být delší než to, co se v něm mění, a oprava do něj smí kód
  // **přidat** — právě proto je jednotkou úsek, a ne jen samotná funkce.
  const unit = kinds[0] === 'function' ? 'funkci' : 'úsek';
  const instruction = many
    ? `Oprav vadu. Vrať POUZE ${task.functionTexts.length} bloků ${fence}javascript — každý úsek celý, `
      + 'od prvního po poslední řádek, ve stejném pořadí jako v zadání. '
      + 'Nezkracuj je a nevynechávej řádky, kterých se oprava netýká. '
      + 'Žádné vysvětlení, žádný zbytek souboru.'
    : `Oprav vadu. Vrať POUZE celý opravený ${unit === 'funkci' ? 'kód funkce' : 'úsek'} v jednom bloku ${fence}javascript, `
      + 'od prvního po poslední řádek. Nezkracuj ho a nevynechávej řádky, '
      + 'kterých se oprava netýká. Žádné vysvětlení, žádný zbytek souboru.';

  const intro = many
    ? 'Vadu obsahují tyto úseky souboru:'
    : (kinds[0] === 'function' ? 'Následující funkce obsahuje tuto vadu:'
      : kinds[0] === 'top-level' ? 'Následující úsek na nejvyšší úrovni souboru obsahuje tuto vadu:'
        : 'Následující úsek souboru obsahuje tuto vadu:');

  return `Soubor: ${task.source}

Hlášená vada: ${task.subject}${req}

${intro}

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
    // Vrcholová konstrukce nese jméno rovnou (`LIMIT`, `import:./y.js`);
    // u funkce se vyčte z hlavičky.
    const name = span.kind === 'top-level'
      ? (span.name?.replace(/^import:/, '') ?? null)
      : functionNameOf(span.header);
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
      stdio: ['ignore', 'pipe', 'pipe'], env,
    });
    return { passed: true, timedOut: false, output: out || '' };
  } catch (err) {
    const unshareOutput = `${err.stdout || ''}${err.stderr || ''}`;
    // Some managed agent/container environments disable unprivileged user
    // namespaces even though the user's systemd instance can still create a
    // real private network namespace. Keep the same isolation guarantee; do
    // not fall back to an unrestricted test process.
    if (/Operation not permitted|uid_map/i.test(unshareOutput)) {
      const unit = `intentsmith-codepatch-${process.pid}-${randomUUID().slice(0, 8)}`;
      try {
        const out = execFileSync('systemd-run', [
          '--user', '--wait', '--pipe', '--quiet', '--collect', '--unit', unit,
          '-p', 'PrivateNetwork=yes',
          '-p', `WorkingDirectory=${work}`,
          '-E', `C3_DB_PATH=${env.C3_DB_PATH}`,
          process.execPath,
          testFile,
        ], {
          cwd: work, timeout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'], env,
        });
        return { passed: true, timedOut: false, output: out || '', isolation: 'systemd-private-network' };
      } catch (fallbackError) {
        // execFileSync timeout terminates the systemd-run client, not
        // necessarily the transient service. Stop only our unique owned unit
        // so model-generated test code cannot survive the evaluation timeout.
        try {
          execFileSync('systemctl', ['--user', 'stop', `${unit}.service`], {
            timeout: 10_000, stdio: 'ignore',
          });
        } catch { /* the collected unit may already be gone */ }
        return {
          passed: false,
          timedOut: fallbackError.code === 'ETIMEDOUT' || fallbackError.signal === 'SIGTERM',
          output: `${fallbackError.stdout || ''}${fallbackError.stderr || ''}`,
          isolation: 'systemd-private-network',
        };
      }
    }
    return {
      passed: false,
      timedOut: err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM',
      output: unshareOutput,
      isolation: 'unshare-network',
    };
  }
}

export function runIsolatedTests(work, testFiles, timeout = DEFAULT_TEST_TIMEOUT, run = runIsolatedTest) {
  const results = [];
  for (const file of testFiles) {
    const result = run(work, file, timeout);
    results.push(result);
    if (result.timedOut) break;
  }
  return results;
}

/**
 * Rozebere výstup testovacího souboru na jednotlivé testy.
 *
 * V repu koexistují dva styly hlášení a rozdíl mezi nimi je zásadní:
 *
 *   `tests/harness.js`        tiskne `  ✅ název` i `  ❌ název: chyba`
 *   `tests/routes-smoke.js`   tiskne **jen** `  FAIL: název`; úspěch mlčí
 *
 * U druhého stylu se z výstupu nedá zjistit, které testy prošly — jde poznat
 * jen to, které spadly.  Kdo tenhle rozdíl přehlédne, přijde o úlohy: obě
 * úlohy nad `routes-smoke.test.js` vypadaly jako „nic se opravou nepřeklopilo",
 * přestože se překlopily čtyři testy.
 *
 * @returns {{passed: Set<string>, failed: Set<string>, totals: {passed, failed}|null}}
 */
export function parseTestOutput(output) {
  const passed = new Set();
  const failed = new Set();

  const stripMessage = (text) => {
    const i = text.indexOf(': ');
    return (i === -1 ? text : text.slice(0, i)).trim();
  };

  for (const line of (output || '').split('\n')) {
    let m = line.match(/^\s*✅\s+(.+?)\s*$/);
    if (m) { passed.add(m[1]); continue; }
    m = line.match(/^\s*PASS:\s+(.+?)\s*$/);
    if (m) { passed.add(m[1]); continue; }
    // `❌ název: chyba` i `❌ název` bez zprávy
    m = line.match(/^\s*❌\s+(?:\[[^\]]*\]\s+)?(.+?)\s*$/);
    if (m) { failed.add(stripMessage(m[1])); continue; }
    m = line.match(/^\s*FAIL:\s+(.+?)\s*$/);
    if (m) failed.add(stripMessage(m[1]));
  }

  // Výstupy víc testových souborů se slévají do jednoho textu, takže se stejné
  // jméno může objevit mezi prošlými i mezi spadlými.  Takový název nic
  // netvrdí — počítá se jako spadlý, aby se částečné selhání nedalo vydávat
  // za opravu.
  for (const name of failed) passed.delete(name);

  const m = (output || '').match(/RESULTS:\s*(\d+)\s+passed,\s*(\d+)\s+failed/)
    || (output || '').match(/Results:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  return { passed, failed, totals: m ? { passed: +m[1], failed: +m[2] } : null };
}

/**
 * Skóre z výsledků testů.
 *
 * Cílové testy se **neodvozují z textu commitu, ale ze spuštění** — stejný
 * princip jako `FAIL_TO_PASS` / `PASS_TO_PASS` v SWE-benchi:
 *
 *   failToPass    na vadném kódu padá, s gold patchem projde → zadání
 *   passToPass    projde v obou stavech                      → hlídač regresí
 *   knownFailing  padá v obou stavech                        → cizí vada, ignoruje se
 *
 * Jak se pozná, že model test spravil, závisí na tom, co soubor tiskne:
 *
 *   `named`          úspěch je pojmenovaný → spravený = objevil se mezi prošlými
 *   `failures-only`  úspěch mlčí           → spravený = zmizel ze spadlých
 *
 * Bez tohohle rozlišení by se u mlčícího stylu tvářil jako oprava i test, který
 * vůbec nedoběhl.
 *
 *     skóre = spravené cílové testy / velikost failToPass
 *           = 0 při jakékoli regresi
 */
export function scoreFromOutput(output, task, filePassed) {
  const targets = (task?.failToPass || []).filter(Boolean);
  if (!targets.length) {
    return { score: filePassed ? 1 : 0, passed: !!filePassed, targeted: 0, targetedPassed: 0, regressions: [] };
  }

  const parsed = parseTestOutput(output);
  const mode = task.scoreMode === 'failures-only' ? 'failures-only' : 'named';

  // U mlčícího stylu se oprava pozná po **chybějícím** řádku `FAIL:` — jenže
  // chybí i tehdy, když běh spadl dřív, než se k testu dostal.  Bez důkazu, že
  // běh doběhl, by se havárie počítala jako oprava: změřeno na `286a9117`, kde
  // částečný pád (`TypeError: req.on is not a function`) dostal 1,00 a úloha
  // kolísala mezi 0 a 1 mezi opakováními.  Důkazem je závěrečný souhrn.
  if (mode === 'failures-only' && !parsed.totals) {
    return {
      score: 0, passed: false, targeted: targets.length, targetedPassed: 0,
      regressions: ['běh nedoběhl — chybí závěrečný souhrn'],
    };
  }

  const isFixed = (name) => (mode === 'named'
    ? parsed.passed.has(name)
    : !parsed.failed.has(name));

  const targetedPassed = targets.filter(isFixed).length;

  const regressions = mode === 'named'
    ? (task.passToPass || []).filter(name => !parsed.passed.has(name))
    // Mlčící styl nezná seznam prošlých; regrese = pád, který není ani cílem,
    // ani vadou, která padala už předtím.
    : [...parsed.failed].filter(name => !targets.includes(name)
        && !(task.knownFailing || []).includes(name));

  const score = regressions.length ? 0 : targetedPassed / targets.length;
  return { score, passed: score === 1, targeted: targets.length, targetedPassed, regressions };
}

/**
 * Vloží kód do souboru, spustí skrytý test a vrátí výsledek.
 *
 * Skóre `0..1` je podíl opravených cílových kontrol; jakákoli nová regrese je
 * vynuluje. `syntaxOk` se sleduje zvlášť jako diagnostika — říká, jestli model
 * selhal na pochopení vady, nebo už na tvaru odpovědi.
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

    // Testových souborů může být víc a musí projít **všechny**: commit, který
    // k jedné opravě dopsal testy do tří souborů, by jinak šlo splnit jen
    // částečně a skóre by tvrdilo, že je vada opravená.
    // Jeden timeout už znamená nulové skóre a nespolehlivé orákulum. Čekat
    // dalších 120 s na každý další testový soubor nemůže výsledek změnit.
    const runs = runIsolatedTests(work, testFilesOf(task), timeout);
    const run = {
      passed: runs.every(r => r.passed),
      timedOut: runs.some(r => r.timedOut),
      output: runs.map(r => r.output).join('\n'),
    };
    const scored = scoreFromOutput(run.output, task, run.passed);
    return {
      score: scored.score,
      passed: scored.passed,
      applied: true, syntaxOk, timedOut: run.timedOut,
      targeted: scored.targeted,
      targetedPassed: scored.targetedPassed,
      regressions: scored.regressions,
      output: run.output,
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
 * Přínos modelu proti tomu, neudělat nic.
 *
 * Proč nestačí holé skóre:
 *
 * Úlohy nemají stejnou podlahu.  `d8a2aa05` má tři cílové testy a jeden z nich
 * projde i na vadném kódu — model, který neudělá vůbec nic, tam dostane 0,33,
 * kdežto u `da03e8bd` dostane 0,00.  Průměrovat taková čísla přes sadu znamená
 * sčítat nesrovnatelné veličiny a výsledek pak nevypovídá o schopnosti, ale o
 * tom, jak byly úlohy poskládané.
 *
 *     přínos = (skóre − podlaha) / (1 − podlaha)
 *
 * 0 = nepřidal nic proti nečinnosti, 1 = vada opravena.  Zhoršení se ořezává na
 * nulu: sada měří, co model spravil, ne jak hluboko dokáže klesnout — na to je
 * příznak `regressions`.
 */
export function normalizedGain(score, baseline) {
  const floor = baseline ?? 0;
  if (floor >= 1) return 0;
  const gain = (score - floor) / (1 - floor);
  return Math.max(0, Math.min(1, gain));
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
  // Bez cílových sad se skóre počítá binárně přes celý soubor; tenhle první
  // průchod je právě od toho, aby se sady daly odvodit.
  const bare = { ...task, failToPass: [], passToPass: [] };

  const broken = applyAndTest(repo, bare, bare.functionTexts, opts);
  if (!broken.applied || !broken.syntaxOk) {
    return { usable: false, reason: `stav před opravou se nedá sestavit: ${broken.reason}` };
  }
  if (broken.passed) return { usable: false, reason: 'test projde i před opravou — úloha nic neměří' };

  const gold = applyAndTest(repo, bare, bare.goldTexts, opts);
  if (!gold.passed) return { usable: false, reason: `gold patch neprojde vlastním testem: ${gold.reason}` };

  const before = parseTestOutput(broken.output);
  const after = parseTestOutput(gold.output);

  // Testový soubor nemusí tisknout nic po jednotlivých testech (prostý skript,
  // který jen skončí nenulovým kódem).  Pak se hodnotí binárně celý soubor —
  // hrubší, ale pořád objektivní.
  const hasProtocol = after.passed.size || after.failed.size || before.passed.size || before.failed.size;
  if (!hasProtocol) {
    return { usable: true, reason: null, scoreMode: 'file', failToPass: [], passToPass: [], knownFailing: [] };
  }

  // Opravu je vidět dvěma způsoby a je potřeba umět oba: buď test přibude mezi
  // prošlé (harness), nebo zmizí ze spadlých (styl, kde úspěch mlčí).
  const newlyPassing = [...after.passed].filter(name => !before.passed.has(name));
  const stoppedFailing = [...before.failed].filter(name => !after.failed.has(name));

  const scoreMode = newlyPassing.length ? 'named' : 'failures-only';
  const failToPass = scoreMode === 'named' ? newlyPassing : stoppedFailing;

  // Nic se nepřeklopilo po jednotlivých testech, přestože soubor jako celek ano
  // (padal před opravou, prochází s gold patchem — ověřeno výš).  Typicky proto,
  // že vadný kód shodí celý běh dřív, než se protokol dotiskne: `06d49847` končí
  // `TypeError: req.on is not a function`.  Úloha je platná, jen se nedá
  // lokalizovat — hodnotí se binárně celý soubor.
  if (!failToPass.length) {
    return { usable: true, reason: null, scoreMode: 'file', failToPass: [], passToPass: [], knownFailing: [] };
  }

  return {
    usable: true,
    reason: null,
    scoreMode,
    failToPass,
    passToPass: [...after.passed].filter(name => before.passed.has(name)),
    knownFailing: [...after.failed].filter(name => before.failed.has(name)),
  };
}

export default {
  changedLines, changedHunks, pairUnits, deriveTask, buildPrompt, extractFunctionCode, extractFunctionCodes, functionNameOf,
  applyAndTest, verifyTask, runIsolatedTest, runIsolatedTests, parseTestOutput, scoreFromOutput,
  normalizedGain, DEFAULT_TEST_TIMEOUT,
};
