# M6 model-evaluation integration — 2026-08-29

## Outcome

```text
product candidate             = 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
model authority integration   = IMPLEMENTATION_GREEN
offline + database gate       = 303 PASS / 0 FAIL / 0 BLOCKED
focused release boundary      = 298 PASS / 0 FAIL
registry                      = 463 programs
registry fingerprint          = ab85f58a854d9271dcf39f321d583f8024ee09b79355e863c5857eaefe29cbca
independent review            = REQUIRED
M5 acceptance                 = BLOCKED
M6 acceptance                 = BLOCKED
live LLM / physical GPU       = DEFERRED_MODEL_OPTIMIZATION
push / tag / publish          = not performed
```

The accepted role-specific, exact-artifact model-evaluation authority is now
part of the current M6 line. The integration keeps the durable M6 model-use,
pull and delete claims, removes the superseded proposal/ranker/automatic
failover writers, and retains one current read model for evaluation results.
It does not activate a model binding, enable the hunt timer or claim current
live-model quality.

## Product ancestry and correction

The integration merge is `ff9a7dfc93ab37d983d1feaf02418d8254411034`.
`b26f4858a3b7d53ab4fb76df0c538a650ef926e6` pins the resulting module graph.
The reviewed M5-R19/M6 remediation history was then merged as `6f7f2902`; the
combined tree contains 87 migrations, not the pre-integration 80. Product
commit `73385eebc8cbca55d337c0cbb4954fbcb9aba93d` rebinds the M6 application
upgrade contract to 87 and adds a test that derives the count from the actual
migration set.

The resulting schema has 87 migration files, tip 100 and 158 tables on a fresh
database. The M2 migration filenames were moved to unused sequence numbers
092–095 so the integrated tree has no ambiguous 070/081/082/083 identities.

## Focused verification on the exact candidate

The following commands ran from a dedicated detached worktree at exact
candidate `73385eeb`, with all generated state under its own
`.intentsmith-artifacts/` tree:

| Program | Result |
|---|---:|
| `tests/m6-runtime-evidence.test.js` | 8/8 PASS |
| `tests/m6-technical-evidence.test.js` | 8/8 PASS |
| `tests/m1-model-failover-schema.test.js` | 20/20 PASS |
| `tests/schema-migrations.test.js` | 55/55 PASS |
| `tests/artifact-validation.test.js` | 158/158 PASS |
| `tests/module-boundary-ratchet.test.js` | 13/13 PASS |
| `tests/signed-authority-receipt.test.js` | 5/5 PASS |
| `tests/signed-authority-bundle.test.js` | 12/12 PASS |
| `tests/m5-privacy-remediation.test.js` | 19/19 PASS |
| **Total** | **298/298 PASS** |

`node scripts/validate-test-registry.js --json` returned no errors and the
fingerprint shown above. `git diff --check` passed. The module graph remains
exactly 1,210 edges, 3 cycles and 28 files in cycles.

## Complete deterministic gate

The normal deterministic command first produced the truthful prerequisite
classification `296 PASS / 0 FAIL / 7 BLOCKED`: two PDF programs were blocked
on `toolchain:python-pdf-runtime`, four M2 programs on exact Git/bwrap
authorities and one M5 process program on bwrap/prlimit authority. This was not
reported as PASS.

The repository's hash-locked installer then created a private PDF runtime only
inside the dedicated test worktree artifact root. It installed CPython 3.12
packages `charset-normalizer 3.4.4`, `pillow 12.3.0` and `reportlab 5.0.0` from
`requirements/pdf-export.lock`; lock SHA-256 is
`b8126794c9fa898d19220335359019fd7558fd4775b17447b61d78b2acf229e2`.
No system package or shared user runtime was modified.

All seven prerequisite-bound programs were then executed with the exact
toolchain authorities and passed `7/7`. Finally one continuous registry run
executed all offline and database programs with those same authorities:

```text
runId             = 2026-08-28T22-55-00-659Z
sourceRevision    = 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
resultCount       = 303
statusCounts      = 303 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict / exit    = PASS / 0
registryHash      = ab85f58a854d9271dcf39f321d583f8024ee09b79355e863c5857eaefe29cbca
inventoryHash     = fc289b9a60db4d4dc80962bbfdf61f45aa1d54ec84fc85fa74b48f02cf7889a0
report SHA-256    = 404a4b1c49a2cff0509d552162eff1ef2af2ff277e59703e84a73ac60b3f0794
start SHA         = 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
end SHA           = 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
wrong result SHA  = 0
```

An earlier run from a shared checkout was invalidated when another writer
changed HEAD during execution. Its red result is classified
`INVALIDATED_BY_CONCURRENT_WRITER`; it is not baseline or candidate evidence.
All accepted evidence above comes from the dedicated checkout.

## Model and GPU boundary

The full gate above contains deterministic/fake-provider model contracts, not
a current physical model-quality acceptance run. Per the operator's explicit
deferral while model optimization may replace the active artifacts:

- no live chat through Ollama was run;
- no physical GPU measurement or VRAM-consuming hunt was run;
- no model binding was changed;
- the hunt timer remains disabled;
- system Ollama 0.32.14 still lacks the response-digest authority required by
  the accepted evaluator and remains `SYSTEM_PROVIDER_BLOCKED`.

Existing accepted evaluation history remains durable, but it is not rebound to
this candidate as fresh model-quality evidence.

## Remaining gates

This checkpoint is ready for independent review of the exact product candidate,
but is not M5 or M6 acceptance. The following remain open:

1. genuine offline/separate custody for the four production private keys;
2. actual privacy rotations and history disposition receipts;
3. signed M5 acceptance;
4. deferred live LLM/GPU phases after the model set is frozen;
5. full fresh-clone/server/Studio, performance and release evidence phases;
6. true 24-hour soak and full five-minute maximum-throughput evidence;
7. independent M6 review, operator demo, Gate 0 and standalone final verifier.

No receipt, rotation, history rewrite, promotion, tag, publish or push was
performed by this block.
