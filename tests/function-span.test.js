// tests/function-span.test.js — hledání rozsahu funkce v JS zdrojáku
// ══════════════════════════════════════════════════════════════════════════════
// Scanner nemá parser, takže se testuje přesně to, na čem počítání závorek
// obvykle padá: závorky v řetězcích, šablonách, komentářích a regulárních
// výrazech, a odlišení funkce od `if`/`for` bloku.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  findEnclosingFunction, findSpanForLines, findSpansForLines,
  replaceSpan, replaceSpans, scanBlocks,
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

test('řádek mimo funkci rozsahy zruší', () => {
  const withImport = `import x from 'y';\n${SAMPLE}`;
  assertEqual(findSpansForLines(withImport, [1, 4]), null);
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
