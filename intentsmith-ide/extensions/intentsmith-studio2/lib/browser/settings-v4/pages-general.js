'use strict';

// Obecné kategorie Nastavení v4 podle návrhu V4 (app.js settingsGeneric): karta s poli + Vrátit/Uložit.
// Pole jsou jen ta, která mají v IDE nebo backendu skutečný účinek; ostatní volby návrhu jsou nahrazené
// pravdivým stavem (návrh je výslovně ponechal na ověření při implementaci).

const H = require('./helpers');

const { e, icon, tag, meta, kv, pl, num, bytes, date } = H;
const btn = (text, action, data = {}, cls = '', extra = '') => {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${e(value)}"`).join(' ');
  return `<button type="button" class="button ${cls}" data-action="${e(action)}" ${attrs} ${extra}>${e(text)}</button>`;
};
const intro = (title, desc, actions = '') => H.head(title, desc, btn('← Všechna nastavení', 'settings-home') + actions, 'Nastavení');
function status(c, keys) {
  const items = keys.map(k => c.resource(k));
  const failed = items.find(r => r.status === 'error');
  if (failed) return `<div class="sv4-error" role="alert"><span>Data se nepodařilo načíst (${e(failed.error)}).</span>${btn('Obnovit', 'retry', {}, 'small')}</div>`;
  if (items.some(r => ['idle', 'loading'].includes(r.status) && !r.data)) return '<div class="sv4-loading" role="status">Načítám skutečný stav z backendu…</div>';
  return '';
}
const footer = (reset, save, disabled = false) => `<div class="setting-footer">${btn('Vrátit výchozí hodnoty', reset, {}, '', disabled ? 'disabled' : '')}${btn('Uložit', save, {}, 'primary', disabled ? 'disabled' : 'data-submit')}</div>`;

// ---------- paměť ----------
const MEMORY = [['intentsmith.memory.ltmEnabled', 'Dlouhodobá paměť', 'Ukládá ověřené poznatky a používá je v dalších konverzacích.'],
  ['intentsmith.memory.learningEnabled', 'Navrhovat poznatky z preferencí', 'Z opakovaných voleb navrhne poznatek; uloží se až po potvrzení.'],
  ['intentsmith.memory.feedbackDetection', 'Rozpoznávat zpětnou vazbu', 'Pochvalu nebo opravu v konverzaci zaznamená jako signál kvality.'],
  ['intentsmith.memory.patternTracking', 'Sledovat pracovní vzorce', 'Eviduje opakované postupy pro návrhy skillů.']];
const RETENTION = [['30', '30 dní'], ['90', '90 dní'], ['180', '180 dní'], ['365', '1 rok'], ['730', '2 roky'], ['3650', '10 let']];
function retentionOptions(current) { const list = RETENTION.slice(); if (current && !list.some(([v]) => v === String(current))) list.push([String(current), current + ' dní']); return list; }
function memory(c) {
  const settings = c.data('settings'), storage = c.data('storageSettings');
  const value = key => settings ? settings[key] !== false : true;
  return intro('Paměť', 'Historie, kontext a ukládání poznatků.') + status(c, ['settings', 'storageSettings'])
    + `<form id="sv4-memory-form"><section class="card"><h2>Kontext a ukládání poznatků</h2>${MEMORY.map(([key, label, hint]) => H.check('mem-' + key.split('.').pop(), label, value(key), hint)).join('')}<div class="grid2">${H.labeled('Retence historie konverzací', 'mem-ret-conversations', H.select('mem-ret-conversations', retentionOptions(storage?.retention?.conversations), String(storage?.retention?.conversations ?? 365)), 'Starší neaktivní konverzace backend při úklidu odstraní.')}${H.labeled('Retence změn paměti', 'mem-ret-memory', H.select('mem-ret-memory', retentionOptions(storage?.retention?.memory_changes), String(storage?.retention?.memory_changes ?? 180)), 'Historie úprav dlouhodobé paměti.')}</div><p class="help">Rozsah paměti je vždy projekt a lokální profil. Odděleně řízený osobní a projektový rozsah backend zatím nepodporuje.</p></section>${footer('sv4-memory-reset', 'sv4-memory-save', !settings || !storage || c.isBusy('memory'))}</form><p class="audit-mark">Uložení se ověřuje zpětným čtením backendu. Retence platí při příštím pravidelném úklidu.</p>`;
}
async function saveMemory(c, defaults = false) {
  const settings = c.data('settings'), storage = c.data('storageSettings');
  if (!settings || !storage) return;
  const patch = Object.fromEntries(MEMORY.map(([key]) => [key, defaults ? true : !!c.value('mem-' + key.split('.').pop())]));
  const retention = defaults ? { conversations: 365, memory_changes: 180 } : { conversations: Number(c.value('mem-ret-conversations')), memory_changes: Number(c.value('mem-ret-memory')) };
  if (defaults && !await c.confirm('Vrátit paměť na výchozí hodnoty? Zapne všechny čtyři volby a nastaví retenci konverzací na 1 rok a změn paměti na 180 dní.', { title: 'Výchozí hodnoty paměti' })) return;
  const ok = await c.run('memory', 'Nastavení paměti', async () => {
    const current = await c.api('GET', '/api/settings');
    if (JSON.stringify(current) !== JSON.stringify(settings)) throw Object.assign(Error('Nastavení se mezitím změnilo. Obnovte stránku a porovnejte hodnoty'), { status: 409 });
    if (MEMORY.some(([key]) => current[key] !== patch[key] && !(current[key] === undefined && patch[key] === true))) {
      const result = await c.api('POST', '/api/settings', { ...current, ...patch });
      if (result?.success !== true) throw Object.assign(Error('Backend uložení nepotvrdil'), { status: 500 });
    }
    const st = await c.api('GET', '/api/system/storage/settings');
    if (st.retention.conversations !== retention.conversations || st.retention.memory_changes !== retention.memory_changes)
      await c.api('PUT', '/api/system/storage/settings', { ...st, retention: { ...st.retention, ...retention } });
    const [after, afterStorage] = await Promise.all([c.api('GET', '/api/settings'), c.api('GET', '/api/system/storage/settings')]);
    if (!MEMORY.every(([key]) => (after[key] !== false) === patch[key]) || afterStorage.retention.conversations !== retention.conversations || afterStorage.retention.memory_changes !== retention.memory_changes)
      throw Object.assign(Error('Zápis mohl proběhnout, ale zpětné čtení se liší'), { status: 500 });
    c.res.set('settings', { status: 'ready', data: after }); c.res.set('storageSettings', { status: 'ready', data: afterStorage });
  }, 'Nastavení paměti uloženo a ověřeno v backendu.');
  if (ok) c.clearDrafts('mem-');
}

