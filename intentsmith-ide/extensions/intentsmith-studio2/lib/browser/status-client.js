'use strict';

// Read-only observations for the status line. Each source fails independently;
// a missing response must never leave an earlier measurement looking current.
class StatusClient {
  constructor({ backendUrl, fetchImpl = fetch, onChange = () => {} }) {
    this.backendUrl = backendUrl;
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.health = null;
    this.system = null;
    this.gpu = null;
    this.timer = null;
    this.inflight = null;
  }
  async get(path) {
    const base = this.backendUrl();
    const url = new URL(path, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(base).origin)
      throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(url.href, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return response.json();
  }
  async refresh() {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const paths = ['/api/health', '/api/system/info', '/api/system/gpu'];
      const results = await Promise.allSettled(paths.map(path => this.get(path)));
      [this.health, this.system, this.gpu] = results.map(result => result.status === 'fulfilled' ? result.value : null);
      this.onChange();
    })();
    try { await this.inflight; } finally { this.inflight = null; }
  }
  start() {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 30000);
    this.timer.unref?.();
  }
  destroy() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  vm(transport) {
    const connection = transport?.connection || 'Připojování';
    const connected = connection === 'Připojeno';
    const ready = connected && this.health?.ready === true;
    let port = '';
    try { const url = new URL(this.backendUrl()); port = url.port || (url.protocol === 'https:' ? '443' : '80'); } catch {}
    const dbSize = this.system?.db?.size_mb;
    const primary = this.gpu?.profile?.gpus?.find(gpu => !gpu.is_igpu && gpu.vram_mb > 0);
    return {
      connection: connected && this.health?.ready === false ? 'Backend omezený' : connection,
      dot: ready ? 'ok' : connected ? 'warn' : 'err',
      backend: this.health?.version ? 'backend ' + this.health.version : 'Backend není potvrzený',
      ws: connected && port ? 'ws :' + port : 'ws odpojeno',
      db: ready && Number.isFinite(dbSize) && dbSize > 0 ? 'DB ' + dbSize.toLocaleString('cs-CZ') + ' MiB' : 'DB nedostupné',
      gpu: ready && primary ? 'GPU kapacita ' + (primary.vram_mb / 1024).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' GiB'
        : ready && this.gpu?.profile ? 'GPU nedostupné' : 'GPU nezjištěno',
    };
  }
}
module.exports = { StatusClient };
