import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_TYPE = 'intentsmith.c3-final-diff';
export const SOURCE_REPOSITORY_IDENTITY = 'github.com/Belphareon-bak/C3-agent';
export const SOURCE_REPOSITORY_URL = 'https://github.com/Belphareon-bak/C3-agent';
export const SOURCE_OBJECT_FORMAT = 'sha1';
export const SOURCE_BASE = 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f';
export const SOURCE_HEAD = 'ffd21cf119865259ea1847af989acb24916bebe3';
export const EXPECTED_RECORD_COUNT = 225;
export const RECORDS_DIGEST_ALGORITHM = 'sha256-record-tuples-v1';
export const EXPECTED_RECORDS_SHA256 =
  'aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e';

const ZERO_OBJECT_ID = '0'.repeat(40);
const CHANGE_TYPES = ['ADD', 'DELETE', 'MODIFY', 'RENAME'];
const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'manifestType',
  'sourceRepository',
  'sourceRange',
  'recordCount',
  'changeCounts',
  'recordsDigestAlgorithm',
  'recordsSha256',
  'records',
];
const REPOSITORY_KEYS = ['identity', 'canonicalUrl', 'objectFormat'];
const RANGE_KEYS = ['base', 'head', 'notation', 'renameDetection'];
const COUNT_KEYS = [...CHANGE_TYPES];
const RECORD_KEYS = [
  'sequence',
  'status',
  'changeType',
  'oldPath',
  'newPath',
  'oldBlob',
  'newBlob',
  'oldMode',
  'newMode',
];

export function recordsSha256(records) {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function countChanges(records) {
  const counts = Object.fromEntries(CHANGE_TYPES.map(type => [type, 0]));
  for (const record of records) {
    if (Object.hasOwn(counts, record?.changeType)) counts[record.changeType] += 1;
  }
  return counts;
}

export function createDiffManifest(records) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestType: MANIFEST_TYPE,
    sourceRepository: {
      identity: SOURCE_REPOSITORY_IDENTITY,
      canonicalUrl: SOURCE_REPOSITORY_URL,
      objectFormat: SOURCE_OBJECT_FORMAT,
    },
    sourceRange: {
      base: SOURCE_BASE,
      head: SOURCE_HEAD,
      notation: 'base..head',
      renameDetection: 'exact-100-percent',
    },
    recordCount: records.length,
    changeCounts: countChanges(records),
    recordsDigestAlgorithm: RECORDS_DIGEST_ALGORITHM,
    recordsSha256: recordsSha256(records),
    records,
  };
}

export function refreshManifestIntegrity(manifest) {
  manifest.recordCount = Array.isArray(manifest.records) ? manifest.records.length : 0;
  manifest.changeCounts = countChanges(Array.isArray(manifest.records) ? manifest.records : []);
  manifest.recordsSha256 = recordsSha256(Array.isArray(manifest.records) ? manifest.records : []);
  return manifest;
}