// ---------- výstup ----------
function output(c) {
  const settings = c.data('settings');
  return intro('Výstup', 'Jazyk, formát a délka odpovědí.') + status(c, ['settings'])
    + `<section class="card"><h2>Odpovědi a export</h2><div class="grid2"><div>${kv('Jazyk odpovědí', settings?.language === 'en' ? 'Angličtina' : 'Čeština')}${kv('Formát odpovědí', 'Markdown se zvýrazněním kódu')}${kv('Odkazy na zdroje', 'U odpovědí s načtenými podklady')}</div><div>${kv('Délka odpovědi', 'Řídí limit odpovědi role')}${kv('Export konverzace', 'Markdown a JSON v detailu konverzace')}${kv('Kopírování', 'Celá odpověď jako Markdown')}</div></div><p class="help">Formát a zvýraznění kódu jsou vestavěné ve vykreslování konverzace. Délku jedné odpovědi a kontext nastavíte zvlášť pro každou roli; projeví se v dalším tahu.</p><div class="toolbar">${btn('Limit odpovědi podle role', 'sv4-goto-models', { tab: 'connections' }, 'primary')}${btn('Konverzace a export', 'sv4-open-conversations')}</div></section><p class="audit-mark">Volby návrhu, které nemají v aplikaci účinek (styl odpovědí, výchozí formát exportu), se nezobrazují jako aktivní pole.</p>`;
}

