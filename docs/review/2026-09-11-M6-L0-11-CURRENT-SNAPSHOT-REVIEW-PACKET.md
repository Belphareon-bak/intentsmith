# M6 L0-11 model artifact authority — current-snapshot review packet

Review status: `RE_REVIEW_REQUIRED`.

Candidate status: `IMPLEMENTED / CURRENT_SNAPSHOT_GREEN / NOT_ACCEPTED`.

Core implementation anchor:
`4f300269fde62c749d566496ee87f63cae49fab5`.

Review the exact current product snapshot
`12b63e58f2c0669fa47ccbcf295caab87b498728`. Later commits changed the model
consumers significantly, so the requested review is the current listed blobs,
with `4f300269..12b63e58` used only as lineage/diff context.

## Product scope and blob pins

| Path | Git blob at `12b63e58` |
|---|---|
| `docs/decisions/037-m6-l0-11-model-artifact-authority.md` | `6cc1bbeea9ae0fc47b2cd90dbada5beafe1b0c2f` |
| `src/db/migrations/2026_08_27_098_m6_model_artifact_authority.js` | `6333d3db0289b9f9758c1c41066dcdeaaa617631` |
| `src/upgrade/model-artifact-authority-repository.js` | `02ff7cc0fcc971d505e999d353b74cad41f26d6c` |
| `src/upgrade/model-use-authority.js` | `982a9bbcc556ce8d1758222b529848c91add50fe` |
| `src/upgrade/upgrade-manager.js` | `256c8d9350dec21f3d33b254d711119a627dbc78` |
| `src/upgrade/model-registry.js` | `4675830e5108a98bca5fa3c3576c937c80d286ca` |
| `src/upgrade/model-binding-application.js` | `610daf1b42e045dc13a36bb1892a84216a651641` |
| `src/llm/gateway.js` | `cdfe70f97f74c9c757feeb10a512e5a31aa2b57c` |
| `src/media/vram-manager.js` | `a343cf60325d86f3a980e7a54b1c64e0bef425a1` |
| `src/server.js` | `1c8f8caee1336f87d225e32289ce7fffaa063725` |

Test blobs:

| Path | Git blob at `12b63e58` |
|---|---|
| `tests/m6-model-artifact-authority.test.js` | `52283d257bed8273d79fb5ea29d724e5b204d6d1` |
| `tests/m1-model-use-authority.test.js` | `fe4c0767d0ace55c1961ace72da293311c18dd4c` |
| `tests/m1-vram-artifact-use.test.js` | `6ca50fcac68d28370d66f2d3f3dfe1b928a49962` |
| `tests/m1-model-binding-application.test.js` | `9e03670af3b2e507b501bb4f0469b9e7c62b50b3` |
| `tests/model-registry-current-authority.test.js` | `e5b9c2f1968619346d3d203c3b7b3b32ca7f21db` |
| `tests/llm-gateway-runtime-signal.test.js` | `980a4cbba2c0bd52556c4a109a638e83c6d5ae2b` |
| `tests/schema-migrations.test.js` | `37666ede8ee5cc8f9e27ab4267012f03889e8087` |

## Review questions

1. Does production composition bind the single durable repository early enough
   and fail closed if ModelRegistry lacks durable claim/effect authority?
2. Do SQLite immediate transactions, Linux process identity and the append-only
   schema make cross-process shared/exclusive ownership and owner recovery
   correct, including fail-closed `UNKNOWN` probes?
3. Does every current live use path hold the correct shared claim for its full
   provider/runtime lifetime and release it on every error/cancel path?
4. Can binding cutover/verification, evaluation integration or later model
   scoring changes bypass the exact-artifact claim?
5. Do pull/delete validate exact name, digest and strict loopback origin, write
   intent before the first effect and preserve truthful success/failure/orphan
   outcomes? Is exact pull-only recovery sufficiently fenced?
6. Does retired chat cleanup still perform zero inventory, preview and delete
   effects while authenticated Model Management remains the only deletion path?
7. Do the 232 focused cases and 171 support cases exercise the mandatory
   Decision 037 negatives without relying on Ollama/GPU or a production DB?
8. Is the stated boundary correct that L0-11 protects model artifact lifetime,
   while global Ollama/ComfyUI GPU residency remains outside this claim?

Evidence details and report hashes:
[`m6-l0-11-current-snapshot-20260911.md`](../execution/runs/m6/m6-l0-11-current-snapshot-20260911.md).

Please return `REVIEW_PASSED` or `CHANGES_REQUIRED` bound to product snapshot
`12b63e58f2c0669fa47ccbcf295caab87b498728`. A pass closes the Decision 037
re-review only; it does not accept M2, M5 or M6 and does not authorize a real
model deletion.
