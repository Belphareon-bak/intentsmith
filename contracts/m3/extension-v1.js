import path from 'node:path';

import {
  hasOwn,
  isJsonValue,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const EXTENSION_CONTRACT_VERSION = 1;
export const EXTENSION_CONTRACT_STAGE = 'PROVISIONAL_V1';
export const EXTENSION_MANIFEST_CONTRACT = 'ExtensionManifest';
export const EXTENSION_CONTEXT_CONTRACT = 'ExtensionContext';

export const EXTENSION_KIND = Object.freeze({
  EXPERTISE: 'expertise',
  SKILL: 'skill',
  SPECIALIST: 'specialist',
  AGENT: 'agent',
});

export const EXTENSION_HOST_CAPABILITY = Object.freeze({
  LOGGER: 'core.logger.v1',
  SPECIALIST_RUNTIME: 'specialist.runtime.v1',
  TOOL_ADAPTER: 'specialist.tool-adapter.v1',
  KNOWLEDGE_BASE: 'specialist.knowledge-base.v1',
  AUTO_SELECT_REGISTRY: 'specialist.registry.auto-select.v1',
  SCENARIO_REGISTRY: 'specialist.registry.scenario.v1',
  CRE_REGISTRY: 'specialist.registry.cre.v1',
  TOOL_EXECUTOR_REGISTRY: 'specialist.registry.tool-executor.v1',
  CAPABILITY_REGISTRY: 'specialist.registry.capability.v1',
  EXPERTISE_REGISTRY: 'specialist.registry.expertise.v1',
});

const KINDS = new Set(Object.values(EXTENSION_KIND));
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CORE_CONTRACT_PATTERN = /^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?: <(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))?$/;
const EXTENSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const HOST_CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\.v[1-9]\d*$/;
const PROVIDED_CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z][a-z0-9_]*$/;
const DOMAIN_PATTERN = /^[a-z0-9_]+$/;
const SPECIALIST_TYPES = new Set(['domain', 'utility', 'integration']);
const LEGACY_OPTIONAL_CAPABILITIES = Object.freeze([
  EXTENSION_HOST_CAPABILITY.AUTO_SELECT_REGISTRY,
  EXTENSION_HOST_CAPABILITY.CAPABILITY_REGISTRY,
  EXTENSION_HOST_CAPABILITY.CRE_REGISTRY,
  EXTENSION_HOST_CAPABILITY.EXPERTISE_REGISTRY,
  EXTENSION_HOST_CAPABILITY.KNOWLEDGE_BASE,
  EXTENSION_HOST_CAPABILITY.LOGGER,
  EXTENSION_HOST_CAPABILITY.SCENARIO_REGISTRY,
  EXTENSION_HOST_CAPABILITY.TOOL_EXECUTOR_REGISTRY,
].sort());

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function uniqueSortedStrings(values) {
  return [...new Set(values)].sort(compareUtf8);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringArray(value, pattern, context) {
  const errors = [];
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const seen = new Set();
  let previous = null;
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item)) {
      errors.push(`${context}:invalid-item`);
      continue;
    }
    if (seen.has(item)) errors.push(`${context}:duplicate-item`);
    if (previous !== null && compareUtf8(previous, item) >= 0) {
      errors.push(`${context}:not-canonical-order`);
    }
    seen.add(item);
    previous = item;
  }
  return errors;
}

function isSafePackagePath(value) {
  if (
    typeof value !== 'string'
    || !value.startsWith('./')
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
  ) return false;
  const segments = value.slice(2).split('/');
  return segments.length > 0
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && `./${path.posix.normalize(value.slice(2))}` === value;
}

function validateCoreContract(value, context) {
  return typeof value === 'string' && CORE_CONTRACT_PATTERN.test(value)
    ? []
    : [`${context}:invalid-coreContract`];
}

function validateTool(value, index) {
  const context = `extension-manifest.payload.tools[${index}]`;
  const errors = validateExactKeys(value, ['id', 'name', 'module', 'function'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!TOOL_ID_PATTERN.test(value.id)) errors.push(`${context}:invalid-id`);
  if (!isNonEmptyString(value.name)) errors.push(`${context}:invalid-name`);
  if (!isSafePackagePath(value.module)) errors.push(`${context}:invalid-module`);
  if (typeof value.function !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.function)) {
    errors.push(`${context}:invalid-function`);
  }
  return errors;
}

