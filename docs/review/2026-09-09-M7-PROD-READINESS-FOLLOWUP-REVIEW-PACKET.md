# M7 prod-readiness follow-up — independent review packet

## Requested verdicts

```text
M7_CANONICAL_JSON_INTEROP_AND_RECOVERY = REVIEW_PENDING
M7_ENCRYPTED_SYSTEMD_UNIT_RENDERER      = REVIEW_PENDING
M6_CURRENT_REGISTRY_AND_GATE_RATCHET    = REVIEW_PENDING
M7_OVERALL                              = NOT_ACCEPTED
```

This is a narrow product follow-up to the eight-section `REVIEW_PASSED` result
recorded on 2026-09-09. It does not ask the reviewer to convert source evidence
into physical Android/VPN evidence and it does not reopen already-reviewed M7
surfaces outside the exact delta below unless the delta affects them.

## Exact identity and range

```text
previous reviewed product = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
previous review result     = 036ba6bddb1e0c61f6e41411c54273f5e062b582
review range               = 036ba6bddb1e0c61f6e41411c54273f5e062b582..9ae1a5164d31f8cd4f1e3880eac79576399ef21f
candidate                  = 9ae1a5164d31f8cd4f1e3880eac79576399ef21f
candidate tree             = 944db57faa8472eb2966bd57826b2e1fead9fe5b
branch                     = codex/m7-mobile-contract-integration-20260829
upstream                   = none
push                       = none
```

The range contains exactly two product commits:

- `f3a8753e` — shared JS/Android canonical JSON byte corpus, activation recovery
  runbook and the required registry/M6 ratchet;
- `9ae1a516` — inert encrypted-credential user-systemd unit renderer and its
  adversarial tests.

Any later product or test commit invalidates this packet. A later commit that
adds only this file under `docs/review/` is evidence-only under the existing M6
boundary and does not alter the candidate above.

## A. Shared canonical signing bytes

Review these together:

- `contracts/m7/canonical-json-vectors-v1.json`;
- `tests/m7-canonical-json-parity.test.js`;
- `mobile-app/android/app/src/main/java/cz/intentsmith/companion/M7CanonicalJson.java`;
- `mobile-app/android/app/src/test/java/cz/intentsmith/companion/M7CanonicalJsonTest.java`;
- `mobile-app/android/app/build.gradle`.

The same nine-vector file is consumed by Node and Gradle/JUnit. Six valid
vectors pin exact canonical UTF-8 bytes through Base64; three invalid vectors
must throw in both implementations. The corpus covers NFC keys and values,
normalized-key collision, UTF-8 rather than UTF-16 key ordering, control and
quote escaping, U+2028/U+2029, astral characters, lone surrogates, nested
arrays/objects, fractional numbers and both safe-integer bounds. Negative zero
remains a direct non-JSON-parser regression on both sides.

Do not accept this solely because both consumers copy the Base64 field. Decode
and independently recompute representative vectors, especially
`utf8-key-order`, `lone-surrogates`, `safe-integer-bounds` and
`normalized-key-collision`. Confirm that an Android signing request and the
Node verifier cannot disagree silently: any mismatch must reject the request.

## B. Activation recovery

`docs/mobile/TRYING-IT.md` now states the real blast radius: a failed M7
activation terminates the whole server and temporarily removes local Studio.
The tested recovery is to remove `INTENTSMITH_M7_REMOTE_ENABLED`, reload the
correct user/system manager, restore loopback health first, then repair VPN and
credential configuration before explicitly re-enabling M7. It must not suggest
`1`, an empty value, LAN/public fallback or bypassing preflight.

## C. Encrypted systemd unit renderer

Review these together:

- `systemd/user/intentsmith-m7.service.in`;
- `scripts/render-m7-systemd-service.mjs`;
- `tests/m7-vpn-runtime-config.test.js`;
- the rendering section in `docs/mobile/TRYING-IT.md`.

The renderer:

1. accepts only an exact, duplicate-free argument set;
2. accepts only real canonical project/Node paths without whitespace,
   specifiers or traversal;
3. reuses `createM7VpnRuntimeConfiguration()` to validate the public VPN bind,
   origin and SPKI shape;
4. accepts syntactically safe absolute paths to encrypted credential envelopes
   but deliberately does not open them;
5. emits only `LoadCredentialEncrypted=` for the exact three credential names;
6. writes only to stdout and never invokes `systemctl`, installs a unit,
   generates a key or mutates firewall/network state.

The fake interface observation at render time proves only configuration shape.
It is not claimed as live VPN evidence. The production server constructs the
runtime configuration again and observes the real interface and decrypted
credential material before binding.

Adversarially try duplicate/unknown/missing args, newline or `%` injection,
relative and parent-traversing paths, symlinked executable/root, Wi-Fi/public/
wildcard binds, port drift, malformed SPKI and unresolved template tokens.
Confirm that the unit basename must be `intentsmith-m7.service`, which is what
the runtime credential-directory boundary requires.

