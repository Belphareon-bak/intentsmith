function required(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`${label} could not be read`);
  return match[1];
}

export function parseApkReleaseObservationV1({ badging, manifestTree, signerOutput }) {
  return Object.freeze({
    applicationId: required(badging, /package: name='([^']+)'/u, 'APK applicationId'),
    versionCode: required(badging, /versionCode='([^']+)'/u, 'APK versionCode'),
    versionName: required(badging, /versionName='([^']+)'/u, 'APK versionName'),
    minSdk: required(badging, /sdkVersion:'([^']+)'/u, 'APK minSdk'),
    targetSdk: required(badging, /targetSdkVersion:'([^']+)'/u, 'APK targetSdk'),
    sourceRevision: required(
      manifestTree,
      /cz\.intentsmith\.SOURCE_REVISION"[^\n]*\n\s*A: android:value[^=]*="([a-f0-9]{40})"/u,
      'APK source revision',
    ),
    signerSha256: required(
      signerOutput,
      /certificate SHA-256 digest: ([a-f0-9]+)/iu,
      'APK signer SHA-256',
    ).toLowerCase(),
  });
}

export function parseAabReleaseObservationV1({ manifestXml, signerOutput }) {
  return Object.freeze({
    applicationId: required(manifestXml, /<manifest[^>]*\spackage="([^"]+)"/u, 'AAB applicationId'),
    versionCode: required(manifestXml, /<manifest[^>]*android:versionCode="([^"]+)"/u, 'AAB versionCode'),
    versionName: required(manifestXml, /<manifest[^>]*android:versionName="([^"]+)"/u, 'AAB versionName'),
    minSdk: required(manifestXml, /<uses-sdk[^>]*android:minSdkVersion="([^"]+)"/u, 'AAB minSdk'),
    targetSdk: required(manifestXml, /<uses-sdk[^>]*android:targetSdkVersion="([^"]+)"/u, 'AAB targetSdk'),
    sourceRevision: required(
      manifestXml,
      /<meta-data[^>]*android:name="cz\.intentsmith\.SOURCE_REVISION"[^>]*android:value="([a-f0-9]{40})"/u,
      'AAB source revision',
    ),
    signerSha256: required(
      signerOutput,
      /SHA256:\s*([A-Fa-f0-9:]+)/u,
      'AAB signer SHA-256',
    ).replaceAll(':', '').toLowerCase(),
  });
}

export function validateMobileAndroidObservationsV1({
  expected,
  apk,
  aab,
  expectedApkSignerSha256,
  expectedAabSignerSha256,
}) {
  for (const field of [
    'applicationId', 'versionCode', 'versionName', 'minSdk', 'targetSdk', 'sourceRevision',
  ]) {
    if (apk[field] !== expected[field]) {
      throw new Error(`APK ${field} mismatch: expected ${expected[field]}, received ${apk[field]}`);
    }
    if (aab[field] !== expected[field]) {
      throw new Error(`AAB ${field} mismatch: expected ${expected[field]}, received ${aab[field]}`);
    }
  }
  if (expectedApkSignerSha256 && apk.signerSha256 !== expectedApkSignerSha256) {
    throw new Error(
      `APK signer mismatch: expected ${expectedApkSignerSha256}, received ${apk.signerSha256}`,
    );
  }
  if (expectedAabSignerSha256 && aab.signerSha256 !== expectedAabSignerSha256) {
    throw new Error(
      `AAB signer mismatch: expected ${expectedAabSignerSha256}, received ${aab.signerSha256}`,
    );
  }
  return Object.freeze({ apk, aab });
}