export function validateDiffManifest(manifest, options = {}) {
  const errors = [];
  const enforcePinnedDigest = options.enforcePinnedDigest !== false;

  if (!isPlainObject(manifest)) return ['manifest must be an object'];
  validateExactKeys(manifest, TOP_LEVEL_KEYS, 'manifest', errors);

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must equal ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (manifest.manifestType !== MANIFEST_TYPE) {
    errors.push(`manifestType must equal ${MANIFEST_TYPE}`);
  }

  if (!isPlainObject(manifest.sourceRepository)) {
    errors.push('sourceRepository must be an object');
  } else {
    validateExactKeys(manifest.sourceRepository, REPOSITORY_KEYS, 'sourceRepository', errors);
    if (manifest.sourceRepository.identity !== SOURCE_REPOSITORY_IDENTITY) {
      errors.push(`sourceRepository.identity must equal ${SOURCE_REPOSITORY_IDENTITY}`);
    }
    if (manifest.sourceRepository.canonicalUrl !== SOURCE_REPOSITORY_URL) {
      errors.push(`sourceRepository.canonicalUrl must equal ${SOURCE_REPOSITORY_URL}`);
    }
    if (manifest.sourceRepository.objectFormat !== SOURCE_OBJECT_FORMAT) {
      errors.push(`sourceRepository.objectFormat must equal ${SOURCE_OBJECT_FORMAT}`);
    }
  }

  if (!isPlainObject(manifest.sourceRange)) {
    errors.push('sourceRange must be an object');
  } else {
    validateExactKeys(manifest.sourceRange, RANGE_KEYS, 'sourceRange', errors);
    if (manifest.sourceRange.base !== SOURCE_BASE) {
      errors.push(`sourceRange.base must equal ${SOURCE_BASE}`);
    }
    if (manifest.sourceRange.head !== SOURCE_HEAD) {
      errors.push(`sourceRange.head must equal ${SOURCE_HEAD}`);
    }
    if (manifest.sourceRange.notation !== 'base..head') {
      errors.push('sourceRange.notation must equal base..head');
    }
    if (manifest.sourceRange.renameDetection !== 'exact-100-percent') {
      errors.push('sourceRange.renameDetection must equal exact-100-percent');
    }
  }

  if (!Array.isArray(manifest.records)) {
    errors.push('records must be an array');
    return errors;
  }
  if (manifest.recordCount !== EXPECTED_RECORD_COUNT) {
    errors.push(`recordCount must equal ${EXPECTED_RECORD_COUNT}`);
  }
  if (manifest.recordCount !== manifest.records.length) {
    errors.push('recordCount does not match records.length');
  }

  const computedCounts = countChanges(manifest.records);
  if (!isPlainObject(manifest.changeCounts)) {
    errors.push('changeCounts must be an object');
  } else {
    validateExactKeys(manifest.changeCounts, COUNT_KEYS, 'changeCounts', errors);
    for (const type of CHANGE_TYPES) {
      if (manifest.changeCounts[type] !== computedCounts[type]) {
        errors.push(`changeCounts.${type} does not match records`);
      }
    }
  }

  if (manifest.recordsDigestAlgorithm !== RECORDS_DIGEST_ALGORITHM) {
    errors.push(`recordsDigestAlgorithm must equal ${RECORDS_DIGEST_ALGORITHM}`);
  }
  const computedDigest = recordsSha256(manifest.records);
  if (manifest.recordsSha256 !== computedDigest) {
    errors.push('recordsSha256 does not match records');
  }
  if (enforcePinnedDigest && manifest.recordsSha256 !== EXPECTED_RECORDS_SHA256) {
    errors.push('recordsSha256 does not match the validator-pinned source diff');
  }

  const identities = new Set();
  for (const [index, record] of manifest.records.entries()) {
    const label = `records[${index}]`;
    if (!isPlainObject(record)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    validateExactKeys(record, RECORD_KEYS, label, errors);
    if (record.sequence !== index + 1) {
      errors.push(`${label}.sequence must equal ${index + 1}`);
    }

    const identity = JSON.stringify([
      record.status,
      record.oldPath,
      record.newPath,
    ]);
    if (identities.has(identity)) errors.push(`${label} duplicates another diff record`);
    identities.add(identity);

    validateRecord(record, label, errors);
  }

  return errors;
}

export function loadSourceRecords(sourceRepo) {
  assertSourceRepository(sourceRepo);
  const raw = execFileSync(
    'git',
    [
      '--no-replace-objects',
      '-c',
      'diff.renameLimit=1000000',
      'diff',
      '--raw',
      '--no-abbrev',
      '--find-renames=100%',
      '-z',
      `${SOURCE_BASE}..${SOURCE_HEAD}`,
      '--',
    ],
    {
      cwd: sourceRepo,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return parseRawDiff(raw);
}

export function compareManifestToSource(manifest, sourceRepo) {
  const generated = createDiffManifest(loadSourceRecords(sourceRepo));
  const errors = validateDiffManifest(generated);
  if (errors.length > 0) {
    return errors.map(error => `generated source manifest: ${error}`);
  }
  if (JSON.stringify(manifest) !== JSON.stringify(generated)) {
    return ['committed manifest differs from the supplied C3 source repository'];
  }
  return [];
}

export function parseRawDiff(raw) {
  const fields = splitNul(raw);
  const records = [];

  for (let index = 0; index < fields.length;) {
    const header = decodePath(fields[index++], 'raw diff header');
    if (header === '') continue;
    const match = header.match(
      /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z][0-9]*)$/,
    );
    if (!match) throw new Error(`Unrecognized raw diff header: ${header}`);

    const [, oldModeRaw, newModeRaw, oldBlobRaw, newBlobRaw, status] = match;
    const firstPath = decodePath(fields[index++], `path for ${status}`);
    let oldPath;
    let newPath;
    if (/^R[0-9]+$/.test(status)) {
      oldPath = firstPath;
      newPath = decodePath(fields[index++], `new path for ${status}`);
    } else if (status === 'A') {
      oldPath = null;
      newPath = firstPath;
    } else if (status === 'D') {
      oldPath = firstPath;
      newPath = null;
    } else if (status === 'M') {
      oldPath = firstPath;
      newPath = firstPath;
    } else {
      throw new Error(`Unsupported source diff status: ${status}`);
    }

    records.push({
      sequence: records.length + 1,
      status,
      changeType: status === 'A'
        ? 'ADD'
        : status === 'D'
          ? 'DELETE'
          : status === 'M'
            ? 'MODIFY'
            : 'RENAME',
      oldPath,
      newPath,
      oldBlob: oldBlobRaw === ZERO_OBJECT_ID ? null : oldBlobRaw,
      newBlob: newBlobRaw === ZERO_OBJECT_ID ? null : newBlobRaw,
      oldMode: oldModeRaw === '000000' ? null : oldModeRaw,
      newMode: newModeRaw === '000000' ? null : newModeRaw,
    });
  }

  return records;
}

function assertSourceRepository(sourceRepo) {
  const revParse = ref => execFileSync(
    'git',
    ['--no-replace-objects', 'rev-parse', '--verify', `${ref}^{commit}`],
    {
      cwd: sourceRepo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  if (revParse(SOURCE_BASE) !== SOURCE_BASE) {
    throw new Error(`C3 source repository does not resolve base ${SOURCE_BASE}`);
  }
  if (revParse(SOURCE_HEAD) !== SOURCE_HEAD) {
    throw new Error(`C3 source repository does not resolve head ${SOURCE_HEAD}`);
  }
  const objectFormat = execFileSync(
    'git',
    ['rev-parse', '--show-object-format'],
    {
      cwd: sourceRepo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  if (objectFormat !== SOURCE_OBJECT_FORMAT) {
    throw new Error(`C3 source repository object format is ${objectFormat}`);
  }
  const origin = execFileSync(
    'git',
    ['remote', 'get-url', 'origin'],
    {
      cwd: sourceRepo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  if (normalizeRepositoryIdentity(origin) !== SOURCE_REPOSITORY_IDENTITY) {
    throw new Error(`source repository origin is not ${SOURCE_REPOSITORY_IDENTITY}`);
  }
}

function normalizeRepositoryIdentity(remote) {
  return remote
    .replace(/^git@github\.com:/, 'github.com/')
    .replace(/^https?:\/\/github\.com\//, 'github.com/')
    .replace(/\.git$/, '');
}

function validateRecord(record, label, errors) {
  const mode = value => value === null || /^[0-7]{6}$/.test(value);
  const blob = value => value === null || /^[a-f0-9]{40}$/.test(value);
  if (!mode(record.oldMode)) errors.push(`${label}.oldMode must be a six-digit mode or null`);
  if (!mode(record.newMode)) errors.push(`${label}.newMode must be a six-digit mode or null`);
  if (!blob(record.oldBlob)) errors.push(`${label}.oldBlob must be a full SHA-1 or null`);
  if (!blob(record.newBlob)) errors.push(`${label}.newBlob must be a full SHA-1 or null`);
  if (!safePathOrNull(record.oldPath)) errors.push(`${label}.oldPath is unsafe or invalid`);
  if (!safePathOrNull(record.newPath)) errors.push(`${label}.newPath is unsafe or invalid`);

  if (record.status === 'A' && record.changeType === 'ADD') {
    requireSides(record, label, errors, {
      oldPath: null,
      oldBlob: null,
      oldMode: null,
      newPath: 'value',
      newBlob: 'value',
      newMode: 'value',
    });
    return;
  }
  if (record.status === 'D' && record.changeType === 'DELETE') {
    requireSides(record, label, errors, {
      oldPath: 'value',
      oldBlob: 'value',
      oldMode: 'value',
      newPath: null,
      newBlob: null,
      newMode: null,
    });
    return;
  }
  if (record.status === 'M' && record.changeType === 'MODIFY') {
    requireSides(record, label, errors, {
      oldPath: 'value',
      oldBlob: 'value',
      oldMode: 'value',
      newPath: 'value',
      newBlob: 'value',
      newMode: 'value',
    });
    if (record.oldPath !== record.newPath) errors.push(`${label} modify paths must match`);
    if (record.oldBlob === record.newBlob && record.oldMode === record.newMode) {
      errors.push(`${label} modify record carries no blob or mode change`);
    }
    return;
  }
  if (record.status === 'R100' && record.changeType === 'RENAME') {
    requireSides(record, label, errors, {
      oldPath: 'value',
      oldBlob: 'value',
      oldMode: 'value',
      newPath: 'value',
      newBlob: 'value',
      newMode: 'value',
    });
    if (record.oldPath === record.newPath) errors.push(`${label} rename paths must differ`);
    if (record.oldBlob !== record.newBlob) errors.push(`${label} R100 blobs must match`);
    return;
  }
  errors.push(`${label} has unsupported status/changeType ${record.status}/${record.changeType}`);
}

function requireSides(record, label, errors, expected) {
  for (const [key, expectation] of Object.entries(expected)) {
    if (expectation === null && record[key] !== null) {
      errors.push(`${label}.${key} must be null for ${record.changeType}`);
    }
    if (expectation === 'value' && record[key] === null) {
      errors.push(`${label}.${key} must be present for ${record.changeType}`);
    }
  }
}

function safePathOrNull(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function validateExactKeys(value, expected, label, errors) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    errors.push(`${label} fields must equal ${wanted.join(', ')}`);
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function splitNul(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const fields = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 0) continue;
    fields.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start < buffer.length) fields.push(buffer.subarray(start));
  return fields;
}

function decodePath(buffer, label) {
  if (!buffer) throw new Error(`Missing ${label}`);
  const decoded = buffer.toString('utf8');
  if (decoded.includes('\uFFFD')) throw new Error(`${label} is not valid UTF-8`);
  return decoded;
}
