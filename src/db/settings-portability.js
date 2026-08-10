// Default-deny portable settings profile.
//
// This module deliberately does not try to identify every possible secret.
// Only the exact, bounded UI preferences below may cross an installation
// boundary. They are safe to transport, but this profile does not claim that
// every preference is consumed by every current UI. Every other current or
// future settings path remains local.

export const SETTINGS_BACKUP_KIND = 'INTENTSMITH_SETTINGS_BACKUP';
export const SETTINGS_BACKUP_SCHEMA_VERSION = 2;
export const SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION = 1;
export const SETTINGS_PORTABLE_PROFILE = 'UX_PREFERENCES_V1';

const enumValue = values => value => values.includes(value);
const booleanValue = value => typeof value === 'boolean';
const integerValue = (minimum, maximum) => value => (
  Number.isSafeInteger(value) && value >= minimum && value <= maximum
);

const PORTABLE_FIELDS = Object.freeze([
  Object.freeze({
    pointer: '/appearance/accentColor',
    segments: Object.freeze(['appearance', 'accentColor']),
    valid: value => typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/u.test(value),
  }),
  Object.freeze({
    pointer: '/appearance/fontFamily',
    segments: Object.freeze(['appearance', 'fontFamily']),
    valid: enumValue(['system', 'inter', 'roboto', 'source-code']),
  }),
  Object.freeze({
    pointer: '/appearance/fontSize',
    segments: Object.freeze(['appearance', 'fontSize']),
    valid: integerValue(12, 20),
  }),
  Object.freeze({
    pointer: '/appearance/theme',
    segments: Object.freeze(['appearance', 'theme']),
    valid: enumValue(['dark', 'light', 'system']),
  }),
  Object.freeze({
    pointer: '/c3.language',
    segments: Object.freeze(['c3.language']),
    valid: enumValue(['cs', 'en']),
  }),
  Object.freeze({
    pointer: '/c3.output.codeBlocks',
    segments: Object.freeze(['c3.output.codeBlocks']),
    valid: booleanValue,
  }),
  Object.freeze({
    pointer: '/c3.output.markdownRendering',
    segments: Object.freeze(['c3.output.markdownRendering']),
    valid: booleanValue,
  }),
  Object.freeze({
    pointer: '/c3.output.syntaxHighlight',
    segments: Object.freeze(['c3.output.syntaxHighlight']),
    valid: booleanValue,
  }),
  Object.freeze({
    pointer: '/output/codeStyle',
    segments: Object.freeze(['output', 'codeStyle']),
    valid: enumValue(['default', 'airbnb', 'google', 'standard']),
  }),
  Object.freeze({
    pointer: '/output/defaultFormat',
    segments: Object.freeze(['output', 'defaultFormat']),
    valid: enumValue(['markdown', 'json', 'csv', 'yaml']),
  }),
  Object.freeze({
    pointer: '/output/namingConvention',
    segments: Object.freeze(['output', 'namingConvention']),
    valid: enumValue(['camelCase', 'snake_case', 'kebab-case', 'PascalCase']),
  }),
]);

export const SETTINGS_PORTABLE_PATHS = Object.freeze(
  PORTABLE_FIELDS.map(field => field.pointer),
);

const PORTABLE_BY_POINTER = new Map(
  PORTABLE_FIELDS.map(field => [field.pointer, field]),
);

const BACKUP_V1_KEYS = Object.freeze([
  'generalSettings',
  'kind',
  'modelAutomationPolicy',
  'omittedSensitiveKeys',
  'schemaVersion',
]);
const BACKUP_V2_KEYS = Object.freeze([
  'kind',
  'modelAutomationPolicy',
  'omissions',
  'schemaVersion',
  'settingsProjection',
]);
const PROJECTION_KEYS = Object.freeze(['profile', 'values']);
const OMISSION_KEYS = Object.freeze([
  'excluded',
  'scope',
  'sourceHadExcludedPaths',
  'strategy',
]);

export class SettingsPortabilityError extends Error {
  constructor(code, message, details = null, options = {}) {
    super(message, options);
    this.name = 'SettingsPortabilityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null, cause = null) {
  throw new SettingsPortabilityError(code, message, details, cause ? { cause } : {});
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(code, `${label} must contain the exact supported fields`, {
      expected,
      actual,
    });
  }
}

function assertSafeJson(value, path = [], seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains a non-finite number', {
        path: encodeJsonPointer(path),
      });
    }
    return;
  }
  if (typeof value !== 'object') {
    fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains a non-JSON value', {
      path: encodeJsonPointer(path),
      type: typeof value,
    });
  }
  if (seen.has(value)) {
    fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains a cycle', {
      path: encodeJsonPointer(path),
    });
  }
  seen.add(value);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains a non-plain object', {
      path: encodeJsonPointer(path),
    });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains a symbol key', {
        path: encodeJsonPointer(path),
      });
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail('SETTINGS_PORTABILITY_JSON_INVALID', 'Settings data contains an accessor', {
        path: encodeJsonPointer([...path, key]),
      });
    }
    assertSafeJson(descriptor.value, [...path, key], seen);
  }
  seen.delete(value);
}

