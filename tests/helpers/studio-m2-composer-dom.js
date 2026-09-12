import fs from 'node:fs';
import path from 'node:path';

// Visual DOM probe, invoked only by the explicit studio-m2-composer-dom journey.
// Session assignment below is fixture setup; all form actions use DOM events.
// Built DOM + production authenticated rejection. No mocked fetch or model.
export function captureBuildComposerRequest(requests, method, params) {
  if (method === 'Network.requestWillBeSent') {
    let pathname;
    try { pathname = new URL(params.request?.url).pathname; } catch { return; }
    if (!pathname.startsWith('/api/') && pathname !== '/chat') return;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(params.request?.method)) return;
    requests.set(params.requestId, { requestId: params.requestId, pathname,
      method: params.request.method, postData: params.request.postData ?? null, status: null });
  } else if (method === 'Network.responseReceived' && requests.has(params.requestId)) {
    requests.get(params.requestId).status = params.response?.status ?? null;
  }
}

export async function rendererBuildComposerProbe({ cdp, paths, requests, evaluate, fail }) {
  const draft = {
    instruction: 'Připrav  změnu.\nZachovej přesné zadání.',
    files: [
      { path: 'app.js', instruction: 'Použij  hodnotu z helperu.', dependsOn: ['helper.js'] },
      { path: 'helper.js', instruction: 'Exportuj hodnotu.', dependsOn: [] },
    ],
    focusedTest: { binary: '/usr/bin/node',
      argv: ['-e', "const s = 'a  b';\tif (s.length !== 4) throw Error('bad spacing');", ''],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30000 },
  };
  const projectPath = path.join(paths.home, 'composer-dom-project');
  const input = { projectPath, draft };
  const result = await evaluate(cdp, '(' + (async function ({ projectPath, draft }) {
    const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const check = (value, label) => { if (!value) throw new Error('composer-dom:' + label); };
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { if (predicate()) return; await pause(); }
      throw new Error('composer-dom-timeout:' + label);
    };
    const post = async (url, body) => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      check(response.status === 201, 'fixture-registration'); return payload;
    };
    const registered = await post('/api/projects', { name: 'Composer DOM fixture', type: 'general', path: projectPath });
    const projectId = registered.project?.id;
    check(Number.isSafeInteger(projectId) && projectId > 0, 'registered-project-id');
    const conversationA = (await post('/api/conversations', { title: 'Composer original context', project_id: projectId })).conversation;
    const conversationB = (await post('/api/conversations', { title: 'Composer changed context', project_id: projectId })).conversation;
    check(typeof conversationA?.id === 'string' && typeof conversationB?.id === 'string', 'registered-conversations');
    const pane = window._sessions?.[0];
    check(pane && window.C3Bus?.emit, 'existing-renderer-entry');
    pane._convId = conversationA.id; pane._projectId = projectId; pane._agentId = null;
    pane._conversationFocus = false; pane.chat._thinking = null; pane.chat.attachments = [];
    window.C3Bus.emit('session:changed', { idx: 0 });
    const prefix = 'm2-build-0-';
    const element = id => document.getElementById(prefix + id);
    const section = () => document.querySelector('section[aria-label="Připravit změnu projektu"]');
    const click = async id => { const el = element(id); check(el && !el.disabled, 'click-' + id); el.click(); await pause(); };
    const change = async (id, value) => {
      const el = element(id); check(el && !el.disabled, 'input-' + id); el.focus();
      const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await pause();
      check(element(id)?.value === value, 'retained-input-' + id);
      check(document.activeElement === element(id), 'focus-' + id);
    };
    await waitFor(() => element('open'), 'open-button');
    const chat = document.getElementById('c3-chat-ta-0');
    check(chat, 'ordinary-chat-input');
    const chatDraft = 'Rozepsaný chat  zůstává.';
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(chat, chatDraft);
    chat.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    await click('open');
    await change('instruction', 'První rozepsané zadání.');
    pane._convId = conversationB.id; window.C3Bus.emit('session:changed', { idx: 0 }); await pause();
    check(element('submit')?.disabled === true, 'changed-context-disabled');
    check(section()?.textContent.includes('Konverzace nebo projekt se změnily'), 'changed-context-visible');
    check(element('instruction')?.value === 'První rozepsané zadání.', 'changed-context-retains-input');
    const discard = [...section().querySelectorAll('button')].find(button => button.textContent === 'Zahodit zadání');
    check(discard && !discard.disabled, 'discard-button'); discard.click(); await pause();
    check(!section(), 'discard-closed');
    await click('open');
    check(element('instruction')?.value !== 'První rozepsané zadání.', 'discard-does-not-rebind-old-input');
    await change('instruction', draft.instruction.slice(0, 2));
    await change('instruction', draft.instruction);
    for (let index = 0; index < draft.files.length; index++) {
      if (index > 0) await click('add-file');
      const file = draft.files[index];
      await change('file-' + index + '-path', file.path);
      await change('file-' + index + '-instruction', file.instruction);
      await change('file-' + index + '-dependencies', file.dependsOn.join('\n'));
    }
    await change('binary', draft.focusedTest.binary);
    for (let index = 0; index < draft.focusedTest.argv.length; index++) {
      await click('add-arg'); await change('arg-' + index, draft.focusedTest.argv[index]);
    }
    await change('timeout', String(draft.focusedTest.timeoutMs));
    check(!pane._m2Pending && !pane.chat._m2Busy, 'no-implicit-draft-or-approval');
    check(document.getElementById('c3-chat-ta-0').value === chatDraft, 'ordinary-chat-preserved-before-submit');
    await click('submit');
    await waitFor(() => !pane.chat._m2Busy && section()?.textContent.includes('M2_LIFECYCLE_POLICY_UNAVAILABLE'), 'production-policy-rejection');
    check(section().textContent.includes('HTTP 503'), 'typed-http-error-visible');
    check(element('instruction')?.value === draft.instruction, 'goal-preserved-after-rejection');
    check(element('binary')?.value === draft.focusedTest.binary, 'binary-preserved-after-rejection');
    check(element('timeout')?.value === String(draft.focusedTest.timeoutMs), 'timeout-preserved-after-rejection');
    for (let index = 0; index < draft.files.length; index++) {
      check(element('file-' + index + '-path')?.value === draft.files[index].path, 'path-preserved-after-rejection');
      check(element('file-' + index + '-instruction')?.value === draft.files[index].instruction, 'file-instruction-preserved-after-rejection');
      check(element('file-' + index + '-dependencies')?.value === draft.files[index].dependsOn.join('\n'), 'dependencies-preserved-after-rejection');
    }
    for (let index = 0; index < draft.focusedTest.argv.length; index++) {
      check(element('arg-' + index)?.value === draft.focusedTest.argv[index], 'argv-preserved-after-rejection');
    }
    check(document.getElementById('c3-chat-ta-0').value === chatDraft, 'ordinary-chat-preserved-after-rejection');
    check(!pane._m2Pending && !pane.chat._m2Busy && !element('submit').disabled, 'no-pending-approval-or-stuck-busy');
    check(!document.querySelector('[aria-label="Akce připravené změny"]'), 'no-approval-actions-after-rejection');
    return { projectId, conversationId: conversationB.id, contextInvalidated: true,
      discarded: true, inputRetained: true, focusRetained: true, ordinaryChatRetained: true };
  }).toString() + ')(' + JSON.stringify(input) + ')', 45000);
  const observed = [...requests.values()];
  const drafts = observed.filter(request => request.pathname === '/api/m2/lifecycle/draft');
  const registrations = observed.filter(request => request.pathname === '/api/projects' || request.pathname === '/api/conversations');
  if (observed.length !== 4 || drafts.length !== 1 || drafts[0].method !== 'POST' || drafts[0].status !== 503
    || registrations.length !== 3 || registrations.some(request => request.method !== 'POST' || request.status !== 201)
    || registrations.filter(request => request.pathname === '/api/projects').length !== 1) fail('composer-request-boundary-failed');
  const expected = { projectId: result.projectId,
    origin: { surface: 'studio', sessionId: result.conversationId, conversationId: result.conversationId, projectId: result.projectId }, draft };
  let actual;
  try { actual = JSON.parse(drafts[0].postData); } catch { fail('composer-request-payload-unavailable'); }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('composer-request-payload-changed');
  if (fs.existsSync(path.join(projectPath, '.c3/m2-governance-policy.json'))
    || draft.files.some(file => fs.existsSync(path.join(projectPath, file.path)))) fail('composer-rejection-mutated-project');
  return Object.freeze({ scope: 'built-dom-production-authenticated-policy-rejection',
    status: 503, errorCode: 'M2_LIFECYCLE_POLICY_UNAVAILABLE', fixtureRegistrationRequests: 3, draftRequests: 1, approvalRequests: 0,
    unexpectedMutationRequests: 0, originExact: true, literalArgvExact: true,
    contextInvalidated: result.contextInvalidated, discarded: result.discarded,
    inputRetained: result.inputRetained, focusRetained: result.focusRetained,
    ordinaryChatRetained: result.ordinaryChatRetained, targetFilesAbsent: true });
}
