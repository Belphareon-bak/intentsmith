'use strict';

const AUDIT_TYPES = Object.freeze(['all', 'cre', 'merge', 'drift', 'llm']);
const TOKEN_SCOPES = Object.freeze(['read:chat', 'read:projects', 'read:settings',
  'write:chat', 'write:settings']);

class SecurityWorkspace {
  constructor({ backendUrl, fetchImpl = fetch, confirmAction = () => false, onChange = () => {} } = {}) {
    this.backendUrl = backendUrl; this.fetchImpl = fetchImpl; this.confirmAction = confirmAction;
    this.onChange = onChange; this.auditType = 'all';
    this.audit = { status: 'idle', rows: [] }; this.tokens = { status: 'idle', rows: [] };
    this.sessions = { status: 'idle' }; this.webhook = { status: 'idle' };
    this.tokenName = ''; this.scopes = new Set(['read:chat', 'read:projects']);
    this.oneTimeToken = ''; this.busy = false; this.notice = '';
    this.destroyed = false;
  }
  destroy() { this.destroyed = true; this.oneTimeToken = ''; this.tokenName = ''; }
  changed() { if (!this.destroyed) this.onChange(); }
  async request(path, options = {}) {
    const base = this.backendUrl?.();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000), ...options });
    let body = {}; try { body = await response.json(); } catch {}
    if (!response.ok) throw Object.assign(Error(body.error || 'HTTP ' + response.status), { status: response.status });
    return body;
  }
  async load(kind = 'all', refresh = false) {
    if (kind === 'all') {
      await Promise.all(['audit', 'tokens', 'sessions', 'webhook'].map(item => this.load(item, refresh)));
      return;
    }
    if (!['audit', 'tokens', 'sessions', 'webhook'].includes(kind)) return;
    if (!refresh && this[kind].status === 'ready') return;
    const key = Symbol(kind);
    this[kind] = { ...this[kind], status: 'loading', key }; this.changed();
    try {
      const path = ({ audit: '/api/security/audit?type=' + encodeURIComponent(this.auditType) + '&limit=50',
        tokens: '/api/security/tokens', sessions: '/api/security/sessions',
        webhook: '/api/security/webhook-secret' })[kind];
      const data = await this.request(path);
      if (kind === 'audit' && (!data.results || typeof data.results !== 'object'
        || Object.values(data.results).some(value => !Array.isArray(value)))) throw Error('Backend vrátil neplatný audit.');
      if (kind === 'tokens' && !Array.isArray(data.tokens)) throw Error('Backend vrátil neplatný seznam tokenů.');
      if (kind === 'sessions' && !Number.isFinite(data.uptime_seconds)) throw Error('Backend vrátil neplatný stav relací.');
      if (kind === 'webhook' && typeof data.configured !== 'boolean') throw Error('Backend vrátil neplatný stav webhooku.');
      if (this[kind].key !== key || this.destroyed) return;
      if (kind === 'audit') this.audit = { status: 'ready', rows: Object.entries(data.results)
        .flatMap(([type, rows]) => rows.map(row => ({ type, ...row })))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 50) };
      else if (kind === 'tokens') this.tokens = { status: 'ready', rows: data.tokens };
      else this[kind] = { status: 'ready', data };
    } catch (error) {
      if (this[kind].key === key && !this.destroyed) this[kind] = { status: 'error', error: error.message };
    } finally { this.changed(); }
  }
  selectAudit(type) {
    if (!AUDIT_TYPES.includes(type)) return;
    this.auditType = type; this.audit = { status: 'idle', rows: [] };
    this.load('audit'); this.changed();
  }
  setName(value) { if (typeof value === 'string' && value.length <= 120) { this.tokenName = value; this.changed(); } }
  toggleScope(scope) {
    if (!TOKEN_SCOPES.includes(scope)) return;
    if (this.scopes.has(scope)) this.scopes.delete(scope); else this.scopes.add(scope);
    this.changed();
  }
  async createToken() {
    const name = this.tokenName.trim(), scopes = TOKEN_SCOPES.filter(scope => this.scopes.has(scope));
    if (this.busy || this.oneTimeToken || !name || !scopes.length || this.tokens.status !== 'ready') return false;
    if (!this.confirmAction('Vytvořit přístupový token „' + name + '“ s oprávněními ' + scopes.join(', ') + '? Token se ukáže jen jednou.')) return false;
    this.busy = true; this.notice = 'Vytvářím token…'; this.changed();
    try {
      const result = await this.request('/api/security/tokens', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes }) });
      if (!/^[0-9a-f-]{36}$/i.test(result.id || '') || !/^intentsmith_[0-9a-f]{64}$/.test(result.token || '')
        || result.name !== name || JSON.stringify(result.scopes) !== JSON.stringify(scopes))
        throw Error('Token mohl vzniknout, ale odpověď neobsahuje přesnou identitu. Obnov seznam; další token nevytvářej naslepo.');
      if (this.destroyed) return false;
      this.oneTimeToken = result.token;
      this.tokenName = '';
      await this.load('tokens', true);
      if (this.tokens.status !== 'ready' || !this.tokens.rows.some(row => row.id === result.id))
        throw Error('Token vznikl, ale seznam jej neověřil. Zkopíruj jej nyní a obnov stav.');
      this.notice = 'Token byl vytvořen. Zkopíruj jej nyní; po zavření se už nezobrazí.';
      return true;
    } catch (error) { this.notice = error?.message || 'Výsledek vytvoření tokenu není jistý.'; return false; }
    finally { this.busy = false; this.changed(); }
  }
  async revokeToken(id) {
    const row = this.tokens.rows?.find(item => item.id === id);
    if (this.busy || !row || !this.confirmAction('Odvolat token „' + row.name + '“? Přístup skončí okamžitě.')) return false;
    this.busy = true; this.notice = 'Odvolávám token…'; this.changed();
    try {
      const result = await this.request('/api/security/tokens/' + encodeURIComponent(id), { method: 'DELETE' });
      if (result.ok !== true || result.deleted !== id) throw Error('Backend nepotvrdil odvolání tokenu.');
      await this.load('tokens', true);
      if (this.tokens.status !== 'ready' || this.tokens.rows.some(item => item.id === id))
        throw Error('Odvolání mohlo proběhnout, ale seznam to nepotvrdil. Obnov stav.');
      this.notice = 'Token byl odvolán a zmizel ze seznamu backendu.';
      return true;
    } catch (error) { this.notice = error?.message || 'Výsledek odvolání je nejistý.'; return false; }
    finally { this.busy = false; this.changed(); }
  }
  async copyToken() {
    if (!this.oneTimeToken || !globalThis.navigator?.clipboard?.writeText) return false;
    try { await navigator.clipboard.writeText(this.oneTimeToken); this.oneTimeToken = '';
      this.notice = 'Token zkopírován a skryt v aplikaci.'; this.changed(); return true; }
    catch { this.notice = 'Kopírování selhalo. Token zůstává viditelný pro ruční zkopírování.';
      this.changed(); return false; }
  }
  hideToken() { this.oneTimeToken = ''; this.changed(); }
  vm(tab) {
    const state = tab === 'prehled' ? this.audit : tab === 'relace' ? this.sessions : this.tokens;
    const status = this.notice || (state.status === 'error' ? state.error
      : state.status === 'loading' || state.status === 'idle' ? 'Načítám bezpečnostní údaje…' : 'Data potvrdil backend.');
    return { status, auditTypes: AUDIT_TYPES.map(value => ({ value, label: value.toUpperCase(),
      selected: this.auditType === value, go: () => this.selectAudit(value) })),
      auditRows: this.audit.status === 'ready' ? this.audit.rows.map(row => ({
        title: row.type.toUpperCase() + ' · ' + (row.created_at || '?'),
        detail: String(row.input_preview || row.intent || row.capability || row.model || row.event_type || 'Záznam') })) : [],
      tokens: this.tokens.status === 'ready' ? this.tokens.rows.map(row => ({ id: row.id,
        name: row.name, meta: 'Použit: ' + (row.last_used_at || 'nikdy') + ' · Expiruje: ' + (row.expires_at || 'bez data'),
        revoke: () => this.revokeToken(row.id) })) : [],
      tokenName: this.tokenName, setTokenName: event => this.setName(event.target.value),
      scopes: TOKEN_SCOPES.map(name => ({ name, checked: this.scopes.has(name),
        toggle: () => this.toggleScope(name) })),
      createDisabled: this.busy || this.oneTimeToken || !this.tokenName.trim() || !this.scopes.size
        || this.tokens.status !== 'ready', create: () => this.createToken(),
      hasOneTimeToken: Boolean(this.oneTimeToken), oneTimeToken: this.oneTimeToken,
      copyToken: () => this.copyToken(), hideToken: () => this.hideToken(),
      webhook: this.webhook.status === 'ready' ? this.webhook.data.configured
        ? 'Webhook secret je v prostředí; aplikace jej nezobrazuje.' : 'Webhook secret není nastavený.'
        : this.webhook.status === 'error' ? this.webhook.error : 'Zjišťuji stav webhooku…',
      sessions: this.sessions.status === 'ready'
        ? 'Uptime backendu: ' + Math.round(this.sessions.data.uptime_seconds / 60) + ' min. Počet WS spojení backend zatím nepotvrzuje.'
        : this.sessions.status === 'error' ? this.sessions.error : 'Načítám stav backendu…' };
  }
}
module.exports = { SecurityWorkspace, TOKEN_SCOPES, AUDIT_TYPES };
