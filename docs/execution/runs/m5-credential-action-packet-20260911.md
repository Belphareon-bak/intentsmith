# M5 credential action packet — 2026-09-11

Status: `OPERATOR_INPUT_PREPARED / 0_OF_8_CATEGORY_RECEIPTS /
HISTORY_RECEIPT_NOT_ISSUED / M5_ACCEPTANCE_BLOCKED`.

This packet reduces the remaining privacy work to facts and external actions.
It contains no credential value, digest, prefix, suffix or account identifier.
It does not inspect personal historical database or attachment content and does
not issue a signature.

## Fresh privacy-safe preflight

On clean source `5827c26ca78e41ec165e0db4cccb93ec34836f80`, the production
privacy scanner returned:

```text
current tree       PASS
scanned files      2332
content-read files 1101
findings           0
known history      13/13 objects reachable
verdict             PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED
personal content   not inspected
secret values      not recorded
```

A read-only query of the live database at
`/home/belphareon/Projects/intentsmith/data/c3.db` returned
`integrity_check=ok`, zero issued API tokens, zero M7 session tables and zero
credential-like keys in `user_settings`. Only the name `OLLAMA_MODELS` was
present among relevant process environment namespaces; no credential-like
environment variable name was present and no value was inspected. Both the
user and system `intentsmith.service` units were inactive.

These are current-state facts. They cannot by themselves prove that an exposed
credential never existed, was never reused or no longer has authority.

## Exact category closure matrix

For each row choose one truthful closure. `ROTATED` requires a completed
rotation/revocation and evidence that covers every exposed or reused authority.
`NEVER_EXISTED` requires a historical account/configuration assessment.
`AUTHORITY_ENDED` additionally requires revocation, expiry or decommission
evidence. The fixture category uses `FIXTURE_NOT_REUSED` only after checking
that the value never left tests.

| Category | Authority | What must be checked or completed | Valid closure |
|---|---|---|---|
| `administrative-api` | local | Inventory historical `C3_ADMIN_TOKEN` use and issued API tokens. Revoke all old tokens; create a new admin token only for the frozen deployment. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |
| `ephemeral-authority` | local | On the frozen candidate, stop old instances, invalidate sessions/WS grants/leases, start the intended instance and prove no old authority authenticates. | `ROTATED` or historically supported `NEVER_EXISTED` |
| `fixture-password-reuse` | mixed | Check whether `KLICENKA_PASS` or another fixture credential was ever reused outside tests. Rotate every reused authority. | `ROTATED` or `FIXTURE_NOT_REUSED` |
| `license-agent` | mixed | Inventory active license and agent credentials, including issuer-side records. Revoke/reissue every exposed active value. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |
| `license-signing-validation` | mixed | Determine whether `C3_LICENSE_SECRET` signed any license. If so, replace the signing authority and revoke/reissue affected licenses. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |
| `model-provider` | external | Audit every model-provider account used with this project, even though current runtime uses local Ollama. Revoke/reissue exposed API credentials. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |
| `notification-credentials` | external | Audit SMTP, webhook, Telegram and ntfy authorities. Rotate active credentials and verify the old authority is rejected. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |
| `project-external` | external | Privately inventory Git/cloud/deploy/database/service credentials referenced by historical projects, databases and attachments. Rotate every active or reused authority. | `ROTATED`, `NEVER_EXISTED`, or `AUTHORITY_ENDED` |

## Evidence record for each category

Create one redacted evidence document per category only after its action or
assessment finishes. It may contain:

- category ID and stable redacted service/account alias;
- `ROTATED`, `NEVER_EXISTED`, `AUTHORITY_ENDED`, or `FIXTURE_NOT_REUSED`;
- UTC completion and assessment times;
- assessed historical scope and authority scope;
- provider/local action type and a non-secret confirmation reference;
- whether old authority was tested as rejected, expired or decommissioned;
- the statement `secretMaterialIncluded: false`.

It must not contain a credential value or any value-derived hash, prefix,
suffix, length or screenshot that exposes one. A provider-generated case or
event identifier is acceptable only when it is not itself an authenticator.

Suggested evidence paths, which do not overlap the required signed receipt
paths:

```text
docs/execution/runs/m5/privacy-actions/administrative-api.json
docs/execution/runs/m5/privacy-actions/ephemeral-authority.json
docs/execution/runs/m5/privacy-actions/fixture-password-reuse.json
docs/execution/runs/m5/privacy-actions/license-agent.json
docs/execution/runs/m5/privacy-actions/license-signing-validation.json
docs/execution/runs/m5/privacy-actions/model-provider.json
docs/execution/runs/m5/privacy-actions/notification-credentials.json
docs/execution/runs/m5/privacy-actions/project-external.json
```

The evidence schema is deliberately not prefilled with a successful result.
Each final signed category receipt binds the SHA-256 of its actual evidence
artifact and is stored, in contract order, as
`docs/review/M5-PRIVACY-ROTATION-<category>.json`.

## Minimal operator fact sheet

The operator can supply all missing non-secret facts in one response using
this form:

```text
actorId: <stable non-secret identifier>
repositoryVisibilityNow: public | private | removed

administrative-api: <closure>; <scope/action/time/reference>
ephemeral-authority: <closure>; <scope/action/time/reference>
fixture-password-reuse: <closure>; <scope/action/time/reference>
license-agent: <closure>; <scope/action/time/reference>
license-signing-validation: <closure>; <scope/action/time/reference>
model-provider: <closure>; <scope/action/time/reference>
notification-credentials: <closure>; <scope/action/time/reference>
project-external: <closure>; <scope/action/time/reference>

historicalPersonalData: AUTHORIZE_LOCAL_READ_ONLY_INSPECTION | SELF_AUDITED
```

Do not paste secrets into this form. For a rotation, state only that the old
authority was revoked and the new authority works; do not identify either
credential.

## Ordered closeout after the facts exist

1. Commit only the eight redacted action evidence artifacts.
2. Freeze one exact product candidate and complete its release evidence index
   and artifact manifest; signed receipts bind these exact bytes.
3. On offline medium A, sign eight category receipts in contract order with
   `m5-privacy-operator`; verify each signature and evidence binding before the
   next receipt.
4. Sign `retain_and_rotate` / `retained` history with the same privacy role,
   binding a fresh privacy scan and ref census.
5. Obtain independent PRIVACY review, then use the separate
   `m5-acceptance-operator` key for M5 acceptance.
6. Continue with the physically separate reviewer key and the M6 review,
   operator demo and Gate 0 chain.

The 13 signed receipt files must be introduced only by evidence-only commits.
The standalone verifier rejects product changes, altered artifacts, broken
lineage, wrong roles, duplicate nonces and noncanonical receipt bytes.

## Storage boundary

The completed reviewer medium B is sufficient for its intended role and should
remain powered off. A private cloud or always-online NAS can hold an additional
client-side encrypted backup, but it does not satisfy the required second
offline copy of the three operator keys. That remaining custody step needs
another removable medium, or a NAS copy whose storage is physically disconnected
and whose decryption key is not stored on the host or NAS.
