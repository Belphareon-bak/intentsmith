import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  EvidenceInfrastructureError,
  evaluateGate0RiskPolicy,
  GateImpact,
} from './gate0-evidence-verdict.js';
import { hasConcreteBlockedPrerequisite } from './test-registry.js';

export const REGISTRY_VALIDATION_COMMAND =
  'node scripts/validate-test-registry.js --json';
export const DISPOSITION_VALIDATION_COMMAND =
  'node scripts/validate-final-disposition.js --json';
export const RISK_POLICY_PATH =
  'docs/convergence/GATE0-RISK-IMPACT.json';
export const RISK_REGISTER_PATH =
  'docs/convergence/RISK-REGISTER.md';
export const PRIVACY_INCIDENT_PATH =
  'docs/convergence/PRIVACY-INCIDENT.json';

export function buildRegistryGateFacts(registry) {
  if (
    registry === null
    || typeof registry !== 'object'
    || Array.isArray(registry)
    || !Array.isArray(registry.suites)
    || !Array.isArray(registry.exclusions)
  ) {
    throw new EvidenceInfrastructureError(
      'candidate registry cannot be projected into Gate 0 facts',
    );
  }
  const profileCounts = countByField(registry.suites, 'profile');
  const stateCounts = countByField(registry.suites, 'state');
  const deterministicSuites = registry.suites.filter(
    suite => suite?.profile === 'offline' || suite?.profile === 'database',
  );
  return {
    runnablePrograms: registry.suites.length,
    explicitSupportExclusions: registry.exclusions.length,
    profileCounts,
    stateCounts,
    deterministicRequired: deterministicSuites.length,
    deterministicScopeValid: deterministicSuites.every(
      suite => suite?.required === true && suite?.state === 'ACTIVE',
    ),
    knownDefectiveInDeterministic: deterministicSuites
      .filter(suite => suite?.state === 'KNOWN_DEFECTIVE')
      .map(suite => suite.id)
      .sort(),
    blockedWithoutPrerequisite: registry.suites
      .filter(
        suite => suite?.state === 'BLOCKED'
          && !hasConcreteBlockedPrerequisite(suite),
      )
      .map(suite => suite.id)
      .sort(),
  };
}

export function projectRegistryValidation(classified) {
  const report = classified.report;
  return {
    command: REGISTRY_VALIDATION_COMMAND,
    exitCode: classified.exitCode,
    outputSha256: sha256(classified.output),
    reportSha256: sha256(classified.stdout),
    errors: [...classified.errors],
    report: {
      schemaVersion: report.schemaVersion,
      valid: report.valid,
      runnablePrograms: report.runnablePrograms,
      explicitSupportExclusions: report.explicitSupportExclusions,
      fingerprint: report.fingerprint,
      document: cloneJson(report.document),
    },
  };
}

export function projectDispositionValidation(classified) {
  const report = classified.report;
  return {
    command: DISPOSITION_VALIDATION_COMMAND,
    exitCode: classified.exitCode,
    outputSha256: sha256(classified.output),
    reportSha256: sha256(classified.stdout),
    errors: [...classified.errors],
    report: {
      schemaVersion: report.schemaVersion,
      sourceRepository: cloneJson(report.sourceRepository),
      sourceRange: cloneJson(report.sourceRange),
      sourceManifest: cloneJson(report.sourceManifest),
      repairedSubjectEvidence: cloneJson(report.repairedSubjectEvidence),
      records: report.records,
      dispositionCounts: cloneJson(report.dispositionCounts),
      terminalCounts: cloneJson(report.terminalCounts),
      resolutionCounts: cloneJson(report.resolutionCounts),
      pathsCount: report.paths.length,
      pathsSha256: sha256(JSON.stringify(report.paths)),
    },
  };
}

