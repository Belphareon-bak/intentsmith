"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-status.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");

/* ═══ StatusBarContribution ═══ */
let C3StatusBarContribution = class C3StatusBarContribution {

  onStart() {
    if (!this.statusBar) {
      console.warn('[C3] StatusBar not available, skipping status items');
      return;
    }

    try {
      // C3 brand
      this.statusBar.setElement('c3-brand', {
        text: '$(c3) C3 Studio',
        tooltip: 'C3 Studio v0.1.0',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 1000
      });

      // Version
      this.statusBar.setElement('c3-version', {
        text: 'v0.1.0',
        tooltip: 'C3 Studio version',
        alignment: browser_1.StatusBarAlignment.LEFT,
        priority: 999
      });

      // Backend connection
      this.statusBar.setElement('c3-backend', {
        text: '$(plug) :3335',
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

      // Monitor backend health
      this._checkBackend();
      setInterval(() => this._checkBackend(), 30000);
    } catch (err) {
      console.warn('[C3] StatusBar init error:', err.message);
    }
  }

  async _checkBackend() {
    if (!this.statusBar) return;
    try {
      const res = await fetch('http://localhost:3335/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        this.statusBar.setElement('c3-backend', {
          text: '$(plug) :3335',
          tooltip: 'C3 Backend — Connected',
          alignment: browser_1.StatusBarAlignment.RIGHT,
          priority: 1,
          className: 'c3-status-connected'
        });
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
};

// Proper Theia DI decorators (compiled form)
C3StatusBarContribution = inversify_1.decorate(inversify_1.injectable(), C3StatusBarContribution);

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3StatusBarContribution).toDynamicValue(ctx => {
    const contrib = new C3StatusBarContribution();
    // Inject StatusBar if available
    try {
      contrib.statusBar = ctx.container.get(browser_1.StatusBar);
    } catch (e) {
      console.warn('[C3] StatusBar service not found');
    }
    return contrib;
  }).inSingletonScope();
  bind(browser_1.FrontendApplicationContribution).toService(C3StatusBarContribution);
});
