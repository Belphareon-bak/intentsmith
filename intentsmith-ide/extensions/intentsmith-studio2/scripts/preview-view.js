#!/usr/bin/env node
'use strict';

// Nafotí vizuální vrstvu Studia 2 v headless Chrome bez sestavení Theie:
// model prototypu → React (react-dom/server) → statické HTML se styly → PNG.
//   node scripts/preview-view.js <výstupní složka> [scénář…]
// Scénáře jsou pojmenované stavy modelu (viz SCENES). Slouží ke kontrole vzhledu
// proti prototypu; chování ověřují testy prototypu a skutečný Electron.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..');
const IDE = path.resolve(EXT, '..', '..');
const REPO = path.resolve(IDE, '..');
const req = (m) => require(require.resolve(m, { paths: [IDE, REPO] }));

global.window = { innerWidth: 1600, innerHeight: 960, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
global.document = { documentElement: {}, fullscreenElement: null };

const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { render } = require(path.join(EXT, 'lib/browser/view/generated/view'));
const { Component } = require(path.join(EXT, 'lib/browser/view/generated/model'));
const { css } = (() => {
  // studio-root.js načítá React přes @theia/core/shared; pro náhled stačí jeho parser stylů.
  const src = fs.readFileSync(path.join(EXT, 'lib/browser/view/studio-root.js'), 'utf8');
  const body = src.slice(src.indexOf('const styleCache'), src.indexOf('const rt ='));
  return new Function(body + '; return { css };')();
})();

const W = 1600, H = 960;
const SCENES = {
  'relace-2-sloupce': () => ({}),
  'relace-3-sloupce': () => ({ cols: 3, colSids: ['s1', 's3', 's6'] }),
  'vyber-relace-ve-sloupci': (c) => ({ cols: 2, ctx: { sec: 'colpick', id: '1', x: 820, y: 80 } }),
  'soubory-seznam': () => ({ rightTab: 'soubory', rightW: 440 }),
  'soubory-nahled': (c) => ({ rightTab: 'soubory', rightW: 520, fileView: { s1: { path: 'src/main/sftp.js', from: 'soubory' } }, fileMode: { s1: 'nahled' } }),
  'soubory-zmeny': (c) => ({ rightTab: 'soubory', rightW: 520, fileView: { s1: { path: 'src/main/sftp.js', from: 'soubory' } }, fileMode: { s1: 'diff' } }),
  'soubory-straz': (c) => ({ rightTab: 'soubory', rightW: 520, fileView: { s1: { path: 'docs/ARCHITECTURE.md', from: 'soubory' } }, fileMode: { s1: 'upravy' }, fileDraft: { 'shellsmith|docs/ARCHITECTURE.md': '# ShellSmith – architektura\n\nRozepsaná úprava…' }, fileGuard: { sid: 's1', next: null } }),
  'sprava-zdroju': (c) => ({ rightTab: 'scm', rightW: 440, approved: { s1: 'ok' }, scm: { shellsmith: { staged: { 'src/main/sftp.js': true, 'src/renderer/js/files.js': true }, msg: 'SFTP: obnovení přerušeného přenosu' } } }),
  'sprava-zdroju-plan': (c) => ({ rightTab: 'scm', rightW: 440, approved: { s1: 'ok' }, scm: { shellsmith: { staged: { 'src/main/sftp.js': true, 'src/renderer/js/files.js': true }, msg: 'SFTP: obnovení přerušeného přenosu' } }, scmPlan: { pid: 'shellsmith', op: 'commit', files: ['src/main/sftp.js', 'src/renderer/js/files.js'], msg: 'SFTP: obnovení přerušeného přenosu', push: true } }),
  'sprava-zdroju-vetve': (c) => ({ rightTab: 'scm', rightW: 440, ctx: { sec: 'branch', id: 'shellsmith', x: 1170, y: 120 } }),
  'sprava-zdroju-blokovano': (c) => ({ rightTab: 'scm', rightW: 440, colSids: ['s2', 's3'], scmPlan: { pid: 'systemsmith_1', op: 'pull' } }),
  'katalog-projekty': (c) => Object.assign(c.pSelect(c.st(), 'projects', 'shellsmith'), {}),
  'detail-projektu-git': (c) => Object.assign(c.pSelect(c.st(), 'projects', 'shellsmith'), { dtab: { 'projects:shellsmith': 'scm' } }),
  'nastaveni-vzhled': (c) => c.pSelect(c.st(), 'settings', 'vzhled'),
  'motiv-matrix': () => ({ style: 'matrix', rightTab: 'scm' }),
  'motiv-nocturne-svetly': () => ({ style: 'nocturne', tmode: 'light', rightTab: 'soubory' }),
  'motiv-studio': () => ({ style: 'studio', cols: 3 }),
  'terminal-a-prilohy': () => ({ atts: { s1: [['zadani.md', '2 kB'], ['chyba.log', '12 kB']] }, cmds: { s1: 'npm test -- --grep sftp' }, termX: { s1: [['$ git status --short', 'p'], [' M src/main/sftp.js', '']] } })
};

function pageHtml(markup) {
  const gen = path.join(EXT, 'lib/browser/view/generated');
  const base = pathToFileURL(gen + '/').href;
  const viewCss = fs.readFileSync(path.join(EXT, 'lib/browser/view/view.css'), 'utf8')
    .replace(/url\("\.\.\/styles\//g, 'url("' + pathToFileURL(path.join(EXT, 'lib/browser/styles') + '/').href);
  const proto = fs.readFileSync(path.join(gen, 'proto.css'), 'utf8');
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><base href="${base}">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}.intentsmith-studio2-widget{position:absolute;inset:0}</style>
<style>${viewCss}</style><style>${proto}</style></head>
<body><div class="intentsmith-studio2-widget">${markup}</div></body></html>`;
}

async function main() {
  const out = path.resolve(process.argv[2] || 'studio2-preview');
  const only = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  const puppeteer = require(require.resolve('puppeteer', { paths: [REPO, IDE] }));
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  const rt = { S: (v) => (v == null ? '' : String(v)), L: (v) => (Array.isArray(v) ? v : []), css };
  for (const [name, patch] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue;
    const c = new Component();
    c.setState(patch(c));
    const vm = c.renderVals();
    vm.rootW = 'calc(100% / ' + vm.zoom + ')';
    vm.rootH = 'calc(100% / ' + vm.zoom + ')';
    const markup = renderToStaticMarkup(render(vm, React.createElement, React.Fragment, rt));
    const file = path.join(out, name + '.html');
    fs.writeFileSync(file, pageHtml(markup));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name + '.png') });
    console.log(name);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
