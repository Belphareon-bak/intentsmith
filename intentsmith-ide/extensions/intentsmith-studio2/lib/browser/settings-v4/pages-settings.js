'use strict';

// Stránky Nastavení v4 podle návrhu V4 (settings-v2.js, app.js) se skutečnými daty.
// Přehled, Účet a propojení, Oznámení, Úložiště, Zálohy a Repozitáře. Ostatní kategorie: pages-general.js.

const H = require('./helpers');
const general = require('./pages-general');
const { remoteWebUrl } = require('../ide-settings-management');

const { e, icon, tag, meta, kv, pl, num, bytes, date } = H;
const btn = (text, action, data = {}, cls = '', extra = '') => {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${e(value)}"`).join(' ');
  return `<button type="button" class="button ${cls}" data-action="${e(action)}" ${attrs} ${extra}>${e(text)}</button>`;
};
const intro = (title, description, actions = '') => H.head(title, description, btn('← Všechna nastavení', 'settings-home') + actions, 'Nastavení');
const EVENTS = [['worker', 'Výsledky workerů', 'Dokončení, chyba nebo přerušení práce workera'], ['lifecycle', 'Průběh úkolů a schvalování', 'Čekání na schválení, dokončení a chyba projektového úkolu']];
const SECTIONS = [['database', 'Databáze', 'Historie, projekty a nastavení · povinná součást'], ['config', 'Konfigurace', 'Volby aplikace a pracovní profily'], ['skills', 'Skilly', 'Vlastní definice a související soubory'], ['specialists', 'Specialisté', 'Balíčky specialistů a jejich manifesty']];
const ERRORS = { IDE_BACKEND_UNAVAILABLE: 'backend není dostupný', IDE_RESPONSE_INVALID: 'backend vrátil neplatná data', IDE_LOCAL_OPERATOR_REQUIRED: 'operace je povolená jen místnímu operátorovi', IDE_BACKEND_CHANGED: 'backend se mezitím změnil' };

// ---------- společné ----------
function smRes(c, category) { return c.sm.resources.get(category); }
function smData(c, category) { const r = smRes(c, category); return r?.data || null; }
function status(c, { sm = [], res = [] } = {}) {
  const items = [...sm.map(k => smRes(c, k)), ...res.map(k => c.resource(k))];
  const failed = items.find(r => r?.status === 'error');
  if (failed) return `<div class="sv4-error" role="alert"><span>Data se nepodařilo načíst (${e(ERRORS[failed.error] || failed.error)}). Zobrazený stav nemusí být úplný.</span>${btn('Obnovit', 'retry', {}, 'small')}</div>`;
  if (items.some(r => !r || ['idle', 'loading'].includes(r.status))) return '<div class="sv4-loading" role="status">Načítám skutečný stav z backendu…</div>';
  return '';
}
function smNotice(c, category, before) {
  const text = c.sm.notices.get(category);
  if (text && text !== before) c.toast(text);
  return text;
}
async function smSave(c, category, open, values) {
  const owner = c.modals.at(-1) || c.s.sshEditor || c.s.channelEditor || category + ':' + open.toString();
  const existing = c.sm.editors.get(category);
  if (existing?.blocked) {
    c.toast('Předchozí zápis není ověřený. Obnovte stav a porovnejte jej; opakování je zablokované.');
    return false;
  }
  if (!existing || existing.v4Owner !== owner) open();
  const editor = c.sm.editors.get(category);
  if (!editor) { c.toast('Data ještě nejsou načtená. Zkuste to za okamžik znovu.'); return false; }
  editor.v4Owner = owner;
  Object.assign(editor.draft, values);
  const before = c.sm.notices.get(category);
  const ok = await c.sm.save(category);
  smNotice(c, category, before);
  c.render(true);
  return ok;
}
async function smRemove(c, category, kind, row) {
  const before = c.sm.notices.get(category);
  const ok = await c.sm.remove(category, kind, row);
  smNotice(c, category, before);
  c.render(true);
  return ok;
}
function sshHosts(git) { return new Map((git?.profiles || []).map(p => [p.id, p])); }

