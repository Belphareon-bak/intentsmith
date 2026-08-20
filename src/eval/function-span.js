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
 * Rozdělí zdroják na bloky `{...}` a přeskočí přitom řetězce, komentáře,
 * šablony a regulární výrazy — jinak by `{` v řetězci rozhodilo počítání.
 *
 * @returns {Array<{open: number, close: number, startLine: number, endLine: number, depth: number}>}
 */
export function scanBlocks(src) {
  const blocks = [];
  const stack = [];
  const templateStack = [];   // hloubka `${}` uvnitř šablon
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
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') { line++; i++; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          templateStack.push(1);
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
          templateStack.pop();
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
      if (REGEX_PRECEDING.test(before) || REGEX_KEYWORD.test(before) || lastSignificant === '') {
        i++;
        let inClass = false;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) { i++; break; }
          else if (src[i] === '\n') { line++; break; }   // neuzavřený → nebyl to regex
          i++;
        }
        lastSignificant = '/';
        continue;
      }
      i++;
      lastSignificant = '/';
      continue;
    }

    if (c === '{') {
      stack.push({ open: i, startLine: line });
      i++;
      lastSignificant = '{';
      continue;
    }
    if (c === '}') {
      const b = stack.pop();
      if (b) blocks.push({ open: b.open, close: i, startLine: b.startLine, endLine: line, depth: stack.length });
      i++;
      lastSignificant = '}';
      continue;
    }

    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }

  return blocks;
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
      startLine: block.startLine,
      endLine: block.endLine,
      text: src.slice(lineStart, block.close + 1),
      header: header.trim(),
      tail,
    };
  }
  return null;
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

export default { scanBlocks, findEnclosingFunction, findSpanForLines, replaceSpan };
