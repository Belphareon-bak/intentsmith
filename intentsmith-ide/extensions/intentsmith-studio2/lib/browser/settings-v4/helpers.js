'use strict';

// Pomocníci vykreslení převzatí z klikacího návrhu V4 (app.js, viz docs/studio2/settings-v4/README.md).
// Šablony návrhu zůstávají řetězcové, aby vzhled odpovídal předloze z principu. Každá hodnota z backendu
// prochází e(); jen notice() a toolbar akce přijímají hotové HTML z těchto pomocníků.

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PATHS = {
  models: 'M4 5h16v14H4z M8 2v3m8-3v3M8 19v3m8-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3M8 9h8v6H8z',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  chat: 'M4 4h16v12H9l-5 4z', folder: 'M3 6h7l2 2h9v11H3z', file: 'M5 3h9l5 5v13H5z M14 3v5h5 M8 13h8m-8 4h6',
  git: 'M6 3v12a3 3 0 1 0 3 3M6 15v-9M6 6a3 3 0 1 0 0-6M6 6c0 6 12 3 12 9m0-6a3 3 0 1 0 0 6',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14M15 15l6 6', check: 'M5 12l4 4L19 6', close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14', arrow: 'M4 12h16m-6-6 6 6-6 6', chevron: 'M9 5l7 7-7 7',
  refresh: 'M20 6v5h-5M4 18v-5h5M5 7a8 8 0 0 1 14-1M19 17a8 8 0 0 1-14 1',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l4 2',
  link: 'M9 15l6-6M7 14l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M17 10l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  user: 'M12 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21v-3a8 8 0 0 1 16 0v3',
  worker: 'M5 7h14v13H5z M9 3h6v4M8 12h1m6 0h1M9 16h6M2 10v7m20-7v7',
  book: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3z M12 6v16', image: 'M3 3h18v18H3z M3 17l6-6 5 5 3-3 4 4M15 7h1',
  database: 'M3 6c0-5 18-5 18 0s-18 5-18 0M3 6v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0',
  bell: 'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4z M10 21h4', shield: 'M12 2l9 4v6c0 6-9 10-9 10S3 18 3 12V6z M8 12l3 3 5-6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', trash: 'M4 7h16M9 3h6l1 4M6 7l1 14h10l1-14M10 11v6m4-6v6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v6m0-10v1', play: 'M6 3l15 9-15 9z', stop: 'M5 5h14v14H5z',
  memory: 'M5 3h14v18H5z M8 7h8M8 12h8M8 17h5',
  palette: 'M12 3a9 9 0 1 0 0 18c5 0 1-5 4-5h3c5-7-1-13-7-13M7 8h1m6-2h1m3 5h1M6 14h1',
  key: 'M8 3a5 5 0 1 0 0 10 5 5 0 1 0 0-10M12 12l8 8m-3-3 3-3m-7-1 3-3'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name] || PATHS.info}"/></svg>`;
const button = (text, action, attrs = '') => {
  const match = attrs.match(/\bclass="([^"]*)"/);
  return `<button type="button" class="${match ? e(match[1]) : 'button'}" data-action="${e(action)}" ${attrs.replace(/\bclass="[^"]*"/, '')}>${text}</button>`;
};
const tag = (text, tone = '') => `<span class="tag ${e(({ good: 'green', warn: 'gold' })[tone] || tone)}">${e(text)}</span>`;
const field = (label, inputHtml, hint = '') => `<div class="field"><label>${e(label)}</label>${inputHtml}${hint ? `<p class="help">${e(hint)}</p>` : ''}</div>`;
const input = (name, value, attrs = '') => `<input id="${e(name)}" name="${e(name)}" type="text" value="${e(value)}" ${attrs}>`;
const labeled = (label, name, element, hint = '') => `<div class="field"><label for="${e(name)}">${e(label)}</label>${element}${hint ? `<p class="help">${e(hint)}</p>` : ''}</div>`;
const select = (name, values, current, attrs = '') => `<select id="${e(name)}" name="${e(name)}" ${attrs}>${values.map(v => {
  const [value, label] = Array.isArray(v) ? v : [v, v];
  return `<option value="${e(value)}" ${String(value) === String(current) ? 'selected' : ''}>${e(label)}</option>`;
}).join('')}</select>`;
const tabs = (items, current, action, cls = '') => `<div class="tabs ${e(cls)}" role="tablist" aria-label="Sekce">${items.map(([id, label]) =>
  `<button type="button" class="tab" role="tab" aria-selected="${current === id}" tabindex="${current === id ? 0 : -1}" data-action="${e(action)}" data-tab="${e(id)}">${e(label)}</button>`).join('')}</div>`;
const head = (title, desc, actions = '', crumb = '') => `<header class="page-head"><div>${crumb ? `<div class="eyebrow">${e(crumb)}</div>` : ''}<h1 tabindex="-1">${e(title)}</h1><p>${e(desc)}</p></div><div class="toolbar">${actions}</div></header>`;
const notice = (html, type = '') => `<div class="notice ${e(type)}">${icon('info')}<p>${html}</p></div>`;
const check = (name, text, selected, hint = '', attrs = '') => `<label class="check-row"><input type="checkbox" id="${e(name)}" name="${e(name)}" ${selected ? 'checked' : ''} ${attrs}><span>${e(text)}${hint ? `<small>${e(hint)}</small>` : ''}</span></label>`;
const meta = entries => `<dl class="sv2-meta">${entries.map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
const kv = (key, valueHtml) => `<div class="kv"><span>${e(key)}</span><span>${valueHtml}</span></div>`;
const sectionTitle = (title, extra = '') => `<div class="section-title"><h2>${e(title)}</h2>${extra}</div>`;
const empty = (title, help = '') => `<div class="empty">${e(title)}${help ? `<p class="help">${e(help)}</p>` : ''}</div>`;

// České počty a formáty. Desetinná čárka, mezera jako oddělovač tisíců (cs-CZ).
const pl = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const num = (value, digits = 0) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—'
  : Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: digits, minimumFractionDigits: digits });
function bytes(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  const units = [['TiB', 2 ** 40], ['GiB', 2 ** 30], ['MiB', 2 ** 20], ['KiB', 2 ** 10]];
  for (const [unit, size] of units) if (value >= size) return num(value / size, value / size >= 100 ? 0 : 1) + ' ' + unit;
  return num(value) + ' B';
}
function date(value, withTime = true) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}${withTime ? ` · ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`;
}
function ago(value, now = Date.now()) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.max(0, Math.round((now - ms) / 60000));
  if (minutes < 60) return minutes <= 1 ? 'právě teď' : `před ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `před ${pl(hours, 'hodinou', 'hodinami', 'hodinami').replace(/^1 hodinou$/, 'hodinou')}`;
  return `před ${pl(Math.round(hours / 24), 'dnem', 'dny', 'dny')}`;
}
const validPath = value => typeof value === 'string' && value.startsWith('/') && !value.includes('\u0000') && !value.split('/').includes('..');

module.exports = { e, icon, button, tag, field, input, labeled, select, tabs, head, notice, check, meta, kv, sectionTitle, empty,
  pl, num, bytes, date, ago, validPath, PATHS };
