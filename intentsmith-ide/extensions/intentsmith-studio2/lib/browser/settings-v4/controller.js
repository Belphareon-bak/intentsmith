'use strict';

// Nastavení v4: ostrov ve Studiu 2 vykreslený ze šablon klikacího návrhu V4 se skutečnými daty backendu.
// Vzhled = docs/studio2/settings-v4 (návrh), data a účinky = existující klienti IDE a jejich API.
// Ostrov vlastní jen DOM uvnitř .sv4-host; React kolem něj ho nepřekresluje.

const helpers = require('./helpers');
const settingsPages = require('./pages-settings');
const modelPages = require('./pages-models');
const { IdeSettingsManagement } = require('../ide-settings-management');
const { ModelWorkspaceRedesign } = require('../model-workspace-redesign');
const { SecurityWorkspace } = require('../security-workspace');
const { FeedbackWorkspace } = require('../feedback-workspace');

// Kategorie v pořadí návrhu. Klíč je původní ID nastavení v IDE (paleta, nabídky, uložený stav).
const CATEGORIES = [
  ['ucet', 'account', 'Účet a propojení', 'Profil, účty aplikací a jejich oprávnění.', 'user'],
  ['modely', 'models', 'Modely a inference', 'Role, poskytovatelé, evaluace a GPU Hunt.', 'models'],
  ['pamet', 'memory', 'Paměť', 'Historie, kontext a ukládání poznatků.', 'memory'],
  ['oznameni', 'notifications', 'Oznámení', 'Desktop, Discord, Telegram a pravidla doručování.', 'bell'],
  ['vystup', 'output', 'Výstup', 'Jazyk, formát a délka odpovědí.', 'file'],
  ['vzhled', 'appearance', 'Vzhled', 'Paleta, písmo a hustota pracovního prostoru.', 'palette'],
  ['system', 'system', 'Systém', 'Spouštění, pracovní limity a diagnostika.', 'settings'],
  ['uloziste', 'storage', 'Úložiště', 'Cesty k datům, kapacita a databáze.', 'database'],
  ['zalohy', 'backups', 'Zálohy', 'Vytváření, retence a přehled jednotlivých záloh.', 'clock'],
  ['git', 'repositories', 'Repozitáře a přístupy', 'Repozitáře, výchozí cesty, klíče a oprávnění.', 'git'],
  ['prepinace', 'features', 'Funkční přepínače', 'Dostupné funkce a jejich aktivace.', 'worker'],
  ['zabezpeceni', 'security', 'Zabezpečení', 'Oprávnění, přístup a přehled připojení.', 'shield'],
  ['about', 'about', 'O aplikaci', 'Verze, běžící služby a diagnostické informace.', 'info']
];
const PAGE_OF = Object.fromEntries(CATEGORIES.map(c => [c[0], c[1]]));
const ID_OF = Object.fromEntries(CATEGORIES.map(c => [c[1], c[0]]));
const RESOURCES = {
  settings: '/api/settings', features: '/api/features', info: '/api/system/info', health: '/api/health',
  gpu: '/api/system/gpu', storage: '/api/system/storage', storageSettings: '/api/system/storage/settings',
  notifLog: '/api/notifications/log?limit=20', diagnostics: '/api/system/diagnostics', bindings: '/api/system/upgrades/bindings'
};
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

