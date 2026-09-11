// Durable, replayable projection for model-evaluation host evidence.
//
// Applicability depends on normalized inventory facts. A snapshot that keeps
// only a model name and digest cannot independently reproduce role coverage.

import { createHash } from 'node:crypto';

export const MODEL_EVALUATION_SNAPSHOT_INVENTORY_VERSION =
  'intentsmith-normalized-model-inventory-v1';
const PROVIDER_SNAPSHOT_VERSION = 'intentsmith-normalized-model-inventory-v2';

const STATUSES = Object.freeze(['COMPLETE', 'BLOCKED', 'MISSING', 'FAILED']);

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function projectedArtifact(model) {
  return Object.freeze({
    name: model.name,
    canonicalName: model.canonicalName,
    digestSha256: model.digestSha256,
    size: model.size,
    modifiedAt: model.modifiedAt,
    params: model.params,
    family: model.family,
    category: model.category,
    capabilities: Object.freeze([...model.capabilities]),
  });
}

export function createSnapshotInventoryProjection(models = [], providerVersion = null) {
  if (!Array.isArray(models)) throw new TypeError('snapshot inventory models must be an array');
  const artifacts = Object.freeze(models.map(projectedArtifact));
  return Object.freeze({
    schemaVersion: providerVersion === null ? MODEL_EVALUATION_SNAPSHOT_INVENTORY_VERSION : PROVIDER_SNAPSHOT_VERSION,
    ...(providerVersion === null ? {} : { providerVersion }),
    sha256: sha256Json(providerVersion === null ? artifacts : { providerVersion, artifacts }),
    artifacts,
  });
}

function validateProjectedArtifact(artifact, index) {
  const label = `snapshot inventory artifact ${index}`;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (typeof artifact.name !== 'string' || !artifact.name) {
    throw new TypeError(`${label} requires name`);
  }
  if (artifact.digestSha256 !== null
    && !/^[a-f0-9]{64}$/.test(artifact.digestSha256 || '')) {
    throw new TypeError(`${label} has invalid exact digest`);
  }
  if (artifact.params !== null
    && (!Number.isFinite(artifact.params) || artifact.params <= 0)) {
    throw new TypeError(`${label} has invalid params`);
  }
  if (typeof artifact.category !== 'string' || !artifact.category) {
    throw new TypeError(`${label} requires category`);
  }
  if (typeof artifact.family !== 'string' || !artifact.family) {
    throw new TypeError(`${label} requires family`);
  }
  if (!Array.isArray(artifact.capabilities)
    || artifact.capabilities.some(value => typeof value !== 'string' || !value)) {
    throw new TypeError(`${label} requires normalized capabilities`);
  }
  const normalizedCapabilities = [...new Set(artifact.capabilities
    .map(value => value.trim().toLowerCase()))].sort();
  if (JSON.stringify(artifact.capabilities) !== JSON.stringify(normalizedCapabilities)) {
    throw new TypeError(`${label} capabilities are not normalized`);
  }
}

export function inventoryFromModelEvaluationSnapshot(snapshot) {
  const projection = snapshot?.readModel?.inventoryProjection;
  if (![MODEL_EVALUATION_SNAPSHOT_INVENTORY_VERSION, PROVIDER_SNAPSHOT_VERSION].includes(projection?.schemaVersion)) {
    throw new TypeError('snapshot normalized inventory projection is missing or unsupported');
  }
  if (!Array.isArray(projection.artifacts)) {
    throw new TypeError('snapshot normalized inventory artifacts are missing');
  }
  projection.artifacts.forEach(validateProjectedArtifact);
  const withProvider = projection.schemaVersion === PROVIDER_SNAPSHOT_VERSION;
  if (withProvider ? (typeof projection.providerVersion !== 'string' || !projection.providerVersion)
    : Object.hasOwn(projection, 'providerVersion')) {
    throw new TypeError('snapshot provider filter is missing or unsupported');
  }
  const calculated = sha256Json(withProvider
    ? { providerVersion: projection.providerVersion, artifacts: projection.artifacts }
    : projection.artifacts);
  if (projection.sha256 !== calculated) {
    throw new TypeError('snapshot normalized inventory projection SHA-256 mismatch');
  }
  return Object.freeze(projection.artifacts.map(artifact => Object.freeze({
    ...artifact,
    capabilities: Object.freeze([...artifact.capabilities]),
  })));
}

export function summarizeModelEvaluationReport(report) {
  const totals = Object.fromEntries(STATUSES.map(status => [status, 0]));
  const completeIntervalIntegrity = {};
  const roles = {};
  const testedAt = [];
  for (const [role, state] of Object.entries(report.roles)) {
    const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
    for (const artifact of state.artifacts) {
      counts[artifact.status] = (counts[artifact.status] || 0) + 1;
      if (artifact.testedAt) testedAt.push(artifact.testedAt);
      if (artifact.status === 'COMPLETE') {
        const integrity = artifact.intervalIntegrity || 'NOT_AVAILABLE';
        completeIntervalIntegrity[integrity] = (completeIntervalIntegrity[integrity] || 0) + 1;
      }
    }
    roles[role] = Object.freeze({
      ...counts,
      notApplicable: state.artifacts.filter(artifact => artifact.applicable === false).length,
      applicableMissing: state.artifacts.filter(artifact => (
        artifact.applicable !== false && artifact.status === 'MISSING'
      )).length,
    });
    for (const status of STATUSES) totals[status] += counts[status];
  }
  testedAt.sort();
  return Object.freeze({
    generatedAt: report.generatedAt,
    authority: report.authority,
    bindingAuthority: report.bindingAuthority,
    artifactCount: report.models.length,
    inventoryProjection: createSnapshotInventoryProjection(report.models, report.providerVersion || null),
    roles,
    totals,
    coverage: report.coverage,
    completeIntervalIntegrity,
    currentTestedAtRange: Object.freeze({
      min: testedAt[0] || null,
      max: testedAt.at(-1) || null,
    }),
    decisionCount: report.decisions.length,
    actionableDecisionCount: report.decisions.filter(row => row.actionable).length,
  });
}

export default {
  MODEL_EVALUATION_SNAPSHOT_INVENTORY_VERSION,
  createSnapshotInventoryProjection,
  inventoryFromModelEvaluationSnapshot,
  summarizeModelEvaluationReport,
};
