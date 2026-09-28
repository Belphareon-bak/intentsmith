#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
  M6_OPERATOR_DEMO_PLAN_V1,
} from '../contracts/m6/operator-demo-v1.js';
import {
  buildM6OperatorDemoObservation,
  parseM6OperatorDemoObservationBytes,
  validateM6OperatorDemoObservation,
} from '../src/release/m6-operator-demo.js';
import {
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';
import {
  assertM6GitMetadataSafe,
  gitText,
} from './m6-git-evidence.js';

function git(root, args) {
  return gitText(root, args);
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !value.includes('\0')
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

async function readContainedFile(root, relativePath, requiredPrefix) {
  if (!safeRelativePath(relativePath) || !relativePath.startsWith(requiredPrefix)) {
    throw new Error(`m6-operator-demo:unsafe-artifact-path:${relativePath}`);
  }
  const rootReal = await realpath(root);
  const target = path.join(root, relativePath);
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error(`m6-operator-demo:not-regular-artifact:${relativePath}`);
  }
  const targetReal = await realpath(target);
  const containment = path.relative(rootReal, targetReal);
  if (containment === '' || containment === '..' || containment.startsWith(`..${path.sep}`)) {
    throw new Error(`m6-operator-demo:artifact-outside-root:${relativePath}`);
  }
  return readFile(targetReal);
}

async function currentIdentity(root) {
  assertM6GitMetadataSafe(root);
  const registry = await loadTestRegistry(root);
  const gitDirectory = await realpath(git(root, ['rev-parse', '--path-format=absolute', '--git-dir']));
  const commonDirectory = await realpath(
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  );
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  const evidencePrefix = `docs/execution/runs/m6/operator-demo/candidate-${candidateSha}/`;
  const changedPaths = [
    ...git(root, ['diff', '--name-only', 'HEAD']).split('\n'),
    ...git(root, ['diff', '--cached', '--name-only', 'HEAD']).split('\n'),
    ...git(root, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter(Boolean).map(normalize);
  return {
    candidateSha,
    candidateTree: git(root, ['rev-parse', 'HEAD^{tree}']),
    registryFingerprint: registryFingerprint(registry),
    sourceTreeClean: changedPaths.every(changedPath => changedPath.startsWith(evidencePrefix)),
    standaloneCheckout: gitDirectory === commonDirectory,
  };
}

function parseMode(argv) {
  if (argv.length === 1 && argv[0] === '--plan') return { mode: 'plan' };
  if (argv.length === 2 && argv[0] === '--record') return { mode: 'record', path: argv[1] };
  if (argv.length === 2 && argv[0] === '--validate') return { mode: 'validate', path: argv[1] };
  throw new Error(
    'Usage: node scripts/run-m6-operator-demo.js --plan | --record <input.json> | --validate <observation.json>',
  );
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const request = parseMode(argv);
  if (request.mode === 'plan') {
    console.log(JSON.stringify({
      plan: M6_OPERATOR_DEMO_PLAN_V1,
      planDigest: M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
      outcome: 'PLAN_ONLY_NOT_DEMO',
    }, null, 2));
    return 0;
  }

  const identity = await currentIdentity(root);
  const rawPrefix = `docs/execution/runs/m6/operator-demo/candidate-${identity.candidateSha}/raw/`;
  const readArtifact = relativePath => readContainedFile(root, relativePath, rawPrefix);
  if (!safeRelativePath(request.path)) throw new Error('m6-operator-demo:unsafe-input-path');

  if (request.mode === 'validate') {
    const observation = parseM6OperatorDemoObservationBytes(
      await readFile(path.join(root, request.path)),
    );
    const validation = await validateM6OperatorDemoObservation(observation, {
      identity,
      readArtifact,
    });
    console.log(JSON.stringify({
      candidateSha: identity.candidateSha,
      observationPath: request.path,
      valid: validation.valid,
      verdict: observation.verdict ?? null,
      errors: validation.errors,
      acceptanceReceiptStatus: observation.acceptance?.status ?? null,
    }, null, 2));
    return validation.valid ? 0 : 1;
  }

  const input = JSON.parse(await readFile(path.join(root, request.path), 'utf8'));
  const observation = await buildM6OperatorDemoObservation(input, {
    identity,
    readArtifact,
  });
  const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const outputDirectory = path.join(
    root,
    `docs/execution/runs/m6/operator-demo/candidate-${identity.candidateSha}`,
  );
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(outputDirectory, `observation-${sha256}.json`);
  await writeFile(outputPath, bytes, { encoding: null, flag: 'wx', mode: 0o600 });
  const persisted = parseM6OperatorDemoObservationBytes(await readFile(outputPath));
  const validation = await validateM6OperatorDemoObservation(persisted, {
    identity,
    readArtifact,
  });
  if (!validation.valid) {
    throw new Error(`m6-operator-demo:persisted-observation-invalid:${validation.errors.join(';')}`);
  }
  console.log(JSON.stringify({
    candidateSha: identity.candidateSha,
    candidateTree: identity.candidateTree,
    registryFingerprint: identity.registryFingerprint,
    observationPath: normalize(path.relative(root, outputPath)),
    observationSha256: sha256,
    verdict: observation.verdict,
    acceptanceReceiptStatus: observation.acceptance.status,
  }, null, 2));
  return observation.verdict === 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL' ? 2 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