// ---------- vzhled ----------
const STYLES = [['intentsmith', 'IntentSmith'], ['studio', 'Studio'], ['clean', 'Clean'], ['nocturne', 'Nocturne'], ['matrix', 'Matrix'], ['japanese', 'Japanese'], ['midnight', 'Midnight']];
const DARK_ONLY = ['matrix', 'japanese', 'midnight'];
const CACC = [['#22c55e', 'Zelená'], ['#3b82f6', 'Modrá'], ['#8b5cf6', 'Fialová'], ['#ec4899', 'Růžová'], ['#f97316', 'Oranžová'], ['#ffffff', 'Bílá'], ['#ef4444', 'Červená'], ['#06b6d4', 'Tyrkysová']];
const CBG = [['0', 'Výchozí'], ['1', 'Antracit'], ['2', 'Noční modř']];
const AP_DEFAULTS = { style: 'intentsmith', tmode: 'dark', fs: 13, ff: 'brand', ti: 70, ai: 100, bright: 100, ta: 80, pa: 80, bd: 30, sep: 'ramecky', density: 'komfortni', scale: '100', col: true, cacc: 0, cbg: 0, css: '' };
function appearance(c) {
  const a = { ...AP_DEFAULTS, ...(c.appearanceState?.() || {}) }, glass = DARK_ONLY.includes(a.style);
  const range = (id, label, min, max, value, step = 1, hint = '') => H.labeled(label, id, `<input type="range" id="${id}" name="${id}" min="${min}" max="${max}" step="${step}" value="${e(value)}" data-input="sv4-ap-preview">`, hint);
  return intro('Vzhled', 'Paleta, písmo a hustota pracovního prostoru.') + `<form id="sv4-appearance-form"><section class="card"><h2>Styl a téma</h2><div class="grid2">${H.labeled('Styl', 'ap-style', H.select('ap-style', STYLES, a.style, 'data-change="sv4-ap-style"'))}${H.labeled('Téma', 'ap-tmode', H.select('ap-tmode', [['dark', 'Tmavé'], ['light', 'Světlé'], ['system', 'Podle systému']], glass ? 'dark' : a.tmode, glass ? 'disabled' : ''), 'Matrix, Japanese a Midnight mají jen tmavé téma s tapetou.')}${H.labeled('Velikost textu', 'ap-fs', H.select('ap-fs', [10, 11, 12, 13, 14, 15, 16, 17, 18].map(n => [String(n), n + ' px']), String(a.fs)))}${H.labeled('Písmo', 'ap-ff', H.select('ap-ff', [['brand', 'IntentSmith Sans'], ['inter', 'Inter'], ['system', 'Systémové']], a.ff))}</div><p class="help">Styly a barvy odpovídají motivům IDE. Stejné nastavení se ukládá jen v tomto profilu IDE a projeví se okamžitě po uložení.</p></section>`
    + `<section class="card section-gap"><h2>Hustota a prvky</h2><div class="grid2">${H.labeled('Hustota', 'ap-density', H.select('ap-density', [['komfortni', 'Komfortní'], ['kompaktni', 'Kompaktní'], ['minimalni', 'Minimální']], a.density))}${H.labeled('Měřítko rozhraní', 'ap-scale', H.select('ap-scale', [['90', '90 %'], ['100', '100 %'], ['110', '110 %'], ['125', '125 %']], String(a.scale)))}${H.labeled('Oddělení prvků', 'ap-sep', H.select('ap-sep', [['ramecky', 'Rámečky'], ['linky', 'Linky']], a.sep))}${range('ap-bright', 'Jas · ' + a.bright + ' %', 80, 120, a.bright)}${range('ap-ti', 'Výraznost textu · ' + a.ti + ' %', 0, 100, a.ti, 10)}${range('ap-ai', 'Výraznost aktivních prvků · ' + a.ai + ' %', 10, 100, a.ai, 10)}</div>${H.check('ap-col', 'Automaticky sbalovat postranní panely', a.col, 'Na užším okně se navigace sbalí do ikon.')}<p class="help">Posuvník v horní liště mění hustotu seznamů a velikost dlaždic; přepínač vedle něj volí seznam nebo dlaždice.</p></section>`
    + (a.style === 'clean' ? `<section class="card section-gap"><h2>Barvy stylu Clean</h2><div class="grid2">${H.labeled('Akcent', 'ap-cacc', H.select('ap-cacc', CACC.map(([hex, label], i) => [String(i), label + ' · ' + hex]), String(a.cacc)))}${H.labeled('Pozadí tmavého tématu', 'ap-cbg', H.select('ap-cbg', CBG, String(a.cbg)))}</div></section>` : '')
    + (glass ? `<section class="card section-gap"><h2>Sklo a tapeta</h2><div class="grid2">${range('ap-pa', 'Neprůhlednost panelů · ' + a.pa + ' %', 10, 100, a.pa, 10)}${range('ap-ta', 'Neprůhlednost dlaždic · ' + a.ta + ' %', 0, 100, a.ta, 10)}${range('ap-bd', 'Ztmavení tapety · ' + a.bd + ' %', 0, 80, a.bd, 10)}</div></section>` : '')
    + `<section class="card section-gap"><h2>Vlastní CSS</h2>${H.labeled('Pravidla CSS pro toto IDE', 'ap-css', `<textarea id="ap-css" name="ap-css" rows="5" maxlength="10000" class="mono" spellcheck="false">${e(a.css)}</textarea>`, 'Použijí se jen v tomto profilu. Chybné pravidlo nic nerozbije – smažte ho a uložte.')}</section>${footer('sv4-ap-reset', 'sv4-ap-save')}</form>`;
}
function readAppearance(c) {
  const v = id => c.value(id);
  const patch = { style: v('ap-style'), fs: Number(v('ap-fs')), ff: v('ap-ff'), density: v('ap-density'), scale: v('ap-scale'), sep: v('ap-sep'),
    bright: Number(v('ap-bright')), ti: Number(v('ap-ti')), ai: Number(v('ap-ai')), col: !!v('ap-col'), css: v('ap-css') ?? '' };
  if (!DARK_ONLY.includes(patch.style)) patch.tmode = v('ap-tmode');
  if (v('ap-cacc') !== undefined) patch.cacc = Number(v('ap-cacc'));
  if (v('ap-cbg') !== undefined) patch.cbg = Number(v('ap-cbg'));
  for (const key of ['pa', 'ta', 'bd']) if (v('ap-' + key) !== undefined) patch[key] = Number(v('ap-' + key));
  return patch;
}

