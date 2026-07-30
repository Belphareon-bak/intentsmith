#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  TEST_REGISTRY_DOC_PATH,
  loadTestRegistry,
  registryFingerprint,
  renderTestRegistry,
} from './test-registry.js';

const root = process.cwd();
const writeDoc = process.argv.slice(2).includes('--write-doc');

try {
  const registry = await loadTestRegistry(root);
  const rendered = renderTestRegistry(registry);
  const docPath = path.join(root, TEST_REGISTRY_DOC_PATH);

  if (writeDoc) {
    await writeFile(docPath, rendered, { encoding: 'utf8', mode: 0o644 });
  } else {
    const { readFile } = await import('node:fs/promises');
    const current = await readFile(docPath, 'utf8');
    if (current !== rendered) {
      throw new Error(
        `${TEST_REGISTRY_DOC_PATH} is stale; run ` +
        '`node scripts/validate-test-registry.js --write-doc`',
      );
    }
  }

  console.log(
    `Test registry valid: ${registry.suites.length} runnable programs, ` +
    `sha256 ${registryFingerprint(registry)}`,
  );
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
