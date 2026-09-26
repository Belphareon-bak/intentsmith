'use strict';

const CATEGORIES = Object.freeze(['bug', 'performance', 'ux', 'feature', 'other']);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 5 * 1024 * 1024;

function encode(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

class FeedbackWorkspace {
  constructor({ backendUrl, fetchImpl = fetch, onChange = () => {}, lastResponse = () => '', version = () => null } = {}) {
    this.backendUrl = backendUrl; this.fetchImpl = fetchImpl; this.onChange = onChange;
    this.lastResponse = lastResponse; this.version = version;
    this.category = 'bug'; this.message = ''; this.files = [];
    this.attachLast = false; this.attachLogs = false;
    this.busy = false; this.uncertain = false; this.cooldownUntil = 0; this.notice = '';
  }
  changed() { this.onChange(); }
  setCategory(value) { if (CATEGORIES.includes(value)) { this.category = value; this.changed(); } }
  setMessage(value) { if (typeof value === 'string' && value.length <= 2000) { this.message = value; this.changed(); } }
  async addFiles(list) {
    try {
      const files = Array.from(list || []);
      let total = this.files.reduce((sum, item) => sum + item.size, 0);
      const prepared = [];
      for (const file of files) {
        if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE
          || total + file.size > MAX_TOTAL || typeof file.name !== 'string' || !file.name)
          throw Error('Soubor překračuje limit 2 MiB nebo přílohy dohromady 5 MiB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== file.size) throw Error('Velikost souboru se během čtení změnila.');
        const name = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.')
          .replace(/^[._-]+/, '').slice(0, 100) || 'file';
        prepared.push({ name, type: file.type || 'application/octet-stream',
          data: encode(bytes), size: file.size });
        total += file.size;
      }
      this.files.push(...prepared); this.notice = ''; this.changed(); return true;
    } catch (error) { this.notice = error?.message || 'Přílohu nelze přečíst.'; this.changed(); return false; }
  }
  removeFile(index) { if (Number.isInteger(index) && index >= 0 && index < this.files.length) {
    this.files.splice(index, 1); this.changed(); } }
  async request(path, options = {}, json = true) {
    const base = this.backendUrl?.();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { credentials: 'same-origin',
      signal: AbortSignal.timeout(20_000), ...options });
    if (!response.ok) {
      let body = {}; try { body = await response.json(); } catch {}
      throw Object.assign(Error(body.error || 'HTTP ' + response.status), { status: response.status });
    }
    return json ? response.json() : response.text();
  }
  async send() {
    if (this.busy || this.uncertain || Date.now() < this.cooldownUntil
      || !this.message.trim() || this.message.length > 2000) return false;
    this.busy = true; this.notice = 'Odesílám zpětnou vazbu…'; this.changed();
    let id = null, submitted = false;
    try {
      const attachments = this.files.slice();
      if (this.attachLogs) {
        const logs = await this.request('/api/logs/export', {}, false);
        const bytes = new TextEncoder().encode(logs);
        if (bytes.length > MAX_FILE || attachments.reduce((sum, file) => sum + file.size, bytes.length) > MAX_TOTAL)
          throw Error('Serverové logy překračují limit příloh. Vypni jejich přiložení.');
        attachments.push({ name: 'server-logs.log', type: 'text/plain',
          size: bytes.length, data: encode(bytes) });
      }
      const payload = { category: this.category, message: this.message.trim(),
        version: this.version() || null };
      if (this.attachLast) payload.lastResponse = String(this.lastResponse() || '').slice(0, 4000);
      submitted = true;
      const result = await this.request('/api/feedback', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (result.ok !== true || !Number.isSafeInteger(result.id) || result.id < 1)
        throw Error('Odpověď backendu nepotvrdila číslo záznamu. Neodesílej zprávu znovu naslepo.');
      id = result.id;
      for (const file of attachments) {
        const saved = await this.request('/api/feedback/' + id + '/attach', { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, type: file.type, data: file.data }) });
        if (saved.ok !== true || saved.filename !== file.name)
          throw Error('Příloha ' + file.name + ' nebyla ověřena. Zpráva #' + id + ' byla uložena.');
      }
      this.message = ''; this.files = []; this.attachLast = false; this.attachLogs = false;
      this.cooldownUntil = Date.now() + 30_000;
      this.notice = 'Zpráva #' + id + ' a její přílohy byly potvrzeny backendem.';
      return true;
    } catch (error) {
      this.uncertain = submitted && !id && !error?.status;
      this.notice = id ? 'Zpráva #' + id + ' byla uložena, ale přílohy nemusí být úplné. ' + error.message
        : (error?.message || 'Výsledek odeslání je nejistý. Před opakováním zkontroluj historii zpětné vazby.');
      if (id) { this.message = ''; this.files = []; this.cooldownUntil = Date.now() + 30_000; }
      return false;
    } finally { this.busy = false; this.changed(); }
  }
  vm() {
    return { categories: CATEGORIES.map(value => ({ value, label: ({ bug: 'Chyba', performance: 'Výkon',
      ux: 'Rozhraní', feature: 'Nápad', other: 'Jiné' })[value] })), category: this.category,
      setCategory: event => this.setCategory(event.target.value), message: this.message,
      setMessage: event => this.setMessage(event.target.value), files: this.files.map((file, index) => ({
        name: file.name, size: Math.round(file.size / 1024) + ' KiB', remove: () => this.removeFile(index) })),
      chooseFiles: event => this.addFiles(event.target.files),
      attachLast: this.attachLast, setAttachLast: event => { this.attachLast = event.target.checked; this.changed(); },
      attachLogs: this.attachLogs, setAttachLogs: event => { this.attachLogs = event.target.checked; this.changed(); },
      disabled: this.busy || this.uncertain || Date.now() < this.cooldownUntil || !this.message.trim(),
      send: () => this.send(), notice: this.notice || 'Zpráva se uloží do lokální databáze backendu.' };
  }
}
module.exports = { FeedbackWorkspace, CATEGORIES };