// ---------- systém ----------
function system(c) {
  const info = c.data('info'), health = c.data('health'), gpu = c.data('gpu');
  const g = gpu?.profile?.gpus?.[0], cap = gpu?.sessionCapacity;
  const mem = info?.memory;
  return intro('Systém', 'Spouštění, pracovní limity a diagnostika.') + status(c, ['info', 'health'])
    + `<div class="grid2"><section class="card"><h2>Spuštění a pracovní limity</h2>${kv('Backend', health ? `${e(health.version)} · ${health.ready ? tag('Připraven', 'green') : tag('Spouští se', 'gold')}` : '—')}${kv('Spuštění', 'Služba systemd uživatele · startuje s přihlášením')}${kv('Souběžné relace modelu', info ? pl(info.sessions?.maxConcurrentLLM ?? 1, 'relace', 'relace', 'relací') : '—')}${kv('Automatické škálování podle GPU', info?.sessions?.gpuAutoScale ? 'Zapnuto' : 'Vypnuto')}${kv('Práce na pozadí', 'Workeři a plánovač Huntu podle vlastních plánů')}<p class="help">${e(cap?.reason || 'Počet souběžných relací backend odvozuje z GPU.')} Limity se mění v konfiguraci backendu, ne v IDE.</p></section>`
    + `<section class="card"><h2>Prostředí</h2>${kv('Platforma', info ? `${e(info.platform)} · ${e(info.arch)}` : '—')}${kv('Node.js', info ? e(info.node_version) : '—')}${kv('Paměť systému', mem ? `${num(mem.free_mb / 1024, 1)} GiB volné z ${num(mem.total_mb / 1024, 1)} GiB` : '—')}${kv('Paměť backendu', mem ? num(mem.process_mb) + ' MiB' : '—')}${kv('GPU', g ? `${e(g.gpu_model)} · ${num(g.vram_mb / 1024, 0)} GiB` : '—')}${kv('Ovladač GPU', g ? e(g.driver) + (gpu.profile.inventoryStale ? ' · ' + tag('Inventura zastaralá', 'gold') : '') : '—')}${kv('Poskytovatel modelů', info ? `${e(info.config?.provider)} · <span class="mono">${e(info.config?.ollama_url)}</span>` : '—')}</section></div>`
    + `<section class="card section-gap"><div class="card-head"><div><h2>Diagnostika</h2><p class="help">Přehled konfigurace, modulů a stavu backendu bez obsahu konverzací a přihlašovacích údajů.</p></div>${tag('Lokálně')}</div><div class="toolbar">${btn('Zobrazit diagnostiku', 'sv4-diagnostics')}${btn('Stáhnout JSON', 'sv4-diagnostics-download', {}, 'ghost')}${btn('Obnovit stav', 'sv4-system-refresh', {}, 'ghost')}</div></section>`
    + `<section class="card section-gap"><div class="card-head"><div><h2>Výchozí hodnoty</h2><p class="help">Smaže všechna uživatelská nastavení v backendu a vypne modelovou automatizaci. Konverzace, projekty a zálohy zůstanou.</p></div>${tag('Nevratné', 'red')}</div><div class="toolbar">${btn('Obnovit výchozí nastavení…', 'sv4-reset-settings', {}, 'danger', c.isBusy('reset') ? 'disabled' : '')}</div></section>`;
}
function diagnosticsBody(d) {
  const rows = [];
  const walk = (value, prefix, depth) => {
    if (rows.length > 160) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) { for (const [k, v] of Object.entries(value)) walk(v, prefix ? prefix + ' · ' + k : k, depth + 1); return; }
    rows.push([prefix, Array.isArray(value) ? pl(value.length, 'položka', 'položky', 'položek') : value && typeof value === 'object' ? JSON.stringify(value).slice(0, 160) : String(value)]);
  };
  walk(d, '', 0);
  return meta(rows);
}

// ---------- funkční přepínače ----------
const FEATURES = { agents: ['Workeři', 'Spouštění a správa workerů projektu.'], lifecycle: ['Projektový lifecycle', 'Plánování, schvalování a provádění projektových úkolů.'],
  expertises: ['Expertýzy', 'Odborné profily pro chat a projekty.'], skills: ['Skilly', 'Vlastní dovednosti a jejich kroky.'],
  telemetry: ['Telemetrie modelů', 'Měření volání modelů pro Telemetrii a Hunt.'], specialistTelemetry: ['Telemetrie specialistů', 'Měření práce specialistů.'],
  autonomy: ['Autonomní režim', 'Delší samostatná práce agenta v rámci schválených hranic.'], comfyui: ['Multimédia · ComfyUI', 'Generování obrázků a videa přes lokální ComfyUI.'],
  marketplace: ['Obchod', 'Instalace skillů, expertýz a specialistů z katalogu.'], externalNotifications: ['Externí kanály oznámení', 'Doručování přes Discord, Telegram a e-mail. Zapnutí nezaloží ani nepropojí účet.'],
  onlineDiscovery: ['Online vyhledávání modelů', 'GPU Hunt hledá nové modely v online katalozích.'] };
