'use strict';

// Modely a inference ve vzhledu schváleného návrhu V4 (model-v2.js, hunt-v2.js). Jediný datový a efektový
// klient je ModelWorkspaceRedesign; ukázkové modely, skóre, VRAM ani výsledky návrhu se nekopírují.
// Chybějící údaj je „—“ nebo štítek stavu, nikdy odhad.
const H = require('./helpers');
const { ROLES } = require('../model-workspace');
const { scoreCell } = require('../model-workspace-redesign');
const { e, icon, tag, kv, num, date, pl } = H;
const TOP = [['overview', 'Přehled'], ['roles', 'Role'], ['inventory', 'Modely'], ['evaluations', 'Evaluace'], ['hunt', 'GPU Hunt'], ['telemetry', 'Telemetrie'], ['policy', 'Provoz']];
const HUNT = [['overview', 'Přehled'], ['catalog', 'Katalog'], ['profiles', 'Nastavení Huntu a Challenge'], ['history', 'Historie']];
const PHASES = [['preflight', 'Předběžná kontrola'], ['download', 'Stažení'], ['warmup', 'Zahřátí'], ['capture', 'Sběr odpovědí'], ['review', 'Posouzení']];
const STATE = { MISSING: ['Neověřeno', 'gold'], NOT_MEASURED: ['Neověřeno', 'gold'], AWAITING_REVIEW: ['Čeká na posouzení', 'gold'], REVIEW_PENDING_PAIR: ['Čeká na druhý posudek', 'gold'],
  REVIEW_DISPUTED: ['Spor hodnotitelů', 'red'], STALE: ['Jiný artefakt / starší sada', ''], FAILED: ['Měření selhalo', 'red'], RUNNING: ['Měření běží', 'blue'], COMPLETE: ['Uzavřeno', 'green'],
  INAPPLICABLE: ['Pro roli nepoužitelné', ''], BLOCKED: ['Zablokováno', 'red'], COLLECTION_PARTIAL: ['Neúplný sběr', 'gold'] };
const RUN = { COMPLETE: ['Dokončeno', 'green'], COLLECTION_COMPLETE: ['Sběr dokončen · čeká posouzení', 'gold'], AWAITING_REVIEW: ['Čeká na posouzení', 'gold'], FAILED: ['Selhalo', 'red'],
  BLOCKED: ['Zablokováno', 'red'], STORAGE_BLOCKED: ['Nedostatek místa', 'red'], CANCELLED: ['Zrušeno', ''], PARTIAL: ['Částečně dokončeno', 'gold'], RUNNING: ['Běží', 'blue'], LAUNCHING: ['Spouští se', 'blue'],
  STOPPING: ['Zastavuje se', 'gold'], QUEUED: ['Ve frontě', 'gold'], INTERRUPTED: ['Přerušeno', 'red'], SKIPPED: ['Přeskočeno', ''], SCHEDULED_SKIPPED: ['Plán přeskočen', ''],
  NO_PENDING_CANDIDATES: ['Bez nových kandidátů', 'green'], RETENTION_COMPLETE: ['Úklid dokončen', 'green'], HELD: ['Pozastaveno operátorem', 'gold'], IDLE: ['Připraveno', 'green'], READY: ['Připraveno', 'green'] };
const KIND = { 'conversation-handoff': 'Předání z konverzace', discovery: 'Vyhledání kandidátů', hunt: 'Discovery Hunt', evaluation: 'Evaluace modelu', challenge: 'Challenge dvou modelů', scheduled: 'Plánovaný Hunt', manual: 'Ruční Hunt' };
const ERRORS = { DESKTOP_NOT_INSTALLED: 'GPU Hunt řídí jen nainstalované IDE. Tento backend běží mimo desktopovou instalaci, proto jeho stav není k dispozici.',
  DESKTOP_INSTALLATION_MISMATCH: 'Instalace GPU Huntu patří jiné instalaci IntentSmithu než tento backend.', HUNT_SERVICE_NOT_INSTALLED: 'Služba GPU Huntu není nainstalovaná.',
  HUNT_INSTALLATION_MISMATCH: 'Služba GPU Huntu patří jiné instalaci.', HUNT_STATE_UNSAFE: 'Stavový soubor Huntu má nebezpečná oprávnění; backend ho nečte.',
  HUNT_STATUS_UNAVAILABLE: 'Stav GPU Huntu se nepodařilo načíst.', 'Failed to fetch': 'Backend neodpovídá.' };
const ROLE_SUB = { CHAT: 'Rozhovor', D1: 'Návrhář', D2: 'Diagnostik', CODE: 'Implementace', R1: 'Závěrečný revizor', R2: 'Průběžný revizor', VISION: 'Obrazová analýza' };

