// tests/function-span.test.js — hledání rozsahu funkce v JS zdrojáku
// ══════════════════════════════════════════════════════════════════════════════
// Scanner nemá parser, takže se testuje přesně to, na čem počítání závorek
// obvykle padá: závorky v řetězcích, šablonách, komentářích a regulárních
// výrazech, a odlišení funkce od `if`/`for` bloku.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  findEnclosingFunction, findEnclosingTopLevel, findSpanForLines, findSpansForLines,
  isCosmeticLine, replaceSpan, replaceSpans, scanBlocks, scanTopLevelStatements,
} from '../src/eval/function-span.js';

suite('function-span');

const SAMPLE = `export function alpha(a) {
  if (a > 1) {
    return a;
  }
  return 0;
}

const beta = async (x) => {
  const s = "a { b } c";
  const t = \`sablona \${x ? '{' : '}'} konec\`;
  // komentar s { zavorkou
  /* blok } s zavorkou */
  const re = /[{}]+/g;
  return s + t + re.source;
};

class Gamma {
  async delta(n) {
    for (let i = 0; i < n; i++) {
      n += i;
    }
    return n;
  }
}
`;

test('najde deklarovanou funkci a nesplete si ji s vnitřním if', () => {
  const span = findEnclosingFunction(SAMPLE, 3);   // uvnitř `if`
  assert(span, 'funkce nenalezena');
  assertEqual(span.startLine, 1);
  assertEqual(span.endLine, 6);
  assert(span.header.includes('alpha'), `čekal alpha, dostal ${span.header}`);
});

test('závorky v řetězci, šabloně, komentáři a regexu nerozhodí rozsah', () => {
  const span = findEnclosingFunction(SAMPLE, 13);  // řádek s `const re`
  assert(span, 'funkce nenalezena');
  assert(span.header.includes('beta'), `čekal beta, dostal ${span.header}`);
  assertEqual(span.startLine, 8);
  assertEqual(span.endLine, 15);
});

test('metoda třídy se najde, cyklus uvnitř se přeskočí', () => {
  const span = findEnclosingFunction(SAMPLE, 20);  // uvnitř `for`
  assert(span, 'funkce nenalezena');
  assert(span.header.includes('delta'), `čekal delta, dostal ${span.header}`);
});

test('změna přes dvě funkce nemá jednotný rozsah', () => {
  assertEqual(findSpanForLines(SAMPLE, [3, 20]), null);
});

test('změna uvnitř jedné funkce rozsah má', () => {
  const span = findSpanForLines(SAMPLE, [2, 3, 5]);
  assert(span && span.header.includes('alpha'), 'čekal jednotný rozsah v alpha');
});

test('scanBlocks nepočítá závorky uvnitř řetězců', () => {
  const blocks = scanBlocks('function f() { const s = "{{{"; }');
  assertEqual(blocks.length, 1);
});

// Regrese: u vlastnosti objektu končí řádek `},` — když se čárka při náhradě
// ztratí, soubor přestane být syntakticky platný.  Přesně tohle shodilo
// `node --check` u úlohy a33cc20a.
test('náhrada zachová zbytek řádku za uzavírací závorkou', () => {
  const src = `const routes = {
  'GET /a': (req) => {
    return 1;
  },
  'GET /b': () => 2,
};
`;
  const span = findEnclosingFunction(src, 3);
  assert(span, 'funkce nenalezena');
  assertEqual(span.tail, ',');
  const out = replaceSpan(src, span.startLine, span.endLine, `  'GET /a': (req) => {\n    return 42;\n  }`, span.tail);
  assert(out.includes('return 42;'), 'nová verze se nevložila');
  assert(/\}\s*,\s*\n\s*'GET \/b'/.test(out), `čárka za blokem chybí:\n${out}`);
});

test('náhrada srovná odsazení podle původní funkce', () => {
  const src = `class A {
  m() {
    return 1;
  }
}
`;
  const span = findEnclosingFunction(src, 3);
  const out = replaceSpan(src, span.startLine, span.endLine, `m() {\n    return 2;\n  }`, span.tail);
  assert(out.includes('  m() {'), `odsazení se nesrovnalo:\n${out}`);
});

// ─── víc funkcí v jedné změně ───────────────────────────────────────────────