function features(c) {
  const f = c.data('features')?.features;
  const names = f ? Object.keys(f).sort((a, b) => Object.keys(FEATURES).indexOf(a) - Object.keys(FEATURES).indexOf(b)) : [];
  return intro('Funkční přepínače', 'Dostupné funkce a jejich aktivace.') + status(c, ['features'])
    + `<form id="sv4-features-form"><section class="card"><h2>Dostupné funkce</h2>${names.map(name => H.check('feat-' + name, (FEATURES[name] || [name])[0], f[name], (FEATURES[name] || [, ''])[1])).join('')}${f ? `<p class="help">${pl(names.filter(n => f[n]).length, 'funkce zapnutá', 'funkce zapnuté', 'funkcí zapnutých')} z ${names.length}. Změna platí okamžitě a do restartu backendu; trvalé výchozí hodnoty určuje konfigurace služby.</p>` : ''}</section>${footer('sv4-features-reset', 'sv4-features-save', !f || c.isBusy('features'))}</form>`;
}
async function saveFeatures(c) {
  const f = c.data('features')?.features;
  if (!f) return;
  const changes = Object.keys(f).filter(name => !!c.value('feat-' + name) !== f[name]).map(name => [name, !f[name]]);
  if (!changes.length) { c.toast('Žádná změna k uložení.'); return; }
  if (!await c.confirm('Změnit funkční přepínače?\n' + changes.map(([name, on]) => (on ? 'Zapnout: ' : 'Vypnout: ') + (FEATURES[name] || [name])[0]).join('\n') + '\nZměna platí do restartu backendu.', { title: 'Funkční přepínače' })) return;
  const ok = await c.run('features', 'Funkční přepínače', async () => {
    for (const [name, enabled] of changes) {
      const result = await c.api('POST', '/api/features/' + encodeURIComponent(name), { enabled });
      if (result?.ok !== true) throw Object.assign(Error('Backend změnu ' + name + ' nepotvrdil'), { status: 500 });
    }
    const after = await c.api('GET', '/api/features');
    if (!changes.every(([name, enabled]) => after.features?.[name] === enabled)) throw Object.assign(Error('Zpětné čtení se liší od požadavku'), { status: 500 });
    c.res.set('features', { status: 'ready', data: after });
  }, 'Přepínače změněny a ověřeny. Platí do restartu backendu.');
  if (ok) c.clearDrafts('feat-');
}