const card = (title, html, actions = '', cls = '') => `<section class="card ${cls}"><div class="card-head"><h2>${e(title)}</h2>${actions}</div>${html}</section>`;
const table = (heads, rows, cls = '') => `<div class="table-wrap"><table class="data-table ${cls}"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const row = cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
const tok = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : num(Number(v));
const pair = (a, b) => `${tok(a)} / ${tok(b)}`;
const short = d => d ? String(d).replace(/^sha256:/, '').slice(0, 12) : '—';
const muted = text => `<span class="muted">${e(text)}</span>`;
const runTag = status => { const [label, tone] = RUN[status] || [status ? String(status).toLowerCase().replace(/_/g, ' ') : '—', '']; return tag(label, tone); };
const stateLabel = status => (STATE[status] || STATE.MISSING)[0];
const stateTag = status => tag(...(STATE[status] || STATE.MISSING));
const humanError = text => ERRORS[String(text || '').trim()] || (/^[A-Z][A-Z0-9_]+$/.test(String(text || '')) ? 'Backend vrátil chybu ' + text + '.' : String(text || 'Data se nepodařilo načíst.'));

function button(c, text, fn, { disabled = false, cls = '', confirmation = '', attrs = '', html = false } = {}) {
  const id = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(id, { fn, confirmation });
  return `<button type="button" class="button ${cls}" data-action="${id}" ${disabled ? 'disabled' : ''} ${attrs}>${html ? text : e(text)}</button>`;
}
function input(c, id, label, value, fn, attrs = '', hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.labeled(label, id, `<input id="${e(id)}" value="${e(value)}" data-live data-change="${action}" ${attrs}>`, hint);
}
function select(c, id, label, values, value, fn, hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.labeled(label, id, H.select(id, values, value, `data-live data-change="${action}"`), hint);
}
function check(c, id, label, value, fn, hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.check(id, label, value, hint, `data-live data-change="${action}"`);
}
function scoreHtml(artifact) {
  const cell = scoreCell(artifact);
  return cell.value === null ? stateTag(artifact?.status) : `<span class="mv2-score-text ${e(cell.cls)} score-${Math.round(cell.value * 100)}">${e(cell.text)}</span>`;
}
// Zpětná kompatibilita (testy, ostatní stránky): skóre nebo stav jako HTML.
const score = scoreHtml;

// ---------- data ----------
const settingsRows = c => c.mw.extraData('settings')?.roles || [];
const settingFor = (c, role) => settingsRows(c).find(r => r.role === role);
const plans = c => c.mw.resources.get('evaluations')?.data?.[0]?.roles || c.mw.resources.get('roles')?.data?.[1]?.roles || {};
const currentArtifact = (c, role) => plans(c)[role]?.artifacts?.find(a => a.isCurrentBinding);
const overviewData = c => c.mw.resources.get('overview')?.data?.[0] || null;
const huntData = c => c.mw.resources.get('hunt')?.data?.[0] || null;
const inventoryModel = (c, name) => (c.mw.extraData('inventory')?.models || []).find(m => m.name === name);
function gpuInfo(c) {
  const profile = c.data('gpu')?.profile, g = profile?.gpus?.[0];
  if (!g) return null;
  const name = H.gpuName(g.gpu_model);
  return { name, vram: g.vram_mb > 0 ? g.vram_mb / 1024 : null, stale: profile.inventoryStale === true };
}
function bindingTag(c, role) {
  const s = settingFor(c, role);
  if (s?.status === 'BINDING_UNAVAILABLE') return tag('Nedostupný', 'red');
  if (['STALE', 'REQUIRES_UPDATE'].includes(s?.status)) return tag('Ke kontrole', 'gold');
  return tag('Přiřazen', 'green');
}
function ctxOf(c, role) {
  const s = settingFor(c, role);
  return { ctx: s?.settings?.contextWindowTokens ?? null, out: s?.settings?.maxOutputTokens ?? null, hw: s?.verifiedHardwareMaximum || null };
}

// ---------- společné ----------
function readStatus(c) {
  const w = c.mw, failed = [...w.resources.values(), ...w.extra.values()].filter(r => r.status === 'error');
  const relevant = w.resources.get(w.tab), extra = w.extra.get(w.tab);
  const r = relevant?.status === 'error' ? relevant : extra?.status === 'error' ? extra : null;
  return (w.notice ? H.notice(e(w.notice)) : '') + (r ? `<div class="sv4-error" role="alert"><span>${e(humanError(r.error))}</span>${button(c, 'Obnovit', () => ensure(c, true), { cls: 'small' })}</div>`
    : !relevant?.data && !extra?.data && !failed.length ? '<div class="sv4-loading" role="status">Načítám data modelů…</div>' : '');
}
function ensure(c, refresh = false) {
  const w = c.mw, tab = c.s.modelTab;
  if (tab === 'hunt') {
    const target = c.s.huntTab === 'catalog' ? 'candidates' : c.s.huntTab === 'history' ? 'history' : 'hunt';
    w.tab = target; w.huntTab = c.s.huntTab;
    w.load(target, refresh); w.load('hunt', refresh); w.load('roles', refresh); w.load('evaluations', refresh);
    w.loadExtra('jobs', refresh); w.loadExtra('profiles', refresh);
    if (c.s.huntTab === 'profiles') w.load('candidates', refresh);
  } else {
    w.tab = tab === 'policy' ? (c.s.operationTab || 'policy') : tab; w.load(w.tab, refresh);
    if (['overview', 'roles', 'inventory', 'evaluations', 'policy'].includes(tab)) {
      w.load('roles', refresh); w.load('evaluations', refresh); w.loadExtra('settings', refresh); w.loadExtra('inventory', refresh);
    }
    if (tab === 'overview') { w.load('overview', refresh); w.loadExtra('telemetry', refresh); }
    if (tab === 'policy') { w.load('policy', refresh); w.load('overview', refresh); }
  }
  c.load('gpu', refresh); c.load('info', refresh);
}
function go(c, tab, subtab) {
  c.captureDrafts(); c.s.modelTab = tab;
  if (subtab) c.s.huntTab = subtab;
  c.mw.notice = ''; ensure(c); c.scrollReset = true; c.render(true);
}

// ---------- pravý přehled ----------
function aside(c, vm) {
  const provider = c.data('info')?.config?.provider === 'ollama' ? 'Ollama' : c.data('info')?.config?.provider || 'Ollama';
  return `<div class="inspector-head"><h2>Používané modely</h2>${tag('Živě', 'green')}</div><p class="intro muted">Stručný přehled nasazení. Úpravy přiřazení jsou v detailu role.</p>${vm.summaryRoles.map(r => `<div class="aside-role"><span>${e(r.role)} · ${e(ROLE_SUB[r.role] || r.name)}</span><strong class="mono">${e(r.model)}</strong></div>`).join('')}<div class="divider"></div>${kv('Poskytovatel', e(provider))}<div class="section-title mv4-aside-title">Kontext podle role · nastaveno</div>${vm.summaryRoles.map(r => { const x = ctxOf(c, r.role); return kv(r.role, `<span class="mono">${pair(x.ctx, x.out)}</span>`); }).join('')}<p class="help">Okno konverzace / limit jedné odpovědi v tokenech; „—“ u odpovědi znamená limit podle volání. Ověřený strop HW je u modelu a v Provozu.</p>${button(c, 'Podrobnosti provozu', () => go(c, 'policy'))}`;
}

// ---------- přehled ----------
function overview(c, vm) {
  const w = c.mw, gpu = gpuInfo(c), hunt = huntData(c), chat = ctxOf(c, 'CHAT');
  const history = w.resources.get('evaluations')?.data?.[0]?.history || [];
  const artifacts = Object.values(plans(c)).flatMap(p => p.artifacts || []);
  const closed = artifacts.filter(a => scoreCell(a).value !== null), modelCount = new Set(closed.map(a => a.model)).size;
  const last = history[0];
  const gpuSmall = gpu ? (gpu.vram ? e(gpu.name) : 'VRAM není zjištěná') + (hunt?.gpu?.available === false ? ' · využití nelze změřit' : '') + (gpu.stale ? ' · starší inventura' : '') : 'Inventura GPU není dostupná';
  const strip = `<section class="mv2-status-strip" aria-label="Provozní přehled"><div><span>GPU</span><strong>${gpu ? gpu.vram ? num(gpu.vram, 0) + ' GiB' : e(gpu.name) : '—'}</strong><small>${gpuSmall}</small></div>`
    + `<div><span>Kontext CHAT · nastaveno</span><strong>${pair(chat.ctx, chat.out)} tok.</strong><small>${chat.hw ? 'Ověřený strop HW ' + pair(chat.hw.contextWindowTokens, chat.hw.maxOutputTokens) : 'Ověřený strop HW zatím chybí'} · ostatní role v tabulce</small></div>`
    + `<div><span>Lokální ověření</span><strong>${pl(modelCount, 'model', 'modely', 'modelů')} · ${pl(closed.length, 'profil role', 'profily rolí', 'profilů rolí')}</strong><small>${pl(artifacts.length - closed.length, 'artefakt čeká', 'artefakty čekají', 'artefaktů čeká')} na uzavřené skóre</small></div>`
    + `<div><span>Poslední měření</span><strong>${last ? e(date(last.testedAt)) : '—'}</strong><small>${last ? `${e(last.model)} · ${e(last.role)} · ${e((RUN[last.status] || STATE[last.status] || [last.status])[0])}` : 'Zatím žádné měření'}</small></div></section>`;
  const rows = vm.summaryRoles.map(r => { const x = ctxOf(c, r.role); return row([
    `<button type="button" class="link-button" data-action="sv4-model-role" data-role="${e(r.role)}">${e(r.role)}</button><div class="cell-sub">${e(ROLE_SUB[r.role] || r.name)}</div>`,
    `<span class="mono">${e(r.model)}</span>`, scoreHtml(currentArtifact(c, r.role)), `<span class="mono">${pair(x.ctx, x.out)}</span>`,
    x.hw ? `<span class="mono">${pair(x.hw.contextWindowTokens, x.hw.maxOutputTokens)}</span>` : muted('—'), bindingTag(c, r.role)]); });
  const installed = overviewData(c)?.models || [];
  const candidates = installed.filter(m => !m.isBound);
  const telemetry = vm.redesign.telemetry || [];
  const chatModel = vm.summaryRoles.find(r => r.role === 'CHAT')?.model;
  const chatTelemetry = telemetry.find(t => t.model === chatModel && t.role === 'CHAT') || telemetry.find(t => t.model === chatModel);
  const chatRun = history.find(h => h.role === 'CHAT' && h.model === chatModel);
  const requests = telemetry.reduce((n, t) => n + (Number(t.requests) || 0), 0);
  return strip + H.sectionTitle('Používané modely podle rolí', button(c, 'Podrobnosti rolí', () => go(c, 'roles'), { cls: 'small ghost' }))
    + table(['Role a účel', 'Primární model', 'Lokální skóre role', 'Nastaveno · okno / odpověď', 'Ověřený strop HW', 'Stav'], rows)
    + `<div class="grid2 section-gap">`
    + card('Kandidáti k ověření', (candidates.length ? candidates.slice(0, 5).map(m => `<div class="provider"><div><strong class="mono">${e(m.name)}</strong><div class="cell-sub">${e([m.paramsLabel && m.paramsLabel !== '?' ? m.paramsLabel : null, m.quantization, m.sizeGB ? m.sizeGB.replace('.', ',') + ' GB' : null].filter(Boolean).join(' · ') || 'Staženo')}</div></div>${tag('Neověřeno')}</div>`).join('') : H.empty('Všechny stažené modely jsou přiřazené rolím.'))
      + `<p class="help">${candidates.length > 5 ? `A ${pl(candidates.length - 5, 'další model', 'další modely', 'dalších modelů')} v záložce Modely. ` : ''}Veřejná doporučení patří do katalogu; roli přepínáme až podle lokálního ověření.</p>`, button(c, 'GPU Hunt', () => go(c, 'hunt', 'catalog'), { cls: 'small' }))
    + card('Výsledky a výkon', kv('Rychlost CHAT', chatTelemetry ? e(chatTelemetry.speed) : '—') + kv('Latence CHAT · medián', chatTelemetry ? e(chatTelemetry.median) : '—') + kv('Obsloužené požadavky · ' + pl(vm.redesign.days, 'den', 'dny', 'dní'), num(requests))
      + kv('Poslední CHAT měření', chatRun ? `${e(date(chatRun.testedAt))} · ${e((RUN[chatRun.status] || STATE[chatRun.status] || [chatRun.status])[0])}` : '—')
      + `<div class="toolbar">${button(c, 'Telemetrie modelů', () => go(c, 'telemetry'), { cls: 'small ghost' })}</div><p class="help">Telemetrie měří rychlost a latenci provozu; kvalitu odpovědí určuje jen evaluace role.</p>`, button(c, 'Otevřít matici', () => go(c, 'evaluations'), { cls: 'small' }))
    + '</div>';
}

// ---------- role ----------
function runtime(c, vm) {
  const r = vm.redesign.roleRuntime;
  if (!r.hasDraft) return '';
  const d = r.draft, hw = settingFor(c, d.role)?.verifiedHardwareMaximum;
  const window = Number(d.contextWindowTokens) || 0, out = Number(d.maxOutputTokens) || 0, rest = Math.max(0, window - out);
  const budget = window > 0 ? `<svg class="mv2-budget" viewBox="0 0 1000 28" role="img" aria-label="Rozdělení okna role ${e(d.role)}"><rect x="0" y="0" width="${rest / window * 1000}" height="28" class="budget-history"/><rect x="${rest / window * 1000}" y="0" width="${Math.min(out, window) / window * 1000}" height="28" class="budget-output"/></svg>${kv('Prostor pro pokyny, historii a nástroje', tok(rest) + ' tok.')}${kv('Rezerva odpovědi', out ? tok(out) + ' tok.' : 'podle volání')}` : '';
  return `<section class="card section-gap" id="mv4-context" data-role="${e(d.role)}"><div class="card-head"><div><div class="eyebrow">${e(d.role)} · ${e(ROLE_SUB[d.role] || d.name || '')}</div><h2>Kontext a limit odpovědi</h2><p class="help mv4-ctx-intro">Nastaveno = hodnoty, které aplikace posílá modelu role: okno konverzace (<span class="mono">num_ctx</span>) a limit jedné odpovědi (<span class="mono">num_predict</span>). Ověřený strop HW = největší dvojice, která na tomto počítači prošla testem kapacity.</p></div>${tag('Každá role se ukládá samostatně', 'gold')}</div>`
    + `<div class="metric-grid mv4-ctx-compare"><div class="metric"><span>Model role ${e(d.role)}</span><strong class="mono">${e(d.model)}</strong><small>Otisk ${e(d.digestShort || short(d.digestSha256))} · revize ${e(d.revision)}</small></div><div class="metric"><span>Nastaveno · okno / odpověď</span><strong>${pair(settingFor(c, d.role)?.settings?.contextWindowTokens, settingFor(c, d.role)?.settings?.maxOutputTokens)} tok.</strong><small>Minimum okna ${tok(d.minimumContextWindowTokens)} tok.</small></div><div class="metric"><span>Ověřený strop HW · okno / odpověď</span><strong>${hw ? pair(hw.contextWindowTokens, hw.maxOutputTokens) + ' tok.' : '—'}</strong><small>${hw ? 'Doložený test kapacity' : 'Čeká na test kapacity'}</small></div></div>`
    + (r.sharedWarning ? H.notice(e(r.sharedWarning), 'warn') : '')
    + `<div class="grid2 section-gap"><div>${input(c, 'role-context', 'Okno konverzace · ' + d.role + ' (tokeny)', d.contextWindowTokens, d.setContext, `type="number" min="${d.minimumContextWindowTokens}" max="262144" step="1024" ${d.disabled ? 'disabled' : ''}`, 'Celé okno: systémové pokyny, historie, nástroje a prostor pro odpověď.')}${input(c, 'role-output', 'Limit jedné odpovědi · ' + d.role + ' (tokeny)', d.maxOutputTokens, d.setOutput, `type="number" min="1" max="6000" ${d.disabled ? 'disabled' : ''}`, d.role === 'CHAT' ? 'Omezuje odpověď uživateli; interní kroky mají vlastní rozpočet.' : 'Nejvýše generovaných tokenů jedné odpovědi.')}</div><div><h3>Rozdělení uloženého okna · ${e(d.role)}</h3>${budget}<p class="help">${e(r.minimumNote)}</p></div></div>`
    + `<div class="setting-footer">${button(c, 'Zavřít editor', d.close, { disabled: c.mw.busy })}${button(c, 'Uložit kontext role ' + d.role, d.save, { cls: 'primary', disabled: d.disabled })}</div></section>`;
}
function changeBinding(c, role) {
  const w = c.mw, names = (w.resources.get('roles')?.data?.[2]?.models || []).map(m => [m.name, m.name]);
  const current = w.summary().roles.find(r => r.role === role)?.model;
  c.modal('Primární model · ' + role, `${kv('Současný', `<strong class="mono">${e(current || '—')}</strong>`)}${H.labeled('Nový primární model', 'binding-model', H.select('binding-model', names, current))}<p class="help">Volba je dostupná v detailu role, ne v přehledu. Backend vyžaduje přijatý přesný artefakt; samotné veřejné skóre změnu nepovoluje.</p>`, 'Přiřadit model', async form => {
    w.selectedRole = role; w.selectedModel = new FormData(form).get('binding-model');
    const accepted = await c.confirmThen('Přiřadit ' + w.selectedModel + ' roli ' + role + '? Proběhne skutečná asynchronní změna a ověření modelu.', () => w.assignRole());
    if (w.notice) c.toast(w.notice);
    return accepted === true;
  });
}
function roles(c, vm) {
  const w = c.mw, role = ROLES.includes(w.selectedRole) ? w.selectedRole : 'CHAT', current = vm.summaryRoles.find(r => r.role === role), plan = plans(c)[role];
  const profile = overviewData(c)?.profiles?.[role], x = ctxOf(c, role);
  const picker = `<div class="mv2-role-picker">${ROLES.map(r => button(c, r, () => { w.selectedRole = r; c.render(true); }, { cls: r === role ? 'primary' : 'ghost', attrs: `aria-pressed="${r === role}"` })).join('')}</div>`;
  const tasks = [profile?.name && 'Profil role: ' + profile.name, profile?.desc, plan?.suiteName && 'Testovací sada ' + plan.suiteName].filter(Boolean);
  const primary = `<section class="card"><div class="card-head"><div><div class="eyebrow">${e(role)}</div><h2>${e(current?.name || role)}</h2></div>${tag('Primární model')}</div><p>${e(current?.description || '')}</p>${tasks.length ? `<ul class="checklist">${tasks.map(t => `<li>${icon('check')}${e(t)}</li>`).join('')}</ul>` : ''}<div class="divider"></div>${kv('Primární model', `<strong class="mono">${e(current?.model || '—')}</strong>`)}${kv('Lokální skóre této role', scoreHtml(currentArtifact(c, role)))}${kv('Nastaveno · okno / odpověď', `<span class="mono">${pair(x.ctx, x.out)}</span>`)}${kv('Ověřený strop HW', x.hw ? `<span class="mono">${pair(x.hw.contextWindowTokens, x.hw.maxOutputTokens)}</span>` : muted('Čeká na test kapacity'))}<div class="toolbar section-gap">${button(c, 'Změnit primární model', () => changeBinding(c, role), { cls: 'primary', disabled: w.busy || w.resources.get('roles')?.status !== 'ready' })}${button(c, 'Kontext a výstup', () => w.editRoleRuntime(role), { disabled: w.busy || !settingFor(c, role)?.digestSha256 })}</div></section>`;
  const failover = w.resources.get('policy')?.data?.[0]?.policy?.autoFailoverEnabled;
  const secondary = `<section class="card"><h2>Zástupné modely</h2><p class="help">Pořadí záložních modelů po jednotlivých rolích backend zatím nespravuje. Při nedostupnosti primárního modelu rozhoduje provozní politika a přijetí přesného artefaktu.</p>${kv('Automatické přepnutí při výpadku', failover === true ? tag('Povoleno', 'green') : failover === false ? tag('Vypnuto') : muted('—'))}${kv('Záložní model pro ' + role, muted('Nenastaven'))}<div class="setting-footer">${button(c, 'Provozní pravidla', () => go(c, 'policy'))}</div></section>`;
  const rows = (plan?.artifacts || []).map(a => row([`<strong class="mono">${e(a.model)}</strong><div class="cell-sub mono">${e(short(a.digestSha256))}</div>`, scoreCell(a).value === null ? muted('—') : scoreHtml(a), stateTag(a.status),
    `<span class="help">${e(a.missingExplanation || a.decisionBlockReason || '')}</span>`,
    `<div class="sv2-cell-actions">${a.runId ? button(c, 'Výsledky', () => w.showRun(a.runId), { cls: 'small ghost' }) : ''}${button(c, 'Otestovat', () => w.evaluateArtifact(role, a.model, a.digestSha256), { cls: 'small', disabled: w.busy || !a.digestSha256 || a.applicable === false || plan?.measurementReady === false, confirmation: 'Spustit místní test ' + a.model + ' pro ' + role + '? Použije GPU a uloží nové výsledky; role se nezmění.' })}</div>`]));
  return picker + `<div class="grid2">${primary}${secondary}</div>` + runtime(c, vm)
    + `<div class="section-title"><h2>Modely pro ${e(role)}</h2><span class="muted">Skóre vždy pro tuto konkrétní roli</span></div>`
    + (rows.length ? table(['Model', 'Souhrn role', 'Ověření', 'Poznámka', ''], rows) : H.empty('Pro tuto roli zatím není žádný artefakt.'));
}

// ---------- modely ----------
function roleLabels(m) {
  return m.roleTags.length ? `<div class="mv3-role-labels">${m.roleTags.map(r => `<span class="mv3-role-label ${r.active ? 'is-active' : ''}" title="${e(r.active ? 'Aktivně přiřazen roli' : 'Vhodná role')}">${r.active ? '<span aria-hidden="true">●</span> ' : ''}${e(r.role)}</span>`).join('')}</div>` : muted('—');
}
function inventory(c, vm) {
  const w = c.mw, detail = vm.redesign.inventoryDetail, models = detail.rows;
  const meta = m => { const raw = inventoryModel(c, m.name); return { ctx: raw?.details?.context_length ?? null }; };
  const content = c.s.layout === 'grid'
    ? `<div class="catalog-grid">${models.map(m => `<article class="catalog-card"><div class="toolbar">${icon('models')}${tag(m.quant)}</div><h3 class="mono">${e(m.name)}</h3>${roleLabels(m)}<p>${e(m.family)} · ${e(m.parameters)} · ${e(m.size)}<br>Okno modelu ${tok(meta(m).ctx)} tok.</p>${button(c, 'Zobrazit podrobnosti', m.select, { cls: m.selected ? 'primary' : 'ghost' })}</article>`).join('')}</div>`
    : table(['Model', 'Přiřazené role', 'Kvantizace', 'Na disku', 'Okno modelu', 'Stav'], models.map(m => `<tr class="${m.selected ? 'selected-row' : ''}"><td>${button(c, m.name, m.select, { cls: 'link-button mono' })}<div class="cell-sub">${e(m.family)} · ${e(m.parameters)}</div></td><td>${roleLabels(m)}</td><td>${e(m.quant)}</td><td>${e(m.size)}</td><td class="mono">${tok(meta(m).ctx)}</td><td>${m.roleTags.some(r => r.active) ? tag('Přiřazen', 'green') : tag('Nepřiřazen')}</td></tr>`), 'mv3-models');
  const m = detail.hasSelection ? detail.selected : models[0];
  if (!m) return H.empty('Poskytovatel nevrátil žádné modely.');
  const raw = inventoryModel(c, m.name), gpu = gpuInfo(c), modelsPath = overviewData(c)?.diskUsage?.modelsPath;
  const subtab = c.s.inventoryTab || 'hardware';
  const tabs = H.tabs([['hardware', 'Kontext a hardware'], ['identity', 'Identita a umístění'], ['results', 'Ověření rolí']], subtab, 'sv4-model-detail-tab');
  const assigned = m.roleTags.filter(r => r.active).map(r => r.role);
  const body = subtab === 'identity'
    ? `<div class="grid2"><div>${kv('Identita artefaktu', `<span class="mono" title="${e(m.digest)}">sha256:${e(short(m.digest))}…</span>`)}${kv('Kvantizace', e(m.quant))}${kv('Poskytovatel', 'Ollama')}</div><div>${kv('Na disku', e(m.size))}${kv('Umístění', `<span class="mono">${e(modelsPath || '—')}</span>`)}${kv('Přiřazení', e(assigned.join(', ') || 'Žádná role'))}</div></div>`
    : subtab === 'results'
      ? `<div class="mv2-role-results">${ROLES.map(r => { const a = plans(c)[r]?.artifacts?.find(x => x.model === m.name); const s = scoreCell(a); return a?.runId ? button(c, `${r} · ${s.value === null ? '—' : s.text}`, () => { c.s.modelTab = 'evaluations'; w.showRun(a.runId); go(c, 'evaluations'); }) : `<span class="button" aria-disabled="true">${e(r)} · ${s.value === null ? '—' : e(s.text)}</span>`; }).join('')}</div><p class="help">Pomlčka znamená chybějící lokální výsledek. Veřejné žebříčky nejsou lokální ověření.</p>`
      : `<div class="grid2"><div><h3>Kontext a výstup</h3>${kv('Deklarované okno modelu', raw?.details?.context_length ? tok(raw.details.context_length) + ' tok.' : '—')}${kv('Největší ověřené okno · strop HW', '—')}${kv('Ověřený limit odpovědi · strop HW', '—')}${kv('Nastaveno v rolích', e(m.roleSettings.map(r => r.role + ' ' + pair(ctxOf(c, r.role).ctx, ctxOf(c, r.role).out)).join(' · ') || 'Model není přiřazen roli'))}${kv('Profil ověření', 'Čeká na test kapacity')}<p class="help">Okno zahrnuje systémové pokyny, historii, nástroje a generovanou odpověď. Ověření se vztahuje ke konkrétní dvojici okno + limit výstupu.</p></div><div><h3>Model a hardware</h3>${kv('Hardware', gpu ? e(gpu.name) + (gpu.vram ? ' · ' + num(gpu.vram, 0) + ' GiB' : '') : '—')}${kv('Rodina / parametry', e(m.family + ' · ' + m.parameters))}${kv('Velikost na disku', e(m.size))}${kv('Kvantizace', e(m.quant))}${kv('Špička VRAM', '—')}<p class="help">Spotřebu VRAM a rychlost změří až test kapacity na tomto počítači.</p></div></div>`;
  return `<p class="help">Zlatý štítek s tečkou označuje aktivně přiřazenou roli. Skóre patří přesnému artefaktu a sadě role.</p>${content}<section class="card mv2-profile section-gap" id="model-profile"><div class="card-head"><div><div class="eyebrow">Detail modelu · sha256:${e(short(m.digest))}</div><h2 class="mono">${e(m.name)}</h2></div>${button(c, 'Připravit místní testy', m.prepareTests, { disabled: w.busy })}</div>${tabs}${body}</section><p class="audit-mark">Měření kapacity a výkonu zobrazuje IDE až po skutečném testu na tomto hardwaru; nic se neodhaduje.</p>`;
}

// ---------- evaluace ----------
function evaluations(c, vm) {
  const w = c.mw, matrix = vm.redesign.matrix, filter = c.s.matrixRole || 'all';
  const shown = filter === 'all' ? ROLES : [filter];
  const roleFilter = `<div class="toolbar">${button(c, 'Všechny role', () => { c.s.matrixRole = 'all'; c.render(true); }, { cls: 'small ' + (filter === 'all' ? 'primary' : 'ghost') })}${ROLES.map(r => button(c, r, () => { c.s.matrixRole = r; if (w.matrixRole !== r) w.sortMatrix(r); c.render(true); }, { cls: 'small ' + (filter === r ? 'primary' : 'ghost') })).join('')}</div>`;
  const scale = `<div class="mv2-scale" aria-label="Barevná pásma skóre"><span class="mv4-band b0">pod 50</span><span class="mv4-band b1">50–69</span><span class="mv4-band b2">70–79</span><span class="mv4-band b3">80–89</span><span class="mv4-band b4">90+</span></div>`;
  const heads = ['Model / artefakt', ...matrix.headers.filter(h => shown.includes(h.role)).map(h => { const arrow = h.ariaSort === 'descending' ? '↓' : h.ariaSort === 'ascending' ? '↑' : '↕'; return button(c, `${e(h.role)}<span aria-hidden="true">${arrow}</span>`, h.sort, { cls: 'mv3-sort', html: true, attrs: `aria-label="Řadit podle ${e(h.role)}"` }) + `<div class="cell-sub">${e(ROLE_SUB[h.role] || '')}</div>`; })];
  let selected = null;
  const rows = matrix.rows.map(m => `<tr><td><strong class="mono">${e(m.model)}</strong><div class="cell-sub mono">sha256:${e(short(m.digest))}</div></td>${m.cells.filter(cell => shown.includes(cell.role)).map(cell => {
    if (cell.selected) selected = { model: m.model, digest: m.digest, cell };
    const id = 'sv4-model-' + c.modelActions.size; c.modelActions.set(id, { fn: cell.select });
    const band = cell.value === null ? 'unmeasured' : `score-${Math.round(cell.value * 100)}`;
    const note = cell.value === null && cell.status && !['MISSING', 'NOT_MEASURED'].includes(cell.status) ? `<small>${e(stateLabel(cell.status))}</small>` : '';
    return `<td class="${cell.selected ? 'mv3-selected-cell' : ''}"><button type="button" class="mv2-matrix-cell ${e(cell.cls)} ${band} ${cell.selected ? 'active' : ''}" data-action="${id}" aria-pressed="${cell.selected}" title="${e(stateLabel(cell.status))}" aria-label="${e(m.model + ' · ' + cell.role + ' · ' + (cell.value === null ? stateLabel(cell.status) : cell.text))}"><strong>${e(cell.text)}</strong>${note}</button></td>`;
  }).join('')}</tr>`);
  const head = `<div class="mv2-matrix-toolbar">${roleFilter}${scale}</div>`;
  return head + (rows.length ? table(heads, rows, 'mv2-matrix') : H.empty('Zatím žádná data evaluací.'))
    + '<p class="help">Klikněte na roli v záhlaví pro řazení od nejvyššího skóre; dalším kliknutím obrátíte směr. Neměřené výsledky jsou vždy na konci. Barva buňky podle pásma: pod 50 červená, 50–69 oranžová, 70–79 žlutá, 80–89 žlutozelená, od 90 zelená. Pomlčka znamená chybějící uzavřené skóre, nikoli nulu.</p>'
    + evaluationDetail(c, vm, selected) + runDetail(c, vm);
}
function evaluationDetail(c, vm, sel) {
  if (!sel || vm.hasRunDetail) return '';
  const plan = plans(c)[sel.cell.role], artifact = plan?.artifacts?.find(a => a.model === sel.model && a.digestSha256 === sel.digest);
  return `<section class="card section-gap"><div class="card-head"><div><div class="eyebrow">Detail vybraného políčka matice</div><h2>${e(sel.model)} · ${e(sel.cell.role)}</h2><p class="help">${e(plan?.suiteName || 'Sada role')}${plan?.suiteVersion ? ' · ' + e(plan.suiteVersion) : ''} · sha256:${e(short(sel.digest))}</p></div>${sel.cell.value === null ? stateTag(sel.cell.status) : tag(sel.cell.text, 'green')}</div>${H.notice(e(artifact?.missingExplanation || artifact?.decisionBlockReason || 'Tento model nemá pro vybranou roli uzavřené lokální skóre. Veřejné doporučení ho nenahrazuje.'), 'neutral')}<div class="setting-footer">${button(c, 'Spustit test této role', sel.cell.test, { cls: 'primary', disabled: sel.cell.testDisabled || c.mw.busy, confirmation: 'Spustit místní test ' + sel.model + ' pro ' + sel.cell.role + '? Použije GPU a uloží nové výsledky; role se nezmění.' })}${button(c, 'Porovnat v GPU Huntu', () => go(c, 'hunt', 'catalog'))}</div></section>`;
}
function runDetail(c, vm) {
  if (!vm.hasRunDetail) return '';
  if (!vm.runDetailReady) return card('Výsledek měření', vm.runDetailError ? `<p role="alert">${e(vm.runDetailError)}</p>` : '<p role="status">Načítám odpovědi a posudky…</p>', button(c, 'Zavřít', () => c.mw.closeRun(), { cls: 'small' }), 'section-gap');
  const r = vm.runDetail, tasks = r.tasks || [], i = Math.min(c.s.caseIndex || 0, Math.max(0, tasks.length - 1)), t = tasks[i];
  const list = tasks.map((task, n) => { const id = 'sv4-model-' + c.modelActions.size; c.modelActions.set(id, { fn: () => { c.s.caseIndex = n; } }); return `<button type="button" class="case-row ${n === i ? 'active' : ''}" data-action="${id}">${n + 1}. ${e(task.title)}<small>${e(task.score)}</small></button>`; }).join('');
  const caseBody = t ? `<h3>${e(t.title)}</h3><div class="case-prompt">${e(t.input)}</div>${(t.requirements || []).map(req => `<p class="help">${e(req)}</p>`).join('')}${t.attempts.map(a => `<article class="sv4-attempt"><h3>${e(a.label)}</h3>${a.transcript.map(m => `<div class="cell-sub">${e(m.role)}</div><div class="case-answer">${e(m.content)}</div>`).join('')}${a.response ? `<div class="case-answer">${e(a.response)}</div>` : ''}${a.notes.map(n => `<p class="help">${e(n)}</p>`).join('')}${a.reviews.map(rv => `<div class="sv2-summary-box"><strong>${e(rv.label)} · ${e(rv.score)}</strong>${rv.parts.map(p => `<p class="help">${e(p)}</p>`).join('')}</div>`).join('')}</article>`).join('')}` : '<p class="help">Běh nemá uložené úlohy.</p>';
  return `<section class="card section-gap"><div class="card-head"><div><div class="eyebrow">Výsledek měření</div><h2>${e(r.title)}</h2><p class="help">${e(r.status)}</p></div>${button(c, 'Zavřít výsledek', () => c.mw.closeRun(), { cls: 'small ghost' })}</div><p>${e(r.note)}</p><p class="help mono">${e(r.provenance)}</p>${r.attempts ? `<p class="help">${e(r.attempts)}</p>` : ''}<div class="divider"></div><div class="case-layout"><div>${list}</div><div>${caseBody}</div></div></section>`;
}

// ---------- GPU Hunt ----------
function huntStatus(c) {
  const h = huntData(c);
  if (!h) return null;
  const service = h.service?.ActiveState, timer = h.timer?.ActiveState;
  const state = h.state === 'HELD' ? 'HELD' : service === 'active' || h.state === 'RUNNING' ? 'RUNNING' : h.state;
  return { h, state, timerOn: timer === 'active', running: service === 'active' || h.state === 'RUNNING' };
}
function phaseIndex(status, progress) {
  const phase = String(progress?.phase || progress?.stage || '').toLowerCase();
  const byPhase = PHASES.findIndex(([id]) => phase.includes(id));
  if (byPhase >= 0) return { step: byPhase, done: false };
  if (['COMPLETE', 'NO_PENDING_CANDIDATES', 'RETENTION_COMPLETE'].includes(status)) return { step: 5, done: true };
  if (['COLLECTION_COMPLETE', 'AWAITING_REVIEW'].includes(status)) return { step: 4, done: false };
  if (['FAILED', 'BLOCKED', 'STORAGE_BLOCKED', 'INTERRUPTED', 'CANCELLED'].includes(status)) return { step: 0, done: false, failed: true };
  return { step: 0, done: false };
}
function graph(status, progress) {
  const { step, failed } = phaseIndex(status, progress);
  return `<ol class="hunt2-phase-graph" aria-label="Fáze Huntu">${PHASES.map(([, label], i) => `<li class="hunt2-phase ${step === i && !failed ? 'hunt2-phase-current' : step > i ? 'hunt2-phase-past' : ''}"><span class="hunt2-phase-node">${step > i ? '✓' : i + 1}</span><strong>${label}</strong><small>${step > i ? 'Hotovo' : step === i ? failed ? 'Zastaveno' : status === 'COLLECTION_COMPLETE' || status === 'AWAITING_REVIEW' ? 'Čeká na posudek' : 'Probíhá' : 'Čeká'}</small></li>`).join('')}</ol>`;
}
function duration(from, to) {
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const s = Math.round((b - a) / 1000), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
}
function huntOverview(c, vm) {
  const st = huntStatus(c), w = c.mw, h = st?.h, run = h?.current || h?.recent?.[0] || null;
  const control = ['start', 'stop', 'pause', 'resume'].map(a => button(c, ({ start: 'Spustit Hunt', stop: 'Zastavit běh', pause: 'Pozastavit plán', resume: 'Obnovit plán' })[a], () => w.hunt(a), {
    cls: a === 'start' ? 'primary' : a === 'stop' ? 'danger' : '', disabled: w.busy || !h || a === 'start' && (st.running || !!h.hold) || a === 'stop' && !st.running || a === 'pause' && !st.timerOn || a === 'resume' && (st.timerOn || !!h.hold),
    confirmation: ({ start: 'Spustit GPU Hunt? Může stahovat modely a použít GPU; přiřazení rolí se nezmění.', stop: 'Zastavit aktuální běh Huntu? Uložená měření zůstanou.', pause: 'Pozastavit plánované spouštění Huntu?', resume: 'Obnovit plánované spouštění Huntu?' })[a] })).join('');
  const results = run?.results || [], diag = run?.diagnostics || {};
  const runCard = run ? card(st.running ? 'Probíhající Hunt' : 'Poslední Hunt', `<div class="hunt2-run-title"><div><strong>${e(KIND[run.request?.kind] || run.request?.kind || 'Hunt')}${run.request?.role ? ' · ' + e(run.request.role) : ''}${run.request?.model ? ' · ' + e(run.request.model) : ''}</strong><p class="help">Zahájeno ${e(date(run.startedAt))}${run.finishedAt ? ' · dokončeno ' + e(date(run.finishedAt)) : ''}</p></div>${runTag(run.status)}</div>${graph(run.status, h.progress)}<div class="hunt2-telemetry"><div><span>Doba běhu</span><strong>${e(duration(run.startedAt, run.finishedAt || (st.running ? new Date().toISOString() : null)))}</strong></div><div><span>Vyhodnocené úlohy</span><strong>${num(diag.evaluated || 0)}</strong></div><div><span>Modely v běhu</span><strong>${num(results.length)}</strong></div><div><span>Místní skóre</span><strong>${results.some(x => Number.isFinite(x?.score)) ? num(Math.max(...results.filter(x => Number.isFinite(x?.score)).map(x => x.score)) * 100, 1) + ' %' : '—'}</strong></div></div><p class="help">${e(run.error?.message || (run.reasons || []).join(' ') || (run.status === 'COLLECTION_COMPLETE' ? 'Odpovědi jsou sebrané; skóre vznikne až po nezávislém posouzení. Aktivní přiřazení zůstává.' : 'Výsledek nemění aktivní přiřazení rolí; to vyžaduje samostatné přijetí artefaktu.'))}</p><div class="toolbar">${control}</div>`)
    : card('GPU Hunt', `<p class="help">${h ? 'Hunt zatím nemá uložený běh.' : 'Stav GPU Huntu není k dispozici.'}</p><div class="toolbar">${control}</div>`);
  const log = [];
  const logTime = t => { if (t === '—') return t; const ms = typeof t === 'number' ? t : Date.parse(t); if (!Number.isFinite(ms)) return '—'; const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getDate()}. ${d.getMonth() + 1}. ${p(d.getHours())}:${p(d.getMinutes())}`; };
  if (run) {
    log.push([run.startedAt, 'Zahájení · ' + (KIND[run.request?.kind] || run.request?.kind || 'Hunt')]);
    if (h.resources?.checkedAt) log.push([h.resources.checkedAt, h.resources.ready ? 'Předběžná kontrola · paměť a disk v pořádku' : 'Předběžná kontrola · ' + (h.resources.code || 'nedostatek prostředků')]);
    if (h.progress?.detail) log.push([h.progress.updatedAt, typeof h.progress.detail === 'string' ? h.progress.detail : JSON.stringify(h.progress.detail)]);
    for (const reason of run.reasons || []) log.push(['—', String(reason)]);
    if (run.error) log.push([run.finishedAt, 'Chyba · ' + (run.error.message || run.error.code || run.error)]);
    if (run.finishedAt) log.push([run.finishedAt, 'Konec · ' + (RUN[run.status] || [run.status])[0]]);
  }
  if (h?.hold) log.push([h.hold.createdAt, 'Automatika pozastavena operátorem']);
  const logCard = card(st?.running ? 'Log aktuálního běhu' : 'Log posledního Huntu', log.length ? `<div class="hunt2-log sv4-hunt-log" role="log" aria-label="Log Huntu">${log.map(([t, m]) => `<div><time>${e(logTime(t))}</time><span>${e(m)}</span></div>`).join('')}</div>` : H.empty('Zatím žádný záznam.'));
  const conclusions = [['hunt', 'Poslední závěr Huntu'], ['challenge', 'Poslední závěr Challenge']].map(([kind, title]) => {
    const job = w.jobRows().find(j => j.profile?.kind === kind && ['COMPLETE', 'AWAITING_REVIEW', 'FAILED', 'PARTIAL'].includes(j.state));
    const recent = kind === 'hunt' ? (h?.recent || []).find(r => r.finishedAt) : null;
    const item = job ? { label: job.profile?.name || job.profileId, at: job.at, status: job.state } : recent ? { label: KIND[recent.request?.kind] || 'Hunt', at: recent.finishedAt, status: recent.status } : null;
    return card(title, item ? `<strong>${e(item.label)}</strong><p class="help">${e(date(item.at))}</p>${runTag(item.status)}<p class="help">Bez uzavřeného místního skóre se aktivní modely nemění.</p>` : '<p class="help">Žádný závěr zatím není k dispozici.</p>', item ? button(c, 'Otevřít v historii', () => go(c, 'hunt', 'history'), { cls: 'small' }) : '');
  }).join('');
  return `<div class="hunt2-overview-live">${runCard}${logCard}</div>${jobs(c, vm)}<div class="hunt2-section-heading mv4-gap-top"><h2>Poslední závěry a doporučení</h2>${button(c, 'Celá historie', () => go(c, 'hunt', 'history'), { cls: 'small' })}</div><div class="hunt2-conclusions">${conclusions}</div>`;
}
function signalsOf(c, name) { return (c.mw.resources.get('candidates')?.data?.[0]?.candidates || []).find(x => x.name === name)?.externalSignals || []; }
const signed = b => b === null || b === undefined || !Number.isFinite(b) ? '—' : `${b > 0 ? '+' : b < 0 ? '−' : '±'}${num(Math.abs(b), 1)} b.`;
function advice(c, m) {
  if (m.fit === 'Nad odhadovaným limitem') return ['Nevejde se do VRAM', 'red'];
  const sig = signalsOf(c, m.name).filter(s => Number.isFinite(s.estimatedGainPoints));
  if (!signalsOf(c, m.name).length) return ['Bez veřejného podkladu', ''];
  const best = sig.sort((a, b) => b.estimatedGainPoints - a.estimatedGainPoints)[0];
  if (!best) return ['Ověřit místním testem', 'gold'];
  if (best.estimatedGainPoints >= 3) return ['Doporučeno pro ' + best.role, 'green'];
  if (best.estimatedGainPoints >= 0) return ['Zvážit pro ' + best.role, 'gold'];
  return ['Bez přínosu proti současným', ''];
}
function roleChips(c, m, only) {
  const sig = signalsOf(c, m.name), seen = new Set();
  const chips = sig.filter(s => !seen.has(s.role) && seen.add(s.role)).sort((a, b) => (b.role === only) - (a.role === only)).slice(0, 4);
  return chips.length ? `<span class="hunt2-model-roles mv4-role-scores">${chips.map(s => `<span class="tag mv4-role-score ${only && only !== s.role ? 'mv4-dim' : ''}">${e(s.role)} ${num(s.score, s.score % 1 ? 1 : 0)}<b class="${Number.isFinite(s.estimatedGainPoints) ? s.estimatedGainPoints >= 0 ? 'mv4-up' : 'mv4-down' : ''}">${signed(s.estimatedGainPoints)}</b></span>`).join('')}</span>` : '';
}
const quantText = q => /není doložena/.test(q) ? 'kvantizace neuvedena' : q;
function catalog(c, vm) {
  const w = c.mw, cat = vm.redesign.catalog, selected = cat.selected, grid = c.s.layout === 'grid';
  const filters = `<section class="hunt2-catalog-filters mv4-cat-filters">${input(c, 'hunt-search', 'Hledat model', cat.search, cat.setSearch, 'type="search" placeholder="Název, rodina nebo kvantizace"')}${select(c, 'hunt-role', 'Vhodná role', cat.roleOptions.map(o => [o.value, o.label]), cat.role, cat.setRole)}${select(c, 'hunt-availability', 'Dostupnost', [['notInstalled', 'Ke stažení'], ['installed', 'Stažené'], ['all', 'Všechny']], cat.availability, cat.setAvailability)}${select(c, 'hunt-sort', 'Řadit podle', [['benefit', 'Přínos pro roli'], ['score', 'Veřejné skóre role'], ['size', 'Velikost'], ['name', 'Název A–Z']], cat.sort, cat.setSort)}<div>${check(c, 'hunt-fits', 'Jen co se vejde do VRAM profilu', cat.fits, cat.setFits)}</div>${cat.protocolOptions.length > 1 ? select(c, 'hunt-protocol', 'Srovnatelný veřejný protokol', cat.protocolOptions.map(o => [o.value, o.label.replace(/ · https?:\/\/\S+/, '')]), cat.protocol, cat.setProtocol) : ''}</section><p class="help mv4-cat-note">Výchozí filtry: vejde se do VRAM a ke stažení. Veřejná skóre slouží jen k výběru kandidátů pro místní test; chybějící hodnota je —.</p>`;
  const rowHtml = m => {
    const id = 'sv4-model-' + c.modelActions.size; c.modelActions.set(id, { fn: m.select });
    const [a, tone] = advice(c, m), variants = (cat.variants || []).filter(v => v.family === m.family).length;
    return `<button type="button" class="hunt2-search-row ${m.cls ? 'hunt2-selected' : ''}" data-action="${id}" aria-pressed="${!!m.cls}"><span class="hunt2-model-glyph">${e(m.name.slice(0, 1).toUpperCase())}</span><span><strong>${e(m.name)}</strong><small>${e([m.family, /miliard/.test(m.parameters) ? m.parameters.replace(' miliard', 'B') : null, variants > 1 ? pl(variants, 'varianta', 'varianty', 'variant') : null, m.installed ? 'staženo' : 'ke stažení'].filter(Boolean).join(' · '))}</small>${roleChips(c, m, cat.role)}<span class="mv4-row-advice">${tag(a, tone)}<small>${e(quantText(m.quant))} · ${e(m.size)} · ${e(m.vram)} VRAM</small></span></span></button>`;
  };
  const sortLabel = { benefit: 'přínos pro roli', score: 'veřejné skóre role', size: 'velikost', name: 'název' }[cat.sort] || 'přínos pro roli';
  const empty = H.empty('Filtru neodpovídá žádný model.', 'Zkuste vypnout „Jen co se vejde do VRAM“ nebo zvolit Dostupnost „Všechny“.');
  const results = grid ? `<section class="mv4-cat-grid"><div class="hunt2-results-caption">${e(cat.count)} · seřazeno: ${sortLabel}</div><div class="catalog-grid">${cat.rows.map(rowHtml).join('') || empty}</div></section>`
    : `<section class="hunt2-search-results"><div class="hunt2-results-caption">${e(cat.count)} · seřazeno: ${sortLabel}</div>${cat.rows.map(rowHtml).join('') || empty}</section>`;
  let detail = card('Detail kandidáta', '<p class="help">Vyberte model z katalogu.</p>', '', 'hunt2-model-detail');
  if (cat.hasSelection) {
    const [a, tone] = advice(c, selected), sig = signalsOf(c, selected.name).filter(s => Number.isFinite(s.estimatedGainPoints)).sort((x, y) => y.estimatedGainPoints - x.estimatedGainPoints)[0];
    const bench = selected.comparisonRows.filter(r => r.score !== '—').map(r => { const s = signalsOf(c, selected.name).find(x => x.role === r.role); const b = Number.isFinite(s?.estimatedGainPoints) ? s.estimatedGainPoints : null;
      return `<tr><td><strong>${e(r.role)}</strong></td><td>${e(r.score)}<div class="cell-sub">${e(r.metric)}</div></td><td class="mono">${e(r.incumbent)}</td><td class="${b === null ? '' : b >= 0 ? 'mv4-up' : 'mv4-down'}"><strong>${signed(b)}</strong></td><td>${b === null ? tag('Ověřit testem', 'gold') : b >= 3 ? tag('Doporučeno', 'green') : b >= 0 ? tag('Zvážit', 'gold') : tag('Bez přínosu')}</td></tr>`; }).join('');
    const vars = (cat.variants.length ? cat.variants : [selected]).map(v => { const id = 'sv4-model-' + c.modelActions.size; c.modelActions.set(id, { fn: v.select });
      return `<label class="mv4-variant ${v.name === selected.name ? 'is-selected' : ''}"><input type="radio" name="hunt-variant" data-action="${id}" ${v.name === selected.name ? 'checked' : ''}><span class="mono">${e(v.name)}</span><span>${e(v.size)} na disku</span><span>≈ ${e(v.vram)} VRAM</span>${tag(v.fit === 'V odhadovaném limitu' ? 'Vejde se do VRAM' : v.fit === 'Nad odhadovaným limitem' ? 'Nevejde se' : 'VRAM neověřena', v.fit === 'V odhadovaném limitu' ? 'green' : v.fit === 'Nad odhadovaným limitem' ? 'red' : 'gold')}</label>`; }).join('');
    const sources = [...new Map(signalsOf(c, selected.name).map(s => [s.sourceUrl + s.metric, s])).values()];
    const prep = `<div class="hunt2-form-grid">${select(c, 'catalog-profile', 'Profil plánování', [['', 'Ruční · výchozí parametry'], ...w.profileRows().map(p => [p.id, p.name])], c.s.catalogProfile || '', ev => { c.s.catalogProfile = ev.target.value; const p = w.profileRows().find(x => x.id === ev.target.value); if (p) c.s.catalogSuites = { ...c.s.catalogSuites, [selected.name]: (selected.tests || []).map(t => t.role).filter(r => p.roles.includes(r)) }; c.render(true); }, 'Zařazený úkol dostane vlastní snímek parametrů.')}</div><h3>Sady použitelné pro tento model</h3><div class="hunt2-role-checks">${selected.tests.map(t => check(c, 'catalog-suite-' + t.role, t.role + ' · ' + (ROLE_SUB[t.role] || ''), !c.s.catalogSuites?.[selected.name] || c.s.catalogSuites[selected.name].includes(t.role), ev => { const chosen = c.s.catalogSuites?.[selected.name] || (selected.tests || []).map(x => x.role); c.s.catalogSuites = { ...c.s.catalogSuites, [selected.name]: ev.target.checked ? [...new Set([...chosen, t.role])] : chosen.filter(r => r !== t.role) }; c.render(true); })).join('')}</div><p class="help">Měření používá přijatý kontext 4 096 tokenů a sady backendu. Příprava otevře vypnutý profil; nic se nespouští automaticky.</p>`;
    detail = `<article class="card hunt2-model-detail"><div class="hunt2-section-heading"><div><h2>${e(selected.name)}</h2><p class="help">Rodina <strong>${e(selected.family)}</strong>${/miliard/.test(selected.parameters) ? ' · ' + e(selected.parameters.replace(' miliard', 'B')) + ' parametrů' : ''} · licence ${e(selected.license === 'Není doložena' ? 'neuvedena' : selected.license)}</p></div>${tag(selected.installed ? 'Staženo' : 'Ke stažení', selected.installed ? 'green' : 'blue')}</div>`
      + `<div class="mv4-advice">${tag(a, tone)}<span>${sig ? `Největší přínos: <strong>${e(sig.role)} ${signed(sig.estimatedGainPoints)}</strong> proti <span class="mono">${e(sig.comparisonModel || '—')}</span> (${e(sig.metric)}). Před aktivací rozhoduje lokální test role.` : 'Pro role tohoto modelu není srovnatelný veřejný podklad. Rozhodne až lokální test role.'}</span></div>`
      + (bench ? `<h3>Veřejné benchmarky podle role</h3><div class="table-wrap"><table class="data-table mv4-bench"><thead><tr><th>Role</th><th>Skóre kandidáta</th><th>Současný model role</th><th>Přínos</th><th>Doporučení</th></tr></thead><tbody>${bench}</tbody></table></div>` : '')
      + `<h3>Varianty a kvantizace</h3><div class="mv4-variants" role="radiogroup" aria-label="Varianty ke stažení">${vars}</div><p class="help">VRAM je odhad backendu pro výběr testu. Skutečnou kapacitu potvrdí test na tomto počítači.</p>${prep}`
      + `<div class="hunt2-model-actions">${button(c, 'Připravit testy vybraných sad', () => prepareCatalogTests(c, selected), { cls: 'primary', disabled: selected.prepareTestsDisabled })}${button(c, selected.installed ? 'Staženo' : 'Jen stáhnout', selected.pull, { cls: 'ghost', disabled: selected.pullDisabled, confirmation: 'Stáhnout ' + selected.name + '? Použije síť a místo na disku; přiřazení rolí se nezmění.' })}</div>${selected.downloadStatus !== '—' ? kv('Stahování', e(selected.downloadStatus)) : ''}`
      + (selected.tests.some(t => !t.disabled) ? `<h3>Místní test jednotlivé role</h3><div class="toolbar">${selected.tests.map(t => button(c, t.role, t.test, { cls: 'small', disabled: t.disabled, confirmation: 'Spustit skutečný GPU test ' + selected.name + ' pro ' + t.role + '?' })).join('')}</div>` : '')
      + `<h3>Zdroje doporučení</h3><div class="mv4-sources">${sources.length ? sources.map(s => `<div class="hunt2-public-source"><strong>${e(s.metric)} · ${e(s.referenceModel || selected.name)}</strong><span>${e(s.role)} · zdroj ověřen ${e(date(s.observedAt, false))}${s.measuredAt ? ' · měřeno ' + e(date(s.measuredAt, false)) : ''}</span><span class="mono">${e(s.sourceUrl)}</span><p>${e(s.roleMapping === 'APPLICATION_PROXY_NOT_ROLE_BENCHMARK' ? 'Pomocná metrika pro výběr testu, nikoli test této role.' : 'Reference pro prioritu testu.')}</p></div>`).join('') : '<p class="help">Bez přiřazeného veřejného zdroje.</p>'}</div><p class="help">Automatická aktivace je vypnutá; místní kvalita role zůstává „—“, dokud není změřena.</p></article>`;
  }
  return filters + `<div class="${grid ? 'mv4-cat-tiles' : 'hunt2-discovery-layout'}">${results}${detail}</div>` + externalReference(c, vm);
}
function prepareCatalogTests(c, selected) {
  const w = c.mw, choice = c.s.catalogSuites?.[selected.name], roles = (selected.tests || []).map(t => t.role).filter(r => !choice || choice.includes(r));
  if (!roles.length) { c.toast('Vyberte alespoň jednu sadu role.'); return false; }
  if (!selected.prepareTests()) return false;
  const saved = w.profileRows().find(p => p.id === c.s.catalogProfile);
  if (saved) w.profileDraft = { ...w.profileDraft, ...{ scheduleType: saved.schedule.type, at: saved.schedule.at || '', intervalMinutes: saved.schedule.intervalMinutes || 60, time: saved.schedule.time || '22:00', timezone: saved.schedule.timezone || 'Europe/Prague', weekDays: saved.schedule.weekDays || [], limit: saved.limit } };
  w.profileDraft = { ...w.profileDraft, roles, enabled: false }; w.notice = 'Připravené sady: ' + roles.join(', ') + '. Profil je vypnutý; uložení ani spuštění nebylo provedeno.'; c.s.modelTab = 'hunt'; c.s.huntTab = 'profiles'; ensure(c); return true;
}
function externalReference(c, vm) {
  const x = vm.redesign.externalReference, d = c.mw.externalDraft;
  if (!x.hasDraft) return `<div class="toolbar section-gap">${button(c, '+ Přidat veřejný podklad', x.open, { cls: 'small ghost' })}</div>`;
  const fields = [['model', 'Model'], ['role', 'Role'], ['metric', 'Metrika'], ['score', 'Skóre'], ['minimum', 'Minimum škály'], ['maximum', 'Maximum škály'], ['sourceUrl', 'Zdroj (HTTPS)'], ['measuredAt', 'Datum měření'], ['referenceModel', 'Srovnávaný model']];
  return card('Veřejný podklad', `<div class="hunt2-form-grid">${fields.map(([k, label]) => input(c, 'ref-' + k, label, d[k], ev => { if (!c.mw.busy && !c.mw.externalDraft.blocked) c.mw.externalDraft[k] = ev.target.value; }, `${x.disabled ? 'disabled' : ''}`)).join('')}</div><p class="help">Podklad určuje jen prioritu testování. Nevytváří místní skóre ani oprávnění aktivovat model.</p><div class="setting-footer">${button(c, 'Zavřít', x.close)}${button(c, 'Uložit podklad', x.save, { cls: 'primary', disabled: x.disabled })}</div>`, '', 'section-gap');
}
function profileEditor(c, vm) {
  const p = vm.redesign.profiles;
  if (!p.hasDraft) return '';
  const d = p.draft;
  const roles = d.roleOptions.map(o => check(c, 'profile-role-' + o.role, o.label, o.checked, o.change)).join('');
  const scheduling = select(c, 'profile-schedule', 'Způsob spuštění', d.scheduleOptions.map(o => [o.value, o.label]), d.scheduleType, d.setSchedule)
    + (d.dateEnabled ? input(c, 'profile-date', d.intervalEnabled ? 'Počátek intervalu' : 'Jednorázový termín', d.at, d.setAt, 'type="datetime-local"') : '')
    + (d.intervalEnabled ? input(c, 'profile-interval', 'Interval (minuty)', d.intervalMinutes, d.setInterval, 'type="number" min="60" max="10080"') : '')
    + (d.timeEnabled ? input(c, 'profile-time', 'Čas', d.time, d.setTime, 'type="time"') + input(c, 'profile-timezone', 'Časové pásmo', d.timezone, d.setTimezone) : '');
  const days = d.dayEnabled ? `<div><span class="hunt2-field-label">Dny v týdnu</span><div class="hunt2-role-checks">${d.dayOptions.map((o, i) => check(c, 'profile-day-' + i, o.label, o.checked, o.change)).join('')}</div></div>` : '';
  const models = !d.isHunt ? select(c, 'profile-model-a', d.isChallenge ? 'Model A' : 'Model', d.modelOptions.map(o => [o.value, o.label]), d.modelA, d.setModelA)
    + (d.isChallenge ? select(c, 'profile-model-b', 'Model B · kandidát', d.modelOptions.map(o => [o.value, o.label]), d.modelB, d.setModelB) : '')
    : input(c, 'profile-path', 'Umístění nových modelů', d.modelsPath, d.setModelsPath, 'placeholder="Výchozí úložiště backendu"', 'Absolutní cesta; prázdné = úložiště Ollamy.');
  return `<section class="card section-gap"><div class="card-head"><h2>${e(p.editorTitle)}</h2>${tag(d.enabled ? 'Plán povolen' : 'Plán vypnut', d.enabled ? 'green' : '')}</div><div class="hunt2-plan-form">`
    + `<div class="hunt2-form-section"><h3>Co hledat a ověřovat</h3><div class="hunt2-form-grid">${input(c, 'profile-name', 'Název profilu', d.name, d.setName, 'maxlength="200"')}${select(c, 'profile-kind', 'Typ profilu', d.kindOptions.map(o => [o.value, o.label]), d.kind, d.setKind)}${models}</div><span class="hunt2-field-label">Role a jejich sady</span><div class="hunt2-role-checks">${roles}</div></div>`
    + `<div class="hunt2-form-section"><h3>Kdy spustit</h3><div class="hunt2-form-grid">${scheduling}</div>${days}<p class="help">Spouští se jen při nečinné GPU. Pozastavení automatiky operátorem má přednost před plánem.</p></div>`
    + `<div class="hunt2-form-section"><h3>Limity a povolení</h3><div class="hunt2-form-grid">${input(c, 'profile-limit', d.isHunt ? 'Nejvýše kandidátů' : 'Nejvýše evaluací', d.limit, d.setLimit, 'type="number" min="1" max="10"')}<div>${check(c, 'profile-enabled', 'Povolit plánování profilu', d.enabled, d.setEnabled)}</div></div></div>`
    + `<div class="hunt2-form-section"><h3>Stejné podmínky měření</h3>${kv('Kontext úlohy', '4 096 tokenů · pevný protokol backendu')}${kv('Souběh', 'Sériově, jeden model naráz')}${kv('Aktivace modelu', 'Samostatné přijetí přesného artefaktu')}<p class="help">Úkol ve frontě dostane vlastní snímek parametrů; pozdější změna profilu ho nepřepíše.</p></div></div>`
    + `<div class="setting-footer">${button(c, 'Zahodit rozpracované změny', p.close, { disabled: p.disabled })}${button(c, 'Uložit profil', p.save, { cls: 'primary', disabled: p.disabled, confirmation: 'Uložit profil ' + d.name + (d.enabled ? ' a povolit jeho plánování?' : '?') })}</div></section>`;
}
function jobs(c, vm) {
  const rows = vm.redesign.jobs;
  return `<div class="hunt2-section-heading"><div><h2>Fronta a příští běhy</h2><p class="help">Hunt, evaluace a Challenge · sériové zpracování · snímek profilu při zařazení</p></div>${button(c, 'Naplánovat z profilu', () => go(c, 'hunt', 'profiles'), { cls: 'small' })}</div><div class="hunt2-queue">${rows.map((j, i) => `<article class="hunt2-queue-row"><span class="hunt2-order">${i + 1}</span><div class="hunt2-queue-main"><strong>${e(j.name)}</strong><div class="cell-sub">${e(j.at)}${j.roles ? ' · ' + e(j.roles) : ''}</div>${j.models && j.models !== '—' ? `<div class="cell-sub mono">${e(j.models.replace(/@ ?([0-9a-f]{12})[0-9a-f]+/g, '@$1'))}</div>` : ''}${j.deferred && j.deferred !== '—' ? `<div class="cell-sub">${e(j.deferred)}</div>` : ''}</div>${runTag(j.state)}<div class="hunt2-row-actions">${button(c, 'Snímek', () => { const raw = c.mw.jobRows().find(r => r.id === j.id); c.modal('Snímek úkolu', '<pre class="sv4-pre">' + e(JSON.stringify(raw, null, 2)) + '</pre>', null, null, { wide: true }); }, { cls: 'small ghost' })}${button(c, 'Zrušit', j.cancel, { cls: 'small ghost', disabled: j.cancelDisabled, confirmation: 'Zrušit čekající úkol ' + j.name + '? Spuštěný úkol se touto cestou zastavit nedá.' })}</div></article>`).join('') || H.empty('Fronta je prázdná.', 'Vyberte uložený profil a potvrďte zařazení.')}</div>`;
}
function profiles(c, vm) {
  const p = vm.redesign.profiles, grid = c.s.layout === 'grid';
  const groups = p.groups.map(g => card(g.title, `<div class="hunt2-profile-list ${grid ? 'sv4-profile-tiles' : ''}" data-layout="${c.s.layout}">${g.rows.map(r => `<div class="hunt2-profile-row"><div><strong>${e(r.name)}</strong><small>${e(r.schedule)} · ${e(r.roles)}</small><small>${e(r.state)}${r.models && r.models !== '—' ? ' · ' + e(r.models) : ''}${r.scheduleError ? ' · ' + e(r.scheduleError) : ''}</small></div><div class="toolbar">${button(c, 'Upravit', r.edit, { cls: 'small', disabled: r.disabled })}${button(c, 'Zařadit', r.queue, { cls: 'small primary', disabled: r.disabled, confirmation: 'Zařadit ' + r.name + '? Může použít disk, síť a GPU. Role se nezmění.' })}${button(c, 'Smazat', r.remove, { cls: 'small ghost', disabled: r.deleteDisabled, confirmation: 'Smazat profil ' + r.name + '? Zařazené úkoly a historie zůstanou.' })}</div></div>`).join('') || '<p class="help">Zatím žádný uložený profil. Vytvořte první.</p>'}</div>`, button(c, 'Nový profil', g.create, { cls: 'small' })));
  return `<div class="hunt2-profile-columns">${groups.join('')}</div>` + profileEditor(c, vm)
    + `<div class="hunt2-form-grid section-gap">${input(c, 'queue-at', 'Termín při ručním zařazení', p.queueAt, p.setQueueAt, 'type="datetime-local"', 'Prázdné pole = zařadit hned.')}</div>` + jobs(c, vm);
}
function huntHistory(c, vm) {
  const v = vm.redesign, h = huntData(c);
  const runs = (h?.recent || []).map(r => ({ id: r.runId, kind: KIND[r.request?.kind] || r.request?.kind || 'Hunt', status: r.status, at: r.finishedAt || r.startedAt, started: r.startedAt, finished: r.finishedAt, raw: r }))
    .concat(c.mw.jobRows().filter(j => !['QUEUED', 'RUNNING', 'LAUNCHING'].includes(j.state)).map(j => ({ id: j.id, kind: (KIND[j.profile?.kind] || 'Úkol') + ' · ' + (j.profile?.name || ''), status: j.state, at: j.at, started: j.startedAt, finished: null, raw: j })))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  const sel = runs.find(r => r.id === c.s.huntHistory) || runs[0];
  const list = runs.map(r => { const id = 'sv4-model-' + c.modelActions.size; c.modelActions.set(id, { fn: () => { c.s.huntHistory = r.id; } }); return `<button type="button" class="hunt2-history-row ${sel?.id === r.id ? 'hunt2-selected' : ''}" data-action="${id}"><span>${e((RUN[r.status] || [r.status])[0])}</span><strong>${e(r.kind)}</strong><small>${e(date(r.at))} · ${e(r.id)}</small></button>`; }).join('');
  const detail = sel ? card(sel.kind, `${kv('Stav', runTag(sel.status))}${kv('Identifikátor běhu', `<span class="mono">${e(sel.id)}</span>`)}${kv('Zahájeno', e(date(sel.started)))}${kv('Dokončeno', e(date(sel.finished)))}${kv('Doba běhu', e(duration(sel.started, sel.finished)))}${kv('Vyhodnocené úlohy', num(sel.raw.diagnostics?.evaluated || 0))}${kv('Modely', e((sel.raw.results || []).map(x => x.model || x.name).filter(Boolean).join(', ') || '—'))}<p class="sv4-run-summary">${e(sel.status === 'COLLECTION_COMPLETE' ? 'Odpovědi čekají na nezávislé posouzení; skóre zatím nevzniklo a aktivní přiřazení rolí se nemění.' : 'Běh nemění aktivní přiřazení rolí.')}</p>${sel.raw.diagnostics?.limitation ? `<p class="sv4-notice-quote">Omezení běhu: ${e(sel.raw.diagnostics.limitation)}</p>` : ''}<details class="hunt2-provenance"><summary>Úplný záznam běhu</summary><pre class="sv4-pre">${e(JSON.stringify(sel.raw, null, 2))}</pre></details>`) : card('Historie', H.empty('Hunt zatím nemá uložený běh.'));
  const stored = v.history.slice(0, 50).map(r => row([`<span class="mono">${e(r.model)}</span><div class="cell-sub">${e(r.role)}</div>`, e(r.at), stateTag(r.status === 'BLOCKED' ? 'BLOCKED' : r.status), r.score === '—' ? muted('—') : e(r.score), `<div class="sv2-cell-actions">${button(c, 'Odpovědi', r.detail, { cls: 'small ghost' })}${r.gradeDisabled ? '' : button(c, 'Posoudit', r.grade, { cls: 'small', confirmation: 'Spustit skutečné posouzení uloženého běhu dvěma hodnotiteli? Použije GPU.' })}</div>`]));
  return `<div class="hunt2-section-heading"><div><h2>Historie Huntu a Challenge</h2><p class="help">Běhy Huntu a uzavřené úkoly fronty, nejnovější nahoře.</p></div>${tag(pl(runs.length, 'záznam', 'záznamy', 'záznamů'))}</div><div class="hunt2-history-layout"><div class="hunt2-history-list">${list || H.empty('Zatím žádný běh.')}</div>${detail}</div>`
    + `<div class="section-title section-gap"><h2>Uložená měření rolí</h2><span class="muted">${pl(v.history.length, 'běh', 'běhy', 'běhů')}${v.history.length > 50 ? ' · zobrazeno posledních 50' : ''}</span></div>` + (stored.length ? table(['Model / role', 'Čas', 'Stav', 'Skóre', ''], stored) : H.empty('Zatím žádné uložené měření.')) + runDetail(c, vm);
}
function hunt(c, vm) {
  const v = vm.redesign, st = huntStatus(c), w = c.mw;
  const tabs = `<div class="hunt2-workflow-tabs" role="tablist" aria-label="GPU Hunt">${HUNT.map(([id, label]) => `<button type="button" class="tab" role="tab" aria-selected="${c.s.huntTab === id}" data-action="sv4-hunt-tab" data-tab="${id}">${e(label)}</button>`).join('')}</div>`;
  const huntError = w.resources.get('hunt')?.status === 'error' ? w.resources.get('hunt').error : '';
  const notices = [st?.h?.hold && `<strong>Automatika Huntu je pozastavená operátorem.</strong> Hunt ani plán nejde spustit, dokud pozastavení neuvolní samostatné rozhodnutí.${st.h.hold.reason ? `<span class="sv4-notice-quote">Důvod pozastavení: ${e(st.h.hold.reason)}</span>` : ''}`, v.gpuNotice && e(v.gpuNotice), huntError && c.s.huntTab === 'overview' && e(humanError(huntError))].filter(Boolean);
  const badge = st ? runTag(st.state === 'HELD' ? 'HELD' : st.running ? 'RUNNING' : 'IDLE') : tag('Stav nedostupný');
  const content = c.s.huntTab === 'catalog' ? catalog(c, vm) : c.s.huntTab === 'profiles' ? profiles(c, vm) : c.s.huntTab === 'history' ? huntHistory(c, vm) : huntOverview(c, vm);
  return `<section class="hunt2-root" aria-label="GPU Hunt"><div class="hunt2-top"><div><h2>GPU Hunt</h2><p class="help">Kandidáti, plánování, průběh a historie v jednom pracovním prostoru.</p></div>${badge}</div>${tabs}${notices.map(n => `<p class="hunt2-simulation-notice">${n}</p>`).join('')}${content}</section>`;
}