test('findSpansForLines najde všechny dotčené funkce', () => {
  const spans = findSpansForLines(SAMPLE, [3, 20]);
  assert(spans, 'rozsahy nenalezeny');
  assertEqual(spans.length, 2);
  assert(spans[0].header.includes('alpha'), spans[0].header);
  assert(spans[1].header.includes('delta'), spans[1].header);
});

test('findSpansForLines vrátí rozsahy vzestupně a bez duplicit', () => {
  const spans = findSpansForLines(SAMPLE, [20, 3, 5]);   // pořadí naschvál zamíchané
  assertEqual(spans.length, 2);
  assert(spans[0].startLine < spans[1].startLine, 'rozsahy nejsou seřazené');
});

// ─── vrcholové konstrukce ───────────────────────────────────────────────────
//
// Bez nich propadlo sítem „mimo funkce" 20 z 32 kandidátů: commit typicky mění
// import nahoře a zároveň tělo metody dole.

const TOP = `import x from 'y';
import {
  alpha,
  beta,
} from './dvojice.js';

const LIMIT = 40;

const HANDLERS = {
  ping(n) {
    return n + 1;
  },
};

function volna(a) {
  return a * 2;
}

export default { LIMIT, HANDLERS };
`;

test('scanTopLevelStatements rozdělí soubor na vrcholové příkazy', () => {
  const stmts = scanTopLevelStatements(TOP);
  const starts = stmts.map(st => st.startLine);
  assert(starts.includes(1), `chybí první import: ${starts}`);
  assert(starts.includes(2), `chybí víceřádkový import: ${starts}`);
  assert(starts.includes(7), `chybí konstanta: ${starts}`);
  assert(starts.includes(9), `chybí objekt: ${starts}`);
  assert(starts.includes(15), `chybí deklarace funkce: ${starts}`);
});

test('import se najde jako vrcholová konstrukce, i když je přes víc řádků', () => {
  const span = findEnclosingTopLevel(TOP, 3);   // řádek `alpha,`
  assert(span, 'konstrukce nenalezena');
  assertEqual(span.kind, 'top-level');
  assertEqual(span.startLine, 2);
  assertEqual(span.endLine, 5);
  assertEqual(span.name, 'import:./dvojice.js');
});

// Totožnost konstrukce nemůže být hlavička — tu mění právě oprava.
test('konstanta si drží totožnost i když se hodnota změní', () => {
  const before = findEnclosingTopLevel(TOP, 7);
  const after = findEnclosingTopLevel(TOP.replace('LIMIT = 40', 'LIMIT = 60'), 7);
  assertEqual(before.name, 'LIMIT');
  assertEqual(after.name, 'LIMIT');
  assert(before.header !== after.header, 'hlavička se měla lišit');
});

test('`const X = {…};` končí až středníkem, deklarace funkce závorkou', () => {
  const objekt = findEnclosingTopLevel(TOP, 9);
  assertEqual(objekt.startLine, 9);
  assertEqual(objekt.endLine, 13);
  const fn = findEnclosingTopLevel(TOP, 15);
  assertEqual(fn.startLine, 15);
  assertEqual(fn.endLine, 17);
});

test('funkce má přednost před konstrukcí, která ji obsahuje', () => {
  const span = findSpansForLines(TOP, [11]);   // uvnitř metody `ping`
  assertEqual(span.length, 1);
  assertEqual(span[0].kind, 'function');
  assertEqual(span[0].name, 'ping');
});

test('změna v importu i ve funkci dá dva rozsahy', () => {
  const spans = findSpansForLines(TOP, [1, 16]);
  assert(spans, 'rozsahy nenalezeny');
  assertEqual(spans.length, 2);
  assertEqual(spans[0].kind, 'top-level');
  assertEqual(spans[1].kind, 'function');
  assert(spans[0].startLine < spans[1].startLine, 'rozsahy nejsou seřazené');
});

// Kdyby se do replaceSpans dostal vnitřní i vnější rozsah, druhá náhrada by
// přepsala text, který první právě vložila.
test('vnořený rozsah se slije do vnějšího', () => {
  const spans = findSpansForLines(TOP, [9, 11]);   // `const HANDLERS = {` i tělo `ping`
  assertEqual(spans.length, 1);
  assertEqual(spans[0].kind, 'top-level');
  assertEqual(spans[0].endLine, 13);
});

