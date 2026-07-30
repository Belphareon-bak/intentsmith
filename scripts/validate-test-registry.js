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
const args = process.argv.slice(2);
const writeDoc = args.includes('--write-doc');
const json = args.includes('--json');
let registry = null;

try {
  const unsupported = args.filter(arg => !['--write-doc', '--json'].includes(arg));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported argument(s): ${unsupported.join(', ')}`);
  }
  if (writeDoc && json) {
    throw new Error('--write-doc and --json cannot be combined');
  }

  registry = await loadTestRegistry(root);
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

  const report = buildReport(registry, []);
  if (json) console.log(JSON.stringify(report));
  else {
    console.log(
      `Test registry valid: ${registry.suites.length} runnable programs, ` +
      `sha256 ${report.fingerprint}`,
    );
  }
} catch (error) {
  if (json) {
    console.log(JSON.stringify(buildReport(registry, [error.message || String(error)])));
  } else {
    console.error(error.stack || error.message);
  }
  process.exitCode = 1;
}

function buildReport(registryValue, errors) {
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    runnablePrograms: registryValue?.suites?.length ?? null,
    explicitSupportExclusions: registryValue?.exclusions?.length ?? null,
    fingerprint: registryValue ? registryFingerprint(registryValue) : null,
    document: {
      path: TEST_REGISTRY_DOC_PATH,
      mode: writeDoc ? 'write' : 'check',
    },
    errors,
  };
}
