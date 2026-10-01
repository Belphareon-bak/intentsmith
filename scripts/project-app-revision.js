// Explicit qualification of the existing failed-plan revision. No file writer.
import assert from 'node:assert/strict';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { compileCodeDraftInput, compileCodeDraftResult } from '../src/lifecycle/m2-code-draft.js';
import { sha256 } from './project-app-acceptance.js';
import { sqliteCatalogBlueprint } from './project-sqlite-catalog-acceptance.js';

export const REVISION_PATH = 'src/schema.js';

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

export function assertRetainedRevision(initialDiff, revisedDiff) {
  assert.equal(initialDiff.length, 7);
  assert.equal(revisedDiff.length, 7);
  const original = new Map(initialDiff.map(row => [row.path, row.after.content]));
  assert.equal(original.size, 7);
  assert.deepEqual(revisedDiff.map(row => row.path), initialDiff.map(row => row.path));
  for (const row of revisedDiff) {
    if (row.path === REVISION_PATH) assert.notEqual(row.after.content, original.get(row.path));
    else assert.equal(row.after.content, original.get(row.path), 'retained module bytes: ' + row.path);
  }
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
