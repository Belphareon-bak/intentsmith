import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { COMMANDS, parseCommand, validateReview, validateList, renderReview, runCommand } =
  require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/learning-commands');
const ID = 'lpr1:' + 'a'.repeat(64);
function review() {
  return { contract: 'LearningProposalReview', version: 1, projectId: 17, state: 'pending',
    proposal: { projectId: 17, proposalId: ID, title: 'Title', rationale: 'Evidence', confidenceBps: 7000,
      adaptation: { key: 'style', value: { concise: true }, changesPermissions: false, changesCode: false, changesConfig: false },
      retention: { ttlMs: 1000 }, observationIds: ['o1', 'o2'] },
    observations: ['o1', 'o2'].map(observationId => ({ contract: 'LearningObservation', projectId: 17, observationId,
      evidence: [{ evidenceId: 'e', digest: 'sha256:' + 'b'.repeat(64), workspaceRevision: 'wsr1:' + 'c'.repeat(64) }] })),
    currentOutcome: null };
}
test('Studio exposes only explicit project-bound M4 learning commands', () => {
  assert.deepEqual([...COMMANDS].sort(), ['/m4-learning', '/m4-learning-show', '/m4-learning-approve',
    '/m4-learning-reject', '/m4-learning-weaken', '/m4-learning-rollback', '/m4-learning-delete'].sort());
  for (const project of [null, 0, -1, 1.5, '17']) assert.throws(() => parseCommand('/m4-learning', project));
  assert.equal(parseCommand('/m4-learning', 17).path, '/api/projects/17/learning/proposals?state=pending&limit=50');
  assert.equal(parseCommand('ano', 17), null);
});
test('all M4 HTTP success is gated by Response.ok and typed failures retain code and status', async () => {
  await assert.rejects(runCommand({ text: '/m4-learning', projectId: 17, backendUrl: () => 'http://local',
    assertContext: () => assert.fail('failed HTTP must not render'), fetchImpl: async (_url, options) => {
      assert.equal(options.credentials, 'same-origin');
      return { ok: false, status: 409, json: async () => ({ code: 'M4_CONFLICT', error: 'conflict' }) };
    } }), { code: 'M4_CONFLICT', status: 409 });
});
test('Studio validates exact proposal, same-project observations, digests and current outcome', () => {
  assert.equal(validateReview(review(), 17, ID).projectId, 17);
  for (const mutate of [v => v.version = 2, v => v.projectId = 18, v => v.proposal.projectId = 18,
    v => v.proposal.proposalId = 'other', v => v.observations[0].projectId = 18,
    v => v.observations[0].observationId = 'other', v => v.observations[0].evidence[0].digest = 'bad',
    v => v.observations[0].evidence[0].workspaceRevision = 'bad', v => v.currentOutcome = {},
    v => { v.state = 'active'; v.currentOutcome = { projectId: 17, proposalId: 'other', status: 'approved' }; }]) {
    const value = review(); mutate(value); assert.throws(() => validateReview(value, 17, ID));
  }
  const list = { contract: 'LearningProposalReviewList', version: 1, projectId: 17, stateFilter: 'pending', reviews: [review()] };
  assert.equal(validateList(list, 17, 'pending'), list);
  assert.throws(() => validateList({ ...list, reviews: Array(101).fill(review()) }, 17, 'pending'));
  assert.throws(() => validateList(list, 18, 'pending'));
});
test('proposal rendering shows rationale, adaptation, retention, provenance and explicit user gates', () => {
  const text = renderReview(review());
  for (const label of ['Proposal ID:', 'Rationale:', 'Pattern key:', 'Pattern value:', 'Changes permissions/code/config:',
    'TTL ms:', 'Observation IDs:', 'Exact evidence:', 'digest:', 'workspaceRevision:', 'Explicit approval:', 'Explicit rejection:',
    'Obecné „ano“ tento návrh nikdy neschválí.']) assert.ok(text.includes(label), label);
  const active = review(); active.state = 'active'; active.currentOutcome = { proposalId: ID, projectId: 17, status: 'approved' };
  for (const label of ['Rollback:', 'Delete tombstone:']) assert.ok(renderReview(active).includes(label));
});
test('mutating commands require exact proposal ID plus reason or exact weaken JSON', () => {
  for (const action of ['approve', 'reject', 'rollback', 'delete']) {
    const command = '/m4-learning-' + action;
    assert.throws(() => parseCommand(command + ' ' + ID, 17));
    assert.throws(() => parseCommand(command + ' ' + ID + ' ' + 'x'.repeat(4097), 17));
    assert.deepEqual(parseCommand(command + ' ' + ID + ' explicit reason ', 17).body, { reason: 'explicit reason' });
  }
  assert.deepEqual(parseCommand('/m4-learning-weaken ' + ID + ' {"confidenceBps":5000,"reason":" why ","value":{}}', 17).body,
    { confidenceBps: 5000, reason: 'why', value: {} });
  for (const body of ['{}', '{"confidenceBps":1.5,"reason":"why","value":{}}',
    '{"confidenceBps":5000,"reason":"why","value":{},"actorId":"forged"}'])
    assert.throws(() => parseCommand('/m4-learning-weaken ' + ID + ' ' + body, 17));
});
test('handler sends only bounded derived bodies and revalidates every response after context check', async () => {
  const calls = [];
  const options = { text: '/m4-learning-approve ' + ID + ' confirmed', projectId: 17,
    backendUrl: () => 'http://local', assertContext: () => calls.push('context'),
    fetchImpl: async (url, opts) => { calls.push('request');
      assert.equal(url, 'http://local/api/projects/17/learning/proposals/' + encodeURIComponent(ID) + '/approve');
      assert.deepEqual(JSON.parse(opts.body), { reason: 'confirmed' });
      return { ok: true, json: async () => review() }; } };
  assert.match(await runCommand(options), /Exact evidence:/);
  assert.deepEqual(calls, ['request', 'context']);
  await assert.rejects(runCommand({ ...options, assertContext: () => { throw Error('changed project'); } }), /changed project/);
  await assert.rejects(runCommand({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }));
});
test('M4 commands dispatch before ordinary WebSocket chat send and reject attachments', async () => {
  const source = await readFile(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model.js', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('  pSend('), source.indexOf('  pApprove('));
  assert.ok(send.indexOf('LEARNING_COMMANDS') < send.indexOf('this.widget.send('));
  const start = source.indexOf('  runLearningCommand('), handler = source.slice(start, source.indexOf('  ', start + 30));
  assert.match(source.slice(start), /chat\.attachments\.length/);
  assert.match(source.slice(start), /M4_STUDIO_CONTEXT_CHANGED/);
});
