import path from 'node:path';

import {
  M5_PRIVACY_KIND,
  validateM5PrivacyTreeScan,
} from '../../contracts/m5/privacy-remediation-v1.js';
import {
  M5_DISTRIBUTION_MANIFEST_DIGEST,
  isM5DistributedContentPath,
} from '../../contracts/m5/distribution-manifest-v1.js';

const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:db|sqlite|sqlite3|pem|key|p12|pfx|kdbx)(?:$|-)|(?:chats|projects)\/.*\/attachments\/)/i;
const SECRET_FALLBACK = /process\.env\.[A-Z0-9_]*(?:SECRET|PASSWORD|PASS|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*(['"])[^'"\r\n]+\1/g;
const NAMED_LITERAL = /\b[A-Za-z0-9_]*(?:secret|password|passwd|apiKey|api_key|accessToken|access_token|privateKey|private_key)[A-Za-z0-9_]*\s*(?:=|:)\s*(['"])[^'"\r\n]{8,}\1/gi;

function safePath(value) {
  return typeof value === 'string'
    && value !== ''
    && !value.includes('\0')
    && !value.includes('\\')
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

function finding(ruleId, filePath, line = null) {
  return Object.freeze({ ruleId, path: filePath, line });
}

function compareFindings(left, right) {
  return Buffer.compare(
    Buffer.from(`${left.path}\0${left.line ?? 0}\0${left.ruleId}`, 'utf8'),
    Buffer.from(`${right.path}\0${right.line ?? 0}\0${right.ruleId}`, 'utf8'),
  );
}

function lineAtOffset(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function lineIsComment(source, offset) {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return source.slice(start, offset).trimStart().startsWith('//');
}

function addMatches(findings, source, filePath, expression, ruleId, skipComments = false) {
  expression.lastIndex = 0;
  let match;
  while ((match = expression.exec(source)) !== null) {
    if (!skipComments || !lineIsComment(source, match.index)) {
      findings.push(finding(ruleId, filePath, lineAtOffset(source, match.index)));
    }
    if (match[0].length === 0) expression.lastIndex += 1;
  }
}

export function isM5PrivacyContentScanPath(filePath) {
  return isM5DistributedContentPath(filePath);
}

export function scanM5TrackedTree({ candidateRevision, paths, readFile } = {}) {
  if (!/^[a-f0-9]{40}$/.test(candidateRevision || '')) {
    throw new TypeError('m5-privacy-scan:candidate-revision-invalid');
  }
  if (!Array.isArray(paths) || paths.some(filePath => !safePath(filePath))) {
    throw new TypeError('m5-privacy-scan:paths-invalid');
  }
  if (typeof readFile !== 'function') throw new TypeError('m5-privacy-scan:read-file-required');
  const uniquePaths = [...new Set(paths)].sort((left, right) => (
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  ));
  if (uniquePaths.length !== paths.length) throw new TypeError('m5-privacy-scan:duplicate-path');

  const findings = [];
  let contentReadFiles = 0;
  for (const filePath of uniquePaths) {
    if (filePath !== '.env.example' && SENSITIVE_PATH.test(filePath)) {
      findings.push(finding('M5_PRIVACY_SENSITIVE_PATH_TRACKED', filePath));
      continue;
    }
    if (!isM5DistributedContentPath(filePath)) continue;
    let bytes;
    try {
      bytes = readFile(filePath);
    } catch {
      findings.push(finding('M5_PRIVACY_TRACKED_FILE_UNREADABLE', filePath));
      continue;
    }
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    contentReadFiles += 1;
    if (bytes.includes(0)) {
      findings.push(finding('M5_PRIVACY_PRODUCTION_SOURCE_BINARY', filePath));
      continue;
    }
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) {
      findings.push(finding('M5_PRIVACY_PRODUCTION_SOURCE_INVALID_UTF8', filePath));
      continue;
    }
    addMatches(
      findings,
      source,
      filePath,
      SECRET_FALLBACK,
      'M5_PRIVACY_SECRET_ENV_FALLBACK_LITERAL',
    );
    addMatches(
      findings,
      source,
      filePath,
      NAMED_LITERAL,
      'M5_PRIVACY_NAMED_SECRET_LITERAL',
      true,
    );
  }
  findings.sort(compareFindings);
  const report = Object.freeze({
    contract: M5_PRIVACY_KIND.TREE_SCAN,
    version: 1,
    candidateRevision,
    scannedFiles: uniquePaths.length,
    contentReadFiles,
    distributionManifestDigest: M5_DISTRIBUTION_MANIFEST_DIGEST,
    findings: Object.freeze(findings),
    verdict: findings.length === 0 ? 'PASS' : 'FAIL',
    secretValuesRecorded: false,
  });
  const validation = validateM5PrivacyTreeScan(report);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return report;
}

export function verifyM5PrivacyHistoryReachability(incident, exists) {
  if (!incident || !Array.isArray(incident.trackedObjectManifest) || typeof exists !== 'function') {
    throw new TypeError('m5-privacy-history:invalid-input');
  }
  let reachableObjects = 0;
  for (const item of incident.trackedObjectManifest) {
    if (!item || typeof item.gitBlob !== 'string' || !/^[a-f0-9]{40}$/.test(item.gitBlob)) {
      throw new TypeError('m5-privacy-history:invalid-object-identity');
    }
    if (exists(item.gitBlob) === true) reachableObjects += 1;
  }
  return Object.freeze({
    checkedObjects: incident.trackedObjectManifest.length,
    reachableObjects,
    allReachable: reachableObjects === incident.trackedObjectManifest.length,
    personalContentInspected: false,
    objectIdentitiesReported: false,
    secretValuesRecorded: false,
  });
}

export const M5_PRIVACY_SCAN_RULES = Object.freeze([
  'M5_PRIVACY_NAMED_SECRET_LITERAL',
  'M5_PRIVACY_PRODUCTION_SOURCE_BINARY',
  'M5_PRIVACY_PRODUCTION_SOURCE_INVALID_UTF8',
  'M5_PRIVACY_SECRET_ENV_FALLBACK_LITERAL',
  'M5_PRIVACY_SENSITIVE_PATH_TRACKED',
  'M5_PRIVACY_TRACKED_FILE_UNREADABLE',
]);