## D. Registry and deterministic ratchet

```text
runnable programs     = 511
ACTIVE                = 417
BLOCKED               = 79
HISTORICAL            = 15
ACTIVE + required     = 412
offline required      = 278
database required     = 73
deterministic total   = 351
registry fingerprint  = 922f65e9e28a3dfb604148c5d5b0ecf1ad106edff9de0646724d6189407f0b40
module graph          = 1273 edges / 3 cycles / 28 files in cycles
migrations            = 95
```

`IS-T1-TESTS-M7-CANONICAL-JSON-PARITY-TEST` is `ACTIVE + required`, profile
`offline`. The M6 candidate omission sentinel names it explicitly and the
nightly policy pins the new fingerprint and exact `278 + 73` profile counts.
Remove the program from the plan and confirm
`plan:required-program-uncovered:<id>` rather than a smaller green run.

## E. Independently reproducible focused evidence

```text
Node shared canonical vectors       11/11 PASS
Android M7 canonical JUnit class      4/4 PASS
full Android debug JUnit task          5/5 PASS
Android release boundary             18/18 PASS
M7 VPN config + service renderer      11/11 PASS
M7 transport admission                9/9 PASS
M7 TLS listener                        5/5 PASS
M6 candidate plan                     20/20 PASS
module boundary                       13/13 PASS
artifact validation                  158/158 PASS
repository hygiene              2277 paths PASS
registry validation        511 programs PASS
nightly orchestrator self-test              PASS
git diff --check                            PASS
```

The rendered unit was also checked locally with systemd 255:

```text
systemd-analyze --user --man=no verify <private-temp>/intentsmith-m7.service
exit = 0
stderr = empty
```

The temporary rendered unit was removed immediately. No systemd unit was
installed or activated.

## F. Two exact deterministic reports

### Raw fail-closed run without toolchain authority

```text
runId          = 2026-09-08T23-42-36-615Z
sourceRevision = 9ae1a5164d31f8cd4f1e3880eac79576399ef21f
result         = 343 PASS / 0 FAIL / 0 TIMEOUT / 8 BLOCKED / 0 SKIPPED
verdict        = BLOCKED / exit 2
report         = .intentsmith-artifacts/test-runs/2026-09-08T23-42-36-615Z/report.json
reportSha256   = 33999372b7e42e1b9374d93cb3f743c271999deeccfe6f5e62076134951d0c8f
```

The eight blockers remain exactly the two PDF, three M2 execution, one M2
lifecycle, M5 process-hardening and workspace-budget programs. This report is
not called PASS.

### Exact local toolchains opened by the candidate policy

```text
runId                = 2026-09-08T23-46-27-677Z
sourceRevision       = 9ae1a5164d31f8cd4f1e3880eac79576399ef21f
result               = 351 PASS / 0 non-PASS
verdict              = PASS / exit 0
registryHash         = 922f65e9e28a3dfb604148c5d5b0ecf1ad106edff9de0646724d6189407f0b40
inventoryFingerprint = 8d50876bf112de71d802ae1e5ea4b96ebf319b31a6a4ca3fc8a4bee4f8c0ad49
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
report               = .intentsmith-artifacts/m7-prod-readiness-followup-20260909/2026-09-08T23-46-27-677Z/report.json
reportSha256         = ccbba18347a59822f5bc32d96abbd6ebf0e6b9ae53498cae3fcad38b185412ec
```

Allowed prerequisites are exactly
`toolchain:{python-pdf-runtime,bwrap,bubblewrap,git,prlimit}`. `noBlock=false`,
profiles are only `offline,database`, concurrency is one. No LLM, Ollama or GPU
program is represented by this result.

## G. Current external boundary

Read-only host inventory at closeout found no `tailscale0`, `wg*` or `tun*`
interface, no listener on port 7443 and no `adb` executable in PATH. Therefore
no real VPN bind, encrypted credential ceremony, firewall observation, device
install, AndroidKeyStore journey, TalkBack run, release signing or runtime
evidence was attempted.

No new product design decision is requested. The accepted VPN-only decisions
remain unchanged. The next steps require operational values/actions:

1. choose and activate the exact VPN interface/address;
2. create the production TLS identity and 32-byte HMAC secret through a
   separate operator ceremony, then provide encrypted systemd credential paths;
3. approve installation/activation of the rendered unit and firewall evidence;
4. provide the candidate Android signing identity and an API 29+ physical
   device with `adb` tooling for the thirteen-check matrix.

M5 privacy rotations/history receipts, M6 signed acceptance/demo/Gate 0 and the
full server/model/soak gate remain separate. Live LLM/chat and GPU work remains
deferred by the operator while model optimization can change the selected
artifacts.

Even if all three requested verdicts pass, the truthful state remains:

```text
M7 = IMPLEMENTATION_GREEN / TECHNICAL_FOLLOWUP_REVIEW_PASSED
     REAL_VPN_DEVICE_EVIDENCE_BLOCKED / NOT_ACCEPTED
```
