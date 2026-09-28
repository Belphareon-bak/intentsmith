'use strict';

// Minimální náhrada běhového prostředí plátna (DCLogic), ve kterém žije logika
// prototypu: stav + setState + forceUpdate. Překreslení obstará StudioRoot.
class DCLogic {
  constructor() {
    this.props = {};
    this.state = null;
    this._listeners = new Set();
  }

  setState(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    if (!p) return;
    this.state = Object.assign({}, this.state || {}, p);
    this._emit();
  }

  forceUpdate() { this._emit(); }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() { for (const fn of this._listeners) fn(); }
}

module.exports = { DCLogic };
