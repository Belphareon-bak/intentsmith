// Current model evaluation read contract. This suite is read-only: it neither
// occupies the GPU nor starts hidden background inference.
import {
  suite, testAsync, assert, assertEqual, summary, api, waitForServer,
} from './_helpers.js';

await waitForServer();

suite('Model evaluations — exact current authority');

await testAsync('one endpoint exposes all role contracts and exact artifacts', async () => {
  const { status, data } = await api('GET', '/api/system/models/evaluations');
  assertEqual(status, 200);
  assertEqual(data.schemaVersion, 2);
  assertEqual(data.authority.status, 'READY');
  assertEqual(data.authority.tables.join(','), 'model_evaluation_runs,model_evaluation_decisions');
  assertEqual(data.authority.currentContractOnly, true);
  assertEqual(data.authority.legacyFallback, false);
  assertEqual(Object.keys(data.roles).sort().join(','), 'CHAT,CODE,D1,D2,R1,R2,VISION');
  assert(Array.isArray(data.decisions), 'append-only decisions must be readable');

  for (const [role, roleState] of Object.entries(data.roles)) {
    assertEqual(roleState.role, role);
    assert(typeof roleState.suiteName === 'string' && roleState.suiteName.length > 0,
      `${role} suite name required`);
    assert(/^[a-f0-9]{64}$/.test(roleState.suiteContractSha256),
      `${role} exact contract required`);
    assert(roleState.minimumTaskCount > 1, `${role} must not accept a smoke-test floor`);
    assert(roleState.minimumDiscriminatingTasks > 1,
      `${role} must not accept one lucky task`);
    assertEqual(roleState.decisionReady, true);
  }

  const allowed = new Set(['COMPLETE', 'FAILED', 'BLOCKED', 'MISSING']);
  for (const model of data.models) {
    assert(/^[a-f0-9]{64}$/.test(model.digestSha256), `${model.name} exact digest required`);
    for (const row of Object.values(model.evaluations)) {
      assert(allowed.has(row.status), `unexpected status ${row.status}`);
      if (row.status === 'COMPLETE') {
        assert(Number.isFinite(row.score) && row.score >= 0 && row.score <= 1,
          'COMPLETE score must be bounded');
        assert(typeof row.testedAt === 'string' && row.testedAt.length > 0,
          'COMPLETE timestamp required');
      }
    }
  }
});

await testAsync('removed v123 endpoints are not callable', async () => {
  for (const endpoint of [
    '/api/system/models/validate',
    '/api/system/models/validation-scores',
  ]) {
    const { status } = await api('GET', endpoint);
    assertEqual(status, 404, `${endpoint} must stay removed`);
  }
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
