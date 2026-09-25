'use strict';

const CATEGORIES = Object.freeze({
  'Účet': ['Profil', 'Projekty'],
  'Modely a inference': ['Lokální modely', 'Inference', 'Připojení', 'Hardware'],
  'Paměť': ['Historie a kontext', 'Paměť a učení', 'Kapacita a retence'],
  'Oznámení': ['Kanály', 'Tiché hodiny'],
  'Výstup': ['Formátování', 'Délka odpovědi'],
  'Vzhled': ['Obecné', 'Písmo', 'Barvy a prvky', 'Rozvržení', 'Vlastní CSS'],
  'Systém': ['Prostředí a závislosti', 'Spouštění', 'Diagnostika', 'Limity'],
  'Úložiště': ['Databáze', 'Údržba'],
  'Zálohy': ['Export', 'Obnova', 'Výchozí hodnoty'],
  'Funkční přepínače': ['Přepínače', 'Obnovení'],
  'Zabezpečení': ['Audit', 'Přístup', 'Relace'],
  'O aplikaci': ['Aplikace', 'Zpětná vazba'],
});
const STYLES = Object.freeze([
  ['intentsmith','IntentSmith'], ['studio','Studio'], ['clean','Clean'], ['matrix','Matrix'],
  ['japanese','Japanese'], ['midnight','Midnight'], ['nocturne','Nocturne'],
]);

function renderSettings(widget, h) {
  const appearance = widget.appearance;
  const v = appearance.values;
  const category = widget.settingsCategory || 'Vzhled';
  const tabs = CATEGORIES[category] || [];
  const tab = tabs.includes(widget.settingsTab) ? widget.settingsTab : tabs[0];
  function select(key, label, values) {
    return h('label', { className: 'intentsmith-s2-setting' }, h('span', null, label),
      h('select', { value: String(v[key]), onChange: event => appearance.set(key, ['fontIdx','accentIdx','bgIdx'].includes(key) ? Number(event.target.value) : event.target.value) },
        values.map(([value, title]) => h('option', { key: value, value }, title))));
  }
  function slider(key, label, min, max, step, suffix = '') {
    return h('label', { className: 'intentsmith-s2-setting' }, h('span', null, label),
      h('input', { type: 'range', min, max, step, value: v[key], onChange: event => appearance.set(key, Number(event.target.value)) }),
      h('output', null, `${v[key]}${suffix}`));
  }
  function check(key, label) {
    return h('label', { className: 'intentsmith-s2-setting' }, h('span', null, label),
      h('input', { type: 'checkbox', checked: v[key], onChange: event => appearance.set(key, event.target.checked) }));
  }
  let content = h('p', null, 'Tato část nastavení ještě není v novém rozhraní připojená.');
  if (category === 'Vzhled') {
    if (tab === 'Obecné') content = h('div', null,
      select('style', 'Styl', STYLES),
      select('theme', 'Motiv', [['dark','Tmavý'],['light','Světlý'],['system','Podle systému']]),
      slider('textIntensity', 'Výraznost textu', 0, 100, 10, ' %'),
      slider('activeInt', 'Zvýraznění aktivních prvků', 10, 100, 10, ' %'));
    if (tab === 'Písmo') content = h('div', null,
      slider('fontSizeVal', 'Velikost písma', 10, 18, 1, ' px'),
      select('fontIdx', 'Rodina písma', [[0,'IntentSmith Sans'],[1,'Inter'],[2,'Systémové']].map(([value,label]) => [String(value),label])));
    if (tab === 'Barvy a prvky') content = h('div', null,
      select('accentIdx', 'Akcent Clean', [...Array(8)].map((_,i) => [String(i), `Barva ${i + 1}`])),
      select('bgIdx', 'Pozadí Clean', [['0','Výchozí'],['1','Fialové'],['2','Modré']]),
      slider('tileOpacity', 'Průhlednost dlaždic', 0, 100, 10, ' %'),
      slider('bgDim', 'Ztlumení tapety', 0, 80, 10, ' %'));
    if (tab === 'Rozvržení') content = h('div', null,
      select('visualMode', 'Oddělení prvků', [['borders','Rámečky'],['lines','Linky']]),
      select('density', 'Hustota', [['comfortable','Pohodlná'],['compact','Kompaktní'],['minimal','Minimální']]),
      select('uiScale', 'Měřítko UI', [['0.8','80 %'],['0.9','90 %'],['1.0','100 %'],['1.1','110 %'],['1.2','120 %']]),
      check('autoCollapse', 'Automaticky sbalovat panely'));
    if (tab === 'Vlastní CSS') content = h('div', null,
      h('p', null, 'Uložený vlastní CSS kód se načetl. Použití v novém rozhraní čeká na kontrolu lokálních zdrojů.'),
      h('textarea', { readOnly: true, value: v.customCSS, 'aria-label': 'Vlastní CSS ze starého Studia' }));
  }
  return h('div', { className: 'intentsmith-s2-settings' },
    h('nav', { 'aria-label': 'Kategorie nastavení' }, Object.keys(CATEGORIES).map(name => h('button', {
      key: name, type: 'button', className: name === category ? 'active' : '', onClick: () => {
        widget.settingsCategory = name; widget.settingsTab = CATEGORIES[name][0]; widget.update();
      },
    }, name))),
    h('main', null,
      h('h1', null, category),
      h('div', { className: 'intentsmith-s2-settings-tabs' }, tabs.map(name => h('button', {
        key: name, type: 'button', className: name === tab ? 'active' : '', onClick: () => { widget.settingsTab = name; widget.update(); },
      }, name))),
      h('section', { className: 'intentsmith-s2-settings-content' }, content)));
}
module.exports = { renderSettings, CATEGORIES, STYLES };
