// v130: Media Model Discovery — cached ComfyUI model listing
// ══════════════════════════════════════════════════════════════════════════════

export class MediaModelDiscovery {
  constructor(connector) {
    this._connector = connector;
    this._cache = null;
    this._cacheTime = 0;
    this._ttl = 5 * 60 * 1000; // 5 minutes
  }

  async _fetch() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTime) < this._ttl) {
      return this._cache;
    }

    const data = await this._connector.getObjectInfo();
    this._cache = data;
    this._cacheTime = now;
    return data;
  }

  async getCheckpoints() {
    const data = await this._fetch();
    return data.checkpoints || [];
  }

  async getLoRAs() {
    const data = await this._fetch();
    return data.loras || [];
  }

  async getVAEs() {
    const data = await this._fetch();
    return data.vaes || [];
  }

  invalidateCache() {
    this._cache = null;
    this._cacheTime = 0;
  }
}