class SettingsV4 {
  constructor({ backendUrl, fetchImpl = (...args) => fetch(...args), appearance = null, bus = null, navigate = () => {},
    openProjectWizard = null, version = () => null, lastResponse = () => '', now = () => Date.now(), services = null } = {}) {
    this.backendUrl = backendUrl;
    this.fetchImpl = fetchImpl;
    this.appearance = appearance;
    this.bus = bus;
    this.onNavigate = navigate;
    this.openProjectWizard = openProjectWizard;
    this.now = now;
    this.s = { page: 'home', modelTab: 'overview', huntTab: 'overview', layout: 'list', size: 2 };
    this.res = new Map();
    this.drafts = new Map();
    this.modals = [];
    this.approved = false;
    this.busy = new Set();
    this.host = null; this.el = null; this.rendered = '';
    this.frame = 0; this.toastTimer = null; this.destroyed = false;
    this.busListeners = [];
    const onChange = () => this.schedule();
    const confirmAsync = message => this.confirm(message);
    // Služby modelů a zabezpečení čtou potvrzení synchronně. Ostrov se ptá dialogem návrhu předem
    // a službě předá jednorázový souhlas, který se spotřebuje v témže synchronním kroku (approved()).
    const confirmToken = () => { const ok = this.approved; this.approved = false; return ok; };
    this.ownsServices = !services;
    this.sm = services?.sm || new IdeSettingsManagement({ backendUrl, fetchImpl, confirmAction: confirmAsync, onChange });
    this.mw = services?.mw || new ModelWorkspaceRedesign({ backendUrl, fetchImpl, confirmAction: confirmToken, onChange });
    this.sec = services?.sec || new SecurityWorkspace({ backendUrl, fetchImpl, confirmAction: confirmToken, onChange });
    this.fb = services?.fb || new FeedbackWorkspace({ backendUrl, fetchImpl, onChange, version, lastResponse });
    this.serviceRestore = [];
    if (services) for (const service of [this.sm, this.mw, this.sec, this.fb]) {
      const prior = service.onChange, confirm = service.confirmAction;
      service.onChange = () => { prior?.(); onChange(); };
      if (service === this.sm) service.confirmAction = confirmAsync;
      if (service === this.mw || service === this.sec) service.confirmAction = confirmToken;
      this.serviceRestore.push(() => { service.onChange = prior; service.confirmAction = confirm; });
    }
    const H = { ...helpers };
    H.toast = text => this.toast(text);
    H.modal = (title, body, submitLabel, onSubmit, options) => this.modal(title, body, submitLabel, onSubmit, options);
    H.closeModal = () => this.closeModal();
    H.render = () => this.render(true);
    H.navigate = (page, tab) => this.navigate(page, tab);
    H.confirm = (message, options) => this.confirm(message, options);
    this.H = H;
  }

