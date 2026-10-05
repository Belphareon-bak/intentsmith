// Private finite qualification controller. No top-level browser/model/runtime effects.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {evaluateRenderer,waitUntil} from '../../scripts/run-project-build-journey.js';
import {bindActualConversation,reloadActualStatus} from '../../scripts/manual/fan-monitor-studio2-controller.mjs';
import {compileM2ProjectChangeProposal} from '../../src/lifecycle/m2-proposal-compiler.js';
import {validateM2PrivateHttpNetworkPolicy,computeM2PrivateHttpNetworkPolicyDigest} from '../../contracts/m2/execution-v2.js';
const require=createRequire(import.meta.url);
const {validateBlueprint,createForm,composerDraft}=require('../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-composer.js');
export {bindActualConversation,reloadActualStatus};
export const HTTP_JOURNEY_BOUNDS=Object.freeze({phaseWaitMs:750000,providerCallTimeoutMs:180000,approvalWaitMs:120000,repairSelectionWaitMs:180000,rendererProbeMs:15000,focusedTimeoutMs:25000,repairMaximumGeneratedTargets:4,repairMaximumPhases:1});
export const TARGETS=Object.freeze(['src/validation.mjs','src/store.mjs','src/router.mjs','src/server.mjs']);
const copy=x=>JSON.parse(JSON.stringify(x)),sorted=x=>[...x].sort();
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
    + ';return await (' + fn.toString() + ')(find(),' + JSON.stringify(args) + ');})()', HTTP_JOURNEY_BOUNDS.rendererProbeMs);
}

async function manualColumnAction(model, args) {
  if (args.action === 'send') await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const store = model.widget.store, session = store.find(args.sessionId), state = model.st();
  if (!session || String(session._projectId) !== String(args.projectId)
    || String(session._convId) !== args.conversationId || store.focusedSession() !== session
    || model.widget.transport.hasActiveM1Turn(session) || session._m2Pending
    || session.chat._projectWorkProposal || session.chat._m2Composer?.open
    || session.chat._delivery?.status === 'DELIVERY_UNKNOWN') throw Error('HTTP_ITEMS_MANUAL_SCOPE_OR_BUSY');
  const layout = store.state.columns, index = layout.indexOf(session.id);
  if (index < 0 || layout.lastIndexOf(session.id) !== index || state.focusCol !== index
    || JSON.stringify(state.colSids) !== JSON.stringify(layout)) throw Error('HTTP_ITEMS_MANUAL_COLUMN_BINDING_DRIFT');
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
  if (args.action !== 'send') throw Error('HTTP_ITEMS_MANUAL_UNKNOWN_ACTION');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, args.command);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (model.st().drafts[args.sessionId] !== args.command) throw Error('HTTP_ITEMS_MANUAL_LITERAL_INPUT_DRIFT');
  // The same session column owns both the controlled input and the normal Send.
  if (!column.isConnected || !input.isConnected || !buttons[0].isConnected
    || store.focusedSession() !== session) throw Error('HTTP_ITEMS_MANUAL_DOM_CHANGED_BEFORE_SEND');
  buttons[0].click(); return diagnostic;
}