export function buildGate0RiskEvidence({
  riskMarkdownBytes,
  policyBytes,
}) {
  const riskMarkdown = asUtf8(riskMarkdownBytes, RISK_REGISTER_PATH);
  const policy = parseJson(policyBytes, RISK_POLICY_PATH);
  requireExactKeys(
    policy,
    ['schemaVersion', 'gate', 'source', 'risks'],
    'risk policy',
  );
  if (!Array.isArray(policy.risks)) {
    throw new EvidenceInfrastructureError('risk policy risks must be an array');
  }
  for (const [index, entry] of policy.risks.entries()) {
    const expectedKeys = entry?.gateImpact === GateImpact.G0_FAIL
      ? ['riskId', 'gateImpact', 'rationale']
      : ['riskId', 'gateImpact', 'rationale', 'condition'];
    requireExactKeys(entry, expectedKeys, `risk policy risks[${index}]`);
  }
  const assessment = evaluateGate0RiskPolicy(riskMarkdown, policy);
  return {
    path: RISK_POLICY_PATH,
    schemaVersion: assessment.schemaVersion,
    sha256: sha256(asBuffer(policyBytes)),
    registerPath: RISK_REGISTER_PATH,
    registerSha256: sha256(asBuffer(riskMarkdownBytes)),
    valid: assessment.valid,
    errors: [...assessment.errors],
    riskCount: assessment.riskCount,
    policyCount: assessment.policyCount,
    impactCounts: cloneJson(assessment.impactCounts),
    openImpactCounts: cloneJson(assessment.openImpactCounts),
    repositoryBlockers: [...assessment.repositoryBlockers],
    reviewRequiredRisks: [...assessment.reviewRequiredRisks],
    laterGateRisks: [...assessment.laterGateRisks],
    separateIncidents: [...assessment.separateIncidents],
  };
}

