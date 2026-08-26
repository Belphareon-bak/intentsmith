import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  M6_RELEASE_ARTIFACT_REQUIRED_FILES,
} from '../contracts/m6/release-artifact-v1.js';
import {
  captureM6ReleaseArtifact,
  validateM6ReleaseArtifact,
} from '../src/release/m6-release-artifact.js';
import { suite, summary, testAsync } from './harness.js';

const candidateSha = 'a'.repeat(40);

async function sourceFixture(root) {
  for (const [index, definition] of M6_RELEASE_ARTIFACT_REQUIRED_FILES.entries()) {
    const target = path.join(root, definition.sourcePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `m6-${definition.role}-${index}\n`);
    await chmod(target, definition.executable ? 0o755 : 0o644);
  }
}

async function capture(root) {
  await sourceFixture(root);
  return await captureM6ReleaseArtifact({
    sourceRoot: root,
    outputRoot: path.join(root, '.intentsmith-artifacts/m6/release'),
    candidateSha,
    sourceTreeClean: true,
    generatedAt: '2026-08-27T00:00:00.000Z',
  });
}

async function testRoot(label) {
  return await mkdtemp(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    `${label}-`,
  ));
}

suite('M6 content-addressed release artifact');

await testAsync('capture copies the exact production build set with private deterministic modes', async () => {
  const root = await testRoot('capture');
  const artifact = await capture(root);
  assert.equal(artifact.files.length, M6_RELEASE_ARTIFACT_REQUIRED_FILES.length);
  assert.equal((await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha,
    sourceTreeClean: true,
  })).valid, true);
  assert.equal(Object.isFrozen(artifact), true);
});

await testAsync('candidate mismatch and dirty source fail closed', async () => {
  const root = await testRoot('candidate');
  const artifact = await capture(root);
  assert.equal((await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha: 'b'.repeat(40),
    sourceTreeClean: true,
  })).valid, false);
  assert.equal((await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha,
    sourceTreeClean: false,
  })).valid, false);
});

await testAsync('tampered bytes, forged digest and wrong disk mode fail closed', async () => {
  const root = await testRoot('tamper');
  const artifact = await capture(root);
  const target = path.join(root, artifact.files[0].artifactPath);
  await writeFile(target, 'tampered\n');
  assert.equal((await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha,
    sourceTreeClean: true,
  })).valid, false);

  const forged = structuredClone(artifact);
  forged.files[1].sha256 = '0'.repeat(64);
  assert.equal((await validateM6ReleaseArtifact(forged, {
    root,
    candidateSha,
    sourceTreeClean: true,
  })).valid, false);

  const executable = artifact.files.find(file => file.role === 'studio-ripgrep');
  await chmod(path.join(root, executable.artifactPath), 0o600);
  assert.equal((await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha,
    sourceTreeClean: true,
  })).valid, false);
});

await testAsync('missing or symlinked build source is rejected before capture', async () => {
  const root = await testRoot('symlink');
  await sourceFixture(root);
  const first = M6_RELEASE_ARTIFACT_REQUIRED_FILES[0];
  const target = path.join(root, first.sourcePath);
  const original = await readFile(target);
  const external = path.join(root, 'external-build-file');
  await writeFile(external, original);
  await unlink(target);
  await symlink(external, target);
  await assert.rejects(
    captureM6ReleaseArtifact({
      sourceRoot: root,
      outputRoot: path.join(root, '.intentsmith-artifacts/m6/release'),
      candidateSha,
      sourceTreeClean: true,
    }),
    /not-nonempty-regular-file/u,
  );
});

summary();
