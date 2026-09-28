#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  captureM6ReleaseArtifact,
  validateM6ReleaseArtifact,
} from '../src/release/m6-release-artifact.js';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length > 0) {
    throw new Error('M6 release artifact capture uses a locked plan and accepts no arguments');
  }
  const candidateSha = git(root, ['rev-parse', 'HEAD']);
  const clean = git(root, ['status', '--porcelain=v1', '--untracked-files=all']) === '';
  const releaseRoot = path.join(
    root,
    '.intentsmith-artifacts',
    'm6',
    `candidate-${candidateSha}`,
    'release',
  );
  await mkdir(path.dirname(releaseRoot), { recursive: true, mode: 0o700 });
  try {
    await lstat(releaseRoot);
    throw new Error('Refusing to overwrite existing M6 release artifact evidence');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const artifact = await captureM6ReleaseArtifact({
    sourceRoot: root,
    outputRoot: releaseRoot,
    candidateSha,
    sourceTreeClean: clean,
  });
  const validation = await validateM6ReleaseArtifact(artifact, {
    root,
    candidateSha,
    sourceTreeClean: clean,
  });
  if (!validation.valid) {
    throw new Error(`M6 release artifact validation failed: ${validation.errors.join('; ')}`);
  }
  const manifestPath = path.join(releaseRoot, 'manifest.json');
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, manifestPath);
  await chmod(manifestPath, 0o600);
  console.log(JSON.stringify({
    candidateSha,
    manifestPath: path.relative(root, manifestPath).split(path.sep).join('/'),
    files: artifact.files.length,
    verdict: 'PASS',
  }, null, 2));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
