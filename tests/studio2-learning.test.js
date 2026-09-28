import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCommand, validateReview, runCommand } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/learning-commands');
const ID = 'lpr1:' + 'a'.repeat(64);

function review(projectId = 17) {
  const observations = [1, 2].map(index => ({ contract: 'LearningObservation', projectId,
    observationId: `obs-${index}`, producer: 'test', confidenceBps: 7000, observedAtMs: 1000 + index,
    evidence: [{ evidenceId: `e-${index}`, kind: 'workspace', sourceId: 'project', sourceVersion: '1',
      digest: 'sha256:' + String(index).repeat(64), workspaceRevision: 'wsr1:' + String(index).repeat(64) }] }));
  return { contract: 'LearningProposalReview', version: 1, projectId, state: 'pending',
    proposal: { projectId, proposalId: ID, observationIds: observations.map(row => row.observationId),
      title: 'Návrh', rationale: 'Dvě pozorování', adaptation: { key: 'style', value: { concise: true }, target: 'project',
        changesPermissions: false, changesCode: false, changesConfig: false }, retention: { ttlMs: 1000 } },
    observations, currentOutcome: null };
}

test('M4 command parsing confines operations to exact project and bounded explicit reason', () => {
  const parsed = parseCommand('/m4-learning-approve ' + ID + ' Potvrzuji pro projekt', 17);
  assert.equal(parsed.path, '/api/projects/17/learning/proposals/' + encodeURIComponent(ID) + '/approve');
  assert.deepEqual(parsed.body, { reason: 'Potvrzuji pro projekt' });
  assert.equal(parseCommand('Běžný dotaz', 17), null);
  assert.throws(() => parseCommand('/m4-learning', 0), { code: 'M4_STUDIO_PROJECT_REQUIRED' });
  assert.throws(() => parseCommand('/m4-learning-approve ' + ID, 17), { code: 'M4_STUDIO_ARGUMENT_INVALID' });
  assert.throws(() => parseCommand('/m4-learning-weaken ' + ID + ' {"reason":"x","value":{}}', 17),
    { code: 'M4_STUDIO_ARGUMENT_INVALID' });
  assert.throws(() => parseCommand('/m4-learning-approve ' + ID + ' ' + 'a'.repeat(4097), 17),
    { code: 'M4_STUDIO_ARGUMENT_INVALID' });
});

test('M4 read validates every project, evidence digest and exact outcome before showing data', () => {
  const valid = review();
  assert.equal(validateReview(valid, 17, ID), valid);
  assert.throws(() => validateReview(valid, 18), { code: 'M4_STUDIO_INVALID_RESPONSE' });
  const foreign = review(); foreign.observations[1].projectId = 18;
  assert.throws(() => validateReview(foreign, 17), { code: 'M4_STUDIO_INVALID_EVIDENCE' });
  const noDigest = review(); noDigest.observations[0].evidence[0].digest = 'sha256:wrong';
  assert.throws(() => validateReview(noDigest, 17), { code: 'M4_STUDIO_INVALID_EVIDENCE' });
  const falseApproval = review(); falseApproval.state = 'active';
  assert.throws(() => validateReview(falseApproval, 17), { code: 'M4_STUDIO_INVALID_RESPONSE' });
});

test('M4 HTTP failure and context change never become a confirmed approval', async () => {
  const calls = [], base = { text: '/m4-learning-approve ' + ID + ' Souhlasím', projectId: 17,
    backendUrl: () => 'http://127.0.0.1:3335', assertContext: () => {} };
  const denied = async (url, options) => {
    calls.push([url, options]);
    return { ok: false, status: 409, json: async () => ({ code: 'M4_CONFLICT', error: 'Revize se změnila' }) };
  };
  await assert.rejects(runCommand({ ...base, fetchImpl: denied }), { code: 'M4_CONFLICT', status: 409 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0][1].body), { reason: 'Souhlasím' });
  await assert.rejects(runCommand({ ...base, fetchImpl: async () => ({ ok: true, json: async () => review() }),
    assertContext: () => { throw Object.assign(new Error('Projekt se změnil'), { code: 'M4_STUDIO_CONTEXT_CHANGED' }); } }),
  { code: 'M4_STUDIO_CONTEXT_CHANGED' });
  const result = await runCommand({ ...base, fetchImpl: async () => ({ ok: true, json: async () => review() }) });
  assert.match(result, /Exact evidence:/);
  assert.match(result, /Obecné „ano“ tento návrh nikdy neschválí/);
});
