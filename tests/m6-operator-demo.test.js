import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  M6_OPERATOR_DEMO_INPUT_CONTRACT,
  M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
  M6_OPERATOR_DEMO_PLAN_V1,
} from '../contracts/m6/operator-demo-v1.js';
import {
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_ROLE,
} from '../contracts/authority/signed-authority-receipt-v1.js';
import {
  validateM6AcceptanceReceipt,
} from '../src/release/m6-acceptance-authority.js';
import {
  buildM6OperatorDemoObservation,
  validateM6OperatorDemoObservation,
  validateM6OperatorDemoReceiptObservation,
} from '../src/release/m6-operator-demo.js';
import { suite, summary, test, testAsync } from './harness.js';

const candidateSha = 'a'.repeat(40);
const candidateTree = 'b'.repeat(40);
const registryFingerprint = 'c'.repeat(64);
const rawPrefix = `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/raw/`;

const identity = {
  candidateSha,
  candidateTree,
  registryFingerprint,
  sourceTreeClean: true,
  standaloneCheckout: true,
};

function input(status = 'PASS') {
  return {
    contract: M6_OPERATOR_DEMO_INPUT_CONTRACT,
    version: 1,
    candidateSha,
    startedAt: '2026-08-27T12:00:00.000Z',
    completedAt: '2026-08-27T12:09:00.000Z',
    environment: {
      freshCloneObserved: true,
      installProfile: 'core-minimal-offline',
      buildProfile: 'linux-x64-studio-production',
      unexpectedEgressAttempts: 0,
    },
    steps: M6_OPERATOR_DEMO_PLAN_V1.steps.map((step, index) => ({
      id: step.id,
      status,
      notes: `Synthetic operator observation ${index}.`,
      artifactPaths: [`${rawPrefix}step-${index}.json`],
    })),
  };
}

const artifacts = new Map(M6_OPERATOR_DEMO_PLAN_V1.steps.map((step, index) => [
  `${rawPrefix}step-${index}.json`,
  Buffer.from(JSON.stringify({ step: step.id, synthetic: true })),
]));
const readArtifact = async path => {
  const bytes = artifacts.get(path);
  if (!bytes) throw new Error('missing fixture artifact');
  return Buffer.from(bytes);
};

suite('M6 operator demo observation authority');

test('locked nine-step plan is immutable and content pinned', () => {
  assert.equal(M6_OPERATOR_DEMO_PLAN_V1.steps.length, 9);
  assert.equal(M6_OPERATOR_DEMO_PLAN_V1.output.automaticApproval, 'forbidden');
  assert.equal(
    M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptAuthorityId,
    SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
  );
  assert.equal(
    M6_OPERATOR_DEMO_PLAN_V1.output.approvalReceiptDomain,
    SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
  );
  assert.equal(Object.isFrozen(M6_OPERATOR_DEMO_PLAN_V1.steps[0]), true);
  assert.equal(
    createHash('sha256').update(JSON.stringify(M6_OPERATOR_DEMO_PLAN_V1)).digest('hex'),
    M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
  );
});

