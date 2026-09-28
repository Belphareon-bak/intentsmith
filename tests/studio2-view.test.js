import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'intentsmith-ide/extensions/intentsmith-studio2');
const PROTO = path.join(ROOT, 'docs/studio2/prototype');

// Studio 2 is the sole renderer, including profiles saved by classic Studio.
const browserEntry = readFileSync(path.join(ROOT,
  'intentsmith-ide/applications/electron/intentsmith-browser-entry.js'), 'utf8');
for (const [saved, preview, expected] of [
  [null, true, 'studio2'], ['studio2', false, 'studio2'],
  ['classic', true, 'studio2'], [null, false, 'studio2'],
]) {
  const loaded = [];
  const window = { localStorage: { getItem: () => saved },
    electronIntentSmith: { preferStudio2Preview: () => preview } };
  const document = { documentElement: { dataset: {} } };
  vm.runInNewContext(browserEntry, { window, document, require: name => loaded.push(name) });
  assert.equal(window.__intentsmithStudioMode, expected);
  assert.equal(document.documentElement.dataset.intentsmithStudioMode, expected);
  assert.deepEqual(loaded, ['./intentsmith-local-http-bootstrap', './src-gen/frontend/index']);
}
const preloadSource = readFileSync(path.join(ROOT,
  'intentsmith-ide/applications/electron/intentsmith-preload.js'), 'utf8');
for (const value of ['1', '0']) {
  let bridge;
  const module = { exports: {} };
  vm.runInNewContext(preloadSource, { module, exports: module.exports, window: {}, process: { env: { INTENTSMITH_STUDIO2_PREVIEW: value } },
    console: { log() {} }, require: name => name === 'electron'
      ? { contextBridge: { exposeInMainWorld: (_key, exposed) => { bridge = exposed; } }, ipcRenderer: {} }
      : name === './intentsmith-local-access' ? { readLocalAccess: () => null }
        : { createAttachmentBridge: () => ({}) } });
  module.exports.preload();
  assert.equal(bridge.preferStudio2Preview(), value === '1');
}
console.log('PASS Studio 2 is the sole renderer for new and existing profiles');

// Packaged and source launches must enter the same pre-window bootstrap.
const appDir = path.join(ROOT, 'intentsmith-ide/applications/electron');
const manifest = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
assert.equal(manifest.main, 'scripts/electron-main.js');
assert.match(readFileSync(path.join(appDir, 'electron-builder.yml'), 'utf8'),
  /main: "scripts\/electron-main\.js"/);
for (const savedFlag of [undefined, '0', '1']) {
  const process = { env: { THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS: savedFlag } };
  const loaded = [];
  vm.runInNewContext(readFileSync(path.join(appDir, manifest.main), 'utf8'), {
    process, require: name => {
      // Inspect the flag at import time, when Theia begins creating windows.
      loaded.push(name);
      assert.equal(process.env.THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS, '1');
    },
  });
  assert.deepEqual(loaded, ['../lib/backend/electron-main.js']);
}
assert.equal(manifest.theia.frontend.config.preferences['window.titleBarStyle'], 'custom');
console.log('PASS source and packaged startup choose the custom frame before Theia');

// 1) Vizuální vrstva je vygenerovaná z prototypu a odpovídá mu bajtově.
execFileSync(process.execPath, [path.join(EXT, 'scripts/build-view.js'), '--check'], { stdio: 'inherit' });

// 2) Logika a šablona prototypu: deterministické scénáře a náhodné proklikávání.
const dir = mkdtempSync(path.join(os.tmpdir(), 'studio2-view-'));
try {
  const tpl = readFileSync(path.join(PROTO, 'src/main.template.html'), 'utf8');
  const js = readFileSync(path.join(PROTO, 'src/main.js'), 'utf8');
  const page = path.join(dir, 'Main.dc.html');
  writeFileSync(page, tpl.replace('/*SCRIPT*/', js).replace('/*THEMES*/', ''));
  const scenarios = execFileSync(process.execPath, [path.join(PROTO, 'test/scenarios.cjs'), page], { encoding: 'utf8' });
  assert.match(scenarios, /fails: 0\s*$/, scenarios.split('\n').slice(-6).join('\n'));
  const fuzz = execFileSync(process.execPath, [path.join(PROTO, 'test/fuzz.cjs'), page, '7', '3000'], { encoding: 'utf8' });
  assert.match(fuzz, /errors: 0 /, fuzz);
  assert.match(fuzz, /template holes OK/, fuzz);
  console.log('PASS prototype scenarios and fuzz on repository sources');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 3) React render vygenerované šablony pro hlavní stavy (včetně bodů 1–3 z 25. 9.).
