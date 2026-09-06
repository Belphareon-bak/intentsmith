# MM5-A review — packaged client and native transport boundary

Status: `IMPLEMENTED AND TESTED; BINARY/DEVICE NOT RUN`
Checkpoint commit: `a5d5bab4`

This checkpoint removes the production-ineligible live-server WebView design.
The Android application now packages the canonical mobile client and reaches an
explicit gateway origin through Capacitor's native HTTP implementation. The
gateway security boundary is not relaxed to make that work.

## Delivered

- `mobile-app/capacitor.config.json` packages `src/mobile/client` directly;
- `server.url`, `server.cleartext` and the duplicate `mobile-app/www` client are
  removed;
- `CapacitorHttp` patches the existing client `fetch` calls into native HTTP;
- browser/PWA use remains same-origin by default;
- a generated, ignored runtime asset carries exactly one validated gateway
  origin into a packaged build;
- remote origins require HTTPS; cleartext is accepted only for loopback and the
  USB `adb reverse` journey;
- every API request remains under `/m1`; legacy `/api/*` stays inaccessible;
- the gateway still emits no permissive CORS headers and denies `OPTIONS`.

The runtime configuration object is frozen before the application module loads.
It accepts only a bare `http` or `https` origin: credentials, paths, queries and
fragments are rejected. A changed remote endpoint therefore requires a rebuilt
and re-reviewed artifact rather than an in-app preference.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-packaged-transport.test.js` | PASS — 8/8 |
| `node tests/mobile-android-platform.test.js` | PASS — 8/8 |
| `node tests/mobile-gateway-boundary.test.js` | PASS — 38/38 |
| `node tests/mobile-secure-credential.test.js` | PASS — 17/17 |
| `npx cap sync android` | PASS — canonical client copied into Android assets |
| `npx cap doctor` | PASS — Android project recognized |
| `npm run test:module-boundary:ratchet` | PASS — 1,106 edges, 3 pre-existing cycles |
| `npm run test:mobile` | PASS — 49/49 active; 1 Chromium suite withheld |

Registry after this checkpoint: 432 runnable programs, digest
`f7fcb37b9718858e9ae0c284806c2d1c1d0c425e712d1a043ff7b2f0b3f84b27`.

Authoritative Capacitor references:

- <https://capacitorjs.com/docs/config>
- <https://capacitorjs.com/docs/apis/http>

## Explicit non-claims and remaining boundary

- No APK/AAB was built: this host has no JDK 21 or Android SDK 36.
- HTTPS is required remotely, but certificate/pinned peer identity and a
  separately governed remote listener are not implemented by this checkpoint.
- Production keys, clean-clone reproduction and physical-device evidence are
  absent.
- The credential vault still uses deprecated `EncryptedSharedPreferences`;
  direct AndroidKeyStore storage remains MM5 work.
- `RELEASE READY` and `DEVICE VERIFIED` are not claimed.
