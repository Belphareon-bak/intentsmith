# Security policy

IntentSmith is pre-release, local developer software. The project aims for explicit least authority and inspectable evidence, but it is not yet a hardened security boundary for running arbitrary hostile code.

## Stable security posture

The Phase 2 baseline provides:

- API listeners fixed to loopback;
- an optional worker gateway that is disabled by default;
- run-scoped, revocable gateway tokens;
- runtime validation at external boundaries;
- path policy for project access;
- append-only audit APIs;
- sanitized hardware evidence;
- omission of prompts and model responses from persistent audit;
- no configured or automatic cloud-inference fallback;
- dependency and clean-tree verification.

## What local-first means

For the verified stable path:

- Core state and SQLite data stay on the local machine.
- Inference uses a locally configured provider.
- The product does not silently choose a hosted provider.
- Normal verification works without a cloud service.

Local-first does **not** by itself prove:

- that an independently installed model or worker never makes network requests;
- that a child process cannot escape its workspace;
- that loopback services are safe from every process running as the same user;
- that future optional integrations are offline.

Every third-party adapter must document its observed network and filesystem behaviour. “Not observed and not configured” must not be restated as “impossible.”

## Trust boundaries

| Boundary | Stable control | Remaining risk |
| --- | --- | --- |
| User → localhost API | Runtime schemas and loopback bind | Same-user local processes may reach loopback |
| Core → SQLite | Transactions, foreign keys, audit and recovery | One-process writer assumption |
| Core → local provider | Provider contract, cancellation and redaction policy | Provider process is separately installed software |
| Core → worker gateway | Disabled by default, scoped token and revocation | Relevant once an external worker is enabled |
| Worker → workspace | Path policy and proposed-change evidence | Portable OS sandboxing is not yet stable |

## External workers

External worker support is Phase 3 work in progress.

Process-group termination, environment allowlisting and workspace policy reduce accidental exposure. They do not constitute a strong sandbox. A degraded sandbox descriptor must be visible to policy and users. Until the Phase 3 gate closes, degraded worker execution must be limited to disposable fixtures rather than presented as safe for arbitrary real projects.

Worker text, protocol messages, filenames and proposed content are untrusted. Credentials are redacted where untrusted text enters IntentSmith, and run credentials must be revoked on success, failure, cancellation, timeout, spawn failure and shutdown.

### Observed OpenCode cloud default

A clean probe of `opencode-ai@1.18.8` found that `opencode acp --pure` with an isolated home and no configuration:

- returned `opencode/big-pickle`, an OpenCode Zen cloud model, as the default model for `session/new`;
- fetched an approximately 3.2 MB provider/model catalog into the isolated cache;
- bound its ACP HTTP service to loopback with mDNS disabled.

The catalog request was classified as metadata resolution rather than inference traffic, and no prompt was sent during that observation. Nevertheless, `--pure` is not an offline guarantee and the unconfigured worker path is unsafe for IntentSmith's local-first promise.

Phase 3 must prove that generated configuration forces the IntentSmith gateway and selected local model. It must also determine whether the catalog fetch can be disabled. Until then, documentation may say that direct/cloud inference was not observed and not configured in controlled fixtures; it must not say that such inference is impossible.

## Sensitive data

Do not commit or attach:

- model prompts or responses containing private source;
- API tokens or gateway credentials;
- local SQLite databases;
- full environment dumps;
- GPU UUIDs, serial numbers or other unnecessary machine identifiers;
- private repository content in public issue reports.

When collecting diagnostics, prefer stable error codes, sanitized hardware classes, package versions and reproducible minimal fixtures.

## Dependency security

Runtime dependencies require version, integrity, license and install-script review. Protocol integrations use stable published surfaces; deprecated or internal APIs require a documented exception or are rejected.

## Reporting a vulnerability

Please use the repository's **Security** tab to submit a private vulnerability report or private security advisory. Do not open a public issue for an exploitable vulnerability or include secrets/private source in a report.

Include:

- affected version or commit;
- impact and threat model;
- minimal reproduction;
- whether the issue requires an external worker, model runtime or specific platform;
- any suggested containment.

If private reporting is not enabled, open a minimal public issue asking the maintainer to enable a private channel, without disclosing exploit details.
