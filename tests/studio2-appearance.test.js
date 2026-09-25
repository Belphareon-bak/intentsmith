import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { AppearanceStore, STYLES, KEY } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store.js');
function storage(seed = {}) { const values = new Map(Object.entries(seed)); return {
  getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
}; }
const old = JSON.stringify({ theme: 'light', textIntensity: 40, activeInt: 60, fontSizeVal: 17,
  fontIdx: 2, accentIdx: 4, bgIdx: 2, tileOpacity: 50, bgDim: 40, sidebarOpacity: 70,
  visualMode: 'lines', autoCollapse: false, customCSS: '.intentsmith-root {outline:0}', restoreSession: false, lastView: 'projects' });
const mem = storage({ 'intentsmith-theme-mode': 'clean', 'intentsmith-settings': old,
  'intentsmith.appearance.density': 'compact', 'intentsmith.appearance.uiScale': '1.1' });
const appearance = new AppearanceStore(mem);
assert.equal(mem.getItem('intentsmith-settings'), old);
for (const key of ['style','theme','textIntensity','activeInt','fontSizeVal','fontIdx','accentIdx','bgIdx',
  'tileOpacity','bgDim','sidebarOpacity','visualMode','autoCollapse','customCSS','restoreSession','lastView','density','uiScale']) {
  assert.notEqual(appearance.values[key], undefined, key);
}
assert.equal(appearance.values.style, 'clean');
assert.match(appearance.classes(), /th-clean-light/);
assert.equal(JSON.parse(mem.getItem(KEY)).version, 2);
assert.equal(appearance.set('style', 'matrix'), true);
assert.equal(appearance.effectiveTheme(), 'dark');
assert.equal(appearance.set('theme', 'light'), true);
assert.equal(appearance.effectiveTheme(), 'dark');
assert.equal(appearance.set('fontSizeVal', 200), false);
console.log('PASS old settings migrate without overwrite and invalid values fail closed');

const css = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/styles/tokens.css', import.meta.url), 'utf8');
function lum(hex) { const rgb = [1,3,5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; }
function contrast(a,b) { const [hi,lo] = [lum(a),lum(b)].sort((x,y) => y - x); return (hi + .05) / (lo + .05); }
for (const name of STYLES) {
  for (const tone of ['dark','light']) {
    if (['matrix','japanese','midnight'].includes(name) && tone === 'light') continue;
    const className = ['matrix','japanese','midnight'].includes(name) ? name : `${name}-${tone}`;
    const body = css.match(new RegExp(`\\.th-${className}\\{([^}]+)\\}`))?.[1];
    assert.ok(body, className);
    const props = Object.fromEntries([...body.matchAll(/(--[\w-]+):([^;]+)/g)].map(match => [match[1], match[2]]));
    for (const surface of ['--s0','--s1','--s2']) {
      assert.ok(contrast(props['--tx'],props[surface]) >= 4.5, `${className} text on ${surface}`);
      assert.ok(contrast(props['--faint'],props[surface]) >= 4.5, `${className} faint on ${surface}`);
    }
  }
}
assert.equal(css.split('\n').filter(line => /^\.th-(?:intentsmith|studio|clean|matrix|japanese|midnight|nocturne)(?:-(?:dark|light))?\{/.test(line)).length, 11);
assert.doesNotMatch(css, /fonts\.googleapis\.com|https?:\/\//);
console.log('PASS 11 local theme token sets keep 4.5:1 contrast on primary surfaces');

const source = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/styles/studio2.css', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../docs/studio2/FONT-SOURCES.md', import.meta.url), 'utf8');
for (const family of ['Inter','JetBrains Mono','Plus Jakarta Sans','Share Tech Mono','Zen Kaku Gothic Antique','Yuji Boku']) {
  assert.match(source, new RegExp(`font-family: "${family}"`));
}
const assets = [...manifest.matchAll(/\| `([^`]+\.(?:ttf|txt))` \| \d+ \| `([0-9a-f]{64})`/g)];
assert.equal(assets.length, 12);
for (const [, filename, expected] of assets) {
  const file = new URL(`../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/styles/fonts/${filename}`, import.meta.url);
  assert.equal(existsSync(file), true, filename);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, filename);
}
assert.doesNotMatch(source, /fonts\.googleapis\.com|@import\s+url\(https?:/);
console.log('PASS six OFL font files and licenses are local and digest-pinned');
