// Manual scenario controller. ROOT owns reviewed qualification and live freeze.
// No top-level effects, server, browser launch, provider call or reference app.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { evaluateRenderer, waitUntil } from '../run-project-build-journey.js';
const require = createRequire(import.meta.url);
const { pendingBinding, validateView } = require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-controller.js');
const { normalizeProposal, composerDraft, validateBlueprint } = require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-composer.js');
export const TARGETS = Object.freeze({
  core: Object.freeze(['src/readings.mjs', 'src/history.mjs', 'src/monitor.mjs', 'test/acceptance.test.mjs']),
  cli: Object.freeze(['src/cli.mjs', 'src/index.mjs', 'test/cli.test.mjs']),
});
export const TEST_ARGV = Object.freeze(['--disable-wasm-trap-handler', '--experimental-vm-modules', '--test']);
const copy = value => JSON.parse(JSON.stringify(value));
const sorted = values => [...values].sort();

// Called by the existing owned relay BEFORE forwarding each actual request.
// Counting only after a UI operation would not enforce the inference bound.
export function createFanCallBudget({ d1Model, codeModel, entryMode = 'd1', historicalRows = [], continuationMode = null }) {
  assert.ok(d1Model && codeModel, 'exact role model identities required');
  assert.ok(['d1', 'manual'].includes(entryMode));
  assert.ok(continuationMode === null || continuationMode === 'failed-core4-cli3');
  if (continuationMode) { assert.equal(entryMode, 'manual'); assert.equal(historicalRows.length, 4); }
  const maximumD1 = entryMode === 'manual' ? 0 : 8;
  const rows = copy(historicalRows); const operations = new Set(); let active = null;
  if (rows.length) {
    assert.equal(entryMode, 'manual'); assert.equal(rows.length, 4, 'only the preserved four-call pending core can resume');
    rows.forEach((row, index) => assert.deepEqual(row, { sequence: index + 1, role: 'CODE', model: codeModel, phase: 'core', kind: 'initial' }));
    operations.add('core:initial'); // The saved initial draft cannot be regenerated.
  }
  return {
    begin(phase, kind) {
      assert.ok(TARGETS[phase]); assert.ok(['initial', 'repair'].includes(kind));
      const key = phase + ':' + kind;
      if (continuationMode) {
        assert.ok(key === 'core:repair' || key === 'cli:initial', 'failed continuation permits only core4 repair then CLI3');
        if (key === 'cli:initial') assert.equal(rows.filter(row => row.phase === 'core' && row.kind === 'repair').length, 4, 'all four core repair calls must precede CLI');
        else assert.equal(rows.length, 4, 'one core repair immediately after historical seed');
      }
      assert.equal(operations.has(key), false, 'one operation of each kind per increment');
      operations.add(key); active = { phase, kind, d1: 0, code: 0 };
    },
    admit({ role, model }) {
      assert.ok(active, 'no unowned inference admitted');
      assert.ok(['D1', 'CODE'].includes(role));
      assert.equal(model, role === 'D1' ? d1Model : codeModel, 'pinned role identity');
      const d1 = rows.filter(row => row.role === 'D1').length;
      const code = rows.filter(row => row.role === 'CODE').length;
      if (role === 'D1') { assert.ok(d1 < maximumD1 && active.d1 < 2, 'D1 total8/operation2 bound'); active.d1++; }
      else {
        const maximum = continuationMode && active.phase === 'core' && active.kind === 'repair' ? 4
          : active.kind === 'repair' ? 2 : TARGETS[active.phase].length;
        assert.ok(code < 11 && active.code < maximum, continuationMode ? 'CODE total11/operation bound' : 'CODE total11/repair2 bound'); active.code++;
      }
      const row = { sequence: rows.length + 1, role, model, phase: active.phase, kind: active.kind };
      rows.push(row); return copy(row);
    },
    stop() { active = null; },
    snapshot() { return copy({ maximumD1, maximumCode: 11, ...(continuationMode ? { continuationMode } : {}), rows, active }); },
  };
}

