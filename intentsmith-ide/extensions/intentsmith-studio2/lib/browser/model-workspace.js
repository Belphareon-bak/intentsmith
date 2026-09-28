'use strict';

const TABS = Object.freeze([
  ['overview', 'Přehled'], ['roles', 'Role'], ['evaluations', 'Evaluace'],
  ['hunt', 'GPU hunt'], ['history', 'Historie'], ['candidates', 'Kandidáti'],
  ['governor', 'Správce'], ['upgrades', 'Upgrady'], ['policy', 'Automatizace']]);
const ROLES = Object.freeze(['D1', 'D2', 'R1', 'R2', 'CODE', 'CHAT', 'VISION']);
const TAB_PATHS = Object.freeze({
  overview: ['/api/system/models/overview'],
  roles: ['/api/system/upgrades/bindings', '/api/system/models/evaluations', '/api/system/models'],
  evaluations: ['/api/system/models/evaluations'],
  history: ['/api/system/models/evaluations'],
  hunt: ['/api/system/models/hunt'],
  candidates: ['/api/system/models/candidates', '/api/system/models/downloads'],
  governor: ['/api/system/governor/report', '/api/system/governor/proposals'],
  upgrades: ['/api/system/upgrades'],
  policy: ['/api/system/models/policy'],
});
const EXACT_DIGEST = /^[0-9a-f]{64}$/;

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, fallback = '—') { return value === null || value === undefined || value === '' ? fallback : String(value); }
function errorText(error) { return error?.message || 'Požadavek selhal.'; }
function validResource(tab, data) {
  if (tab === 'overview') return Array.isArray(data[0]?.models);
  if (tab === 'roles') return record(data[0]?.bindings) && record(data[1]?.roles) && Array.isArray(data[2]?.models);
  if (tab === 'evaluations' || tab === 'history') return record(data[0]?.roles) && Array.isArray(data[0]?.history);
  if (tab === 'hunt') return typeof data[0]?.state === 'string';
  if (tab === 'candidates') return Array.isArray(data[0]?.candidates) && Array.isArray(data[1]?.downloads);
  if (tab === 'governor') return record(data[0]) && Array.isArray(data[1]?.proposals);
  if (tab === 'upgrades') return Array.isArray(data[0]?.history);
  if (tab === 'policy') return typeof data[0]?.valid === 'boolean' && Number.isSafeInteger(data[0]?.revision)
    && record(data[0]?.policy);
  return false;
}

