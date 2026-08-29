import { REMOTE_CORE_V1_PIN } from '../src/mobile/client/remote-core-v1.js';

export const MOBILE_RELEASE_REMOTE_PINS = Object.freeze({
  descriptorDigest: REMOTE_CORE_V1_PIN.descriptorDigest,
  adapterManifestDigest: REMOTE_CORE_V1_PIN.m5AdapterManifestDigest,
});

export const MOBILE_RELEASE_TRANSPORT = Object.freeze({
  DEVELOPMENT: 'legacy-m1-dev',
  PRODUCTION: 'remote-core-v1',
});

export const MOBILE_RELEASE_TRANSPORT_BLOCKER =
  'M7_REMOTE_LISTENER_AUTH_PAIRING_AND_WIRE_TRANSPORT_NOT_IMPLEMENTED';
export const MOBILE_RELEASE_NATIVE_HTTP_BLOCKER =
  'CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED';

export function classifyMobileReleaseArtifact({
  debugSigned,
  expectedSigner,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  nativeHttpPatchEnabled,
}) {
  if (descriptorDigest !== MOBILE_RELEASE_REMOTE_PINS.descriptorDigest
      || adapterManifestDigest !== MOBILE_RELEASE_REMOTE_PINS.adapterManifestDigest) {
    throw new Error('bundled RemoteCore compatibility pin does not match the reviewed M2/M5 contract');
  }
  if (!Object.values(MOBILE_RELEASE_TRANSPORT).includes(transportMode)) {
    throw new Error(`bundled mobile transport mode is missing or unsupported: ${transportMode || 'missing'}`);
  }
  if (typeof nativeHttpPatchEnabled !== 'boolean') {
    throw new Error('CapacitorHttp patch state must be explicit in release evidence');
  }
  const releaseBlockers = [];
  if (transportMode !== MOBILE_RELEASE_TRANSPORT.PRODUCTION) {
    releaseBlockers.push(MOBILE_RELEASE_TRANSPORT_BLOCKER);
  }
  if (nativeHttpPatchEnabled) {
    releaseBlockers.push(MOBILE_RELEASE_NATIVE_HTTP_BLOCKER);
  }
  const releaseTransportReady = releaseBlockers.length === 0;
  const classification = debugSigned
    ? 'THROWAWAY_DEBUG_SIGNED'
    : expectedSigner
      ? releaseTransportReady
        ? 'CANDIDATE_SIGNED_UNREVIEWED'
        : 'CANDIDATE_SIGNED_TRANSPORT_BLOCKED'
      : 'NON_DEBUG_SIGNED_UNVERIFIED';
  return Object.freeze({
    classification,
    releaseTransportReady,
    releaseBlockers: Object.freeze(releaseBlockers),
  });
}
