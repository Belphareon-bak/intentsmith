import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'intentsmith-ide/extensions/intentsmith-studio2');
const PROTO = path.join(ROOT, 'docs/studio2/prototype');

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
out = html({ cols: 2, ctx: { sec: 'colpick', id: '1', x: 10, y: 10 } });
assert.ok(out.includes('Relace ve sloupci 2') && out.includes('vymění se'), 'výběr relace nabízí výměnu');
out = html({ rightTab: 'soubory' });
for (const label of ['Upravené v relaci', 'Otevřené', 'Projekt ShellSmith']) assert.ok(out.includes(label), label);
out = html({ rightTab: 'soubory', fileView: { s1: { path: 'src/main/sftp.js', from: 'soubory' } }, fileMode: { s1: 'upravy' }, fileDraft: { 'shellsmith|src/main/sftp.js': 'x' }, fileGuard: { sid: 's1', next: null } });
assert.ok(out.includes('Soubor má neuložené změny.') && out.includes('fv-ed'), 'editor se stráží neuložených změn');
out = html({ rightTab: 'scm', scmPlan: { pid: 'shellsmith', op: 'push' } });
assert.ok(out.includes('Plán operace') && out.includes('git push') && out.includes('HEAD → main'), 'správa zdrojů s plánem a historií');
out = html({ rightTab: 'scm', colSids: ['s5'], cols: 1 });
assert.ok(out.includes('Tahle relace nemá projekt'), 'relace bez projektu');
out = html((c) => c.pSelect(c.st(), 'projects', 'shellsmith'));
assert.ok(out.includes('class="cat') && out.includes('Nová relace v projektu'), 'katalog a detail');
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
for (const style of c0().styleList().map((x) => x.id)) assert.ok(html({ style }).includes('th-' + style), 'motiv ' + style);
console.log('PASS generated React view renders sessions, column picker, files, source control, catalog and all styles');

function c0() { return new Component(); }
