#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// P6 — měřený modulový graf `src/**`
// ══════════════════════════════════════════════════════════════════════════════
//
// Zadání:  docs/wp/P6-MODULE-GRAPH.md
// Report:  docs/review/2026-08-07-MODULE-GRAPH.md
//
// Spuštění z kořene repozitáře:
//   node scripts/module-graph.mjs . --out /tmp/module-graph.json
//
// Nástroj je READ-ONLY vůči produktu: čte strom a zapisuje jediný soubor, který
// mu předá `--out`. Není zapojený do `package.json` ani do L1 linky — je to
// měřidlo sondy, ne aparát. Výstup je setříděný, takže `git diff` nad JSON
// ukazuje drift grafu, ne pořadí.
//
// Co nástroj NEVIDÍ (a report to musí říct nahlas):
//   1. `import()` s vypočítanou cestou — 10 míst; jejich cíle uvnitř `src/**`
//      jsou jen migrace a `expertise-layer.js` a jsou pokryté deklarovanými
//      vstupy níž. Zbytek míří mimo `src/**` (balíčky specialistů, npm gramatiky).
//   2. obsah template literálů se záměrně nečte — `src/domains/scaffolds/**`
//      generuje cizí projekty a jejich `import` řádky nejsou hrany tohoto grafu;
//   3. `<script src>` v HTML — proto je `src/ui/**` klasifikované zvlášť.
// ══════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';

const ROOT = resolve(process.argv[2] || '.');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : null;

const CODE_EXT = ['.js', '.mjs', '.cjs', '.jsx'];
const SKIP_DIR = new Set(['node_modules', '.git', 'coverage', 'dist', 'build', '.nyc_output']);
const SCANNER_LIMITATIONS = [
  'computed import() targets are not resolved',
  'template-literal content (including src/domains/scaffolds/**) is ignored',
  'HTML <script src> edges are not modeled',
  'TypeScript declaration/source files are not scanned by protocol 1',
  'static and dynamic imports are reported separately before pair normalization',
];

// Vstupní body nejsou odvoditelné z grafu. Deklarují se a každý má důvod.
const ENTRY_POINTS = [
  { file: 'src/server.js', why: 'package.json main' },
];
const DYNAMIC_ENTRY_RULES = [
  { prefix: 'src/db/migrations/', why: 'src/db/migrate.js:44-50 — readdirSync + import()' },
];
const EXTERNAL_DIRS = ['tests', 'e2e', 'scripts', 'bin', 'specialists', 'c3-ide', 'skills', 'marketplace', 'docker', 'ide-test-client'];

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p, acc);
    } else if (CODE_EXT.some((x) => e.name.endsWith(x))) {
      acc.push(p);
    }
  }
  return acc;
}

// Oddělí kód od komentářů: JSDoc `import('...')` je typová reference, ne hrana.
// Obsah template literálů se vyprázdní — viz limit 2 v hlavičce.
function splitCodeComments(src) {
  let code = '';
  let comments = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      comments += src.slice(i, j) + '\n';
      code += ' ';
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = src.indexOf('*/', i + 2);
      if (j === -1) j = n; else j += 2;
      comments += src.slice(i, j) + '\n';
      code += ' ';
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      code += quote === '`' ? '`' + ' '.repeat(Math.max(0, j - i - 2)) + '`' : src.slice(i, j);
      i = j;
      continue;
    }
    code += c;
    i++;
  }
  return { code, comments };
}

