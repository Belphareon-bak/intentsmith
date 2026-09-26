import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Runs after the M0 boundary soak. All selectors belong to the generated
// prototype view, so this also catches a silent return to the former UI.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function probeStudio2ModeSwitch({ cdp, evaluate, fail, artifactRoot }) {
  const inspect = `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const panel = root?.querySelector('.dev-panel[aria-label="Prostředí a závislosti"]');
    const facts = panel?.querySelector('.dev-facts strong')?.textContent?.trim();
    const activeSide = root?.querySelector('.rp .ptabs .ptab.on')?.textContent?.trim();
    return {
      mode: window.__intentsmithStudioMode || null,
      switchReady: typeof window.IntentSmithStudioMode?.selectMode === 'function',
      classicSidebar: Boolean(document.getElementById('intentsmith-sidebar')),
      classicChat: Boolean(document.getElementById('intentsmith-chat-panel')),
      studio2: Boolean(root),
      transport: Boolean(window.IntentSmithWS?.connect),
      bus: Boolean(window.IntentSmithBus?.on),
      classicFacade: typeof window._intentsmith?.renderChat === 'function',
      terminalClient: typeof window.IntentSmithTerminal?.send === 'function',
      terminalInput: Boolean(root?.querySelector('[aria-label^="Příkaz terminálu relace"]')),
      attachmentPicker: Boolean(root?.querySelector('[aria-label="Připojit soubor"]')),
      m2Panel: activeSide?.startsWith('Změny') && Boolean(root?.querySelector('.rp .rp-b')),
      settingsCategories: root?.querySelector('.cat-t h1')?.textContent?.trim() === 'Nastavení',
      environmentPanel: Boolean(panel),
      environmentLoaded: Boolean(facts && facts !== 'Zatím nenačteno' && facts !== 'nezjištěno' && !panel.querySelector('[role="alert"]')),
      paletteOpen: Boolean(root?.querySelector('[role="dialog"][aria-label="Paleta příkazů"]')),
      columnsVisible: Boolean(root?.querySelector('.cols .scol')),
      centerInsideStudio: Boolean(root?.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))),
      studioDark: Boolean(root?.classList.contains('th-studio-dark')),
      busListeners: window.IntentSmithBus?._debug?.() || {},
      sessionTabs: root?.querySelectorAll('.tabs-in .tab').length || 0,
      pinnedTabs: root?.querySelectorAll('.tabs-in .tab .tab-pin').length || 0,
      firstTabTitle: root?.querySelector('.tabs-in .tab:first-child .tab-t')?.textContent?.trim() || null,
      pinAction: [...(root?.querySelectorAll('.dd.ctx .dd-i .dd-t') || [])].some(node => node.textContent.trim() === 'Připnout'),
      columnSessions: [...(root?.querySelectorAll('.cols .scol .pane-t .pane-tt') || [])].map(node => node.textContent.trim()),
      pickerItems: [...(root?.querySelectorAll('.dd.ctx.picker .dd-i .dd-t') || [])].map(node => node.textContent.trim()),
      catalogSection: root?.querySelector('.cat-t h1')?.textContent?.trim() || null,
      catalogStatus: root?.querySelector('.cat-t')?.textContent?.includes('položek z backendu') ? 'ready' : null,
      specialistFileRows: [...(root?.querySelectorAll('.rp .fsec .frow .fr-n') || [])].map(node => node.textContent.trim()),
      specialistPreview: root?.querySelector('.rp .file-action pre')?.textContent || null,
      composerAttachments: [...(root?.querySelectorAll('.scol .comp .att-t') || [])].map(node => node.textContent.trim()),
    };
  })()`;
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 60_000;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await evaluate(cdp, inspect);
        if (predicate(last)) return last;
      } catch {
        cdp.assertHealthy();
      }
      await delay(150);
    }
    fail('studio2-mode-timeout', { stage: label, last });
  };
  const classic = await waitFor(s => s.mode === 'classic' && s.switchReady
    && s.classicSidebar && s.classicChat && !s.studio2 && s.transport, 'initial-classic');
  await evaluate(cdp, `(() => { setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0); return true; })()`);
  const studio2 = await waitFor(s => s.mode === 'studio2' && s.studio2
    && !s.classicSidebar && !s.classicChat && s.transport && s.bus && !s.classicFacade
    && s.busListeners['chat:message'] === 1 && s.busListeners['chat:terminal'] === 1
    && s.busListeners['terminal:output'] === 1 && s.busListeners['terminal:line'] === 1
    && s.terminalClient && s.attachmentPicker, 'studio2-only');
  await evaluate(cdp, `(async () => {
    for (let i = 0; i < 5; i++) {
      document.querySelector('#intentsmith-studio2 [aria-label="Nová relace"]').click();
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    document.querySelector('#intentsmith-studio2 [aria-label="Tři relace vedle sebe"]').click();
    return true;
  })()`);
  const six = await waitFor(s => s.sessionTabs === 6 && s.columnSessions.length === 3, 'six-sessions');
  const pinnedTitle = await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const tab = [...root.querySelectorAll('.tabs-in .tab')].at(-1);
    const title = tab.querySelector('.tab-t').textContent.trim();
    const rect = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: rect.left + 12, clientY: rect.top + 12 }));
    return title;
  })()`);
  await waitFor(s => s.pinAction, 'pin-menu');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const action = [...root.querySelectorAll('.dd.ctx .dd-i')]
      .find(node => node.querySelector('.dd-t')?.textContent.trim() === 'Připnout');
    if (!action) throw Error('Pin action absent');
    action.click();
    return true;
  })()`);
  await waitFor(s => s.pinnedTabs === 1 && s.firstTabTitle === pinnedTitle, 'pinned-tab');
  const original = [...six.columnSessions];
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    root.querySelectorAll('.cols .scol .pane-t')[0].click();
    return true;
  })()`);
  await waitFor(s => s.pickerItems.includes(original[1]), 'column-picker');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const option = [...root.querySelectorAll('.dd.ctx.picker .dd-i')]
      .find(node => node.querySelector('.dd-t')?.textContent.trim() === ${JSON.stringify(original[1])});
    if (!option) throw Error('Second column session absent from picker');
    option.click();
    return true;
  })()`);
  const swapped = await waitFor(s => s.columnSessions[0] === original[1]
    && s.columnSessions[1] === original[0] && s.columnSessions[2] === original[2], 'column-swap');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.scol:first-of-type .btabs .ptab, .scol .btabs .ptab')]
      .find(node => node.textContent.trim() === 'Terminál').click();
    return true;
  })()`);
  const terminalUi = await waitFor(s => s.terminalInput && s.busListeners['terminal:output'] === 1, 'terminal-ui');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.rp .ptabs .ptab')].find(node => node.textContent.trim().startsWith('Změny')).click();
    return true;
  })()`);
  const m2Ui = await waitFor(s => s.m2Panel, 'm2-review-panel');
  await evaluate(cdp, `(() => { setTimeout(() => window.IntentSmithStudioMode.selectMode('classic'), 0); return true; })()`);
  const restored = await waitFor(s => s.mode === 'classic' && s.classicSidebar && s.classicChat && !s.studio2, 'classic-restored');
  await evaluate(cdp, `(() => { setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0); return true; })()`);
  const persisted = await waitFor(s => s.mode === 'studio2' && s.studio2 && !s.classicChat
    && s.sessionTabs === 6 && s.pinnedTabs === 1 && s.firstTabTitle === pinnedTitle
    && s.columnSessions.every((value, i) => value === swapped.columnSessions[i]), 'session-restore');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('nav[aria-label="Sekce"] .nbtn, nav[aria-label="Sekce"] .rail')]
      .find(node => node.textContent.trim() === 'Projekty' || node.getAttribute('aria-label') === 'Projekty').click();
    return true;
  })()`);
  const catalog = await waitFor(s => s.catalogSection === 'Projekty' && s.catalogStatus === 'ready', 'project-catalog');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('nav[aria-label="Sekce"] .nbtn, nav[aria-label="Sekce"] .rail')]
      .find(node => node.textContent.trim() === 'Nastavení' || node.getAttribute('aria-label') === 'Nastavení').click();
    return true;
  })()`);
  await waitFor(s => s.settingsCategories, 'settings-categories');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.cat-b .tile, .cat-b .lrow')]
      .find(node => node.querySelector('.tile-n, .cell')?.textContent.trim() === 'Systém').click();
    return true;
  })()`);
  const environment = await waitFor(s => s.environmentLoaded, 'backend-environment');
  await evaluate(cdp, `(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(s => s.paletteOpen, 'command-palette');
  await evaluate(cdp, `(() => { document.querySelector('#intentsmith-studio2 .pal-i').click(); return true; })()`);
  const palette = await waitFor(s => !s.paletteOpen && s.columnsVisible, 'palette-session-navigation');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('nav[aria-label="Sekce"] .nbtn, nav[aria-label="Sekce"] .rail')]
      .find(node => node.textContent.trim() === 'Nastavení' || node.getAttribute('aria-label') === 'Nastavení').click();
    return true;
  })()`);
  await waitFor(s => s.settingsCategories, 'settings-return');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.cat-b .tile, .cat-b .lrow')]
      .find(node => node.querySelector('.tile-n, .cell')?.textContent.trim() === 'Vzhled').click();
    return true;
  })()`);
  const themes = await evaluate(cdp, `(async () => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const styles = ['IntentSmith','Studio','Clean','Matrix','Japanese','Midnight','Nocturne'];
    const darkOnly = new Set(['Matrix','Japanese','Midnight']);
    const seen = [];
    for (const style of styles) {
      const card = [...root.querySelectorAll('.aps .tcard')]
        .find(node => node.querySelector('.tname')?.textContent.trim().startsWith(style));
      if (!card) throw Error('Missing style ' + style);
      card.click();
      await new Promise(resolve => setTimeout(resolve, 40));
      for (const tone of darkOnly.has(style) ? ['dark'] : ['dark','light']) {
        const button = [...root.querySelectorAll('.aps .seg button')]
          .find(node => node.textContent.trim() === (tone === 'dark' ? 'Tmavé' : 'Světlé'));
        if (!button) throw Error('Missing theme control');
        button.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        const name = style.toLowerCase();
        const expected = 'th-' + name + (darkOnly.has(style) ? '' : '-' + tone);
        const css = getComputedStyle(root);
        seen.push(root.classList.contains(expected)
          && Boolean(css.getPropertyValue('--s0').trim())
          && Boolean(css.getPropertyValue('--faint').trim()));
      }
    }
    return seen;
  })()`);
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.aps .tcard')].find(node => node.querySelector('.tname')?.textContent.trim().startsWith('Studio')).click();
    [...root.querySelectorAll('.aps .seg button')].find(node => node.textContent.trim() === 'Tmavé').click();
    root.querySelector('.tabs-in .tab').click();
    root.querySelector('[aria-label="Jedna relace"]').click();
    return true;
  })()`);
  await waitFor(s => s.columnSessions.length === 1 && s.centerInsideStudio && s.studioDark, 'single-column-visual-preview');
  const visible = await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const rect = root?.getBoundingClientRect();
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { innerWidth, innerHeight, readyState: document.readyState,
      studioAccent: root ? getComputedStyle(root).getPropertyValue('--accF').trim() : null,
      theiaStatusVisible: getComputedStyle(document.getElementById('theia-statusBar')).display !== 'none',
      theiaTabVisible: [...document.querySelectorAll('#theia-main-content-panel .theia-app-main')]
        .some(node => node.classList.contains('lm-TabBar') && getComputedStyle(node).display !== 'none'),
      navIconColors: [...root.querySelectorAll('.nico')].map(node => getComputedStyle(node).color),
      rootRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      centerTag: center?.tagName || null, centerClass: String(center?.className || '').slice(0, 160),
      centerInsideStudio: Boolean(root?.contains(center)),
      topChildren: [...document.body.children].map(node => ({ tag: node.tagName, id: node.id,
        className: String(node.className || '').slice(0, 120), display: getComputedStyle(node).display,
        visibility: getComputedStyle(node).visibility, zIndex: getComputedStyle(node).zIndex })).slice(0, 12),
    };
  })()`);
  await writeFile(path.join(artifactRoot, 'studio2-visible-dom.json'), JSON.stringify(visible, null, 2), { mode: 0o600 });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (!screenshot?.data) fail('studio2-screenshot-empty');
  await writeFile(path.join(artifactRoot, 'studio2-current.png'), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
  await evaluate(cdp, `(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('intentsmith-specialist-files', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('files', 'readwrite');
      tx.objectStore('files').put({ id: 'studio2-e2e-file', owner: 'studio2-e2e-specialist',
        name: 'studio2-e2e.txt', size: 7, type: 'text/plain', blob: new Blob(['private']) });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    database.close();
    const key = 'intentsmith-studio2-session-state';
    const saved = JSON.parse(localStorage.getItem(key));
    const number = saved.nextNumber++;
    saved.sessions.push({ id: 'studio2-e2e-session', number, label: 'Specialistický test',
      specialistData: { id: 'studio2-e2e-specialist', name: 'Test' } });
    saved.columns[0] = 'studio2-e2e-session';
    saved.focusedColumn = 0;
    localStorage.setItem(key, JSON.stringify(saved));
    setTimeout(() => window.IntentSmithStudioMode.selectMode('classic'), 0);
    return true;
  })()`);
  await waitFor(s => s.mode === 'classic' && s.classicChat && !s.studio2, 'specialist-storage-restart-classic');
  await evaluate(cdp, `(() => { setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0); return true; })()`);
  await waitFor(s => s.mode === 'studio2' && s.columnSessions.includes('Specialistický test'), 'specialist-storage-restart-studio2');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    [...root.querySelectorAll('.rp .ptabs .ptab')].find(node => node.textContent.trim().startsWith('Soubory')).click();
    return true;
  })()`);
  await waitFor(s => s.specialistFileRows.includes('studio2-e2e.txt'), 'specialist-indexeddb-file');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const row = [...root.querySelectorAll('.rp .fsec .frow')]
      .find(node => node.querySelector('.fr-n')?.textContent.trim() === 'studio2-e2e.txt');
    [...row.querySelectorAll('button')].find(node => node.textContent.trim() === 'Náhled').click();
    return true;
  })()`);
  const localPreview = await waitFor(s => s.specialistPreview === 'private'
    && !s.composerAttachments.includes('studio2-e2e.txt'), 'specialist-preview-private');
  await evaluate(cdp, `(() => {
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    const row = [...root.querySelectorAll('.rp .fsec .frow')]
      .find(node => node.querySelector('.fr-n')?.textContent.trim() === 'studio2-e2e.txt');
    [...row.querySelectorAll('button')].find(node => node.textContent.trim() === 'Připojit').click();
    return true;
  })()`);
  const localAttached = await waitFor(s => s.composerAttachments.includes('studio2-e2e.txt'), 'specialist-explicit-attachment');
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
    attachmentPickerRendered: studio2.attachmentPicker,
    visuallyUncoveredStudio2: visible.centerInsideStudio,
    exclusiveWorkbenchChrome: visible.rootRect?.y === 0
      && visible.theiaStatusVisible === false && visible.theiaTabVisible === false,
    m2ReviewPanelRendered: m2Ui.m2Panel,
    backendEnvironmentLoaded: environment.environmentLoaded,
    commandPaletteNavigatesSession: palette.columnsVisible && !palette.paletteOpen,
    sessionsPersistedAcrossReload: persisted.sessionTabs === 6 && persisted.columnSessions.length === 3,
    pinnedSessionPersisted: persisted.pinnedTabs === 1 && persisted.firstTabTitle === pinnedTitle,
    projectCatalogLoaded: catalog.catalogSection === 'Projekty' && catalog.catalogStatus === 'ready',
    elevenThemesRendered: themes.length === 11 && themes.every(Boolean),
    specialistLocalPreviewRequiresAttachment: localPreview.specialistPreview === 'private'
      && !localPreview.composerAttachments.includes('studio2-e2e.txt')
      && localAttached.composerAttachments.includes('studio2-e2e.txt'),
  });
}