test('náhrada míchající konstrukci a funkci nechá soubor platný', () => {
  const spans = findSpansForLines(TOP, [7, 16]);
  const out = replaceSpans(TOP, spans, ['const LIMIT = 99;', 'function volna(a) {\n  return a * 3;\n}']);
  assert(out.includes('const LIMIT = 99;'), 'konstanta se nevložila');
  assert(out.includes('return a * 3;'), 'funkce se nevložila');
  assert(out.includes('export default { LIMIT, HANDLERS };'), 'kód pod rozsahy se ztratil');
  assert(!out.includes('LIMIT = 40'), 'zůstala původní konstanta');
});

// ─── počítání řádků ─────────────────────────────────────────────────────────
//
// `/` se pozná jako začátek regulárního výrazu podle toho, co stojí před ním.
// Když se spletl a „regex" se do konce řádku nezavřel, scanner ten řádek
// započítal dvakrát — jednou při vzdávání pokusu, podruhé v hlavní smyčce —
// a všechna další čísla řádků byla o jedna vedle.  V `cre-decision.js` kvůli
// tomu scanner míjel 53 vrcholových deklarací.

test('neuzavřené lomítko neposune číslování řádků', () => {
  const src = `const podil = a / b;
const c = 1;

function pozdeji(x) {
  return x;
}
`;
  const span = findEnclosingFunction(src, 5);
  assert(span, 'funkce nenalezena');
  assertEqual(span.startLine, 4);
  assertEqual(span.endLine, 6);
});

test('pole regulárních výrazů se uzavře na svém řádku', () => {
  const src = `const VZORY = [
  /^(najdi|hledej)/i,
  /cen[auě]\\s+\\w+/i,   // "cena bitcoin"
  /.{5,}/i,
];

function potom(x) {
  return x;
}
`;
  const stmts = scanTopLevelStatements(src);
  assertEqual(stmts[0].startLine, 1);
  assertEqual(stmts[0].endLine, 5);
  const span = findEnclosingFunction(src, 8);
  assert(span, 'funkce za polem se nenašla');
  assertEqual(span.startLine, 7);
});

// ─── řádky, které nenesou chování ───────────────────────────────────────────

test('prázdný řádek a komentář mimo funkci se zahodí', () => {
  const src = `// hlavička souboru\n\n${SAMPLE}`;
  assert(isCosmeticLine(src, 1), 'komentář se nepoznal');
  assert(isCosmeticLine(src, 2), 'prázdný řádek se nepoznal');
  const spans = findSpansForLines(src, [1, 2, 5]);   // 5 = uvnitř alpha
  assertEqual(spans.length, 1);
  assert(spans[0].header.includes('alpha'), spans[0].header);
});

test('samé zahozené řádky úlohu zruší — nezůstalo by co zadat', () => {
  assertEqual(findSpansForLines(`// jen komentář\n\n${SAMPLE}`, [1, 2]), null);
});

test('příkaz, který na svém řádku není sám, se nevrací', () => {
  // Náhrada jde po celých řádcích, takže by souseda smazala.
  assertEqual(findEnclosingTopLevel('const a = 1; const b = 2;\n', 1)?.name, 'a');
  assertEqual(findEnclosingTopLevel('const a = 1; const b = 2;\n', 1) && findSpansForLines('const a = 1; const b = 2;\n', [1]).length, 1);
});

// Náhrady musí jít od konce — při postupu shora by druhá trefila posunuté řádky.
test('replaceSpans nahradí víc funkcí najednou', () => {
  const spans = findSpansForLines(SAMPLE, [3, 20]);
  const out = replaceSpans(SAMPLE, spans, [
    'export function alpha(a) {\n  return 111;\n}',
    '  async delta(n) {\n    return 222;\n  }',
  ]);
  assert(out.includes('return 111;'), 'první funkce se nevložila');
  assert(out.includes('return 222;'), 'druhá funkce se nevložila');
  assert(out.includes('const beta'), 'kód mezi funkcemi se ztratil');
  assert(!out.includes('return a;'), 'zůstal původní kód první funkce');
});

test('replaceSpans odmítne nesouhlasný počet náhrad', () => {
  const spans = findSpansForLines(SAMPLE, [3, 20]);
  let threw = false;
  try { replaceSpans(SAMPLE, spans, ['jen jedna']); } catch { threw = true; }
  assert(threw, 'nesouhlasný počet měl skončit chybou');
});

summary();