// ---------- zabezpečení ----------
function security(c) {
  const sec = c.sec, tokens = sec.tokens, audit = sec.audit, webhook = sec.webhook, sessions = sec.sessions;
  const accounts = c.sm.resources.get('ucet')?.data?.accounts || [];
  const pairing = c.pairing?.vm?.();
  const scopes = require('../security-workspace').TOKEN_SCOPES;
  const scopeLabel = { 'read:chat': 'Číst konverzace', 'read:projects': 'Číst projekty', 'read:settings': 'Číst nastavení', 'write:chat': 'Psát do konverzací', 'write:settings': 'Měnit nastavení' };
  const tokenRows = tokens.status === 'ready' ? tokens.rows : [];
  return intro('Zabezpečení', 'Oprávnění, přístup a přehled připojení.')
    + (sec.notice ? `<div class="notice">${icon('info')}<p>${e(sec.notice)}</p></div>` : '')
    + `<div class="grid2"><section class="card"><h2>Přístup a schvalování</h2>${kv('Potvrzení účinků mimo aplikaci', tag('Vždy vyžadováno', 'green'))}${kv('Změny souborů projektu', 'Plán M2 · samostatné schválení')}${kv('Git commit a push', 'Plán se schválením · podle politiky projektu')}${kv('Přístup k backendu', 'Lokální oprávnění desktopu')}${kv('Webhook', webhook.status === 'ready' ? webhook.data.configured ? tag('Secret nastaven', 'green') : tag('Nenastaven') : webhook.status === 'error' ? e(webhook.error) : '…')}${kv('Běh backendu', sessions.status === 'ready' ? `${num(Math.round(sessions.data.uptime_seconds / 60))} min` : '—')}<p class="help">Schvalování účinků nelze vypnout. Zámek při nečinnosti IDE zatím nemá; přístup chrání přihlášení do systému.</p></section>`
    + `<section class="card"><h2>Propojené účty</h2><p class="help">${accounts.length ? e(accounts.map(a => (a.provider === 'discord' ? 'Discord' : 'Telegram') + ' · ' + a.name).join(', ')) : 'Žádné doručovací účty.'} Oprávnění lze prohlédnout a propojení odvolat v nastavení účtů.</p><div class="toolbar">${btn('Spravovat propojení', 'sv4-goto', { page: 'account' })}${btn('Repozitáře a přístupy', 'sv4-goto', { page: 'repositories' }, 'ghost')}</div></section></div>`
    + `<section class="card section-gap"><div class="card-head"><div><h2>Přístupové tokeny API</h2><p class="help">Pro skripty a integrace. Token se zobrazí jen jednou; uložen je pouze jeho otisk.</p></div>${tag(pl(tokenRows.length, 'token', 'tokeny', 'tokenů'))}</div>${sec.oneTimeToken ? `<div class="sv2-summary-box" role="status"><strong>Nový token · zobrazí se jen nyní</strong><input class="mono" id="sec-token-value" readonly value="${e(sec.oneTimeToken)}" data-live><div class="toolbar">${btn('Zkopírovat a skrýt', 'sv4-token-copy', {}, 'small primary')}${btn('Skrýt', 'sv4-token-hide', {}, 'small ghost')}</div></div>` : ''}${tokenRows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Název</th><th>Oprávnění</th><th>Použit</th><th>Platnost</th><th></th></tr></thead><tbody>${tokenRows.map(t => `<tr><td><strong>${e(t.name)}</strong></td><td>${(Array.isArray(t.scopes) ? t.scopes : []).map(s => tag(scopeLabel[s] || s)).join(' ')}</td><td>${e(t.last_used_at ? date(t.last_used_at) : 'Nikdy')}</td><td>${e(t.expires_at ? date(t.expires_at) : 'Bez data')}</td><td>${btn('Odvolat…', 'sv4-token-revoke', { token: t.id }, 'small danger')}</td></tr>`).join('')}</tbody></table></div>` : tokens.status === 'error' ? `<p class="muted">${e(tokens.error)}</p>` : H.empty('Žádný aktivní token.')}<form id="sv4-token-form" class="section-gap"><div class="grid2">${H.labeled('Název nového tokenu', 'sec-token-name', H.input('sec-token-name', '', 'maxlength="120" placeholder="Např. Skript zálohy"'))}<div><span class="hunt2-field-label">Oprávnění</span>${scopes.map(s => H.check('sec-scope-' + s.replace(':', '-'), scopeLabel[s] || s, ['read:chat', 'read:projects'].includes(s))).join('')}</div></div><div class="toolbar">${btn('Vytvořit token…', 'sv4-token-create', {}, 'primary', tokens.status === 'ready' && !sec.busy ? 'data-submit' : 'disabled')}</div></form></section>`
    + (pairing ? `<section class="card section-gap"><div class="card-head"><div><h2>Telefon · Remote Companion</h2><p class="help">Telefon se připojuje jen přes vaši VPN. Vyberte oprávnění a vytvořte kód platný pět minut; neukládá se.</p></div>${pairing.hasClaim ? tag('Kód vydán', 'green') : tag('Bez kódu')}</div><div class="hunt2-role-checks sv4-pairing-scopes">${pairing.scopes.map(s => `<label class="check-row"><input type="checkbox" data-action="sv4-pair-scope" data-scope="${e(s.name)}" ${s.checked ? 'checked' : ''} ${s.disabled ? 'disabled' : ''}><span class="mono">${e(s.name)}</span></label>`).join('')}</div>${pairing.hasClaim ? `<div class="sv2-summary-box"><strong class="mono">${e(pairing.code)}</strong><p class="help">Platí do ${e(pairing.expiry)} · ${e(pairing.uri)}</p></div>` : ''}${pairing.hasError ? `<p class="validation">${e(pairing.error)}</p>` : ''}<p class="help">${e(pairing.status)}</p><div class="toolbar">${btn('Vytvořit kód', 'sv4-pair-issue', {}, 'primary', pairing.disabled ? 'disabled' : '')}</div></section>` : '')
    + `<section class="card section-gap"><div class="card-head"><div><h2>Auditní záznam</h2><p class="help">Posledních 50 bezpečnostně významných událostí backendu.</p></div><div class="toolbar">${['all', 'cre', 'merge', 'drift', 'llm'].map(t => btn(t === 'all' ? 'Vše' : t.toUpperCase(), 'sv4-audit-type', { type: t }, 'small ' + (sec.auditType === t ? 'primary' : 'ghost'))).join('')}</div></div>${audit.status === 'ready' ? audit.rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Čas</th><th>Typ</th><th>Událost</th></tr></thead><tbody>${audit.rows.slice(0, 50).map(r => `<tr><td>${e(date(r.created_at ? String(r.created_at).replace(' ', 'T') + (String(r.created_at).includes('Z') ? '' : 'Z') : null))}</td><td>${tag(r.type.toUpperCase())}</td><td>${e(String(r.input_preview || r.intent || r.capability || r.model || r.event_type || 'Záznam').slice(0, 160))}</td></tr>`).join('')}</tbody></table></div>` : H.empty('Žádné záznamy pro zvolený typ.') : audit.status === 'error' ? `<p class="muted">${e(audit.error)}</p>` : '<div class="sv4-loading">Načítám audit…</div>'}</section>`;
}

