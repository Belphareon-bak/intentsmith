'use strict';

const { decorate, injectable, inject } = require('@theia/core/shared/inversify');
const { ElectronMenuContribution } = require('@theia/core/lib/electron-browser/menu/electron-menu-contribution');
const { ElectronMainMenuFactory } = require('@theia/core/lib/electron-browser/menu/electron-main-menu-factory');

// Studio 2 owns its title bar. The classic title/menu preferences are shared
// with Legacy; synchronizing them here can request a restart during startup
// and change Legacy's next window. Keep Theia's commands and native menu model,
// but leave those preferences untouched and keep its duplicate chrome hidden.
class Studio2ElectronMenuContribution extends ElectronMenuContribution {
  handleTitleBarStyling(app) {
    this.titleBarStyle = 'custom';
    this.setMenu(app);
  }

  setMenu(app) {
    this.factory.setMenuBar();
    app.shell.topPanel.hide();
    window.electronTheiaCore.setMenuBarVisible(false);
  }

  attachMenuBarVisibilityListener() {
    // The prototype's title bar remains visible, including in full screen.
  }

  handleToggleMaximized() {
    // Maximizing does not restore the host menu around the prototype UI.
  }
}
decorate(injectable(), Studio2ElectronMenuContribution);
decorate(inject(ElectronMainMenuFactory), Studio2ElectronMenuContribution, 0);

module.exports = { Studio2ElectronMenuContribution, ElectronMenuContribution };
