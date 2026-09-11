# Complete SPEC 6000 output authority — review packet

Review status: `REVIEW_REQUIRED`.

Candidate status: `IMPLEMENTED_CANDIDATE / DETERMINISTIC_GREEN /
MODEL_NOT_RUN / NOT_ACCEPTED`.

Review exactly:

```text
5279da5c381586bdd4d437fd87213a7e855743e7..3291b5d49af5832ca8528c9c9395a18e9906fbdf
```

The operator accepted [Decision 043](../decisions/043-complete-spec-output-budget.md):
only the internal operation that creates a complete SPEC JSON document may
request up to 6000 output tokens. The general workflow planner, initial SPEC
analysis, revision analysis and every other normal D1 call retain their 4000
limit. This packet asks for source review before any real-model cookbook run.

## Product and test blob pins

| Path | Git blob at `3291b5d4` |
|---|---|
| `docs/decisions/043-complete-spec-output-budget.md` | `bb26e8d90877cda536de72519433248041df391c` |
| `src/llm/auth-types.js` | `1bcbb06263e0927c24d3a3b634629cc3891ad96e` |
| `src/llm/gateway.js` | `7b1a8b1ddc4bd985e05aa08b988d40df77f822aa` |
| `src/llm/cre-bridge.js` | `9c04844111233b2fd651ceecaed5d9445a5e3f20` |
| `src/planner/workflow.js` | `2e76ef67df30e2ea23460dd2e7235a6838707b25` |
| `src/planner/lifecycle-spec.js` | `eed299452998ee76969db4a67eac71b03001f25d` |
| `tests/workflow.test.js` | `956fb160919073961aa9948c0c267832488dafda` |
| `tests/lifecycle.test.js` | `570649b7d60eac0ba4ef0f0db9c5692f9265698b` |
| `tests/m1-model-contract.test.js` | `ed414ca87c5dcda1c7a2a97cf009dc100cf12a17` |

## Review questions

1. Is `answerSpecQuestions()` the sole production consumer that can select
   `workflow.spec-document.json@1`, while `startSpec()`, `reviseSpec()` and the
   generic `callLLM()` remain at the ordinary D1 ceiling of 4000?
2. Do process-local issuance and the strict gateway/typed-adapter checks reject
   copied tokens, ordinary planner tokens at 6000, wrong correlation, role,
   purpose, capability, format, system prompt or configured model before any
   provider effect?
3. Does the special path preserve an explicitly lower positive integer limit,
   reject every invalid or above-ceiling value before the provider and perform
   at most one provider attempt?
4. Does `finishReason === 'length'` fail closed before parsing or accepting even
   parseable, schema-valid JSON, retain the exact clarification and leave the
   lifecycle draft unadvanced?
5. Is the stated scope exact: no model binding, context size, VRAM reserve,
   think policy, projectless-web authority or SPEC acceptance criteria changed?

## Implementer evidence

The following inert commands ran on exact product candidate `3291b5d4`; they
stub the provider boundary and do not contact Ollama, a GPU or the network:

```bash
node tests/workflow.test.js
node tests/lifecycle.test.js
node tests/m1-model-contract.test.js
node tests/m1-model-use-authority.test.js
node tests/llm-gateway-runtime-signal.test.js
node tests/specialist-boundary-ratchet.test.js
node tests/artifact-validation.test.js
git diff --check 5279da5c381586bdd4d437fd87213a7e855743e7..3291b5d49af5832ca8528c9c9395a18e9906fbdf
```

Results:

- workflow: 46/46 PASS;
- lifecycle: 158/158 PASS, including the default production composition;
- M1 model contract: 31/31 PASS;
- M1 model-use authority: 27/27 PASS;
- gateway runtime signal: 7/7 PASS;
- specialist boundary ratchet: 12/12 PASS;
- artifact/documentation validation: 158/158 PASS;
- syntax checks and `git diff --check`: PASS.

Please return `REVIEW_PASSED` or `CHANGES_REQUIRED` bound to
`3291b5d49af5832ca8528c9c9395a18e9906fbdf`. A pass authorizes the original
real-model cookbook on these exact product bytes. It does not prove that 6000
tokens are sufficient, accept M5/M6, authorize projectless web, or authorize a
merge, tag, push or release.
