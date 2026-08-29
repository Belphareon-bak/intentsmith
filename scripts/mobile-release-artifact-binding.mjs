import { isDeepStrictEqual } from 'node:util';

import {
  MOBILE_RELEASE_REMOTE_PINS,
  MOBILE_RELEASE_TRANSPORT,
} from './mobile-release-policy.mjs';

export const MOBILE_RELEASE_EXACT_SOURCE_ASSETS = Object.freeze([
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'remote-core-v1.js',
  'sw.js',
]);

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

export function readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig) {
  const transportMode = exactMatch(
    sourceRuntimeConfig,
    /transportMode:\s*'([^']+)'/g,
    'source transportMode',
  );
  const descriptorDigest = exactMatch(
    sourceRuntimeConfig,
    /descriptorDigest:\s*'(sha256:[0-9a-f]{64})'/g,
    'source descriptorDigest',
  );
  const adapterManifestDigest = exactMatch(
    sourceRuntimeConfig,
    /adapterManifestDigest:\s*'(sha256:[0-9a-f]{64})'/g,
    'source adapterManifestDigest',
  );
  if (!Object.values(MOBILE_RELEASE_TRANSPORT).includes(transportMode)) {
    throw new Error(`source transportMode is unsupported: ${transportMode}`);
  }
  if (descriptorDigest !== MOBILE_RELEASE_REMOTE_PINS.descriptorDigest
      || adapterManifestDigest !== MOBILE_RELEASE_REMOTE_PINS.adapterManifestDigest) {
    throw new Error('source runtime config does not match reviewed RemoteCore pins');
  }
  return Object.freeze({ transportMode, descriptorDigest, adapterManifestDigest });
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
}) {
  return [
    '// Generated for this Android artifact; do not edit.',
    'globalThis.IntentSmithRuntimeConfig = Object.freeze({',
    `  gatewayUrl: ${JSON.stringify(gatewayUrl)},`,
    `  transportMode: '${transportMode}',`,
    '  remoteCore: Object.freeze({',
    `    descriptorDigest: '${descriptorDigest}',`,
    `    adapterManifestDigest: '${adapterManifestDigest}',`,
    '  }),',
    '});',
    '',
  ].join('\n');
}

export function renderMobileGeneratedIndexV1(sourceIndex, gatewayUrl) {
  const directive = `connect-src 'self' ${new URL(gatewayUrl).origin}`;
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

  const runtimeIdentity = readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig);
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

  const expectedIndex = renderMobileGeneratedIndexV1(sourceIndex, gatewayUrl);
  assertEqual(apkIndex, expectedIndex, 'APK index does not match the exact source CSP transformation');
  assertEqual(aabIndex, expectedIndex, 'AAB index does not match the exact source CSP transformation');

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

  if (runtimeIdentity.transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION
      && sourceAssets['app.js'].includes('remote_core_transport_not_implemented')) {
    throw new Error('production transport mode is selected but the reviewed client still blocks it');
  }

  return Object.freeze({
    capacitorConfig: packagedApkConfig,
    gatewayUrl,
    ...runtimeIdentity,
    nativeHttpPatchEnabled: packagedApkConfig.plugins?.CapacitorHttp?.enabled === true,
  });
}
