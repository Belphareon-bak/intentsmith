'use strict';

// Real IDE API adapter. Construction and vm() are inert; callbacks are the only
// writers. The caller supplies the Studio authenticated fetch and confirmations.
const CATEGORIES = new Set(['ucet', 'oznameni', 'uloziste', 'zalohy', 'git']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const ACCOUNT_EVENTS = ['worker', 'lifecycle'];
const BACKUP_SECTIONS = ['database', 'config', 'skills', 'specialists'];
const WEB_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']);
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 4096) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f]/.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (v, names) => Object.fromEntries(names.map(k => [k, v[k]]));
const endpoint = (prefix, id) => prefix + encodeURIComponent(String(id));
const bytes = n => Number.isFinite(n) && n >= 0 ? (n / 1048576).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' MiB' : 'Nezjištěno';
const count = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const meta = (label, value) => ({ label, value: String(value ?? 'Nezjištěno') });
const fail = (code, status = 0, userMessage = '') => Object.assign(new Error(code), { code, status, userMessage });
const freshId = prefix => prefix+'_'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12));
const noop = () => {};

// Canonical offline Component fallback. Every non-loop template path exists;
// lists are empty, callbacks inert, and it claims no live backend data.
function emptyManagementVM() {
  return { title: '', description: '', sections: [], primary: [], loading: false, hasError: false, error: '', busy: false,
    refreshDisabled: true, refresh: noop, notice: '', hasNotice: false, layoutClass: 'im-grid', sizeClass: 'im-size-2',
    editor: { visible: false, title: '', fields: [], notice: '', saveDisabled: true, save: noop, cancelDisabled: true, cancel: noop },
    identity:{visible:false,name:'',email:'',description:'',state:'',edit:noop,disabled:true},
    hasDetail: false, detail: { title: '', rows: [] }, closeDetail: noop };
}

// Never turn a transport URL containing credentials into visible text/a link.
function remoteWebUrl(raw) {
  if (!text(raw) || !raw) return '';
  let host = '', pathname = '';
  try {
    if (/^https:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.username || url.password || url.search || url.hash || url.port || !WEB_HOSTS.has(url.hostname.toLowerCase())) return '';
      host = url.hostname.toLowerCase(); pathname = url.pathname;
    } else if (/^ssh:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.username !== 'git' || url.password || url.search || url.hash || url.port && url.port !== '22' || !WEB_HOSTS.has(url.hostname.toLowerCase())) return '';
      host = url.hostname.toLowerCase(); pathname = url.pathname;
    } else {
      const match = /^git@([a-zA-Z0-9.-]+):([^?#]+)$/.exec(raw);
      if (!match || !WEB_HOSTS.has(match[1].toLowerCase())) return '';
      host = match[1].toLowerCase(); pathname = '/' + match[2];
    }
    const segments = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    if (segments.length < 2 || segments.some(part => !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(part) || part === '.' || part === '..')) return '';
    segments[segments.length - 1] = segments.at(-1).replace(/\.git$/i, '');
    if (!segments.at(-1) || !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(segments.at(-1))) return '';
    return 'https://' + host + '/' + segments.map(encodeURIComponent).join('/');
  } catch { return ''; }
}

function assertList(data, key, validator, limit = 1000) {
  if (!plain(data) || !Array.isArray(data[key]) || data[key].length > limit || data[key].some(v => !plain(v) || !validator(v))) throw fail('IDE_RESPONSE_INVALID');
  return data[key];
}
function assertDocument(v) {
  if (!plain(v) || !text(v.id, 100) || !ID.test(v.id) || !revision(v.revision)) throw fail('IDE_RESPONSE_INVALID');
  return v;
}
const accountValid = a => ID.test(a.id || '') && revision(a.revision) && text(a.name, 200)
  && ['telegram', 'discord'].includes(a.provider) && text(a.recipient, 100) && text(a.credentialEnv, 100)
  && typeof a.enabled === 'boolean' && typeof a.credentialConfigured === 'boolean'
  && a.connectionStatus === 'NOT_VERIFIED' && Array.isArray(a.events) && new Set(a.events).size === a.events.length
  && a.events.every(e => ACCOUNT_EVENTS.includes(e));
const profileValid = p => ID.test(p.id || '') && revision(p.revision) && text(p.name, 200) && text(p.host, 253)
  && text(p.user, 64) && Number.isSafeInteger(p.port) && p.port > 0 && p.port < 65536
  && text(p.identityFile) && text(p.knownHostsFile);
const backupValid = b => ID.test(b.name || '') && revision(b.revision) && text(b.note, 2000)
  && typeof b.archived === 'boolean' && Array.isArray(b.sections) && b.sections.every(s => BACKUP_SECTIONS.includes(s))
  && Array.isArray(b.restore_scope) && text(b.content_fingerprint || '', 100);