global.window = { innerWidth: 1600, innerHeight: 960, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
global.document = { documentElement: {}, fullscreenElement: null };
const ide = path.join(ROOT, 'intentsmith-ide');
const React = require(require.resolve('react', { paths: [ide] }));
const { renderToStaticMarkup } = require(require.resolve('react-dom/server', { paths: [ide] }));
const { render } = require(path.join(EXT, 'lib/browser/view/generated/view.js'));
const { Component } = require(path.join(EXT, 'lib/browser/view/generated/model.js'));
const rt = { S: (v) => (v == null ? '' : String(v)), L: (v) => (Array.isArray(v) ? v : []), css: () => undefined };
const html = (patch) => {
  const c = new Component();
  c.setState(typeof patch === 'function' ? patch(c) : patch);
  return renderToStaticMarkup(render(c.renderVals(), React.createElement, React.Fragment, rt));
};
const count = (s, needle) => s.split(needle).length - 1;

let out = html({});
assert.equal(count(out, 'class="scol'), 2, 'dva sloupce relací');
assert.equal(count(out, 'aria-haspopup="menu"'), 2, 'každý sloupec má výběr relace');
assert.ok(!out.includes('class="tabs') && !out.includes('záložk'), 'bez lišty záložek');
assert.equal(count(out, 'aria-label="Ukončit relaci"'), 2, '× v hlavičce sloupce ukončí relaci');
assert.ok(out.includes('class="mcopy') && out.includes('aria-label="Kopírovat odpověď"'), 'kopírování pod odpovědí');
out = html({ cols: 2, ctx: { sec: 'colpick', id: '1', x: 10, y: 10 } });
assert.ok(out.includes('Poslední relace') && out.includes('vymění se'), 'výběr relace nabízí výměnu');
out = html({ cols: 1, colSids: ['s5'], stepsOpen: { s5a: true } });
assert.ok(out.includes('Skrýt zpracování · 4 fáze') && out.includes('Generování odpovědi · qwen3.5:27b') && !out.includes('tl-i int'), 'fáze zpracování');
out = html({ toast: { id: 't1', tone: 'info', t: 'Relace „X“ se zavřela' } });
assert.ok(out.includes('class="toast') && out.includes('se zavřela'), 'hlášení o zavřené relaci');
out = html({ rightTab: 'soubory' });
for (const label of ['Upravené v relaci', 'Otevřené', 'Projekt ShellSmith']) assert.ok(out.includes(label), label);
out = html({ rightTab: 'soubory', fileView: { s1: { path: 'src/main/sftp.js', from: 'soubory' } }, fileMode: { s1: 'upravy' }, fileDraft: { 'shellsmith|src/main/sftp.js': 'x' }, fileGuard: { sid: 's1', next: null } });
assert.ok(out.includes('Soubor má neuložené změny.') && out.includes('fv-ed'), 'editor se stráží neuložených změn');
out = html({ rightTab: 'scm', scmPlan: { pid: 'shellsmith', op: 'push' } });
assert.ok(out.includes('Plán operace') && out.includes('git push') && out.includes('HEAD → main'), 'správa zdrojů s plánem a historií');
out = html({ rightTab: 'scm', colSids: ['s5'], cols: 1 });
assert.ok(out.includes('Tahle relace nemá projekt'), 'relace bez projektu');
out = html((c) => c.pSelect(c.st(), 'projects', 'shellsmith'));
assert.ok(out.includes('class="cat') && out.includes('Otevřít v nové relaci'), 'katalog a detail');
out = html({ mode: 'section', section: 'media', detail: { media: '__new__' } });
for (const label of ['Nové generování', 'Zadání pro ComfyUI', 'Checkpoint', 'Generovat'])
  assert.ok(out.includes(label), 'formulář médií: ' + label);
out = html({ mode: 'section', section: 'projects', detail: { projects: '__new__' } });
assert.ok(out.includes('Průvodce projektem') && out.includes('Pokračovat na kontrolu'), 'projektový průvodce');
out = html({ mode: 'section', section: 'projects', detail: { projects: '__new__' }, projectStep: 1, projectName: 'Nový' });
assert.ok(out.includes('Potvrdit projekt') && out.includes('Krok 2 ze 2'), 'kontrola projektu před vytvořením');
out = html({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' } });
assert.ok(out.includes('Průvodce specialistou') && out.includes('Pokračovat na kontrolu'), 'průvodce specialistou');
out = html({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' },
  specialistStep: 1, specialistName: 'Tester', specialistDomain: 'general' });
assert.ok(out.includes('Potvrdit vytvoření') && out.includes('specialists/tester/'), 'kontrola balíčku před vytvořením');
out = html({ mode: 'section', section: 'workers', detail: { workers: '__new__' } });
assert.ok(out.includes('Průvodce workerem') && out.includes('Rozšíření M3'), 'průvodce workerem');
out = html({ mode: 'section', section: 'workers', detail: { workers: '__new__' },
  workerStep: 1, workerProject: '1', workerInstanceId: 'health-repo' });
assert.ok(out.includes('Potvrdit instanci') && out.includes('vypnuto'), 'worker začíná vypnutý');
out = html({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' } });
assert.ok(out.includes('Průvodce expertýzou') && out.includes('Pokračovat na ladění'), 'profil expertýzy');
out = html({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
  expertiseStep: 1, expertiseName: 'Test Expert' });
assert.ok(out.includes('Náhled pravidel') && out.includes('Potvrdit expertýzu'), 'ladění a kontrola expertýzy');
out = html({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
  expertiseStep: 1, expertiseName: 'Test Expert', expertiseAdvanced: true });
assert.ok(out.includes('Pravidla domény') && out.includes('Spustit test modelu'), 'pokročilé moduly a výslovný test');
for (const style of c0().styleList().map((x) => x.id)) assert.ok(html({ style }).includes('th-' + style), 'motiv ' + style);
console.log('PASS generated React view renders sessions, column picker, files, source control, catalog and all styles');

function c0() { return new Component(); }
const decoratedHead = c0().graphRows({ branch: 'main', baseBranch: 'main', laneBranch: '',
  upstream: '', behind: 0, ahead: 0,
  log: [['o', 'abc1234', 'Commit', 'Autor', 'dnes', ['HEAD -> main', 'main']]] });
assert.equal(decoratedHead[0].refs.filter(ref => ref.cls === 'head').length, 1,
  'Git history must not repeat HEAD when the backend already decorates it');
