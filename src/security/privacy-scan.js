import path from 'node:path';

import {
  M5_PRIVACY_KIND,
  validateM5PrivacyTreeScan,
} from '../../contracts/m5/privacy-remediation-v1.js';

const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:db|sqlite|sqlite3|pem|key|p12|pfx|kdbx)(?:$|-)|(?:chats|projects)\/.*\/attachments\/)/i;
const PRODUCTION_SOURCE = /^(?:bin|contracts|scripts|src)\/.*\.(?:c?js|mjs|json|ts|yaml|yml|toml)$/;
const SECRET_FALLBACK = /process\.env\.[A-Z0-9_]*(?:SECRET|PASSWORD|PASS|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*(?:\|\||\?\?)\s*(['"])[^'"\r\n]+\1/;
const NAMED_LITERAL = /\b[A-Za-z0-9_]*(?:secret|password|passwd|apiKey|api_key|accessToken|access_token|privateKey|private_key)[A-Za-z0-9_]*\s*(?:=|:)\s*(['"])[^'"\r\n]{8,}\1/i;

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
  for (const filePath of uniquePaths) {
    if (filePath !== '.env.example' && SENSITIVE_PATH.test(filePath)) {
      findings.push(finding('M5_PRIVACY_SENSITIVE_PATH_TRACKED', filePath));
      continue;
    }
    if (!PRODUCTION_SOURCE.test(filePath)) continue;
    let bytes;
    try {
      bytes = readFile(filePath);
    } catch {
      findings.push(finding('M5_PRIVACY_TRACKED_FILE_UNREADABLE', filePath));
      continue;
    }
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    if (bytes.includes(0)) {
      findings.push(finding('M5_PRIVACY_PRODUCTION_SOURCE_BINARY', filePath));
      continue;
    }
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) {
      findings.push(finding('M5_PRIVACY_PRODUCTION_SOURCE_INVALID_UTF8', filePath));
      continue;
    }
    source.split(/\r?\n/).forEach((line, index) => {
      if (SECRET_FALLBACK.test(line)) {
        findings.push(finding('M5_PRIVACY_SECRET_ENV_FALLBACK_LITERAL', filePath, index + 1));
      } else if (NAMED_LITERAL.test(line) && !line.trimStart().startsWith('//')) {
        findings.push(finding('M5_PRIVACY_NAMED_SECRET_LITERAL', filePath, index + 1));
      }
    });
  }
  findings.sort(compareFindings);
  const report = Object.freeze({
    contract: M5_PRIVACY_KIND.TREE_SCAN,
    version: 1,
    candidateRevision,
    scannedFiles: uniquePaths.length,
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
