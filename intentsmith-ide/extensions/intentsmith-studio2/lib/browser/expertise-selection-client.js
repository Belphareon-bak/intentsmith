'use strict';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

class ExpertiseSelectionClient {
  constructor({ store, catalog, fetchImpl, confirmAction, onChange }) {
    Object.assign(this, { store, catalog, fetchImpl, confirmAction, onChange });
    this.entries = new Map();
  }

  entry(session) {
    if (!session) return { status: 'none', expertises: [], error: '' };
    let entry = this.entries.get(session.id);
    if (!entry || (session._convId && entry.conversationId !== session._convId)) {
      entry = { status: 'idle', conversationId: session._convId || null, expertises: [], revision: null,
        error: '', busy: false, uncertain: false, pendingId: null };
      this.entries.set(session.id, entry);
    }
    return entry;
  }

  async request(path, options = {}) {
    const base = this.catalog.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { credentials: 'same-origin',
      signal: AbortSignal.timeout(10_000), ...options });
    let data;
    try { data = await response.json(); } catch { throw Error('Backend nevrátil čitelnou odpověď.'); }
    if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  validate(data, conversationId) {
    if (!data || data.conversationId !== conversationId || !/^[a-f0-9]{64}$/.test(data.revision)
      || !Array.isArray(data.expertises) || data.expertises.length > 3
      || data.expertises.some(row => !row || typeof row.id !== 'string' || !ID.test(row.id)
        || !Number.isFinite(row.weight) || row.weight < 0.1 || row.weight > 1)) {
      throw Error('Backend vrátil neplatný výběr expertýz.');
    }
    return data;
  }

  async read(conversationId) {
    return this.validate(await this.request('/api/conversations/' + encodeURIComponent(conversationId) + '/expertises'), conversationId);
  }

  async load(session, refresh = false) {
    const entry = this.entry(session);
    const id = session?._convId || entry.pendingId;
    if (!session || !id || entry.busy || !refresh && entry.status === 'ready') return entry;
    entry.status = 'loading'; this.onChange();
    try {
      const data = await this.read(id);
      if (this.store.find(session.id) !== session || session._convId && session._convId !== id) return entry;
      if (!session._convId && data.expertises.length) session._convId = id;
      Object.assign(entry, { status: 'ready', conversationId: id, expertises: data.expertises,
        revision: data.revision, error: '', uncertain: false,
        pendingId: session._convId ? null : entry.pendingId });
      session.chat.expertise = this.label(data.expertises);
      this.store.changed();
    } catch (error) {
      entry.status = 'error'; entry.error = error.message || 'Výběr nelze načíst.';
    }
    this.onChange();
    return entry;
  }

  label(rows) {
    const items = this.catalog.view('Expertýzy').items || [];
    return rows.length ? rows.map(row => items.find(item => item.id === row.id)?.name || row.id).join(' + ') : 'Výchozí';
  }

  async change(session, action, expertiseId = null) {
    const entry = this.entry(session);
    if (!session || entry.busy || entry.uncertain || session._closed || session.chat._thinking
      || session.chat.specialist || session._projectId || this.store.find(session.id) !== session) return false;
    if (action !== 'clear' && !this.catalog.view('Expertýzy').items.some(item => item.id === expertiseId)) return false;
    entry.busy = true; entry.error = ''; session.chat._selectingExpertise = true; this.onChange();
    const conversationId = session._convId || entry.pendingId || 'studio-' + globalThis.crypto.randomUUID();
    entry.pendingId = conversationId;
    try {
      const before = await this.read(conversationId);
      let next;
      if (action === 'single') next = [{ id: expertiseId, weight: 0.5 }];
      else if (action === 'add') {
        next = before.expertises.some(row => row.id === expertiseId) ? before.expertises
          : [...before.expertises, { id: expertiseId, weight: 0.5 }];
      } else if (action === 'remove') next = before.expertises.filter(row => row.id !== expertiseId);
      else if (action === 'clear') next = [];
      else return false;
      if (next.length > 3) throw Error('V jedné relaci mohou být nejvýše tři expertýzy.');
      if (JSON.stringify(next) === JSON.stringify(before.expertises)) {
        Object.assign(entry, { status: 'ready', expertises: next, revision: before.revision });
        return true;
      }
      let preview = '';
      if (next.length > 1) {
        const query = new URLSearchParams({ expertises: next.map(row => row.id).join(',') });
        for (const row of next) query.set('weight_' + row.id, String(row.weight));
        const result = await this.request('/api/merge-preview?' + query);
        if (!Array.isArray(result.activeExpertises)
          || JSON.stringify(result.activeExpertises) !== JSON.stringify(next.map(row => row.id)))
          throw Error('Náhled kombinace neodpovídá výběru.');
        preview = String(result.promptPreview || '').slice(0, 300);
      }
      if (this.confirmAction(`Použít v relaci ${this.label(next)}?${preview ? '\n\nNáhled: ' + preview : ''}`) !== true)
        return false;
      if (session._closed || this.store.find(session.id) !== session || session.chat._thinking
        || session._convId && session._convId !== conversationId) throw Error('Relace se mezitím změnila.');
      const path = '/api/conversations/' + encodeURIComponent(conversationId) + '/expertises';
      let response;
      try {
        response = this.validate(await this.request(path, { method: 'PUT',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            expectedRevision: before.revision, projectId: session._projectId || null,
            expertises: next, confirmCompatibility: true,
          }) }), conversationId);
      } catch (error) {
        // A lost response may follow a committed write. Read back once; never
        // blindly replay the effect or claim the previous selection survived.
        const observed = await this.read(conversationId).catch(() => null);
        if (!observed || JSON.stringify(observed.expertises) !== JSON.stringify(next)) {
          entry.uncertain = !observed;
          throw error;
        }
        response = observed;
      }
      let observed;
      try { observed = await this.read(conversationId); }
      catch (error) { entry.uncertain = true; throw error; }
      if (observed.revision !== response.revision
        || JSON.stringify(observed.expertises) !== JSON.stringify(next)) {
        entry.uncertain = true;
        throw Error('Výběr se po zápisu nepodařilo potvrdit. Obnov stav před další změnou.');
      }
      if (!session._convId) session._convId = conversationId;
      session.chat.expertise = this.label(next);
      Object.assign(entry, { status: 'ready', conversationId, expertises: next,
        revision: observed.revision, pendingId: null, uncertain: false, error: '' });
      this.store.changed();
      return true;
    } catch (error) {
      entry.status = 'error'; entry.error = error.message || 'Výběr se nepodařilo změnit.';
      return false;
    } finally { entry.busy = false; session.chat._selectingExpertise = false; this.onChange(); }
  }
}

module.exports = { ExpertiseSelectionClient };
