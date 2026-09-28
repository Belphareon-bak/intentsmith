"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/intentsmith-status.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");

// v125: Dynamic port discovery
function _intentsmithBackendUrl() {
  try {
    if (typeof window !== 'undefined' && window.electronIntentSmith) {
      var url = window.electronIntentSmith.getBackendUrl();
      if (url) return url;
    }
  } catch(e) {}
  return 'http://127.0.0.1:3335';
}
function _intentsmithPort() {
  try {
    if (typeof window !== 'undefined' && window.electronIntentSmith) {
      var p = window.electronIntentSmith.getPort();
      if (p) return p;
    }
  } catch(e) {}
  return 3335;
}

/* ═══ StatusBarContribution ═══ */
let IntentSmithStatusBarContribution = class IntentSmithStatusBarContribution {

  onStart() {
    // Lazy resolve — StatusBar from window.theia.container (set before onStart)
    try {
      var c = window.theia && window.theia.container;
      if (c) this.statusBar = c.get(browser_1.StatusBar);
    } catch (e) { /* ignore */ }
    if (!this.statusBar) {
      console.warn('[IntentSmith] StatusBar not available, skipping status items');
      return;
    }

    try {
      // IntentSmith brand
      this.statusBar.setElement('intentsmith-brand', {
        text: '$(intentsmith) IntentSmith',
        tooltip: 'IntentSmith',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 1000
      });

      // Version (placeholder — updated dynamically from backend)
      this.statusBar.setElement('intentsmith-version', {
        text: 'v...',
        tooltip: 'IntentSmith version',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 999
      });

      // Backend connection
      this.statusBar.setElement('intentsmith-backend', {
        text: '$(plug) :' + _intentsmithPort(),
        tooltip: 'IntentSmith Backend',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 1
      });

      // FS usage indicator
      this.statusBar.setElement('intentsmith-fs', {
        text: '$(database) FS',
        tooltip: 'Filesystem usage',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 0
      });

      // Monitor backend health + fetch version
      this._checkBackend();
      setInterval(() => this._checkBackend(), 30000);
    } catch (err) {
      console.warn('[IntentSmith] StatusBar init error:', err.message);
    }
  }

  async _checkBackend() {
    if (!this.statusBar) return;
    try {
      const res = await fetch(_intentsmithBackendUrl() + '/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        this.statusBar.setElement('intentsmith-backend', {
          text: '$(plug) :' + _intentsmithPort(),
          tooltip: 'IntentSmith Backend — Connected',
          alignment: browser_1.StatusBarAlignment.RIGHT,
          priority: 1,
          className: 'intentsmith-status-connected'
        });
        // Fetch version from backend (single source of truth: package.json)
        this._fetchVersion();
      }
    } catch (e) {
      this.statusBar.setElement('intentsmith-backend', {
        text: '$(plug) Offline',
        tooltip: 'IntentSmith Backend — Disconnected',
        alignment: browser_1.StatusBarAlignment.RIGHT,
        priority: 1,
        className: 'intentsmith-status-disconnected'
      });
    }
  }

  async _fetchVersion() {
    if (!this.statusBar || this._versionFetched) return;
    try {
      const res = await fetch(_intentsmithBackendUrl() + '/api/system/info', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        if (data.version) {
          this._versionFetched = true;
          this.statusBar.setElement('intentsmith-version', {
            text: 'v' + data.version,
            tooltip: 'IntentSmith v' + data.version,
            alignment: browser_1.StatusBarAlignment.LEFT,
            priority: 999
          });
          this.statusBar.setElement('intentsmith-brand', {
            text: '$(intentsmith) IntentSmith',
            tooltip: 'IntentSmith v' + data.version,
            alignment: browser_1.StatusBarAlignment.LEFT,
            priority: 1000
          });
        }
      }
    } catch { /* non-critical */ }
  }
};

// Proper Theia DI decorators (compiled form) — decorate() returns void, do NOT reassign
inversify_1.decorate(inversify_1.injectable(), IntentSmithStatusBarContribution);

/* ═══ DI Module ═══ */
const _statusInstance = new IntentSmithStatusBarContribution();
exports.default = new inversify_1.ContainerModule((bind) => {
  // toConstantValue — no dynamic resolution, no circular dependency risk
  bind(IntentSmithStatusBarContribution).toConstantValue(_statusInstance);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithStatusBarContribution);
});
