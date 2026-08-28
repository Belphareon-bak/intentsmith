# M6 offline authority key ceremony — 2026-08-29

## Outcome

```text
ceremony                 = COMPLETE
M5-R19 remediation       = IMPLEMENTED
product candidate        = d81be45f890864785502d073df28f8cad8f774bc
candidate tree           = 4de20f69c0fe3785e27b8ac37d8a67eef1c7e817
product parent           = d3ebf87fa7b4f69c5a14393ed264d1bac094520b
push/tag/publish          = not performed
rotation/history action  = not performed
M5/M6 acceptance         = BLOCKED
```

The operator explicitly authorized the ceremony and M5-R19 bundle, then
confirmed `/home/belphareon/INTENTSMITH_KEYS` after being told that this path is
on the same system disk and is not physically removable/off-host storage.

## Private-key boundary

The four Ed25519 key pairs were generated at `2026-08-28T22:10:18.306Z` by a
Node 22 `crypto` process inside `bwrap --unshare-net`. The process had a
read-only root filesystem and write access only to the operator-confirmed vault.
The vault and ceremony directory are mode `0700`; private PKCS#8 files are mode
`0600`. The private files are unencrypted at rest on the same `/home` Btrfs
volume. They are outside every Git worktree and no private bytes, private-key
digest, prefix or suffix entered Git, SQLite, the server environment or test
logs.

Each private key was re-opened inside another network-isolated process, its SPKI
was derived again, its `keyId` was recomputed and an in-memory probe signature
was verified. All four public identities and SPKI bytes are distinct.

## Git-pinned public identities

| Authority | `keyId` |
|---|---|
| `m5-privacy-operator` | `sha256:117ab9bb4b87bf20668b61847f23bf30a92e2e268849377e39ae44e5bba83597` |
| `m5-acceptance-operator` | `sha256:e6396e1498d1e1a9a7fde0a24cae03ea971dd7654520dd3c8c2340980e6c6368` |
| `m6-independent-reviewer` | `sha256:b875503ff1e60db13cf8b20ac77f8298560de7e7390ab3f70b150e3e9d907f49` |
| `m6-release-operator` | `sha256:029f78bbcec1393d96f93759cdffe0c9041f45d48f9888cd1b4e6fb99b330c99` |

`validateSignedAuthorityTrustStore()` accepted exactly four `ACTIVE` entries
and rejected no field. The registry stayed at 471 runnable programs with
fingerprint `ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999`.

## M5-R19

`tests/m1-model-failover-schema.test.js` now pins migration 100 as the exact
schema tip, expects 80 migrations on a no-op replay and includes migration 100
in the complete post-053 applied list. The original reproduction moved from
`17 PASS / 3 FAIL` to `20 PASS / 0 FAIL`.

## Verification

```text
SignedAuthorityReceipt                    5 / 5 PASS
M5 privacy remediation                   19 / 19 PASS
M6 signed acceptance                      5 / 5 PASS
Git signed-authority bundle              12 / 12 PASS
M6 release contract                      13 / 13 PASS
schema migrations                        38 / 38 PASS
module-boundary ratchet                  13 / 13 PASS
artifact validation                     158 / 158 PASS
routes smoke                            119 / 119 PASS
M1 model failover schema                 20 / 20 PASS
                                          ------------
focused + structural                    402 / 402 PASS

repository hygiene                      1 923 tracked paths / PASS
git diff --check                         PASS
private material diff scan               PASS
```

The clean exact-HEAD privacy scan reported 1,923 tracked/scanned files, 1,015
content-read files, zero findings and
`PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`. All 13 incident objects remain
reachable; this ceremony did not perform a history disposition.

Both production CLIs remain truthful with all 13 receipt paths absent:

```text
verdict    = BLOCKED
exitCode   = 2
reasonCode = M6_RELEASE_EVIDENCE_NOT_FOUND
```

## Boundary

This is key generation, public-key publication and M5-R19 remediation only. It
is not a rotation receipt, privacy history action, M5 acceptance, M6 independent
review receipt, operator demo, Gate 0, promotion, tag, publish or push. The new
product candidate requires independent re-review.
