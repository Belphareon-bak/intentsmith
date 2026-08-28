// Function Span — najde v JS zdrojáku rozsah funkce, která obklopuje daný řádek
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč vlastní scanner a ne parser:
//
// V repu není `@babel/parser` ani `acorn`; `esprima` je sice v `node_modules`,
// ale neumí `?.` a `??`, které jsou v `src/` všude.  `tree-sitter` se přes
// `code-intel/ast-analyzer.js` načte, ale na zdejších souborech vrací
// `Parse error: Invalid argument` a nula symbolů (ověřeno 2026-08-20).
// Přidávat závislost kvůli evaluaci se nevyplatí.
//
// Proč vůbec pracovat po funkcích:
//
// Zdrojáky úloh mají 249 až 3531 řádků (medián kolem 1700, 124 KB v maximu).
// „Vrať celý opravený soubor" je při takové velikosti mimo `num_ctx` i mimo
// rozumný čas generování — u 124 KB souboru jde o desítky tisíc tokenů na
// výstupu.  Jednotkou zadání proto musí být funkce, ne soubor.
//
// Správnost se neověřuje kontrolou scanneru, ale **round-tripem gold patche**:
// vezme se funkce z opraveného souboru, vloží se do souboru před opravou a
// musí projít test.  Co neprojde, není použitelná úloha — viz `gold-roundtrip`
// v runneru.  Scanner tedy nemusí být dokonalý, musí být *ověřitelný*.
//
// ══════════════════════════════════════════════════════════════════════════════

/** Klíčová slova, po kterých `/` začíná regulární výraz, ne dělení. */
const REGEX_PRECEDING = /(^|[=(,:;[!&|?{}+\-*%~^<>])\s*$/;
const REGEX_KEYWORD = /\b(return|typeof|instanceof|in|of|case|do|else|yield|await|void|delete)\s*$/;

/** Bloky, které vypadají jako volání funkce, ale funkce nejsou. */
const NOT_A_FUNCTION = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'try', 'else', 'do', 'finally',
  'return', 'typeof', 'new', 'delete', 'await', 'yield', 'with',
]);

/**
 * Hlavička funkce na řádku, kde blok začíná.
 *
 * Pokrývá tvary, které se v `src/` skutečně vyskytují: deklarace, export,
 * metoda třídy i objektu, přiřazená šipka, getter/setter, generátor.
 */
const FUNCTION_HEADER = new RegExp([
  /(^|\s)(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*[\w$]*\s*\(/,     // function foo(
  /(^|\s)(static\s+)?(async\s+)?\*?\s*[\w$#]+\s*\([^;]*\)\s*\{?\s*$/,           // metoda / foo(...) {
  /(^|\s)(get|set)\s+[\w$]+\s*\(/,                                              // get foo(
  /=\s*(async\s*)?(function\s*\*?\s*[\w$]*)?\s*\(?[\w$,\s{}[\]]*\)?\s*=>/,      // = (...) =>
  /=\s*(async\s+)?function\s*\*?\s*[\w$]*\s*\(/,                                // = function (
  /:\s*(async\s*)?(function\s*\(|\([^)]*\)\s*=>)/,                              // klíč: function(
].map(r => `(?:${r.source})`).join('|'));

/**
 * Projde zdroják znak po znaku a přeskočí přitom řetězce, komentáře, šablony
 * a regulární výrazy — jinak by `{` v řetězci rozhodilo počítání bloků a `;`
 * v komentáři rozdělilo příkaz.
 *
 * Oba scannery níž potřebují přesně tohle přeskakování a nic víc, takže je
 * napsané jednou.  `visit` dostane i otevírací znak přeskočeného tokenu (`"`,
 * `` ` ``, `/`), aby šlo poznat, že tam příkaz začíná; jeho vnitřek už ne.
 *
 * @param {(char: string, index: number, line: number) => void} visit
 * @returns {number} číslo posledního řádku
 */
function walkCode(src, visit) {
  let line = 1;
  let i = 0;
  let lastSignificant = '';

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '\n') { line++; i++; continue; }

    // komentáře
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // řetězce
    if (c === '"' || c === "'") {
      const quote = c;
      visit(quote, i, line);
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') line++;   // nemělo by nastat, ale ať se neztratí počet
        i++;
      }
      i++;
      lastSignificant = quote;
      continue;
    }

    // šablony — `${` může obsahovat další `{`, takže se hlídá zvlášť
    if (c === '`') {
      visit('`', i, line);
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') { line++; i++; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          // dojet výraz uvnitř ${...}
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === '\n') line++;
            else if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            else if (src[i] === '`') {
              // vnořená šablona — přeskočit ji hrubě
              i++;
              while (i < src.length && src[i] !== '`') { if (src[i] === '\n') line++; if (src[i] === '\\') i++; i++; }
            }
            i++;
          }
          continue;
        }
        i++;
      }
      lastSignificant = '`';
      continue;
    }

    // regulární výraz vs. dělení
    if (c === '/') {
      const before = src.slice(Math.max(0, i - 40), i);
      visit('/', i, line);
      if (REGEX_PRECEDING.test(before) || REGEX_KEYWORD.test(before) || lastSignificant === '') {
        const from = i;
        i++;
        let closed = false;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; closed = true; break; }
          else if (src[i] === '\n') break;   // neuzavřený → nebyl to regex
          i++;
        }
        // Nezavřel se do konce řádku, takže to regulární výraz nebyl.  Vrátit
        // se za lomítko a přečíst obsah normálně: kdyby se jen pokračovalo od
        // `\n`, spolkly by se závorky **a řádek by se započítal dvakrát** —
        // jednou tady a podruhé v hlavní smyčce.  Každý takový `/` posunul
        // všechna další čísla řádků o jedna; v `cre-decision.js` kvůli tomu
        // scanner míjel 53 vrcholových deklarací (nalezeno 2026-08-22).
        if (!closed) i = from + 1;
        lastSignificant = '/';
        continue;
      }
      i++;
      lastSignificant = '/';
      continue;
    }

    if (!/\s/.test(c)) {
      visit(c, i, line);
      lastSignificant = c;
    }
    i++;
  }

  return line;
}

