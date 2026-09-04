# MM1 review — prototype integration

Status: `COMPLETE`
Review range: `550856e5..fec916b8`
Merge commit: `c1994d9b`
Core parent: `765d1efee166d9f50f42bcee50c3d1709d3ad46d`
Prototype parent: `60a087959bba8bcb385160db80e0e3b22e7872df`

## Accepted result

The Android companion prototype and its durable approval plane are integrated
onto the selected current core. The integration preserves the newer core
notification credential authority and model/settings work while retaining the
mobile producer, gateway, client, Android shell and single-writer effect path.

The mobile channel is an always-available internal S1 projection. It is not an
external credential-bearing transport and cannot be selected successfully by
an HTTP or agent payload without the unforgeable projector capability. Email,
Telegram, push, webhook and desktop remain controlled by the core opt-in
channel policy.

Prototype migrations that had never shipped from this lineage were moved from
colliding ordinals 061–065 to 066–070. The migration oracle contains 71 files;
historical shared ordinals 008 and 030 remain unchanged.

Windows integration also fixed three platform-independent correctness issues:
atomic-write directory resolution now uses `node:path`, chat sandbox membership
uses `path.relative`, and persisted file-lock keys use a stable `/` separator.

## Executed evidence

- `npm run test:mobile`: PASS, 37/37 active programs; one browser accessibility
  program withheld because this host has no Chromium runtime.
- `node tests/schema-migrations.test.js`: PASS, 38 assertions; 71 migrations
  applied to an empty database.
- `node scripts/check-migration-numbers.mjs`: PASS; next free ordinal 071 and no
  divergent collision.
- `node scripts/validate-test-registry.js`: PASS; 420 runnable programs,
  registry SHA-256 `aab848f3eaae801ba041696c82d02aa407017649b2d7dd7fd0b962a7ecbdebe3`.
- `node scripts/module-boundary-ratchet.mjs`: PASS; exact 1,095-edge baseline,
  three existing cycles before and after integration.
- Companion producer: 24/24; multi-process phone-to-effect flow: 5/5; mobile
  inbox authority: 9/9.

## Deliberately not claimed

- The withheld Chromium accessibility program is not counted as a pass.
- No physical Android device was attached, so earlier prototype screenshots do
  not certify this integrated commit.
- No production signing key, store account, pairing secret or recoverable secret
  hash is committed.
- MM1 proves integration stability, not complete backend surface parity. That
  starts at MM2 with the `RemoteCorePort` contract.

## Reviewer focus

1. Check the two-parent merge and migration renumbering rather than reviewing a
   flattened copy of the prototype.
2. Verify that only `src/mobile/companion-producer.js` imports the mobile
   projector capability.
3. Review the 77 accepted module edges in the ratchet baseline; cycle count did
   not increase.
4. Re-run the mobile gate on Linux with Chromium before accepting device/UI
   evidence for a later release milestone.
