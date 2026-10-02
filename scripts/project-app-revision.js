// Explicit qualification of the existing failed-plan revision. No file writer.
import assert from 'node:assert/strict';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { compileCodeDraftInput, compileCodeDraftResult } from '../src/lifecycle/m2-code-draft.js';
import { sha256 } from './project-app-acceptance.js';
import { sqliteCatalogBlueprint } from './project-sqlite-catalog-acceptance.js';

export const REVISION_PATH = 'src/schema.js';
export const CLI_REVISION_PATH = 'src/cli.js';

export function sqliteCliRevisionBlueprint(previous) {
  const original = sqliteCatalogBlueprint();
  const { revisionOf } = sqliteRevisionBlueprint(previous);
  return { ...original, revisionOf,
    files: original.files.map(file => file.path === CLI_REVISION_PATH
      ? { ...file, instruction: 'Repair command dispatch: every catalog operation must be invoked exactly once per command. Store its return value before any result normalization. Preserve the exact tuple interface, result ordering, validation, whole-batch transaction and finally close. Change only this defect; preserve all other behavior.' }
      : { ...file, reusePrevious: true }) };
}

export function sqliteRevisionBlueprint(previous) {
  assert.ok(typeof previous.lifecycleId === 'string' && previous.lifecycleId.length > 0
    && previous.lifecycleId.length <= 128);
  assert.match(previous.planDigest, /^sha256:[0-9a-f]{64}$/);
  const original = sqliteCatalogBlueprint();
  return { ...original, revisionOf: { lifecycleId: previous.lifecycleId, planDigest: previous.planDigest },
    files: original.files.map(file => file.path === REVISION_PATH
      ? { ...file, instruction: 'Repair the failed schema dependency check: this module must have no dependencies. Preserve its declared schema exports and all existing behavior. Remove any dependency declarations; change nothing else.' }
      : { ...file, reusePrevious: true }) };
}

export function assertSchemaFailure(terminal, paths, initialDiff) {
  assert.equal(terminal.state, 'failed');
  assert.equal(terminal.result?.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
  assert.equal(terminal.result?.focusedTest?.terminalStatus, 'failed');
  assert.equal(terminal.result?.rollback?.status, 'succeeded');
  const stderr = terminal.audit?.executionEvents?.find(event => event.type === 'process_terminated')?.details?.testOutput?.stderr;
  assert.ok(typeof stderr === 'string' && stderr.includes('SQLite declared dependencies: src/schema.js'),
    'only the predefined failed schema dependency challenge may enter revision');
  assert.equal(paths.length, 7);
  assert.equal(new Set(paths).size, 7);
  assert.deepEqual(terminal.result.rollback.paths, [...paths].sort());
  const schemas = initialDiff.filter(row => row.path === REVISION_PATH);
  assert.equal(schemas.length, 1);
  const source = schemas[0].after.content;
  assert.ok(typeof source === 'string' && Buffer.byteLength(source) <= 16_384);
  // stderr can contain untrusted child output. Independently prove a real
  // dependency declaration in the retained source; parse only, never execute.
  const parser = new Parser(); parser.setLanguage(JavaScript);
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.hasError, false);
  const nodes = [tree.rootNode]; let hasDependency = false;
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type === 'import_statement'
      || (node.type === 'export_statement' && node.childForFieldName('source'))) hasDependency = true;
    nodes.push(...node.namedChildren);
  }
  assert.equal(hasDependency, true, 'schema must actually declare a dependency; stderr is insufficient');
}

export function assertRetainedRevision(initialDiff, revisedDiff, { targetPath = REVISION_PATH } = {}) {
  assert.ok([REVISION_PATH, CLI_REVISION_PATH].includes(targetPath), 'unsupported qualification repair target');
  assert.equal(initialDiff.length, 7);
  assert.equal(revisedDiff.length, 7);
  const original = new Map(initialDiff.map(row => [row.path, row.after.content]));
  assert.equal(original.size, 7);
  assert.deepEqual(revisedDiff.map(row => row.path), initialDiff.map(row => row.path));
  for (const row of revisedDiff) {
    if (row.path === targetPath) assert.notEqual(row.after.content, original.get(row.path));
    else assert.equal(row.after.content, original.get(row.path), 'retained module bytes: ' + row.path);
  }
}

