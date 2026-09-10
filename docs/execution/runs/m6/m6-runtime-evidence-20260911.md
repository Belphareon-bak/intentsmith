# M6 runtime evidence — 2026-09-11

Status: `EVIDENCE_COLLECTED / REVIEW_REQUIRED / NOT_ACCEPTED`.

This checkpoint closes three previously unexecuted technical measurements. It
does not create a single frozen release candidate: the owned-server soak and
throughput are bound to `193e2351f4a967679ee237a99c673ceff216ddc1`, while the
real-model FILE_EXPLAIN journey is bound to the newer product source
`3bda6ddb259a7f2096cf96a5da98e73899b263cd`. A final candidate must preserve or
re-run the applicable evidence according to review.

## Owned production runtime

Both programs ran from the clean isolated clone
`/home/belphareon/is-soak09-193e2351/repo` in their own Linux user/network
namespace with only `lo`. They started and stopped their own production server
child and left the exact source tree clean.

### 24-hour soak

`IS-T5-TESTS-M6-LONG-SOAK-E2E` returned a valid `M6LongSoakReceipt@1` and
`PASS`:

| Measurement | Result | Contract budget |
|---|---:|---:|
| Monotonic duration | 86,400,270 ms | at least 86,400,000 ms |
| Requests | 86,400; 43,200 health + 43,200 project | at least 80,000 |
| Errors / HTTP 5xx | 0 / 0 | 0 / 0 |
| Latency p50 / p95 / p99 | 2 / 2 / 2 ms | p95 <= 100; p99 <= 250 ms |
| RSS start / peak / end / growth | 162.840 / 163.539 / 96.945 / 0 MiB | peak <= 1,024; growth <= 128 MiB |
| Timer drift max | 0 ms | measured |
| Diagnostics | DB ready; lifecycle recovery complete; active 1; completed 86,400; outbound 0 | all required |
| Shutdown | clean; no forced shutdown | required |

The outer shared audit still has the truthful overall verdict `FAIL`: host
suspend extended wall time beyond its 30-hour total deadline after the monotonic
24-hour soak completed, so the second required throughput program was
`SKIPPED total_deadline`. The soak result itself is `PASS`; the shared audit is
not relabelled.

Artifacts:

- report: `.intentsmith-artifacts/m6-soak/core-m6-controlled-soak-193e2351-20260909-01/report.json`,
  SHA-256 `d5c4d710e8ec193cd854abb93d49ecc85873e2e0b17b087d6a603c024e4c4a2c`;
- suite log and encoded receipt:
  `logs/tests_m6-long-soak.e2e.js.32e8a5f5.log`, SHA-256
  `957ea99eb1fec2c36d9634889a75f64b03f34cbbc3c4a924622669f0d4a1cddd`.

### Maximum throughput follow-up

After the real-model journey completed and its owned GPU process was unloaded,
the previously skipped exact program ran alone through the same nightly audit
authority. It returned a valid `M6MaxThroughputReceipt@1`, audit `PASS`, 1/1,
with no skip:

| Measurement | Result | Contract budget |
|---|---:|---:|
| Total measured duration | 300,093 ms | full evidence profile |
| Ramp concurrency | 1, 8, 32, 128, 512, 1,024 | full sequence |
| Selected concurrency | 1,024; ceiling reached | saturation or ceiling required |
| Sustained interval | 210,016 ms | 210,000 ms target |
| Sustained requests / rate | 8,286,539 / 39,456.703 req/s | at least 500 req/s |
| Sustained errors | 0 | 0 |
| Sustained p50 / p95 / p99 / max | 26 / 36 / 43 / 82 ms | p95 <= 100; p99 <= 250 ms |
| RSS start / peak / end / growth | 165.773 / 204.813 / 204.664 / 38.891 MiB | peak <= 1,536; growth <= 512 MiB |
| Diagnostics | DB ready; lifecycle recovery complete; active 1; completed 12,488,734; HTTP 5xx 0; outbound 0 | all required |
| Shutdown | clean; no forced shutdown | required |

Artifacts:

- report: `.intentsmith-artifacts/m6-throughput/m6-max-throughput-193e2351-20260911-01/report.json`,
  SHA-256 `1a2be810a51f192a63cc3bd5382e9060ebd60f9cf16a093c265a949973f5f968`;
- suite log and encoded receipt:
  `logs/tests_m6-max-throughput.e2e.js.699504db.log`, SHA-256
  `eabca2dce742fe130980bdefa3068752743b448f4819621085904b8cb121a4ec`.

## Real-model FILE_EXPLAIN

The private-DB approval/restart/replay journey ran against provider
`0.32.14-intentsmith.1` and exact installed D1 artifact `qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06`.
Preflight observed zero loaded models and zero NVIDIA compute processes.

The final result is `PASS`:

- exactly one real `/api/chat` call, `finishReason=stop`, no truncation;
- the model received the exact verified 235-byte file plus the original
  question only after effect approval;
- answer, same-turn read and post-restart replay share exact SHA-256
  `0a018175583b51da943bad883605f5d44419bebb77be760efa23eaa999415e05`;
- one exact-digest usage row and one normally released shared model claim;
- private SQLite `integrity_check=ok`, zero foreign-key violations;
- all seven live desired bindings were byte-for-byte unchanged before/after;
- the private DB was deleted and the model loaded by this run was explicitly
  stopped; `/api/ps` was empty afterwards.

Final artifacts under
`.intentsmith-artifacts/core-completion-20260909/provider-proposal/file-explain-model-demo-Wy3Owh/`:

- `result.json`, SHA-256
  `7d3658fe1e37443f02645d73e05dad3633d826df86a0ebf1485bd5015d594131`;
- retained raw provider response `chat-1.json`, SHA-256
  `b62f2fa2d64683e9f9d94c4a510e9a8507c6bff0bb972693f3f35bae29b973e9`;
- sanitized DB summary, SHA-256
  `708d466b728d80517a574a5d127326446d16a664cf53ccf95dbbb2ac1e9f432b`;
- private runner source, SHA-256
  `6fec5d0b0318688c6c8bdee2ad15559c0d48defae7abb2864b6405d02ad0d672`.

Four earlier attempts failed before inference and are retained rather than
hidden. They exposed private-runner mismatches: an obsolete pending-state
assertion, an illegal second process-singleton authority bind, and a resolver
that incorrectly required a top-level D1 role where the production resolver
uses an unambiguous exact-digest fallback. The fourth attempt instrumented and
confirmed `role: null`; the corrected runner mirrors that production behavior.
All four failure receipts contain zero raw model chats. Their result hashes are,
in order, `632c113d...8917b`, `27528b2c...50db`, `cc8d60ac...b93cf` and
`3228fe60...68d0`.

## Remaining boundary

This evidence is ready for independent review, not release acceptance. M6 still
depends on M5 acceptance and signed external receipts, the unresolved complete
SPEC cookbook model-quality gate, L0-11 re-review, assembly of one frozen final
candidate and the final M2/M6 operator decisions. No push, tag, signing,
publication, production DB mutation, service activation or model rebind occurred.

Review input:
[M6 runtime evidence packet](../../../review/2026-09-11-M6-RUNTIME-EVIDENCE-REVIEW-PACKET.md).
