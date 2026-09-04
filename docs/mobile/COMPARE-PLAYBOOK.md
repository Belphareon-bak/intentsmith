# Mobile Implementation Comparison Playbook

Use this document when the unavailable local implementation becomes available.
The purpose is to select the best behavior from both implementations, not to
preserve either history or force a textual merge.

## Safety rules

1. Import the local implementation as a separate branch or worktree.
2. Do not copy signing keys, tokens, raw secrets, keystores or secret-derived
   material into Git.
3. Compare observable contracts before source layout: routes, scopes, schema,
   state transitions, failure behavior, device lifecycle and release evidence.
4. For security code, record the primitive, key ownership, rotation/revocation,
   backup behavior and threat model.  A stored SHA value is not automatically a
   credential vault or a password KDF.
5. Select or reimplement one behavior per capability, then run the same contract
   and negative tests against both candidates.

## Comparison matrix

| Capability | Master branch evidence | Local branch evidence | Selected behavior | Reason |
|---|---|---|---|---|
| pairing and device identity | pending MM1/MM2 | unavailable | pending | — |
| secure credential storage | pending MM1/MM5 | unavailable | pending | — |
| projects | pending MM3 | unavailable | pending | — |
| conversations | pending MM3 | unavailable | pending | — |
| runs and events | pending MM2/MM3 | unavailable | pending | — |
| approvals | pending MM1/MM4 | unavailable | pending | — |
| agents and specialists | pending MM4 | unavailable | pending | — |
| notifications and push | pending MM4/MM5 | unavailable | pending | — |
| remote transport | pending MM5 | unavailable | pending | — |
| release pipeline | pending MM6 | unavailable | pending | — |

