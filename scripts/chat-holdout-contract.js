import { createHash } from 'node:crypto';
import path from 'node:path';

export function readHoldoutDefinition(bytes, expectedSha256) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 || '')) throw new Error('HOLDOUT_SHA256_REQUIRED');
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new Error('HOLDOUT_SHA256_MISMATCH');
  const definition = JSON.parse(bytes.toString('utf8'));
  if (definition.version !== 1 || !Array.isArray(definition.cases) || !definition.cases.length
    || definition.cases.some(row => !row.id || typeof row.id !== 'string'
      || typeof row.family !== 'string' || !row.family || typeof row.input !== 'string' || !row.input.trim()
      || !row.intent || typeof row.contextPolicy !== 'string'
      || !Array.isArray(row.allowed) || !row.allowed.length
      || !Array.isArray(row.forbidden) || !row.forbidden.length
      || !['required', 'permitted', 'unnecessary'].includes(row.question)
      || row.usedForTuning !== false || row.variant !== 'holdout')) throw new Error('HOLDOUT_SCHEMA_INVALID');
  if (new Set(definition.cases.map(row => row.id)).size !== definition.cases.length) throw new Error('Duplicate case ID');
  if (definition.fixtures !== undefined && (!definition.fixtures || Array.isArray(definition.fixtures)
    || typeof definition.fixtures !== 'object')) throw new Error('HOLDOUT_FIXTURES_INVALID');
  for (const [relative, content] of Object.entries(definition.fixtures || {})) {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).some(segment => ['..', '.', ''].includes(segment))
      || /[\u0000]/u.test(relative) || typeof content !== 'string') throw new Error('HOLDOUT_FIXTURES_INVALID');
  }
  for (const [index, row] of definition.cases.entries()) {
    if (!row.approve) continue;
    if (!['fs.read', 'fs.write'].includes(row.approve.kind) || typeof row.approve.path !== 'string'
      || !row.approve.path || path.isAbsolute(row.approve.path)
      || row.approve.path.split(/[\\/]/u).some(segment => ['..', '.', ''].includes(segment))) throw new Error('HOLDOUT_APPROVAL_INVALID');
    if (row.approve.previous) {
      const source = definition.cases.findIndex(candidate => candidate.id === row.approve.fromCase);
      if (source < 0 || source >= index || typeof row.dialog !== 'string' || !row.dialog
        || definition.cases[source].dialog !== row.dialog) throw new Error('Invalid previous-answer source');
    }
  }
  return definition;
}

export function assertHoldoutSeries({ phase, manifest, runs = [], configurationFingerprint }) {
  if (!/^holdout-[123]$/u.test(phase)) throw new Error('Unknown holdout phase');
  if (runs.some(run => run.phase === phase && run.status === 'LIVE_COMPLETE_UNASSESSED')) throw new Error('HOLDOUT_SERIES_ALREADY_COMPLETE');
  if (phase === 'holdout-1') return;
  const previous = runs.findLast(run => run.phase === `holdout-${Number(phase.at(-1)) - 1}`
    && run.status === 'LIVE_COMPLETE_UNASSESSED');
  const keys = ['revision', 'sourceClean', 'corpusSha256', 'runnerSha256', 'holdoutContractSha256', 'model', 'modelDigest', 'modelArtifacts', 'node'];
  if (!previous || keys.some(key => JSON.stringify(previous.manifest?.[key]) !== JSON.stringify(manifest[key]))) throw new Error('HOLDOUT_SERIES_DRIFT');
  if (configurationFingerprint !== undefined && previous.configuration?.fingerprint !== configurationFingerprint) throw new Error('HOLDOUT_CONFIGURATION_DRIFT');
}

export function holdoutProgress(row) {
  // No input, content, file bytes, model answer or error text in public output.
  return { id: row.id, variant: row.variant, status: row.status, ms: row.ms };
}