// Eligibility for this one observed failure, not a general JavaScript analysis.
// Child stderr is untrusted: independently locate the repeated call in the
// full retained source. Generated modules are parsed, never imported here.
export function assertCliFailure(terminal, paths, priorDiff) {
  assert.equal(terminal.state, 'failed');
  assert.equal(terminal.result?.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
  assert.equal(terminal.result?.focusedTest?.terminalStatus, 'failed');
  assert.equal(terminal.result?.rollback?.status, 'succeeded');
  const stderr = terminal.audit?.executionEvents?.find(event => event.type === 'process_terminated')?.details?.testOutput?.stderr;
  assert.ok(typeof stderr === 'string' && stderr.includes('delete persisted row:')
    && stderr.includes('/src/cli.js:') && stderr.includes('/test/acceptance.test.mjs:'),
  'only the observed frozen delete failure may enter CLI continuation');
  assert.equal(paths.length, 7);
  assert.equal(new Set(paths).size, 7);
  assert.deepEqual(terminal.result.rollback.paths, [...paths].sort());
  assert.equal(priorDiff.length, 7);
  assert.deepEqual(priorDiff.map(row => row.path).sort(), [...paths].sort());
  const source = priorDiff.find(row => row.path === CLI_REVISION_PATH)?.after?.content;
  assert.ok(typeof source === 'string' && Buffer.byteLength(source) <= 16_384);
  const parser = new Parser(); parser.setLanguage(JavaScript);
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.hasError, false, 'CLI source syntax is unsupported');
  const repeated = tree.rootNode.descendantsOfType('ternary_expression').some(node => {
    const condition = node.childForFieldName('condition');
    const first = condition?.childForFieldName('left');
    const second = node.childForFieldName('alternative');
    const callee = first?.childForFieldName('function');
    const branch = node.parent?.type === 'return_statement' ? node.parent.parent : null;
    const deleteValue = value => value?.type === 'string' && /^(['"])delete\1$/.test(value.text);
    const deleteBranch = branch?.type === 'switch_case' && deleteValue(branch.childForFieldName('value'))
      || branch?.type === 'if_statement' && [branch.childForFieldName('condition'),
        ...(branch.childForFieldName('condition')?.descendantsOfType('binary_expression') || [])].some(expression =>
        expression?.type === 'binary_expression' && expression.children.some(child => child.type === '===')
          && expression.childForFieldName('left')?.text === 'op'
          && deleteValue(expression.childForFieldName('right')));
    return deleteBranch && condition?.type === 'binary_expression' && condition.children.some(child => child.type === '===')
      && condition.childForFieldName('right')?.type === 'undefined'
      && node.childForFieldName('consequence')?.type === 'true'
      && first?.type === 'call_expression' && second?.type === 'call_expression'
      && callee?.type === 'member_expression'
      && callee.childForFieldName('object')?.text === 'catalog'
      && callee.childForFieldName('property')?.text === 'remove'
      && first.text === second.text;
  });
  assert.equal(repeated, true, 'CLI source does not contain the observed double-remove dispatch; stderr is insufficient');
}

// The original eight generations retain their own attestation. This receipt
// binds exactly one new replacement response to the prior CLI and new preview.
export function assessCliRevisionGeneration(requests, pins, priorDiff) {
  const failures = [];
  const rows = requests.filter(row => ['/api/chat', '/api/generate'].includes(row?.path));
  if (pins.scenarioId !== 'sqlite-catalog') failures.push('CLI continuation only supports the fixed SQLite scenario');
  if (rows.length !== 1) failures.push('CLI continuation requires exactly one new generation');
  if (requests.some(row => row?.error)) failures.push('provider relay request failed');
  const original = new Map(priorDiff.map(row => [row.path, row.after?.content]));
  const revised = new Map((pins.previewHashes || []).map(row => [row.path, row.sha256]));
  const paths = sqliteCatalogBlueprint().files.map(file => file.path).sort();
  if (priorDiff.length !== 7 || original.size !== 7
    || JSON.stringify([...original.keys()].sort()) !== JSON.stringify(paths)
    || (pins.previewHashes || []).length !== 7 || revised.size !== 7
    || JSON.stringify([...revised.keys()].sort()) !== JSON.stringify(paths)) {
    failures.push('CLI continuation preview path set is incomplete');
  }
  for (const [target, content] of original) {
    if (typeof content !== 'string') failures.push('prior source is missing: ' + target);
    else if (target !== CLI_REVISION_PATH && revised.get(target) !== sha256(content)) {
      failures.push('retained bytes changed: ' + target);
    }
  }
  const row = rows[0], terminal = row?.terminal;
  if (typeof row?.requestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.requestSha256)) {
    failures.push('CLI request SHA-256 is missing or invalid');
  }
  const complete = row?.method === 'POST' && row.model === pins.model && row.status === 200
    && row.responseTruncated === false && terminal?.done === true && terminal?.done_reason === 'stop';
  const validVersion = typeof pins.version === 'string'
    && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pins.version);
  const validPins = typeof pins.model === 'string' && /^[A-Za-z0-9_.:/-]{1,128}$/.test(pins.model)
    && typeof pins.digest === 'string' && /^[0-9a-f]{64}$/.test(pins.digest);
  const identityMatched = validPins && validVersion && terminal?.model === pins.model
    && (terminal?.model_digest_sha256 ?? terminal?.digest) === pins.digest
    && terminal?.provider_version === pins.version;
  if (!complete) failures.push('CLI generation incomplete');
  if (!identityMatched) failures.push('CLI generation identity mismatch');
  let outputSha256 = null;
  try {
    const compiled = compileCodeDraftInput(sqliteCatalogBlueprint());
    const index = compiled.changes.findIndex(change => change.path === CLI_REVISION_PATH);
    const previousContent = original.get(CLI_REVISION_PATH);
    const repaired = compileCodeDraftResult(compiled,
      { content: terminal.message.content, finishReason: 'stop' }, index, previousContent);
    outputSha256 = sha256(repaired.changes[0].afterContent);
    assert.notEqual(outputSha256, sha256(previousContent), 'repair must change its target');
  } catch { failures.push('CLI response cannot reconstruct the changed source'); }
  const previewSha256 = revised.get(CLI_REVISION_PATH) ?? null;
  const outputPreviewMatch = outputSha256 !== null && outputSha256 === previewSha256;
  if (!outputPreviewMatch) failures.push('CLI generation differs from final preview');
  return { valid: failures.length === 0, observed: rows.length, expected: 1,
    previewCompared: outputPreviewMatch, generationPaths: [CLI_REVISION_PATH],
    perFile: [{ generation: 9, targetPath: CLI_REVISION_PATH,
      requestSha256: row?.requestSha256 ?? null, outputSha256, previewSha256, complete, identityMatched, outputPreviewMatch }],
    failures };
}

