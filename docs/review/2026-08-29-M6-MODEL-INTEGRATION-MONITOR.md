# M6 model-integration worker monitor and correction

**Captured:** 2026-08-29T00:46:24+02:00

**Worktree:** `/home/belphareon/worktrees/is-model-scoring-final-20260826`

**Branch:** `codex/m6-model-integration-20260829`

**Verdict:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED / ACCEPTANCE_BLOCKED`

## Scope and ownership boundary

This checkpoint reviews the M6 effects of the model-authority integration. It
does not re-review the model-evaluation acceptance decision itself. The VS Code
Claude process that most likely created the branch cannot be bound to this
worktree from process metadata alone, so its ownership remains `UNKNOWN`. No
foreign checkout, backend worktree, GPU/Ollama process, remote, tag or published
artifact was changed.

## Observed worker state

The worker created merge commit
`ff9a7dfc93ab37d983d1feaf02418d8254411034` with parents:

- M6 evidence head `a98114b97240e994caff2002fff5b82c665b6029`;
- accepted model-authority head `2fdb04736daf5ebaf578dc3b089acd87be5e9478`.

It then correctly generated and committed the integrated module-boundary
baseline as `b26f4858a3b7d53ab4fb76df0c538a650ef926e6`. The baseline reproduced
1,210 edges with zero additions or removals.

The merge base was nevertheless stale for M6-R19. Neither
`1c5349597c7cb7f38ed80a5029f0681c449bf5a9` nor its review-evidence child
`0aefe8bf7b353cc952b6b6e7fdf537789dbe5054` was an ancestor, and the live
contract still declared `M6_CURRENT_VERSION_MIGRATION_COUNT = 79`.

## Correction sequence

1. The complete reviewed M6 remediation/evidence history was merged, rather
   than copying the constant without ancestry. Merge commit
   `6f7f2902d8f5305cf6b65c63276771c2b2aec989` has parents `b26f4858...` and
   `0aefe8bf...`. The only content conflict was the `SYSTEM-MAP.md` census; it
   was resolved from the combined tree as 200,470 source lines, 215,352 test
   lines, 463 registry programs and 87 migrations.
2. The first exact application-upgrade run on `6f7f2902...` was red. The
   transplanted value 80 was correct for the pre-model M6 candidate, but the
   integrated tree contains seven additional migrations. The controlled
   collision therefore failed at migration count 80 and violated
   `failedUpgradeMigrationCount < CURRENT_MIGRATION_COUNT`. The process exited
   1 and emitted no accepted receipt.
3. Product commit `73385eebc8cbca55d337c0cbb4954fbcb9aba93d`
   (`42e4356febdc9d045a6ccb286dac81a10d9ec23a`) rebinds the integrated contract
   and fixtures to 87. A new fast test derives the migration-file count and
   fails on future contract drift.

## Exact product evidence

The following checks passed against the product bytes that became
`73385eebc8cbca55d337c0cbb4954fbcb9aba93d`:

| Check | Result |
|---|---:|
| M6 runtime evidence | 8/8 PASS |
| M6 technical evidence | 8/8 PASS |
| M5-R19 exact migration schema | 20/20 PASS |
| Artifact validation | 158/158 PASS |
| Test registry | 463 PASS, `ab85f58a854d9271dcf39f321d583f8024ee09b79355e863c5857eaefe29cbca` |
| Module boundary | 1,210/1,210, added 0, removed 0 |
| Exact 136.0.0 to 136.1.0 application upgrade | PASS, exit 0 |

The successful upgrade receipt is bound to candidate `73385eeb...` and records:

- previous migration count 56;
- controlled failed-upgrade count 80;
- restored migration count 56;
- current migration count 87;
- the same SQLite file identity and complete canary survival;
- clean shutdown of both servers;
- `linux-user-network-namespace-loopback-only` with only interface `lo`.

## Remaining gates

Both committed verifiers remain truthfully blocked:

- signed bundle verifier: valid `BLOCKED`, exit 2, all 13 receipt paths absent;
- release validator: valid `BLOCKED`, exit 2,
  `M6_RELEASE_EVIDENCE_NOT_FOUND`.

This product commit has not received an independent exact-candidate review.
The four private keys also remain unencrypted under the same online `/home`
filesystem and OS account as the workers. Therefore:

- M5 remains `8/9` with `KEY_CUSTODY_CHANGES_REQUIRED`;
- M6 remains `RE_REVIEW_REQUIRED / ACCEPTANCE_BLOCKED`;
- no signing, rotation, history disposition, acceptance, Gate 0, promotion,
  tag, publish or push is authorized by this checkpoint.

The next safe step is an independent review of exact product commit
`73385eeb...`. Receipt production must wait until the existing keypairs are on
genuinely offline storage and the reviewer role has separate custody.