// ---------- telemetrie ----------
function telemetry(c, vm) {
  const v = vm.redesign, g = v.telemetryGraph, rows = v.telemetry || [];
  const requests = rows.reduce((n, r) => n + (Number(r.requests) || 0), 0);
  const chart = g.hasPoints ? `<svg class="mv2-chart" viewBox="0 0 700 205" role="img" aria-label="Latence dokončené odpovědi v milisekundách"><path d="M50 25v145h600" class="chart-axis"/><path d="M50 62h600M50 107h600" class="chart-grid"/><text x="5" y="12" class="chart-unit">ms</text><text x="5" y="34">${e(g.maximum)}</text><text x="24" y="175">0</text><text x="660" y="174" class="chart-unit">čas</text>${g.points.map(p => `<circle cx="${50 + p.x * 2}" cy="${25 + p.y * 1.16}" r="4" class="chart-dot"><title>${e(p.title)}</title></circle>`).join('')}<text x="50" y="196">${e(g.first)}</text><text x="650" y="196" text-anchor="end">${e(g.last)}</text></svg><p class="help">${e(g.note)}</p>` : H.empty('Ve zvoleném období není žádné měření latence.', 'Telemetrie se plní skutečnými voláními modelů.');
  return `<div class="mv2-telemetry-filter"><div>${select(c, 'telemetry-days', 'Období', [['1', 'Poslední den'], ['7', '7 dní'], ['30', '30 dní'], ['90', '90 dní']], String(v.days), v.setDays)}</div>${button(c, 'Obnovit', () => c.mw.loadExtra('telemetry', true))}</div>`
    + `<div class="metric-grid"><div class="metric"><span>Obsloužené požadavky</span><strong>${num(requests)}</strong><small>${pl(rows.length, 'kombinace', 'kombinace', 'kombinací')} model / role</small></div><div class="metric"><span>Medián latence</span><strong>${rows.length ? e(rows[0].median) : '—'}</strong><small>Nejvytíženější model ve zvoleném období</small></div><div class="metric"><span>Rychlost generování</span><strong>${rows.length ? e(rows[0].speed) : '—'}</strong><small>Výstupních tokenů za sekundu</small></div><div class="metric"><span>Správnost odpovědí</span><strong>V evaluacích</strong><small>Telemetrie neměří kvalitu</small></div></div>`
    + `<section class="card section-gap"><div class="card-head"><h2>Latence v čase</h2>${tag(pl(v.days, 'den', 'dny', 'dní'))}</div>${chart}</section>`
    + `<div class="section-title section-gap"><h2>Statistiky podle modelů</h2></div>` + (rows.length ? table(['Model / role', 'Požadavky', 'Latence medián / p95', 'Rychlost', 'Délka odpovědi'], rows.map(r => row([`<span class="mono">${e(r.model)}</span><div class="cell-sub">${e(r.role)}</div>`, e(r.requests), e(r.median) + ' / ' + e(r.latency), e(r.speed) + `<div class="cell-sub">${e(r.samples)} vzorků</div>`, e(r.length)]))) : H.empty('Zatím žádná telemetrie.'))
    + `<p class="help">${e(v.telemetryNote)}</p>`;
}

