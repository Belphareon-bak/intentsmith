import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  MOBILE_RELEASE_REMOTE_PINS,
  MOBILE_RELEASE_TRANSPORT,
} from './mobile-release-policy.mjs';

export const MOBILE_RELEASE_EXACT_SOURCE_ASSETS = Object.freeze([
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'm7-native-remote-client.js',
  'm7-runtime-contract-v1.js',
  'm7-ui-api-adapter.js',
  'remote-core-v1.js',
  'sw.js',
]);
export const MOBILE_RELEASE_SOURCE_MANIFEST_ASSET = 'mobile-release-source-manifest.json';
const SOURCE_REVISION = /^[a-f0-9]{40}$/u;
const ANDROID_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u;
const POSITIVE_INTEGER_TEXT = /^[1-9][0-9]{0,9}$/u;

function exactMatch(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label} must occur exactly once`);
  }
  return matches[0][1];
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requireAndroidMetadata(value) {
  if (!value
    || !ANDROID_IDENTIFIER.test(value.applicationId || '')
    || !POSITIVE_INTEGER_TEXT.test(value.versionCode || '')
    || typeof value.versionName !== 'string'
    || value.versionName.length < 1
    || value.versionName.length > 64
    || !POSITIVE_INTEGER_TEXT.test(value.minSdk || '')
    || !POSITIVE_INTEGER_TEXT.test(value.targetSdk || '')) {
    throw new Error('Android source metadata is invalid');
  }
  return value;
}

export function deriveMobileCapacitorPluginRegistryV1(packageJsonText, packageLockText) {
  const packageJson = parseJson(packageJsonText, 'mobile package.json');
  const packageLock = parseJson(packageLockText, 'mobile package-lock.json');
  const dependencies = packageJson.dependencies;
  const lockedDependencies = packageLock.packages?.['']?.dependencies;
  if (!isDeepStrictEqual(dependencies, lockedDependencies)) {
    throw new Error('mobile package and lock runtime dependencies differ');
  }
  const names = Object.keys(dependencies || {}).sort();
  if (!isDeepStrictEqual(names, ['@capacitor/android', '@capacitor/core'])) {
    throw new Error('mobile runtime plugin set is not covered by source manifest version 1');
  }
  return '[]\n';
}

export function renderMobileReleaseSourceManifestV1({
  sourceRevision,
  android,
  gatewayUrl,
  sourceCapacitorConfig,
  sourcePackageJson,
  sourcePackageLock,
  sourceRuntimeConfig,
  generatedRuntimeConfig = null,
  sourceIndex,
  sourceAssets,
}) {
  if (!SOURCE_REVISION.test(sourceRevision || '')) {
    throw new Error('mobile source revision is invalid');
  }
  const metadata = requireAndroidMetadata(android);
  const config = parseJson(sourceCapacitorConfig, 'source Capacitor config');
  if (config.appId !== metadata.applicationId) {
    throw new Error('Capacitor appId does not match Android applicationId');
  }
  const runtimeIdentity = generatedRuntimeConfig === null
    ? readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig)
    : readMobileGeneratedRuntimeIdentityV1(generatedRuntimeConfig);
  const generatedRuntime = renderMobileGeneratedRuntimeConfigV1({ gatewayUrl, ...runtimeIdentity });
  const generatedIndex = renderMobileGeneratedIndexV1(
    sourceIndex,
    gatewayUrl,
    runtimeIdentity.transportMode,
  );
  const pluginRegistry = deriveMobileCapacitorPluginRegistryV1(
    sourcePackageJson,
    sourcePackageLock,
  );
  const assets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => {
    if (typeof sourceAssets?.[asset] !== 'string') {
      throw new Error(`source asset is missing: ${asset}`);
    }
    return [asset, sha256(sourceAssets[asset])];
  }));
  const record = {
    contract: 'MobileReleaseSourceManifest',
    version: 1,
    sourceRevision,
    android: {
      applicationId: metadata.applicationId,
      versionCode: metadata.versionCode,
      versionName: metadata.versionName,
      minSdk: metadata.minSdk,
      targetSdk: metadata.targetSdk,
    },
    build: {
      gatewayUrl,
      capacitorConfigSha256: sha256(sourceCapacitorConfig),
      capacitorPluginRegistrySha256: sha256(pluginRegistry),
      generatedRuntimeConfigSha256: sha256(generatedRuntime),
      generatedIndexSha256: sha256(generatedIndex),
    },
    remoteCore: {
      transportMode: runtimeIdentity.transportMode,
      descriptorDigest: runtimeIdentity.descriptorDigest,
      adapterManifestDigest: runtimeIdentity.adapterManifestDigest,
      ...(runtimeIdentity.transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION ? {
        serverIdentityPin: runtimeIdentity.serverIdentityPin,
        serverOrigin: runtimeIdentity.serverOrigin,
      } : {}),
    },
    clientAssets: assets,
  };
  return `${JSON.stringify(record)}\n`;
}

export function validateMobileReleaseSourceManifestV1({
  expectedBytes,
  apkBytes,
  aabBytes,
}) {
  assertEqual(apkBytes, expectedBytes, 'APK source manifest does not match reviewed source');
  assertEqual(aabBytes, expectedBytes, 'AAB source manifest does not match reviewed source');
  const record = parseJson(expectedBytes, 'mobile source manifest');
  if (renderExactSourceManifestRecord(record) !== expectedBytes) {
    throw new Error('mobile source manifest is not canonical');
  }
  return Object.freeze(record);
}

function renderExactSourceManifestRecord(record) {
  return `${JSON.stringify(record)}\n`;
}

export function readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig) {
  return readMobileRuntimeIdentityV1(sourceRuntimeConfig, 'source');
}

export function readMobileGeneratedRuntimeIdentityV1(generatedRuntimeConfig) {
  return readMobileRuntimeIdentityV1(generatedRuntimeConfig, 'generated');
}

function readMobileRuntimeIdentityV1(runtimeConfig, label) {
  const transportMode = exactMatch(
    runtimeConfig,
    /transportMode:\s*["']([^"']+)["']/g,
    `${label} transportMode`,
  );
  const descriptorDigest = exactMatch(
    runtimeConfig,
    /descriptorDigest:\s*'(sha256:[0-9a-f]{64})'/g,
    `${label} descriptorDigest`,
  );
  const adapterManifestDigest = exactMatch(
    runtimeConfig,
    /adapterManifestDigest:\s*'(sha256:[0-9a-f]{64})'/g,
    `${label} adapterManifestDigest`,
  );
  if (!Object.values(MOBILE_RELEASE_TRANSPORT).includes(transportMode)) {
    throw new Error(`source transportMode is unsupported: ${transportMode}`);
  }
  const expectedAdapter = transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION
    ? MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest
    : MOBILE_RELEASE_REMOTE_PINS.m5AdapterManifestDigest;
  if (descriptorDigest !== MOBILE_RELEASE_REMOTE_PINS.descriptorDigest
      || adapterManifestDigest !== expectedAdapter) {
    throw new Error('source runtime config does not match reviewed RemoteCore pins');
  }
  if (transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION) {
    const serverIdentityPin = exactMatch(
      runtimeConfig,
      /serverIdentityPin:\s*["'](sha256:[0-9a-f]{64})["']/g,
      `${label} serverIdentityPin`,
    );
    const serverOrigin = exactMatch(
      runtimeConfig,
      /serverOrigin:\s*["']([^"']+)["']/g,
      `${label} serverOrigin`,
    );
    const origin = requireProductionOrigin(serverOrigin);
    return Object.freeze({
      transportMode, descriptorDigest, adapterManifestDigest,
      serverIdentityPin, serverOrigin: origin,
    });
  }
  if (/server(?:IdentityPin|Origin):/u.test(runtimeConfig)) {
    throw new Error('legacy runtime config must not carry M7 server authority');
  }
  return Object.freeze({ transportMode, descriptorDigest, adapterManifestDigest });
}

function requireProductionOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('M7 serverOrigin is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.port !== '7443'
    || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash || parsed.origin !== value) {
    throw new Error('M7 serverOrigin must be an exact HTTPS origin on port 7443');
  }
  return parsed.origin;
}

function parseGeneratedGatewayUrl(generatedRuntimeConfig) {
  const encoded = exactMatch(
    generatedRuntimeConfig,
    /^\s*gatewayUrl:\s*("(?:[^"\\]|\\.)*"),\s*$/gm,
    'generated gatewayUrl',
  );
  const gatewayUrl = parseJson(encoded, 'generated gatewayUrl');
  let parsed;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error('generated gatewayUrl is not an absolute URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || !['', '/'].includes(parsed.pathname)) {
    throw new Error('generated gatewayUrl must be a clean HTTP(S) origin');
  }
  if (['0.0.0.0', '[::]'].includes(parsed.hostname)) {
    throw new Error('generated gatewayUrl must not use a wildcard host');
  }
  return gatewayUrl;
}

export function renderMobileGeneratedRuntimeConfigV1({
  gatewayUrl,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  serverIdentityPin,
  serverOrigin,
}) {
  const production = transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION;
  if (production) {
    const origin = requireProductionOrigin(gatewayUrl);
    if (serverOrigin !== origin || !/^sha256:[0-9a-f]{64}$/u.test(serverIdentityPin || '')) {
      throw new Error('M7 generated runtime binding is incomplete');
    }
  }
  return [
    '// Generated for this Android artifact; do not edit.',
    'globalThis.IntentSmithRuntimeConfig = Object.freeze({',
    `  gatewayUrl: ${JSON.stringify(gatewayUrl)},`,
    `  transportMode: ${JSON.stringify(transportMode)},`,
    '  remoteCore: Object.freeze({',
    `    descriptorDigest: '${descriptorDigest}',`,
    `    adapterManifestDigest: '${adapterManifestDigest}',`,
    ...(production ? [
      `    serverIdentityPin: ${JSON.stringify(serverIdentityPin)},`,
      `    serverOrigin: ${JSON.stringify(serverOrigin)},`,
    ] : []),
    '  }),',
    '});',
    '',
  ].join('\n');
}

export function renderMobileGeneratedIndexV1(
  sourceIndex,
  gatewayUrl,
  transportMode = MOBILE_RELEASE_TRANSPORT.DEVELOPMENT,
) {
  const directive = transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION
    ? "connect-src 'self'"
    : `connect-src 'self' ${new URL(gatewayUrl).origin}`;
  const matches = sourceIndex.match(/connect-src\s+[^;"]+/g) || [];
  if (matches.length !== 1) {
    throw new Error('source index does not contain exactly one connect-src directive');
  }
  return sourceIndex.replace(/connect-src\s+[^;"]+/, directive);
}

export function validateMobileNetworkSecurityTreeV1({ gatewayUrl, xmlTree }) {
  const parsed = new URL(gatewayUrl);
  const domains = [...xmlTree.matchAll(/^\s*T: '([^']+)'\s*$/gm)].map(match => match[1]);
  const expected = new Set(['127.0.0.1', 'localhost']);
  if (parsed.protocol === 'http:') expected.add(parsed.hostname);
  const actualSorted = [...domains].sort();
  const expectedSorted = [...expected].sort();
  if (!isDeepStrictEqual(actualSorted, expectedSorted)
      || new Set(domains).size !== domains.length) {
    throw new Error(
      `APK network security cleartext domains do not match gateway: ${actualSorted.join(',')}`,
    );
  }
  const domainCleartext = xmlTree.match(/^\s*A: cleartextTrafficPermitted=true\s*$/gm) || [];
  const baseCleartext = xmlTree.match(/^\s*A: cleartextTrafficPermitted=false\s*$/gm) || [];
  const includeSubdomains = xmlTree.match(/^\s*A: includeSubdomains=false\s*$/gm) || [];
  if (domainCleartext.length !== 1 || baseCleartext.length !== 1
      || includeSubdomains.length !== domains.length) {
    throw new Error('APK network security policy is not exact and fail-closed');
  }
  return Object.freeze(actualSorted);
}

export function validateMobileReleaseArtifactBindingV1({
  sourceCapacitorConfig,
  apkCapacitorConfig,
  aabCapacitorConfig,
  sourceRuntimeConfig,
  apkRuntimeConfig,
  aabRuntimeConfig,
  sourceIndex,
  apkIndex,
  aabIndex,
  sourceAssets,
  apkAssets,
  aabAssets,
  sourcePackageJson,
  sourcePackageLock,
  apkPlugins,
  aabPlugins,
  expectedSourceManifest,
  apkSourceManifest,
  aabSourceManifest,
}) {
  const sourceConfig = parseJson(sourceCapacitorConfig, 'source Capacitor config');
  const packagedApkConfig = parseJson(apkCapacitorConfig, 'APK Capacitor config');
  const packagedAabConfig = parseJson(aabCapacitorConfig, 'AAB Capacitor config');
  if (!isDeepStrictEqual(packagedApkConfig, sourceConfig)) {
    throw new Error('APK packaged Capacitor config does not match source revision');
  }
  if (!isDeepStrictEqual(packagedAabConfig, sourceConfig)) {
    throw new Error('AAB packaged Capacitor config does not match source revision');
  }
  const expectedPlugins = deriveMobileCapacitorPluginRegistryV1(
    sourcePackageJson,
    sourcePackageLock,
  );
  assertEqual(apkPlugins, expectedPlugins, 'APK plugin registry does not match source package graph');
  assertEqual(aabPlugins, expectedPlugins, 'AAB plugin registry does not match source package graph');
  const sourceManifest = validateMobileReleaseSourceManifestV1({
    expectedBytes: expectedSourceManifest,
    apkBytes: apkSourceManifest,
    aabBytes: aabSourceManifest,
  });

  const runtimeIdentity = readMobileGeneratedRuntimeIdentityV1(apkRuntimeConfig);
  const gatewayUrl = parseGeneratedGatewayUrl(apkRuntimeConfig);
  const expectedRuntimeConfig = renderMobileGeneratedRuntimeConfigV1({
    gatewayUrl,
    ...runtimeIdentity,
  });
  assertEqual(
    apkRuntimeConfig,
    expectedRuntimeConfig,
    'APK runtime config is not the exact reviewed build-time transformation',
  );
  assertEqual(
    aabRuntimeConfig,
    expectedRuntimeConfig,
    'AAB runtime config is not the exact reviewed build-time transformation',
  );

  const expectedIndex = renderMobileGeneratedIndexV1(
    sourceIndex,
    gatewayUrl,
    runtimeIdentity.transportMode,
  );
  assertEqual(apkIndex, expectedIndex, 'APK index does not match the exact source CSP transformation');
  assertEqual(aabIndex, expectedIndex, 'AAB index does not match the exact source CSP transformation');
  assertEqual(
    sourceManifest.build.generatedIndexSha256,
    sha256(apkIndex),
    'mobile source manifest does not hash the packaged index',
  );

  for (const asset of MOBILE_RELEASE_EXACT_SOURCE_ASSETS) {
    if (typeof sourceAssets?.[asset] !== 'string') {
      throw new Error(`source asset is missing: ${asset}`);
    }
    assertEqual(
      apkAssets?.[asset],
      sourceAssets[asset],
      `APK ${asset} does not match source revision`,
    );
    assertEqual(
      aabAssets?.[asset],
      sourceAssets[asset],
      `AAB ${asset} does not match source revision`,
    );
  }

  if (runtimeIdentity.transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION) {
    if (sourceAssets['app.js'].includes('remote_core_transport_not_implemented')) {
      throw new Error('production transport mode is selected but the reviewed client still blocks it');
    }
    if (sourceManifest.remoteCore.serverOrigin !== runtimeIdentity.serverOrigin
      || sourceManifest.remoteCore.serverIdentityPin !== runtimeIdentity.serverIdentityPin) {
      throw new Error('mobile source manifest does not bind the M7 server authority');
    }
  }

  return Object.freeze({
    capacitorConfig: packagedApkConfig,
    gatewayUrl,
    ...runtimeIdentity,
    nativeHttpPatchEnabled: packagedApkConfig.plugins?.CapacitorHttp?.enabled === true,
    sourceManifest,
  });
}
