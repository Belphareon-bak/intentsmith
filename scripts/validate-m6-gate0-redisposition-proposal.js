#!/usr/bin/env node

// A read-only consistency check for the M6 re-disposition proposal. This does
// not replace the sealed Gate 0 validator or produce a release PASS.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildValidationReport,
  parseDispositionRows,
} from './validate-final-disposition.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proposalPath = 'docs/review/evidence/2026-10-01-m6-gate0-redisposition-proposal-v1.json';
const sourcePath = 'docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json';
const ledgerPath = 'docs/convergence/FINAL-COMMIT-DISPOSITION.md';
const subjectPath = 'docs/convergence/FINAL-COMMIT-DISPOSITION-SUBJECTS.json';
const historicalCandidate = 'da485841c7016887c9bd4f969271e0d365020b2f';
const observedCandidate = '77672c2ce1bb503483f72ab559b17e1a2b46c714';
const sourceDigest = 'aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e';
const subjectDigest = '1dd6edffedfa902e7396fe20151002a15ddd8fbc3b64670103d3da5792300ed5';
const absentProposal = new Map([
  [97, { disposition: 'KEEP', action: 'REPLAY', currentPath: 'src/executor/execution-loop.js' }],
  [116, { disposition: 'EXCLUDE', action: 'REMOVE_FOLLOWUP', currentPath: null }],
  [179, { disposition: 'EXCLUDE', action: 'REMOVE_FOLLOWUP', currentPath: null }],
  [222, { disposition: 'EXCLUDE', action: 'REMOVE_FOLLOWUP', currentPath: null }],
]);

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function treeObject(revision, relativePath) {
  if (!relativePath) return null;
  const output = git('ls-tree', revision, '--', relativePath);
  if (!output) return null;
  const match = output.match(/^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/);
  if (!match || match[3] !== relativePath) return null;
  return { mode: match[1], blob: match[2] };
}

function workingObject(relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (path.relative(root, absolute).startsWith('..')) throw new Error('unsafe path');
  const info = lstatSync(absolute);
  const data = info.isSymbolicLink()
    ? Buffer.from(readlinkSync(absolute))
    : readFileSync(absolute);
  const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  const mode = info.isSymbolicLink() ? '120000' : info.mode & 0o111 ? '100755' : '100644';
  return { blob, mode };
}