  // ---------- připojení k Reactu ----------
  attach(host) {
    if (this.destroyed || !host) return;
    if (this.host === host && this.el?.isConnected) return;
    this.detach();
    this.host = host;
    const el = host.ownerDocument.createElement('div');
    el.className = 'sv4';
    el.innerHTML = '<div class="sv4-root"></div><div class="sv4-modal-root"></div><div class="sv4-toast" role="status" aria-live="polite"></div>';
    host.appendChild(el);
    this.el = el;
    this.listeners = [['click', ev => this.onClick(ev)], ['submit', ev => this.onSubmit(ev)], ['change', ev => this.onChange(ev)],
      ['input', ev => this.onInput(ev)], ['keydown', ev => this.onKey(ev)]];
    for (const [type, fn] of this.listeners) el.addEventListener(type, fn);
    if (this.bus && !this.busListeners.length) {
      for (const [name, fn] of [['model:changed', () => { this.mw.load('roles', true); this.mw.load('overview', true); this.load('bindings', true); }],
        ['upgrade:verify_failed', event => this.mw.onVerifyFailure(event)], ['upgrade:verify_cleared', event => this.mw.onVerifyCleared(event)]]) {
        this.bus.on(name, fn); this.busListeners.push([name, fn]);
      }
    }
    this.rendered = '';
    this.ensure(this.s.page);
    this.render(true);
  }
  detach() {
    if (!this.el) return;
    for (const [type, fn] of this.listeners || []) this.el.removeEventListener(type, fn);
    this.captureDrafts();
    this.closeAllModals();
    this.el.remove();
    this.el = null; this.host = null;
  }
  destroy() {
    this.detach();
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    clearTimeout(this.toastTimer);
    for (const [name, fn] of this.busListeners) this.bus?.off?.(name, fn);
    this.busListeners = [];
    for (const restore of this.serviceRestore) restore();
    if (this.ownsServices) for (const service of [this.sm, this.mw, this.sec, this.fb]) service.destroy?.();
  }
  // Volá se po každém překreslení Reactu: stránka z uloženého stavu IDE, seznam/dlaždice a velikost z horní lišty.
  sync({ id = null, view = 'seznam', size = 2 } = {}) {
    const page = id && PAGE_OF[id] ? PAGE_OF[id] : 'home';
    const layout = view === 'dlazdice' ? 'grid' : 'list';
    const changed = page !== this.s.page || layout !== this.s.layout || size !== this.s.size;
    if (page !== this.s.page) { this.captureDrafts(); this.s.page = page; this.ensure(page); if (this.el) this.el.querySelector('.sv4-root').scrollTop = 0; this.scrollReset = true; }
    this.s.layout = layout; this.s.size = size;
    if (changed) this.render(true);
  }
  // Seznam/dlaždice má smysl jen na stránkách s položkami (bod 1 V4); jinde horní lišta přepínač zašedne.
  layoutAvailable() {
    const p = this.s.page;
    return ['home', 'account', 'notifications', 'storage', 'backups', 'repositories'].includes(p)
      || p === 'models' && (this.s.modelTab === 'inventory' || this.s.modelTab === 'hunt' && ['catalog', 'profiles'].includes(this.s.huntTab));
  }
  navigate(page, tab) {
    if (page === 'models' && tab) this.s.modelTab = tab;
    if (page === 'hunt') { page = 'models'; this.s.modelTab = 'hunt'; if (tab) this.s.huntTab = tab; }
    const id = page === 'home' ? null : ID_OF[page];
    if (page !== 'home' && !id) return;
    this.closeAllModals();
    this.onNavigate(id);
    // Stav IDE je zdroj pravdy; sync() po překreslení Reactu stránku přepne. Bez Reactu (testy) přepni hned.
    this.sync({ id, view: this.s.layout === 'grid' ? 'dlazdice' : 'seznam', size: this.s.size });
    this.render(true);
  }
  ensure(page) {
    const sm = c => this.sm.load(c);
    const loads = {
      home: () => { sm('ucet'); sm('oznameni'); sm('zalohy'); sm('git'); },
      account: () => { sm('ucet'); sm('git'); },
      notifications: () => { sm('oznameni'); this.load('notifLog'); this.load('settings'); },
      storage: () => { sm('uloziste'); this.load('storage'); this.load('storageSettings'); },
      backups: () => { sm('zalohy'); sm('uloziste'); },
      repositories: () => { sm('git'); sm('uloziste'); },
      memory: () => { this.load('settings'); this.load('storageSettings'); },
      output: () => { this.load('settings'); },
      system: () => { this.load('info'); this.load('health'); this.load('gpu'); },
      features: () => { this.load('features'); },
      security: () => { this.sec.load('all'); sm('ucet'); },
      about: () => { this.load('health'); this.load('info'); this.load('storage'); },
      models: () => modelPages.ensure(this)
    };
    (loads[page] || (() => {}))();
  }

