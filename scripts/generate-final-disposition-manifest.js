#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDiffManifest,
  loadSourceRecords,
} from './final-disposition-manifest.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(
  repoRoot,
  'docs',
  'convergence',
  'FINAL-COMMIT-DIFF-MANIFEST.json',
);

try {
  const options = parseArgs(process.argv.slice(2));
  const sourceRepo = options.get('source-repo');
  if (!sourceRepo) throw new Error('--source-repo=<C3 checkout> is required');
  const manifest = createDiffManifest(loadSourceRecords(path.resolve(sourceRepo)));
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (options.has('write')) {
    writeFileSync(outputPath, serialized, { encoding: 'utf8', mode: 0o644 });
    console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${manifest.recordCount} records)`);
  } else {
    const committed = readFileSync(outputPath, 'utf8');
    if (committed !== serialized) {
      throw new Error('committed manifest differs from the supplied C3 source repository');
    }
    console.log(`Manifest matches C3 source (${manifest.recordCount} records)`);
  }
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--write') {
      options.set('write', true);
      continue;
    }
    if (arg.startsWith('--source-repo=')) {
      options.set('source-repo', arg.slice('--source-repo='.length));
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}