/**
 * Rozdělí zdroják na bloky `{...}`.
 *
 * @returns {Array<{open: number, close: number, startLine: number, endLine: number, depth: number}>}
 */
export function scanBlocks(src) {
  const blocks = [];
  const stack = [];

  walkCode(src, (c, i, line) => {
    if (c === '{') { stack.push({ open: i, startLine: line }); return; }
    if (c === '}') {
      const b = stack.pop();
      if (b) blocks.push({ open: b.open, close: i, startLine: b.startLine, endLine: line, depth: stack.length });
    }
  });

  return blocks;
}

/**
 * Rozdělí zdroják na příkazy na **nejvyšší úrovni** — import, `const X = {…}`,
 * `export default {…}`, deklaraci třídy.
 *
 * Proč to potřebujeme:  z 32 kandidátů v historii tohohle repa jich 20 sáhlo
 * i mimo funkce (měřeno 2026-08-22) a bez tohohle scanneru všech dvacet
 * propadlo sítem „změna zasahuje mimo funkce".
 *
 * Kde příkaz končí: u `;` na nulové hloubce, nebo u `}`, které uzavře poslední
 * otevřený blok — jenže rozlišit `function f() {}` od `const X = {…};` jde až
 * podle toho, co přijde dál.  Konec na `}` se proto drží jako *nabídnutý* a
 * potvrdí se, teprve když další znak není `;`.
 *
 * Výjimka jsou `import {…} from '…'` a `export {…} from '…'`: tam závorky
 * nejsou blok, ale seznam vazeb, takže je příkaz ukončit nesmí — jinak by
 * z víceřádkového importu zbylo `import { alpha, beta, }` bez modulu.
 *
 * @returns {Array<{start: number, startLine: number, end: number, endLine: number}>}
 */