  // ---------- data ----------
  base() {
    const value = this.backendUrl?.();
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) throw Object.assign(Error('Backend není dostupný.'), { code: 'BACKEND_UNAVAILABLE' });
    return value;
  }
  async api(method, path, body, timeout = 30_000) {
    const backend = this.base();
    const response = await this.fetchImpl(backend + path, { method, credentials: 'same-origin', signal: AbortSignal.timeout(timeout),
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    let data = null;
    try { data = await response.json(); } catch { /* Stav HTTP rozhoduje. */ }
    if (this.base() !== backend) throw Object.assign(Error('Backend se změnil. Obnovte stránku před další akcí.'), { code: 'IDE_BACKEND_CHANGED' });
    if (!response.ok) {
      const code = typeof data?.code === 'string' ? data.code : 'HTTP_' + response.status;
      const message = typeof data?.error === 'string' && data.error.length <= 500 ? data.error : typeof data?.message === 'string' ? data.message : '';
      throw Object.assign(Error(message || code), { code, status: response.status });
    }
    return data;
  }
  resource(key) { return this.res.get(key) || { status: 'idle' }; }
  data(key) { const r = this.res.get(key); return r?.status === 'ready' || r?.data ? r.data : null; }
  async load(key, refresh = false) {
    const path = RESOURCES[key];
    if (!path) return false;
    const current = this.res.get(key);
    if (!refresh && current && ['ready', 'loading'].includes(current.status)) return current.status === 'ready';
    const token = Symbol(key);
    this.res.set(key, { status: 'loading', token, data: current?.data || null });
    this.schedule();
    try {
      const data = await this.api('GET', path, undefined, key === 'diagnostics' ? 30_000 : 15_000);
      if (!plain(data)) throw Object.assign(Error('Backend vrátil neplatná data.'), { code: 'RESPONSE_INVALID' });
      if (this.res.get(key)?.token === token) this.res.set(key, { status: 'ready', data });
      return true;
    } catch (error) {
      if (this.res.get(key)?.token === token) this.res.set(key, { status: 'error', error: error.message || error.code, data: current?.data || null });
      return false;
    } finally { this.schedule(); }
  }
  // Dvoufázový zápis: běžící operace blokuje opakování, výsledek ověřuje nové čtení (verify).
  async run(key, label, effect, success) {
    if (this.busy.has(key)) return false;
    this.busy.add(key); this.render(true);
    try {
      const result = await effect();
      if (result === false) return false;
      this.toast(typeof success === 'function' ? success(result) : success || label + ' · ověřeno v backendu.');
      return true;
    } catch (error) {
      const unsure = !error.status || error.status >= 500;
      this.toast(label + (unsure ? ' · výsledek není jistý: ' : ' · neprovedeno: ') + (error.message || error.code || 'neznámá chyba') + (unsure ? '. Obnovte stav před opakováním.' : ''));
      return false;
    } finally { this.busy.delete(key); this.render(true); }
  }
  isBusy(key) { return this.busy.has(key); }
  approvedCall(fn) { this.approved = true; try { return fn(); } finally { this.approved = false; } }
  async confirmThen(message, fn, options) { if (!await this.confirm(message, options)) return false; return this.approvedCall(fn); }

  // ---------- vykreslení ----------
  schedule() {
    if (this.destroyed || !this.el || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(false); });
  }
  category(page = this.s.page) { return CATEGORIES.find(c => c[1] === page); }
  view() {
    const page = this.s.page;
    if (page === 'models') return modelPages.render(this);
    return { html: settingsPages.render(this, page) };
  }
  render(force) {
    if (!this.el || this.destroyed) return;
    let out;
    try { out = this.view(); }
    catch (error) { out = { html: helpers.head('Nastavení', 'Stránku se nepodařilo vykreslit.') + `<div class="sv4-error" role="alert"><span>${helpers.e(error.message)}</span></div>` }; console.error('[settings-v4]', error); }
    const html = `<div class="content" id="sv4-content">${out.html}</div>${out.aside ? `<aside class="inspector" aria-label="Stručný přehled">${out.aside}</aside>` : ''}`;
    const key = this.s.page + '|' + this.s.modelTab + '|' + this.s.huntTab;
    if (!force && html === this.rendered) return;
    const root = this.el.querySelector('.sv4-root');
    const content = root.querySelector('.content');
    const scroll = this.scrollReset || this.renderedKey !== key ? 0 : content?.scrollTop || 0;
    this.scrollReset = false;
    this.captureDrafts();
    const active = this.el.ownerDocument.activeElement;
    const focus = active && root.contains(active) && active.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    root.className = 'sv4-root' + (out.aside ? ' has-aside' : '');
    root.innerHTML = html;
    this.rendered = html; this.renderedKey = key;
    this.restoreDrafts();
    for (const label of root.querySelectorAll('.field>label:not([for])')) {
      const control = label.parentElement.querySelector('input,select,textarea');
      if (control?.id) label.htmlFor = control.id;
    }
    const next = root.querySelector('.content');
    if (next) next.scrollTop = scroll;
    const target = focus && root.querySelector('#' + cssEscape(focus.id));
    if (target) { target.focus({ preventScroll: true }); try { if (Number.isInteger(focus.start)) target.setSelectionRange(focus.start, focus.end); } catch { /* Ne každé pole má výběr. */ } }
    this.el.style.setProperty('--row', [32, 42, 54][this.s.size - 1] + 'px');
    this.el.style.setProperty('--tile', [200, 250, 330][this.s.size - 1] + 'px');
  }
  // Rozepsané hodnoty polí (bez data-live) přežijí překreslení po načtení dat; ukládající akce je maže.
  captureDrafts() {
    const root = this.el?.querySelector('.sv4-root');
    if (!root) return;
    for (const control of root.querySelectorAll('input[id],select[id],textarea[id]')) {
      if (control.dataset.live !== undefined || control.type === 'file') continue;
      const original = control.type === 'checkbox' || control.type === 'radio' ? control.defaultChecked : control.defaultValue;
      const value = control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value;
      if (control.tagName === 'SELECT') {
        const selected = [...control.options].find(option => option.defaultSelected);
        if ((selected ? selected.value : control.options[0]?.value) === value) { this.drafts.delete(control.id); continue; }
      } else if (value === original) { this.drafts.delete(control.id); continue; }
      this.drafts.set(control.id, { value, tag: control.tagName, type: control.type });
    }
  }
  restoreDrafts() {
    const root = this.el?.querySelector('.sv4-root');
    for (const [id, draft] of this.drafts) {
      const control = root?.querySelector('#' + cssEscape(id));
      if (!control || control.tagName !== draft.tag || control.type !== draft.type) continue;
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = draft.value; else control.value = draft.value;
    }
  }
  clearDrafts(prefix = '') {
    // Aktualizuj výchozí hodnoty živých polí, aby následné render() nevrátilo právě uložený draft.
    for (const control of this.el?.querySelectorAll('.sv4-root input[id],.sv4-root select[id],.sv4-root textarea[id]') || []) {
      if (!control.id.startsWith(prefix)) continue;
      if (control.type === 'checkbox' || control.type === 'radio') control.defaultChecked = control.checked;
      else if (control.tagName === 'SELECT') for (const option of control.options) option.defaultSelected = option.selected;
      else control.defaultValue = control.value;
    }
    for (const id of [...this.drafts.keys()]) if (id.startsWith(prefix)) this.drafts.delete(id);
  }
  value(id) { const control = this.el?.querySelector('#' + cssEscape(id)); return control ? control.type === 'checkbox' ? control.checked : control.value : undefined; }
  form(id) { return this.el?.querySelector('#' + cssEscape(id)); }

  // ---------- dialogy a hlášení návrhu ----------
  toast(text) {
    const el = this.el?.querySelector('.sv4-toast');
    if (!el) return;
    el.textContent = text; el.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('visible'), Math.min(9000, 3500 + String(text).length * 25));
  }
  modal(title, body, submitLabel, onSubmit, { danger = false, wide = false } = {}) {
    if (!this.el) return;
    const id = 'sv4-modal-' + (this.modals.length + 1);
    const { e, icon, button } = helpers;
    const html = `<div class="modal-backdrop" data-modal="${id}"><form class="modal${wide ? ' sv4-modal-wide' : ''}" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" novalidate><div class="modal-head"><h2 id="${id}-title">${e(title)}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="Zavřít dialog">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-footer">${button(submitLabel ? 'Zrušit' : 'Zavřít', 'close-modal')}${submitLabel ? `<button type="submit" class="button ${danger ? 'danger' : 'primary'}">${e(submitLabel)}</button>` : ''}</div></form></div>`;
    const doc = this.el.ownerDocument;
    const returnFocus = doc.activeElement;
    this.modals.push({ id, onSubmit, returnFocus });
    this.el.querySelector('.sv4-modal-root').insertAdjacentHTML('beforeend', html);
    this.el.querySelector('.sv4-root').inert = true;
    for (const prior of this.el.querySelectorAll('.modal-backdrop')) prior.inert = prior.dataset.modal !== id;
    const form = this.el.querySelector('#' + id);
    for (const label of form.querySelectorAll('.field>label:not([for])')) {
      const control = label.parentElement.querySelector('input,select,textarea');
      if (control) { control.id ||= id + '-' + Math.random().toString(36).slice(2, 8); label.htmlFor = control.id; }
    }
    (form.querySelector('input:not([type=checkbox]):not([type=hidden]),select,textarea') || form.querySelector('button[type=submit]') || form.querySelector('button'))?.focus();
    return form;
  }
  closeModal(result) {
    const top = this.modals.pop();
    if (!top) return;
    this.el?.querySelector(`[data-modal="${top.id}"]`)?.remove();
    top.resolve?.(result === true);
    const next = this.modals[this.modals.length - 1];
    if (next) this.el.querySelector(`[data-modal="${next.id}"]`).inert = false;
    else if (this.el) this.el.querySelector('.sv4-root').inert = false;
    if (top.returnFocus?.isConnected) top.returnFocus.focus();
  }
  closeAllModals() { while (this.modals.length) this.closeModal(false); }
  confirm(message, { title = 'Potvrzení', ok = 'Potvrdit', danger = false } = {}) {
    if (!this.el) return Promise.resolve(false);
    return new Promise(resolve => {
      const body = String(message).split('\n').filter(Boolean).map(line => `<p>${helpers.e(line)}</p>`).join('');
      this.modal(title, body, ok, () => { this.closeModal(true); return false; }, { danger });
      this.modals[this.modals.length - 1].resolve = resolve;
    });
  }

  // ---------- události ----------
  onClick(ev) {
    const el = ev.target.closest('[data-action]');
    if (!el || !this.el.contains(el) || el.disabled) return;
    if (el.tagName === 'A') ev.preventDefault();
    this.handle(el.dataset.action, el, ev);
  }
  onSubmit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const top = this.modals[this.modals.length - 1];
    if (top && form.id === top.id) {
      if (top.busy) return;
      top.busy = true;
      const submitButton = form.querySelector('button[type=submit]');
      if (submitButton) submitButton.disabled = true;
      Promise.resolve(top.onSubmit?.(form)).then(result => { if (result !== false && this.modals[this.modals.length - 1] === top) this.closeModal(true); })
        .catch(error => this.toast(error.message || 'Akci se nepodařilo dokončit.'))
        .finally(() => { top.busy = false; if (submitButton?.isConnected) submitButton.disabled = false; });
      return;
    }
    const submit = form.querySelector('[data-submit]') || form.querySelector('button.primary[data-action]');
    if (submit) this.handle(submit.dataset.action, submit, ev);
  }
  onChange(ev) {
    const el = ev.target;
    if (el.dataset.change) this.handle(el.dataset.change, el, ev);
  }
  onInput(ev) {
    const el = ev.target;
    if (el.dataset.input) this.handle(el.dataset.input, el, ev);
  }
  onKey(ev) {
    const tab = ev.target.closest('[role=tab]');
    if (tab && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const items = [...tab.parentElement.querySelectorAll('[role=tab]')], index = items.indexOf(tab);
      const next = ev.key === 'Home' ? items[0] : ev.key === 'End' ? items.at(-1) : items[(index + (ev.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
      next.focus(); next.click();
      return;
    }
    if (ev.key === 'Escape' && this.modals.length) { ev.preventDefault(); ev.stopPropagation(); this.closeModal(false); return; }
    if (ev.key === 'Tab' && this.modals.length) {
      const form = this.el.querySelector('#' + this.modals[this.modals.length - 1].id);
      const els = [...form.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(x => x.getClientRects().length);
      if (!els.length) return;
      if (ev.shiftKey && ev.target === els[0]) { ev.preventDefault(); els.at(-1).focus(); }
      else if (!ev.shiftKey && ev.target === els.at(-1)) { ev.preventDefault(); els[0].focus(); }
    }
  }
  handle(action, el, ev) {
    try {
      if (action === 'close-modal') { this.closeModal(false); return; }
      if (action === 'settings-home') { this.navigate('home'); return; }
      if (action === 'settings-open') { this.navigate(el.dataset.settings); return; }
      if (action === 'retry') { this.retry(); return; }
      if (this.s.page === 'models' && modelPages.act(this, action, el, ev)) return;
      if (settingsPages.act(this, action, el, ev)) return;
    } catch (error) {
      this.toast(error.message || 'Akci se nepodařilo dokončit.');
      console.error('[settings-v4]', error);
    }
  }
  retry() {
    for (const [key, value] of this.res) if (value.status === 'error') this.load(key, true);
    const category = { account: ['ucet', 'git'], notifications: ['oznameni'], storage: ['uloziste'], backups: ['zalohy', 'uloziste'], repositories: ['git', 'uloziste'], security: ['ucet'], home: ['ucet', 'oznameni', 'zalohy', 'git'] }[this.s.page] || [];
    for (const c of category) this.sm.load(c, true);
    if (this.s.page === 'security') this.sec.load('all', true);
    if (this.s.page === 'models') modelPages.ensure(this, true);
  }
}

function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

module.exports = { SettingsV4, CATEGORIES, PAGE_OF, ID_OF };