class ModelWorkspace {
  constructor({ backendUrl, fetchImpl = fetch, confirmAction = () => false, onChange = () => {} } = {}) {
    this.backendUrl = backendUrl;
    this.fetchImpl = fetchImpl;
    this.confirmAction = confirmAction;
    this.onChange = onChange;
    this.tab = 'overview';
    this.resources = new Map();
    this.loading = new Map();
    this.busy = false;
    this.notice = '';
    this.selectedRole = 'CHAT';
    this.selectedModel = '';
    this.policyDraft = null;
    this.verifyFailure = null;
    this.destroyed = false;
  }
  destroy() { this.destroyed = true; this.resources.clear(); this.loading.clear(); }
  changed() { if (!this.destroyed) this.onChange(); }
  async request(path, options = {}) {
    const base = this.backendUrl?.();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { credentials: 'same-origin',
      signal: AbortSignal.timeout(options.timeout || 15_000), ...options });
    let payload = {};
    try { payload = await response.json(); } catch { /* HTTP status remains authoritative. */ }
    const details = record(payload) ? payload : {};
    if (!response.ok) throw Object.assign(Error(details.error || 'HTTP ' + response.status),
      { code: details.code || 'HTTP_' + response.status, status: response.status });
    return payload;
  }
  async load(tab = this.tab, refresh = false) {
    if (!TAB_PATHS[tab]) return false;
    const existing = this.resources.get(tab);
    if (!refresh && existing?.status === 'ready') return true;
    if (!refresh && existing?.status === 'loading') return this.loading.get(tab) || false;
    const token = Symbol(tab);
    this.resources.set(tab, { status: 'loading', data: existing?.data || null, token });
    this.changed();
    const pending = (async () => {
      try {
        const data = await Promise.all(TAB_PATHS[tab].map(path => this.request(path).catch(error => {
        if (tab === 'governor' && path === '/api/system/governor/report' && error.status === 404)
          return { dimensions: {}, created_at: null };
        throw error;
        })));
        if (!validResource(tab, data)) throw Error('Backend vrátil neplatná data modelového pracoviště.');
        if (!this.destroyed && this.resources.get(tab)?.token === token) {
          this.resources.set(tab, { status: 'ready', data });
          if (tab === 'policy' && (refresh || !this.policyDraft)) this.policyDraft = { ...data[0].policy };
          this.changed();
        }
        return true;
      } catch (error) {
        if (!this.destroyed && this.resources.get(tab)?.token === token) {
          this.resources.set(tab, { status: 'error', error: errorText(error), data: existing?.data || null }); this.changed();
        }
        return false;
      }
    })();
    this.loading.set(tab, pending);
    return pending.finally(() => { if (this.loading.get(tab) === pending) this.loading.delete(tab); });
  }
  select(tab) {
    if (!TAB_PATHS[tab]) return false;
    this.tab = tab;
    this.notice = '';
    this.changed();
    this.load(tab);
    return true;
  }
  action(label, handler, confirmation) {
    if (this.busy) return false;
    if (confirmation && !this.confirmAction(confirmation)) return false;
    this.busy = true; this.notice = label + '…'; this.changed();
    return Promise.resolve().then(handler).then(value => {
      if (value === false) { this.notice = label + ' nebylo spuštěno.'; return false; }
      this.notice = value || 'Požadavek byl přijat. Aktuální stav ověř v této záložce.';
      return true;
    }).catch(error => {
      this.notice = label + ' selhalo: ' + errorText(error);
      return false;
    }).finally(() => { this.busy = false; this.changed(); });
  }
  async post(path, body, timeout = 30_000) {
    return this.request(path, { method: 'POST', timeout, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async pull(name) {
    const candidate = this.resources.get('candidates')?.data?.[0]?.candidates?.find(row => row.name === name);
    const download = this.resources.get('candidates')?.data?.[1]?.downloads?.find(row => row.model === name);
    if (!candidate || candidate.installed || download && !['done', 'error'].includes(download.status)) return false;
    return this.action('Stahování modelu', async () => {
      const result = await this.post('/api/system/models/pull', { name }, 10_000);
      if (result.ok !== true) throw Error('Backend nepotvrdil zahájení stahování.');
      if (!await this.load('candidates', true)) throw Error('Požadavek mohl být přijat, ale průběh nelze ověřit. Neopakuj stahování naslepo.');
      return 'Požadavek na stažení byl přijat. Průběh potvrzuje backendový seznam stahování; kvalita modelu zatím není změřená.';
    }, 'Stáhnout ' + name + '? Operace použije síť a místo na disku; přiřazení rolí se nezmění.');
  }
  async hunt(action) {
    if (!['start', 'stop', 'pause', 'resume'].includes(action) || this.resources.get('hunt')?.status !== 'ready') return false;
    const messages = { start: 'Spustit hunt? Může stahovat modely a použít GPU; role se nezmění.',
      stop: 'Zastavit aktuální hunt? Uložená měření zůstanou.', pause: 'Pozastavit automatický hunt?',
      resume: 'Obnovit automatický hunt? Měření se může spustit, až bude GPU volná.' };
    return this.action('Řízení huntu', async () => {
      const result = await this.post('/api/system/models/hunt/control', { action }, 15_000);
      if (result.accepted !== true || result.action !== action) throw Error('Backend nepotvrdil řízení huntu.');
      if (!await this.load('hunt', true)) throw Error('Požadavek mohl proběhnout, ale stav huntu nelze ověřit. Neopakuj jej naslepo.');
      return 'Stav huntu byl znovu načten z backendu.';
    }, messages[action]);
  }
  async checkUpgrades() {
    return this.action('Kontrola dostupných modelů', async () => {
      const result = await this.post('/api/system/upgrades/check', { fullCycle: true }, 90_000);
      if (result.authority?.qualityRecommendation !== false) throw Error('Backend nepotvrdil, že discovery není rozhodnutí o kvalitě.');
      if (!await this.load('upgrades', true)) throw Error('Discovery proběhlo, ale historii nelze znovu načíst.');
      if (this.tab === 'candidates') await this.load('candidates', true);
      return 'Discovery dokončeno. Kvalitu a vhodnost role určuje samostatná evaluace.';
    });
  }
  async checkGovernor() {
    return this.action('Kontrola Správce', async () => {
      await this.post('/api/system/governor/check', {}, 15_000);
      if (!await this.load('governor', true)) throw Error('Kontrola proběhla, ale nový report nelze ověřit.');
      return 'Nový report Správce byl načten.';
    });
  }
  async decideGovernor(id, decision) {
    if (!Number.isSafeInteger(id) || id < 1 || !['approve', 'dismiss'].includes(decision)) return false;
    const proposal = this.resources.get('governor')?.data?.[1]?.proposals?.find(row => row.id === id);
    if (!proposal || String(proposal.status).toLowerCase() !== 'pending') return false;
    return this.action('Rozhodnutí o doporučení', async () => {
      const result = await this.post('/api/system/governor/proposals/' + id + '/' + decision, {});
      if (result.success !== true || !await this.load('governor', true)) throw Error('Rozhodnutí nelze ověřit. Obnov stav před dalším pokusem.');
      const after = this.resources.get('governor')?.data?.[1]?.proposals?.find(row => row.id === id);
      const expected = decision === 'approve' ? 'approved' : 'dismissed';
      if (String(after?.status).toLowerCase() !== expected) throw Error('Backend nepotvrdil očekávaný stav doporučení.');
      return decision === 'approve' ? 'Doporučení přijato; navrženou úpravu je potřeba provést ručně.' : 'Doporučení zamítnuto.';
    }, (decision === 'approve' ? 'Přijmout' : 'Zamítnout') + ' doporučení „' + text(proposal.title) + '“?');
  }
  async assignRole() {
    const { selectedRole: role, selectedModel: model } = this;
    const data = this.resources.get('roles')?.data;
    if (!ROLES.includes(role) || !data || !data[2].models.some(item => item.name === model)
      || data[0].bindings[role] === model) return false;
    return this.action('Přiřazení role', async () => {
      const result = await this.post('/api/system/upgrades/apply', { role, targetModel: model });
      if (result.ok !== true || result.status !== 'started') throw Error('Backend nepotvrdil trvalé zahájení přiřazení.');
      await this.load('roles', true);
      return 'Požadavek na změnu role byl trvale přijat. Dokončení je asynchronní; ověř aktuální přiřazení obnovením této záložky.';
    }, 'Přiřadit ' + model + ' roli ' + role + '? Model se může stahovat a ověřovat; stav se změní až po dokončení.');
  }
  async evaluate(role, model) {
    const roles = this.resources.get('evaluations')?.data?.[0]?.roles;
    const plan = roles?.[role];
    const row = plan?.artifacts?.find(item => item.model === model);
    if (!ROLES.includes(role) || !row || row.applicable === false || plan.measurementReady === false
      || (plan.measurementReady === undefined && plan.decisionReady === false)
      || !EXACT_DIGEST.test(row.digestSha256 || '') || !EXACT_DIGEST.test(plan.suiteContractSha256 || '')) return false;
    return this.action('Test modelu', async () => {
      const result = await this.post('/api/system/models/evaluate', { model: row.model,
        digestSha256: row.digestSha256, role, suiteContractSha256: plan.suiteContractSha256 }, 20_000);
      if (result.accepted !== true || result.model !== row.model || !String(result.role || '').split(',').includes(role))
        throw Error('Backend nepotvrdil přesný požadavek na test.');
      this.select('hunt');
      return 'Požadavek na přesný artefakt a sadu role byl přijat. Průběh a výsledek sleduj v GPU huntu.';
    }, 'Otestovat ' + model + ' pro ' + role + '? Použije GPU a uloží nové výsledky; role zůstanou beze změny.');
  }
  async grade(runId) {
    const row = this.resources.get('history')?.data?.[0]?.history?.find(item => item.runId === runId);
    if (!row || row.status !== 'AWAITING_REVIEW' || !/^eval_[a-zA-Z0-9-]{1,100}$/.test(runId)) return false;
    return this.action('Hodnocení uložených odpovědí', async () => {
      const preview = await this.request('/api/system/models/grading/' + encodeURIComponent(runId));
      const grader = preview.graders?.[0];
      if (preview.runId !== runId || preview.model !== row.model || preview.role !== row.role
        || !EXACT_DIGEST.test(preview.sourceSha256 || '')
        || !/^accept_[a-zA-Z0-9-]{1,100}$/.test(grader?.id || ''))
        throw Error('Přejímka hodnotitele nebo identita uložených odpovědí není ověřená.');
      const judge = grader.judge?.modelName || 'deterministické kontroly';
      if (!this.confirmAction('Ohodnotit uložené odpovědi ' + row.model + ' · ' + row.role
        + ' hodnotitelem ' + judge + '? Posudky: ' + (preview.reviewed || []).length
        + '/2. ' + (preview.pairAvailable ? 'Po shodě nezávislé dvojice může vzniknout skóre.'
          : 'Bez přijaté dvojice zůstane posudek průzkumný.')
        + ' Použije GPU; odpovědi se znovu negenerují a role se nezmění.'))
        return false;
      const result = await this.post('/api/system/models/grade', { runId,
        graderAcceptanceId: grader.id, sourceSha256: preview.sourceSha256 }, 20_000);
      if (result.accepted !== true || result.runId !== runId || result.model !== row.model
        || result.role !== row.role) throw Error('Backend nepotvrdil přesné hodnocení.');
      this.select('hunt');
      return 'Hodnocení uložených odpovědí bylo přijato. Průběh sleduj v GPU huntu.';
    });
  }
  setPolicy(key, value) {
    const state = this.resources.get('policy')?.data?.[0];
    if (!state?.valid || !this.policyDraft || !['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays'].includes(key)) return;
    this.policyDraft = { ...this.policyDraft, [key]: value }; this.changed();
  }
  async savePolicy() {
    const state = this.resources.get('policy')?.data?.[0], draft = this.policyDraft;
    if (!state?.valid || !Number.isSafeInteger(state.revision) || state.revision < 1
      || typeof draft?.autoFailoverEnabled !== 'boolean' || typeof draft?.autoCleanupEnabled !== 'boolean'
      || !Number.isSafeInteger(draft?.autoCleanupDays) || draft.autoCleanupDays < 1
      || draft.autoCleanupDays > 3650 || Object.keys(draft).some(key =>
        !['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays'].includes(key))) return false;
    if (['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays'].every(key => draft[key] === state.policy[key])) return false;
    return this.action('Uložení automatizace', async () => {
      const fresh = await this.request('/api/system/models/policy');
      if (!fresh.valid || fresh.revision !== state.revision) throw Error('Politika se mezitím změnila. Obnov ji před úpravou.');
      const result = await this.request('/api/system/models/policy', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: state.revision, ...draft }) });
      if (result.ok !== true || result.revision !== state.revision + 1)
        throw Error('Backend nepotvrdil revizi politiky.');
      const after = await this.request('/api/system/models/policy');
      if (!after.valid || after.revision !== result.revision
        || !['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays'].every(key => after.policy[key] === draft[key]))
        throw Error('Zápis mohl proběhnout, ale nové hodnoty nelze ověřit. Obnov stav před dalším pokusem.');
      this.resources.set('policy', { status: 'ready', data: [after] });
      this.policyDraft = { ...after.policy };
      return 'Politika automatizace byla potvrzena backendem v revizi ' + after.revision + '.';
    }, 'Uložit politiku automatizace? Automatické přepnutí modelu: '
      + (draft.autoFailoverEnabled ? 'zapnuto' : 'vypnuto') + '; automatický úklid: '
      + (draft.autoCleanupEnabled ? 'zapnuto' : 'vypnuto') + ' po ' + draft.autoCleanupDays + ' dnech.');
  }
  onVerifyFailure(event) {
    const identity = event && ROLES.includes(event.role) && typeof event.operationId === 'string'
      && event.operationId.length >= 16 && Number.isSafeInteger(event.committedBindingRevision)
      && event.committedBindingRevision > 0 && Number.isSafeInteger(event.failedAttemptRevision)
      && event.failedAttemptRevision > 0 ? { role: event.role, operationId: event.operationId,
        committedBindingRevision: event.committedBindingRevision,
        failedAttemptRevision: event.failedAttemptRevision } : null;
    this.verifyFailure = { text: text(event?.text, 'Ověření změněného modelu selhalo.'), identity };
    this.changed();
  }
  onVerifyCleared(event) {
    if (this.verifyFailure?.identity?.operationId === event?.operationId) {
      this.verifyFailure = null; this.changed();
    }
  }
  async rollback() {
    const identity = this.verifyFailure?.identity;
    if (!identity) return false;
    return this.action('Návrat modelu', async () => {
      const result = await this.post('/api/system/upgrades/rollback', identity);
      if (result.ok !== true) throw Error('Backend nepotvrdil návrat modelu.');
      this.verifyFailure = null;
      await this.load('roles', true);
      return 'Návrat modelu potvrdil backend. Aktuální role byly znovu načteny.';
    }, 'Vrátit roli ' + identity.role + ' na předchozí model? Použije se přesná identita selhané operace.');
  }
  vm() {
    const tab = this.tab, entry = this.resources.get(tab) || { status: 'idle' }, data = entry.data || [];
    const button = (label, go, disabled = false) => ({ label, go, disabled: this.busy || disabled });
    let rows = [], buttons = [button('Obnovit', () => this.load(tab, true), entry.status === 'loading')];
    if (entry.status === 'ready' && tab === 'overview') {
      rows = data[0].models.map(item => ({ title: item.name,
        subtitle: (item.boundRoles || []).join(', ') || 'Nepřiřazený model',
        meta: text(item.sizeGB, '?') + ' GiB · měřeno ' + text(item.evaluatedRoleCount, 0) + '/' + text(item.applicableRoleCount, 7), actions: [] }));
    } else if (entry.status === 'ready' && tab === 'roles') {
      const bindings = data[0].bindings;
      rows = ROLES.map(role => { const plan = data[1].roles[role], current = bindings[role];
        const measured = plan?.artifacts?.find(item => item.isCurrentBinding);
        return { title: role, subtitle: text(current, 'Nepřiřazeno'),
          meta: measured?.status === 'COMPLETE' && Number.isFinite(measured.score)
            ? (measured.score * 100).toFixed(1) + ' %' : text(measured?.status, 'Nezměřeno'), actions: [] };
      });
    } else if (entry.status === 'ready' && tab === 'evaluations') {
      rows = Object.entries(data[0].roles).flatMap(([role, plan]) => (plan.artifacts || [])
        .filter(item => item.applicable !== false).map(item => ({ title: item.model + ' · ' + role,
          subtitle: text(item.status) + (item.errorCode ? ' · ' + item.errorCode : ''),
          meta: item.status === 'COMPLETE' && Number.isFinite(item.score)
            ? (item.score * 100).toFixed(1) + ' %' : '—',
          actions: [button('Nový test', () => this.evaluate(role, item.model),
            plan.measurementReady === false || !EXACT_DIGEST.test(item.digestSha256 || ''))] })));
    } else if (entry.status === 'ready' && tab === 'history') {
      rows = data[0].history.slice(0, 50).map(item => ({ title: text(item.model) + ' · ' + text(item.role),
        subtitle: text(item.testedAt) + ' · ' + text(item.status),
        meta: item.status === 'COMPLETE' && Number.isFinite(item.score)
          ? (item.score * 100).toFixed(1) + ' %' : '—',
        actions: item.status === 'AWAITING_REVIEW' ? [button('Ohodnotit odpovědi', () => this.grade(item.runId))] : [] }));
    } else if (entry.status === 'ready' && tab === 'hunt') {
      const hunt = data[0], current = hunt.current || {};
      rows = [{ title: 'Stav: ' + hunt.state, subtitle: text(current.request?.model, 'Žádný aktivní model'),
        meta: text(hunt.progress?.phase, text(current.status)), actions: [] }]
        .concat((hunt.recent || []).slice(0, 10).map(item => ({ title: text(item.request?.model, 'GPU hunt'),
          subtitle: text(item.status) + ' · ' + text(item.finishedAt, item.startedAt), meta: text(item.runId), actions: [] })));
      for (const action of ['start', 'stop', 'pause', 'resume']) buttons.push(button(
        ({ start: 'Spustit', stop: 'Zastavit', pause: 'Pozastavit', resume: 'Obnovit' })[action],
        () => this.hunt(action), action === 'stop' && !['RUNNING', 'STOPPING'].includes(hunt.state)));
    } else if (entry.status === 'ready' && tab === 'candidates') {
      const downloads = data[1].downloads;
      rows = data[0].candidates.slice(0, 150).map(item => {
        const download = downloads.find(row => row.model === item.name);
        return { title: item.name, subtitle: (item.installed ? 'Stažený' : 'Katalog · kvalita nezměřena')
          + (item.fitsVram === null ? ' · VRAM neověřena' : item.fitsVram === false ? ' · nad odhadovaným limitem VRAM' : ''),
        meta: download ? text(download.status) : item.vramMb ? (item.vramMb / 1024).toFixed(1) + ' GiB odhad' : 'VRAM neznámá',
        actions: item.installed ? [] : [button('Stáhnout', () => this.pull(item.name),
          download && !['done', 'error'].includes(download.status))] };
      });
      buttons.push(button('Zkontrolovat nové modely', () => this.checkUpgrades()));
    } else if (entry.status === 'ready' && tab === 'governor') {
      rows = Object.entries(data[0].dimensions || {}).map(([name, item]) => ({ title: name,
        subtitle: text(item.status), meta: Number.isFinite(item.score) ? Math.round(item.score * 100) + ' %' : '—', actions: [] }))
        .concat(data[1].proposals.map(item => ({ title: text(item.title), subtitle: text(item.description || item.rationale),
          meta: text(item.status), actions: String(item.status).toLowerCase() === 'pending'
            ? [button('Přijmout', () => this.decideGovernor(item.id, 'approve')),
              button('Zamítnout', () => this.decideGovernor(item.id, 'dismiss'))] : [] })));
      buttons.push(button('Zkontrolovat provoz', () => this.checkGovernor()));
    } else if (entry.status === 'ready' && tab === 'upgrades') {
      const upgrades = data[0];
      rows = upgrades.history.slice(0, 50).map(item => ({ title: text(item.model || item.targetModel || item.type),
        subtitle: text(item.timestamp || item.date || item.appliedAt), meta: text(item.status), actions: [] }));
      buttons.push(button('Hledat nové modely', () => this.checkUpgrades()));
    } else if (entry.status === 'ready' && tab === 'policy') {
      const state = data[0];
      rows = [{ title: 'Autorita politiky', subtitle: state.valid ? 'Ověřená revize ' + state.revision
        : 'Politika není dostupná; automatizace zůstává vypnutá', meta: state.reason || state.status, actions: [] }];
      if (state.valid) buttons.push(button('Uložit politiku', () => this.savePolicy(),
        !this.policyDraft || ['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays']
          .every(key => this.policyDraft[key] === state.policy[key])));
    }
    const modelOptions = tab === 'roles' && entry.status === 'ready'
      ? data[2].models.filter(item => typeof item.name === 'string').map(item => ({ value: item.name, label: item.name })) : [];
    const policy = tab === 'policy' && entry.status === 'ready' && data[0].valid ? this.policyDraft : null;
    return { tabs: TABS.map(([id, label]) => ({ label, cls: id === tab ? 'on' : '', go: () => this.select(id) })),
      rows: rows.slice(0, 150), buttons, status: this.notice || (entry.status === 'error'
        ? 'Načtení selhalo: ' + entry.error : entry.status === 'loading' || entry.status === 'idle'
          ? 'Načítám ověřená data z backendu…' : rows.length ? 'Data z backendu. Nezměřené modely nemají skóre kvality.' : 'Backend nevrátil žádné položky.'),
      hasRoleForm: tab === 'roles' && entry.status === 'ready',
      roleOptions: ROLES.map(value => ({ value, label: value })), modelOptions,
      selectedRole: this.selectedRole, selectedModel: this.selectedModel,
      hasPolicyForm: Boolean(policy), policyFailover: policy?.autoFailoverEnabled || false,
      policyCleanup: policy?.autoCleanupEnabled || false, policyDays: policy?.autoCleanupDays || 14,
      setPolicyFailover: event => this.setPolicy('autoFailoverEnabled', event.target.checked),
      setPolicyCleanup: event => this.setPolicy('autoCleanupEnabled', event.target.checked),
      setPolicyDays: event => this.setPolicy('autoCleanupDays', Number(event.target.value)),
      verifyWarning: this.verifyFailure?.text || '', hasRollback: Boolean(this.verifyFailure?.identity),
      rollback: () => this.rollback(),
      setRole: event => { this.selectedRole = event.target.value; this.changed(); },
      setModel: event => { this.selectedModel = event.target.value; this.changed(); },
      applyRole: () => this.assignRole(),
      applyRoleDisabled: this.busy || !modelOptions.some(item => item.value === this.selectedModel)
        || data[0]?.bindings?.[this.selectedRole] === this.selectedModel };
  }
}

module.exports = { ModelWorkspace, TABS, ROLES, validResource };
