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
    classicTransport: Boolean(window.IntentSmithWS?.connect),
    classicBus: Boolean(window.IntentSmithBus?.on),
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
    && s.classicSidebar && s.classicChat && !s.studio2 && s.classicTransport, 'initial-classic');
  await evaluate(cdp, `(() => {
    setTimeout(() => window.IntentSmithStudioMode.selectMode('studio2'), 0);
    return true;
  })()`);
  const studio2 = await waitFor(s => s.mode === 'studio2' && s.switchReady
    && s.studio2 && !s.classicSidebar && !s.classicChat
    && !s.classicTransport && !s.classicBus, 'studio2-only');
  await evaluate(cdp, `(() => {
    setTimeout(() => window.IntentSmithStudioMode.selectMode('classic'), 0);
    return true;
  })()`);
  const restored = await waitFor(s => s.mode === 'classic' && s.switchReady
    && s.classicSidebar && s.classicChat && !s.studio2 && s.classicTransport, 'classic-restored');
  return Object.freeze({
    classicInitiallyAttached: classic.classicSidebar && classic.classicChat,
    studio2ExclusivelyAttached: studio2.studio2 && !studio2.classicSidebar && !studio2.classicChat,
    classicTransportAbsentInStudio2: !studio2.classicTransport && !studio2.classicBus,
    classicRestored: restored.classicSidebar && restored.classicChat && !restored.studio2,
  });
}