function sameObject(left, right) {
  return left?.blob === right?.blob && left?.mode === right?.mode;
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

export function validateProposal(proposal, { report, source, subjects, head }) {
  const errors = [];
  const expectedTop = [
    'schemaVersion', 'manifestType', 'status', 'historicalCandidateCommit',
    'observedCandidateCommit', 'sourceManifestRecordsSha256',
    'historicalSubjectRecordsSha256', 'legacyErrors', 'recordCount', 'records',
  ].sort();
  assert(JSON.stringify(Object.keys(proposal).sort()) === JSON.stringify(expectedTop), 'proposal fields differ from v1 schema', errors);
  assert(proposal.schemaVersion === 1, 'proposal schemaVersion must be 1', errors);
  assert(proposal.manifestType === 'intentsmith.m6-gate0-redisposition-proposal', 'proposal type is invalid', errors);
  assert(proposal.status === 'DRAFT_REVIEW_REQUIRED', 'proposal must remain DRAFT_REVIEW_REQUIRED', errors);
  assert(proposal.historicalCandidateCommit === historicalCandidate, 'historical candidate SHA is invalid', errors);
  assert(proposal.observedCandidateCommit === observedCandidate, 'observed candidate SHA is invalid', errors);
  assert(source.recordsSha256 === sourceDigest && proposal.sourceManifestRecordsSha256 === sourceDigest, 'sealed source manifest digest changed', errors);
  assert(subjects.recordsSha256 === subjectDigest && proposal.historicalSubjectRecordsSha256 === subjectDigest, 'sealed subject digest changed', errors);
  assert(Array.isArray(report.errors) && report.errors.length === 31, 'legacy Gate 0 error count differs from 31', errors);
  assert(JSON.stringify(report.errors) === JSON.stringify(proposal.legacyErrors), 'legacy error list differs from proposal', errors);
  assert(Array.isArray(report.paths) && report.paths.length === 225, 'historical source record count differs from 225', errors);
  assert(Array.isArray(proposal.records) && proposal.records.length === 28 && proposal.recordCount === 28, 'proposal must cover 28 distinct drifted records', errors);

  const historicalBySequence = new Map(subjects.records.map(item => [item.sourceSequence, item]));
  const drifted = report.paths.filter(item => {
    const old = historicalBySequence.get(item.sourceSequence);
    return item.resolution === 'MISSING' || (old && (
      old.candidatePath !== item.candidatePath
      || old.candidateBlob !== item.candidateBlob
      || old.candidateMode !== item.candidateMode
    ));
  });
  const expectedSequences = drifted.map(item => item.sourceSequence).sort((a, b) => a - b);
  const actualSequences = proposal.records.map(item => item.sourceSequence);
  assert(JSON.stringify(actualSequences) === JSON.stringify(expectedSequences), 'proposal does not cover precisely the current drifted records in source order', errors);

  const proposedCounts = { EXCLUDE: 0, KEEP: 0, REBUILD: 0 };
  for (const item of report.paths) {
    const override = absentProposal.get(item.sourceSequence);
    const disposition = override?.disposition ?? item.disposition;
    proposedCounts[disposition] += 1;
  }
  assert(JSON.stringify(proposedCounts) === JSON.stringify({ EXCLUDE: 94, KEEP: 40, REBUILD: 91 }), 'proposed disposition counts are invalid', errors);

  for (const record of proposal.records || []) {
    const label = `record ${record.sourceSequence}`;
    const item = report.paths.find(value => value.sourceSequence === record.sourceSequence);
    if (!item) { errors.push(`${label}: missing from source report`); continue; }
    const old = historicalBySequence.get(record.sourceSequence);
    const fallback = treeObject(historicalCandidate, item.candidatePath);
    const historicalPath = old?.candidatePath ?? item.candidatePath;
    const historicalBlob = old?.candidateBlob ?? fallback?.blob ?? null;
    const historicalMode = old?.candidateMode ?? fallback?.mode ?? null;
    const override = absentProposal.get(record.sourceSequence);
    const proposedDisposition = override?.disposition ?? item.disposition;
    const proposedAction = override?.action ?? item.action;
    const currentPath = override ? override.currentPath : item.candidatePath;
    const requiredKeys = [
      'sourceSequence', 'displayPath', 'historicalDisposition', 'historicalAction',
      'proposedDisposition', 'proposedAction', 'historicalPath', 'historicalBlob',
      'historicalMode', 'currentPath', 'currentBlob', 'currentMode',
      'relatedPath', 'relatedBlob', 'relatedMode', 'lineageCommit',
      'semanticClass', 'reviewState',
    ].sort();
    assert(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(requiredKeys), `${label}: fields differ from v1 schema`, errors);
    assert(record.displayPath === item.displayPath, `${label}: display path changed`, errors);
    assert(record.historicalDisposition === item.disposition && record.historicalAction === item.action, `${label}: historical classification changed`, errors);
    assert(record.proposedDisposition === proposedDisposition && record.proposedAction === proposedAction, `${label}: proposed classification changed`, errors);
    assert(record.historicalPath === historicalPath && record.historicalBlob === historicalBlob && record.historicalMode === historicalMode, `${label}: historical subject identity changed`, errors);
    assert(record.currentPath === currentPath, `${label}: current path differs from disposition`, errors);
    assert(record.reviewState === 'SEMANTIC_REVIEW_REQUIRED', `${label}: review state must remain open`, errors);
    assert(/^[A-Z_]+$/.test(record.semanticClass), `${label}: semantic class is invalid`, errors);
    assert(/^[a-f0-9]{40}$/.test(record.lineageCommit) && git('merge-base', '--is-ancestor', record.lineageCommit, head) === '', `${label}: lineage commit is not an ancestor`, errors);
    if (currentPath) {
      const current = treeObject(head, currentPath);
      assert(current && sameObject(current, workingObject(currentPath)), `${label}: current path differs from tracked HEAD`, errors);
      assert(record.currentBlob === current?.blob && record.currentMode === current?.mode, `${label}: current subject identity changed`, errors);
    } else {
      assert(record.currentBlob === null && record.currentMode === null, `${label}: retired subject must have null identity`, errors);
      assert(!treeObject(head, historicalPath), `${label}: retired historical path is still tracked`, errors);
    }
    if (record.relatedPath) {
      const related = treeObject(head, record.relatedPath);
      assert(related && sameObject(related, workingObject(record.relatedPath)), `${label}: related path differs from tracked HEAD`, errors);
      assert(record.relatedBlob === related?.blob && record.relatedMode === related?.mode, `${label}: related subject identity changed`, errors);
    } else {
      assert(record.relatedBlob === null && record.relatedMode === null, `${label}: related identity must be null`, errors);
    }
  }

  return { validSnapshot: errors.length === 0, gate0Status: 'BLOCKED', reviewState: 'SEMANTIC_REVIEW_REQUIRED', sourceRecords: 225, affectedRecords: 28, legacyErrors: report.errors.length, proposedDispositionCounts: proposedCounts, errors };
}

function main() {
  const source = readJson(sourcePath);
  const subjects = readJson(subjectPath);
  const dispositionMarkdown = readFileSync(path.join(root, ledgerPath), 'utf8');
  const report = buildValidationReport({
    manifest: source,
    dispositionRows: parseDispositionRows(dispositionMarkdown),
    dispositionMarkdown,
    repairedSubjectManifest: subjects,
    candidateRoot: root,
  });
  const proposal = readJson(proposalPath);
  const head = git('rev-parse', 'HEAD');
  const result = validateProposal(proposal, { report, source, subjects, head });
  const trackedProposal = treeObject(head, proposalPath);
  if (!trackedProposal || !sameObject(trackedProposal, workingObject(proposalPath))) {
    result.errors.push('proposal file differs from tracked HEAD');
    result.validSnapshot = false;
  }
  const observedAncestor = execFileSync('git', ['merge-base', '--is-ancestor', observedCandidate, head], { cwd: root, stdio: 'ignore' });
  void observedAncestor;
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  else console.log(`M6 Gate 0 proposal snapshot: ${result.validSnapshot ? 'CONSISTENT' : 'INVALID'}; legacy Gate 0 BLOCKED (${result.legacyErrors} errors); semantic review required for ${result.affectedRecords} records.`);
  if (!result.validSnapshot) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  try { main(); } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
