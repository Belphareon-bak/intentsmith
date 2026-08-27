import {
  M6_CURRENT_VERSION,
  M6_PREVIOUS_VERSION,
  M6_PREVIOUS_VERSION_SHA,
  M6_PREVIOUS_VERSION_UPGRADE_CONTRACT,
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  M6_PREVIOUS_VERSION_UPGRADE_VERSION,
  M6_RUNTIME_EVIDENCE_MARKER,
  M6_RUNTIME_EVIDENCE_PROGRAMS,
} from '../../contracts/m6/runtime-evidence-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UPGRADE_KEYS = Object.freeze([
  'candidateSha',
  'canary',
  'contract',
  'currentMigrationCount',
  'currentServerCleanShutdown',
  'currentVersion',
  'databaseIdentitySha256',
  'networkScope',
  'previousMigrationCount',
  'previousServerCleanShutdown',
  'previousSha',
  'previousVersion',
  'verdict',
  'version',
]);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function extractReceipt(logBytes, errors) {
  if (!(typeof logBytes === 'string' || Buffer.isBuffer(logBytes))) {
    errors.push('runtime-receipt:log-bytes');
    return null;
  }
  const lines = String(logBytes).split(/\r?\n/u)
    .filter(line => line.startsWith(M6_RUNTIME_EVIDENCE_MARKER));
  if (lines.length !== 1) {
    errors.push('runtime-receipt:exact-marker');
    return null;
  }
  try {
    const encoded = lines[0].slice(M6_RUNTIME_EVIDENCE_MARKER.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('invalid base64url');
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    errors.push('runtime-receipt:encoding');
    return null;
  }
}

function validateUpgradeReceipt(receipt, candidateSha, errors) {
  if (!exactKeys(receipt, UPGRADE_KEYS)) {
    errors.push('upgrade-receipt:keys');
    return;
  }
  if (receipt.contract !== M6_PREVIOUS_VERSION_UPGRADE_CONTRACT) {
    errors.push('upgrade-receipt:contract');
  }
  if (receipt.version !== M6_PREVIOUS_VERSION_UPGRADE_VERSION) {
    errors.push('upgrade-receipt:version');
  }
  if (!SHA_PATTERN.test(candidateSha || '') || receipt.candidateSha !== candidateSha) {
    errors.push('upgrade-receipt:candidate');
  }
  if (receipt.previousSha !== M6_PREVIOUS_VERSION_SHA) errors.push('upgrade-receipt:previous-sha');
  if (receipt.previousVersion !== M6_PREVIOUS_VERSION) errors.push('upgrade-receipt:previous-version');
  if (receipt.currentVersion !== M6_CURRENT_VERSION) errors.push('upgrade-receipt:current-version');
  if (!SHA256_PATTERN.test(receipt.databaseIdentitySha256 || '')) {
    errors.push('upgrade-receipt:database-identity');
  }
  if (!Number.isSafeInteger(receipt.previousMigrationCount) || receipt.previousMigrationCount <= 0) {
    errors.push('upgrade-receipt:previous-migrations');
  }
  if (
    !Number.isSafeInteger(receipt.currentMigrationCount)
    || receipt.currentMigrationCount <= receipt.previousMigrationCount
  ) errors.push('upgrade-receipt:current-migrations');
  if (!exactKeys(receipt.canary, ['id', 'name', 'survivedUpgrade'])) {
    errors.push('upgrade-receipt:canary-keys');
  } else if (
    !Number.isSafeInteger(receipt.canary.id)
    || receipt.canary.id <= 0
    || receipt.canary.name !== 'M6 Upgrade Canary'
    || receipt.canary.survivedUpgrade !== true
  ) errors.push('upgrade-receipt:canary');
  if (receipt.previousServerCleanShutdown !== true) errors.push('upgrade-receipt:previous-shutdown');
  if (receipt.currentServerCleanShutdown !== true) errors.push('upgrade-receipt:current-shutdown');
  if (receipt.networkScope !== 'loopback-only') errors.push('upgrade-receipt:network-scope');
  if (receipt.verdict !== 'PASS') errors.push('upgrade-receipt:verdict');
}

export function validateM6RuntimeEvidence(programId, logBytes, { candidateSha } = {}) {
  const errors = [];
  if (!M6_RUNTIME_EVIDENCE_PROGRAMS.includes(programId)) {
    errors.push(`runtime-receipt:unsupported-program:${programId}`);
    return Object.freeze({ valid: false, errors: Object.freeze(errors), receipt: null });
  }
  const receipt = extractReceipt(logBytes, errors);
  if (receipt && programId === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM) {
    validateUpgradeReceipt(receipt, candidateSha, errors);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    receipt: errors.length === 0 ? Object.freeze(receipt) : null,
  });
}
