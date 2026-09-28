import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXTENSION_CONTEXT_CONTRACT,
  EXTENSION_CONTRACT_STAGE,
  EXTENSION_CONTRACT_VERSION,
  EXTENSION_HOST_CAPABILITY,
  EXTENSION_KIND,
  EXTENSION_MANIFEST_CONTRACT,
  canonicalizeExtensionManifestV1,
  canonicalizeLegacySpecialistManifest,
  createExtensionContextV1,
  legacySpecialistManifestView,
  satisfiesCoreContract,
  validateExtensionManifestV1,
} from '../contracts/m3/extension-v1.js';
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
} from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function throws(fn, expected) {
  let error = null;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof TypeError, 'operation should throw TypeError');
  assert(error.message.includes(expected), `error should include ${expected}: ${error.message}`);
  return error;
}

function definitionManifest(kind, overrides = {}) {
  return {
    contract: EXTENSION_MANIFEST_CONTRACT,
    version: EXTENSION_CONTRACT_VERSION,
    kind,
    id: `${kind}-fixture`,
    moduleVersion: '1.2.3',
    coreContract: '>=136.0.0 <137.0.0',
    requiredCapabilities: [],
    optionalCapabilities: [],
    payload: {
      definition: { id: `${kind}-fixture`, value: true },
      enabledByDefault: false,
    },
    ...overrides,
  };
}

function readSpecialist(id) {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'specialists', id, 'specialist.json'), 'utf8'),
  );
}

function canonicalSpecialist(id) {
  const raw = readSpecialist(id);
  return raw.contract === EXTENSION_MANIFEST_CONTRACT
    ? canonicalizeExtensionManifestV1(raw, EXTENSION_KIND.SPECIALIST)
    : canonicalizeLegacySpecialistManifest(raw);
}

suite('M3 ExtensionManifest V1 identity');

test('contract identity is explicit and still provisional pending operator review', () => {
  assertEqual(EXTENSION_CONTRACT_VERSION, 1);
  assertEqual(EXTENSION_CONTRACT_STAGE, 'PROVISIONAL_V1');
  assertEqual(EXTENSION_MANIFEST_CONTRACT, 'ExtensionManifest');
  assertEqual(EXTENSION_CONTEXT_CONTRACT, 'ExtensionContext');
  assertEqual(Object.keys(EXTENSION_KIND).length, 4);
});

test('expertise, skill and agent share one exact header with kind payload', () => {
  for (const kind of [EXTENSION_KIND.EXPERTISE, EXTENSION_KIND.SKILL, EXTENSION_KIND.AGENT]) {
    const manifest = definitionManifest(kind);
    const result = validateExtensionManifestV1(manifest, kind);
    assertEqual(result.valid, true, `${kind}: ${result.errors.join(', ')}`);
    const canonical = canonicalizeExtensionManifestV1(manifest, kind);
    assert(Object.isFrozen(canonical));
    assert(Object.isFrozen(canonical.payload));
    assert(Object.isFrozen(canonical.payload.definition));
  }
});

test('kind mismatch, unknown header and unknown kind payload key fail closed', () => {
  const base = definitionManifest(EXTENSION_KIND.SKILL);
  assertEqual(validateExtensionManifestV1(base, EXTENSION_KIND.AGENT).valid, false);
  assertEqual(validateExtensionManifestV1({ ...base, surprise: true }).valid, false);
  assertEqual(validateExtensionManifestV1({
    ...base,
    payload: { ...base.payload, surprise: true },
  }).valid, false);
});

test('required and optional capabilities are versioned, sorted and disjoint', () => {
  const base = definitionManifest(EXTENSION_KIND.SKILL);
  const unsorted = {
    ...base,
    requiredCapabilities: ['skill.z.v1', 'skill.a.v1'],
  };
  assert(validateExtensionManifestV1(unsorted).errors.includes(
    'extension-manifest.requiredCapabilities:not-canonical-order',
  ));
  const unversioned = { ...base, requiredCapabilities: ['skill.read'] };
  assertEqual(validateExtensionManifestV1(unversioned).valid, false);
  const overlap = {
    ...base,
    requiredCapabilities: ['skill.run.v1'],
    optionalCapabilities: ['skill.run.v1'],
  };
  assert(validateExtensionManifestV1(overlap).errors.includes(
    'extension-manifest:capability-required-and-optional',
  ));
});

suite('legacy and native specialist canonicalization');

test('all five repository packages canonicalize to exact specialist manifests', () => {
  for (const id of fs.readdirSync(path.join(ROOT, 'specialists')).sort()) {
    const raw = readSpecialist(id);
    const canonical = canonicalSpecialist(id);
    const result = validateExtensionManifestV1(canonical, EXTENSION_KIND.SPECIALIST);
    assertEqual(result.valid, true, `${id}: ${result.errors.join(', ')}`);
    assertEqual(canonical.id, raw.id);
    assertEqual(canonical.moduleVersion, raw.moduleVersion || raw.version);
    assertEqual(canonical.coreContract, raw.coreContract || raw.engine);
    assertEqual(canonical.payload.entry, raw.payload?.entry || raw.entry);
    assert(Object.isFrozen(canonical));
    assert(Object.isFrozen(canonical.payload.tools));
  }
});

