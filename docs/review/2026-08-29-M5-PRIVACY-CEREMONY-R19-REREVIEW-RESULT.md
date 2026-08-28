# M5 privacy ceremony and M5-R19 — narrow re-review result

## Verdict

```text
reviewed product d81be45f = CHANGES_REQUIRED / NOT_ACCEPTED
M5-R19                     = CHANGES_REQUIRED
public key identities      = VERIFIED
private key custody        = CHANGES_REQUIRED

remediation 1c534959       = IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED
M5                          = 8/9 REVIEW_PASSED / PRIVACY CHANGES_REQUIRED
M6                          = ACCEPTANCE_BLOCKED
```

The public trust-store bytes and the migration-100 model-failover oracle are
correct, but the requested review unit is not acceptable as a whole. One
required M6 upgrade authority still pinned 79 migrations and failed against the
actual 80-migration candidate. The private keys also do not satisfy the stated
offline custody boundary after generation.

This verdict does not authorize a receipt, rotation, history disposition, M5
acceptance, M6 review/demo/Gate 0, promotion, tag, publish or push.

## Reviewed identities

```text
base evidence HEAD        = d3ebf87fa7b4f69c5a14393ed264d1bac094520b
reviewed product candidate = d81be45f890864785502d073df28f8cad8f774bc
reviewed candidate tree    = 4de20f69c0fe3785e27b8ac37d8a67eef1c7e817
submitted evidence HEAD    = a98114b97240e994caff2002fff5b82c665b6029

remediation candidate      = 1c5349597c7cb7f38ed80a5029f0681c449bf5a9
remediation tree           = 8e517cac1a94d5b0f24247225a1ab0da1069b49c
remediation parent         = a98114b97240e994caff2002fff5b82c665b6029
```

The submitted worktree was clean, had no upstream and had not been pushed.
The eight-file review range and all identities matched the packet.

## Findings

### F-01 HIGH — generation was network-isolated, persistent custody is not offline

`bwrap --unshare-net` protected the generating and verification processes. It
did not make the resulting files offline. All four unencrypted PKCS#8 files
remain on the same permanently mounted `/home` Btrfs volume as the repository,
application and workers, owned by the same `belphareon` OS account. Mode `0600`
protects them from other accounts, not from a compromised application/worker
running as this account.

This also defeats meaningful custody separation for
`m6-independent-reviewer`: the implementation worker's OS principal can read
the reviewer key as well as the M5 and release keys. Four distinct public keys
provide cryptographic role separation, but not possession separation.

Required remediation before any production signature:

- move the existing keypairs to encrypted removable/offline storage or an
  equivalent signing environment that is not mounted during normal operation;
- give the independent-reviewer key separate custody from the implementation
  and release keys;
- verify the move from a network-isolated signer, then remove the same-volume
  copies only after recovery has been proven.

Moving the same keypairs does not change the Git-pinned trust store. Generating
replacement keypairs does change product bytes and requires another product
review.

### F-02 HIGH — M5-R19 missed the required production upgrade oracle

The candidate fixed `tests/m1-model-failover-schema.test.js` to migration tip
100 and 80 migrations, but
`contracts/m6/runtime-evidence-v1.js` still declared
`M6_CURRENT_VERSION_MIGRATION_COUNT = 79`. The ACTIVE+required
`tests/m6-previous-version-upgrade.e2e.js` uses that value as its exact final
authority.

After supplying the existing offline npm cache, the real loopback-only
136.0.0→136.1.0 journey reached the final assertion and failed:

```text
80 !== 79
exit = 1
```

The submitted `402/402` matrix did not contain this ACTIVE+required E2E, so its
green result was insufficient to close the cross-impact of migration 100.

Remediation candidate `1c534959` updates the production contract and the
runtime/technical fixtures to 80. An exact-candidate rerun passed with a receipt
bound to `1c534959`, previous count 56, failed-upgrade count 76, current count
80, restored canary, clean shutdowns and loopback-only namespace. This is
implementation evidence and still needs independent re-review.

### F-03 MEDIUM — worker test loop hid invalid soak/throughput outcomes

The worker launched every filename containing `m6` through `timeout 300`, piped
stdout through a `RESULTS` grep without `pipefail` and suppressed stderr. It
killed the 24-hour soak after five minutes and then truncated the exact
five-minute throughput run. Neither outcome could be release evidence and the
shell could continue despite failure.

The exact shell and its owned throughput process group were terminated; the
Claude worker itself and other workers were not stopped. Future evidence runs
must use the locked registry/runner, registry timeout, full stdout/stderr and
the original exit/verdict. Historical short probes remain `DEV_ONLY`.

### F-04 LOW — current-state documents contradicted the review state

Decision 041 declared `KEY_CEREMONY_COMPLETE / PRODUCT_RE_REVIEW_REQUIRED`
while an internal "current state" block still said the older
`PRIVACY_CHANGES_REQUIRED`, and M6 documentation simultaneously described 79
and 80 migrations. The remediation candidate now uses one explicit vocabulary:
`KEY_CUSTODY_CHANGES_REQUIRED / PRODUCT_REMEDIATION_IMPLEMENTED /
RE_REVIEW_REQUIRED` and preserves old 79-migration receipts as historical.

## Independently reproduced evidence

On submitted candidate `d81be45f`:

```text
focused + structural       = 402/402 PASS
registry                   = 471 / ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999
current-tree privacy       = PASS / 0 findings
incident reachability      = 13/13 reachable / HISTORY_REMEDIATION_REQUIRED
bundle verifier            = BLOCKED / exit 2 / 13 receipt paths absent
release validator          = BLOCKED / exit 2 / M6_RELEASE_EVIDENCE_NOT_FOUND
previous-version upgrade   = FAIL / exit 1 / 80 !== 79
```

On remediation candidate `1c534959`:

```text
focused + structural       = 402/402 PASS
M6 runtime evidence        = 7/7 PASS
M6 technical evidence      = 8/8 PASS
previous-version upgrade   = PASS / exact candidate / 56 -> 80
registry                   = 471 / unchanged fingerprint
current-tree privacy       = PASS / 0 findings / 1,925 scanned paths
incident reachability      = 13/13 reachable / HISTORY_REMEDIATION_REQUIRED
bundle + release verifier  = BLOCKED / exit 2 / 13 receipt paths absent
git diff --check           = PASS
```

All four private keys independently derived the exact committed SPKI SHA-256
identities inside a new network namespace. The vault trust store exactly
matched the committed JSON. A secret-specific scan of all local Git objects
read 777,169,252 bytes and found none of 28 exact PEM/PKCS#8 fragment or private
file digest token classes. No private value was emitted by the scan.

The first isolated upgrade attempt stopped earlier because its newly created
npm cache lacked `zod-3.25.76`; it is an infrastructure baseline failure, not a
product result. The decisive old-candidate FAIL and remediation PASS both used
the pre-existing host cache with npm's offline mode and the test's documented
direct-run cache override.

## Remaining gate

Do not sign any of the thirteen receipts yet. First close F-01 without changing
the key identities if possible, then independently re-review exact product
candidate `1c534959` plus its evidence-only descendant. Only after both gates
pass may the eight rotations, history disposition, M5 acceptance and M6 chain
begin in the prescribed order.
