#!/usr/bin/env node

import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  M6_ACCEPTANCE_RECEIPT_PATHS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  applyM6AcceptanceReceipts,
} from '../src/release/m6-acceptance-authority.js';
import {
  verifyM6ArtifactBindings,
} from '../src/release/m6-release-validation.js';
import {
  M6_RELEASE_EVIDENCE_PATH,
} from './validate-m6-release.js';

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length > 0) {
    throw new Error('M6 acceptance promotion accepts no arguments');
  }
  const evidencePath = path.join(root, M6_RELEASE_EVIDENCE_PATH);
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  const receipts = [];
  for (const receiptPath of Object.values(M6_ACCEPTANCE_RECEIPT_PATHS)) {
    try {
      receipts.push(JSON.parse(await readFile(path.join(root, receiptPath), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (receipts.length === 0) throw new Error('No operator-provided M6 receipts found');
  const promotion = applyM6AcceptanceReceipts(evidence, receipts);
  if (!promotion.valid) {
    throw new Error(`M6 acceptance receipts invalid: ${promotion.errors.join('; ')}`);
  }
  const artifactValidation = await verifyM6ArtifactBindings(root, {
    checks: receipts.map(receipt => ({ artifacts: receipt.artifacts })),
    l0: [],
    conditionalJourneys: [],
  });
  if (!artifactValidation.valid) {
    throw new Error(`M6 acceptance artifacts invalid: ${artifactValidation.errors.join('; ')}`);
  }
  const temporary = `${evidencePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(promotion.evidence, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, evidencePath);
  await chmod(evidencePath, 0o600);
  console.log(JSON.stringify({
    candidateSha: promotion.evidence.candidateSha,
    promoted: receipts.map(receipt => receipt.authorityId).sort(),
    remaining: promotion.evidence.checks
      .filter(row => row.status !== 'PASS')
      .map(row => row.id),
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