export function scanTopLevelStatements(src) {
  const stmts = [];
  let curly = 0, paren = 0, bracket = 0;
  let start = -1, startLine = 0, bindingList = false;
  let pending = null;   // konec nabídnutý uzavírací závorkou

  const close = (end, endLine) => {
    stmts.push({ start, startLine, end, endLine });
    start = -1;
    pending = null;
  };
  const begin = (i, line) => {
    start = i;
    startLine = line;
    bindingList = /^(import\b|export\s*\{)/.test(src.slice(i, i + 24).replace(/\s+/g, ' '));
  };

  const lastLine = walkCode(src, (c, i, line) => {
    if (start === -1) {
      begin(i, line);
    } else if (pending) {
      // `};` — středník patří ještě k příkazu, cokoli jiného už začíná další.
      if (c === ';') { close(i, line); return; }
      const offered = pending;
      close(offered.index, offered.line);
      begin(i, line);
    }

    if (c === '{') curly++;
    else if (c === '}') {
      curly = Math.max(0, curly - 1);
      if (!curly && !paren && !bracket && !bindingList) pending = { index: i, line };
    } else if (c === '(') paren++;
    else if (c === ')') paren = Math.max(0, paren - 1);
    else if (c === '[') bracket++;
    else if (c === ']') bracket = Math.max(0, bracket - 1);
    else if (c === ';' && !curly && !paren && !bracket) close(i, line);
  });

  if (start !== -1) {
    const offered = pending ?? { index: src.length - 1, line: lastLine };
    stmts.push({ start, startLine, end: offered.index, endLine: offered.line });
  }
  return stmts;
}

/** Text řádku, na kterém blok začíná, až po otevírací závorku. */
function headerOf(src, block) {
  const lineStart = src.lastIndexOf('\n', block.open) + 1;
  return src.slice(lineStart, block.open);
}

/**
 * Najde nejtěsnější funkci obklopující zadaný řádek (1-based).
 *
 * @returns {{startLine, endLine, text, header}|null}
 */
export function findEnclosingFunction(src, targetLine) {
  const blocks = scanBlocks(src);
  const containing = blocks
    .filter(b => b.startLine <= targetLine && b.endLine >= targetLine)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));   // od nejtěsnějšího

  for (const block of containing) {
    const header = headerOf(src, block).trimEnd();
    const firstWord = header.trim().match(/^([\w$]+)/)?.[1];
    if (firstWord && NOT_A_FUNCTION.has(firstWord)) continue;
    // `} else if (...) {` a podobné — klíčové slovo nemusí být první
    if (/\b(if|for|while|switch|catch)\s*\([^)]*\)\s*$/.test(header)) continue;
    if (!FUNCTION_HEADER.test(header)) continue;

    const lineStart = src.lastIndexOf('\n', block.open) + 1;
    // Za uzavírací závorkou může na témž řádku zbýt kód, který k funkci
    // nepatří — typicky čárka u vlastnosti objektu (`}: async () => {…},`)
    // nebo `);` u callbacku.  Bez jeho zachování splice rozbije syntax:
    // ověřeno na `a33cc20a`, kde ztráta jediné čárky shodila `node --check`.
    const lineEnd = src.indexOf('\n', block.close);
    const tail = src.slice(block.close + 1, lineEnd === -1 ? src.length : lineEnd);
    return {
      kind: 'function',
      name: identifierIn(header),
      startLine: block.startLine,
      endLine: block.endLine,
      text: src.slice(lineStart, block.close + 1),
      header: header.trim(),
      tail,
    };
  }
  return null;
}