test('accountant declares ToolAdapter as required registration authority', () => {
  const canonical = canonicalizeLegacySpecialistManifest(readSpecialist('accountant-cz'));
  assert(canonical.requiredCapabilities.includes(EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME));
  assert(canonical.requiredCapabilities.includes(EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER));
  assert(!canonical.optionalCapabilities.includes(EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER));
});

test('legacy compatibility fills safe defaults but rejects unknown keys', () => {
  const source = readSpecialist('dummy-logger');
  const raw = { ...source };
  delete raw.author;
  delete raw.description;
  const canonical = canonicalizeLegacySpecialistManifest(raw);
  assertEqual(canonical.payload.author, 'legacy');
  assertEqual(canonical.payload.description, '');
  assertEqual(canonical.payload.enabledByDefault, true);
  throws(
    () => canonicalizeLegacySpecialistManifest({ ...raw, ambientDb: true }),
    'unknown-ambientDb',
  );
});

test('legacy view is derived from canonical data and does not mutate it', () => {
  const canonical = canonicalSpecialist('code-reviewer');
  const legacy = legacySpecialistManifestView(canonical);
  assertEqual(legacy.id, canonical.id);
  assertEqual(legacy.version, canonical.moduleVersion);
  assertEqual(legacy.capabilities.length, canonical.payload.providedCapabilities.length);
  assert(Object.isFrozen(legacy));
  assert(Object.isFrozen(legacy.tools));
});

suite('core compatibility');

test('lower bound is inclusive and upper bound is exclusive', () => {
  assertEqual(satisfiesCoreContract('>=136.0.0 <137.0.0', '136.0.0'), true);
  assertEqual(satisfiesCoreContract('>=136.0.0 <137.0.0', '136.9.9'), true);
  assertEqual(satisfiesCoreContract('>=136.0.0 <137.0.0', '137.0.0'), false);
  assertEqual(satisfiesCoreContract('>=136.0.0 <137.0.0', '135.9.9'), false);
  assertEqual(satisfiesCoreContract('>=136.0.0', '999.0.0'), true);
});

test('malformed ranges and versions fail closed', () => {
  assertEqual(satisfiesCoreContract('*', '136.1.0'), false);
  assertEqual(satisfiesCoreContract('>=136', '136.1.0'), false);
  assertEqual(satisfiesCoreContract('>=136.0.0', 'latest'), false);
});

suite('ExtensionContext V1');

test('context exposes only declared capabilities and is frozen', () => {
  const runtime = { name: 'runtime' };
  const projectContext = { contract: 'SpecialistProjectContextCapability', version: 1 };
  const manifest = canonicalSpecialist('code-reviewer');
  const context = createExtensionContextV1({
    manifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: runtime,
      [EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT]: projectContext,
      'internal.database.v1': { forbidden: true },
    },
  });
  assertEqual(context.contract, EXTENSION_CONTEXT_CONTRACT);
  assertEqual(context.version, 1);
  assertEqual(context.kind, EXTENSION_KIND.SPECIALIST);
  assertEqual(context.extensionId, 'code-reviewer');
  assertEqual(context.requireCapability(EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME), runtime);
  assertEqual(context.requireCapability(EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT), projectContext);
  throws(() => context.getCapability(EXTENSION_HOST_CAPABILITY.LOGGER), 'undeclared-capability');
  assertEqual(Object.hasOwn(context.capabilities, 'internal.database.v1'), false);
  assertEqual(Object.hasOwn(context, 'db'), false);
  assert(Object.isFrozen(context));
  assert(Object.isFrozen(context.capabilities));
  assert(Object.isFrozen(context.manifest));
});

test('missing required capability fails before registration', () => {
  const manifest = canonicalizeLegacySpecialistManifest(readSpecialist('accountant-cz'));
  throws(
    () => createExtensionContextV1({
      manifest,
      hostCapabilities: {
        [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: {},
      },
    }),
    EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER,
  );
});

test('undeclared capability access fails and absent optional capability is null', () => {
  const manifest = canonicalizeLegacySpecialistManifest(readSpecialist('translator'));
  const context = createExtensionContextV1({
    manifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: {},
    },
  });
  assertEqual(context.getCapability(EXTENSION_HOST_CAPABILITY.LOGGER), null);
  throws(() => context.getCapability('internal.database.v1'), 'undeclared-capability');
  throws(() => context.requireCapability(EXTENSION_HOST_CAPABILITY.LOGGER), 'capability-unavailable');
});

test('context carries canonical manifest, never the raw legacy object', () => {
  const raw = readSpecialist('dummy-logger');
  const manifest = canonicalizeLegacySpecialistManifest(raw);
  const context = createExtensionContextV1({
    manifest,
    hostCapabilities: {
      [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: {},
    },
  });
  assert(context.manifest !== raw);
  assertEqual(context.manifest.contract, EXTENSION_MANIFEST_CONTRACT);
  assertEqual(Object.hasOwn(context.manifest, 'engine'), false);
  assertEqual(Object.hasOwn(context.manifest, 'manifestVersion'), false);
});

summary();
