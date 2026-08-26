import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioPath = path.join(
  root,
  'c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
);
const source = await readFile(studioPath, 'utf8');

function functionSlice(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('Studio exposes only explicit project-bound M4 learning commands', () => {
  const handler = functionSlice('_m4HandleLearningCommand', '_chatSendPane');
  for (const command of [
    '/m4-learning',
    '/m4-learning-show',
    '/m4-learning-approve',
    '/m4-learning-reject',
    '/m4-learning-weaken',
    '/m4-learning-rollback',
    '/m4-learning-delete',
  ]) assert.match(source, new RegExp(command.replaceAll('/', '\\/')));
  assert.match(handler, /\/api\/projects\/'\+encodeURIComponent\(projectId\)\+'\/learning\/proposals/);
  assert.match(handler, /_m4LearningProject\(s\)/);
  assert.match(handler, /_m4AssertCurrentProject\(idx,s,projectId\)/);
  assert.doesNotMatch(handler, /projectPath|actorId|authenticatedSubject/);
  assert.match(handler, /M4_STUDIO_ATTACHMENTS_NOT_ALLOWED/);
});

test('all M4 HTTP success is gated by Response.ok and typed failures retain code and status', () => {
  const transport = functionSlice('_m4LearningFetchJSON', '_m4LearningProposalId');
  assert.match(transport, /credentials:'same-origin'/);
  assert.match(transport, /if\(!r\.ok\)/);
  assert.match(transport, /payload\.code/);
  assert.match(transport, /status:r\.status/);
  assert.doesNotMatch(transport, /ok:true/);
});

test('Studio validates exact proposal, same-project observations, digests and current outcome', () => {
  const validator = functionSlice('_m4RequireLearningReview', '_m4RequireLearningList');
  for (const evidence of [
    "view.contract!=='LearningProposalReview'",
    'view.version!==1',
    'view.projectId!==projectId',
    'observation.projectId!==projectId',
    'observation.observationId!==view.proposal.observationIds[i]',
    "!/^sha256:[0-9a-f]{64}$/.test(evidence.digest)",
    "!/^wsr1:[0-9a-f]{64}$/.test(evidence.workspaceRevision)",
    'view.currentOutcome.proposalId!==view.proposal.proposalId',
  ]) assert.ok(validator.includes(evidence), evidence);
  const listValidator = functionSlice('_m4RequireLearningList', '_m4LearningDisplay');
  assert.match(listValidator, /LearningProposalReviewList/);
  assert.match(listValidator, /view\.reviews\.length>100/);
  assert.match(listValidator, /_m4RequireLearningReview/);
});

test('proposal rendering shows rationale, adaptation, retention, provenance and explicit user gates', () => {
  const renderer = functionSlice('_m4RenderLearningReview', '_m4RenderLearningList');
  for (const label of [
    'Proposal ID:',
    'Rationale:',
    'Pattern key:',
    'Pattern value:',
    'Changes permissions/code/config:',
    'TTL ms:',
    'Observation IDs:',
    'Exact evidence:',
    'digest:',
    'workspaceRevision:',
    'Explicit approval:',
    'Explicit rejection:',
    'Obecné „ano“ tento proposal nikdy neschválí.',
    'Rollback:',
    'Delete tombstone:',
  ]) assert.ok(renderer.includes(label), label);
});

test('mutating commands require exact proposal ID plus reason or exact weaken JSON', () => {
  const reasonParser = functionSlice('_m4ParseIdReason', '_m4ParseWeaken');
  assert.match(reasonParser, /lpr1:\[0-9a-f\]\{64\}/);
  assert.match(reasonParser, /length>4096/);
  const weakenParser = functionSlice('_m4ParseWeaken', '_m4BeginLearningCommand');
  assert.match(weakenParser, /JSON\.parse/);
  assert.match(weakenParser, /confidenceBps,reason,value/);
  assert.match(weakenParser, /Number\.isSafeInteger\(body\.confidenceBps\)/);
  assert.match(weakenParser, /body:\{confidenceBps:body\.confidenceBps,reason:body\.reason\.trim\(\),value:body\.value\}/);
});

test('handler sends only bounded derived bodies and revalidates every response after context check', () => {
  const handler = functionSlice('_m4HandleLearningCommand', '_chatSendPane');
  assert.match(handler, /body=\{reason:parsed\.reason\}/);
  assert.match(handler, /body=weaken\.body/);
  assert.match(handler, /options\.body=JSON\.stringify\(body\)/);
  assert.match(handler, /_m4AssertCurrentProject\(idx,s,projectId\)/);
  assert.match(handler, /_m4RequireLearningList\(view,projectId,state\)/);
  assert.match(handler, /_m4RequireLearningReview\(view,projectId,proposalId\)/);
  assert.doesNotMatch(handler, /\bfetch\(/);
});

test('M4 commands dispatch before edit mode and ordinary WebSocket chat send', () => {
  const send = functionSlice('_chatSendPane', '_chatGapChoice');
  const dispatch = send.indexOf('_m4HandleLearningCommand(idx,s,st,ta,t,cmd,arg)');
  const edit = send.indexOf("if(cmd==='/edit')");
  const ordinarySend = send.indexOf('_chatTryWsSend(txt,s,idx)');
  assert.ok(dispatch >= 0 && dispatch < edit && dispatch < ordinarySend);
  assert.match(send, /if\(_m4HandleLearningCommand\(idx,s,st,ta,t,cmd,arg\)\)return/);
});
