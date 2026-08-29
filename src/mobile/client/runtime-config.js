// Browser/PWA builds keep using same-origin /m1. The Android build overwrites
// only its generated asset with the selected gateway URL; the tracked client
// and Capacitor configuration stay immutable and reviewable.
globalThis.IntentSmithRuntimeConfig = Object.freeze({
  gatewayUrl: 'http://127.0.0.1:3336',
  transportMode: 'legacy-m1-dev',
  remoteCore: Object.freeze({
    descriptorDigest: 'sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52',
    adapterManifestDigest: 'sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52',
  }),
});