// ---------- o aplikaci ----------
function about(c) {
  const health = c.data('health'), info = c.data('info'), storage = c.data('storage'), fb = c.fb;
  const fv = fb.vm();
  return intro('O aplikaci', 'Verze, běžící služby a diagnostické informace.') + status(c, ['health', 'info'])
    + `<div class="grid2"><section class="card"><h2>IntentSmith Studio</h2>${kv('Aplikace', 'IntentSmith IDE 2.0')}${kv('Backend', health ? `${e(health.version)} · ${health.ready ? tag('Připojen', 'green') : tag('Spouští se', 'gold')}` : tag('Nepřipojen', 'red'))}${kv('Databáze', info ? `SQLite · ${num(info.db?.size_mb, 1)} MiB · ${pl(info.db?.migrations || 0, 'migrace', 'migrace', 'migrací')}` : '—')}${kv('Poslední záloha', storage?.backups?.last_at ? e(date(storage.backups.last_at)) : '—')}${kv('Model CHAT', info ? `<span class="mono">${e(info.config?.chat_model)}</span>` : '—')}${kv('Běží', info ? `${num(Math.round(info.uptime_seconds / 60))} min` : '—')}<p class="help">Webová rozhraní a mobilní klient se připojují přes stejný backend; jejich přístup řídí Zabezpečení.</p><div class="toolbar">${btn('Diagnostický přehled', 'sv4-diagnostics')}${btn('Systém', 'sv4-goto', { page: 'system' }, 'ghost')}</div></section>`
    + `<section class="card"><h2>Zpětná vazba</h2><form id="sv4-feedback-form">${H.labeled('Kategorie', 'fb-category', H.select('fb-category', fv.categories.map(x => [x.value, x.label]), fv.category, 'data-live'))}${H.labeled('Zpráva', 'fb-message', `<textarea id="fb-message" name="fb-message" rows="4" maxlength="2000" placeholder="Co se stalo, co jste očekávali…">${e(fv.message)}</textarea>`)}${H.check('fb-last', 'Přiložit poslední odpověď asistenta', fv.attachLast)}${H.check('fb-logs', 'Přiložit serverový log', fv.attachLogs)}<div class="toolbar">${btn('Odeslat zpětnou vazbu', 'sv4-feedback-send', {}, 'primary', fb.busy ? 'disabled' : 'data-submit')}</div><p class="help">${e(fv.notice)}</p></form></section></div>`;
}

