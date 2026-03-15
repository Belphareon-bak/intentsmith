"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-status.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");

// v125: Dynamic port discovery
function _c3BackendUrl() {
  try {
    if (typeof window !== 'undefined' && window.electronC3) {
      var url = window.electronC3.getBackendUrl();
      if (url) return url;
    }
  } catch(e) {}
  return 'http://127.0.0.1:3335';
}
function _c3Port() {
  try {
    if (typeof window !== 'undefined' && window.electronC3) {
      var p = window.electronC3.getPort();
      if (p) return p;
    }
  } catch(e) {}
  return 3335;
}

/* ═══ StatusBarContribution ═══ */
let C3StatusBarContribution = class C3StatusBarContribution {

  onStart() {
    // Lazy resolve — StatusBar from window.theia.container (set before onStart)
    try {
      var c = window.theia && window.theia.container;
      if (c) this.statusBar = c.get(browser_1.StatusBar);
    } catch (e) { /* ignore */ }
    if (!this.statusBar) {
      console.warn('[C3] StatusBar not available, skipping status items');
      return;
    }

    try {
      // C3 brand
      this.statusBar.setElement('c3-brand', {
        text: '$(c3) C3 Studio',
        tooltip: 'C3 Studio',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 1000
      });

      // Version (placeholder — updated dynamically from backend)
      this.statusBar.setElement('c3-version', {
        text: 'v...',
        tooltip: 'C3 Studio version',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 999
      });

      // Backend connection
      this.statusBar.setElement('c3-backend', {
        text: '$(plug) :' + _c3Port(),
        tooltip: 'C3 Backend',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 1
      });

      // FS usage indicator
      this.statusBar.setElement('c3-fs', {
        text: '$(database) FS',
        tooltip: 'Filesystem usage',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 0
      });

      // Monitor backend health + fetch version
      this._checkBackend();
      setInterval(() => this._checkBackend(), 30000);
    } catch (err) {
      console.warn('[C3] StatusBar init error:', err.message);
    }
  }

  async _checkBackend() {
    if (!this.statusBar) return;
    try {
      const res = await fetch(_c3BackendUrl() + '/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        this.statusBar.setElement('c3-backend', {
          text: '$(plug) :' + _c3Port(),
          tooltip: 'C3 Backend — Connected',
          alignment: browser_1.StatusBarAlignment.RIGHT,
          priority: 1,
          className: 'c3-status-connected'
        });
        // Fetch version from backend (single source of truth: package.json)
        this._fetchVersion();
      }
    } catch (e) {
      this.statusBar.setElement('c3-backend', {
        text: '$(plug) Offline',
        tooltip: 'C3 Backend — Disconnected',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 1,
        className: 'c3-status-disconnected'
      });
    }
  }

  async _fetchVersion() {
    if (!this.statusBar || this._versionFetched) return;
    try {
      const res = await fetch(_c3BackendUrl() + '/api/system/info', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data.version) {
          this._versionFetched = true;
          this.statusBar.setElement('c3-version', {
            text: 'v' + data.version,
            tooltip: 'C3 Studio v' + data.version,
            alignment: browser_1.StatusBarAlignment.LEFT,
            priority: 999
          });
          this.statusBar.setElement('c3-brand', {
            text: '$(c3) C3 Studio',
            tooltip: 'C3 Studio v' + data.version,
            alignment: browser_1.StatusBarAlignment.LEFT,
            priority: 1000
          });
        }
      }
    } catch { /* non-critical */ }
  }
};

// Proper Theia DI decorators (compiled form) — decorate() returns void, do NOT reassign
inversify_1.decorate(inversify_1.injectable(), C3StatusBarContribution);

/* ═══ DI Module ═══ */
const _statusInstance = new C3StatusBarContribution();
exports.default = new inversify_1.ContainerModule((bind) => {
  // toConstantValue — no dynamic resolution, no circular dependency risk
  bind(C3StatusBarContribution).toConstantValue(_statusInstance);
  bind(browser_1.FrontendApplicationContribution).toService(C3StatusBarContribution);
});
