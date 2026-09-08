import { REMOTE_CORE_V1_PIN } from '../src/mobile/client/remote-core-v1.js';

export const MOBILE_RELEASE_REMOTE_PINS = Object.freeze({
  descriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
  m5AdapterManifestDigest: REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
  m7AdapterManifestDigest: REMOTE_CORE_V1_PIN.m7AdapterManifestDigest,
});

export const MOBILE_RELEASE_TRANSPORT = Object.freeze({
  DEVELOPMENT: 'legacy-m1-dev',
  PRODUCTION: 'remote-core-v1',
});

export const MOBILE_RELEASE_TRANSPORT_BLOCKER =
  'M7_REMOTE_PRODUCTION_TRANSPORT_NOT_SELECTED';
export const MOBILE_RELEASE_RUNTIME_EVIDENCE_BLOCKER =
  'M7_REMOTE_DEVICE_AND_VPN_RUNTIME_EVIDENCE_NOT_RECORDED';
export const MOBILE_RELEASE_NATIVE_HTTP_BLOCKER =
  'CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED';
export const MOBILE_RELEASE_AAB_SIGNER_BLOCKER =
  'MOBILE_AAB_UPLOAD_SIGNER_NOT_VERIFIED';

export function classifyMobileReleaseArtifact({
  debugSigned,
  expectedSigner,
  expectedAabSigner = null,
  aabSignerVerified = false,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  nativeHttpPatchEnabled,
  serverIdentityPin = null,
  serverOrigin = null,
  runtimeEvidenceVerified = false,
}) {
  if (!Object.values(MOBILE_RELEASE_TRANSPORT).includes(transportMode)) {
    throw new Error(`bundled mobile transport mode is missing or unsupported: ${transportMode || 'missing'}`);
  }
  const production = transportMode === MOBILE_RELEASE_TRANSPORT.PRODUCTION;
  const expectedAdapterManifestDigest = production
    ? MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest
    : MOBILE_RELEASE_REMOTE_PINS.m5AdapterManifestDigest;
  if (descriptorDigest !== MOBILE_RELEASE_REMOTE_PINS.descriptorDigest
      || adapterManifestDigest !== expectedAdapterManifestDigest) {
    throw new Error('bundled RemoteCore compatibility pin does not match the reviewed contract');
  }
  if (typeof nativeHttpPatchEnabled !== 'boolean') {
    throw new Error('CapacitorHttp patch state must be explicit in release evidence');
  }
  const releaseBlockers = [];
  if (!production) {
    releaseBlockers.push(MOBILE_RELEASE_TRANSPORT_BLOCKER);
  } else {
    let origin;
    try { origin = new URL(serverOrigin); } catch { origin = null; }
    if (!origin || origin.protocol !== 'https:' || origin.port !== '7443'
      || origin.origin !== serverOrigin
      || !/^sha256:[0-9a-f]{64}$/u.test(serverIdentityPin || '')) {
      throw new Error('production mobile release lacks exact M7 origin or SPKI pin');
    }
    if (runtimeEvidenceVerified !== true) {
      releaseBlockers.push(MOBILE_RELEASE_RUNTIME_EVIDENCE_BLOCKER);
    }
  }
  if (nativeHttpPatchEnabled) {
    releaseBlockers.push(MOBILE_RELEASE_NATIVE_HTTP_BLOCKER);
  }
  if (expectedSigner && (!expectedAabSigner || aabSignerVerified !== true)) {
    releaseBlockers.push(MOBILE_RELEASE_AAB_SIGNER_BLOCKER);
  }
  const releaseTransportReady = releaseBlockers.length === 0
    && debugSigned === false
    && typeof expectedSigner === 'string'
    && typeof expectedAabSigner === 'string'
    && aabSignerVerified === true;
  const classification = debugSigned
    ? 'THROWAWAY_DEBUG_SIGNED'
    : expectedSigner
      ? !expectedAabSigner || aabSignerVerified !== true
        ? 'CANDIDATE_SIGNED_AAB_UNVERIFIED'
        : releaseTransportReady
        ? 'CANDIDATE_SIGNED_UNREVIEWED'
        : 'CANDIDATE_SIGNED_TRANSPORT_BLOCKED'
      : 'NON_DEBUG_SIGNED_UNVERIFIED';
  return Object.freeze({
    classification,
    releaseTransportReady,
    releaseBlockers: Object.freeze(releaseBlockers),
  });
}
