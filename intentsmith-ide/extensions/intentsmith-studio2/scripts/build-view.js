#!/usr/bin/env node
'use strict';

// Vygeneruje vizuální vrstvu Studia 2 z klikacího prototypu (docs/studio2/prototype):
//   lib/browser/view/generated/view.js   – šablona prototypu přeložená na React render
//   lib/browser/view/generated/model.js  – logika prototypu (stav → view model)
//   lib/browser/view/generated/proto.css – styly prototypu a motivy, omezené na widget
// Vzhled se tak nepřepisuje ručně: co je v prototypu, to je v IDE. Generované soubory
// se needitují; mění se prototyp a spustí se tento skript (viz view/README.md).

const fs = require('fs');
const path = require('path');

const EXT = path.resolve(__dirname, '..');
const REPO = path.resolve(EXT, '..', '..', '..');
const PROTO = path.join(REPO, 'docs', 'studio2', 'prototype', 'src');
const TOKENS = path.join(REPO, 'docs', 'studio2', 'design', 'tokens.css');
const OUT = path.join(EXT, 'lib', 'browser', 'view', 'generated');
const SCOPE = '.intentsmith-studio2-widget';
// Tapety jsou na plátně prototypu nahrané jako assety; rozšíření má vlastní kopie.
const WALLPAPERS = { matrix: '../../styles/bg-matrix.jpg', japanese: '../../styles/bg-japanese.jpg', midnight: '../../styles/bg-midnight.jpg' };

const HEADER = '// VYGENEROVÁNO scripts/build-view.js z docs/studio2/prototype – needitovat ručně.\n';

// ---------- šablona → React ----------

const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const SVG_ATTR = { 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule' };
const ATTR = { class: 'className', for: 'htmlFor', spellcheck: 'spellCheck', tabindex: 'tabIndex', readonly: 'readOnly', autofocus: 'autoFocus' };

function parse(src) {
  const root = { tag: '#root', attrs: [], kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      if (top.tag !== m[1]) throw new Error(`Neočekávané </${m[1]}>, otevřené je <${top.tag}> (pozice ${m.index})`);
      stack.pop();
    } else if (m[2]) {
      const attrs = [];
      const ra = /([^\s=>\/]+)(?:="([^"]*)")?/g;
      let a;
      while ((a = ra.exec(m[3]))) attrs.push([a[1], a[2] === undefined ? '' : a[2]]);
      const node = { tag: m[2], attrs, kids: [] };
      top.kids.push(node);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(node);
    } else if (m[5]) {
      top.kids.push({ text: m[5] });
    }
  }
  if (stack.length !== 1) throw new Error('Neuzavřený element <' + stack[stack.length - 1].tag + '>');
  return root;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function pathExpr(p, scope) {
  const t = p.trim();
  if (t === 'true' || t === 'false') return t;
  if (!/^[\w$]+(\.[\w$]+)*$/.test(t)) throw new Error('Nepodporovaný výraz {{' + t + '}}');
  const segs = t.split('.');
  const head = scope.includes(segs[0]) ? '$' + segs[0] : 'vm.' + segs[0];
  return [head].concat(segs.slice(1)).join('.');
}

// "a {{x}} b" → výraz; samotné {{x}} zůstane hodnotou (funkce, číslo, pole).
function interp(value, scope) {
  const parts = [];
  const re = /\{\{([^}]*)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(value))) {
    if (m.index > last) parts.push(JSON.stringify(decode(value.slice(last, m.index))));
    parts.push({ e: pathExpr(m[1], scope) });
    last = re.lastIndex;
  }
  if (last < value.length) parts.push(JSON.stringify(decode(value.slice(last))));
  if (parts.length === 1 && typeof parts[0] === 'object') return parts[0].e;
  if (!parts.some((x) => typeof x === 'object')) return parts.join(' + ') || '""';
  return parts.map((x) => (typeof x === 'object' ? 'S(' + x.e + ')' : x)).join(' + ');
}

function attrOf(node, name) {
  const a = node.attrs.find((x) => x[0] === name);
  return a ? a[1] : undefined;
}

function genKids(kids, scope, ind) {
  const out = [];
  kids.forEach((k, i) => {
    if (k.text !== undefined) {
      if (!k.text.trim()) {
        // Formátovací odřádkování mezi bloky se neprojeví; mezera mezi inline prvky ano.
        if (/\n/.test(k.text)) return;
        out.push('" "');
        return;
      }
      const txt = k.text.replace(/\s*\n\s*/g, ' ');
      out.push(interp(txt, scope));
      return;
    }
    out.push(gen(k, scope, ind));
  });
  return out;
}