// ---------- přehled ----------
function summary(c) {
  const ucet = smData(c, 'ucet'), git = smData(c, 'git'), oz = smData(c, 'oznameni'), zal = smData(c, 'zalohy');
  const out = {};
  if (ucet || git) { const n = connections(c).filter(x => x.connected).length; if (n) out.account = pl(n, 'propojení', 'propojení', 'propojení'); }
  if (oz) { const n = channels(c).filter(ch => ch.active).length; out.notifications = pl(n, 'aktivní kanál', 'aktivní kanály', 'aktivních kanálů'); }
  if (zal) out.backups = pl(zal.backups.length, 'záloha', 'zálohy', 'záloh');
  if (git) out.repositories = pl(git.repositories.length, 'repozitář', 'repozitáře', 'repozitářů');
  return out;
}
function home(c) {
  const { CATEGORIES } = require('./controller');
  const sum = summary(c);
  const head = H.head('Nastavení', 'Nastavení podle účelu, bez opakovaných technických sloupců.');
  if (c.s.layout === 'grid') return head + `<div class="catalog-grid">${CATEGORIES.map(([, page, label, desc, ic]) => `<article class="catalog-card"><div class="item-icon">${icon(ic)}</div><h3>${e(label)}</h3><p>${e(desc)}</p>${sum[page] ? tag(sum[page]) : ''}${btn('Otevřít', 'settings-open', { settings: page })}</article>`).join('')}</div>`;
  return head + `<div class="table-wrap"><table class="data-table"><thead><tr><th>Název</th><th>Popis</th><th>Stav</th><th></th></tr></thead><tbody>${CATEGORIES.map(([, page, label, desc, ic]) => `<tr><td><button type="button" class="link-button cell-title" data-action="settings-open" data-settings="${page}">${icon(ic)}${e(label)}</button></td><td class="muted">${e(desc)}</td><td>${sum[page] ? tag(sum[page]) : ''}</td><td>${H.button(icon('chevron'), 'settings-open', `class="button small ghost" data-settings="${page}" aria-label="Otevřít ${e(label)}"`)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- účet a propojení ----------
// Služby návrhu. Git hosty se propojují SSH profilem (Repozitáře a přístupy), Discord a Telegram doručovacím účtem.
// Google a Microsoft backend nepodporuje; řádek to říká a nenabízí falešné přihlášení.
const PROVIDERS = [
  ['github', 'GitHub', 'Repozitáře a pull requesty', 'git', 'github.com'],
  ['gitlab', 'GitLab', 'Repozitáře a merge requesty', 'git', 'gitlab.com'],
  ['google', 'Google', 'Kalendář a pracovní soubory', 'link', null],
  ['microsoft', 'Microsoft', 'Kalendář a pracovní soubory', 'link', null],
  ['discord', 'Discord', 'Doručení do vybraného kanálu', 'bell', null],
  ['telegram', 'Telegram', 'Doručení do vybraného chatu', 'bell', null]
];
function connections(c) {
  const accounts = smData(c, 'ucet')?.accounts || [], profiles = smData(c, 'git')?.profiles || [];
  return PROVIDERS.map(([id, name, desc, ic, host]) => {
    if (host) {
      const own = profiles.filter(p => p.host === host);
      return { id, name, desc, icon: ic, kind: 'git', host, items: own, connected: own.length > 0,
        account: own.length ? own.map(p => p.user + '@' + p.host + (p.port === 22 ? '' : ':' + p.port)).join(', ') : desc,
        scopes: own.length ? 'SSH přístup k repozitářům · ' + pl(own.length, 'profil', 'profily', 'profilů') : 'Zobrazí se před propojením',
        status: own.length ? ['Nastaveno · SSH neověřeno', 'gold'] : ['Nepropojeno', ''] };
    }
    if (id === 'google' || id === 'microsoft') return { id, name, desc, icon: ic, kind: 'none', items: [], connected: false, account: desc,
      scopes: 'Propojení přes OAuth zatím IDE nepodporuje', status: ['Nedostupné', ''] };
    const own = accounts.filter(a => a.provider === id), active = own.filter(a => a.enabled && a.credentialConfigured);
    return { id, name, desc, icon: ic, kind: 'account', items: own, connected: own.length > 0,
      account: own.length ? own.map(a => a.name + ' · ' + a.recipient).join(', ') : desc,
      scopes: own.length ? 'Doručování oznámení · ' + pl(new Set(own.flatMap(a => a.events)).size, 'typ události', 'typy událostí', 'typů událostí') : 'Zobrazí se před propojením',
      status: !own.length ? ['Nepropojeno', ''] : active.some(a => a.connectionStatus === 'VERIFIED') ? ['Doručení ověřeno', 'green'] : active.length ? ['Nastaveno · doručení neověřeno', 'gold'] : own.some(a => a.enabled) ? ['Chybí token', 'gold'] : ['Vypnuto', ''] };
  });
}
function account(c) {
  const ucet = smData(c, 'ucet'), profile = ucet?.profile || { displayName: '', email: '', description: '', revision: 0 };
  const list = connections(c), count = list.filter(x => x.connected).length;
  const actionFor = p => p.kind === 'none' ? btn('Propojit', 'sv4-provider', { provider: p.id }, 'small', 'disabled title="Propojení přes OAuth zatím IDE nepodporuje"')
    : btn(p.connected ? 'Spravovat' : 'Propojit', 'sv4-provider', { provider: p.id }, p.connected ? 'small ghost' : 'small primary');
  const scopes = [['personal', 'Osobní', 'Vlastní profil a osobní kontext'], ['work', 'Pracovní', 'Oddělený pracovní kontext'], ['anonymous', 'Anonymní', 'Bez přiřazení k profilu']];
  const linked = c.s.layout === 'grid'
    ? `<div class="sv2 sv2-linked-grid">${list.map(p => `<section class="card sv2-account-card ${p.connected ? 'sv2-connected' : ''}"><div class="sv2-service-row"><span class="sv2-service-icon">${icon(p.icon)}</span><div class="sv2-grow"><strong>${e(p.name)}</strong><small class="muted">${e(p.account)}</small></div><span class="sv2-service-status">${tag(...p.status)}</span><div class="sv2-row-actions">${actionFor(p)}</div></div><p class="help">${e(p.scopes)}</p></section>`).join('')}</div>`
    : `<div class="table-wrap" data-layout="list"><table class="data-table sv2-linked-list"><thead><tr><th>Služba</th><th>Účet / účel</th><th>Oprávnění</th><th>Stav</th><th></th></tr></thead><tbody>${list.map(p => `<tr class="${p.connected ? 'sv2-connected-row' : ''}"><td><span class="sv2-cell-service"><span class="sv2-service-icon">${icon(p.icon)}</span><strong>${e(p.name)}</strong></span></td><td>${e(p.account)}</td><td class="muted">${e(p.scopes)}</td><td>${tag(...p.status)}</td><td class="sv2-cell-actions">${actionFor(p)}</td></tr>`).join('')}</tbody></table></div>`;
  return intro('Účet a propojení', 'Identita, propojené služby a rozsah aktuální relace.') + status(c, { sm: ['ucet', 'git'] })
    + `<div class="sv2 grid2"><section class="card"><div class="sv2-identity"><div class="sv2-avatar">${icon('user')}</div><div class="sv2-grow"><div class="eyebrow">Lokální profil</div><h2>${e(profile.displayName || 'Profil zatím není vyplněný')}</h2><div class="muted">${e(profile.email || 'E-mail není uvedený')}</div><p class="help">${pl(count, 'propojená služba', 'propojené služby', 'propojených služeb')} · ${e(profile.description || 'Bez popisu')}</p></div>${btn('Upravit', 'sv4-profile-edit', {}, 'small', ucet ? '' : 'disabled')}</div><div class="divider"></div><h3>Rozsah relace</h3><div class="sv2-scope-options">${scopes.map(([id, title, desc]) => `<button type="button" class="sv2-scope-option" aria-pressed="${id === 'personal'}" ${id === 'personal' ? '' : 'disabled'}><span class="sv2-radio"></span><span><strong>${title}</strong><small>${desc}</small></span></button>`).join('')}</div><p class="help">Všechny relace teď patří lokálnímu profilu. Oddělený pracovní a anonymní kontext backend zatím nepodporuje, proto jsou volby neaktivní.</p></section>`
    + `<section class="card"><div class="card-head"><h2>Lokální účet</h2>${tag('Aktivní', 'green')}</div><div class="sv2-identity"><div class="sv2-avatar small">${icon('user')}</div><div><strong>Samostatná lokální identita</strong><p class="help">Přístup k backendu řídí desktopové ověření této instalace. Propojení externích služeb se spravuje odděleně níže.</p></div></div><div class="divider"></div>${meta([['Aktivní rozsah', 'Osobní'], ['Heslo / přihlášení', 'Lokální oprávnění desktopu · bez hesla'], ['Uložení změn', 'Databáze backendu · revize ' + (profile.revision ?? 0)]])}<div class="toolbar">${btn('Upravit profil', 'sv4-profile-edit', {}, 'primary', ucet ? '' : 'disabled')}</div></section></div>`
    + H.sectionTitle('Propojené účty', tag(pl(count, 'propojení', 'propojení', 'propojení'), 'gold')) + linked
    + '<p class="help">Git hosty používají SSH profily z Repozitářů a přístupů; Discord a Telegram doručovací účty s tokenem v proměnné prostředí. Uložení propojení ještě neověřuje doručení – k tomu slouží Zkouška v Oznámeních.</p>';
}
function profileModal(c) {
  const profile = smData(c, 'ucet')?.profile;
  if (!profile) return;
  c.H.modal('Lokální profil', `${H.labeled('Zobrazované jméno', 'acc-name', H.input('acc-name', profile.displayName, 'required maxlength="200"'))}${H.labeled('E-mail (volitelný)', 'acc-email', `<input type="email" id="acc-email" name="acc-email" value="${e(profile.email)}" maxlength="254">`)}${H.labeled('Popis profilu', 'acc-description', H.input('acc-description', profile.description, 'maxlength="2000"'), 'Pouze popis v IDE. Není systémovým promptem ani přihlášením k externí službě.')}<p class="validation" data-sv4-error role="status"></p>`, 'Uložit profil', async form => {
    const v = new FormData(form), name = String(v.get('acc-name') || '').trim(), email = String(v.get('acc-email') || '').trim();
    if (!name) return error(form, 'Vyplňte zobrazované jméno.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(form, 'Zadejte platnou e-mailovou adresu, nebo pole ponechte prázdné.');
    const ok = await smSave(c, 'ucet', () => c.sm.editor('ucet', 'identity', profile, { displayName: profile.displayName, email: profile.email, description: profile.description }),
      { displayName: name, email, description: String(v.get('acc-description') || '').trim() });
    return ok ? true : error(form, c.sm.notices.get('ucet') || 'Profil se nepodařilo uložit.');
  });
}
function error(form, text) { const node = form?.querySelector('[data-sv4-error]'); if (node) node.textContent = text; return false; }
function accountModal(c, provider, accountRow = null) {
  const category = 'ucet';
  const d = accountRow || { name: provider === 'discord' ? 'Discord' : 'Telegram', provider, credentialEnv: 'INTENTSMITH_' + provider.toUpperCase() + '_TOKEN', recipient: '', enabled: true, events: ['worker', 'lifecycle'] };
  const label = provider === 'discord' ? 'Discord' : 'Telegram';
  c.H.modal(`${accountRow ? 'Upravit' : 'Propojit'} ${label}`, `${H.labeled('Název propojení', 'acc-a-name', H.input('acc-a-name', d.name, 'required maxlength="200"'))}${H.labeled(provider === 'discord' ? 'ID kanálu' : 'Chat ID nebo @uživatel', 'acc-a-recipient', H.input('acc-a-recipient', d.recipient, 'required maxlength="100" class="mono"'), provider === 'discord' ? 'Číselné ID cílového kanálu (6–25 číslic).' : 'Číselné ID chatu, nebo @uživatelské jméno bota/kanálu.')}${H.labeled('Proměnná s tokenem', 'acc-a-env', H.input('acc-a-env', d.credentialEnv, 'required maxlength="100" class="mono"'), `Token se do IDE nevkládá. Nastavte ho v ~/.config/intentsmith/runtime.env jako ${'INTENTSMITH_' + provider.toUpperCase() + '_…'} a restartujte backend.`)}${accountRow ? kv('Token v prostředí', accountRow.credentialConfigured ? tag('Nastaven', 'green') : tag('Chybí', 'gold')) : ''}<h3>Doručované události</h3>${EVENTS.map(([key, text, hint]) => H.check('acc-a-event-' + key, text, d.events.includes(key), hint)).join('')}${H.check('acc-a-enabled', 'Povolit doručování', d.enabled)}<p class="validation" data-sv4-error role="status"></p>`, accountRow ? 'Uložit propojení' : 'Propojit', async form => {
    const v = new FormData(form);
    const values = { name: String(v.get('acc-a-name') || '').trim(), provider, credentialEnv: String(v.get('acc-a-env') || '').trim(), recipient: String(v.get('acc-a-recipient') || '').trim(), enabled: v.has('acc-a-enabled') };
    for (const [key] of EVENTS) values['event_' + key] = v.has('acc-a-event-' + key);
    if (!new RegExp('^INTENTSMITH_' + provider.toUpperCase() + '_[A-Z0-9_]+$').test(values.credentialEnv)) return error(form, `Název proměnné musí začínat INTENTSMITH_${provider.toUpperCase()}_ a obsahovat jen velká písmena, čísla a podtržítka.`);
    if (provider === 'discord' ? !/^[0-9]{6,25}$/.test(values.recipient) : !/^(-?[0-9]{1,25}|@[a-zA-Z0-9_]{5,32})$/.test(values.recipient)) return error(form, provider === 'discord' ? 'ID kanálu musí mít 6–25 číslic.' : 'Zadejte číselné ID chatu nebo @jméno (5–32 znaků).');
    const ok = await smSave(c, category, () => c.sm.openAccount(category, accountRow), values);
    return ok ? true : error(form, c.sm.notices.get(category) || 'Propojení se nepodařilo uložit.');
  });
}
function providerManage(c, id) {
  const p = connections(c).find(x => x.id === id);
  if (!p || p.kind === 'none') return;
  if (p.kind === 'git') { c.s.repoProfileHost = p.host; c.s.sshEditor = p.connected ? null : { id: null, host: p.host }; c.navigate('repositories'); return; }
  if (!p.items.length) { accountModal(c, id); return; }
  c.H.modal(`${p.name} · propojení`, `<div class="table-wrap"><table class="data-table"><thead><tr><th>Propojení</th><th>Příjemce</th><th>Stav</th><th></th></tr></thead><tbody>${p.items.map(a => `<tr><td><strong>${e(a.name)}</strong><div class="cell-sub mono">${e(a.credentialEnv)}</div></td><td class="mono">${e(a.recipient)}</td><td>${tag(a.enabled ? a.credentialConfigured ? 'Povoleno' : 'Chybí token' : 'Vypnuto', a.enabled && a.credentialConfigured ? 'green' : a.enabled ? 'gold' : '')}</td><td class="sv2-cell-actions">${btn('Upravit', 'sv4-account-edit', { account: a.id }, 'small')}${btn('Odpojit…', 'sv4-account-delete', { account: a.id }, 'small danger')}</td></tr>`).join('')}</tbody></table></div><p class="help">Odpojení odstraní jen toto doručovací propojení v IntentSmithu. Účet ani bot u poskytovatele se nemění.</p><div class="toolbar">${btn('+ Další propojení', 'sv4-account-new', { provider: id })}</div>`, null);
}

// ---------- oznámení ----------
function channels(c) {
  const oz = smData(c, 'oznameni');
  if (!oz) return [];
  const registered = new Map(oz.channels.map(ch => [ch.name, ch.configured]));
  const list = [{ id: 'desktop', kind: 'desktop', name: 'Desktop', icon: 'bell', target: 'Toto zařízení', active: registered.get('desktop') === true,
    status: registered.get('desktop') ? ['Aktivní', 'green'] : ['Nenastaveno', ''], events: ['worker', 'lifecycle'], testable: registered.get('desktop') === true }];
  for (const provider of ['discord', 'telegram']) {
    const own = oz.accounts.filter(a => a.provider === provider);
    if (!own.length) list.push({ id: 'new-' + provider, kind: 'missing', provider, name: provider === 'discord' ? 'Discord' : 'Telegram', icon: 'bell', target: 'Účet není propojený', active: false, status: ['Účet nepropojen', ''], events: [] });
    for (const a of own) list.push({ id: 'acc-' + a.id, kind: 'account', account: a, provider, name: (provider === 'discord' ? 'Discord' : 'Telegram') + (own.length > 1 ? ' · ' + a.name : ''), icon: 'bell', target: a.recipient + ' · ' + a.name,
      active: a.enabled && a.credentialConfigured, status: !a.enabled ? ['Vypnuto', ''] : a.credentialConfigured ? ['Aktivní', 'green'] : ['Chybí token', 'gold'], events: a.events, testable: a.enabled && a.credentialConfigured });
  }
  const m = oz.email;
  list.push({ id: 'email', kind: 'email', name: 'E-mail', icon: 'file', target: m.emailRecipient || 'Příjemce není nastaven', active: m.emailEnabled && !!m.smtpHost && registered.get('email') === true,
    status: !m.emailEnabled ? ['Vypnuto', ''] : m.smtpHost ? registered.get('email') ? ['Aktivní', 'green'] : ['Chybí přihlášení SMTP', 'gold'] : ['Chybí SMTP server', 'gold'],
    events: [m.emailOnWorker && 'worker', m.emailOnLifecycle && 'lifecycle'].filter(Boolean), testable: registered.get('email') === true && !!m.emailRecipient });
  for (const [name, configured] of registered) if (configured && !['desktop', 'email', 'telegram', 'discord'].includes(name))
    list.push({ id: 'reg-' + name, kind: 'registered', name: name === 'ntfy' ? 'ntfy' : name === 'push' ? 'Push' : name === 'webhook' ? 'Webhook' : name, icon: 'link', target: 'Nastaveno v prostředí backendu', active: true, status: ['Aktivní', 'green'], events: [], testable: true, channel: name });
  return list;
}
function eventsText(list) { return list.length ? pl(list.length, 'typ události', 'typy událostí', 'typů událostí') : 'Bez událostí'; }
function channelEditor(c) {
  const ed = c.s.channelEditor, ch = ed && channels(c).find(x => x.id === ed.id);
  if (!ch) return '';
  const header = `<div class="card-head"><div><div class="eyebrow">Přímo na stránce</div><h2>${e(ch.name)} · ${ed.mode === 'test' ? 'zkouška doručení' : 'parametry kanálu'}</h2></div>${btn('Zavřít panel', 'sv4-channel-close', {}, 'small ghost')}</div>`;
  if (ed.mode === 'test') {
    const last = c.s.lastDelivery?.channel === ch.id ? c.s.lastDelivery : null;
    return `<section class="card sv2-inline-panel" id="sv4-channel-editor">${header}${meta([['Cíl', ch.target], ['Stav', ch.status[0]]])}<p class="help">Zkouška odešle skutečnou testovací zprávu přes tento kanál. Před odesláním se zobrazí potvrzení; výsledek vychází z odpovědi backendu.</p><div class="toolbar">${btn('Odeslat zkušební zprávu…', 'sv4-channel-send', { channel: ch.id }, 'primary', ch.testable && !c.isBusy('test') ? '' : 'disabled')}${ch.kind !== 'desktop' ? btn('Upravit parametry', 'sv4-channel-edit', { channel: ch.id }, 'ghost') : ''}</div>${!ch.testable ? '<p class="help">Kanál není připravený: nejprve ho povolte a doplňte přihlašovací údaj nebo příjemce.</p>' : ''}${last ? `<div class="sv2-summary-box" role="status"><strong>${e(last.result)}</strong><p class="help">${e(last.explanation)}</p></div>` : ''}</section>`;
  }
  let body = '';
  if (ch.kind === 'account') {
    const a = ch.account;
    body = `<form id="sv4-channel-form" data-channel="${e(ch.id)}">${H.labeled('Cíl doručení', 'ntf-target', H.input('ntf-target', a.recipient, 'required maxlength="100" class="mono"'), a.provider === 'discord' ? 'ID kanálu Discordu.' : 'ID chatu nebo @jméno pro Telegram.')}${H.check('ntf-active', 'Aktivovat kanál', a.enabled)}<h3>Doručované události</h3>${EVENTS.map(([key, text, hint]) => H.check('ntf-event-' + key, text, a.events.includes(key), hint)).join('')}${!a.credentialConfigured ? `<div class="sv2-summary-box">Proměnná <span class="mono">${e(a.credentialEnv)}</span> v prostředí backendu chybí. Kanál lze uložit, ale doručení vyžaduje token.${btn('Otevřít Účty a propojení', 'sv4-goto', { page: 'account' }, 'small ghost')}</div>` : ''}<div class="toolbar">${btn('Uložit kanál', 'sv4-channel-save', { channel: ch.id }, 'primary', 'data-submit')}${btn('Zkouška', 'sv4-channel-test', { channel: ch.id }, 'ghost')}${btn('Zahodit rozepsané změny', 'sv4-channel-revert', { channel: ch.id }, 'small ghost')}</div></form>`;
  } else if (ch.kind === 'email') {
    const m = smData(c, 'oznameni').email;
    body = `<form id="sv4-channel-form" data-channel="email"><div class="grid2">${H.labeled('SMTP server', 'ntf-smtp-host', H.input('ntf-smtp-host', m.smtpHost, 'maxlength="253" placeholder="smtp.example.com"'))}${H.labeled('Port', 'ntf-smtp-port', `<input type="number" id="ntf-smtp-port" name="ntf-smtp-port" min="1" max="65535" value="${e(m.smtpPort)}">`)}</div><div class="grid2">${H.labeled('Odesílatel', 'ntf-smtp-from', H.input('ntf-smtp-from', m.smtpFrom, 'maxlength="254" placeholder="intentsmith@example.com"'))}${H.labeled('Příjemce', 'ntf-email-to', `<input type="email" id="ntf-email-to" name="ntf-email-to" value="${e(m.emailRecipient)}" maxlength="254">`)}</div>${H.check('ntf-active', 'Aktivovat e-mailová oznámení', m.emailEnabled)}<h3>Doručované události</h3>${H.check('ntf-event-worker', EVENTS[0][1], m.emailOnWorker, EVENTS[0][2])}${H.check('ntf-event-lifecycle', EVENTS[1][1], m.emailOnLifecycle, EVENTS[1][2])}<p class="help">Uživatelské jméno a heslo SMTP backend čte jen z prostředí (INTENTSMITH_SMTP_USER / INTENTSMITH_SMTP_PASS); do formuláře nepatří.</p><div class="toolbar">${btn('Uložit kanál', 'sv4-email-save', {}, 'primary', 'data-submit')}${btn('Zkouška', 'sv4-channel-test', { channel: 'email' }, 'ghost')}${btn('Zahodit rozepsané změny', 'sv4-channel-revert', { channel: 'email' }, 'small ghost')}</div></form>`;
  } else body = `<p class="help">${ch.kind === 'desktop' ? 'Oznámení na ploše jsou vestavěný kanál tohoto zařízení. Nemají cíl ani přihlašovací údaje; zapnutí řídí backend.' : 'Kanál je nastavený v prostředí backendu a v IDE nemá upravitelné parametry.'}</p><div class="toolbar">${btn('Zkouška', 'sv4-channel-test', { channel: ch.id }, 'ghost')}</div>`;
  return `<section class="card sv2-inline-panel" id="sv4-channel-editor">${header}${body}<p class="help">Editor i zkouška zůstávají na této stránce. Účty Discordu a Telegramu se zakládají v Účtech a propojení.</p></section>`;
}
function notifications(c) {
  const list = channels(c), oz = smData(c, 'oznameni');
  const log = c.data('notifLog')?.entries || [];
  const row = ch => {
    const actions = ch.kind === 'missing' ? btn('Propojit účet', 'sv4-account-new', { provider: ch.provider }, 'small primary')
      : btn('Parametry', 'sv4-channel-edit', { channel: ch.id }, 'small') + btn('Zkouška', 'sv4-channel-test', { channel: ch.id }, 'small ghost');
    return c.s.layout === 'grid'
      ? `<article class="card sv2-channel-tile"><div class="card-head"><span class="sv2-service-icon">${icon(ch.icon)}</span>${tag(...ch.status)}</div><h3>${e(ch.name)}</h3><p class="muted">${e(ch.target)}</p><p class="help">${eventsText(ch.events)}</p><div class="toolbar">${actions}</div></article>`
      : `<div class="sv2-service-row sv2-notification-row"><span class="sv2-service-icon">${icon(ch.icon)}</span><div class="sv2-grow"><strong>${e(ch.name)}</strong><small class="muted">${e(ch.target)}</small><span class="help">${eventsText(ch.events)}</span></div><span class="sv2-service-status">${tag(...ch.status)}</span><div class="sv2-row-actions">${actions}</div></div>`;
  };
  const deliveredBy = key => list.filter(ch => ch.active && ch.events.includes(key)).map(ch => ch.name);
  const activeCount = list.filter(ch => ch.active).length;
  return intro('Oznámení', 'Kanály upravíte přímo na stránce; zkouška odešle skutečnou testovací zprávu po potvrzení.') + status(c, { sm: ['oznameni'] })
    + `<div class="sv2 stack"><section class="card"><div class="card-head"><h2>Kanály doručování</h2>${tag(pl(activeCount, 'aktivní', 'aktivní', 'aktivních'), 'gold')}</div>${oz ? c.s.layout === 'grid' ? `<div class="sv2-item-grid" data-layout="grid">${list.map(row).join('')}</div>` : `<div class="sv2-service-row sv2-column-head" aria-hidden="true"><span></span><span>Kanál / cíl</span><span>Stav</span><span>Akce</span></div>${list.map(row).join('')}` : ''}</section>${channelEditor(c)}`
    + `<div class="grid2"><section class="card"><h2>Pravidla podle událostí</h2>${EVENTS.map(([key, text, hint]) => { const by = deliveredBy(key); return `<div class="provider"><div><strong>${e(text)}</strong><div class="cell-sub">${e(hint)}</div></div>${by.length ? tag(by.join(', '), 'green') : tag('Žádný aktivní kanál')}</div>`; }).join('')}<p class="help">Události se volí u každého kanálu v jeho parametrech. Tichý čas a globální výjimky backend zatím nepodporuje, proto je zde IDE nenabízí.</p></section>`
    + `<section class="card"><h2>Poslední doručení</h2>${log.length ? `<div class="sv2-delivery-log">${log.slice(0, 6).map(entry => `<div>${icon(entry.delivered ? 'check' : 'close')}<span><strong>${e(entry.title || 'Oznámení')}</strong><small>${e(entry.channel)}${entry.recipient ? ' · ' + e(entry.recipient) : ''} · ${e(date(entry.created_at ? entry.created_at.replace(' ', 'T') + 'Z' : null))}</small></span>${tag(entry.delivered ? 'Doručeno' : 'Nedoručeno', entry.delivered ? 'green' : 'red')}</div>`).join('')}</div>` : c.resource('notifLog').status === 'error' ? '<div class="empty">Historii doručení se nepodařilo načíst.</div>' : '<div class="empty">Zatím žádné doručení.<p class="help">Po zkoušce nebo skutečné události se tu objeví výsledek z backendu.</p></div>'}<p class="help">Záznam ukazuje, co backend skutečně odeslal. Propojený účet sám o sobě oznámení nezapíná.</p></section></div></div>`;
}
async function sendChannelTest(c, id) {
  const ch = channels(c).find(x => x.id === id);
  if (!ch || !ch.testable) return;
  if (ch.kind === 'account') {
    const before = c.sm.notices.get('oznameni');
    const ok = await c.sm.testAccount('oznameni', ch.account);
    const text = c.sm.notices.get('oznameni');
    if (text !== before && text) c.s.lastDelivery = { channel: id, result: ok ? 'Doručeno' : 'Doručení neověřeno', explanation: text };
    c.load('notifLog', true); c.render(true); return;
  }
  const channel = ch.kind === 'desktop' ? 'desktop' : ch.kind === 'email' ? 'email' : ch.channel;
  const recipient = ch.kind === 'email' ? smData(c, 'oznameni').email.emailRecipient : undefined;
  if (!await c.confirm(`Odeslat skutečnou testovací zprávu přes kanál ${ch.name}${recipient ? ' příjemci ' + recipient : ''}?`, { title: 'Zkouška doručení', ok: 'Odeslat zkoušku' })) return;
  await c.run('test', 'Zkouška doručení', async () => {
    try {
      const result = await c.api('POST', '/api/notifications/test', { channel, ...(recipient ? { recipient } : {}) });
      c.s.lastDelivery = { channel: id, result: result?.ok === false ? 'Nedoručeno' : 'Odesláno', explanation: result?.ok === false ? String(result.error || 'Backend doručení odmítl.') : 'Backend kanál ověřil a zprávu odeslal. Doručení na zařízení potvrďte u příjemce.' };
    } catch (err) {
      c.s.lastDelivery = { channel: id, result: 'Nedoručeno', explanation: err.message || err.code };
      throw err;
    } finally { c.load('notifLog', true); }
  }, 'Zkouška doručení odeslána.');
}
async function saveEmail(c) {
  const form = c.form('sv4-channel-form');
  if (!form) return;
  const v = new FormData(form), port = Number(v.get('ntf-smtp-port'));
  const patch = { smtpHost: String(v.get('ntf-smtp-host') || '').trim(), smtpPort: port, smtpFrom: String(v.get('ntf-smtp-from') || '').trim(),
    emailRecipient: String(v.get('ntf-email-to') || '').trim(), emailEnabled: v.has('ntf-active'), emailOnWorker: v.has('ntf-event-worker'), emailOnLifecycle: v.has('ntf-event-lifecycle') };
  if (!Number.isInteger(port) || port < 1 || port > 65535) { c.toast('Port SMTP musí být 1–65535.'); return; }
  if (patch.emailRecipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.emailRecipient)) { c.toast('Zadejte platnou adresu příjemce.'); return; }
  if (patch.emailEnabled && (!patch.smtpHost || !patch.emailRecipient)) { c.toast('Aktivní e-mail potřebuje SMTP server a příjemce.'); return; }
  const ok = await c.run('email', 'Nastavení e-mailu', async () => {
    await c.api('POST', '/api/notifications/config', patch);
    const after = await c.api('GET', '/api/notifications/config');
    if (!Object.entries(patch).every(([key, value]) => after[key] === value)) throw Object.assign(Error('Uložené hodnoty se po zpětném čtení liší'), { status: 500 });
  }, 'E-mailový kanál uložen a ověřen zpětným čtením.');
  if (ok) { c.clearDrafts('ntf-'); await c.sm.load('oznameni', true); c.render(true); }
}

// ---------- úložiště ----------
const LOCATIONS = { projects: ['Projekty', 'folder', 'Výchozí složka pro nové projekty. Existující projekty zůstávají na svých místech.'], models: ['Lokální modely', 'models', 'Úložiště modelů spravuje služba Ollama (OLLAMA_MODELS).'], data: ['Data aplikace', 'database', 'Databáze, historie a lokální konfigurace backendu.'], backups: ['Zálohy', 'clock', 'Archivy záloh stavu backendu.'] };
const MANAGEMENT = { LIVE_DEFAULT: ['Lze změnit zde', 'green'], PROVIDER_ENVIRONMENT_REQUIRES_RESTART: ['Spravuje Ollama · vyžaduje restart služby', 'gold'], INSTALLATION_MANAGED: ['Spravuje instalace', ''] };
function capacity(d) {
  if (!Number.isFinite(d.totalBytes) || !d.totalBytes) return '<p class="muted">Kapacita není zjištěná.</p>';
  const percent = Math.round(d.usedBytes / d.totalBytes * 100);
  return `<div class="sv2-capacity ${percent >= 90 ? 'sv2-capacity-high' : ''}"><div><strong>${percent} % obsazeno</strong><span class="muted">${bytes(d.freeBytes)} volné</span></div><progress value="${d.usedBytes}" max="${d.totalBytes}" aria-label="${e(d.mountPoint)}: ${percent} % obsazeno"></progress><div class="help">${bytes(d.usedBytes)} / ${bytes(d.totalBytes)} · zjištěno ${e(date(c0(d.observedAt)))}</div></div>`;
}
const c0 = v => v || null;
function diskName(d) { return d.mountPoint === '/' ? 'Systémový disk' : d.mountPoint.startsWith('/home') ? 'Domovská data' : 'Disk ' + d.mountPoint; }
function storage(c) {
  const u = smData(c, 'uloziste'), inv = u?.inventory, grid = c.s.layout === 'grid', sys = c.data('storage');
  const disks = inv?.disks || [], locations = inv?.locations || [], dbs = inv?.databases || [];
  const diskOf = mount => disks.find(d => d.mountPoints?.includes(mount) || d.mountPoint === mount);
  const volumeItems = disks.map(d => `<section class="card sv2-volume-item" data-item-id="${e(d.deviceId)}"><div><div class="card-head"><h3>${icon('database')} ${e(diskName(d))}</h3>${tag(d.type)}</div><p class="muted">${e(d.source || 'Zařízení nezjištěno')}</p><div class="mono sv2-path">${e((d.mountPoints || [d.mountPoint]).join(' · '))}</div></div>${d.status === 'OBSERVED' ? capacity({ ...d, observedAt: inv.generatedAt }) : '<p class="muted">Svazek není dostupný.</p>'}<div class="toolbar">${btn('Podrobnosti svazku', 'sv4-volume-detail', { volume: d.deviceId }, 'small ghost')}</div></section>`).join('');
  const pathItems = locations.map(l => {
    const [label, ic, help] = LOCATIONS[l.kind] || [l.kind, 'folder', ''], mgmt = MANAGEMENT[inv.pathManagement?.[l.kind]] || null;
    const editable = l.kind === 'projects' && inv.pathManagement?.projects === 'LIVE_DEFAULT';
    return `<section class="card"><div class="card-head"><h3>${icon(ic)} ${e(label)}</h3>${editable ? btn('Změnit…', 'sv4-path-change', { path: l.kind }, 'small') : mgmt ? tag(mgmt[0], mgmt[1]) : ''}</div><div class="mono sv2-path">${e(l.path || 'Neznámé umístění')}</div><p class="help">${e(help)} ${l.status === 'COMPLETE' ? `Obsahuje ${bytes(l.bytes)} v ${pl(l.entries, 'položce', 'položkách', 'položkách')} · disk ${e(l.mountPoint)}.` : l.status === 'MISSING' ? 'Složka zatím neexistuje.' : 'Velikost nebyla zjištěna.'}</p></section>`;
  }).join('');
  const dbItems = dbs.map(db => {
    const d = diskOf(db.path.startsWith('/home') ? '/home' : '/') || disks[0];
    return `<section class="card sv2-db-item" data-item-id="${e(db.name)}"><div class="card-head"><div><h3>${icon('database')} ${db.name === 'main' ? 'Hlavní data aplikace' : e(db.name)}</h3><p class="help">Konverzace, projekty, modely, nastavení a audit</p></div>${tag(`${db.engine} ${db.version}`, 'gold')}</div><div class="${grid ? 'stack' : 'grid2'}"><div class="sv2-grow"><div class="mono sv2-path">${e(db.path)}</div>${meta([['DB / WAL', `${bytes(db.allocatedBytes)} / ${bytes(db.walBytes)}`], ['Tabulky', num(db.tableCount)], ['Režim žurnálu', String(db.journalMode || '—').toUpperCase()], ['Stránky', `${num(db.pageSize)} B · volných ${num(db.freePages)}`]])}</div><div>${d ? capacity({ ...d, observedAt: inv.generatedAt }) : '<p class="muted">Disk nezjištěn.</p>'}<p class="help">Zaplnění disku s touto databází.</p></div></div><div class="toolbar">${btn('Podrobnosti a využití', 'sv4-db-detail', { db: db.name }, 'small')}${btn('Optimalizovat databázi…', 'sv4-db-vacuum', { db: db.name }, 'small ghost', c.isBusy('vacuum') ? 'disabled' : '')}</div></section>`;
  }).join('');
  const settings = c.data('storageSettings');
  const retention = settings ? `<section class="card section-gap"><div class="card-head"><div><h2>Retence provozních dat</h2><p class="help">Backend pravidelně maže starší provozní záznamy podle těchto lhůt. Konverzace a paměť nastavíte v kategorii Paměť.</p></div>${tag('Platí při příštím úklidu')}</div><form id="sv4-retention-form"><div class="grid3">${[['llm_logs', 'Záznamy volání modelů', 1, 365], ['agent_logs', 'Záznamy workerů', 1, 365], ['telemetry', 'Telemetrie modelů', 1, 365], ['audit_events', 'Auditní události', 14, 3650], ['quality_scores', 'Skóre kvality', 14, 365], ['soft_delete_grace', 'Koš (smazané položky)', 1, 365]].map(([key, label, min, max]) => H.labeled(label + ' · dny', 'sto-ret-' + key, `<input type="number" id="sto-ret-${key}" name="${key}" min="${min}" max="${max}" value="${e(settings.retention?.[key])}">`)).join('')}</div><div class="setting-footer">${btn('Uložit retenci', 'sv4-retention-save', {}, 'primary', 'data-submit')}</div></form></section>` : '';
  return intro('Úložiště a databáze', 'Disky, umístění dat a databáze. Seznam a dlaždice přepíná společné ovládání v horní liště.', btn('Obnovit přehled', 'sv4-storage-refresh', {}, 'small'))
    + status(c, { sm: ['uloziste'] })
    + (inv ? `<div class="sv2">${H.sectionTitle('Disky a svazky', tag(pl(disks.length, 'svazek', 'svazky', 'svazků'), 'gold'))}<div class="${grid ? 'sv2-item-grid' : 'sv2-item-list sv2-volume-list'}" data-layout="${grid ? 'grid' : 'list'}">${volumeItems}</div>${H.sectionTitle('Umístění dat')}<div class="${grid ? 'sv2-item-grid' : 'sv2-item-list'}">${pathItems}</div>${H.sectionTitle('Databáze', sys ? tag(`${num(sys.history?.conversations)} konverzací v historii · ${num(sys.history?.total_mb, 1)} MiB`) : '')}<div class="${grid ? 'sv2-item-grid' : 'sv2-item-list'}" data-layout="${grid ? 'grid' : 'list'}">${dbItems}</div>${retention}</div>` : '');
}
function pathModal(c, key) {
  const u = smData(c, 'uloziste');
  if (!u || key !== 'projects') return;
  const current = u.paths.projects;
  c.H.modal('Umístění: Projekty', `${H.labeled('Nová výchozí složka', 'sto-path', H.input('sto-path', current, 'required maxlength="4096" class="mono"'), 'Existující absolutní složka. Změní jen výchozí umístění nových projektů; existující projekty ani soubory se nepřesouvají.')}<p class="validation" data-sv4-error role="status"></p>`, 'Prohlédnout změnu', form => {
    const next = String(new FormData(form).get('sto-path') || '').trim();
    if (!H.validPath(next) || next === '/') return error(form, 'Zadejte absolutní cestu bez segmentu „..“.');
    if (next === current) return error(form, 'Cesta je stejná jako současná.');
    c.closeModal();
    c.H.modal('Náhled změny', `${meta([['Oblast', 'Projekty'], ['Původní cesta', current], ['Nová cesta', next], ['Přesun souborů', 'Žádný – mění se jen výchozí složka']])}<ol class="sv2-plan"><li>Backend ověří, že složka existuje a je přístupná.</li><li>Nové projekty a průvodce použijí novou složku.</li><li>Stávající projekty zůstanou na svých místech.</li></ol>`, 'Uložit cestu', async () => {
      const ok = await smSave(c, 'uloziste', () => c.sm.editor('uloziste', 'paths', u.paths, { projects: current }), { projects: next });
      if (ok) { c.sm.load('git', true); c.clearDrafts('rep-'); }
      return true;
    });
    return false;
  });
}
async function saveRetention(c) {
  const form = c.form('sv4-retention-form');
  if (!form || !form.reportValidity()) return;
  const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, Number(v)]));
  const ok = await c.run('retention', 'Retence provozních dat', async () => {
    const current = await c.api('GET', '/api/system/storage/settings');
    const next = { ...current, retention: { ...current.retention, ...values } };
    await c.api('PUT', '/api/system/storage/settings', next);
    const after = await c.api('GET', '/api/system/storage/settings');
    if (!Object.entries(values).every(([k, v]) => after.retention[k] === v)) throw Object.assign(Error('Backend upravil hodnoty do povoleného rozsahu; zkontrolujte je'), { status: 422 });
    c.res.set('storageSettings', { status: 'ready', data: after });
  }, 'Retence uložena a ověřena zpětným čtením.');
  if (ok) c.clearDrafts('sto-ret-');
}

