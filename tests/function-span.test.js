// tests/function-span.test.js — hledání rozsahu funkce v JS zdrojáku
// ══════════════════════════════════════════════════════════════════════════════
// Scanner nemá parser, takže se testuje přesně to, na čem počítání závorek
// obvykle padá: závorky v řetězcích, šablonách, komentářích a regulárních
// výrazech, a odlišení funkce od `if`/`for` bloku.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { findEnclosingFunction, findSpanForLines, replaceSpan, scanBlocks } from '../src/eval/function-span.js';

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

summary();