export function buildPrivacyIncidentEvidence(privacyBytes) {
  const privacy = parseJson(privacyBytes, PRIVACY_INCIDENT_PATH);
  requireExactKeys(privacy, [
    'schemaVersion',
    'incidentId',
    'status',
    'assessmentDate',
    'assessment',
    'currentTreeContainment',
    'history',
    'trackedObjectManifest',
    'rotationInventory',
  ], 'privacy incident');
  requireExactKeys(privacy.assessment, [
    'repositoryWasPublic',
    'thirdPartyDownloadKnown',
    'possibleExfiltrationAssumed',
    'personalContentInspected',
    'method',
  ], 'privacy incident assessment');
  requireExactKeys(privacy.currentTreeContainment, [
    'sourceCommit',
    'trackedPathsRemoved',
    'trackedBytesRemoved',
    'localQuarantineRoot',
    'localQuarantineTracked',
    'directoryMode',
    'fileMode',
    'userDataDeleted',
  ], 'privacy current-tree containment');
  requireExactKeys(privacy.history, [
    'affectedObjectsRemainReachable',
    'historyRewritten',
    'remediationAuthority',
  ], 'privacy history');
  if (
    privacy.schemaVersion !== 1
    || !/^G0-[A-Z0-9-]+$/.test(privacy.incidentId || '')
    || privacy.status !== 'CONFIRMED_COMPROMISE'
    || privacy.assessment?.personalContentInspected !== false
    || privacy.currentTreeContainment?.localQuarantineTracked !== false
    || privacy.currentTreeContainment?.userDataDeleted !== false
    || privacy.currentTreeContainment?.directoryMode !== '0700'
    || privacy.currentTreeContainment?.fileMode !== '0600'
    || !/^[a-f0-9]{40}$/.test(
      privacy.currentTreeContainment?.sourceCommit || '',
    )
    || !Number.isInteger(privacy.currentTreeContainment?.trackedPathsRemoved)
    || privacy.currentTreeContainment.trackedPathsRemoved < 1
    || !Number.isInteger(privacy.currentTreeContainment?.trackedBytesRemoved)
    || privacy.currentTreeContainment.trackedBytesRemoved < 1
    || privacy.history?.affectedObjectsRemainReachable !== true
    || privacy.history?.historyRewritten !== false
  ) {
    throw new EvidenceInfrastructureError(
      'privacy incident identity or containment state is invalid',
    );
  }
  if (!Array.isArray(privacy.trackedObjectManifest)) {
    throw new EvidenceInfrastructureError(
      'privacy tracked-object manifest must be an array',
    );
  }
  const trackedPaths = new Set();
  const trackedBlobs = new Set();
  let trackedBytes = 0;
  for (const [index, item] of privacy.trackedObjectManifest.entries()) {
    requireExactKeys(
      item,
      ['path', 'gitBlob', 'bytes', 'category'],
      `privacy trackedObjectManifest[${index}]`,
    );
    if (
      !safeRelativePath(item.path)
      || !/^[a-f0-9]{40}$/.test(item.gitBlob || '')
      || !Number.isInteger(item.bytes)
      || item.bytes < 1
      || !safeText(item.category)
      || trackedPaths.has(item.path)
      || trackedBlobs.has(item.gitBlob)
    ) {
      throw new EvidenceInfrastructureError(
        `privacy trackedObjectManifest[${index}] is invalid or duplicated`,
      );
    }
    trackedPaths.add(item.path);
    trackedBlobs.add(item.gitBlob);
    trackedBytes += item.bytes;
  }
  if (
    trackedPaths.size !== privacy.currentTreeContainment.trackedPathsRemoved
    || trackedBytes !== privacy.currentTreeContainment.trackedBytesRemoved
  ) {
    throw new EvidenceInfrastructureError(
      'privacy tracked-object totals disagree with containment metadata',
    );
  }
  if (!Array.isArray(privacy.rotationInventory)) {
    throw new EvidenceInfrastructureError(
      'privacy rotation inventory must be an array',
    );
  }
  const rotationCategories = [];
  const categorySet = new Set();
  for (const [index, item] of privacy.rotationInventory.entries()) {
    requireExactKeys(
      item,
      ['category', 'examples', 'action'],
      `privacy rotationInventory[${index}]`,
    );
    if (
      !safeText(item.category)
      || !safeText(item.action)
      || !Array.isArray(item.examples)
      || item.examples.length < 1
      || item.examples.some(example => !safeText(example))
      || categorySet.has(item.category)
    ) {
      throw new EvidenceInfrastructureError(
        `privacy rotationInventory[${index}] is invalid or duplicated`,
      );
    }
    categorySet.add(item.category);
    rotationCategories.push(item.category);
  }
  return {
    path: PRIVACY_INCIDENT_PATH,
    schemaVersion: privacy.schemaVersion,
    sha256: sha256(asBuffer(privacyBytes)),
    incidentId: privacy.incidentId,
    status: privacy.status,
    trackedPathsRemoved: privacy.currentTreeContainment.trackedPathsRemoved,
    trackedBytesRemoved: privacy.currentTreeContainment.trackedBytesRemoved,
    historyReachable: privacy.history.affectedObjectsRemainReachable,
    historyRewritten: privacy.history.historyRewritten,
    personalContentInspected: privacy.assessment.personalContentInspected,
    rotationCategories,
  };
}

function parseJson(value, label) {
  try {
    return JSON.parse(asUtf8(value, label));
  } catch {
    throw new EvidenceInfrastructureError(`${label} is not valid JSON`);
  }
}

function asUtf8(value, label) {
  const buffer = asBuffer(value);
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new EvidenceInfrastructureError(`${label} is not valid UTF-8`);
  }
  return text;
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  throw new EvidenceInfrastructureError('evidence source must be bytes or text');
}

function requireExactKeys(value, expected, label) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    throw new EvidenceInfrastructureError(`${label} fields differ from schema`);
  }
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value !== ''
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

function safeText(value) {
  return typeof value === 'string'
    && value.trim() !== ''
    && value.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function cloneJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function countByField(values, key) {
  return values.reduce((counts, value) => {
    const label = value?.[key];
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