// ---------- provoz ----------
function operation(c, vm) {
  const w = c.mw, state = w.resources.get('policy')?.data?.[0], draft = w.policyDraft, info = c.data('info');
  const tabs = H.tabs([['policy', 'Provoz a parametry'], ['governor', 'Správa hardwaru'], ['upgrades', 'Změny modelů']], w.tab, 'sv4-operation-tab');
  if (w.tab !== 'policy') return tabs + (vm.rows.length ? table(['Položka', 'Popis', 'Stav', ''], vm.rows.map(r => row([`<strong>${e(r.title)}</strong>`, `<span class="help">${e(r.subtitle)}</span>`, e(r.meta), `<div class="sv2-cell-actions">${r.actions.map(a => button(c, a.label, a.go, { cls: 'small', disabled: a.disabled, confirmation: 'Provést „' + a.label + '“?' })).join('')}</div>`]))) : H.empty('Žádné položky.')) + `<div class="toolbar section-gap">${vm.buttons.map(b => button(c, b.label, b.go, { disabled: b.disabled, confirmation: b.label === 'Obnovit' ? '' : 'Provést „' + b.label + '“? Může použít síť nebo uložit rozhodnutí.' })).join('')}</div>`;
  const available = overviewData(c)?.ollamaAvailable;
  const provider = card('Poskytovatel a připojení', `${kv('Poskytovatel', e(info?.config?.provider === 'ollama' ? 'Ollama' : info?.config?.provider || '—'))}${kv('Adresa lokálního serveru', `<span class="mono">${e(info?.config?.ollama_url || '—')}</span>`)}${kv('Stav', available === true ? tag('Dostupný', 'green') : available === false ? tag('Nedostupný', 'red') : muted('—'))}${kv('Úložiště modelů', `<span class="mono">${e(overviewData(c)?.diskUsage?.modelsPath || '—')}</span>`)}<div class="toolbar">${button(c, 'Ověřit připojení', () => { w.load('overview', true); })}</div><p class="help">Adresu a úložiště určuje konfigurace služby backendu; změna vyžaduje její restart.</p>`);
  const policy = state?.valid && draft ? card('Automatizace modelů', check(c, 'policy-failover', 'Automaticky přepnout při výpadku modelu', draft.autoFailoverEnabled, ev => w.setPolicy('autoFailoverEnabled', ev.target.checked)) + check(c, 'policy-cleanup', 'Automaticky uklízet nepoužívané modely', draft.autoCleanupEnabled, ev => w.setPolicy('autoCleanupEnabled', ev.target.checked)) + `<div class="grid2">${input(c, 'policy-days', 'Uklidit po (dny nepoužívání)', draft.autoCleanupDays, ev => w.setPolicy('autoCleanupDays', Number(ev.target.value)), 'type="number" min="1" max="365"')}</div><p class="help">Pozastavení operátorem zůstává zachované. Modely přiřazené rolím se nikdy neuklízejí.</p><div class="setting-footer">${button(c, 'Uložit pravidla', () => w.savePolicy(), { cls: 'primary', disabled: w.busy, confirmation: 'Uložit provozní pravidla automatizace modelů?' })}</div>`)
    : card('Automatizace modelů', H.notice(e(state?.reason || 'Pravidla se zatím nepodařilo načíst.'), 'neutral'));
  const role = c.s.ctxRole || 'CHAT';
  if (w.roleRuntimeDraft?.role !== role && !w.busy && settingFor(c, role)?.digestSha256) w.editRoleRuntime(role);
  const picker = `<div class="toolbar mv4-role-pick" role="group" aria-label="Role">${ROLES.map(r => button(c, r, () => { c.s.ctxRole = r; w.roleRuntimeDraft = null; }, { cls: 'small ' + (r === role ? 'primary' : 'ghost'), attrs: `aria-pressed="${r === role}"` })).join('')}</div>`;
  const summary = table(['Role', 'Model', 'Nastaveno · okno / odpověď', 'Ověřený strop HW', 'Stav'], vm.summaryRoles.map(r => { const x = ctxOf(c, r.role); return row([`<strong>${e(r.role)}</strong><div class="cell-sub">${e(ROLE_SUB[r.role] || r.name)}</div>`, `<span class="mono">${e(r.model)}</span>`, `<span class="mono">${pair(x.ctx, x.out)}</span>`, x.hw ? `<span class="mono">${pair(x.hw.contextWindowTokens, x.hw.maxOutputTokens)}</span>` : muted('—'), settingFor(c, r.role)?.status === 'CONFIGURED' ? tag('Upraveno', 'green') : tag('Výchozí')]); }));
  return tabs + `<div class="grid2">${provider}${policy}</div><div class="section-title section-gap"><h2>Kontext a limit odpovědi podle role</h2></div>${picker}` + runtime(c, vm) + `<div class="section-title section-gap"><h2>Všechny role</h2></div>` + summary;
}

