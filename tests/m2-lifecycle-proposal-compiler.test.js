#!/usr/bin/env node

import assert from 'node:assert/strict';

import { suite, test, summary } from './harness.js';
import {
  M2ProposalCompilerError,
  M2ProposalCompilerErrorCode,
  compileM2ProjectChangeProposal,
  validateM2ProjectChangeProposal,
} from '../src/lifecycle/m2-proposal-compiler.js';

function proposal(overrides = {}) {
  return {
    intent: 'Update the exact project files and run one focused test.',
    changes: [
      { path: 'src/z-last.js', afterContent: 'export const last = true;\n' },
      { path: 'src/a-first.js', afterContent: 'export const first = true;\n' },
    ],
    focusedTest: {
      binary: '/usr/bin/node',
      argv: ['--test', 'tests/focused.test.js'],
      environment: { NODE_ENV: 'test', LANG: 'C.UTF-8' },
      timeoutMs: 120_000,
    },
    gitCommit: {
      message: 'M2 exact lifecycle change',
      identity: {
        authorName: 'IntentSmith Runtime',
        authorEmail: 'runtime@example.invalid',
        authorDate: '2026-08-24T09:00:00.000Z',
        committerName: 'IntentSmith Runtime',
        committerEmail: 'runtime@example.invalid',
        committerDate: '2026-08-24T09:00:00.000Z',
      },
    },
    ...overrides,
  };
}

function capture(value) {
  try {
    compileM2ProjectChangeProposal(value);
  } catch (error) {
    return error;
  }
  assert.fail('expected proposal compilation to fail');
}

suite('M2 lifecycle strict proposal compiler — canonical output');

test('compiles exact proposal into sorted immutable planner input', () => {
  const input = proposal();
  const compiled = compileM2ProjectChangeProposal(input);
  assert.equal(validateM2ProjectChangeProposal(input).valid, true);
  assert.deepEqual(compiled.changes.map(change => change.path), [
    'src/a-first.js',
    'src/z-last.js',
  ]);
  assert.deepEqual(Object.keys(compiled.focusedTest.environment), ['LANG', 'NODE_ENV']);
  assert.equal(compiled.gitCommit.identity.authorEmail, 'runtime@example.invalid');
  assert.equal(Object.isFrozen(compiled), true);
  assert.equal(Object.isFrozen(compiled.changes), true);
  assert.equal(Object.isFrozen(compiled.changes[0]), true);
  assert.equal(Object.isFrozen(compiled.focusedTest.argv), true);
  assert.equal(Object.isFrozen(compiled.focusedTest.environment), true);
  assert.equal(Object.isFrozen(compiled.gitCommit.identity), true);
  assert.deepEqual(input.changes.map(change => change.path), ['src/z-last.js', 'src/a-first.js']);
});

test('Git commit is explicitly optional and canonicalizes to null', () => {
  const input = proposal();
  delete input.gitCommit;
  assert.equal(compileM2ProjectChangeProposal(input).gitCommit, null);
  assert.equal(compileM2ProjectChangeProposal(proposal({ gitCommit: null })).gitCommit, null);
});

test('empty UTF-8 file content and empty argv/environment values remain exact', () => {
  const input = proposal({
    changes: [{ path: 'src/empty.js', afterContent: '' }],
    focusedTest: {
      binary: '/usr/bin/node',
      argv: ['', '--version'],
      environment: { OPTIONAL: '' },
      timeoutMs: 1,
    },
    gitCommit: null,
  });
  const compiled = compileM2ProjectChangeProposal(input);
  assert.equal(compiled.changes[0].afterContent, '');
  assert.deepEqual(compiled.focusedTest.argv, ['', '--version']);
  assert.deepEqual(compiled.focusedTest.environment, { OPTIONAL: '' });
});

suite('M2 lifecycle strict proposal compiler — fail closed');

test('raw model text and JSON strings are never parsed or tolerated', () => {
  for (const value of ['```json\n{}\n```', JSON.stringify(proposal()), null, []]) {
    const error = capture(value);
    assert(error instanceof M2ProposalCompilerError);
    assert.equal(error.code, M2ProposalCompilerErrorCode.INPUT_NOT_OBJECT);
  }
});

test('unknown top-level and nested fields fail with typed exact-key errors', () => {
  const top = capture({ ...proposal(), explanation: 'trust me' });
  assert.equal(top.code, M2ProposalCompilerErrorCode.PROPOSAL_KEYS_INVALID);
  assert(top.details.errors.includes('m2-proposal:unknown-explanation'));

  const nestedInput = proposal();
  nestedInput.changes[0].mode = 0o644;
  const nested = capture(nestedInput);
  assert.equal(nested.code, M2ProposalCompilerErrorCode.CHANGE_KEYS_INVALID);
  assert(nested.details.errors.includes('m2-proposal.changes[0]:unknown-mode'));

  const focusedInput = proposal();
  focusedInput.focusedTest.shell = true;
  assert.equal(
    capture(focusedInput).code,
    M2ProposalCompilerErrorCode.FOCUSED_TEST_KEYS_INVALID,
  );
});