// Read actual StudioRoot React component state. Never manufacture sessions,
// proposals, approval authority or captured transport events.
function rendererModel() {
  const root = document.querySelector('[data-studio-ui="studio2"]');
  if (!root) throw Error('FAN_STUDIO2_ROOT_MISSING');
  const keys = Object.keys(root).filter(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
  if (keys.length !== 1) throw Error('FAN_STUDIO2_FIBER_UNAVAILABLE');
  let fiber = root[keys[0]];
  for (let depth = 0; fiber && depth < 64; depth++, fiber = fiber.return) {
    const model = fiber.memoizedProps?.model || fiber.stateNode?.props?.model;
    if (model?.widget?.store?.state?.sessions && typeof model.widget.openCatalogItem === 'function') return model;
  }
  throw Error('FAN_STUDIO2_LIVE_MODEL_UNAVAILABLE');
}
function invoke(studio, fn, args = {}) {
  return evaluateRenderer(studio.cdp, '(async()=>{const find=' + rendererModel.toString()
    + ';return await (' + fn.toString() + ')(find(),' + JSON.stringify(args) + ');})()', 180000);
}

export function validateCapturedPlan(bound, { phase, projectId, conversationId }) {
  const normalized = normalizeProposal(bound);
  assert.ok(normalized, 'actual normalized ProjectWorkProposal@1 required');
  assert.equal(normalized.origin.projectId, projectId);
  assert.equal(normalized.origin.conversationId, conversationId);
  assert.equal(normalized.origin.sessionId, conversationId);
  assert.equal(normalized.proposal.projectId, projectId);
  assert.deepEqual(sorted(normalized.proposal.draft.files.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(normalized.proposal.draft.revisionOf, undefined);
  assert.ok(normalized.proposal.draft.gitCommit, 'runtime ask-commit policy must supply exact Git effect');
  if (phase === 'cli') {
    const cli = normalized.proposal.draft.files.find(file => file.path === 'src/cli.mjs');
    assert.ok(cli.contextFiles?.includes('src/monitor.mjs'), 'committed monitor is read-only context');
    assert.equal(cli.dependsOn.includes('src/monitor.mjs'), false);
  }
  return normalized;
}

export function validatePendingResume(resume, { projectId, conversationId }) {
  assert.deepEqual(Object.keys(resume || {}).sort(), ['lifecycleId', 'planDigest', 'status']);
  assert.match(resume.lifecycleId, /^lifecycle:[0-9a-f-]{36}$/); assert.match(resume.planDigest, /^sha256:[0-9a-f]{64}$/);
  const expectedOrigin = { surface: 'studio', sessionId: conversationId, conversationId, projectId: Number(projectId) };
  const view = validateView(resume.status, resume.lifecycleId, expectedOrigin, resume.planDigest);
  assert.equal(view.state, 'awaiting_approval', 'resume requires the exact actual pending GET status');
  const bound = pendingBinding({ lifecycleId: view.lifecycleId, planDigest: view.planDigest, origin: expectedOrigin });
  assert.ok(bound); return bound;
}

export function validateFailedResume(resume, { projectId, conversationId }) {
  assert.deepEqual(Object.keys(resume || {}).sort(), ['lifecycleId', 'planDigest', 'status']);
  assert.match(resume.lifecycleId, /^lifecycle:[0-9a-f-]{36}$/); assert.match(resume.planDigest, /^sha256:[0-9a-f]{64}$/);
  const expectedOrigin = { surface: 'studio', sessionId: conversationId, conversationId, projectId: Number(projectId) };
  const view = validateView(resume.status, resume.lifecycleId, expectedOrigin, resume.planDigest);
  assert.equal(view.state, 'failed');
  assert.equal(view.result?.focusedTest?.terminalStatus, 'failed');
  assert.equal(view.result?.rollback?.status, 'succeeded');
  const bound = pendingBinding({ lifecycleId: view.lifecycleId, planDigest: view.planDigest, origin: expectedOrigin });
  assert.ok(bound); return bound;
}

export async function bindActualConversation(studio, { projectId, conversationId, title, resumePending = null, resumeFailed = null }) {
  assert.ok(resumePending === null || resumeFailed === null, 'pending and failed resumes are mutually exclusive');
  const expectedPending = resumePending === null ? null : validatePendingResume(resumePending, { projectId, conversationId });
  const expectedFailed = resumeFailed === null ? null : validateFailedResume(resumeFailed, { projectId, conversationId });
  return invoke(studio, async (model, args) => {
    if (window.IntentSmithWS?.isReady?.() !== true || window.IntentSmithWS?.isM1WireNegotiated?.() !== true) {
      throw Error('FAN_M1_NOT_NEGOTIATED');
    }
    const one = document.querySelector('button[aria-label="Jedna relace"]');
    if (!one || one.disabled) throw Error('FAN_ONE_COLUMN_CONTROL_UNAVAILABLE');
    one.click();
    // Open into the selected single column; the default slot appends a column.
    const ok = await model.widget.openCatalogItem('Konverzace', { id: String(args.conversationId), name: args.title }, 0);
    if (ok !== true) throw Error('FAN_CONVERSATION_OPEN_FAILED:' + model.widget.catalogActionError);
    const session = model.widget.store.state.sessions.find(row => String(row._convId) === String(args.conversationId));
    if (!session || String(session._projectId) !== String(args.projectId)) throw Error('FAN_PROJECT_BINDING_DRIFT');
    if (model.widget.store.focusedSession() !== session) throw Error('FAN_PROJECT_NOT_FOCUSED');
    if (model.widget.transport.hasActiveM1Turn(session) || model.widget.m2.entry(session).busy
      || session.chat._delivery?.status === 'DELIVERY_UNKNOWN') throw Error('FAN_CONVERSATION_BUSY');
    const pending = session._m2Pending;
    if (args.expectedPending) {
      const expected = args.expectedPending;
      if (!pending || pending.lifecycleId !== expected.lifecycleId || pending.planDigest !== expected.planDigest
        || pending.origin?.surface !== expected.origin.surface || pending.origin?.sessionId !== expected.origin.sessionId
        || pending.origin?.conversationId !== expected.origin.conversationId || pending.origin?.projectId !== expected.origin.projectId) {
        throw Error('FAN_PENDING_RESUME_BINDING_DRIFT');
      }
    } else if (pending) {
      const expected = args.expectedFailed;
      if (!expected || pending.lifecycleId !== expected.lifecycleId || pending.planDigest !== expected.planDigest
        || pending.origin?.surface !== expected.origin.surface || pending.origin?.sessionId !== expected.origin.sessionId
        || pending.origin?.conversationId !== expected.origin.conversationId || pending.origin?.projectId !== expected.origin.projectId) {
        throw Error('FAN_CONVERSATION_BUSY');
      }
      // Only the normal subsequent /m2-status action may retire this matching
      // failed pointer; this bind never clears or overwrites pending state.
    }
    return { sessionId: session.id, projectId: session._projectId, conversationId: session._convId };
  }, { projectId, conversationId, title, expectedPending, expectedFailed });
}

export async function reloadActualStatus(studio, { sessionId, lifecycleId, planDigest }) {
  const view = await invoke(studio, async (model, args) => {
    const session = model.widget.store.find(args.sessionId);
    if (!session || model.widget.transport.hasActiveM1Turn(session)) throw Error('FAN_STATUS_SESSION_BUSY');
    // Read-only normal M2 status action; never inject accept/pending/view state.
    await model.widget.m2.run(session, '/m2-status', args.lifecycleId);
    return JSON.parse(JSON.stringify(model.widget.m2.entry(session).view));
  }, { sessionId, lifecycleId });
  assert.equal(view.lifecycleId, lifecycleId); assert.equal(view.planDigest, planDigest);
  return view;
}

export async function captureRealD1Proposal(studio, { sessionId, projectId, conversationId, phase, request, key }) {
  await invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId);
    if (!session || String(session._projectId) !== String(args.projectId)
      || String(session._convId) !== args.conversationId || model.widget.transport.hasActiveM1Turn(session)
      || session._m2Pending || session.chat._delivery?.status === 'DELIVERY_UNKNOWN') throw Error('FAN_SEND_SCOPE_OR_BUSY');
    const captures = window.__fanJourneyObserved ||= Object.create(null);
    if (captures[args.key]) throw Error('FAN_CAPTURE_KEY_REUSED');
    const capture = captures[args.key] = { events: [], request: args.request };
    model.widget.transport.on('chat:terminal', event => {
      if (model.widget.transport.session(event.sessionIdx) === session && event.action !== 'cancel') {
        if (capture.events.length && capture.events[0].turnId !== event.turnId) return;
        capture.events.push(JSON.parse(JSON.stringify(event)));
      }
    });
    const textareas = [...document.querySelectorAll('[data-studio-ui="studio2"] textarea[aria-label^="Zpráva pro relaci "]')];
    if (textareas.length !== 1) throw Error('FAN_REQUIRES_ONE_VISIBLE_CHAT_COLUMN');
    const input = textareas[0];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, args.request);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (model.st().drafts[args.sessionId] !== args.request) throw Error('FAN_CONTROLLED_INPUT_NOT_UPDATED');
    const send = [...document.querySelectorAll('button[aria-label="Odeslat"]')];
    if (send.length !== 1 || send[0].disabled) throw Error('FAN_SEND_BUTTON_UNAVAILABLE');
    send[0].click(); return true;
  }, { sessionId, projectId, conversationId, request, key });
  const result = await waitUntil(() => invoke(studio, (model, args) => {
    const capture = window.__fanJourneyObserved?.[args.key];
    if (!capture?.events.length) return null;
    if (capture.events.length !== 1) throw Error('FAN_MULTIPLE_TERMINALS');
    const session = model.widget.store.find(args.sessionId);
    return { terminal: capture.events[0], captured: session?.chat._projectWorkProposal,
      userRecorded: session?.chat.msgs.some(row => row.role === 'user' && row.text === capture.request) === true };
  }, { sessionId, key }), 'actual D1 M1 terminal and Studio captureProposal', 240000);
  assert.equal(result.terminal.status, 'ok', JSON.stringify(result.terminal.result?.error));
  assert.equal(result.terminal.renderAssistant, true); assert.equal(result.userRecorded, true);
  const offered = result.terminal.result?.response?.metadata?.projectWorkProposal;
  assert.ok(offered, 'D1 must produce an actual ProjectWorkProposal; no fallback blueprint');
  assert.deepEqual(result.captured?.proposal, offered, 'Studio captureProposal keeps actual terminal proposal');
  const bound = validateCapturedPlan(result.captured, { phase, projectId, conversationId });
  return { ...result, bound };
}