const RE_STATIC = /(?:^|[\s;}])(?:import|export)\s+(?:[\w*{}\n\r\t, $]+\s+from\s+)?['"]([^'"]+)['"]/g;
const RE_BARE_IMPORT = /(?:^|[\s;}])import\s+['"]([^'"]+)['"]/g;
const RE_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_DYNAMIC_COMPUTED = /\bimport\s*\(\s*(?!['"])/g;
const RE_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_JSDOC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extract(file) {
  const src = readFileSync(file, 'utf8');
  const { code, comments } = splitCodeComments(src);
  const lines = src.split('\n');
  const lineOf = (spec) => {
    const idx = lines.findIndex((l) => l.includes(`'${spec}'`) || l.includes(`"${spec}"`));
    return idx === -1 ? 0 : idx + 1;
  };
  const runtime = new Map();
  let m;
  for (const [re, kind] of [[RE_STATIC, 'static'], [RE_BARE_IMPORT, 'static'], [RE_DYNAMIC, 'dynamic'], [RE_REQUIRE, 'require']]) {
    re.lastIndex = 0;
    while ((m = re.exec(code))) if (!runtime.has(m[1])) runtime.set(m[1], { kind, line: lineOf(m[1]) });
  }
  const typeOnly = new Set();
  RE_JSDOC_IMPORT.lastIndex = 0;
  while ((m = RE_JSDOC_IMPORT.exec(comments))) if (!runtime.has(m[1])) typeOnly.add(m[1]);
  RE_DYNAMIC_COMPUTED.lastIndex = 0;
  const computedDynamic = (code.match(RE_DYNAMIC_COMPUTED) || []).length;
  return { runtime, typeOnly, computedDynamic, loc: lines.length };
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return { kind: 'bare', target: spec };
  const base = resolve(dirname(fromFile), spec);
  const cands = [base, ...CODE_EXT.map((e) => base + e), ...CODE_EXT.map((e) => join(base, 'index' + e)), base + '.json'];
  for (const c of cands) {
    try { if (statSync(c).isFile()) return { kind: 'file', target: c }; } catch { /* další kandidát */ }
  }
  return { kind: 'unresolved', target: base };
}

// ── sběr ──────────────────────────────────────────────────────────────────────
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const srcFiles = walk(join(ROOT, 'src')).sort();
const extFiles = EXTERNAL_DIRS.flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : [])).sort();

const nodes = new Map();
for (const f of srcFiles) nodes.set(rel(f), { file: rel(f), loc: 0, out: [], in: [], typeOnlyIn: [], extIn: [], computedDynamic: 0 });

const edges = [];
const typeEdges = [];
const unresolvedEdges = [];
const externalEdges = [];

for (const f of srcFiles) {
  const r = rel(f);
  const node = nodes.get(r);
  const { runtime, typeOnly, computedDynamic, loc } = extract(f);
  node.loc = loc;
  node.computedDynamic = computedDynamic;
  for (const [spec, meta] of runtime) {
    const res = resolveSpec(f, spec);
    if (res.kind === 'bare') continue;
    if (res.kind === 'unresolved') { unresolvedEdges.push({ from: r, spec, line: meta.line }); continue; }
    const t = rel(res.target);
    if (!nodes.has(t)) { externalEdges.push({ from: r, to: t, kind: meta.kind, direction: 'src->out' }); continue; }
    if (t === r) continue;
    edges.push({ from: r, to: t, kind: meta.kind, line: meta.line });
    node.out.push(t);
    nodes.get(t).in.push(r);
  }
  for (const spec of typeOnly) {
    const res = resolveSpec(f, spec);
    if (res.kind !== 'file') continue;
    const t = rel(res.target);
    if (!nodes.has(t) || t === r) continue;
    typeEdges.push({ from: r, to: t });
    nodes.get(t).typeOnlyIn.push(r);
  }
}

for (const f of extFiles) {
  const r = rel(f);
  let ex;
  try { ex = extract(f); } catch { continue; }
  for (const [spec, meta] of ex.runtime) {
    const res = resolveSpec(f, spec);
    if (res.kind !== 'file') continue;
    const t = rel(res.target);
    if (!nodes.has(t)) continue;
    externalEdges.push({ from: r, to: t, kind: meta.kind, direction: 'out->src' });
    nodes.get(t).extIn.push(r);
  }
}

// ── cykly (Tarjan, iterativní) ────────────────────────────────────────────────
const adj = new Map();
for (const [k, v] of nodes) adj.set(k, [...new Set(v.out)].sort());

function tarjan(nodeIds) {
  const index = new Map(); const low = new Map(); const onStack = new Set();
  const stack = []; const sccs = []; let idx = 0;
  for (const start of nodeIds) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      if (frame[1] === 0) { index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.add(v); }
      let recursed = false;
      const kids = adj.get(v) || [];
      for (let i = frame[1]; i < kids.length; i++) {
        const w = kids[i];
        if (!index.has(w)) { frame[1] = i + 1; work.push([w, 0]); recursed = true; break; }
        if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (recursed) continue;
      if (low.get(v) === index.get(v)) {
        const comp = []; let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) sccs.push(comp.sort());
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }
  return sccs;
}
const cycles = tarjan([...nodes.keys()].sort()).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

// ── dosažitelnost z deklarovaných vstupů ──────────────────────────────────────
const entrySet = new Set();
for (const e of ENTRY_POINTS) if (nodes.has(e.file)) entrySet.add(e.file);
for (const f of nodes.keys()) for (const r of DYNAMIC_ENTRY_RULES) if (f.startsWith(r.prefix)) entrySet.add(f);
for (const e of externalEdges) if (e.direction === 'out->src' && e.from.startsWith('bin/')) entrySet.add(e.to);

const reachable = new Set();
const queue = [...entrySet];
while (queue.length) {
  const v = queue.pop();
  if (reachable.has(v)) continue;
  reachable.add(v);
  for (const w of adj.get(v) || []) if (!reachable.has(w)) queue.push(w);
}

const classify = (f) => {
  const n = nodes.get(f);
  const consumers = [...new Set(n.extIn)].sort();
  if (f.startsWith('src/ui/')) return { klass: 'browser-asset', consumers };
  if (consumers.length === 0) return { klass: 'bez-konzumenta', consumers };
  if (consumers.every((c) => c.startsWith('tests/') || c.startsWith('e2e/'))) return { klass: 'jen-testy', consumers };
  return { klass: 'externi-vstup', consumers };
};

const unreachable = [...nodes.keys()].filter((f) => !reachable.has(f)).sort().map((f) => {
  const n = nodes.get(f);
  const { klass, consumers } = classify(f);
  return { file: f, loc: n.loc, fanIn: new Set(n.in).size, klass, extConsumers: consumers };
});

const fanIn = [...nodes.values()].map((n) => ({
  file: n.file,
  fanIn: new Set(n.in).size,
  fanOut: new Set(n.out).size,
  extIn: new Set(n.extIn).size,
  typeOnlyIn: new Set(n.typeOnlyIn).size,
  loc: n.loc,
  reachable: reachable.has(n.file),
})).sort((a, b) => b.fanIn - a.fanIn || a.file.localeCompare(b.file));

// ── barely: deklarovaná hranice versus skutečné importy ───────────────────────
const barrels = fanIn.filter((n) => /\/index\.js$/.test(n.file)).map((b) => {
  const d = b.file.replace(/\/[^/]+$/, '');
  const outside = (e) => !e.from.startsWith(d + '/');
  return {
    barrel: b.file,
    viaBarrel: edges.filter((e) => e.to === b.file && outside(e)).length,
    deepBypass: edges.filter((e) => e.to.startsWith(d + '/') && e.to !== b.file && outside(e)).length,
  };
}).sort((a, b) => b.deepBypass - a.deepBypass);

const out = {
  meta: {
    tool: 'scripts/module-graph.mjs',
    protocol: 1,
    limitations: SCANNER_LIMITATIONS,
    zadani: 'docs/wp/P6-MODULE-GRAPH.md',
    report: 'docs/review/2026-08-07-MODULE-GRAPH.md',
    entryPoints: ENTRY_POINTS,
    dynamicEntryRules: DYNAMIC_ENTRY_RULES,
  },
  counts: {
    srcFiles: srcFiles.length,
    internalEdges: edges.length,
    staticEdges: edges.filter((e) => e.kind === 'static').length,
    dynamicEdges: edges.filter((e) => e.kind === 'dynamic').length,
    typeOnlyEdges: typeEdges.length,
    unresolvedSpecifiers: unresolvedEdges.length,
    computedDynamicSites: [...nodes.values()].reduce((a, n) => a + n.computedDynamic, 0),
    externalIntoSrc: externalEdges.filter((e) => e.direction === 'out->src').length,
    zeroFanIn: fanIn.filter((n) => n.fanIn === 0).length,
    entrySetSize: entrySet.size,
    reachable: reachable.size,
    unreachable: unreachable.length,
    unreachableLoc: unreachable.reduce((a, u) => a + u.loc, 0),
    cycles: cycles.length,
    filesInCycles: cycles.reduce((a, c) => a + c.length, 0),
  },
  fanIn,
  unreachable,
  cycles,
  barrels,
  // hrany jako setříděné řetězce: `git diff` nad tímhle polem je drift grafu
  edges: [...new Set(edges.map((e) => `${e.from} -> ${e.to}${e.kind === 'dynamic' ? ' (dynamic)' : ''}`))].sort(),
  externalIntoSrc: [...new Set(externalEdges.filter((e) => e.direction === 'out->src').map((e) => `${e.from} -> ${e.to}`))].sort(),
};

if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.counts, null, 2));