// Original seven outputs bind to their original preview. The eighth response
// contains replacements, reconstructed by the same parse-only M2 compiler.
export function assessRevisionGenerations(requests, pins, assessOriginal) {
  const rows = requests.filter(row => ['/api/chat', '/api/generate'].includes(row?.path));
  const initialRequests = requests.filter(row => !rows.slice(7).includes(row));
  const initial = assessOriginal(initialRequests, { ...pins, previewHashes: pins.initialPreviewHashes });
  const failures = [...initial.failures];
  if (pins.scenarioId !== 'sqlite-catalog') failures.push('revision only supports the fixed SQLite scenario');
  if (rows.length !== 8) failures.push('revision requires exactly eight generations');
  if (requests.some(row => row?.error)) failures.push('provider relay request failed');
  const revisedHashes = new Map((pins.previewHashes || []).map(row => [row.path, row.sha256]));
  const initialHashes = new Map((pins.initialPreviewHashes || []).map(row => [row.path, row.sha256]));
  if (revisedHashes.size !== 7 || revisedHashes.size !== (pins.previewHashes || []).length
    || JSON.stringify([...revisedHashes.keys()].sort()) !== JSON.stringify([...initialHashes.keys()].sort())) {
    failures.push('revision preview path set is incomplete');
  }
  for (const [target, hash] of initialHashes) {
    if (target !== REVISION_PATH && revisedHashes.get(target) !== hash) failures.push('retained bytes changed: ' + target);
  }
  const row = rows[7], terminal = row?.terminal;
  const complete = row?.method === 'POST' && row.model === pins.model && row.status === 200
    && row.responseTruncated === false && terminal?.done === true && terminal?.done_reason === 'stop';
  const identityMatched = terminal?.model === pins.model
    && (terminal?.model_digest_sha256 ?? terminal?.digest) === pins.digest
    && terminal?.provider_version === pins.version;
  if (!complete) failures.push('revision generation incomplete');
  if (!identityMatched) failures.push('revision generation identity mismatch');
  let outputSha256 = null;
  try {
    const generationIndex = initial.generationPaths.indexOf(REVISION_PATH);
    assert.ok(generationIndex >= 0);
    const previousContent = JSON.parse(rows[generationIndex].terminal.message.content).afterContent;
    assert.equal(sha256(previousContent), initialHashes.get(REVISION_PATH));
    const compiled = compileCodeDraftInput(sqliteCatalogBlueprint());
    const targetIndex = compiled.changes.findIndex(change => change.path === REVISION_PATH);
    const repaired = compileCodeDraftResult(compiled,
      { content: terminal.message.content, finishReason: 'stop' }, targetIndex, previousContent);
    outputSha256 = sha256(repaired.changes[0].afterContent);
    assert.notEqual(outputSha256, initialHashes.get(REVISION_PATH), 'repair must change its target');
  } catch { failures.push('revision response cannot reconstruct the changed schema'); }
  const previewSha256 = revisedHashes.get(REVISION_PATH) ?? null;
  const outputPreviewMatch = outputSha256 !== null && outputSha256 === previewSha256;
  if (!outputPreviewMatch) failures.push('revision generation differs from final schema preview');
  return { valid: failures.length === 0, observed: rows.length, expected: 8,
    previewCompared: initial.previewCompared && outputPreviewMatch, generationPaths: [...initial.generationPaths, REVISION_PATH],
    perFile: [...initial.perFile, { generation: 8, targetPath: REVISION_PATH,
      requestSha256: row?.requestSha256 ?? null, outputSha256, previewSha256, complete, identityMatched, outputPreviewMatch }],
    failures };
}