export function cloneSettingsDocument(value) {
  if (!isPlainObject(value)) {
    fail('SETTINGS_PORTABILITY_DOCUMENT_INVALID', 'Settings document must be a plain object');
  }
  assertSafeJson(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    fail(
      'SETTINGS_PORTABILITY_JSON_INVALID',
      'Settings document cannot be serialized',
      null,
      error,
    );
  }
}

export function encodeJsonPointer(segments) {
  if (!Array.isArray(segments) || segments.some(segment => typeof segment !== 'string')) {
    fail('SETTINGS_PORTABILITY_POINTER_INVALID', 'JSON Pointer segments must be strings');
  }
  if (segments.length === 0) return '';
  return `/${segments.map(segment => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function readPath(document, segments) {
  let current = document;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function setPath(document, segments, value) {
  let current = document;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (!Object.hasOwn(current, segment) || !isPlainObject(current[segment])) {
      // A scalar/null at a profile-owned container is malformed legacy state,
      // not local authority that can coexist with the portable leaves below
      // it. Replace only that exact container; valid sibling data remains
      // untouched.
      Object.defineProperty(current, segment, {
        configurable: true,
        enumerable: true,
        value: {},
        writable: true,
      });
    }
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function validatePortableValue(field, value) {
  if (!field.valid(value)) {
    fail(
      'SETTINGS_PORTABILITY_VALUE_INVALID',
      'Portable setting has an unsupported value',
      { path: field.pointer },
    );
  }
  return value;
}

function projectPresentValues(document) {
  const values = {};
  for (const field of PORTABLE_FIELDS) {
    const candidate = readPath(document, field.segments);
    if (candidate.found) values[field.pointer] = validatePortableValue(field, candidate.value);
  }
  return values;
}

function collectExcludedPaths(document) {
  const prefixes = new Set();
  for (const field of PORTABLE_FIELDS) {
    for (let length = 1; length < field.segments.length; length++) {
      prefixes.add(encodeJsonPointer(field.segments.slice(0, length)));
    }
  }
  const excluded = [];
  const visit = (value, segments) => {
    for (const key of Object.keys(value).sort()) {
      const nextSegments = [...segments, key];
      const pointer = encodeJsonPointer(nextSegments);
      if (PORTABLE_BY_POINTER.has(pointer)) continue;
      if (prefixes.has(pointer) && isPlainObject(value[key])) {
        visit(value[key], nextSegments);
      } else {
        excluded.push(pointer);
      }
    }
  };
  visit(document, []);
  return excluded.sort();
}

function validateProjection(value) {
  assertExactKeys(
    value,
    PROJECTION_KEYS,
    'SETTINGS_PORTABILITY_PROJECTION_INVALID',
    'Settings projection',
  );
  if (value.profile !== SETTINGS_PORTABLE_PROFILE) {
    fail('SETTINGS_PORTABILITY_PROFILE_UNSUPPORTED', 'Portable settings profile is unsupported');
  }
  if (!isPlainObject(value.values)) {
    fail(
      'SETTINGS_PORTABILITY_PROJECTION_INVALID',
      'Portable settings values must be a plain object',
    );
  }
  const pointers = Object.keys(value.values).sort();
  if (pointers.some(pointer => !PORTABLE_BY_POINTER.has(pointer))) {
    fail(
      'SETTINGS_PORTABILITY_PROJECTION_INVALID',
      'Portable settings values contain an unsupported path',
      { actual: pointers },
    );
  }
  const values = {};
  for (const field of PORTABLE_FIELDS) {
    if (Object.hasOwn(value.values, field.pointer)) {
      values[field.pointer] = validatePortableValue(field, value.values[field.pointer]);
    }
  }
  return values;
}

function validateOmissions(value) {
  assertExactKeys(
    value,
    OMISSION_KEYS,
    'SETTINGS_PORTABILITY_OMISSIONS_INVALID',
    'Settings omissions',
  );
  if (value.strategy !== 'DEFAULT_DENY'
    || value.scope !== 'GENERAL_SETTINGS'
    || value.excluded !== 'ALL_PATHS_NOT_IN_PROFILE'
    || typeof value.sourceHadExcludedPaths !== 'boolean') {
    fail(
      'SETTINGS_PORTABILITY_OMISSIONS_INVALID',
      'Settings omissions do not describe the supported default-deny strategy',
    );
  }
}

function validateLegacyOmissions(value) {
  if (!Array.isArray(value)
    || value.some(item => typeof item !== 'string')
    || new Set(value).size !== value.length
    || value.join('\0') !== [...value].sort().join('\0')) {
    fail(
      'SETTINGS_PORTABILITY_LEGACY_OMISSIONS_INVALID',
      'Legacy omittedSensitiveKeys must be a sorted unique string list',
    );
  }
}

export function createSettingsBackup(document, modelAutomationPolicy) {
  const source = cloneSettingsDocument(document);
  const excludedPaths = collectExcludedPaths(source);
  return {
    backup: {
      kind: SETTINGS_BACKUP_KIND,
      schemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
      settingsProjection: {
        profile: SETTINGS_PORTABLE_PROFILE,
        // A portable backup represents values actually chosen on the source
        // installation. Fabricating defaults for absent paths would silently
        // overwrite unrelated destination preferences on import.
        values: projectPresentValues(source),
      },
      modelAutomationPolicy,
      omissions: {
        strategy: 'DEFAULT_DENY',
        scope: 'GENERAL_SETTINGS',
        excluded: 'ALL_PATHS_NOT_IN_PROFILE',
        sourceHadExcludedPaths: excludedPaths.length > 0,
      },
    },
    excludedPaths,
  };
}

export function parseSettingsBackup(value) {
  if (!isPlainObject(value)) {
    fail('SETTINGS_PORTABILITY_BACKUP_INVALID', 'Settings backup must be a plain object');
  }
  assertSafeJson(value);

  const hasEnvelopeMarker = Object.hasOwn(value, 'kind') || Object.hasOwn(value, 'schemaVersion');
  if (!hasEnvelopeMarker) {
    const document = cloneSettingsDocument(value);
    return {
      sourceSchemaVersion: 0,
      values: projectPresentValues(document),
      ignoredSourcePaths: collectExcludedPaths(document),
      modelAutomationPolicy: null,
    };
  }
  if (value.kind !== SETTINGS_BACKUP_KIND) {
    fail('SETTINGS_PORTABILITY_BACKUP_VERSION_UNSUPPORTED', 'Settings backup kind is unsupported');
  }

  if (value.schemaVersion === SETTINGS_BACKUP_SCHEMA_VERSION) {
    assertExactKeys(
      value,
      BACKUP_V2_KEYS,
      'SETTINGS_PORTABILITY_BACKUP_INVALID',
      'Settings backup v2',
    );
    validateOmissions(value.omissions);
    return {
      sourceSchemaVersion: SETTINGS_BACKUP_SCHEMA_VERSION,
      values: validateProjection(value.settingsProjection),
      ignoredSourcePaths: [],
      modelAutomationPolicy: value.modelAutomationPolicy,
    };
  }

  if (value.schemaVersion === SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION) {
    assertExactKeys(
      value,
      BACKUP_V1_KEYS,
      'SETTINGS_PORTABILITY_BACKUP_INVALID',
      'Settings backup v1',
    );
    validateLegacyOmissions(value.omittedSensitiveKeys);
    const document = cloneSettingsDocument(value.generalSettings);
    return {
      sourceSchemaVersion: SETTINGS_BACKUP_LEGACY_SCHEMA_VERSION,
      values: projectPresentValues(document),
      ignoredSourcePaths: collectExcludedPaths(document),
      modelAutomationPolicy: value.modelAutomationPolicy,
    };
  }

  fail(
    'SETTINGS_PORTABILITY_BACKUP_VERSION_UNSUPPORTED',
    'Settings backup schema version is unsupported',
  );
}

export function mergeSettingsProjection(destination, values) {
  const merged = cloneSettingsDocument(destination);
  if (!isPlainObject(values)) {
    fail('SETTINGS_PORTABILITY_PROJECTION_INVALID', 'Portable settings values must be a plain object');
  }
  const pointers = Object.keys(values).sort();
  if (pointers.some(pointer => !PORTABLE_BY_POINTER.has(pointer))) {
    fail(
      'SETTINGS_PORTABILITY_PROJECTION_INVALID',
      'Portable settings values contain an unsupported path',
    );
  }
  const validated = {};
  for (const field of PORTABLE_FIELDS) {
    if (Object.hasOwn(values, field.pointer)) {
      validated[field.pointer] = validatePortableValue(field, values[field.pointer]);
    }
  }
  for (const field of PORTABLE_FIELDS) {
    if (Object.hasOwn(validated, field.pointer)) {
      setPath(merged, field.segments, validated[field.pointer]);
    }
  }
  return {
    document: merged,
    appliedPortablePaths: SETTINGS_PORTABLE_PATHS.filter(pointer => Object.hasOwn(validated, pointer)),
    preservedLocalPaths: collectExcludedPaths(merged),
  };
}
