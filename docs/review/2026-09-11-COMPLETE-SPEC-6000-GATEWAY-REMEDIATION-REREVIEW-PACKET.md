# Complete SPEC 6000 gateway-ceiling remediation — re-review packet

Review status: `RE_REVIEW_REQUIRED`.

Candidate status: `REMEDIATION_CANDIDATE / FOCUSED_GREEN / MODEL_NOT_RUN /
NOT_ACCEPTED`.

Review exactly:

```text
983121eece58b8522f736d4c8bc7c7e0ea4f657a..dca0e89bcc47a1dce96fbe0d3f0616aadccd3b2c
```

The first review accepted the SPEC operation binding but returned
[`CHANGES_REQUIRED`](2026-09-11-COMPLETE-SPEC-6000-REVIEW-RESULT.md) because
legacy `callWithAuth()` did not enforce role token ceilings in the central
gateway. This candidate closes that pre-existing gap without changing any
existing provider output budget.

## Product and test blob pins

| Path | Git blob at `dca0e89b` |
|---|---|
| `docs/decisions/043-complete-spec-output-budget.md` | `41ee5c0cea33b7240d5a9d1a3137c147fa57257d` |
| `src/llm/auth-types.js` | `1dbf018eae54bb8215cad042b099c6a84543ede2` |
| `src/llm/gateway.js` | `c0dbbd440ebbcb72a4634b41843073a6f3bf8592` |
| `tests/m1-model-contract.test.js` | `9ea9afd850cc7ae9434425de66be236b1ca56a4a` |
| `SYSTEM-MAP.md` | `aa02e00821ce0bb563e55ec65d296636027d6ff2` |

## What changed

`RoleTokenLimits` remains the default budget map, including
`CRE_DECISION=2000` and `TOOL_INTERNAL=500`. A separate immutable
`RoleTokenCeilings` map records the largest already-existing product operation:
4096 for chat and 2048 for vision. Every other ceiling equals its existing
default; `WORKFLOW_PLANNER` remains 4000.

`llmGateway.authorize()`, `isAuthorized()` and the live `call()` path now use
the policy validator. A structurally valid issued token above its ceiling is
rejected with `LLM_AUTHORIZATION_DENIED` and an
`AUTH_TOKEN_POLICY_DENIED` audit before rate limiting and before provider
access. Missing authorization in explicitly enabled non-strict test mode keeps
its old behavior, but non-strict mode cannot admit an issued over-ceiling
token. The process-local SPEC token remains the only operation above its own
role ceiling.

## Requested review questions

1. Do separate defaults and ceilings preserve the previous 2000/500 defaults
   while honestly admitting the existing 4096 chat and 2048 vision operations?
2. Can any issued over-ceiling token pass singleton `authorize()`,
   `isAuthorized()` or direct `callWithAuth()` and reach rate limiting or a
   provider effect?
3. Does the regression exercise the real direct gateway path, fail at one over
   the ceiling, prove exact-ceiling tokens valid, record one safe audit, make
   zero provider calls and release the semaphore?
4. Does `callWithPolicy()` retain its stricter request/correlation checks, and
   does the identity-bound 6000 SPEC token remain the only above-role
   exception?
5. Does the change preserve existing provider requests and leave model
   binding, context, VRAM, retries, vision transport and all non-SPEC workflow
   composition unchanged?

## Implementer evidence

All commands below were inert and used provider stubs. They did not contact a
model, GPU or external network:

```bash
node tests/workflow.test.js
node tests/lifecycle.test.js
node tests/m1-model-contract.test.js
node tests/m1-model-use-authority.test.js
node tests/llm-gateway-runtime-signal.test.js
node tests/chat-persistence.test.js
node tests/artifact-validation.test.js
node tests/specialist-boundary-ratchet.test.js
git diff --check 983121eece58b8522f736d4c8bc7c7e0ea4f657a..dca0e89bcc47a1dce96fbe0d3f0616aadccd3b2c
```

Results: workflow 46/46, lifecycle 158/158, M1 model contract 32/32,
model-use authority 27/27, gateway runtime 7/7, chat persistence 36/36,
artifact/documentation validation 158/158 and specialist boundary 12/12; all
PASS with zero failures. Syntax checks and `git diff --check` also passed.

A subsequent clean registered gate on evidence HEAD
`d2b03cc32baf95ade4f096b22d875c4119ee9491` included this exact product
candidate and ran all 352 offline/database programs: 352 PASS, zero FAIL,
TIMEOUT, BLOCKED or SKIPPED, exit 0. Its report SHA-256 is
`023307449433ab34c4c203c6cf0d8681caa84e6a382c6097ba656de0fd8b9d4a`;
all 352 log files exist and their report-bound hashes match. See the
[`current gate record`](../execution/runs/current-deterministic-d2b03cc3-20260911.md).

Please return `REVIEW_PASSED` or `CHANGES_REQUIRED` bound to
`dca0e89bcc47a1dce96fbe0d3f0616aadccd3b2c`. A pass only closes this source
finding and reopens the exact real-model SPEC cookbook. It does not claim that
6000 tokens are sufficient or accept M5/M6/M7, a tag, merge or release.