function validateDependencies(value) {
  const context = 'extension-manifest.payload.dependencies';
  if (!isPlainRecord(value)) return [`${context}:not-object`];
  const errors = [];
  for (const [id, requirement] of Object.entries(value)) {
    if (!EXTENSION_ID_PATTERN.test(id)) errors.push(`${context}:invalid-id`);
    errors.push(...validateCoreContract(requirement, `${context}.${id}`));
  }
  return errors;
}

function validateSpecialistPayload(value) {
  const context = 'extension-manifest.payload';
  const errors = validateExactKeys(
    value,
    [
      'name',
      'description',
      'author',
      'domain',
      'type',
      'entry',
      'tools',
      'providedCapabilities',
      'expertises',
      'knowledgePacks',
      'migrations',
      'settings',
      'dependencies',
      'enabledByDefault',
    ],
    ['defaultExpertise'],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!isNonEmptyString(value.name)) errors.push(`${context}:invalid-name`);
  if (typeof value.description !== 'string') errors.push(`${context}:invalid-description`);
  if (!isNonEmptyString(value.author)) errors.push(`${context}:invalid-author`);
  if (typeof value.domain !== 'string' || !DOMAIN_PATTERN.test(value.domain)) {
    errors.push(`${context}:invalid-domain`);
  }
  if (!SPECIALIST_TYPES.has(value.type)) errors.push(`${context}:invalid-type`);
  if (!isSafePackagePath(value.entry)) errors.push(`${context}:invalid-entry`);
  if (!Array.isArray(value.tools) || value.tools.length === 0) {
    errors.push(`${context}:invalid-tools`);
  } else {
    value.tools.forEach((tool, index) => errors.push(...validateTool(tool, index)));
    const ids = value.tools.map((tool) => tool?.id);
    if (new Set(ids).size !== ids.length) errors.push(`${context}:duplicate-tool-id`);
  }
  errors.push(...validateStringArray(
    value.providedCapabilities,
    PROVIDED_CAPABILITY_PATTERN,
    `${context}.providedCapabilities`,
  ));
  errors.push(...validateStringArray(value.expertises, EXTENSION_ID_PATTERN, `${context}.expertises`));
  for (const key of ['knowledgePacks', 'migrations']) {
    errors.push(...validateStringArray(value[key], EXTENSION_ID_PATTERN, `${context}.${key}`));
  }
  if (!isPlainRecord(value.settings) || !isJsonValue(value.settings)) {
    errors.push(`${context}:invalid-settings`);
  }
  errors.push(...validateDependencies(value.dependencies));
  if (typeof value.enabledByDefault !== 'boolean') {
    errors.push(`${context}:invalid-enabledByDefault`);
  }
  if (hasOwn(value, 'defaultExpertise') && !isSafePackagePath(value.defaultExpertise)) {
    errors.push(`${context}:invalid-defaultExpertise`);
  }
  return errors;
}

