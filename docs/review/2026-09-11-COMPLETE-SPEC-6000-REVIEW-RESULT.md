# Complete SPEC 6000 authority — independent review result

Review result: `CHANGES_REQUIRED`.

Reviewed product candidate:
`3291b5d49af5832ca8528c9c9395a18e9906fbdf`.

Evidence HEAD inspected by the reviewer:
`983121eece58b8522f736d4c8bc7c7e0ea4f657a`.

The reviewer accepted the operation-bound SPEC construction itself. The
WeakMap authority remains bound to the issued token identity; copies and
serialized values cannot carry it. The typed M1 boundary requires the exact
operation, `WORKFLOW_PLANNER`, D1 answer purpose, configured model, JSON format,
correlation and 6000 ceiling. Three negative cases each proved zero provider
calls. Truncation remains a terminal `SPEC_DOCUMENT_TRUNCATED` error.

The reviewer nevertheless found one integrity gap in pre-existing gateway
behavior. `validateAuthTokenPolicy()` was called by `callWithPolicy()`, while
legacy `callWithAuth()` reached `llmGateway.call()` with only structural
`validateAuthToken()` validation. An issued token above its declared role
limit could therefore reach the provider on the legacy path. Existing product
issuers demonstrated the mismatch: chat used `CRE_DECISION=4096` against a
2000 default and vision used `TOOL_INTERNAL=2048` against a 500 default.

The finding was not introduced by the SPEC commit and did not give an
untrusted caller control over `maxTokens`. It still invalidated the universal
wording of the role ceiling invariant, so the candidate was not accepted.

Independent reproduction on the evidence HEAD passed the 352/352 registered
deterministic gate, workflow 46/46, lifecycle 158/158, M1 contract 31/31 and
documentation oracle 158/158. The reviewer also verified the report digest,
clean worktree, single product commit and absence of key material in the repo.
Those green results do not override `CHANGES_REQUIRED`.

Adjacent review boundaries were recorded separately:

- custody B was correctly powered off, so the reviewer verified device and
  mapper absence but deliberately did not independently remount and reproduce
  its seven-file contents;
- the reviewer required an explicit recovery checkpoint before deletion of
  the remaining online reviewer-key source;
- the DuckDuckGo HTML preflight returned a bot challenge, so it is not an
  acceptable unattended stage-1 search backend.

Remediation is a new candidate and requires independent re-review. This result
does not accept M5, M6, M7, a model cookbook, tag, merge or release.