export async function prepareActualCapturedPlan(studio, { sessionId, bound, phase, nodeBinary, beforeSubmit = async () => {} }) {
  validateCapturedPlan(bound, { phase, projectId: bound.origin.projectId, conversationId: bound.origin.conversationId });
  await invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId);
    if (JSON.stringify(session?.chat._projectWorkProposal) !== JSON.stringify(args.bound)) throw Error('FAN_CAPTURED_PLAN_DRIFT');
    const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Připravit změnu');
    if (buttons.length !== 1 || buttons[0].disabled) throw Error('FAN_OPEN_COMPOSER_BUTTON');
    buttons[0].click(); return true;
  }, { sessionId, bound });
  const before = await waitUntil(() => invoke(studio, (model, args) => {
    const form = model.widget.store.find(args.sessionId)?.chat._m2Composer;
    return form?.open ? JSON.parse(JSON.stringify(form)) : null;
  }, { sessionId }), 'current rendered M2 composer');
  const originalDraft = composerDraft(before);
  assert.deepEqual(originalDraft, { ...bound.proposal.draft,
    files: bound.proposal.draft.files.map(file => ({ ...file, contextFiles: file.contextFiles || [] })) }, 'composer originates in actual D1 plan');
  assert.equal(before.binary, nodeBinary, 'trusted runtime chooses exact Node binary');
  assert.deepEqual(JSON.parse(before.argv), ['--disable-wasm-trap-handler', '--test'], 'only VM flag edit is authorized');
  await invoke(studio, (model, args) => {
    const input = document.querySelector('section.m2-composer textarea[aria-label="Argumenty cíleného testu"]');
    if (!input || input.disabled) throw Error('FAN_ARGV_FIELD');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, JSON.stringify(args.argv));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, { argv: TEST_ARGV });
  const after = await invoke(studio, (model, args) => JSON.parse(JSON.stringify(model.widget.store.find(args.sessionId).chat._m2Composer)), { sessionId });
  assert.deepEqual({ ...after, argv: before.argv }, before, 'only explicit test argv edit; no blueprint injection');
  const submittedDraft = composerDraft(after);
  await beforeSubmit(submittedDraft);
  await invoke(studio, (model, args) => {
    const buttons = [...document.querySelectorAll('section.m2-composer button')].filter(button => button.textContent.trim() === 'Připravit návrh bez schválení');
    if (buttons.length !== 1 || buttons[0].disabled) throw Error('FAN_PREPARE_BUTTON');
    buttons[0].click(); return true;
  }, {});
  const view = await waitUntil(() => invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.busy) return null;
    if (entry.error) throw Error('FAN_PREPARE_FAILED:' + entry.error);
    return entry.view?.state === 'awaiting_approval' ? JSON.parse(JSON.stringify(entry.view)) : null;
  }, { sessionId }), 'actual CODE preview awaiting exact approval', 990000);
  assert.deepEqual(sorted(view.diff.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(view.audit?.governanceDecision?.verdict, 'allow');
  return { before, after, submittedDraft, view };
}

// One explicit correction, derived from a fresh actual D1 terminal and from
// Studio's durable failed-plan revision source. ROOT chooses <=2 paths from
// actual functional-test diagnostics; all other exact M2 materials are reused.
export async function prepareActualFailedRevision(studio, { sessionId, phase, bound, failedView, lastDraft, repairPaths, beforeSubmit = async () => {} }) {
  validateCapturedPlan(bound, { phase, projectId: bound.origin.projectId, conversationId: bound.origin.conversationId });
  assert.ok(['failed', 'blocked', 'timed_out'].includes(failedView.state));
  assert.ok(Array.isArray(repairPaths) && repairPaths.length >= 1 && repairPaths.length <= 2);
  assert.equal(new Set(repairPaths).size, repairPaths.length);
  assert.ok(repairPaths.every(path => TARGETS[phase].includes(path)));
  const offered = bound.proposal.draft;
  for (const file of offered.files) {
    const previous = lastDraft.files.find(row => row.path === file.path);
    assert.ok(previous);
    assert.deepEqual(sorted(file.dependsOn), sorted(previous.dependsOn), 'repair keeps frozen dependency graph');
    assert.deepEqual(sorted(file.contextFiles || []), sorted(previous.contextFiles || []), 'repair keeps read-only scope');
  }
  await invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId);
    if (JSON.stringify(session?.chat._projectWorkProposal) !== JSON.stringify(args.bound)) throw Error('FAN_REPAIR_D1_DRIFT');
    const revision = session.chat._m2RevisionSource;
    if (revision?.revisionOf?.lifecycleId !== args.lifecycleId || revision?.revisionOf?.planDigest !== args.planDigest) throw Error('FAN_REPAIR_SOURCE_DRIFT');
    const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Opravit předchozí návrh');
    if (buttons.length !== 1) throw Error('FAN_REPAIR_BUTTON');
    buttons[0].click(); return true;
  }, { sessionId, bound, lifecycleId: failedView.lifecycleId, planDigest: failedView.planDigest });
  const before = await waitUntil(() => invoke(studio, (model, args) => {
    const form = model.widget.store.find(args.sessionId)?.chat._m2Composer;
    return form?.open ? JSON.parse(JSON.stringify(form)) : null;
  }, { sessionId }), 'actual failed-plan revision composer');
  assert.deepEqual(before.revisionOf, { lifecycleId: failedView.lifecycleId, planDigest: failedView.planDigest });
  assert.deepEqual(JSON.parse(before.argv), TEST_ARGV);
  await invoke(studio, (model, args) => {
    const section = document.querySelector('section.m2-composer');
    const set = (element, value) => {
      if (!element || element.disabled) throw Error('FAN_REPAIR_CONTROL_UNAVAILABLE');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(section.querySelector('textarea[aria-label="Celkové zadání změny"]'), args.instruction);
    for (const field of section.querySelectorAll('fieldset')) {
      const path = field.querySelector('input[aria-label="Cesta souboru v plánu"]').value;
      const regenerate = args.repairPaths.includes(path);
      if (regenerate) {
        const file = args.files.find(row => row.path === path);
        set(field.querySelector('textarea[aria-label="Zadání pro soubor"]'), file.instruction);
      }
      const retain = field.querySelector('input[type="checkbox"]');
      if (!retain || retain.disabled) throw Error('FAN_REPAIR_REUSE_CONTROL');
      if (retain.checked !== !regenerate) retain.click();
    }
    return true;
  }, { files: offered.files, instruction: offered.instruction, repairPaths });
  const after = await invoke(studio, (model, args) => JSON.parse(JSON.stringify(model.widget.store.find(args.sessionId).chat._m2Composer)), { sessionId });
  const draft = composerDraft(after);
  assert.deepEqual(draft.revisionOf, before.revisionOf);
  assert.deepEqual(sorted(draft.files.map(file => file.path)), sorted(TARGETS[phase]));
  assert.deepEqual(draft.focusedTest, composerDraft(before).focusedTest);
  assert.deepEqual(draft.gitCommit, composerDraft(before).gitCommit);
  for (const file of draft.files) {
    const old = composerDraft(before).files.find(row => row.path === file.path);
    const regenerate = repairPaths.includes(file.path);
    assert.equal(file.reusePrevious, !regenerate);
    assert.deepEqual(file.dependsOn, old.dependsOn); assert.deepEqual(file.contextFiles, old.contextFiles);
    assert.equal(file.instruction, regenerate ? offered.files.find(row => row.path === file.path).instruction : old.instruction);
  }
  await beforeSubmit(draft);
  await invoke(studio, () => {
    const buttons = [...document.querySelectorAll('section.m2-composer button')].filter(button => button.textContent.trim() === 'Připravit návrh bez schválení');
    if (buttons.length !== 1 || buttons[0].disabled) throw Error('FAN_REPAIR_SUBMIT_BUTTON');
    buttons[0].click(); return true;
  });
  const view = await waitUntil(() => invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.busy) return null;
    if (entry.error) throw Error('FAN_REPAIR_FAILED:' + entry.error);
    return entry.view?.state === 'awaiting_approval' ? JSON.parse(JSON.stringify(entry.view)) : null;
  }, { sessionId }), 'actual bounded repair CODE preview', 990000);
  assert.deepEqual(sorted(view.diff.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(view.audit?.governanceDecision?.verdict, 'allow');
  return { before, after, submittedDraft: draft, view, repairPaths: copy(repairPaths) };
}


// Explicit operator specification through the documented public /m2-build JSON
// entry. This does not manufacture a D1 proposal, origin, implementation or grant.
export function validateManualDraft(draft, { phase, nodeBinary, repair = false }) {
  validateBlueprint(draft);
  assert.deepEqual(sorted(draft.files.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(draft.focusedTest.binary, nodeBinary); assert.deepEqual(draft.focusedTest.argv, TEST_ARGV);
  assert.deepEqual(draft.focusedTest.environment, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' });
  assert.ok(draft.gitCommit, 'explicit operator Git effect required');
  for (const instruction of [draft.instruction, ...draft.files.map(file => file.instruction)]) {
    assert.ok(instruction.isWellFormed() && Buffer.byteLength(instruction) <= 512, 'operator instruction UTF-8 <=512B');
  }
  assert.equal(Boolean(draft.revisionOf), repair);
  if (!repair) assert.ok(draft.files.every(file => file.reusePrevious === undefined));
  if (phase === 'cli') {
    const cli = draft.files.find(file => file.path === 'src/cli.mjs');
    assert.ok(cli.contextFiles.includes('src/monitor.mjs'));
    assert.equal(cli.dependsOn.includes('src/monitor.mjs'), false);
  }
  return draft;
}

export function makeManualRevision(lastDraft, failedView, selection, { phase, nodeBinary, frozenCoreRepairDraft = null }) {
  assert.equal(selection.phase, phase);
  assert.equal(failedView.state, 'failed');
  assert.equal(failedView.result?.focusedTest?.terminalStatus, 'failed');
  assert.equal(failedView.result?.rollback?.status, 'succeeded');
  assert.equal(selection.failedLifecycleId, failedView.lifecycleId);
  assert.equal(selection.planDigest, failedView.planDigest);
  assert.ok(Array.isArray(selection.targets) && selection.targets.length >= 1 && selection.targets.length <= (frozenCoreRepairDraft ? 4 : 2));
  assert.equal(new Set(selection.targets).size, selection.targets.length);
  assert.ok(selection.targets.every(path => TARGETS[phase].includes(path)));
  assert.deepEqual(sorted(failedView.diff.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(typeof selection.reason, 'string'); assert.ok(selection.reason.trim());
  assert.equal(lastDraft.revisionOf, undefined, 'one manual repair per increment');
  if (frozenCoreRepairDraft !== null) {
    assert.equal(phase, 'core'); assert.deepEqual(sorted(selection.targets), sorted(TARGETS.core));
    const draft = copy(frozenCoreRepairDraft);
    assert.deepEqual(draft.revisionOf, { lifecycleId: failedView.lifecycleId, planDigest: failedView.planDigest });
    assert.deepEqual(draft.focusedTest, lastDraft.focusedTest); assert.deepEqual(draft.gitCommit, lastDraft.gitCommit);
    for (const file of draft.files) {
      const previous = lastDraft.files.find(row => row.path === file.path); assert.ok(previous);
      assert.deepEqual(file.dependsOn, previous.dependsOn); assert.deepEqual(file.contextFiles || [], previous.contextFiles || []);
      assert.equal(file.reusePrevious, false, 'all four failed core materials require explicit repair');
    }
    return validateManualDraft(draft, { phase, nodeBinary, repair: true });
  }
  const draft = copy(lastDraft);
  const prefix = '\nOprav skutečné selhání: ';
  const reasonBudget = 512 - Buffer.byteLength(draft.instruction + prefix);
  assert.ok(selection.reason.isWellFormed() && Buffer.byteLength(selection.reason) <= reasonBudget,
    'manual repair reason exceeds remaining UTF-8 budget ' + reasonBudget + 'B; shorten the explicit selection before inference');
  draft.instruction += prefix + selection.reason;
  draft.revisionOf = { lifecycleId: failedView.lifecycleId, planDigest: failedView.planDigest };
  for (const file of draft.files) {
    file.reusePrevious = !selection.targets.includes(file.path);
  }
  return validateManualDraft(draft, { phase, nodeBinary, repair: true });
}

// The store can legitimately open a second column when a conversation is added.
// Read the actual selected session and wait for its corresponding React column.
// This function is serialized into the renderer; it has no provider or model call.
async function manualColumnAction(model, args) {
  if (args.action === 'send') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const store = model.widget.store, session = store.find(args.sessionId), state = model.st();
  if (!session || String(session._projectId) !== String(args.projectId)
    || String(session._convId) !== args.conversationId || store.focusedSession() !== session
    || model.widget.transport.hasActiveM1Turn(session) || session._m2Pending
    || session.chat._projectWorkProposal || session.chat._m2Composer?.open
    || session.chat._delivery?.status === 'DELIVERY_UNKNOWN') throw Error('FAN_MANUAL_SCOPE_OR_BUSY');
  const layout = store.state.columns, index = layout.indexOf(session.id);
  if (index < 0 || layout.lastIndexOf(session.id) !== index || state.focusCol !== index
    || JSON.stringify(state.colSids) !== JSON.stringify(layout)) throw Error('FAN_MANUAL_COLUMN_BINDING_DRIFT');
  const visible = node => node.isConnected && node.getClientRects().length > 0
    && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility === 'visible';
  const roots = [...document.querySelectorAll('[data-studio-ui="studio2"]')].filter(root => {
    if (!visible(root)) return false;
    const keys = Object.keys(root).filter(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    if (keys.length !== 1) return false;
    for (let fiber = root[keys[0]], depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      if ((fiber.memoizedProps?.model || fiber.stateNode?.props?.model) === model) return true;
    }
    return false;
  });
  const columns = roots.length === 1 ? [...roots[0].querySelectorAll('.cols > .scol')] : [];
  const diagnostic = { ready: false, mode: state.mode, expectedColumns: layout.length,
    renderedColumns: columns.length, sessionColumn: index, visibleModelRoots: roots.length,
    labels: columns.map(column => [...column.querySelectorAll('div.comp > textarea')].map(input => input.getAttribute('aria-label'))) };
  if (state.mode !== 'sessions' || columns.length !== layout.length || roots.length !== 1) return diagnostic;
  for (let i = 0; i < columns.length; i++) {
    const inputs = columns[i].querySelectorAll('div.comp > textarea');
    const expected = 'Zpráva pro relaci ' + model.sessionNumber(layout[i], state);
    if (!visible(columns[i]) || inputs.length !== 1 || inputs[0].getAttribute('aria-label') !== expected
      || columns[i].classList.contains('focus') !== (layout.length > 1 && i === index)
      || columns[i].querySelector('.pane-tt')?.textContent !== model.sess(layout[i], state).title
      || inputs[0].value !== (state.drafts[layout[i]] || '')) return diagnostic;
  }
  const column = columns[index], input = column.querySelector('div.comp > textarea');
  const buttons = [...column.querySelectorAll('div.comp button[aria-label="Odeslat"]')];
  if (!visible(input) || input.disabled || buttons.length !== 1 || !visible(buttons[0]) || buttons[0].disabled) return diagnostic;
  diagnostic.ready = true;
  if (args.action === 'probe') return diagnostic;
  if (args.action !== 'send') throw Error('FAN_MANUAL_UNKNOWN_ACTION');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, args.command);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (model.st().drafts[args.sessionId] !== args.command) throw Error('FAN_MANUAL_LITERAL_INPUT_DRIFT');
  // The same session column owns both the controlled input and the normal Send.
  if (!column.isConnected || !input.isConnected || !buttons[0].isConnected
    || store.focusedSession() !== session) throw Error('FAN_MANUAL_DOM_CHANGED_BEFORE_SEND');
  buttons[0].click(); return diagnostic;
}

export async function prepareActualManualDraft(studio, { sessionId, projectId, conversationId, phase, nodeBinary, draft, beforeSubmit = async () => {} }) {
  validateManualDraft(draft, { phase, nodeBinary, repair: Boolean(draft.revisionOf) });
  const command = '/m2-build ' + JSON.stringify(draft);
  const args = { sessionId, projectId, conversationId, command };
  let lastReadiness = null;
  try {
    await waitUntil(async () => {
      lastReadiness = await invoke(studio, manualColumnAction, { ...args, action: 'probe' });
      return lastReadiness.ready ? lastReadiness : null;
    }, 'actual selected Studio session column and scoped Send', 15000);
  } catch (error) {
    throw new Error('FAN_MANUAL_COLUMN_NOT_READY:' + JSON.stringify(lastReadiness), { cause: error });
  }
  // Freeze the literal operator specification before the public Send action.
  await beforeSubmit(copy(draft));
  const sent = await invoke(studio, manualColumnAction, { ...args, action: 'send' });
  assert.equal(sent.ready, true, 'actual selected column still ready before single Send');
  const result = await waitUntil(() => invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.busy) return null;
    if (entry.error) throw Error('FAN_MANUAL_DRAFT_FAILED:' + entry.error);
    if (entry.view?.state !== 'awaiting_approval') return null;
    return { view: JSON.parse(JSON.stringify(entry.view)),
      userRecorded: session.chat.msgs.some(row => row.role === 'user' && row.tag === 'M2' && row.text === args.command),
      ordinaryTurnActive: model.widget.transport.hasActiveM1Turn(session), proposal: session.chat._projectWorkProposal || null };
  }, { sessionId, command }), 'actual public operator CODE preview', 990000);
  assert.equal(result.userRecorded, true); assert.equal(result.ordinaryTurnActive, false); assert.equal(result.proposal, null);
  assert.deepEqual(result.view.plan.origin, { surface: 'studio', sessionId: conversationId, conversationId, projectId });
  assert.deepEqual(sorted(result.view.diff.map(file => file.path)), sorted(TARGETS[phase]));
  assert.equal(result.view.audit?.governanceDecision?.verdict, 'allow');
  return { entryMode: 'manual', command, submittedDraft: copy(draft), ...result };
}

// ROOT must call this only AFTER independent exact preview/source-policy/disk
// assertions and a pending backend restart/reload have returned the same digest.
export async function approveRenderedExactPlan(studio, { sessionId, lifecycleId, planDigest }) {
  await invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.view?.state !== 'awaiting_approval' || entry.view.lifecycleId !== args.lifecycleId
      || entry.view.planDigest !== args.planDigest || session._m2Pending?.planDigest !== args.planDigest) throw Error('FAN_APPROVAL_DRIFT');
    const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Zobrazit změny');
    if (buttons.length !== 1) throw Error('FAN_SHOW_CHANGES_BUTTON');
    buttons[0].click(); return true;
  }, { sessionId, lifecycleId, planDigest });
  await waitUntil(() => invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.view?.lifecycleId !== args.lifecycleId || entry.view?.planDigest !== args.planDigest) throw Error('FAN_PRESENTATION_DRIFT');
    return entry.presentedView === entry.view;
  }, { sessionId, lifecycleId, planDigest }), 'actual visible exact diff presentation');
  await invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.view.lifecycleId !== args.lifecycleId || entry.view.planDigest !== args.planDigest
      || entry.presentedView !== entry.view) throw Error('FAN_APPROVAL_NOT_PRESENTED');
    const buttons = [...document.querySelectorAll('.appr button')].filter(button => button.textContent.trim() === 'Schválit');
    if (buttons.length !== 1 || buttons[0].disabled) throw Error('FAN_APPROVAL_BUTTON');
    buttons[0].click(); return true;
  }, { sessionId, lifecycleId, planDigest });
  return waitUntil(() => invoke(studio, (model, args) => {
    const session = model.widget.store.find(args.sessionId), entry = model.widget.m2.entry(session);
    if (entry.busy) return null;
    if (entry.error) throw Error('FAN_APPROVAL_FAILED:' + entry.error);
    if (entry.view?.lifecycleId !== args.lifecycleId || entry.view?.planDigest !== args.planDigest) throw Error('FAN_TERMINAL_BINDING_DRIFT');
    return ['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out'].includes(entry.view.state)
      ? JSON.parse(JSON.stringify(entry.view)) : null;
  }, { sessionId, lifecycleId, planDigest }), 'durable exact M2 terminal', 3600000);
}
