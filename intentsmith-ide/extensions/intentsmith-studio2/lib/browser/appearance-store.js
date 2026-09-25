'use strict';

const KEY = 'intentsmith-studio2-appearance';
const STYLES = Object.freeze(['intentsmith', 'studio', 'clean', 'matrix', 'japanese', 'midnight', 'nocturne']);
const DARK_ONLY = new Set(['matrix', 'japanese', 'midnight']);
const VALID = Object.freeze({
  style: value => STYLES.includes(value),
  theme: value => ['dark', 'light', 'system'].includes(value),
  textIntensity: value => Number.isInteger(value) && value >= 0 && value <= 100,
  activeInt: value => Number.isInteger(value) && value >= 10 && value <= 100,
  fontSizeVal: value => Number.isInteger(value) && value >= 10 && value <= 18,
  fontIdx: value => Number.isInteger(value) && value >= 0 && value <= 2,
  accentIdx: value => value === 'custom' || (Number.isInteger(value) && value >= 0 && value <= 7),
  accentHex: value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value),
  bgIdx: value => value === 'custom' || (Number.isInteger(value) && value >= 0 && value <= 2),
  bgHex: value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value),
  brightness: value => Number.isInteger(value) && value >= 80 && value <= 120,
  tileOpacity: value => Number.isInteger(value) && value >= 0 && value <= 100,
  bgDim: value => Number.isInteger(value) && value >= 0 && value <= 80,
  sidebarOpacity: value => Number.isInteger(value) && value >= 10 && value <= 100,
  visualMode: value => ['borders', 'lines'].includes(value),
  autoCollapse: value => typeof value === 'boolean',
  density: value => ['comfortable', 'compact', 'minimal'].includes(value),
  uiScale: value => ['0.8', '0.9', '1.0', '1.1', '1.2', '1.25'].includes(String(value)),
  customCSS: value => typeof value === 'string' && value.length <= 10000,
  restoreSession: value => typeof value === 'boolean',
  lastView: value => typeof value === 'string' && value.length <= 100,
});
const DEFAULTS = Object.freeze({ style: 'intentsmith', theme: 'dark', textIntensity: 70, activeInt: 100,
  fontSizeVal: 13, fontIdx: 0, accentIdx: 0, accentHex: '#22c55e', bgIdx: 0, bgHex: '#0c0c0f', brightness: 100, tileOpacity: 80, bgDim: 30,
  sidebarOpacity: 80, visualMode: 'borders', autoCollapse: true, density: 'comfortable',
  uiScale: '1.0', customCSS: '', restoreSession: true, lastView: '' });
function parse(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}
function normalize(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = { ...DEFAULTS };
  for (const [key, valid] of Object.entries(VALID)) {
    if (valid(source[key])) result[key] = source[key];
  }
  return result;
}
function migrate(storage) {
  const stored = parse(storage, KEY);
  if (stored && stored.version === 2) return normalize(stored);
  const old = parse(storage, 'intentsmith-settings') || {};
  const style = storage.getItem('intentsmith-theme-mode');
  const density = storage.getItem('intentsmith.appearance.density');
  const uiScale = storage.getItem('intentsmith.appearance.uiScale');
  return normalize({ ...old, style, density: density || old.density, uiScale: uiScale || old.uiScale });
}
function round10(value) { return Math.round(value / 10) * 10; }
class AppearanceStore {
  constructor(storage, systemLight = () => false) {
    this.storage = storage;
    this.systemLight = systemLight;
    this.values = migrate(storage);
    this.listeners = new Set();
    this.persist();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(key, value) {
    if (!Object.hasOwn(VALID, key) || !VALID[key](value)) return false;
    const next = normalize({ ...this.values, [key]: value });
    this.values = next;
    this.persist();
    for (const listener of this.listeners) listener(next);
    return true;
  }
  persist() {
    try { this.storage.setItem(KEY, JSON.stringify({ version: 2, ...this.values })); }
    catch { /* A full storage area must not crash the editor. */ }
  }
  effectiveTheme() { return DARK_ONLY.has(this.values.style) ? 'dark' : this.values.theme === 'system' ? (this.systemLight() ? 'light' : 'dark') : this.values.theme; }
  classes() {
    const v = this.values;
    const theme = this.effectiveTheme();
    const style = DARK_ONLY.has(v.style) ? `th-${v.style}` : `th-${v.style}-${theme}`;
    const cleanPalette = v.style === 'clean'
      ? [`cacc-${v.accentIdx}`, ...(theme === 'dark' ? [`cbg-${v.bgIdx}`] : [])]
      : [];
    return [style, theme, `ti-${round10(v.textIntensity)}`, `ai-${round10(v.activeInt)}`,
      `ta-${round10(v.tileOpacity)}`, `pa-${round10(v.sidebarOpacity)}`, `bd-${round10(v.bgDim)}`,
      ...cleanPalette, `den-${v.density}`, `sep-${v.visualMode}`].join(' ');
  }
}
module.exports = { AppearanceStore, STYLES, DARK_ONLY, DEFAULTS, normalize, migrate, KEY };