// ---------- směrování ----------
const PAGES = { memory, output, appearance, system, features, security, about };
function render(c, page) { return (PAGES[page] || (() => intro('Nastavení', 'Neznámá kategorie.')))(c); }
async function diagnostics(c, download) {
  if (!await c.load('diagnostics', true)) { c.toast('Diagnostiku se nepodařilo načíst: ' + (c.resource('diagnostics').error || '')); return; }
  const d = c.data('diagnostics');
  if (download) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = c.el.ownerDocument.createElement('a');
    a.href = url; a.download = 'intentsmith-diagnostika-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    c.toast('Diagnostika je připravená ke stažení.');
    return;
  }
  c.H.modal('Diagnostika backendu', diagnosticsBody(d) + '<p class="help">Celý dokument stáhnete tlačítkem Stáhnout JSON v kategorii Systém.</p>', null, null, { wide: true });
}
function act(c, action, el) {
  const d = el?.dataset || {};
  switch (action) {
    case 'sv4-memory-save': saveMemory(c); return true;
    case 'sv4-memory-reset': saveMemory(c, true); return true;
    case 'sv4-goto-models': c.navigate('models', d.tab === 'connections' ? 'policy' : d.tab || 'roles'); return true;
    case 'sv4-open-conversations': c.openSection?.('chats'); return true;
    case 'sv4-ap-style': {
      const glass = DARK_ONLY.includes(el.value), mode = c.form('ap-tmode');
      if (mode) { mode.disabled = glass; if (glass) mode.value = 'dark'; }
      return true;
    }
    case 'sv4-ap-preview': {
      const label = el.closest('.field')?.querySelector('label');
      if (label) label.textContent = label.textContent.replace(/ · \d+ %$/, '') + ' · ' + el.value + ' %';
      return true;
    }
    case 'sv4-ap-save': c.applyAppearance?.(readAppearance(c)); c.clearDrafts('ap-'); c.render(true); c.toast('Vzhled uložen v profilu IDE.'); return true;
    case 'sv4-ap-reset': c.applyAppearance?.({ ...AP_DEFAULTS }); c.clearDrafts('ap-'); c.render(true); c.toast('Vzhled vrácen na výchozí hodnoty.'); return true;
    case 'sv4-diagnostics': diagnostics(c, false); return true;
    case 'sv4-diagnostics-download': diagnostics(c, true); return true;
    case 'sv4-system-refresh': for (const k of ['info', 'health', 'gpu']) c.load(k, true); return true;
    case 'sv4-reset-settings':
      c.confirm('Smazat všechna uživatelská nastavení v backendu a vypnout modelovou automatizaci? Konverzace, projekty a zálohy zůstanou. Tuto akci nelze vrátit; doporučujeme nejdřív export nastavení v Zálohách.', { title: 'Obnovit výchozí nastavení', ok: 'Obnovit výchozí', danger: true })
        .then(ok => ok && c.run('reset', 'Obnovení výchozích nastavení', async () => {
          const result = await c.api('POST', '/api/reset', {});
          if (result?.success !== true) throw Object.assign(Error('Backend operaci nepotvrdil'), { status: 500 });
          const [settings, policy] = await Promise.all([c.api('GET', '/api/settings'), c.api('GET', '/api/system/models/policy')]);
          if (Object.keys(settings || {}).length || policy?.policy?.autoFailoverEnabled || policy?.policy?.autoCleanupEnabled) throw Object.assign(Error('Výsledek nelze ověřit'), { status: 500 });
          for (const key of ['settings', 'storageSettings', 'features']) c.load(key, true);
        }, 'Uživatelská nastavení jsou prázdná a modelová automatizace vypnutá.'));
      return true;
    case 'sv4-features-save': saveFeatures(c); return true;
    case 'sv4-features-reset':
      c.confirm('Obnovit výchozí běhové přepínače backendu?', { title: 'Funkční přepínače' }).then(ok => ok && c.run('features', 'Obnovení přepínačů', async () => {
        const result = await c.api('POST', '/api/features/reset', {});
        if (result?.ok !== true) throw Object.assign(Error('Backend obnovu nepotvrdil'), { status: 500 });
        await c.load('features', true); c.clearDrafts('feat-');
      }, 'Výchozí přepínače obnoveny a ověřeny.'));
      return true;
    case 'sv4-token-create': {
      const name = String(c.value('sec-token-name') || '').trim();
      const scopes = require('../security-workspace').TOKEN_SCOPES.filter(s => c.value('sec-scope-' + s.replace(':', '-')));
      if (!name || !scopes.length) { c.toast('Vyplňte název tokenu a vyberte aspoň jedno oprávnění.'); return true; }
      c.sec.tokenName = name; c.sec.scopes = new Set(scopes);
      c.confirmThen(`Vytvořit přístupový token „${name}“ s oprávněními ${scopes.join(', ')}? Token se ukáže jen jednou.`, () => c.sec.createToken(), { title: 'Nový token API', ok: 'Vytvořit token' })
        .then(() => { c.clearDrafts('sec-'); if (c.sec.notice) c.toast(c.sec.notice); });
      return true;
    }
    case 'sv4-token-revoke': {
      const row = c.sec.tokens.rows?.find(t => t.id === d.token);
      if (row) c.confirmThen(`Odvolat token „${row.name}“? Přístup skončí okamžitě.`, () => c.sec.revokeToken(row.id), { title: 'Odvolat token', ok: 'Odvolat', danger: true }).then(() => c.sec.notice && c.toast(c.sec.notice));
      return true;
    }
    case 'sv4-token-copy': c.sec.copyToken().then(() => c.toast(c.sec.notice)); return true;
    case 'sv4-token-hide': c.sec.hideToken(); return true;
    case 'sv4-audit-type': c.sec.selectAudit(d.type); return true;
    case 'sv4-pair-scope': c.pairing?.toggle?.(d.scope); c.schedule(); return true;
    case 'sv4-pair-issue': Promise.resolve(c.pairing?.issue?.()).then(() => c.render(true)); return true;
    case 'sv4-feedback-send': {
      const fb = c.fb;
      fb.setCategory(c.value('fb-category')); fb.setMessage(String(c.value('fb-message') || ''));
      fb.attachLast = !!c.value('fb-last'); fb.attachLogs = !!c.value('fb-logs');
      if (!fb.message.trim()) { c.toast('Napište zprávu.'); return true; }
      fb.send().then(ok => { if (ok) c.clearDrafts('fb-'); c.toast(fb.notice); c.render(true); });
      return true;
    }
    default: return false;
  }
}

module.exports = { render, act, MEMORY, FEATURES, AP_DEFAULTS };
