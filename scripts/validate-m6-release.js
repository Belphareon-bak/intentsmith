#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { config } from '../src/config.js';
import {
  resolveM5ConditionalSurfaces,
} from '../src/release/conditional-surfaces.js';
import {
  validateM6ReleaseEvidence,
  verifyM6ArtifactBindings,
} from '../src/release/m6-release-validation.js';
import {
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';

export const M6_RELEASE_EVIDENCE_PATH =
  '.intentsmith-artifacts/m6/release-evidence.json';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export async function validateCurrentM6Release(root = process.cwd()) {
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  const worktreeClean = git(root, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ]) === '';
  const registry = await loadTestRegistry(root);
  const fingerprint = registryFingerprint(registry);
  const conditional = resolveM5ConditionalSurfaces({ config });
  const evidencePath = path.join(root, M6_RELEASE_EVIDENCE_PATH);
  let evidence;
  try {
    evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: true,
      verdict: 'BLOCKED',
      exitCode: 2,
      errors: Object.freeze([]),
      reasonCode: 'M6_RELEASE_EVIDENCE_NOT_FOUND',
      candidateSha,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  const validation = validateM6ReleaseEvidence(evidence, {
    candidateSha,
    worktreeClean,
    registryFingerprint: fingerprint,
    expectedConditionalJourneys: conditional.requiredM6Journeys,
  });
  const artifactValidation = await verifyM6ArtifactBindings(root, evidence);
  if (!artifactValidation.valid) {
    return Object.freeze({
      ...validation,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze([
        ...validation.errors,
        ...artifactValidation.errors,
      ]),
      candidateSha,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  return Object.freeze({
    ...validation,
    candidateSha,
    registryFingerprint: fingerprint,
    evidencePath: M6_RELEASE_EVIDENCE_PATH,
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) throw new Error('M6 release validation accepts no arguments');
  const result = await validateCurrentM6Release();
  console.log(JSON.stringify(result, null, 2));
  return result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

