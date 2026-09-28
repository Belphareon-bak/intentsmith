# G0-R029 deterministic VRAM fixture evidence

## Defect

The required offline registry suite
`IS-T3-TESTS-VRAM-COORDINATION-TEST` depended on the host's live
`nvidia-smi`/ComfyUI availability while claiming `gpu:false`. Its minimum
context test supplied a large model but did not supply a VRAM observation.
On a valid host where `nvidia-smi` could not communicate with a driver and no
ComfyUI service was available, production correctly selected the documented
`4096` no-observation fallback. The test instead expected the measured
tight-VRAM result `2048`.

The first authoritative candidate run used execution context
`ATTESTED_CANDIDATE_RUN`, a fresh `--no-local` clone, and exact candidate:

`1853ba8c41ecfca470291534916aeb9008292b06`

| Command | Result | Exit |
|---|---|---:|
| `npm run gate0:run-evidence` | install phases and five pilots passed; deterministic registry reported 198 PASS and one FAIL, `IS-T3-TESTS-VRAM-COORDINATION-TEST` | 1 |
| `node tests/vram-coordination.test.js` | 40 passed, 1 failed; `computeNumCtx clamps to minimum 2048: Expected "2048", got "4096"` | 1 |

The candidate runner preserved the failing suite log with SHA-256
`c71e082b87833ba4da860d99664b0e9b0d5ff43ed1614380aeba9bf950cb7add`.
This is red candidate evidence, not a Gate 0 pass claim.

## Classification

This is a test-fixture defect, not a production regression:

- `computeNumCtx()` explicitly returns `4096` when no VRAM observation exists;
- it returns `2048` only after an observation proves insufficient room for one
  KV-cache unit;
- both branches and the original test were introduced together in
  `c60fc2c5d197c3e36fd693aa2eedd30d3b157dc1`;
- the registry requires this suite to run offline without a GPU.

## Repair

The suite now owns both discovery inputs while testing deterministic contracts:

- an isolated `PATH` makes the `nvidia-smi` branch unavailable;
- a local in-memory `fetch` fixture supplies exact ComfyUI `/system_stats`
  values, or throws to model total source unavailability;
- the shared VRAM cache, `PATH`, and `fetch` are restored in `finally`;
- fallback, ComfyUI conversion, gateway clamp, minimum clamp, model metadata,
  state propagation, and wait outcomes use exact assertions.

No production file or product behavior changed. Assertions were strengthened;
none was weakened, skipped, or made conditional.

## Focused proof

| Command | Result | Exit |
|---|---|---:|
| `node tests/vram-coordination.test.js` | 41 passed, 0 failed, 0 skipped | 0 |
| same command after temporarily disabling the fixture's ComfyUI response | 37 passed, 4 failed, including the exact minimum-clamp failure | 1 |

The temporary mutation was restored with a patch. The complete registry must be
rerun from a new committed candidate before this risk can support a Gate 0
verdict.