class IdeSettingsManagement {
  constructor({ backendUrl, fetchImpl, confirmAction, onChange = () => {} } = {}) {
    if (typeof backendUrl !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('Management requires the Studio authenticated fetch and backendUrl');
    this.backendUrl = backendUrl; this.fetchImpl = fetchImpl; this.confirmAction = confirmAction; this.onChange = onChange;
    this.resources = new Map(); this.editors = new Map(); this.notices = new Map(); this.requests = new Set();
    this.busy = new Set(); this.destroyed = false; this.sequence = new Map(); this.details = new Map();
  }
  changed() { if (!this.destroyed) this.onChange(); }
  sourceIdentity() {
    try {
      const url = new URL(this.backendUrl());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('IDE_BACKEND_UNAVAILABLE');
      return url.origin;
    } catch { throw fail('IDE_BACKEND_UNAVAILABLE'); }
  }
  async request(method, route, body, source = this.sourceIdentity()) {
    if (this.destroyed) throw fail('IDE_VIEW_CLOSED');
    if (this.sourceIdentity() !== source) throw fail('IDE_BACKEND_CHANGED');
    const controller = new AbortController(); this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await this.fetchImpl(source + route, { method, credentials: 'same-origin', signal: controller.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      let data;
      try { data = await response.json(); } catch { throw fail('IDE_RESPONSE_INVALID', response.status); }
      if (this.destroyed) throw fail('IDE_VIEW_CLOSED');
      if (this.sourceIdentity() !== source) throw fail('IDE_BACKEND_CHANGED');
      if (!response.ok) throw fail(typeof data?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(data.code) ? data.code : 'IDE_REQUEST_FAILED', response.status,
        typeof data?.error==='string'&&data.error.length<=500&&!/[\x00-\x1f]/.test(data.error)?data.error:'Požadavek nebyl přijat. Zkontrolujte vyplněné údaje.');
      if (!plain(data)) throw fail('IDE_RESPONSE_INVALID', response.status);
      return data;
    } finally { clearTimeout(timeout); this.requests.delete(controller); }
  }
  destroy() { this.destroyed = true; for (const request of this.requests) request.abort(); this.requests.clear(); }
  async read(category, source = this.sourceIdentity()) {
    const get = path => this.request('GET', path, undefined, source);
    if (category === 'ucet') {
      const data = await get('/api/accounts');
      const accounts = assertList(data, 'accounts', accountValid);
      if (!equal(data.supportedEvents, ACCOUNT_EVENTS)) throw fail('IDE_RESPONSE_INVALID');
      const profile=data.profile;
      if(profile!==undefined&&(!plain(profile)||profile.id!=='default'||!revision(profile.revision)||!text(profile.displayName,200)||!text(profile.email,254)||!text(profile.description,2000)))throw fail('IDE_RESPONSE_INVALID');
      return { accounts, profile };
    }
    if (category === 'oznameni') {
      const [accounts, channels, email] = await Promise.all([this.read('ucet', source), get('/api/notifications/channels'), get('/api/notifications/config')]);
      const rows = assertList(channels, 'channels', c => text(c.name, 100) && typeof c.configured === 'boolean', 100);
      if (typeof email.emailEnabled !== 'boolean' || !text(email.smtpHost, 512) || !text(email.emailRecipient, 512)) throw fail('IDE_RESPONSE_INVALID');
      // Project only public state; smtpPass (even its masked representation) is not retained.
      return { ...accounts, channels: rows.map(c => pick(c, ['name', 'configured'])), email: pick(email, ['emailEnabled', 'smtpHost', 'smtpPort', 'smtpFrom', 'emailRecipient', 'emailOnLifecycle', 'emailOnWorker', 'credentialPersistence']) };
    }
    if (category === 'uloziste') {
      const [inventory, paths] = await Promise.all([get('/api/system/storage/inventory'), get('/api/system/storage/paths')]);
      assertDocument(paths);
      if (paths.id !== 'default' || !text(paths.projects)) throw fail('IDE_RESPONSE_INVALID');
      assertList(inventory, 'disks', d => text(d.mountPoint) && text(d.type, 100) && ['OBSERVED', 'UNAVAILABLE'].includes(d.status));
      assertList(inventory, 'locations', l => text(l.kind, 100) && (l.status==='UNKNOWN'?l.path===null:text(l.path)) && ['COMPLETE', 'PARTIAL', 'MISSING', 'UNAVAILABLE','UNKNOWN'].includes(l.status));
      assertList(inventory, 'databases', d => text(d.name, 100) && d.engine === 'SQLite' && text(d.version, 100) && Number.isFinite(d.allocatedBytes));
      return { inventory, paths };
    }
    if (category === 'zalohy') {
      const [list, settings, effective] = await Promise.all([get('/api/system/backups'), get('/api/settings'), get('/api/system/storage/settings')]);
      const b = effective.backup;
      if (!plain(b) || !Number.isSafeInteger(b.max_daily) || b.max_daily < 1 || b.max_daily > 30
        || !Number.isSafeInteger(b.max_weekly) || b.max_weekly < 1 || b.max_weekly > 12
        || typeof b.on_startup !== 'boolean' || typeof b.on_shutdown !== 'boolean') throw fail('IDE_RESPONSE_INVALID');
      return { backups: assertList(list, 'backups', backupValid), settings, backupPolicy: pick(b, ['max_daily', 'max_weekly', 'on_startup', 'on_shutdown']) };
    }
    if (category === 'git') {
      const [registry, profiles] = await Promise.all([get('/api/scm/repositories'), get('/api/scm/profiles')]);
      const repositories = assertList(registry, 'repositories', r => Number.isSafeInteger(r.id) && r.id > 0 && text(r.name, 200)
        && text(r.path) && Array.isArray(r.remotes) && r.remotes.every(m => plain(m) && text(m.name, 100) && (m.url === null || text(m.url)))
        && ['OBSERVED', 'UNAVAILABLE'].includes(r.status) && (!r.profile || ID.test(r.profile.id) && revision(r.profile.revision)));
      return { repositories, profiles: assertList(profiles, 'profiles', profileValid), defaultProjectsPath: text(registry.defaultProjectsPath) ? registry.defaultProjectsPath : '' };
    }
    throw fail('IDE_CATEGORY_INVALID');
  }
  async load(category, refresh = false, expectedSource = null) {
    if (!CATEGORIES.has(category) || this.destroyed) return false;
    let source;
    try { source = this.sourceIdentity(); if (expectedSource && source !== expectedSource) throw fail('IDE_BACKEND_CHANGED'); }
    catch (error) { this.resources.set(category, { status: 'error', error: error.code }); this.changed(); return false; }
    const previous = this.resources.get(category);
    if (!refresh && previous?.source === source && ['loading', 'ready'].includes(previous?.status)) return true;
    const seq = (this.sequence.get(category) || 0) + 1; this.sequence.set(category, seq);
    this.resources.set(category, { status: 'loading', source, data: previous?.source === source ? previous.data : undefined }); this.changed();
    try {
      const data = await this.read(category, source);
      if (this.destroyed || this.sequence.get(category) !== seq) return false;
      if (this.sourceIdentity() !== source) throw fail('IDE_BACKEND_CHANGED');
      this.resources.set(category, { status: 'ready', source, data }); return true;
    } catch (error) {
      if (!this.destroyed && this.sequence.get(category) === seq) this.resources.set(category, { status: 'error', source, error: error.code || 'IDE_READ_FAILED', data: previous?.source === source ? previous.data : undefined });
      return false;
    } finally { this.changed(); }
  }
  resource(category) { return this.resources.get(category)?.data || {}; }
  isBusy(category) { return this.busy.has(category) || (category === 'ucet' || category === 'oznameni') && (this.busy.has('ucet') || this.busy.has('oznameni')); }
  ready(category) { try { const resource = this.resources.get(category); return resource?.status === 'ready' && resource.source === this.sourceIdentity() && !this.isBusy(category) && !this.destroyed; } catch { return false; } }
  notice(category, value) { this.notices.set(category, value); this.changed(); }
  editor(category, kind, original, draft) {
    if (!this.ready(category)) return;
    this.editors.set(category, { kind, source: this.resources.get(category).source, original: original ? JSON.parse(JSON.stringify(original)) : null, draft: JSON.parse(JSON.stringify(draft)), blocked: false });
    this.notices.delete(category); this.changed();
  }
  field(category, label, key, type = 'text', extra = {}) {
    const editor = this.editors.get(category), value = editor?.draft[key];
    return { label, value: String(value ?? ''), checked: value === true, isText: type === 'text', isNumber: type === 'number', isToggle: type === 'toggle', isSelect: type === 'select',
      disabled: this.isBusy(category) || !!extra.disabled, min: extra.min ?? 0, max: extra.max ?? 65535,
      hint: extra.hint || '', hasHint: !!extra.hint, options: (extra.options || []).map(v => Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }),
      change: event => { if (this.ready(category) && !extra.disabled && this.editors.get(category) === editor && editor.source === this.resources.get(category).source) {
        editor.draft[key] = type === 'toggle' ? event.target.checked : type === 'number' ? Number(event.target.value) : event.target.value; this.changed();
      } } };
  }
  action(category, label, go, extra = {}) { return { label, go, disabled: !this.ready(category), cls: extra.danger ? 'danger' : extra.primary ? 'primary' : '', ...extra }; }
  row(title, subtitle, status, properties, actions = [], extra = {}) { return { title, subtitle: subtitle || '', hasSubtitle: !!subtitle, status, properties, actions,
    hasProgress: false, progress: 0, progressLabel: '', hasWebUrl: false, webUrl: '', ...extra }; }
  section(title, description, items, actions = []) { return { title, description, hasDescription: !!description, items, hasItems: !!items.length, actions }; }
  async confirmed(message) { return typeof this.confirmAction === 'function' && await this.confirmAction(message) === true; }
  async mutate(category, { method, route, body, checkResponse, verify, success, closeEditor = true }) {
    if (!this.ready(category)) return false;
    const editor = this.editors.get(category);
    const source = this.resources.get(category).source;
    if (editor?.blocked || editor && editor.source !== source) return false;
    this.busy.add(category); this.notices.set(category, 'Čekám na potvrzení backendu…'); this.changed();
    let effectStarted = false;
    try {
      effectStarted = true;
      const response = await this.request(method, route, body, source);
      if (!checkResponse(response)) throw fail('IDE_WRITE_RESPONSE_UNVERIFIED');
      if (!await this.load(category, true, source)) throw fail('IDE_WRITE_READBACK_UNAVAILABLE');
      if (!verify(this.resource(category), response)) throw fail('IDE_WRITE_READBACK_MISMATCH');
      if (closeEditor && this.editors.get(category) === editor) this.editors.delete(category);
      // Shared account cache must not show an obsolete revision on another page.
      if (category === 'ucet' || category === 'oznameni') {
        const other = category === 'ucet' ? 'oznameni' : 'ucet';
        this.sequence.set(other, (this.sequence.get(other) || 0) + 1); this.resources.delete(other);
      }
      this.notices.set(category, success); return true;
    } catch (error) {
      if([400,422].includes(error.status)){
        if(editor&&this.editors.get(category)===editor)editor.blocked=false;
        this.notices.set(category,'Neuloženo. '+(error.userMessage||'Opravte vyplněné údaje.')+' Rozepsané hodnoty zůstaly a můžete je upravit.');
        return false;
      }
      if (editor && this.editors.get(category) === editor) editor.blocked = true;
      // No retry or draft rebasing. Refresh is read-only; cancel/reopen is an explicit user choice.
      this.notices.set(category, error.status === 409 ? (error.code === 'IDE_REVISION_STALE' ? 'Konflikt revize' : 'Backend odmítl operaci') + ' (' + error.code + '). Rozepsané hodnoty zůstaly. Obnov stav a porovnej je; zápis se neopakuje.'
        : (effectStarted ? 'Výsledek operace není ověřený (' : 'Operace nezačala (') + (error.code || 'IDE_OPERATION_FAILED') + '). Obnov stav před další akcí.');
      return false;
    } finally { this.busy.delete(category); this.changed(); }
  }
  async save(category) {
    const editor = this.editors.get(category);
    if (!editor || editor.blocked || !this.ready(category) || editor.source !== this.resources.get(category).source) return false;
    const d = JSON.parse(JSON.stringify(editor.draft)), original = editor.original, rev = original?.revision ?? 0;
    if (editor.kind === 'retention') {
      const patch = pick(d, ['max_daily', 'max_weekly', 'on_startup', 'on_shutdown']);
      if (!Number.isSafeInteger(patch.max_daily) || patch.max_daily < 1 || patch.max_daily > 30
        || !Number.isSafeInteger(patch.max_weekly) || patch.max_weekly < 1 || patch.max_weekly > 12
        || typeof patch.on_startup !== 'boolean' || typeof patch.on_shutdown !== 'boolean') {
        this.notice(category, 'Denní limit musí být 1–30 a nedělní limit 1–12 celých záloh.'); return false;
      }
      const source = editor.source;
      let current;
      this.busy.add(category); this.changed();
      try {
        current = await this.request('GET', '/api/settings', undefined, source);
        if (!equal(current, original.settings)) throw fail('IDE_SETTINGS_SNAPSHOT_CHANGED', 409);
        if (current.storage !== undefined && !plain(current.storage) || current.storage?.backup !== undefined && !plain(current.storage.backup)) throw fail('IDE_STORAGE_SETTINGS_INVALID');
      } catch (error) {
        editor.blocked = true; this.notice(category, 'Nastavení se nepodařilo ověřit před zápisem (' + error.code + '). Rozepsané hodnoty zůstaly; obnov stav.'); return false;
      } finally { this.busy.delete(category); this.changed(); }
      if (this.editors.get(category) !== editor || !this.ready(category) || this.resources.get(category).source !== source) return false;
      try {
        const preview=await this.request('POST','/api/system/backups/retention-preview',{maxDaily:patch.max_daily,maxWeekly:patch.max_weekly},source);
        if(preview.deletesNothing!==true||preview.scope!=='CURRENT_SNAPSHOTS_NEXT_RETENTION'||!Array.isArray(preview.deletions)
          ||preview.deletions.some(b=>!ID.test(b.name||'')))throw fail('IDE_RETENTION_PREVIEW_INVALID');
        if(preview.deletions.length && !await this.confirmed('Uložení nyní nic nesmaže. Při příštím automatickém úklidu tato pravidla odstraní následující nearchivované zálohy (novější zálohy mohou seznam změnit):\n'+preview.deletions.map(b=>b.name).join('\n')+'\nUložit tato pravidla?'))return false;
      } catch(error) {this.notice(category,'Náhled retence se nepodařilo ověřit. Pravidla nebyla změněna.');return false;}
      if(this.editors.get(category)!==editor||this.sourceIdentity()!==source)return false;
      // Legacy full-document endpoint. This preflight/readback is intentionally
      // not labelled CAS; its server-side race is recorded in the handoff.
      const body = { ...current, storage: { ...current.storage, backup: { ...current.storage?.backup, ...patch } } };
      return this.mutate(category, { method: 'POST', route: '/api/settings', body,
        checkResponse: r => r.success === true,
        verify: data => Object.entries(patch).every(([key, value]) => data.settings.storage?.backup?.[key] === value && data.backupPolicy[key] === value),
        success: 'Pravidla záloh byla uložená a znovu načtená z backendu. Uložení pravidel žádné zálohy nesmazalo.' });
    }
    let kind, route, body, identity, fields;
    if (editor.kind === 'identity') {
      identity='default';fields=['displayName','email','description'];
      if(!text(d.displayName,200)||!d.displayName.trim()||!text(d.email,254)||d.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||!text(d.description,2000)){
        this.notice(category,'Vyplňte jméno a platný e-mail, nebo e-mail ponechte prázdný. Rozepsané údaje zůstaly.');return false;
      }
      body={revision:rev,...Object.fromEntries(fields.map(k=>[k,d[k].trim()]))};kind='identity';route='/api/accounts/profile';
    } else if (editor.kind === 'account') {
      identity = original?.id || d.id;
      if (!ID.test(identity || '') || !['telegram', 'discord'].includes(d.provider) || !text(d.name, 200) || !d.name.trim()
        || !new RegExp('^INTENTSMITH_' + d.provider.toUpperCase() + '_[A-Z0-9_]+$').test(d.credentialEnv || '')
        || (d.provider === 'discord' ? !/^[0-9]{6,25}$/.test(d.recipient || '') : !/^(-?[0-9]{1,25}|@[a-zA-Z0-9_]{5,32})$/.test(d.recipient || ''))) {
        this.notice(category, 'Vyplň platné ID, název, referenci proměnné a příjemce. Token do formuláře nepatří.'); return false;
      }
      fields = ['name', 'provider', 'credentialEnv', 'recipient', 'enabled', 'events'];
      body = { revision: rev, ...pick(d, fields), name: d.name.trim(), events: ACCOUNT_EVENTS.filter(e => d['event_' + e]) };
      kind = 'accounts'; route = endpoint('/api/accounts/', identity);
    } else if (editor.kind === 'paths') {
      identity = 'default'; fields = ['projects'];
      if (!text(d.projects) || !d.projects.startsWith('/') || d.projects === '/') { this.notice(category, 'Vyber existující absolutní složku pro nové projekty.'); return false; }
      body = { revision: rev, projects: d.projects.trim() }; kind = 'paths'; route = '/api/system/storage/paths';
    } else if (editor.kind === 'backup') {
      identity = original.name; fields = ['note', 'archived']; body = { revision: rev, note: d.note, archived: d.archived };
      if (!text(d.note, 2000) || typeof d.archived !== 'boolean') { this.notice(category, 'Poznámka smí mít nejvýše 2000 znaků.'); return false; }
      kind = 'backups'; route = endpoint('/api/system/backups/', identity);
    } else if (editor.kind === 'ssh') {
      identity = original?.id || d.id; fields = ['name', 'host', 'user', 'port', 'identityFile', 'knownHostsFile'];
      if (!ID.test(identity || '') || !text(d.name, 200) || !d.name.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(d.host || '')
        || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(d.user || '') || !Number.isSafeInteger(d.port) || d.port < 1 || d.port > 65535
        || ![d.identityFile, d.knownHostsFile].every(p => text(p) && /^\/[a-zA-Z0-9_./-]+$/.test(p))) {
        this.notice(category, 'Vyplň platnou SSH identitu a existující absolutní cesty. Soukromý klíč se do IDE nevkládá.'); return false;
      }
      body = { revision: rev, ...pick(d, fields), name: d.name.trim(), host: d.host.toLowerCase() }; kind = 'profiles'; route = endpoint('/api/scm/profiles/', identity);
    } else if (editor.kind === 'repository') {
      identity = String(d.projectId); fields = ['sshProfileId'];
      const selected = d.sshProfileId || null;
      if (selected && !this.resource('git').profiles.some(p => p.id === selected)) { this.notice(category, 'Vybraný SSH profil už není v seznamu.'); return false; }
      body = { revision: rev, sshProfileId: selected }; kind = 'repositories'; route = endpoint('/api/scm/repositories/', identity);
    } else if (editor.kind === 'create-backup') {
      const sections = BACKUP_SECTIONS.filter(key => key === 'database' || d['section_' + key]);
      if (!text(d.note, 2000)) { this.notice(category, 'Poznámka smí mít nejvýše 2000 znaků.'); return false; }
      if (!await this.confirmed('Vytvořit skutečnou zálohu backendu? Vznikne nový archiv a backend použije svoji současnou retenční politiku.')) return false;
      if (this.editors.get(category) !== editor || !this.ready(category) || this.resources.get(category).source !== editor.source) return false;
      return this.mutate(category, { method: 'POST', route: '/api/system/backup', body: { sections, note: d.note },
        checkResponse: r => r.ok === true && text(r.name, 100),
        verify: (data, r) => data.backups.some(b => b.name === r.name && b.note === d.note && equal(b.sections, sections)),
        success: 'Nová záloha a její vybraný rozsah byly ověřeny v seznamu backendu.' });
    } else return false;
    const name = kind === 'backups' ? 'name' : 'id';
    return this.mutate(category, { method: 'PUT', route, body,
      checkResponse: r => { try { assertDocument(r); return r.id === identity && r.revision === rev + 1 && (kind === 'paths' ? text(r.projects) && r.projects.startsWith('/') && r.projects !== '/' : fields.every(k => equal(r[k], body[k]))); } catch { return false; } },
      verify: (data, response) => { const row = kind === 'identity' ? data.profile : kind === 'paths' ? data.paths : kind === 'repositories' ? data.repositories.find(p => String(p.id) === identity)?.profile : data[kind]?.find(p => p[name] === identity);
        return row && (row.id || row.name) === identity && row.revision === rev + 1 && fields.every(k => equal(row[k], kind === 'paths' ? response[k] : body[k])); },
      success: 'Změna byla zapsaná a znovu přečtená z backendu.' });
  }
  async remove(category, kind, row) {
    if (!this.ready(category)) return false;
    const source = this.resources.get(category).source;
    if (kind === 'profiles') {
      const refs = this.resource('git').repositories.filter(r => r.profile?.sshProfileId === row.id);
      if (refs.length) { this.notice(category, 'Profil používají repozitáře: ' + refs.map(r => r.name).join(', ') + '. Nejprve změň jejich přiřazení.'); return false; }
    }
    if (kind === 'backups' && (row.archived || this.resource(category).backups.length <= 1)) { this.notice(category, row.archived ? 'Archivovanou zálohu nejprve výslovně odarchivuj.' : 'Poslední zálohu backend chrání.'); return false; }
    if (!await this.confirmed(kind === 'backups' ? 'Trvale smazat zálohu ' + row.name + ' z disku? Tato operace je nevratná.'
      : 'Odstranit ' + (row.name || row.id) + '? ' + (kind === 'accounts' ? 'Ukončí se toto doručovací propojení; účet u poskytovatele se nemaže.' : 'Smaže se reference profilu, nikoliv soubor soukromého klíče.'))) return false;
    if (!this.ready(category) || this.resources.get(category).source !== source) return false;
    const id = kind === 'backups' ? row.name : row.id;
    const route = endpoint(kind === 'accounts' ? '/api/accounts/' : kind === 'profiles' ? '/api/scm/profiles/' : '/api/system/backups/', id);
    const body = kind === 'backups' ? { revision: row.revision, contentFingerprint: row.content_fingerprint, confirm: true } : { revision: row.revision };
    return this.mutate(category, { method: 'DELETE', route, body, closeEditor: false,
      checkResponse: r => r.removed === true && (r.id || r.name) === id,
      verify: data => !data[kind].some(v => (v.id || v.name) === id), success: 'Odstranění bylo ověřeno novým seznamem backendu.' });
  }
  async testAccount(category, account) {
    if (!this.ready(category)) return false;
    const source = this.resources.get(category).source;
    if (!await this.confirmed('Odeslat skutečnou testovací zprávu přes ' + account.provider + ' příjemci ' + account.recipient + '?')) return false;
    if (!this.ready(category) || this.resources.get(category).source !== source) return false;
    this.busy.add(category); this.notice(category, 'Odesílám výslovně potvrzenou zkoušku…');
    try {
      const result = await this.request('POST', endpoint('/api/accounts/', account.id) + '/test', { revision: account.revision, confirm: true }, source);
      if (result.delivered !== true || result.provider !== account.provider || !text(result.messageId, 200)) throw fail('IDE_DELIVERY_UNVERIFIED');
      this.notices.set(category, 'Backend potvrdil doručení této testovací zprávy. Trvalý stav připojení tím není změněn.'); return true;
    } catch (error) { this.notices.set(category, 'Doručení nebylo ověřeno (' + (error.code || 'IDE_DELIVERY_FAILED') + '). Zkouška se automaticky neopakuje.'); return false; }
    finally { this.busy.delete(category); this.changed(); }
  }
  openAccount(category, account = null) {
    const original = account || null, d = account ? pick(account, ['id', 'name', 'provider', 'credentialEnv', 'recipient', 'enabled'])
      : { id: freshId('account'), name: '', provider: 'telegram', credentialEnv: 'INTENTSMITH_TELEGRAM_', recipient: '', enabled: false };
    for (const event of ACCOUNT_EVENTS) d['event_' + event] = account?.events.includes(event) || false;
    this.editor(category, 'account', original, d);
  }
  openSsh(profile = null) { this.editor('git', 'ssh', profile, profile ? pick(profile, ['id', 'name', 'host', 'user', 'port', 'identityFile', 'knownHostsFile'])
    : { id: freshId('ssh'), name: '', host: '', user: 'git', port: 22, identityFile: '', knownHostsFile: '' }); }
  editorVM(category) {
    const editor = this.editors.get(category);
    if (!editor) return emptyManagementVM().editor;
    const f = (label, key, type, extra) => this.field(category, label, key, type, extra);
    let fields = [], title = '';
    if(editor.kind==='identity'){title='Upravit lokální profil';fields=[f('Zobrazované jméno','displayName'),f('E-mail (volitelný)','email'),f('Popis profilu','description','text',{hint:'Pouze popis v IDE. Není systémovým promptem ani přihlášením k externí službě.'})];}
    if (editor.kind === 'account') { title = editor.original ? 'Upravit doručovací propojení' : 'Nové doručovací propojení'; fields = [
      f('ID propojení', 'id', 'text', { disabled: true, hint: 'ID se vytváří automaticky. Nové propojení dostane nové ID.' }), f('Název', 'name'),
      f('Služba', 'provider', 'select', { options: [['telegram', 'Telegram'], ['discord', 'Discord']] }),
      f('Proměnná s přihlašovacím údajem', 'credentialEnv', 'text', { hint: 'Token nastavte v ~/.config/intentsmith/runtime.env a restartujte backendovou službu. Sem patří jen název INTENTSMITH_TELEGRAM_* nebo INTENTSMITH_DISCORD_*.' }),
      f('Příjemce / kanál', 'recipient'), f('Povolit doručování', 'enabled', 'toggle'), f('Události workerů', 'event_worker', 'toggle'), f('Události životního cyklu', 'event_lifecycle', 'toggle') ]; }
    if (editor.kind === 'paths') { title = 'Složka pro nové projekty'; fields = [f('Existující absolutní složka', 'projects', 'text', { hint: 'Změní pouze výchozí umístění nových projektů. Nepřesouvá stávající data.' })]; }
    if (editor.kind === 'backup') { title = 'Poznámka a archivace · ' + editor.original.name; fields = [f('Poznámka', 'note'), f('Archivovat', 'archived', 'toggle', { hint: 'Archiv se vyřadí z automatické retence. Obsah této zálohy se nemění.' })]; }
    if (editor.kind === 'retention') { title = 'Retence a životní cyklus záloh'; fields = [
      f('Zachovat běžných záloh (mimo neděli)', 'max_daily', 'number', { min: 1, max: 30 }),
      f('Zachovat nedělních záloh', 'max_weekly', 'number', { min: 1, max: 12 }),
      f('Záloha při spuštění backendu', 'on_startup', 'toggle', { hint: 'Platí pro další skutečné spuštění backendu.' }),
      f('Záloha při ukončení backendu', 'on_shutdown', 'toggle') ]; }
    if (editor.kind === 'create-backup') { title = 'Nová záloha stavu'; fields = [f('Poznámka', 'note'), ...BACKUP_SECTIONS.map(key => f({ database: 'Databáze (povinná)', config: 'Konfigurace', skills: 'Skilly', specialists: 'Specialisté' }[key], 'section_' + key, 'toggle', { disabled: key === 'database', hint: key === 'database' ? 'Podporovaný restore obnovuje databázi.' : 'Archivní kopie; automatická aktivace po obnově není slíbena.' }))]; }
    if (editor.kind === 'ssh') { title = editor.original ? 'Upravit SSH profil' : 'Nový SSH profil'; fields = [f('ID profilu', 'id', 'text', { disabled: true, hint: 'Identifikátor se vytvoří automaticky; k rozlišení profilů použijte název.' }), f('Název', 'name'), f('SSH host', 'host'), f('SSH uživatel', 'user'), f('SSH port', 'port', 'number', { min: 1, max: 65535 }), f('Cesta k existujícímu soukromému klíči', 'identityFile', 'text', { hint: 'Pouze absolutní cesta. Backend ověří vlastníka, práva a pravidelný soubor; klíč se nečte do formuláře.' }), f('Cesta k known_hosts', 'knownHostsFile')]; }
    if (editor.kind === 'repository') { title = 'Přístupový profil repozitáře'; fields = [f('SSH profil', 'sshProfileId', 'select', { options: [['', 'Bez přiřazeného SSH profilu'], ...this.resource('git').profiles.map(p => [p.id, p.name + ' · ' + p.user + '@' + p.host + ':' + p.port])], hint: 'Nastaví pouze referenci pro skutečný projekt. Nemění remote adresu nebo Git politiku.' })]; }
    return { visible: true, title, fields, notice: editor.blocked ? 'Tento rozepsaný zápis je blokovaný po konfliktu nebo neověřeném výsledku. Obnov stav; hodnoty můžeš porovnat a editor výslovně zavřít.' : '',
      saveDisabled: !this.ready(category) || editor.blocked, save: () => this.save(category), cancelDisabled: this.isBusy(category), cancel: () => { if (!this.isBusy(category)) { this.editors.delete(category); this.changed(); } } };
  }
  vm(category, view = 'dlazdice', size = 2) {
    const resource = this.resources.get(category);
    let sourceChanged = false;
    try { sourceChanged = !!resource?.source && resource.source !== this.sourceIdentity(); } catch { sourceChanged = !!resource; }
    const data = sourceChanged ? {} : resource?.data || {}, sections = [], primary = [], ready = this.ready(category);
    const a = (label, go, extra) => this.action(category, label, go, extra);
    const accountRows = (data.accounts || []).map(account => this.row(account.name, account.provider === 'telegram' ? 'Telegram' : 'Discord', account.enabled ? 'Doručování povoleno' : 'Doručování vypnuto',
      [meta('Příjemce', account.recipient), meta('Přihlašovací údaj', account.credentialConfigured ? 'Proměnná nastavena' : 'Proměnná chybí'), meta('Události', account.events.length ? account.events.join(', ') : 'Žádné'), meta('Připojení', 'Doručení zatím neověřeno')],
      [a('Upravit', () => this.openAccount(category, account)), a('Odeslat zkoušku…', () => this.testAccount(category, account), { disabled: !ready || !account.enabled || !account.credentialConfigured }), a('Odstranit…', () => this.remove(category, 'accounts', account), { danger: true })]));
    if (category === 'ucet' || category === 'oznameni') {
      sections.push(this.section(category === 'ucet' ? 'Propojené doručovací účty' : 'Doručovací kanály', 'Telegram a Discord používají odkaz na proměnnou prostředí. Uložení konfigurace a ověřené doručení jsou různé stavy.', accountRows,
        [a('+ Přidat propojení', () => this.openAccount(category), { primary: true })]));
      if (category === 'ucet') sections.push(this.section('Repozitářové účty a přístupy', 'GitHub, GitLab a další Git hosty používají přístupové profily v Repozitáře a přístupy. Uložení SSH reference není OAuth přihlášení. Google a Microsoft zatím připojení nemají.', []));
      if (category === 'oznameni') {
        sections.push(this.section('Kanály zaregistrované v backendu', 'Registrace kanálu sama neprokazuje doručení. Parametry Telegramu a Discordu upravíte výše.', (data.channels || []).map(c => this.row(c.name, '', c.configured ? 'Zaregistrován' : 'Nenastaven', []))));
        if (data.email) sections.push(this.section('E-mail', 'Současné parametry SMTP jsou zde jen pro čtení. Přihlašovací údaj zůstává v prostředí a do formuláře se nevkládá.', [this.row('SMTP', data.email.smtpHost || 'Server není nastaven', data.email.emailEnabled ? 'Povoleno' : 'Vypnuto', [meta('Příjemce', data.email.emailRecipient || 'Nenastaven'), meta('Port', data.email.smtpPort), meta('Odesílatel', data.email.smtpFrom || 'Nenastaven')])]));
      }
    }
    if (category === 'uloziste') {
      const inventory = data.inventory || {};
      sections.push(this.section('Disky a svazky', 'Skutečná pozorovaná připojení backendu. Nedostupné hodnoty se nenahrazují nulami.', (inventory.disks || []).map(d => {
        const measured = d.status === 'OBSERVED' && Number.isFinite(d.totalBytes) && d.totalBytes > 0 && Number.isFinite(d.usedBytes) && d.usedBytes >= 0;
        return this.row(d.mountPoint, d.type, d.status === 'OBSERVED' ? 'Zjištěno' : 'Nedostupné', [meta('Celkem', bytes(d.totalBytes)), meta('Použito', bytes(d.usedBytes)), meta('Volné pro uživatele', bytes(d.freeBytes))], [], { hasProgress: measured, progress: measured ? Math.min(100, Math.max(0, d.usedBytes / d.totalBytes * 100)) : 0, progressLabel: measured ? Math.round(d.usedBytes / d.totalBytes * 100) + ' % obsazeno' : '' });
      })));
      sections.push(this.section('Databáze', 'Připojené databáze SQLite, jejich engine, stránkové využití a WAL.', (inventory.databases || []).map(d => this.row(d.name, d.path || 'Databáze v paměti', d.engine + ' ' + d.version,
        [meta('Přiděleno', bytes(d.allocatedBytes)), meta('Využito', bytes(d.usedBytes)), meta('WAL', bytes(d.walBytes)), meta('Režim', d.journalMode), meta('Tabulky', d.tableCount)]))));
      sections.push(this.section('Umístění dat', 'Částečné měření adresáře je označené; seznam nemusí být kompletní. Přesun dat ani změna umístění modelů se zde neprovádí.', (inventory.locations || []).map(l => this.row({ projects: 'Projekty', data: 'Data aplikace', backups: 'Zálohy', models: 'Modely' }[l.kind] || l.kind, l.path||'Poskytovatel cestu nesdělil', { COMPLETE: 'Úplné měření', PARTIAL: 'Částečné měření', MISSING: 'Složka chybí', UNAVAILABLE: 'Nedostupné',UNKNOWN:'Cesta není známá' }[l.status], [meta('Změřená velikost', bytes(l.bytes)), meta('Prohlédnuté položky', l.entries),...(l.pathSource?[meta('Zdroj cesty',l.pathSource==='LOCAL_PROVIDER_SERVICE'?'Konfigurace služby Ollama':'Konfigurace instalace')]:[])]))));
      if (data.paths) sections.push(this.section('Nové projekty', 'Pouze výchozí cesta. Stávající projektové složky se nepřesouvají.', [this.row('Výchozí složka', data.paths.projects, 'Revize ' + data.paths.revision, [], [a('Upravit', () => this.editor(category, 'paths', data.paths, { projects: data.paths.projects }))])]));
    }
    if (category === 'zalohy') {
      primary.push(a('+ Vytvořit zálohu…', () => this.editor(category, 'create-backup', null, { note: '', section_database: true, section_config: true, section_skills: true, section_specialists: true }), { primary: true }));
      if (data.backupPolicy) sections.push(this.section('Pravidla záloh', 'Backend třídí zálohy do běžné a nedělní skupiny. Archivované zálohy a nejnovější záloha jsou chráněné. Změna pravidel sama nic nemaže; retence se použije při vytvoření zálohy.',
        [this.row('Retence a životní cyklus', '', 'Načteno z backendu', [meta('Běžná skupina', count(data.backupPolicy.max_daily, 'záloha', 'zálohy', 'záloh')), meta('Nedělní skupina', count(data.backupPolicy.max_weekly, 'záloha', 'zálohy', 'záloh')), meta('Při spuštění', data.backupPolicy.on_startup ? 'Zapnuto' : 'Vypnuto'), meta('Při ukončení', data.backupPolicy.on_shutdown ? 'Zapnuto' : 'Vypnuto')],
          [a('Upravit pravidla', () => this.editor(category, 'retention', { settings: data.settings }, data.backupPolicy))])]));
      sections.push(this.section('Zálohy stavu', 'Archivace chrání před automatickou retencí. Nová záloha použije aktuální pravidla backendu; náhled úklidu je součástí změny pravidel. Vlastní časový plán zatím není dostupný.', (data.backups || []).map(b => this.row(b.name, b.created_at || 'Čas není známý', b.archived ? 'Archiv' : 'Běžná záloha',
        [meta('Poznámka', b.note || 'Bez poznámky'), meta('Celkem', bytes(b.total_size_bytes)), meta('Databáze', bytes(b.db_size_bytes)), meta('Rozsah', b.sections.join(', ')), meta('Obnova', b.restorable ? 'Podporovaný formát; validační kontrola zde neproběhla' : 'Nepodporovaný formát')],
        [a('Poznámka / archivace', () => this.editor(category, 'backup', b, { note: b.note, archived: b.archived })), a('Manifest', () => { this.details.set(category, { title: 'Metadata zálohy · ' + b.name, rows: [meta('Formát', b.format_version), meta('Schema', b.schema_version), meta('Otisk obsahu', b.content_fingerprint || 'Chybí'), meta('Obnovitelný rozsah', b.restore_scope.join(', ') || 'Žádný'), meta('Archivní rozsah', b.sections.filter(s => !b.restore_scope.includes(s)).join(', ') || 'Žádný')] }); this.changed(); }), a('Smazat…', () => this.remove(category, 'backups', b), { danger: true, disabled: !ready || b.archived || (data.backups || []).length <= 1 })]))));
      sections.push(this.section('Obnova a plánování', 'Obnova databáze probíhá při zastavené aplikaci přes podporovaný restore příkaz. Projekty a přílohy záloha stavu nezahrnuje. Pravidelný časový plán zatím není dostupný. Náhled úklidu je dostupný před potvrzením retence.', []));
    }
    if (category === 'git') {
      sections.push(this.section('Repozitáře projektů', 'Skutečné active projekty a jejich remotes. Pracovní Git změny patří do projektu; zde nastavíte SSH reference.', (data.repositories || []).map(r => {
        const remote = r.remotes.find(m => m.name === 'origin') || r.remotes[0], webUrl = remoteWebUrl(remote?.url);
        const profile = r.profile ? (data.profiles || []).find(p => p.id === r.profile.sshProfileId) : null;
        return this.row(r.name, r.path, r.status === 'OBSERVED' ? 'Pozorováno' : 'Nedostupné', [meta('Adresa repozitáře', webUrl || (remote ? 'Transport nelze bezpečně převést na webovou adresu' : 'Žádný remote')), meta('Přístupový profil', profile?.name || 'Bez SSH profilu'), meta('Remote', remote?.name || 'Žádný')],
          [a('Nastavit SSH profil', () => this.editor(category, 'repository', r.profile || null, { projectId: r.id, sshProfileId: r.profile?.sshProfileId || '' }), { disabled: !ready || r.status !== 'OBSERVED' })], { hasWebUrl: !!webUrl, webUrl });
      })));
      sections.push(this.section('SSH přístupové profily', 'Jen reference k existujícím bezpečným souborům. Soukromé klíče a HTTPS tokeny se nevkládají do IDE.', (data.profiles || []).map(p => {
        const uses = (data.repositories || []).filter(r => r.profile?.sshProfileId === p.id).map(r => r.name);
        return this.row(p.name, p.user + '@' + p.host + ':' + p.port, count(uses.length, 'přiřazený repozitář', 'přiřazené repozitáře', 'přiřazených repozitářů'), [meta('Soukromý klíč', p.identityFile), meta('known_hosts', p.knownHostsFile), meta('Používají', uses.join(', ') || 'Žádný')],
          [a('Upravit', () => this.openSsh(p)), a('Odstranit…', () => this.remove(category, 'profiles', p), { danger: true })]);
      }), [a('+ SSH profil', () => this.openSsh(), { primary: true })]));
      sections.push(this.section('Remote a HTTPS přístup', 'Adresa repozitáře je čtená z Gitu a není zde editovatelná. Webový odkaz se poskytne jen pro bezpečně rozpoznaný veřejný host. Editor HTTPS tokenových profilů zatím není dostupný.', []));
    }
    const labels = { ucet: ['Účet a propojení', 'Skutečné doručovací účty a jejich ověřitelný stav.'], oznameni: ['Oznámení', 'Kanály, příjemci a výslovně potvrzené zkoušky.'], uloziste: ['Úložiště', 'Skutečné kapacity, databáze a cesty backendu.'], zalohy: ['Zálohy', 'Poznámky, archivace a přesně potvrzené operace.'], git: ['Repozitáře a přístupy', 'Projektový registr a SSH reference.'] };
    const identity=category==='ucet'&&data.profile?{visible:true,name:data.profile.displayName||'Lokální profil není vyplněný',email:data.profile.email,description:data.profile.description,
      state:'Lokální profil · '+(data.profile.revision?'revize '+data.profile.revision:'výchozí'),disabled:!ready,
      edit:()=>this.editor(category,'identity',data.profile,pick(data.profile,['displayName','email','description']))}:emptyManagementVM().identity;
    const detail = this.details.get(category);
    return { title: labels[category]?.[0] || '', description: labels[category]?.[1] || '', sections, primary, editor: this.editorVM(category),
      loading: !sourceChanged && (resource?.status === 'loading' || !resource), hasError: sourceChanged || resource?.status === 'error', error: sourceChanged ? 'Backend se změnil. Nejdřív načti jeho stav; rozepsané hodnoty se do jiného backendu neposílají.' : resource?.error || '',
      busy: this.isBusy(category), refreshDisabled: this.isBusy(category), refresh: () => this.load(category, true),
      notice: this.notices.get(category) || '', hasNotice: this.notices.has(category),
      layoutClass: view === 'seznam' ? 'im-list' : 'im-grid', sizeClass: 'im-size-' + Math.min(3, Math.max(1, Number(size) || 2)),
      identity,hasDetail: !!detail, detail: detail || { title: '', rows: [] }, closeDetail: () => { this.details.delete(category); this.changed(); } };
  }
}

module.exports = { IdeSettingsManagement, remoteWebUrl, emptyManagementVM, CATEGORIES: [...CATEGORIES] };
