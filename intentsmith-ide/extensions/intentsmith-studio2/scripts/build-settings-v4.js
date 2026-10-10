#!/usr/bin/env node
'use strict';

// Sestaví styly Nastavení v4 z klikacího návrhu V4 (docs/studio2/settings-v4/design, piny v README).
//   lib/browser/settings-v4/settings-v4.css – pravidla návrhu omezená na ostrov .sv4 ve widgetu Studia 2
// Lešení návrhu (horní lišta, boční navigace, záložky editoru, stavový řádek, Git a hodnocení) se vypouští.
// Barvy zůstávají proměnnými motivu IDE (docs/studio2/settings-v4/ide.css), rem se váže na velikost písma IDE
// a breakpointy okna se převádějí na šířku ostrova. Generovaný soubor se needituje; --check hlídá shodu.

const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..', '..');
const SRC = path.join(REPO, 'docs', 'studio2', 'settings-v4');
const OUT = path.join(EXT, 'lib', 'browser', 'settings-v4', 'settings-v4.css');
const SCOPE = '.intentsmith-studio2-widget .sv4';
const FILES = ['design/styles.css', 'design/model-v2.css', 'design/settings-v2.css', 'design/hunt-v2.css', 'design/fixes-v4.css', 'ide.css'];
// Šířka lešení návrhu kolem obsahu (boční navigace + pravý přehled + okraje). Breakpoint okna W odpovídá
// obsahu široké W − SHELL; ostrov v IDE tak láme rozložení při stejné šířce obsahu jako návrh.
const SHELL = 470;
const DROP = /^(?:\.shell|\.topbar|\.brand|\.top-left|\.top-right|\.menu-btn|\.command(?!-)|\.view-switch|\.density-control|\.workspace|\.sidebar|\.nav-btn|\.editor-tab|\.design-label|\.statusbar|\.status-dot|\.theme-switch|\.git-|\.file-|\.diff-|\.commit-|\.feedback-|\.folder-picker|\.picker-|\.folder-item|\.command-item|\.main\b|html\b|body\b)/;
const HEADER = '/* VYGENEROVÁNO scripts/build-settings-v4.js z docs/studio2/settings-v4 – needitovat ručně. */\n';

function parse(css) {
  const nodes = [];
  let i = 0;
  const skipComment = () => { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; };
  while (i < css.length) {
    if (css.startsWith('/*', i)) { skipComment(); continue; }
    if (/\s/.test(css[i])) { i++; continue; }
    let start = i;
    while (i < css.length && css[i] !== '{' && css[i] !== ';') { if (css.startsWith('/*', i)) skipComment(); else i++; }
    const prelude = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (css[i] === ';') { i++; nodes.push({ type: 'statement', text: prelude }); continue; }
    let depth = 1, bodyStart = ++i;
    while (i < css.length && depth) {
      if (css.startsWith('/*', i)) { skipComment(); continue; }
      if (css[i] === '"' || css[i] === "'") { const q = css[i++]; while (i < css.length && css[i] !== q) i += css[i] === '\\' ? 2 : 1; }
      if (css[i] === '{') depth++; else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(bodyStart, i - 1);
    if (prelude.startsWith('@media') || prelude.startsWith('@supports') || prelude.startsWith('@container')) nodes.push({ type: 'group', prelude, children: parse(body) });
    else if (prelude.startsWith('@')) nodes.push({ type: 'raw', prelude, body });
    else nodes.push({ type: 'rule', prelude, body: body.trim() });
  }
  return nodes;
}

function splitSelectors(text) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(' || text[i] === '[') depth++;
    else if (text[i] === ')' || text[i] === ']') depth--;
    else if (text[i] === ',' && !depth) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

function scopeSelector(sel, file = '') {
  if (DROP.test(sel)) return [];
  // :root ve styles.css je pevná paleta návrhu; barvy dodává motiv IDE (ide.css). Ostatní :root jsou odvozené proměnné.
  if (sel === ':root') return file === 'design/styles.css' ? [] : [SCOPE];
  if (sel === '*') return [SCOPE, SCOPE + ' *'];
  if (sel.startsWith('#toast')) return [SCOPE + ' .sv4-toast' + sel.slice(6)];
  return [SCOPE + ' ' + sel];
}

function declarations(body) {
  return body
    .replace(/var\(--text\)/g, 'var(--sv4-fs)')
    .replace(/(^|[^\w.-])(-?\d*\.?\d+)rem\b/g, (m, pre, n) => pre + 'calc(' + n + ' * var(--sv4-fs))');
}

function media(prelude) {
  if (/prefers-/.test(prelude)) return { at: prelude, container: false };
  const m = prelude.match(/^@media\s*\(\s*(max|min)-width\s*:\s*(\d+)px\s*\)$/);
  if (!m) throw new Error('Nepodporovaný blok ' + prelude);
  return { at: '@container sv4 (' + m[1] + '-width:' + Math.max(320, Number(m[2]) - SHELL) + 'px)', container: true };
}

function emit(nodes, file) {
  const ownFile = file === 'ide.css';
  const out = [];
  for (const node of nodes) {
    if (node.type === 'statement') { if (!/^@(charset|import)/.test(node.text)) out.push(node.text + ';'); continue; }
    if (node.type === 'raw') { out.push(node.prelude + '{' + node.body + '}'); continue; }
    if (node.type === 'group') {
      const inner = emit(node.children, file);
      if (!inner.length) continue;
      const at = node.prelude.startsWith('@media') && !ownFile ? media(node.prelude).at : node.prelude;
      out.push(at + '{' + inner.join('') + '}');
      continue;
    }
    const selectors = splitSelectors(node.prelude).flatMap(sel => scopeSelector(sel, file));
    if (selectors.length) out.push(selectors.join(',') + '{' + declarations(node.body) + '}');
  }
  return out;
}

function build() {
  const parts = FILES.map(file => {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    return '/* ' + file + ' */\n' + emit(parse(text), file).join('\n');
  });
  return HEADER + parts.join('\n') + '\n';
}

if (require.main === module) {
  const css = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== css) { console.error('settings-v4.css neodpovídá zdroji; spusť node scripts/build-settings-v4.js'); process.exit(1); }
    console.log('settings-v4.css odpovídá zdroji.');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, css);
    console.log('settings-v4.css: ' + Math.round(css.length / 1024) + ' kB');
  }
}

module.exports = { parse, splitSelectors, scopeSelector, build, OUT };
