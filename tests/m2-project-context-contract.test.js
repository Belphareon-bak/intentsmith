#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  PROJECT_CONTEXT_CONTRACT_VERSION,
  PROJECT_CONTEXT_ERROR_CODE,
  PROJECT_CONTEXT_KIND,
  PROJECT_CONTEXT_NORMALIZATION_VERSION,
  canonicalizeProjectContextValue,
  computeProjectContextSnapshotDigest,
  normalizeProjectContextQuery,
  validateProjectContextContract,
  validateProjectContextQuery,
  validateProjectContextSnapshot,
} from '../contracts/m2/project-context-v1.js';

const revisionA = `wsr1:${'a'.repeat(64)}`;
const revisionB = `wsr1:${'b'.repeat(64)}`;
const contentDigest = `sha256:${'c'.repeat(64)}`;

const query = Object.freeze({
  contract: PROJECT_CONTEXT_KIND.QUERY,
  version: PROJECT_CONTEXT_CONTRACT_VERSION,
  requestId: 'request-context-001',
  projectId: 'project-a',
  canonicalRoot: '/workspace/project-a',
  workspaceRevision: revisionA,
  queryText: '  KDE\u00a0je Pr\u030ci\u0301lis\u030c  definované? KDE  ',
  maxFiles: 5,
  maxBytes: 8192,
  maxTokens: 2048,
});

const normalized = normalizeProjectContextQuery(query.queryText);

function clone(value) {
  return structuredClone(value);
}

function snapshotWithDigest(value) {
  const snapshot = clone(value);
  snapshot.snapshotDigest = computeProjectContextSnapshotDigest(snapshot);
  return snapshot;
}

function item(overrides = {}) {
  const value = {
    path: 'src/example.js',
    startLine: 10,
    endLine: 14,
    content: 'export function příliš() {\n  return true;\n}',
    contentDigest,
    score: 1200,
    provenance: {
      sourceSet: 'ContextSourceSet@1',
      projectId: 'project-a',
      workspaceRevision: revisionA,
      path: 'src/example.js',
      contentDigest,
    },
    ...overrides,
  };
  return value;
}

const found = snapshotWithDigest({
  contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
  version: PROJECT_CONTEXT_CONTRACT_VERSION,
  requestId: query.requestId,
  projectId: query.projectId,
  status: 'ok',
  outcome: 'found',
  workspaceRevision: revisionA,
  normalizationVersion: PROJECT_CONTEXT_NORMALIZATION_VERSION,
  normalizedQuery: normalized.normalizedQuery,
  terms: [...normalized.terms],
  items: [item()],
  budget: {
    maxFiles: 5,
    maxBytes: 8192,
    maxTokens: 2048,
    usedFiles: 1,
    usedBytes: 49,
    usedTokens: 13,
  },
  truncation: { truncated: false },
});

const empty = snapshotWithDigest({
  ...clone(found),
  outcome: 'empty',
  items: [],
  budget: {
    ...found.budget,
    usedFiles: 0,
    usedBytes: 0,
    usedTokens: 0,
  },
  truncation: { truncated: false },
  snapshotDigest: undefined,
});

const stale = Object.freeze({
  contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
  version: PROJECT_CONTEXT_CONTRACT_VERSION,
  requestId: query.requestId,
  projectId: query.projectId,
  status: 'error',
  error: {
    code: PROJECT_CONTEXT_ERROR_CODE.STALE,
    message: 'Workspace changed while context was built.',
    expectedRevision: revisionA,
    observedRevision: revisionB,
  },
});

suite('M2 project-context connector — normalization and canonical form');

test('NFC, Unicode whitespace, lowercasing and first-win terms are pinned', () => {
  assert.equal(normalized.normalizationVersion, 1);
  assert.equal(normalized.normalizedQuery, 'kde je příliš definované? kde');
  assert.deepEqual(normalized.terms, ['kde', 'je', 'příliš', 'definované']);
});

test('NFC and NFD Czech queries produce identical normalized terms', () => {
  const nfc = normalizeProjectContextQuery('Příliš žluťoučký kůň');
  const nfd = normalizeProjectContextQuery(
    'Pr\u030ci\u0301lis\u030c z\u030clut\u030couc\u030cky\u0301 ku\u030an\u030c',
  );
  assert.equal(nfc.normalizedQuery, nfd.normalizedQuery);
  assert.deepEqual(nfc.terms, nfd.terms);
});

test('canonical serialization sorts UTF-8 keys and rejects floats', () => {
  assert.equal(
    canonicalizeProjectContextValue({ z: 1, a: { y: 2, x: 3 } }),
    '{"a":{"x":3,"y":2},"z":1}',
  );
  assert.throws(
    () => canonicalizeProjectContextValue({ score: 0.15 }),
    /non-integer-number/,
  );
});

suite('M2 project-context connector — positive contract');

test('query has registry identity, exact revision and positive budgets', () => {
  const result = validateProjectContextQuery(query);
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(validateProjectContextContract(query).valid, true);
});

test('found and empty are disjoint successful outcomes', () => {
  assert.equal(validateProjectContextSnapshot(found).valid, true);
  assert.equal(validateProjectContextSnapshot(empty).valid, true);
  assert.equal(found.items.length > 0, true);
  assert.equal(empty.items.length, 0);
});