/** Jméno z hlavičky funkce — `foo(` → `foo`. */
function identifierIn(header) {
  const m = header.match(/([A-Za-z_$#][\w$]*)\s*\(/);
  return m ? m[1] : null;
}

/**
 * Totožnost vrcholové konstrukce.
 *
 * U funkce je totožností hlavička, ale u konstrukce se hlavička mění **právě
 * opravou** — `const MAX = 40;` → `const MAX = 60;` je jeden a týž `MAX`.
 * Porovnávat verzi před a po tedy jde jen podle deklarovaného jména, u importu
 * podle modulu, ze kterého se bere.
 */
function declaredName(text) {
  const head = text.slice(0, 400).replace(/\s+/g, ' ').trim();
  const imp = head.match(/^import\b[^;]*?from\s*['"`]([^'"`]+)['"`]/) || head.match(/^import\s*['"`]([^'"`]+)['"`]/);
  if (imp) return `import:${imp[1]}`;
  if (/^export\s+default\b/.test(head)) return 'export default';
  const decl = head.match(/^(?:export\s+)?(?:const|let|var|class|function|async\s+function)\s+\*?\s*([\w$]+)/);
  return decl ? decl[1] : null;
}

/**
 * Najde vrcholovou konstrukci obklopující zadaný řádek — import, konstantu,
 * `export default`, deklaraci třídy.
 *
 * Použije se, teprve když řádek neleží v žádné funkci.  Bez toho propadlo
 * sítem „mimo funkce" 20 z 32 kandidátů (2026-08-22) — commit typicky mění
 * import nahoře **a zároveň** tělo metody dole a celý se kvůli tomu zahodil.
 *
 * Vrací `null`, když na řádku začátku stojí ještě jiný kód (`const a = 1; const b = 2;`):
 * náhrada jde po celých řádcích, takže by smazala i souseda.
 *
 * @returns {{kind, name, startLine, endLine, text, header, tail}|null}
 */
export function findEnclosingTopLevel(src, targetLine) {
  const hit = scanTopLevelStatements(src)
    .find(st => st.startLine <= targetLine && st.endLine >= targetLine);
  if (!hit) return null;

  const lineStart = src.lastIndexOf('\n', hit.start) + 1;
  if (src.slice(lineStart, hit.start).trim() !== '') return null;

  const lineEnd = src.indexOf('\n', hit.end);
  const text = src.slice(lineStart, hit.end + 1);
  return {
    kind: 'top-level',
    name: declaredName(text),
    startLine: hit.startLine,
    endLine: hit.endLine,
    text,
    header: text.split('\n')[0].trim(),
    tail: src.slice(hit.end + 1, lineEnd === -1 ? src.length : lineEnd),
  };
}

/**
 * Řádek, který nenese chování — prázdný, nebo samý komentář.
 *
 * Měřeno na 32 kandidátech: 27 z 52 řádků „mimo funkce" byly právě tyhle dva
 * druhy — prázdný řádek mezi funkcemi a JSDoc nad funkcí, kterých se commit
 * dotkl mimochodem.  Zahodit je je bezpečné, protože o platnosti úlohy
 * nerozhoduje tenhle odhad, ale round-trip gold patche: kdyby na zahozeném
 * řádku oprava záležela, gold patch neprojde a úloha se zahodí.
 */
export function isCosmeticLine(src, lineNumber) {
  const text = src.split('\n')[lineNumber - 1];
  if (text === undefined) return true;
  const t = text.trim();
  return t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

/**
 * Najde funkci obklopující **všechny** zadané řádky.
 *
 * Když změna zasahuje víc funkcí nebo i kód mimo ně (import, konstanta na
 * nejvyšší úrovni), vrací `null` — taková oprava se nedá zadat jako „přepiš
 * tuhle funkci" a úloha se pro tenhle formát nehodí.
 */
export function findSpanForLines(src, lines) {
  if (!lines.length) return null;
  const first = findEnclosingFunction(src, lines[0]);
  if (!first) return null;
  for (const ln of lines.slice(1)) {
    if (ln < first.startLine || ln > first.endLine) return null;
  }
  return first;
}

/**
 * Najde **všechny** úseky, do kterých změna zasahuje.
 *
 * Proč to musí umět víc úseků:
 *
 * Změřeno na 852 commitech tohohle repa — 19 z 29 jinak použitelných kandidátů
 * mění víc míst v jednom souboru (typicky import nahoře a tělo metody dole).
 * Síto „jediná funkce" je tak zdaleka největší ztráta úloh; bez něj má sada
 * z čeho vybírat, což je podmínka toho, aby šly nechat jen úlohy, které
 * skutečně rozlišují.
 *
 * Řádek se přiřazuje ve třech krocích, od nejtěsnějšího k nejvolnějšímu:
 *
 *   1. funkce, která ho obklopuje                → jednotkou je funkce
 *   2. vrcholová konstrukce (import, konstanta)  → jednotkou je konstrukce
 *   3. prázdný řádek nebo komentář               → zahodí se, nenese chování
 *
 * Teprve řádek, na který nesedí ani jedno, zruší celou úlohu.  Rozšíření
 * z kroku 1 na 1–3 zvedlo výtěžnost z 12 na 30 kandidátů z 32 (2026-08-22).
 *
 * @returns {Array<{kind, name, startLine, endLine, text, header, tail}>|null} vzestupně podle startLine
 */
export function findSpansForLines(src, lines) {
  if (!lines.length) return null;
  const byStart = new Map();

  for (const ln of lines) {
    const span = findEnclosingFunction(src, ln) ?? findEnclosingTopLevel(src, ln);
    if (span) {
      if (!byStart.has(span.startLine)) byStart.set(span.startLine, span);
      continue;
    }
    if (isCosmeticLine(src, ln)) continue;
    return null;
  }
  if (!byStart.size) return null;

  // Vnořené rozsahy se musí slít do vnějšího.  Nastane to dvakrát: metoda
  // uvnitř `const handlers = {…}`, a uzávěr uvnitř funkce, která ho vrací.
  // Kdyby se do `replaceSpans()` dostaly oba, druhá náhrada by přepsala text,
  // který první právě vložila, a soubor by přestal být platný.
  const sorted = [...byStart.values()]
    .sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const spans = [];
  for (const span of sorted) {
    const outer = spans[spans.length - 1];
    if (outer && span.endLine <= outer.endLine) continue;
    spans.push(span);
  }
  return spans;
}

/**
 * Souvislý úsek od prvního po poslední dotčený řádek.
 *
 * Když jeden hunk sáhne na víc věcí najednou — konstantu i funkci pod ní —
 * nemá smysl je zadávat zvlášť: leží vedle sebe a oprava je jedna.  Region je
 * proto souvislý text od začátku prvního úseku po konec posledního, včetně
 * toho, co je mezi nimi.
 *
 * Region je zároveň jediný tvar, kterým jde zadat **přidání** kódu.  Náhrada
 * po řádcích umí vrátit delší text než původní, takže „přepiš tenhle úsek"
 * pokryje i commit, který vedle opravy přidal nový pomocný `const` nebo
 * funkci — a takových je v historii tohohle repa víc než těch, co jen mění
 * existující řádky.
 */
function makeRegion(src, spans) {
  if (spans.length === 1) return spans[0];
  const startLine = spans[0].startLine;
  const endLine = Math.max(...spans.map(sp => sp.endLine));
  const last = spans.reduce((a, b) => (b.endLine > a.endLine ? b : a));
  const lines = src.split('\n');
  return {
    kind: 'region',
    name: null,
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join('\n'),
    header: lines[startLine - 1].trim(),
    tail: last.tail,
  };
}

/**
 * Jeden souvislý úsek pokrývající všechny zadané řádky.
 *
 * @returns {{kind, name, startLine, endLine, text, header, tail}|null}
 */
export function regionForLines(src, lines) {
  const spans = findSpansForLines(src, lines);
  return spans ? makeRegion(src, spans) : null;
}

/**
 * Slije dva úseky do jednoho, který pokrývá oba i text mezi nimi.
 */
export function mergeSpans(src, a, b) {
  const first = a.startLine <= b.startLine ? a : b;
  const second = first === a ? b : a;
  return makeRegion(src, [first, second]);
}

/**
 * Nahradí několik rozsahů najednou.
 *
 * Jde se **od konce souboru**, protože každá náhrada posune čísla řádků pod
 * sebou — při postupu shora by druhá náhrada trefila špatné místo.
 *
 * @param {Array<{startLine, endLine, tail}>} spans
 * @param {string[]} replacements ve stejném pořadí jako `spans`
 */
export function replaceSpans(src, spans, replacements) {
  if (spans.length !== replacements.length) {
    throw new Error(`počet funkcí nesedí: ${spans.length} rozsahů, ${replacements.length} náhrad`);
  }
  const order = spans
    .map((span, i) => ({ span, code: replacements[i] }))
    .sort((a, b) => b.span.startLine - a.span.startLine);

  let out = src;
  for (const { span, code } of order) {
    out = replaceSpan(out, span.startLine, span.endLine, code, span.tail);
  }
  return out;
}

/**
 * Nahradí rozsah řádků novým textem.
 *
 * `tail` je zbytek původního koncového řádku za uzavírací závorkou — musí se
 * připojit zpátky, jinak se ztratí čárka nebo `);` a soubor přestane být
 * syntakticky platný.
 */
export function replaceSpan(src, startLine, endLine, replacement, tail = '') {
  const lines = src.split('\n');
  const indent = lines[startLine - 1].match(/^\s*/)[0];
  const body = replacement.replace(/^\s*\n/, '').trimEnd();
  // Model odpověď obvykle odsadí od nuly; srovnat na odsazení původní funkce.
  const reindented = body.startsWith(indent) ? body : body.split('\n').map((l, idx) => (idx === 0 ? indent + l.trimStart() : l)).join('\n');
  return [...lines.slice(0, startLine - 1), reindented + tail, ...lines.slice(endLine)].join('\n');
}

export default {
  scanBlocks, scanTopLevelStatements, findEnclosingFunction, findEnclosingTopLevel,
  isCosmeticLine, findSpanForLines, findSpansForLines, regionForLines, mergeSpans,
  replaceSpan, replaceSpans,
};
