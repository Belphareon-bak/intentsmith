'use strict';

const { ContainerModule } = require('@theia/core/shared/inversify');
const browser = require('@theia/core/lib/browser');

const MODE_KEY = 'intentsmith-studio-ui-mode';
const MODE_CLASSIC = 'classic';
const MODE_STUDIO2 = 'studio2';

function currentMode() {
  return window.__intentsmithStudioMode === MODE_STUDIO2 ? MODE_STUDIO2 : MODE_CLASSIC;
}

function selectMode(mode) {
  if (mode !== MODE_CLASSIC && mode !== MODE_STUDIO2) throw new TypeError('Unsupported Studio UI mode');
  if (mode === currentMode()) return false;
  // Theia's Electron window service mediates reload and checks close vetoes.
  // Browser location.reload is blocked by the desktop navigation boundary.
  if (typeof window.electronTheiaCore?.requestReload !== 'function') {
    throw new Error('Theia Electron reload API is unavailable');
  }
  window.localStorage.setItem(MODE_KEY, mode);
  window.electronTheiaCore.requestReload();
  return true;
}

class StudioModeContribution {
  onStart() {
    window.IntentSmithStudioMode = Object.freeze({ currentMode, selectMode });
    const container = window.theia && window.theia.container;
    if (!container) throw new Error('Theia container is unavailable for Studio mode switch');
    const status = container.get(browser.StatusBar);
    status.setElement('intentsmith-ui-mode', {
      name: 'Režim Studia',
      text: currentMode() === MODE_STUDIO2 ? '$(layout) Klasické Studio' : '$(layout) Studio 2',
      tooltip: currentMode() === MODE_STUDIO2 ? 'Přepnout na Klasické Studio' : 'Přepnout na Studio 2',
      alignment: browser.StatusBarAlignment.RIGHT,
      priority: 1000,
      onclick: () => selectMode(currentMode() === MODE_STUDIO2 ? MODE_CLASSIC : MODE_STUDIO2),
    });
  }
}

module.exports = {
  default: new ContainerModule(bind => {
    bind(StudioModeContribution).toSelf().inSingletonScope();
    bind(browser.FrontendApplicationContribution).toService(StudioModeContribution);
  }),
  currentMode,
  selectMode,
};