export function validateHttpDraft(draft,{expected,repair=false}){
  validateBlueprint(draft);assert.ok(draft.gitCommit,'HTTP_GIT_COMMIT_REQUIRED_BEFORE_MODEL');assert.deepEqual(sorted(draft.files.map(f=>f.path)),sorted(TARGETS));
  assert.deepEqual(draft.focusedTest,expected.focusedTest);assert.deepEqual(draft.gitCommit,expected.gitCommit);
  assert.deepEqual(draft.focusedTest.environment,{});assert.equal(draft.focusedTest.timeoutMs,25000);
  assert.equal(draft.focusedTest.sandboxProfile,'linux-bwrap-private-loopback-v1');
  const policy=validateM2PrivateHttpNetworkPolicy(draft.focusedTest.networkPolicy);assert.equal(policy.valid,true,JSON.stringify(policy.errors));
  assert.equal(draft.focusedTest.networkPolicy.endpoint.port,18080);
  assert.equal(draft.focusedTest.networkPolicyDigest,computeM2PrivateHttpNetworkPolicyDigest(draft.focusedTest.networkPolicy));
  assert.equal(draft.focusedTest.binary,draft.focusedTest.networkPolicy.artifacts.runtimeExecutable.canonicalPath);
  assert.equal(draft.focusedTest.argv[0],draft.focusedTest.networkPolicy.artifacts.oracle.canonicalPath);
  assert.equal(Boolean(draft.revisionOf),repair);
  for(const file of draft.files){const before=expected.files.find(f=>f.path===file.path);assert.ok(before);assert.deepEqual(file.dependsOn,before.dependsOn);assert.deepEqual(file.contextFiles,before.contextFiles);if(repair){assert.equal(typeof file.reusePrevious,'boolean');if(file.reusePrevious)assert.equal(file.instruction,before.instruction,'retained instruction unchanged');}else assert.equal(file.reusePrevious,undefined);}
  if(repair)assert.ok(draft.files.filter(f=>!f.reusePrevious).length>=1&&draft.files.filter(f=>!f.reusePrevious).length<=4,'one repair of1..4 targets');
  for(const instruction of [draft.instruction,...draft.files.map(f=>f.instruction)])assert.ok(instruction.isWellFormed()&&Buffer.byteLength(instruction)<=512);
  return draft;
}
export function checkComposerRoundTrip(draft,origin){const output=composerDraft(createForm(origin,draft));assert.deepEqual(output,draft);return output;}
export async function prepareHttpDraft(studio,{sessionId,projectId,conversationId,draft,expected,beforeSubmit,proposal=null}){
  validateHttpDraft(draft,{expected,repair:Boolean(draft.revisionOf)});
  if(proposal){const p=compileM2ProjectChangeProposal(proposal);assert.equal(draft.revisionOf,undefined);assert.deepEqual(sorted(p.changes.map(x=>x.path)),sorted(TARGETS));assert.deepEqual(p.focusedTest,draft.focusedTest);assert.deepEqual(p.gitCommit,draft.gitCommit);}
  const command=(proposal?'/m2-plan ':'/m2-build ')+JSON.stringify(proposal||draft),args={sessionId,projectId,conversationId,command};
  await waitUntil(async()=>{const r=await invoke(studio,manualColumnAction,{...args,action:'probe'});return r.ready?r:null;},'HTTP actual selected session Send',15000);
  await beforeSubmit(copy(draft));assert.equal((await invoke(studio,manualColumnAction,{...args,action:'send'})).ready,true);
  const result=await waitUntil(()=>invoke(studio,(model,args)=>{const s=model.widget.store.find(args.sessionId),entry=model.widget.m2.entry(s);if(entry.busy)return null;if(entry.error)throw Error('HTTP_CODE_PREPARE:'+entry.error);return entry.view?.state==='awaiting_approval'?{view:JSON.parse(JSON.stringify(entry.view)),userRecorded:s.chat.msgs.some(x=>x.role==='user'&&x.tag==='M2'&&x.text===args.command),ordinaryTurnActive:model.widget.transport.hasActiveM1Turn(s),proposal:s.chat._projectWorkProposal||null}:null;},{sessionId,command}),'HTTP full-source CODE preview',HTTP_JOURNEY_BOUNDS.phaseWaitMs);
  assert.equal(result.userRecorded,true);assert.equal(result.ordinaryTurnActive,false);assert.equal(result.proposal,null);
  assert.deepEqual(result.view.plan.origin,{surface:'studio',sessionId:conversationId,conversationId,projectId});
  assert.deepEqual(sorted(result.view.diff.map(f=>f.path)),sorted(TARGETS));assert.equal(result.view.plan.version,2);assert.equal(result.view.audit?.governanceDecision?.verdict,'allow');
  return{...result,submittedDraft:copy(draft),...(proposal?{submittedProposal:copy(proposal),entryCommand:'/m2-plan'}:{entryCommand:'/m2-build'})};
}
export async function approveHttpPlan(studio,{sessionId,view,beforeClick=async()=>{}}){
  await invoke(studio,(model,args)=>{const s=model.widget.store.find(args.sessionId),e=model.widget.m2.entry(s);if(e.view?.state!=='awaiting_approval'||e.view.lifecycleId!==args.id||e.view.planDigest!==args.digest||s._m2Pending?.planDigest!==args.digest)throw Error('HTTP_APPROVAL_DRIFT');const b=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='Zobrazit změny');if(b.length!==1||b[0].disabled)throw Error('HTTP_SHOW_CHANGES');b[0].click();return true;},{sessionId,id:view.lifecycleId,digest:view.planDigest});
  const visible=await waitUntil(()=>invoke(studio,(model,args)=>{const s=model.widget.store.find(args.sessionId),e=model.widget.m2.entry(s);if(e.view?.lifecycleId!==args.id||e.view.planDigest!==args.digest)throw Error('HTTP_PRESENTATION_DRIFT');if(e.presentedView!==e.view)return null;const expected=JSON.stringify(e.view.plan.focusedTest);const texts=[...document.querySelectorAll('.rp .fsec-e')].filter(x=>x.getClientRects().length&&getComputedStyle(x).visibility!=='hidden'&&x.textContent.startsWith('Test: '+expected));if(!texts.length)throw Error('HTTP_FULL_POLICY_NOT_RENDERED');return{lifecycleId:e.view.lifecycleId,planDigest:e.view.planDigest,focusedTest:JSON.parse(JSON.stringify(e.view.plan.focusedTest)),fullPolicyRendered:true};},{sessionId,id:view.lifecycleId,digest:view.planDigest}),'HTTP exact visible full-policy presentation',15000);
  assert.deepEqual(visible.focusedTest,view.plan.focusedTest);await beforeClick(visible);
  await invoke(studio,(model,args)=>{const s=model.widget.store.find(args.sessionId),e=model.widget.m2.entry(s);if(e.view?.lifecycleId!==args.id||e.view.planDigest!==args.digest||e.presentedView!==e.view)throw Error('HTTP_NOT_PRESENTED');const b=[...document.querySelectorAll('.appr button')].filter(x=>x.textContent.trim()==='Schválit');if(b.length!==1||b[0].disabled)throw Error('HTTP_APPROVAL_BUTTON');b[0].click();return true;},{sessionId,id:view.lifecycleId,digest:view.planDigest});
  return waitUntil(()=>invoke(studio,(model,args)=>{const e=model.widget.m2.entry(model.widget.store.find(args.sessionId));if(e.busy)return null;if(e.error)throw Error('HTTP_APPROVE:'+e.error);if(e.view?.lifecycleId!==args.id||e.view.planDigest!==args.digest)throw Error('HTTP_TERMINAL_BINDING_DRIFT');return ['succeeded','failed','blocked','cancelled','timed_out'].includes(e.view.state)?JSON.parse(JSON.stringify(e.view)):null;},{sessionId,id:view.lifecycleId,digest:view.planDigest}),'HTTP durable M2 terminal',HTTP_JOURNEY_BOUNDS.approvalWaitMs);
}