test('missing, null, or incomplete focused test fails before planning', () => {
  const missing = proposal();
  delete missing.focusedTest;
  assert.equal(capture(missing).code, M2ProposalCompilerErrorCode.FOCUSED_TEST_MISSING);
  assert.equal(capture(proposal({ focusedTest: null })).code, M2ProposalCompilerErrorCode.FOCUSED_TEST_MISSING);
  assert.equal(
    capture(proposal({ focusedTest: { binary: '/usr/bin/node' } })).code,
    M2ProposalCompilerErrorCode.FOCUSED_TEST_KEYS_INVALID,
  );
});

test('absolute, traversal, normalized traversal, backslash, NUL and directory paths fail typed', () => {
  const invalidPaths = [
    '/tmp/out.js',
    '../out.js',
    'src/../out.js',
    'src\\out.js',
    'src/evil\0.js',
    'src/directory/',
    './src/app.js',
    '',
  ];
  for (const candidate of invalidPaths) {
    const error = capture(proposal({
      changes: [{ path: candidate, afterContent: 'safe\n' }],
    }));
    assert.equal(error.code, M2ProposalCompilerErrorCode.CHANGE_PATH_INVALID, candidate);
  }
});

test('duplicate exact path is rejected instead of silently last-write-wins', () => {
  const error = capture(proposal({
    changes: [
      { path: 'src/app.js', afterContent: 'first\n' },
      { path: 'src/app.js', afterContent: 'second\n' },
    ],
  }));
  assert.equal(error.code, M2ProposalCompilerErrorCode.CHANGE_PATH_DUPLICATE);
});

test('non-NFC and non-UTF-8-roundtrippable content is rejected, not normalized', () => {
  const decomposed = capture(proposal({
    changes: [{ path: 'src/app.js', afterContent: 'e\u0301' }],
  }));
  assert.equal(decomposed.code, M2ProposalCompilerErrorCode.CHANGE_CONTENT_INVALID);

  const loneSurrogate = capture(proposal({
    changes: [{ path: 'src/app.js', afterContent: '\ud800' }],
  }));
  assert.equal(loneSurrogate.code, M2ProposalCompilerErrorCode.CHANGE_CONTENT_INVALID);
});

test('focused test requires canonical binary, argv-only invocation, exact env and bounded timeout', () => {
  const invalid = [
    { binary: 'node', argv: ['--version'], environment: {}, timeoutMs: 1 },
    { binary: '/usr/bin/node', argv: ' --version', environment: {}, timeoutMs: 1 },
    { binary: '/usr/bin/node', argv: ['--version'], environment: { 'BAD-KEY': 'x' }, timeoutMs: 1 },
    { binary: '/usr/bin/node', argv: ['--version'], environment: {}, timeoutMs: 0 },
    { binary: '/usr/bin/node', argv: ['bad\0arg'], environment: {}, timeoutMs: 1 },
  ];
  for (const focusedTest of invalid) {
    assert.equal(
      capture(proposal({ focusedTest })).code,
      M2ProposalCompilerErrorCode.FOCUSED_TEST_INVALID,
    );
  }
});

test('Git proposal requires only exact message and six-field identity', () => {
  const extra = proposal();
  extra.gitCommit.sign = true;
  assert.equal(capture(extra).code, M2ProposalCompilerErrorCode.GIT_COMMIT_KEYS_INVALID);

  const missingIdentityField = proposal();
  delete missingIdentityField.gitCommit.identity.committerDate;
  assert.equal(capture(missingIdentityField).code, M2ProposalCompilerErrorCode.GIT_COMMIT_INVALID);

  const extraIdentityField = proposal();
  extraIdentityField.gitCommit.identity.timezone = 'UTC';
  assert.equal(capture(extraIdentityField).code, M2ProposalCompilerErrorCode.GIT_COMMIT_INVALID);

  const durableOverflow = proposal();
  durableOverflow.gitCommit.identity.authorName = 'a'.repeat(4_000);
  assert.equal(capture(durableOverflow).code, M2ProposalCompilerErrorCode.GIT_COMMIT_INVALID);
  assert(capture(durableOverflow).details.errors.includes(
    'm2-proposal.gitCommit:identity-exceeds-durable-limit',
  ));

  const messageOverflow = proposal();
  messageOverflow.gitCommit.message = 'm'.repeat(4_097);
  assert.equal(capture(messageOverflow).code, M2ProposalCompilerErrorCode.GIT_COMMIT_INVALID);
});

test('validator never throws on adversarial malformed shapes', () => {
  const values = [undefined, Symbol('x'), { intent: 1 }, { ...proposal(), changes: [null] }];
  for (const value of values) {
    assert.doesNotThrow(() => validateM2ProjectChangeProposal(value));
    assert.equal(validateM2ProjectChangeProposal(value).valid, false);
  }
});

summary();