function validateDefinitionPayload(value) {
  const context = 'extension-manifest.payload';
  const errors = validateExactKeys(value, ['definition', 'enabledByDefault'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isPlainRecord(value.definition) || !isJsonValue(value.definition)) {
    errors.push(`${context}:invalid-definition`);
  }
  if (typeof value.enabledByDefault !== 'boolean') {
    errors.push(`${context}:invalid-enabledByDefault`);
  }
  return errors;
}

export function validateExtensionManifestV1(value, expectedKind = null) {
  const context = 'extension-manifest';
  const errors = validateExactKeys(
    value,
    [
      'contract',
      'version',
      'kind',
      'id',
      'moduleVersion',
      'coreContract',
      'requiredCapabilities',
      'optionalCapabilities',
      'payload',
    ],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== EXTENSION_MANIFEST_CONTRACT) errors.push(`${context}:invalid-contract`);
  if (value.version !== EXTENSION_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!KINDS.has(value.kind)) errors.push(`${context}:invalid-kind`);
  if (expectedKind !== null && value.kind !== expectedKind) errors.push(`${context}:unexpected-kind`);
  if (typeof value.id !== 'string' || !EXTENSION_ID_PATTERN.test(value.id)) {
    errors.push(`${context}:invalid-id`);
  }
  if (typeof value.moduleVersion !== 'string' || !SEMVER_PATTERN.test(value.moduleVersion)) {
    errors.push(`${context}:invalid-moduleVersion`);
  }
  errors.push(...validateCoreContract(value.coreContract, context));
  errors.push(...validateStringArray(
    value.requiredCapabilities,
    HOST_CAPABILITY_PATTERN,
    `${context}.requiredCapabilities`,
  ));
  errors.push(...validateStringArray(
    value.optionalCapabilities,
    HOST_CAPABILITY_PATTERN,
    `${context}.optionalCapabilities`,
  ));
  if (
    Array.isArray(value.requiredCapabilities)
    && Array.isArray(value.optionalCapabilities)
    && value.requiredCapabilities.some((capability) => value.optionalCapabilities.includes(capability))
  ) errors.push(`${context}:capability-required-and-optional`);
  if (value.kind === EXTENSION_KIND.SPECIALIST) {
    errors.push(...validateSpecialistPayload(value.payload));
  } else {
    errors.push(...validateDefinitionPayload(value.payload));
  }
  return validationResult(errors, value);
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

function parseVersion(value) {
  const match = typeof value === 'string' ? value.match(SEMVER_PATTERN) : null;
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function satisfiesCoreContract(coreContract, coreVersion) {
  const range = typeof coreContract === 'string' ? coreContract.match(CORE_CONTRACT_PATTERN) : null;
  const current = parseVersion(coreVersion);
  if (!range || !current) return false;
  const minimum = range.slice(1, 4).map(Number);
  if (compareVersions(current, minimum) < 0) return false;
  if (range[4] !== undefined) {
    const maximum = range.slice(4, 7).map(Number);
    if (compareVersions(current, maximum) >= 0) return false;
  }
  return true;
}

const LEGACY_SPECIALIST_KEYS = Object.freeze([
  'id',
  'version',
  'manifestVersion',
  'name',
  'description',
  'author',
  'domain',
  'type',
  'engine',
  'entry',
  'tools',
  'capabilities',
  'expertises',
  'defaultExpertise',
  'knowledge_packs',
  'migrations',
  'settings',
  'dependencies',
  'enabledByDefault',
  'requiredCapabilities',
  'optionalCapabilities',
]);

export function canonicalizeLegacySpecialistManifest(value) {
  const errors = validateExactKeys(
    value,
    ['id', 'version', 'name', 'domain', 'engine', 'entry', 'tools'],
    LEGACY_SPECIALIST_KEYS.filter((key) => ![
      'id', 'version', 'name', 'domain', 'engine', 'entry', 'tools',
    ].includes(key)),
    'legacy-specialist-manifest',
  );
  if (!isPlainRecord(value)) throw new TypeError(errors.join(', '));
  const manifestVersion = value.manifestVersion ?? 1;
  if (manifestVersion !== 1 && manifestVersion !== 2) {
    errors.push('legacy-specialist-manifest:invalid-manifestVersion');
  }
  if (errors.length > 0) throw new TypeError(errors.join(', '));

  const requiredCapabilities = uniqueSortedStrings(
    value.requiredCapabilities || [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME],
  );
  const optionalCapabilities = uniqueSortedStrings(
    value.optionalCapabilities || LEGACY_OPTIONAL_CAPABILITIES,
  ).filter((capability) => !requiredCapabilities.includes(capability));
  const payload = {
    name: value.name,
    description: value.description || '',
    author: value.author || 'legacy',
    domain: value.domain,
    type: value.type || 'domain',
    entry: value.entry,
    tools: (value.tools || []).map((tool) => ({
      id: tool.id,
      name: tool.name,
      module: tool.module,
      function: tool.function,
    })),
    providedCapabilities: uniqueSortedStrings(value.capabilities || []),
    expertises: uniqueSortedStrings(value.expertises || []),
    knowledgePacks: uniqueSortedStrings(value.knowledge_packs || []),
    migrations: uniqueSortedStrings(value.migrations || []),
    settings: value.settings || {},
    dependencies: value.dependencies || {},
    enabledByDefault: value.enabledByDefault === true,
  };
  if (value.defaultExpertise) payload.defaultExpertise = value.defaultExpertise;

  const canonical = {
    contract: EXTENSION_MANIFEST_CONTRACT,
    version: EXTENSION_CONTRACT_VERSION,
    kind: EXTENSION_KIND.SPECIALIST,
    id: value.id,
    moduleVersion: value.version,
    coreContract: value.engine,
    requiredCapabilities,
    optionalCapabilities,
    payload,
  };
  const result = validateExtensionManifestV1(canonical, EXTENSION_KIND.SPECIALIST);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return deepFreeze(canonical);
}

export function canonicalizeExtensionManifestV1(value, expectedKind = null) {
  const result = validateExtensionManifestV1(value, expectedKind);
  if (!result.valid) throw new TypeError(result.errors.join(', '));
  return deepFreeze(structuredClone(value));
}

export function legacySpecialistManifestView(value) {
  const manifest = canonicalizeExtensionManifestV1(value, EXTENSION_KIND.SPECIALIST);
  const payload = manifest.payload;
  const legacy = {
    id: manifest.id,
    version: manifest.moduleVersion,
    manifestVersion: 2,
    name: payload.name,
    description: payload.description,
    author: payload.author,
    domain: payload.domain,
    type: payload.type,
    engine: manifest.coreContract,
    entry: payload.entry,
    tools: payload.tools.map((tool) => ({ ...tool })),
    capabilities: [...payload.providedCapabilities],
    expertises: [...payload.expertises],
    knowledge_packs: [...payload.knowledgePacks],
    migrations: [...payload.migrations],
    settings: structuredClone(payload.settings),
    dependencies: structuredClone(payload.dependencies),
    enabledByDefault: payload.enabledByDefault,
    requiredCapabilities: [...manifest.requiredCapabilities],
    optionalCapabilities: [...manifest.optionalCapabilities],
  };
  if (payload.defaultExpertise) legacy.defaultExpertise = payload.defaultExpertise;
  return deepFreeze(legacy);
}

export function createExtensionContextV1({ manifest, hostCapabilities }) {
  const canonicalManifest = canonicalizeExtensionManifestV1(manifest);
  if (!isPlainRecord(hostCapabilities)) {
    throw new TypeError('extension-context:hostCapabilities-not-object');
  }
  const declared = new Set([
    ...canonicalManifest.requiredCapabilities,
    ...canonicalManifest.optionalCapabilities,
  ]);
  for (const capability of canonicalManifest.requiredCapabilities) {
    if (!hasOwn(hostCapabilities, capability) || hostCapabilities[capability] == null) {
      throw new TypeError(`extension-context:missing-required-capability:${capability}`);
    }
  }

  const capabilities = {};
  for (const capability of declared) {
    if (hasOwn(hostCapabilities, capability) && hostCapabilities[capability] != null) {
      capabilities[capability] = hostCapabilities[capability];
    }
  }
  Object.freeze(capabilities);

  const getCapability = (capability) => {
    if (!declared.has(capability)) {
      throw new TypeError(`extension-context:undeclared-capability:${capability}`);
    }
    return hasOwn(capabilities, capability) ? capabilities[capability] : null;
  };
  const requireCapability = (capability) => {
    const resolved = getCapability(capability);
    if (resolved === null) {
      throw new TypeError(`extension-context:capability-unavailable:${capability}`);
    }
    return resolved;
  };

  return Object.freeze({
    contract: EXTENSION_CONTEXT_CONTRACT,
    version: EXTENSION_CONTRACT_VERSION,
    kind: canonicalManifest.kind,
    extensionId: canonicalManifest.id,
    manifest: canonicalManifest,
    capabilities,
    getCapability,
    requireCapability,
  });
}