test('snapshot digest excludes requestId but covers revision and ordered items', () => {
  const anotherRequest = { ...found, requestId: 'request-context-002' };
  assert.equal(
    computeProjectContextSnapshotDigest(anotherRequest),
    found.snapshotDigest,
  );

  const changedRevision = clone(found);
  changedRevision.workspaceRevision = revisionB;
  changedRevision.items[0].provenance.workspaceRevision = revisionB;
  assert.notEqual(
    computeProjectContextSnapshotDigest(changedRevision),
    found.snapshotDigest,
  );

  const changedItem = clone(found);
  changedItem.items[0].score += 1;
  assert.notEqual(computeProjectContextSnapshotDigest(changedItem), found.snapshotDigest);
});

test('stale exposes exact expected and observed revisions without items', () => {
  const result = validateProjectContextSnapshot(stale);
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(stale.error.expectedRevision, revisionA);
  assert.equal(stale.error.observedRevision, revisionB);
  assert.equal(Object.hasOwn(stale, 'items'), false);
});

test('timeout and cancellation retain M1 transport terminal vocabulary', () => {
  const timeout = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: query.requestId,
    projectId: query.projectId,
    status: 'timeout',
    error: {
      code: PROJECT_CONTEXT_ERROR_CODE.TIMEOUT,
      message: 'Project context deadline elapsed.',
    },
  };
  const cancelled = {
    ...timeout,
    status: 'cancelled',
    error: {
      code: PROJECT_CONTEXT_ERROR_CODE.CANCELLED,
      message: 'Project context request was cancelled.',
    },
  };
  assert.equal(validateProjectContextSnapshot(timeout).valid, true);
  assert.equal(validateProjectContextSnapshot(cancelled).valid, true);
});

suite('M2 project-context connector — fail-closed negatives');

test('caller-supplied terms and non-canonical roots are rejected', () => {
  const withTerms = { ...query, terms: ['kde'] };
  const badRoot = { ...query, canonicalRoot: '/workspace/project-a/../project-b' };
  assert.equal(validateProjectContextQuery(withTerms).valid, false);
  assert.equal(validateProjectContextQuery(badRoot).valid, false);
});

test('Git SHA, zero budgets and punctuation-only queries are rejected', () => {
  const gitSha = { ...query, workspaceRevision: '44a9ba87' };
  const noBudget = { ...query, maxFiles: 0 };
  const noTerms = { ...query, queryText: ':: !!!' };
  assert.equal(validateProjectContextQuery(gitSha).valid, false);
  assert.equal(validateProjectContextQuery(noBudget).valid, false);
  assert.equal(validateProjectContextQuery(noTerms).valid, false);
});

test('ok with zero items cannot claim found and non-empty cannot claim empty', () => {
  const falseFound = snapshotWithDigest({
    ...clone(found),
    items: [],
    budget: { ...found.budget, usedFiles: 0 },
    snapshotDigest: undefined,
  });
  const falseEmpty = snapshotWithDigest({
    ...clone(found),
    outcome: 'empty',
    snapshotDigest: undefined,
  });
  assert.equal(validateProjectContextSnapshot(falseFound).valid, false);
  assert.equal(validateProjectContextSnapshot(falseEmpty).valid, false);
});

test('empty cannot hide truncation or budget exhaustion', () => {
  const truncatedEmpty = snapshotWithDigest({
    ...clone(empty),
    outcome: 'empty',
    truncation: { truncated: true, reason: 'maxFiles' },
    snapshotDigest: undefined,
  });
  assert.equal(validateProjectContextSnapshot(truncatedEmpty).valid, false);

  const budgetErrorAsEmpty = {
    ...clone(empty),
    error: {
      code: PROJECT_CONTEXT_ERROR_CODE.BUDGET_EXHAUSTED,
      message: 'First match does not fit.',
    },
  };
  assert.equal(validateProjectContextSnapshot(budgetErrorAsEmpty).valid, false);
});

test('foreign provenance, absolute item paths and digest mutation fail closed', () => {
  const foreign = clone(found);
  foreign.items[0].provenance.projectId = 'project-b';
  foreign.snapshotDigest = computeProjectContextSnapshotDigest(foreign);
  assert.equal(validateProjectContextSnapshot(foreign).valid, false);

  const absolute = clone(found);
  absolute.items[0].path = '/workspace/project-a/src/example.js';
  absolute.items[0].provenance.path = absolute.items[0].path;
  absolute.snapshotDigest = computeProjectContextSnapshotDigest(absolute);
  assert.equal(validateProjectContextSnapshot(absolute).valid, false);

  const mutated = clone(found);
  mutated.items[0].content = 'different bytes';
  assert.equal(validateProjectContextSnapshot(mutated).valid, false);
});

test('stale requires distinct complete revisions and never accepts items', () => {
  const sameRevision = clone(stale);
  sameRevision.error.observedRevision = sameRevision.error.expectedRevision;
  assert.equal(validateProjectContextSnapshot(sameRevision).valid, false);

  const staleWithItems = { ...clone(stale), items: [item()] };
  assert.equal(validateProjectContextSnapshot(staleWithItems).valid, false);
});

test('timeout and cancellation codes cannot be smuggled through status error', () => {
  const invalid = {
    contract: PROJECT_CONTEXT_KIND.SNAPSHOT,
    version: PROJECT_CONTEXT_CONTRACT_VERSION,
    requestId: query.requestId,
    projectId: query.projectId,
    status: 'error',
    error: {
      code: PROJECT_CONTEXT_ERROR_CODE.TIMEOUT,
      message: 'Wrong transport branch.',
    },
  };
  assert.equal(validateProjectContextSnapshot(invalid).valid, false);
});

summary();