// ---------- směrování ----------
function render(c) {
  c.modelActions = new Map();
  const vm = c.mw.vm(c.s.layout === 'grid' ? 'dlazdice' : 'seznam', c.s.size), tab = c.s.modelTab;
  const content = ({ overview, roles, inventory, evaluations, hunt, telemetry, policy: operation })[tab] || overview;
  const gpu = gpuInfo(c);
  const headTag = gpu ? tag(`${gpu.name}${gpu.vram ? ' · ' + num(gpu.vram, 0) + ' GiB' : ''}`) : '';
  const head = H.head('Modely a inference', 'Role, lokální výsledky, dostupná kapacita a provoz.', button(c, '← Všechna nastavení', () => c.navigate('home')) + button(c, 'Obnovit', () => ensure(c, true)) + headTag, 'Nastavení / Modely', { below: H.tabs(TOP, tab, 'sv4-model-tab') });
  const statusNotes = [vm.redesign.settingsStatus, vm.redesign.profileStatus, vm.redesign.jobStatus].filter(Boolean).map(text => H.notice(e(text), 'warn')).join('');
  const status = tab === 'hunt' ? (c.mw.notice ? H.notice(e(c.mw.notice)) : '') : readStatus(c);
  return { html: head + status + statusNotes + content(c, vm) + (!['evaluations', 'hunt'].includes(tab) ? runDetail(c, vm) : ''), aside: aside(c, vm) };
}
function act(c, action, el, ev) {
  if (action === 'sv4-model-tab') { go(c, el.dataset.tab); return true; }
  if (action === 'sv4-hunt-tab') { go(c, 'hunt', el.dataset.tab); return true; }
  if (action === 'sv4-operation-tab') { c.s.operationTab = el.dataset.tab; c.mw.select(el.dataset.tab); c.render(true); return true; }
  if (action === 'sv4-model-role') { c.mw.selectedRole = el.dataset.role; go(c, 'roles'); return true; }
  if (action === 'sv4-model-detail-tab') { c.s.inventoryTab = el.dataset.tab; c.render(true); return true; }
  const item = c.modelActions?.get(action);
  if (!item) return false;
  const invoke = () => item.fn(el, ev);
  Promise.resolve(item.confirmation ? c.confirmThen(item.confirmation, invoke) : invoke()).then(() => {
    if (['hunt', 'candidates', 'history'].includes(c.mw.tab) && c.s.modelTab !== 'hunt') { c.s.modelTab = 'hunt'; c.s.huntTab = c.mw.huntTab; }
    c.render(true);
  }).catch(error => c.toast(error.message || 'Operace selhala.'));
  return true;
}
module.exports = { ensure, render, act, stateLabel, score };
