#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  validateCurrentM6Release,
} from './validate-m6-release.js';

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length > 0) {
    throw new Error('M6 acceptance promotion accepts no arguments');
  }
  const result = await validateCurrentM6Release(root);
  if (result.verdict !== 'PASS' || result.valid !== true) {
    throw new Error(
      `M6 Git-native acceptance is not promotable: ${result.verdict}; ${result.errors.join('; ')}`,
    );
  }
  console.log(JSON.stringify({
    candidateSha: result.candidateSha,
    evidenceHeadSha: result.evidenceHeadSha,
    validatedReceipts: result.acceptanceReceiptsFound,
    verdict: result.verdict,
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