function gen(node, scope, ind) {
  const pad = '  '.repeat(ind);
  if (node.tag === 'sc-if') {
    const cond = interp(attrOf(node, 'value'), scope);
    const kids = genKids(node.kids, scope, ind + 1);
    return `(${cond}) ? h(F, null${kids.length ? ',\n' + kids.map((x) => pad + '  ' + x).join(',\n') : ''}) : null`;
  }
  if (node.tag === 'sc-for') {
    const list = interp(attrOf(node, 'list'), scope);
    const as = attrOf(node, 'as');
    const inner = scope.concat([as]);
    const kids = genKids(node.kids, inner, ind + 2);
    return `L(${list}).map(($${as}, $i${ind}) => h(F, { key: $i${ind} }${kids.length ? ',\n' + kids.map((x) => pad + '    ' + x).join(',\n') : ''}))`;
  }
  const props = [];
  for (const [name, value] of node.attrs) {
    if (name.startsWith('hint-')) continue;
    let key = ATTR[name] || SVG_ATTR[name] || name;
    const v = interp(value, scope);
    if (key === 'style') { props.push(`style: css(${v})`); continue; }
    if (key === 'data-html') { props.push(`dangerouslySetInnerHTML: { __html: ${v} }`); continue; }
    if (/^on[A-Z]/.test(key)) { props.push(`${key}: ${v}`); continue; }
    props.push(`${/^[\w$]+$/.test(key) ? key : JSON.stringify(key)}: ${v}`);
  }
  const tag = JSON.stringify(node.tag);
  const p = props.length ? '{ ' + props.join(', ') + ' }' : 'null';
  if (node.tag === 'style') {
    const body = node.kids.map((k) => (k.text !== undefined ? interp(k.text.trim(), scope) : '""')).join(' + ');
    return `h("style", null, ${body || '""'})`;
  }
  const kids = genKids(node.kids, scope, ind + 1);
  if (!kids.length) return `h(${tag}, ${p})`;
  return `h(${tag}, ${p},\n${kids.map((x) => pad + '  ' + x).join(',\n')})`;
}

// ---------- CSS ----------

function scopeCss(css) {
  let out = '';
  let i = 0;
  const readBlock = (from) => {
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) return j; }
    }
    throw new Error('Neuzavřený CSS blok');
  };
  const scopeSel = (sel) => sel.split(',').map((s) => {
    const t = s.trim();
    if (!t) return t;
    if (/^(html|body)\b/.test(t)) return null;
    return SCOPE + ' ' + t;
  }).filter(Boolean).join(',');
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) { out += css.slice(i); break; }
    const head = css.slice(i, open).trim();
    const close = readBlock(open);
    const body = css.slice(open + 1, close);
    if (/^@(media|container|supports)/.test(head)) out += head + '{' + scopeCss(body) + '}\n';
    else if (/^@keyframes\s+/.test(head)) out += head.replace(/@keyframes\s+([\w-]+)/, '@keyframes s2-$1') + '{' + body + '}\n';
    else if (/^@/.test(head)) out += head + '{' + body + '}\n';
    else { const sel = scopeSel(head); if (sel) out += sel + '{' + body + '}\n'; }
    i = close + 1;
  }
  return out;
}

function buildCss(template) {
  const style = template.split('<helmet>')[1].split('</helmet>')[0].match(/<style>([\s\S]*?)<\/style>/)[1];
  let tokens = fs.readFileSync(TOKENS, 'utf8').replace(/^\/\*[^*]*\*\/\s*/, '');
  // Motiv → přibalená tapeta (pravidla .ide.th-<motiv> a .mini.th-<motiv>).
  tokens = tokens.replace(/(\.(?:ide|mini)\.th-(\w+)\{[^}]*?)url\(\/_blob\/[0-9a-f]+\)/g, (all, pre, theme) => {
    if (!WALLPAPERS[theme]) throw new Error('Chybí tapeta pro motiv ' + theme);
    return pre + 'url(' + WALLPAPERS[theme] + ')';
  });
  if (/\/_blob\//.test(tokens)) throw new Error('V motivech zůstal odkaz na asset plátna');
  const css = decode(style.replace('/*THEMES*/', tokens)).replace(/\/\*[\s\S]*?\*\//g, '');
  return scopeCss(css).replace(/animation:(\s*)(pulse|spin)\b/g, 'animation:$1s2-$2');
}

// ---------- výstup ----------

function main() {
  const template = fs.readFileSync(path.join(PROTO, 'main.template.html'), 'utf8');
  const script = fs.readFileSync(path.join(PROTO, 'main.js'), 'utf8');
  const body = template.split('</helmet>')[1].split('</x-dc>')[0];
  const tree = parse(body);
  const roots = tree.kids.filter((k) => k.tag);
  if (roots.length !== 1) throw new Error('Šablona musí mít jeden kořenový element, má ' + roots.length);
  const view = HEADER + `'use strict';

// Render šablony prototypu. vm = Component#renderVals(); h = React.createElement.
function render(vm, h, F, rt) {
  const S = rt.S, L = rt.L, css = rt.css;
  return ${gen(roots[0], [], 1)};
}

module.exports = { render };
`;
  const model = HEADER + `'use strict';

const { DCLogic } = require('../dc-logic');

${script.trim()}

module.exports = { Component };
`;
  const files = {
    'view.js': view,
    'model.js': model,
    'proto.css': '/* VYGENEROVÁNO scripts/build-view.js z docs/studio2/prototype – needitovat ručně. */\n' + buildCss(template)
  };
  if (process.argv.includes('--check')) {
    // Vygenerované soubory musí odpovídat prototypu; jinak se vzhled potichu rozejde.
    const stale = Object.keys(files).filter((f) => !fs.existsSync(path.join(OUT, f)) || fs.readFileSync(path.join(OUT, f), 'utf8') !== files[f]);
    if (stale.length) {
      console.error('Zastaralé: ' + stale.join(', ') + ' – spusť node scripts/build-view.js');
      process.exit(1);
    }
    console.log('PASS vizuální vrstva odpovídá prototypu');
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), text);
  console.log(Object.entries(files).map(([f, text]) => f + ' ' + text.length).join(' · '));
}

main();