// ---------- zálohy ----------
function backupItems(c, list) {
  const note = b => `<div class="sv2-note">${e(b.note || 'Bez poznámky')}</div>${btn(b.note ? 'Upravit' : '+ Poznámka', 'sv4-backup-note', { backup: b.name }, 'small ghost')}`;
  const archive = b => btn(b.archived ? 'Zrušit archivaci' : 'Archivovat', 'sv4-backup-archive', { backup: b.name }, b.archived ? 'small primary' : 'small ghost');
  const remove = b => btn('Smazat…', 'sv4-backup-delete', { backup: b.name }, 'small danger', b.archived || list.length <= 1 ? `disabled title="${b.archived ? 'Archivovanou zálohu nejprve odarchivujte.' : 'Poslední zálohu backend chrání.'}"` : '');
  const title = b => `<button type="button" class="link-button" data-action="sv4-backup-detail" data-backup="${e(b.name)}">${e(date(b.created_at))}</button><div class="cell-sub mono">${e(b.name.replace(/^intentsmith-state-/, '').replace(/\.backup$/, ''))} · verze ${e(b.version)} · schéma ${e(b.schema_version)}</div>`;
  const scope = b => `${pl(b.sections.length, 'oblast', 'oblasti', 'oblastí')} · ${num(b.total_size_mb, 1)} MiB<div class="sv2-tags help">${b.sections.map(id => tag(SECTIONS.find(x => x[0] === id)?.[1] || id)).join(' ')}${b.restorable ? '' : ' ' + tag('Nelze obnovit', 'red')}</div>`;
  if (c.s.layout === 'grid') return `<div class="sv2-item-grid" data-layout="grid">${list.map(b => `<article class="card sv2-backup-item"><div class="card-head"><h3>${title(b)}</h3>${tag(b.archived ? 'Archiv' : 'Běžná', 'gold')}</div><div class="help">${scope(b)}</div><div class="divider"></div>${note(b)}<div class="toolbar section-gap">${archive(b)}${remove(b)}</div></article>`).join('')}</div>`;
  return `<div class="table-wrap" data-layout="list"><table class="data-table"><thead><tr><th>Záloha</th><th>Poznámka</th><th>Rozsah / velikost</th><th>Archiv</th><th>Akce</th></tr></thead><tbody>${list.map(b => `<tr><td>${title(b)}</td><td>${note(b)}</td><td>${scope(b)}</td><td>${archive(b)}</td><td>${remove(b)}</td></tr>`).join('')}</tbody></table></div>`;
}
function backups(c) {
  const z = smData(c, 'zalohy'), u = smData(c, 'uloziste');
  const list = (z?.backups || []).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const p = z?.backupPolicy, preview = c.s.retentionPreview;
  const location = u?.inventory?.locations?.find(l => l.kind === 'backups');
  const sections = c.s.backupSections || ['database', 'config', 'skills', 'specialists'];
  const plan = p ? `<form id="sv4-backup-form"><h3>Kdy zálohovat</h3>${H.check('bak-startup', 'Při spuštění backendu', p.on_startup, 'Platí od dalšího skutečného spuštění.')}${H.check('bak-shutdown', 'Při ukončení backendu', p.on_shutdown)}<div class="grid2">${H.labeled('Běžných záloh (mimo neděli)', 'bak-daily', `<input type="number" id="bak-daily" name="bak-daily" min="1" max="30" value="${p.max_daily}" required>`)}${H.labeled('Nedělních záloh', 'bak-weekly', `<input type="number" id="bak-weekly" name="bak-weekly" min="1" max="12" value="${p.max_weekly}" required>`)}</div><div class="toolbar">${btn('Uložit pravidla', 'sv4-backup-save', {}, 'primary', 'data-submit')}${btn('Náhled úklidu', 'sv4-backup-preview')}</div></form><p class="help">Uložení pravidel nic nemaže. Při příštím automatickém úklidu backend zachová zadaný počet nearchivovaných záloh; archivované se do úklidu nepočítají.</p>` : '';
  return intro('Zálohy a archiv', 'Poznámky, rozsah zálohy a předem viditelný návrh úklidu.', btn('+ Vytvořit zálohu', 'sv4-backup-create', {}, 'primary', z && !c.isBusy('backup') ? '' : 'disabled'))
    + status(c, { sm: ['zalohy'] })
    + (z ? `<div class="sv2"><div class="grid2"><section class="card"><h2>Plán a limity</h2>${plan}</section><section class="card"><h2>Co znamená Archivovat</h2><p>Archivovaná záloha se vyřadí z automatického úklidu podle počtu. Zůstává viditelná a lze k ní přidat poznámku.</p>${meta([['Archivované položky', list.filter(b => b.archived).length], ['Navržené k úklidu', preview ? preview.length : 'Zobrazí náhled úklidu'], ['Automatické mazání', 'Jen nearchivované nad limit'], ['Umístění', location?.path || '—']])}<div class="sv2-summary-box"><strong>${preview ? preview.length ? pl(preview.length, 'položka v návrhu úklidu', 'položky v návrhu úklidu', 'položek v návrhu úklidu') : 'Žádná položka nevyžaduje úklid' : 'Náhled úklidu ještě nebyl spuštěn'}</strong><p class="help">Každé ruční smazání vybírá konkrétní zálohu. Archivaci lze kdykoli zrušit.</p></div><h3>Rozsah nové zálohy</h3><div class="sv2-tags">${sections.map(id => tag(SECTIONS.find(x => x[0] === id)?.[1] || id)).join(' ')}</div><p class="help">Rozsah zvolíte při vytvoření. Projektové složky a Git repozitáře mají vlastní zálohování; obnova databáze probíhá při zastaveném backendu.</p></section></div>${H.sectionTitle(`Zálohy · ${list.length}`, tag(num(list.reduce((n, b) => n + (b.total_size_mb || 0), 0), 0) + ' MiB celkem', 'gold'))}${list.length ? backupItems(c, list) : H.empty('Zatím žádná záloha.')}`
    + `<section class="card section-gap"><div class="card-head"><div><h2>Nastavení aplikace · export a import</h2><p class="help">Uživatelské volby v JSON. Import nahradí současné volby až po potvrzení a ověří výsledek zpětným čtením.</p></div></div><div class="toolbar">${btn('Exportovat nastavení', 'sv4-settings-export')}<label class="button">${icon('download')} Importovat ze souboru…<input type="file" id="bak-import-file" accept=".json,application/json" data-change="sv4-settings-import" hidden></label></div></section></div>` : '');
}
function backupByName(c, name) { return smData(c, 'zalohy')?.backups.find(b => b.name === name); }
async function retentionPreview(c) {
  const form = c.form('sv4-backup-form');
  if (!form || !form.reportValidity()) return;
  const daily = Number(c.value('bak-daily')), weekly = Number(c.value('bak-weekly'));
  try {
    const preview = await c.api('POST', '/api/system/backups/retention-preview', { maxDaily: daily, maxWeekly: weekly });
    c.s.retentionPreview = preview.deletions || [];
    c.H.modal('Náhled úklidu · bez smazání', `<p>Limity: ${pl(daily, 'běžná záloha', 'běžné zálohy', 'běžných záloh')} a ${pl(weekly, 'nedělní', 'nedělní', 'nedělních')}. Archivované zálohy se nepočítají.</p>${preview.deletions.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Záloha</th><th>Vytvořeno</th></tr></thead><tbody>${preview.deletions.map(b => `<tr><td class="mono">${e(b.name)}</td><td>${e(date(b.created_at || backupByName(c, b.name)?.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p>Žádná záloha nepřekračuje limity.</p>'}<p class="help">Náhled nic neodstraní. Platí pro současné zálohy; nové zálohy mohou výběr změnit.</p>`, null);
    c.render(true);
  } catch (err) { c.toast('Náhled úklidu se nepodařilo získat: ' + (err.message || err.code)); }
}
function createBackupModal(c) {
  c.H.modal('Vytvořit zálohu', `<p class="help">Vznikne nový archiv stavu backendu. Databáze je povinná; ostatní oblasti můžete vynechat.</p>${SECTIONS.map(([id, label, hint]) => H.check('bak-new-' + id, label, true, hint, id === 'database' ? 'disabled' : '')).join('')}${H.labeled('Poznámka', 'bak-new-note', H.input('bak-new-note', '', 'maxlength="2000" placeholder="Např. Před úpravou modelů"'))}<p class="validation" data-sv4-error role="status"></p>`, 'Vytvořit zálohu', async form => {
    const v = new FormData(form), values = { note: String(v.get('bak-new-note') || '').trim() };
    for (const [id] of SECTIONS) values['section_' + id] = id === 'database' || v.has('bak-new-' + id);
    c.s.backupSections = SECTIONS.filter(([id]) => values['section_' + id]).map(([id]) => id);
    c.closeModal();
    c.busy.add('backup'); c.render(true);
    try { await smSave(c, 'zalohy', () => c.sm.editor('zalohy', 'create-backup', null, { note: '', section_database: true, section_config: true, section_skills: true, section_specialists: true }), values); }
    finally { c.busy.delete('backup'); c.render(true); }
    return false;
  });
}
function backupDetail(c, name) {
  const b = backupByName(c, name);
  if (!b) return;
  c.H.modal('Manifest zálohy', `${meta([['Vytvořeno', date(b.created_at)], ['Soubor', b.name], ['Verze aplikace / schéma', `${b.version} / ${b.schema_version}`], ['Formát', 'v' + b.format_version], ['Velikost DB / celkem', `${num(b.db_size_mb, 1)} / ${num(b.total_size_mb, 1)} MiB`], ['Archiv', b.archived ? 'Mimo automatický úklid' : 'Běžná položka'], ['Poznámka', b.note || 'Bez poznámky']])}<h3>Obsah</h3><div class="sv2-tags">${b.sections.map(id => tag(SECTIONS.find(x => x[0] === id)?.[1] || id)).join(' ')}</div><h3>Otisky</h3>${meta([['Obsah', b.content_fingerprint || '—'], ['Migrace', b.migration_fingerprint || '—']])}<p class="help mono sv2-path">${e(b.path || '')}</p><div class="toolbar">${btn('Poznámka', 'sv4-backup-note', { backup: name })}${btn('Postup obnovy', 'sv4-backup-restore', { backup: name })}</div>`, null);
}
function restoreModal(c, name) {
  const b = backupByName(c, name);
  if (!b) return;
  c.H.modal('Postup obnovy', `<div class="sv2-tags">${(b.restore_scope || []).map(id => tag(SECTIONS.find(x => x[0] === id)?.[1] || id)).join(' ')}</div><ol class="sv2-plan"><li>Ukončete IDE a zastavte backendovou službu (systemctl --user stop intentsmith-backend).</li><li>Obnovu provede nástroj backendu nad touto zálohou; nejdřív vytvoří zálohu současného stavu.</li><li>Obnoví se jen databáze (${b.restorable ? 'záloha je obnovitelná' : 'tuto zálohu nelze obnovit'}).</li><li>Po spuštění backendu ověřte data a návrat aplikace.</li></ol><p class="help">Obnova databáze za běhu není podporovaná, proto ji IDE nespouští. Soubor: <span class="mono">${e(b.path || b.name)}</span></p>`, null);
}
function noteModal(c, name) {
  const b = backupByName(c, name);
  if (!b) return;
  c.closeAllModals();
  c.H.modal('Poznámka k záloze', `<p class="help">${e(date(b.created_at))} · ${e(b.name)}</p>${H.labeled('Poznámka', 'bak-note', `<textarea id="bak-note" name="bak-note" maxlength="2000" rows="4">${e(b.note)}</textarea>`)}<p class="validation" data-sv4-error role="status"></p>`, 'Uložit poznámku', async form => {
    const note = String(new FormData(form).get('bak-note') || '').trim();
    const ok = await smSave(c, 'zalohy', () => c.sm.editor('zalohy', 'backup', b, { note: b.note, archived: b.archived }), { note, archived: b.archived });
    return ok ? true : error(form, c.sm.notices.get('zalohy') || 'Poznámku se nepodařilo uložit.');
  });
}
async function exportSettings(c) {
  try {
    const settings = await c.api('GET', '/api/settings');
    const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
    const a = c.el.ownerDocument.createElement('a');
    a.href = url; a.download = 'intentsmith-nastaveni-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    c.toast('Soubor nastavení je připravený ke stažení.');
  } catch (err) { c.toast('Export nastavení selhal: ' + (err.message || err.code)); }
}
async function importSettings(c, input) {
  const file = input?.files?.[0];
  input.value = '';
  if (!file) return;
  let settings;
  try {
    if (file.size > 1024 * 1024) throw Error('Vyberte JSON soubor do 1 MiB.');
    settings = JSON.parse(await file.text());
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).length > 5000) throw Error('Soubor neobsahuje platný dokument nastavení.');
    if (settings.models && typeof settings.models === 'object' && ['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays'].some(k => Object.hasOwn(settings.models, k))) throw Error('Modelová automatizace se importuje samostatně. Odeberte její klíče ze souboru.');
  } catch (err) { c.toast(err.message || 'Soubor nelze přečíst.'); return; }
  if (!await c.confirm(`Importovat nastavení ze souboru ${file.name} (${pl(Object.keys(settings).length, 'položka', 'položky', 'položek')})? Současné uživatelské volby budou nahrazeny.`, { title: 'Import nastavení', ok: 'Importovat', danger: true })) return;
  await c.run('import', 'Import nastavení', async () => {
    const result = await c.api('POST', '/api/settings/import', { version: 1, settings });
    if (result?.ok !== true) throw Object.assign(Error('Backend import nepotvrdil'), { status: 500 });
    const after = await c.api('GET', '/api/settings');
    if (JSON.stringify(after) !== JSON.stringify(settings)) throw Object.assign(Error('Import mohl proběhnout, ale výsledek nelze ověřit'), { status: 500 });
    c.load('settings', true); c.sm.load('zalohy', true);
  }, 'Import ověřen zpětným čtením backendu.');
}

// ---------- repozitáře a přístupy ----------
function repositories(c) {
  const g = smData(c, 'git'), u = smData(c, 'uloziste'), profiles = g?.profiles || [], repos = g?.repositories || [];
  const byId = sshHosts(g), grid = c.s.layout === 'grid';
  const remoteOf = r => { const origin = r.remotes.find(m => m.name === 'origin') || r.remotes[0]; return origin ? { name: origin.name, url: origin.url, web: origin.url ? remoteWebUrl(origin.url) : '', denied: origin.status === 'REMOTE_DENIED' } : null; };
  const profileOf = r => r.profile?.sshProfileId ? byId.get(r.profile.sshProfileId) : null;
  const address = r => { const m = remoteOf(r); return !m ? '<span class="muted">Bez vzdáleného repozitáře</span>' : m.denied ? `<span class="muted">${e(m.name)}: adresa skryta – obsahuje přihlašovací údaje</span>` : `<input class="sv2-repo-address mono" id="rep-address-${e(r.id)}" aria-label="Adresa ${e(r.name)}" readonly value="${e(m.web || m.url)}" data-live>${btn('Zkopírovat adresu', 'sv4-repo-copy', { repo: r.id }, 'small ghost')}<div class="help">${m.web ? 'Úplná HTTPS adresa pro prohlížeč.' : 'Adresa vzdáleného repozitáře (' + e(m.name) + ').'}</div>`; };
  const access = r => { const p = profileOf(r); return p ? `${e(p.name)}<div class="cell-sub">SSH · ${e(p.user)}@${e(p.host)}${p.port === 22 ? '' : ':' + p.port}</div>` : `Bez profilu<div class="cell-sub">Systémový SSH agent a Git konfigurace</div>`; };
  const state = r => r.status === 'OBSERVED' ? remoteOf(r) ? tag('Git · vzdálený', 'green') : tag('Git · jen lokálně') : tag('Složka nedostupná', 'red');
  const registry = grid ? `<div class="sv2-item-grid" data-layout="grid">${repos.map(r => `<article class="card sv2-repo-tile"><div class="card-head"><h3>${icon('git')} ${e(r.name)}</h3>${btn('Nastavit', 'sv4-repo-edit', { repo: r.id }, 'small', r.status === 'OBSERVED' ? '' : 'disabled')}</div><div class="cell-sub mono sv2-path">${e(r.path)}</div>${address(r)}${meta([['Přístupový profil', profileOf(r)?.name || 'Bez profilu']])}<div class="toolbar">${state(r)}</div></article>`).join('')}</div>`
    : `<div class="table-wrap"><table class="data-table"><thead><tr><th>Repozitář / lokální cesta</th><th>Adresa repozitáře</th><th>Přístupový profil</th><th>Stav</th><th></th></tr></thead><tbody>${repos.map(r => `<tr><td><strong>${e(r.name)}</strong><div class="cell-sub mono sv2-path">${e(r.path)}</div></td><td>${address(r)}</td><td>${access(r)}</td><td>${state(r)}</td><td>${btn('Nastavit', 'sv4-repo-edit', { repo: r.id }, 'small', r.status === 'OBSERVED' ? '' : 'disabled')}</td></tr>`).join('')}</tbody></table></div>`;
  const uses = p => repos.filter(r => r.profile?.sshProfileId === p.id);
  const profileList = grid ? `<div class="sv2-profile-grid">${profiles.map(p => `<article class="sv2-credential"><div class="card-head"><h3>${icon('key')} ${e(p.name)}</h3>${tag('SSH')}</div>${meta([['Identita', p.user + '@' + p.host + (p.port === 22 ? '' : ':' + p.port)], ['Klíč', p.identityFile], ['known_hosts', p.knownHostsFile]])}<p class="help">Používá: ${e(uses(p).map(r => r.name).join(', ') || 'Žádný repozitář')}</p><div class="toolbar">${btn('Detail', 'sv4-ssh-detail', { profile: p.id }, 'small ghost')}${btn('Upravit', 'sv4-ssh-edit', { profile: p.id }, 'small')}${btn('Smazat…', 'sv4-ssh-delete', { profile: p.id }, 'small danger')}</div></article>`).join('')}</div>`
    : `<div class="table-wrap" data-layout="list"><table class="data-table sv2-profile-list"><thead><tr><th>Profil</th><th>Typ / host</th><th>Identita</th><th>Soubor klíče</th><th>Používá</th><th></th></tr></thead><tbody>${profiles.map(p => `<tr><td><strong>${icon('key')} ${e(p.name)}</strong></td><td>${tag('SSH')}<div class="cell-sub">${e(p.host)}${p.port === 22 ? '' : ':' + p.port}</div></td><td>${e(p.user)}<div class="cell-sub">ověření hostitele: known_hosts</div></td><td class="mono help">${e(p.identityFile)}</td><td>${e(uses(p).map(r => r.name).join(', ') || 'Žádný repozitář')}</td><td class="sv2-cell-actions">${btn('Detail', 'sv4-ssh-detail', { profile: p.id }, 'small ghost')}${btn('Upravit', 'sv4-ssh-edit', { profile: p.id }, 'small')}${btn('Smazat…', 'sv4-ssh-delete', { profile: p.id }, 'small danger')}</td></tr>`).join('')}</tbody></table></div>`;
  const projectsPath = c.projectDirectory?.() || u?.paths?.projects || g?.defaultProjectsPath || '';
  return intro('Repozitáře a přístup', 'Úplná webová adresa, lokální umístění a přístupové profily SSH.', btn('+ Přidat repozitář', 'sv4-repo-add', {}, 'primary'))
    + status(c, { sm: ['git'] })
    + `<div class="sv2 stack"><section class="card"><h2>Výchozí cesta pro nové repozitáře</h2><p class="help">Nové projekty a klonované repozitáře vznikají v této složce. Pracovní změny, historie a PR patří do projektu.</p><form id="sv4-repo-path-form"><div class="sv2-form-inline">${H.labeled('Výchozí složka', 'rep-path', H.input('rep-path', projectsPath, 'required maxlength="4096" class="mono"'))}${btn('Uložit', 'sv4-repo-path-save', {}, '', u ? 'data-submit' : 'disabled')}</div></form></section>`
    + `<section class="card"><div class="card-head"><h2>Registrované repozitáře</h2>${tag(pl(repos.length, 'repozitář', 'repozitáře', 'repozitářů'))}</div>${repos.length ? registry : H.empty('Žádný projekt zatím nemá Git repozitář.', 'Otevřete existující složku s repozitářem, nebo inicializujte Git v detailu projektu.')}<p class="help">Kopírování používá schránku. Adresy s vloženým tokenem nebo heslem IDE nezobrazuje.</p></section>`
    + `<section class="card"><div class="card-head"><div><h2>Přístupové profily</h2><p class="help">SSH profil odkazuje na soubor klíče a known_hosts na disku. Obsah soukromého klíče ani HTTPS token se do IDE nevkládá.</p></div>${btn('+ SSH profil', 'sv4-ssh-new', {}, 'primary')}</div>${profiles.length ? profileList : H.empty('Zatím žádný SSH profil.', 'Bez profilu Git použije systémový SSH agent a ~/.ssh/config.')}${sshEditor(c)}</section></div>`;
}
function sshEditor(c) {
  const ed = c.s.sshEditor;
  if (!ed) return '';
  const g = smData(c, 'git'), p = ed.id ? g?.profiles.find(x => x.id === ed.id) : null;
  const d = p || { name: '', host: ed.host || 'github.com', user: 'git', port: 22, identityFile: '', knownHostsFile: '' };
  const home = (smData(c, 'uloziste')?.paths?.projects || '').match(/^\/home\/[^/]+/)?.[0] || '~';
  return `<section class="card sv2-inline-panel section-gap" id="sv4-ssh-editor"><div class="card-head"><div><div class="eyebrow">SSH profil · odkazy na soubory</div><h2>${p ? 'Upravit SSH profil' : 'Přidat SSH profil'}</h2></div>${btn('Zavřít editor', 'sv4-ssh-cancel', {}, 'small ghost')}</div><form id="sv4-ssh-form"><div class="grid2">${H.labeled('Název profilu', 'ssh-name', H.input('ssh-name', d.name, 'required maxlength="200" placeholder="Osobní GitHub"'))}${H.labeled('SSH host', 'ssh-host', H.input('ssh-host', d.host, 'required maxlength="253" class="mono"'))}</div><div class="grid2">${H.labeled('Uživatel', 'ssh-user', H.input('ssh-user', d.user, 'required maxlength="64" class="mono"'), 'Pro GitHub a GitLab je to „git“.')}${H.labeled('Port', 'ssh-port', `<input type="number" id="ssh-port" name="ssh-port" min="1" max="65535" value="${e(d.port)}">`)}</div>${H.labeled('Soubor soukromého klíče', 'ssh-key', H.input('ssh-key', d.identityFile, `required maxlength="4096" class="mono" placeholder="${e(home)}/.ssh/id_ed25519"`), 'Absolutní cesta. Backend ověří, že soubor existuje a má bezpečná oprávnění (600).')}${H.labeled('Soubor known_hosts', 'ssh-known', H.input('ssh-known', d.knownHostsFile, `required maxlength="4096" class="mono" placeholder="${e(home)}/.ssh/known_hosts"`), 'Ověření hostitele je povinné; bez něj se připojení odmítne.')}<p class="help">Není zde pole pro obsah klíče, heslo ani HTTPS token.</p><div class="toolbar">${btn(p ? 'Uložit SSH profil' : 'Přidat SSH profil', 'sv4-ssh-save', {}, 'primary', 'data-submit')}${btn('Zrušit úpravy', 'sv4-ssh-cancel', {}, 'ghost')}</div></form></section>`;
}
async function saveSsh(c) {
  const form = c.form('sv4-ssh-form');
  if (!form || !form.reportValidity()) return;
  const v = new FormData(form), g = smData(c, 'git'), ed = c.s.sshEditor, original = ed?.id ? g?.profiles.find(p => p.id === ed.id) : null;
  const values = { name: String(v.get('ssh-name') || '').trim(), host: String(v.get('ssh-host') || '').trim().toLowerCase(), user: String(v.get('ssh-user') || '').trim(), port: Number(v.get('ssh-port')),
    identityFile: String(v.get('ssh-key') || '').trim(), knownHostsFile: String(v.get('ssh-known') || '').trim() };
  if ([values.identityFile, values.knownHostsFile].some(x => /-----BEGIN|PRIVATE KEY/i.test(x))) { c.toast('Vložte cestu k souboru, nikoli obsah klíče.'); return; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(values.host) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(values.user) || ![values.identityFile, values.knownHostsFile].every(p => /^\/[a-zA-Z0-9_./-]+$/.test(p))) {
    c.toast('Zkontrolujte host, uživatele a absolutní cesty (písmena, čísla, ., _, -, /).'); return;
  }
  if (await smSave(c, 'git', () => c.sm.openSsh(original), values)) { c.s.sshEditor = null; c.clearDrafts('ssh-'); c.render(true); }
}
function repoModal(c, id) {
  const g = smData(c, 'git'), r = g?.repositories.find(x => String(x.id) === String(id));
  if (!r) return;
  const options = [['', 'Bez profilu · systémový SSH agent'], ...g.profiles.map(p => [p.id, `${p.name} · ${p.user}@${p.host}`])];
  c.H.modal('Nastavení repozitáře', `${meta([['Projekt', r.name], ['Lokální cesta', r.path], ['Vzdálené repozitáře', r.remotes.map(m => m.name + (m.status === 'REMOTE_DENIED' ? ' (adresa skryta)' : '')).join(', ') || 'Žádné']])}${H.labeled('Přístupový profil', 'rep-profile', H.select('rep-profile', options, r.profile?.sshProfileId || ''), 'Profil se použije pro fetch, pull a schválený push tohoto projektu. Webová adresa zůstává stejná.')}<p class="help">Oprávnění k zápisu (commit, push) řídí politika Gitu v detailu projektu a každý účinek se schvaluje plánem.</p><p class="validation" data-sv4-error role="status"></p>`, 'Uložit', async form => {
    const selected = String(new FormData(form).get('rep-profile') || '');
    if (selected === (r.profile?.sshProfileId || '')) return true;
    const ok = await smSave(c, 'git', () => c.sm.editor('git', 'repository', r.profile || null, { projectId: r.id, sshProfileId: r.profile?.sshProfileId || '' }), { projectId: r.id, sshProfileId: selected });
    return ok ? true : error(form, c.sm.notices.get('git') || 'Přiřazení se nepodařilo uložit.');
  });
}
function sshDetail(c, id) {
  const g = smData(c, 'git'), p = g?.profiles.find(x => x.id === id);
  if (!p) return;
  const used = g.repositories.filter(r => r.profile?.sshProfileId === p.id);
  c.H.modal(p.name, `${meta([['Typ', 'SSH'], ['Host', p.host + ':' + p.port], ['Uživatel', p.user], ['Soubor klíče', p.identityFile], ['known_hosts', p.knownHostsFile], ['Revize', String(p.revision)], ['Používá', used.map(r => r.name).join(', ') || 'Žádný repozitář']])}<p class="help">Profil obsahuje jen odkazy na soubory. IDE nečte obsah klíče a nespouští připojení; použije ho až Git operace projektu.</p>`, null);
}
async function sshDelete(c, id) {
  const g = smData(c, 'git'), p = g?.profiles.find(x => x.id === id);
  if (!p) return;
  const used = g.repositories.filter(r => r.profile?.sshProfileId === p.id);
  if (used.length) {
    c.H.modal('Profil se používá', `<p>Profil <strong>${e(p.name)}</strong> používají: ${used.map(r => e(r.name)).join(', ')}.</p><p class="help">Nejprve výslovně změňte přiřazení těchto repozitářů. Soubor klíče se mazáním profilu nemění.</p><div class="toolbar">${used.map(r => btn('Nastavit ' + r.name, 'sv4-repo-edit', { repo: r.id }, 'small')).join('')}</div>`, null);
    return;
  }
  await smRemove(c, 'git', 'profiles', p);
}

// ---------- směrování ----------
const PAGES = { home, account, notifications, storage, backups, repositories };
function render(c, page) { return PAGES[page] ? PAGES[page](c) : general.render(c, page); }

function act(c, action, el) {
  const d = el?.dataset || {};
  switch (action) {
    case 'sv4-goto': c.navigate(d.page); return true;
    case 'sv4-profile-edit': profileModal(c); return true;
    case 'sv4-provider': providerManage(c, d.provider); return true;
    case 'sv4-account-new': c.closeAllModals(); accountModal(c, d.provider); return true;
    case 'sv4-account-edit': { const a = smData(c, 'ucet')?.accounts.find(x => x.id === d.account); if (a) { c.closeAllModals(); accountModal(c, a.provider, a); } return true; }
    case 'sv4-account-delete': { const a = smData(c, 'ucet')?.accounts.find(x => x.id === d.account); if (a) { c.closeAllModals(); smRemove(c, 'ucet', 'accounts', a).then(() => c.sm.load('oznameni', true)); } return true; }
    case 'sv4-channel-edit': case 'sv4-channel-test': {
      const ch = channels(c).find(x => x.id === d.channel);
      if (ch) { c.s.channelEditor = { id: ch.id, mode: action === 'sv4-channel-test' || ch.kind === 'desktop' || ch.kind === 'registered' ? 'test' : 'settings' }; c.render(true); c.el.querySelector('#sv4-channel-editor')?.scrollIntoView({ block: 'nearest' }); }
      return true;
    }
    case 'sv4-channel-close': c.s.channelEditor = null; c.render(true); return true;
    case 'sv4-channel-revert': c.clearDrafts('ntf-'); c.render(true); c.toast('Rozepsané parametry kanálu zahozeny.'); return true;
    case 'sv4-channel-send': sendChannelTest(c, d.channel); return true;
    case 'sv4-channel-save': {
      const ch = channels(c).find(x => x.id === d.channel), form = c.form('sv4-channel-form');
      if (!ch || ch.kind !== 'account' || !form || !form.reportValidity()) return true;
      const v = new FormData(form), a = ch.account, values = { name: a.name, provider: a.provider, credentialEnv: a.credentialEnv, recipient: String(v.get('ntf-target') || '').trim(), enabled: v.has('ntf-active') };
      for (const [key] of EVENTS) values['event_' + key] = v.has('ntf-event-' + key);
      if (a.provider === 'discord' ? !/^[0-9]{6,25}$/.test(values.recipient) : !/^(-?[0-9]{1,25}|@[a-zA-Z0-9_]{5,32})$/.test(values.recipient)) { c.toast(a.provider === 'discord' ? 'ID kanálu musí mít 6–25 číslic.' : 'Zadejte číselné ID chatu nebo @jméno.'); return true; }
      smSave(c, 'oznameni', () => c.sm.openAccount('oznameni', a), values).then(ok => { if (ok) { c.clearDrafts('ntf-'); c.render(true); } });
      return true;
    }
    case 'sv4-email-save': saveEmail(c); return true;
    case 'sv4-storage-refresh': c.sm.load('uloziste', true); c.load('storage', true); c.load('storageSettings', true); return true;
    case 'sv4-path-change': pathModal(c, d.path); return true;
    case 'sv4-volume-detail': {
      const inv = smData(c, 'uloziste')?.inventory, v = inv?.disks.find(x => x.deviceId === d.volume);
      if (v) c.H.modal(diskName(v), `${meta([['Zařízení', v.source || '—'], ['Připojení', (v.mountPoints || [v.mountPoint]).join(', ')], ['Souborový systém', v.type], ['Kapacita', bytes(v.totalBytes)], ['Obsazeno / volné', `${bytes(v.usedBytes)} / ${bytes(v.freeBytes)}`]])}${capacity({ ...v, observedAt: inv.generatedAt })}<h3>Data IntentSmithu na tomto svazku</h3>${meta(inv.locations.filter(l => (v.mountPoints || [v.mountPoint]).includes(l.mountPoint)).map(l => [(LOCATIONS[l.kind] || [l.kind])[0], l.status === 'COMPLETE' ? bytes(l.bytes) : '—']))}<p class="help">Hodnoty zjistil backend při posledním přehledu.</p>`, null);
      return true;
    }
    case 'sv4-db-detail': {
      const inv = smData(c, 'uloziste')?.inventory, db = inv?.databases.find(x => x.name === d.db), sys = c.data('storage');
      if (db) c.H.modal('Hlavní data aplikace · detail', `${meta([['Systém / verze', db.engine + ' ' + db.version], ['Umístění', db.path], ['Velikost DB / WAL', `${bytes(db.allocatedBytes)} / ${bytes(db.walBytes)}`], ['Tabulky', num(db.tableCount)], ['Režim žurnálu', String(db.journalMode).toUpperCase()]])}${sys ? `<h3>Využití dat</h3>${meta([['Konverzace v historii', num(sys.history?.conversations)], ['Historie konverzací', num(sys.history?.total_mb, 2) + ' MiB'], ['Zálohy', `${pl(sys.backups?.count || 0, 'archiv', 'archivy', 'archivů')} · ${num(sys.backups?.total_mb, 0)} MiB`], ['Poslední záloha', date(sys.backups?.last_at)]])}` : ''}<p class="help">Údaje čte backend přímo z databáze (PRAGMA) a z adresáře dat.</p>`, null);
      return true;
    }
    case 'sv4-db-vacuum':
      c.confirm('Optimalizovat databázi (VACUUM)? Během operace mohou ostatní požadavky chvíli čekat. Data se nemažou.', { title: 'Optimalizace databáze', ok: 'Optimalizovat' }).then(ok => ok && c.run('vacuum', 'Optimalizace databáze', async () => {
        const result = await c.api('POST', '/api/system/vacuum', {}, 120_000);
        if (result?.ok !== true) throw Object.assign(Error('Backend operaci nepotvrdil'), { status: 500 });
        await Promise.all([c.sm.load('uloziste', true), c.load('storage', true)]);
      }, 'Databáze optimalizována; nový stav načten.'));
      return true;
    case 'sv4-retention-save': saveRetention(c); return true;
    case 'sv4-backup-create': createBackupModal(c); return true;
    case 'sv4-backup-save': {
      const z = smData(c, 'zalohy'), form = c.form('sv4-backup-form');
      if (!z || !form || !form.reportValidity()) return true;
      smSave(c, 'zalohy', () => c.sm.editor('zalohy', 'retention', { settings: z.settings }, z.backupPolicy),
        { max_daily: Number(c.value('bak-daily')), max_weekly: Number(c.value('bak-weekly')), on_startup: !!c.value('bak-startup'), on_shutdown: !!c.value('bak-shutdown') })
        .then(ok => { if (ok) { c.clearDrafts('bak-'); c.s.retentionPreview = null; c.render(true); } });
      return true;
    }
    case 'sv4-backup-preview': retentionPreview(c); return true;
    case 'sv4-backup-detail': backupDetail(c, d.backup); return true;
    case 'sv4-backup-restore': c.closeAllModals(); restoreModal(c, d.backup); return true;
    case 'sv4-backup-note': noteModal(c, d.backup); return true;
    case 'sv4-backup-archive': {
      const b = backupByName(c, d.backup);
      if (b) smSave(c, 'zalohy', () => c.sm.editor('zalohy', 'backup', b, { note: b.note, archived: b.archived }), { note: b.note, archived: !b.archived });
      return true;
    }
    case 'sv4-backup-delete': { const b = backupByName(c, d.backup); if (b) smRemove(c, 'zalohy', 'backups', b); return true; }
    case 'sv4-settings-export': exportSettings(c); return true;
    case 'sv4-settings-import': importSettings(c, el); return true;
    case 'sv4-repo-path-save': {
      const u = smData(c, 'uloziste'), next = String(c.value('rep-path') || '').trim();
      if (!u) return true;
      if (!H.validPath(next) || next === '/') { c.toast('Zadejte absolutní cestu bez segmentu „..“.'); return true; }
      if (next === u.paths.projects && !c.projectDirectory?.()) { c.toast('Cesta se nezměnila.'); return true; }
      const finish = ok => {
        if (!ok) return;
        // Odstranění staré lokální přednosti propojí nový výchozí adresář s existujícím průvodcem.
        if (c.setProjectDirectory && !c.setProjectDirectory('')) { c.toast('Backend cestu uložil, lokální přednost se ale nepodařilo odstranit.'); return; }
        c.clearDrafts('rep-path'); c.sm.load('git', true); c.render(true);
      };
      if (next === u.paths.projects) finish(true);
      else smSave(c, 'uloziste', () => c.sm.editor('uloziste', 'paths', u.paths, { projects: u.paths.projects }), { projects: next }).then(finish);
      return true;
    }
    case 'sv4-repo-add':
      if (c.openProjectWizard) c.openProjectWizard();
      else c.toast('Repozitář přidáte otevřením existující složky v Projektech.');
      return true;
    case 'sv4-repo-edit': c.closeAllModals(); repoModal(c, d.repo); return true;
    case 'sv4-repo-copy': {
      const node = c.form('rep-address-' + d.repo);
      if (!node) return true;
      const fallback = () => { node.focus(); node.select(); c.toast('Schránka není dostupná. Adresa je označená – zkopírujte ji pomocí Ctrl+C.'); };
      try { navigator.clipboard.writeText(node.value).then(() => c.toast('Adresa repozitáře zkopírována.'), fallback); } catch { fallback(); }
      return true;
    }
    case 'sv4-ssh-new': c.s.sshEditor = { id: null, host: c.s.repoProfileHost || 'github.com' }; c.clearDrafts('ssh-'); c.render(true); c.el.querySelector('#sv4-ssh-editor')?.scrollIntoView({ block: 'nearest' }); return true;
    case 'sv4-ssh-edit': c.s.sshEditor = { id: d.profile }; c.clearDrafts('ssh-'); c.render(true); c.el.querySelector('#sv4-ssh-editor')?.scrollIntoView({ block: 'nearest' }); return true;
    case 'sv4-ssh-cancel': c.s.sshEditor = null; c.clearDrafts('ssh-'); c.render(true); return true;
    case 'sv4-ssh-save': saveSsh(c); return true;
    case 'sv4-ssh-detail': sshDetail(c, d.profile); return true;
    case 'sv4-ssh-delete': sshDelete(c, d.profile); return true;
    default: return general.act(c, action, el);
  }
}
module.exports = { render, act, summary, connections, channels, SECTIONS, EVENTS };
