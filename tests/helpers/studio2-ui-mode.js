// Explicit Electron DOM probe. Invoked only after the M0 boundary soak has
// already completed; UI reload traffic is excluded from that M0 verdict.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function probeStudio2ModeSwitch({ cdp, evaluate, fail }) {
  const inspect = `(() => ({
    mode: window.__intentsmithStudioMode || null,
    savedMode: window.localStorage.getItem('intentsmith-studio-ui-mode'),
    electronReloadReady: typeof window.electronTheiaCore?.requestReload === 'function',
    switchReady: typeof window.IntentSmithStudioMode?.selectMode === 'function',
    classicSidebar: Boolean(document.getElementById('intentsmith-sidebar')),
    classicChat: Boolean(document.getElementById('intentsmith-chat-panel')),
    studio2: Boolean(document.querySelector('[data-studio-ui="studio2"]')),
    studio2Widget: Boolean(document.getElementById('intentsmith-studio2')),
    studio2WidgetText: document.getElementById('intentsmith-studio2')?.textContent?.slice(0, 200) || null,
    widgetIds: [...document.querySelectorAll('[id*="intentsmith"]')].map(el => el.id).slice(0, 24),
    transport: Boolean(window.IntentSmithWS?.connect),
    bus: Boolean(window.IntentSmithBus?.on),
    classicFacade: typeof window._intentsmith?.renderChat === 'function',
    terminalClient: typeof window.IntentSmithTerminal?.send === 'function',
    terminalInput: Boolean(document.querySelector('[aria-label^="Příkaz terminálu relace"]')),
    m2Panel: Boolean(document.querySelector('[aria-label="Změny M2"]')),
    settingsCategories: Boolean(document.querySelector('nav[aria-label="Kategorie nastavení"]')),
    environmentPanel: Boolean(document.querySelector('.intentsmith-development')),
    environmentLoaded: Boolean(document.querySelector('.intentsmith-development')?.textContent?.includes('Skutečné prostředí backendu')),
    paletteOpen: Boolean(document.querySelector('[role="dialog"][aria-label="Paleta příkazů"]')),
    columnsVisible: Boolean(document.querySelector('.intentsmith-s2-columns')),
    busListeners: window.IntentSmithBus?._debug?.() || {},
    sessionTabs: document.querySelectorAll('.intentsmith-s2-tab').length,
    columnSessions: [...document.querySelectorAll('.intentsmith-s2-column-head select')].map(select => select.value),
    catalogSection: document.querySelector('[data-catalog-section]')?.getAttribute('data-catalog-section') || null,
    catalogStatus: document.querySelector('[data-catalog-status]')?.getAttribute('data-catalog-status') || null,
  }))()`;
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 60_000;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(cdp, inspect);
        if (predicate(last)) return last;
      } catch {
        // Navigation temporarily destroys the V8 context.
        cdp.assertHealthy();
      }
      await delay(150);
    }
    fail('studio2-mode-timeout', { stage: label, last });
  };
  const classic = await waitFor(s => s.mode === 'classic' && s.switchReady
    && s.classicSidebar && s.classicChat && !s.studio2 && s.transport, 'initial-classic');
  await evaluate(cdp, `(() => {
    setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0);
    return true;
  })()`);
  const studio2 = await waitFor(s => s.mode === 'studio2' && s.switchReady
    && s.studio2 && !s.classicSidebar && !s.classicChat
    && s.transport && s.bus && !s.classicFacade
    && s.busListeners['chat:message'] === 1 && s.busListeners['chat:terminal'] === 1
    && s.busListeners['terminal:output'] === 1 && s.busListeners['terminal:line'] === 1
    && s.terminalClient, 'studio2-only');
  await evaluate(cdp, `(async () => {
    for (let i = 0; i < 5; i++) {
      document.querySelector('[aria-label="Nová relace"]').click();
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    document.querySelector('[aria-label="3 sloupce"]').click();
    return true;
  })()`);
  const six = await waitFor(s => s.mode === 'studio2' && s.sessionTabs === 6
    && s.columnSessions.length === 3, 'six-sessions');
  const original = [...six.columnSessions];
  await evaluate(cdp, `(() => {
    const select = document.querySelectorAll('.intentsmith-s2-column-head select')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(original[1])});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const swapped = await waitFor(s => s.columnSessions[0] === original[1]
    && s.columnSessions[1] === original[0] && s.columnSessions[2] === original[2], 'column-swap');
  await evaluate(cdp, `(() => {
    const terminal = [...document.querySelectorAll('.intentsmith-s2-column.focused .intentsmith-s2-bottom-tabs button')]
      .find(node => node.textContent === 'Terminál');
    terminal.click();
    return true;
  })()`);
  const terminalUi = await waitFor(s => s.terminalInput && s.busListeners['terminal:output'] === 1, 'terminal-ui');
  await evaluate(cdp, `(() => {
    const changes = [...document.querySelectorAll('.intentsmith-s2-side-tabs button')]
      .find(node => node.textContent === 'Změny');
    changes.click();
    return true;
  })()`);
  const m2Ui = await waitFor(s => s.m2Panel, 'm2-review-panel');
  await evaluate(cdp, `(() => {
    setTimeout(() => window.IntentSmithStudioMode.selectMode('classic'), 0);
    return true;
  })()`);
  const restored = await waitFor(s => s.mode === 'classic' && s.switchReady
    && s.classicSidebar && s.classicChat && !s.studio2 && s.transport, 'classic-restored');
  await evaluate(cdp, `(() => {
    setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0);
    return true;
  })()`);
  const persisted = await waitFor(s => s.mode === 'studio2' && s.studio2
    && !s.classicChat && s.sessionTabs === 6
    && s.columnSessions[0] === swapped.columnSessions[0]
    && s.columnSessions[1] === swapped.columnSessions[1]
    && s.columnSessions[2] === swapped.columnSessions[2], 'session-restore');
  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('nav[aria-label="Hlavní navigace"] button')]
      .find(node => node.textContent === 'Projekty');
    button.click();
    return true;
  })()`);
  const catalog = await waitFor(s => s.catalogSection === 'Projekty' && s.catalogStatus === 'ready', 'project-catalog');
  const themes = await evaluate(cdp, `(async () => {
    const styles = ['intentsmith','studio','clean','matrix','japanese','midnight','nocturne'];
    const darkOnly = new Set(['matrix','japanese','midnight']);
    const seen = [];
    for (const style of styles) {
      const select = document.querySelector('[aria-label="Styl Studia 2"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, style);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 35));
      for (const tone of darkOnly.has(style) ? ['dark'] : ['dark','light']) {
        const wanted = darkOnly.has(style) ? 'th-' + style : 'th-' + style + '-' + tone;
        let root = document.querySelector('[data-studio-ui="studio2"]');
        if (!root.classList.contains(wanted)) {
          document.querySelector('[aria-label="Přepnout světlý a tmavý motiv"]').click();
          await new Promise(resolve => setTimeout(resolve, 35));
          root = document.querySelector('[data-studio-ui="studio2"]');
        }
        const css = getComputedStyle(root);
        seen.push(root.classList.contains(wanted)
          && Boolean(css.getPropertyValue('--s0').trim())
          && Boolean(css.getPropertyValue('--faint').trim()));
      }
    }
    return seen;
  })()`);
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('nav[aria-label="Hlavní navigace"] button')]
      .find(node => node.textContent === 'Nastavení').click();
    return true;
  })()`);
  await waitFor(s => s.settingsCategories, 'settings-categories');
  await evaluate(cdp, `(() => {
    [...document.querySelectorAll('nav[aria-label="Kategorie nastavení"] button')]
      .find(node => node.textContent === 'Systém').click();
    return true;
  })()`);
  const environment = await waitFor(s => s.environmentPanel && s.environmentLoaded, 'backend-environment');
  await evaluate(cdp, `(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(s => s.paletteOpen, 'command-palette');
  await evaluate(cdp, `(() => {
    document.querySelector('.intentsmith-s2-palette-results button').click();
    return true;
  })()`);
  const palette = await waitFor(s => !s.paletteOpen && s.columnsVisible, 'palette-session-navigation');
  return Object.freeze({
    classicInitiallyAttached: classic.classicSidebar && classic.classicChat,
    studio2ExclusivelyAttached: studio2.studio2 && !studio2.classicSidebar && !studio2.classicChat,
    oneReusedTransportInStudio2: studio2.transport && studio2.bus
      && studio2.busListeners['chat:message'] === 1 && studio2.busListeners['chat:terminal'] === 1
      && studio2.busListeners['terminal:output'] === 1 && studio2.busListeners['terminal:line'] === 1
      && studio2.terminalClient && !studio2.classicFacade,
    classicRestored: restored.classicSidebar && restored.classicChat && !restored.studio2,
    sixSessionsInThreeColumns: six.sessionTabs === 6 && six.columnSessions.length === 3,
    visibleSessionSwap: swapped.columnSessions[0] === original[1] && swapped.columnSessions[1] === original[0],
    terminalPanelConnected: terminalUi.terminalInput && terminalUi.terminalClient,
    m2ReviewPanelRendered: m2Ui.m2Panel,
    backendEnvironmentLoaded: environment.environmentLoaded,
    commandPaletteNavigatesSession: palette.columnsVisible && !palette.paletteOpen,
    sessionsPersistedAcrossReload: persisted.sessionTabs === 6 && persisted.columnSessions.length === 3,
    projectCatalogLoaded: catalog.catalogSection === 'Projekty' && catalog.catalogStatus === 'ready',
    elevenThemesRendered: themes.length === 11 && themes.every(Boolean),
  });
}
