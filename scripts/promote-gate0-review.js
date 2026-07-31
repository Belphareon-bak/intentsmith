#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  GATE0_ATTESTATION_OUTPUTS,
  GATE0_BOUND_OUTPUTS,
  GATE0_EVIDENCE_INDEX_PATH,
} from './gate0-attestation-paths.js';
import {
  buildApprovedGate0Promotion,
} from './gate0-promotion-contract.js';
import {
  GATE0_REVIEW_RESULT_PATH,
} from './gate0-review-contract.js';
import {
  runWithGate0OutputRollback,
  writeGate0OutputAtomic,
} from './generate-gate0-evidence.js';
import {
  loadGate0ReviewResultCommit,
  validateCommittedGate0PendingAttestation,
} from './validate-gate0-attestation.js';

const root = process.cwd();

export async function main(argv = process.argv.slice(2)) {
  try {
    return await runWithGate0OutputRollback({
      repositoryRoot: root,
      outputPaths: GATE0_ATTESTATION_OUTPUTS,
      operation: async ({ armRollback }) => {
        if (argv.length > 0) {
          throw new Error(
            'Gate 0 review promotion accepts no arguments',
          );
        }
        await requireCanonicalRepositoryRoot(root);
        requirePromotion(
          git(['status', '--porcelain=v1', '--untracked-files=all'], root) === '',
          'review promotion requires a clean review-result worktree',
        );

        const reviewResultCommit = loadGate0ReviewResultCommit(root, 'HEAD');
        const reviewBoundaryErrors =
          validateReviewResultCommitBoundary(reviewResultCommit);
        requirePromotion(
          reviewBoundaryErrors.length === 0,
          reviewBoundaryErrors.join('; '),
        );
        const pendingAttestationSha = reviewResultCommit.parentShas[0];
        const pending = await validateCommittedGate0PendingAttestation({
          root,
          pendingAttestationSha,
          worktreeHeadSha: reviewResultCommit.headSha,
        });
        requirePromotion(
          pending.report.valid && pending.expectations !== null,
          `pending attestation is invalid: ${pending.report.errors.join('; ')}`,
        );

        const promotion = buildApprovedGate0Promotion({
          pendingAttestationSha,
          reviewResultSha: reviewResultCommit.headSha,
          pendingIndex: pending.pendingAttestation.evidenceIndex,
          pendingArtifacts: pending.pendingAttestation.outputArtifacts,
          reviewResultBytes: reviewResultCommit.resultBytes,
        });
        requirePromotion(
          promotion.valid,
          `approved evidence payload is invalid: ${promotion.errors.join('; ')}`,
        );
        requirePromotion(
          git(['rev-parse', 'HEAD'], root) === reviewResultCommit.headSha
            && git(
              ['status', '--porcelain=v1', '--untracked-files=all'],
              root,
            ) === '',
          'review-result identity or worktree changed before promotion output',
        );

        await armRollback();
        await writeGate0PromotionFiles({
          repositoryRoot: root,
          evidenceIndex: promotion.evidenceIndex,
          outputArtifacts: promotion.outputArtifacts,
        });

        const expectedStatus = [...GATE0_ATTESTATION_OUTPUTS]
          .sort()
          .map(filePath => ` M ${filePath}`)
          .join('\n');
        requirePromotion(
          git(['rev-parse', 'HEAD'], root) === reviewResultCommit.headSha,
          'review-result HEAD changed while promotion output was written',
        );
        requirePromotion(
          git(['diff', '--cached', '--name-only'], root) === '',
          'review promotion must not stage output files',
        );
        requirePromotion(
          git(
            ['status', '--porcelain=v1', '--untracked-files=all'],
            root,
          ) === expectedStatus,
          'review promotion must leave exactly four tracked modified outputs',
        );

        console.log(
          `Gate 0 approved evidence prepared from ${pendingAttestationSha}`,
        );
        console.log(`Review result commit: ${reviewResultCommit.headSha}`);
        console.log('Verdict: PASS');
        for (const output of GATE0_ATTESTATION_OUTPUTS) {
          console.log(`Wrote: ${output}`);
        }
        console.log(
          'Commit exactly these four files, then run '
          + 'npm run gate0:validate-attestation',
        );
        return 0;
      },
    });
  } catch (error) {
    console.error(error.stack || error.message);
    return 2;
  }
}

export async function writeGate0PromotionFiles({
  repositoryRoot,
  evidenceIndex,
  outputArtifacts,
  writeOutput = writeGate0OutputAtomic,
}) {
  requirePromotion(
    evidenceIndex?.schemaVersion === 8
      && evidenceIndex?.verdict === 'PASS'
      && evidenceIndex?.exitCode === 0,
    'promotion index must be schema 8 PASS/0',
  );
  requirePromotion(
    JSON.stringify(Object.keys(outputArtifacts || {}).sort())
      === JSON.stringify([...GATE0_BOUND_OUTPUTS].sort()),
    'promotion payload must contain exactly three Markdown outputs',
  );
  const contentsByPath = {
    [GATE0_EVIDENCE_INDEX_PATH]:
      `${JSON.stringify(evidenceIndex, null, 2)}\n`,
    ...outputArtifacts,
  };
  for (const filePath of GATE0_ATTESTATION_OUTPUTS) {
    await writeOutput(
      path.join(repositoryRoot, filePath),
      contentsByPath[filePath],
    );
  }
}

export function validateReviewResultCommitBoundary(reviewResultCommit) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(reviewResultCommit?.headSha || '')) {
    errors.push('review-result HEAD must be a full lowercase SHA-1');
  }
  if (
    !Array.isArray(reviewResultCommit?.parentShas)
    || reviewResultCommit.parentShas.length !== 1
    || !/^[a-f0-9]{40}$/.test(reviewResultCommit.parentShas[0] || '')
    || reviewResultCommit.parentShas[0] === reviewResultCommit.headSha
  ) {
    errors.push('review-result commit must have exactly one distinct parent');
  }
  if (
    JSON.stringify(
      Array.isArray(reviewResultCommit?.changedEntries)
        ? [...reviewResultCommit.changedEntries].sort()
        : [],
    ) !== JSON.stringify([`A\t${GATE0_REVIEW_RESULT_PATH}`])
  ) {
    errors.push('review-result commit must add exactly the locked result file');
  }
  if (reviewResultCommit?.resultMode !== '100644') {
    errors.push('review-result file must have Git mode 100644');
  }
  if (
    !Buffer.isBuffer(reviewResultCommit?.resultBytes)
    || reviewResultCommit.resultBytes.length < 1
  ) {
    errors.push('review-result blob is missing');
  }
  return errors;
}

async function requireCanonicalRepositoryRoot(requestedRoot) {
  const [requestedReal, discoveredReal] = await Promise.all([
    realpath(requestedRoot),
    realpath(git(['rev-parse', '--show-toplevel'], requestedRoot)),
  ]);
  requirePromotion(
    requestedRoot === requestedReal && requestedReal === discoveredReal,
    'review promotion must run from the canonical Git worktree root',
  );
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function requirePromotion(condition, message) {
  if (!condition) {
    throw new Error(`Gate 0 review promotion failed: ${message}`);
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