await testAsync('all PASS observations remain awaiting a separate user approval receipt', async () => {
  const observation = await buildM6OperatorDemoObservation(input(), {
    identity,
    readArtifact,
    recordedAt: '2026-08-27T12:10:00.000Z',
  });
  assert.equal(observation.verdict, 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL');
  assert.equal(observation.stage, 'OBSERVATION_ONLY_NOT_APPROVAL');
  assert.equal(observation.acceptance.status, 'NOT_ISSUED');
  assert.equal(observation.acceptance.automaticApproval, 'forbidden');
  assert.equal(observation.acceptance.authorityId, SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR);
  assert.equal(observation.acceptance.domain, SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO);
  const validation = await validateM6OperatorDemoObservation(observation, {
    identity,
    readArtifact,
  });
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(validateM6AcceptanceReceipt(observation, {
    candidateSha,
    registryFingerprint,
  }).valid, false);
});

await testAsync('FAIL and NOT_RUN are preserved as incomplete rather than approval', async () => {
  for (const status of ['FAIL', 'NOT_RUN']) {
    const value = input();
    value.steps[4].status = status;
    const observation = await buildM6OperatorDemoObservation(value, {
      identity,
      readArtifact,
      recordedAt: '2026-08-27T12:10:00.000Z',
    });
    assert.equal(observation.verdict, 'DEMO_INCOMPLETE');
    assert.equal((await validateM6OperatorDemoObservation(observation, {
      identity,
      readArtifact,
    })).valid, true);
  }
});

await testAsync('wrong candidate, dirty/non-standalone source, egress and reordered steps fail closed', async () => {
  const cases = [
    { value: input(), identity: { ...identity, sourceTreeClean: false } },
    { value: input(), identity: { ...identity, standaloneCheckout: false } },
    { value: { ...input(), candidateSha: 'd'.repeat(40) }, identity },
    { value: input(), identity, mutate: value => { value.environment.unexpectedEgressAttempts = 1; } },
    { value: input(), identity, mutate: value => { value.steps.reverse(); } },
    { value: input(), identity, mutate: value => { value.steps[0].artifactPaths = ['../escape']; } },
  ];
  for (const item of cases) {
    item.mutate?.(item.value);
    await assert.rejects(
      buildM6OperatorDemoObservation(item.value, {
        identity: item.identity,
        readArtifact,
        recordedAt: '2026-08-27T12:10:00.000Z',
      }),
      /m6-operator-demo:/,
    );
  }
});

await testAsync('artifact tamper and forged approval projection invalidate the observation', async () => {
  const observation = await buildM6OperatorDemoObservation(input(), {
    identity,
    readArtifact,
    recordedAt: '2026-08-27T12:10:00.000Z',
  });
  const tamperedReader = async path => (
    path.endsWith('step-0.json') ? Buffer.from('tampered') : readArtifact(path)
  );
  assert.equal((await validateM6OperatorDemoObservation(observation, {
    identity,
    readArtifact: tamperedReader,
  })).valid, false);

  const forged = structuredClone(observation);
  forged.acceptance.status = 'ISSUED';
  forged.verdict = 'APPROVED';
  const validation = await validateM6OperatorDemoObservation(forged, {
    identity,
    readArtifact,
  });
  assert.equal(validation.valid, false);
  assert(validation.errors.includes('observation:verdict'));
  assert(validation.errors.includes('observation:acceptance-boundary'));
});

await testAsync('approval receipt must bind one committed complete observation and all raw evidence', async () => {
  const observation = await buildM6OperatorDemoObservation(input(), {
    identity,
    readArtifact,
    recordedAt: '2026-08-27T12:10:00.000Z',
  });
  const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const observationPath = `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/observation-${sha256}.json`;
  const gitArtifacts = new Map([
    ...[...artifacts].map(([path, value]) => [path, { bytes: value, executable: false }]),
    [observationPath, { bytes, executable: false }],
  ]);
  const receipt = {
    authorityId: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
    domain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    artifacts: [{
      path: observationPath,
      bytes: bytes.length,
      gitMode: '100644',
      sha256: `sha256:${sha256}`,
    }],
  };
  const readGitArtifact = async path => {
    const artifact = gitArtifacts.get(path);
    if (!artifact) throw new Error('missing git artifact');
    return artifact;
  };
  const valid = await validateM6OperatorDemoReceiptObservation(receipt, {
    candidateSha,
    candidateTree,
    registryFingerprint,
    readGitArtifact,
  });
  assert.equal(valid.valid, true, valid.errors.join('\n'));

  const compactBytes = Buffer.from(JSON.stringify(observation), 'utf8');
  const compactSha256 = createHash('sha256').update(compactBytes).digest('hex');
  const compactPath =
    `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/` +
    `observation-${compactSha256}.json`;
  gitArtifacts.set(compactPath, { bytes: compactBytes, executable: false });
  const noncanonical = structuredClone(receipt);
  noncanonical.artifacts[0] = {
    path: compactPath,
    bytes: compactBytes.length,
    gitMode: '100644',
    sha256: `sha256:${compactSha256}`,
  };
  const noncanonicalResult = await validateM6OperatorDemoReceiptObservation(noncanonical, {
    candidateSha,
    candidateTree,
    registryFingerprint,
    readGitArtifact,
  });
  assert(noncanonicalResult.errors.includes('demo-receipt:observation-canonical'));

  const invalidUtf8Bytes = Buffer.from(bytes);
  invalidUtf8Bytes[invalidUtf8Bytes.indexOf('Synthetic')] = 0xff;
  const invalidUtf8Sha256 = createHash('sha256').update(invalidUtf8Bytes).digest('hex');
  const invalidUtf8Path =
    `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/` +
    `observation-${invalidUtf8Sha256}.json`;
  gitArtifacts.set(invalidUtf8Path, { bytes: invalidUtf8Bytes, executable: false });
  const invalidUtf8 = structuredClone(receipt);
  invalidUtf8.artifacts[0] = {
    path: invalidUtf8Path,
    bytes: invalidUtf8Bytes.length,
    gitMode: '100644',
    sha256: `sha256:${invalidUtf8Sha256}`,
  };
  const invalidUtf8Result = await validateM6OperatorDemoReceiptObservation(invalidUtf8, {
    candidateSha,
    candidateTree,
    registryFingerprint,
    readGitArtifact,
  });
  assert(invalidUtf8Result.errors.includes('demo-receipt:observation-unreadable'));

  const forged = structuredClone(receipt);
  forged.artifacts[0].path = `${observationPath}.forged`;
  assert.equal((await validateM6OperatorDemoReceiptObservation(forged, {
    candidateSha,
    candidateTree,
    registryFingerprint,
    readGitArtifact,
  })).valid, false);

  gitArtifacts.delete(rawPrefix + 'step-0.json');
  assert.equal((await validateM6OperatorDemoReceiptObservation(receipt, {
    candidateSha,
    candidateTree,
    registryFingerprint,
    readGitArtifact,
  })).valid, false);
});

test('runner exposes plan, record and validate only; it has no approval mode', () => {
  const source = readFileSync(
    new URL('../scripts/run-m6-operator-demo.js', import.meta.url),
    'utf8',
  );
  assert(source.includes("argv[0] === '--plan'"));
  assert(source.includes("argv[0] === '--record'"));
  assert(source.includes("argv[0] === '--validate'"));
  assert(!source.includes("argv[0] === '--approve'"));
  assert(!source.includes('M6-OPERATOR-DEMO-RESULT.json'));
  assert(source.includes('assertM6GitMetadataSafe(root)'));
  assert(!source.includes("execFileSync('git'"));
});

summary();
