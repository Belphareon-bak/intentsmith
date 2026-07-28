# Product vision

## One-sentence thesis

IntentSmith is a local-first control plane that makes AI-assisted software work inspectable, policy-bound and evidence-driven on hardware the developer already owns.

## The problem

Local models and open-source coding agents are individually useful, but assembling them into a dependable development system still requires substantial glue:

- model selection must fit actual hardware;
- agent capabilities and protocol versions must be truthful;
- workspace access, approvals and cancellation need lifecycle semantics;
- untrusted worker output must not become authority;
- a claimed success must be checked against deterministic evidence;
- failures and interrupted runs must be recoverable and auditable.

IntentSmith owns that glue. It deliberately reuses mature open-source components behind contracts instead of rebuilding an IDE, model runtime, agent or language tooling from scratch.

## Who it is for

The primary user is a developer or small team that:

- has a solid local CPU/GPU workstation;
- wants useful agentic coding without mandatory cloud inference or a recurring AI subscription;
- values control over source code, prompts and execution;
- is willing to trade some model peak performance for ownership, predictable cost and inspectability;
- wants one control plane that can evolve across providers, workers and interfaces.

## Product principles

1. **Local is the default, not a marketing label.** No silent cloud fallback is allowed.
2. **Core owns truth.** Workers may report outcomes, but Core owns lifecycle state and verdicts.
3. **Reuse through boundaries.** Ollama, OpenCode, OpenHands, Theia, MCP and Serena are candidates or integrations, not copied subsystems.
4. **Contracts precede adapters.** A real adapter must pass the same behavioural suite as the deterministic fake.
5. **Evidence beats confidence.** A pass requires successful deterministic gates and valid lifecycle evidence.
6. **Degradation is explicit.** Missing sandbox features, unsupported capabilities and weak isolation are visible to the user.
7. **State belongs to the user.** Persistent project data remains local and exportable.
8. **Offline verification stays fast.** The default test suite does not require a model, GPU, network or third-party executable.

## Product areas

| Area | Purpose | Status |
| --- | --- | --- |
| IntentSmith Core | Lifecycle, policy, evidence, verdicts and audit | Stable foundation |
| IntentSmith Workers | Contracted execution adapters | OpenCode integration in progress |
| IntentSmith Skills | Reusable workflows and specialist behaviour | Planned |
| IntentSmith Studio | Theia-based visual environment | Planned |
| IntentSmith Forge Local | Packaged desktop distribution | Directional |
| `intentsmith` CLI | Automation and headless operation | Stable foundation |

## What makes it distinct

IntentSmith is not differentiated by inventing another model runner or code agent. Its product value is the controlled composition:

- hardware-aware local model selection;
- a provider boundary with no vendor transport shapes in Core;
- a worker boundary with capability discovery and shared contract tests;
- short-lived, least-authority access from workers back to local inference;
- persisted task/run separation, append-only audit and conservative restart recovery;
- deterministic workspace gates that produce the final verdict;
- one product path from CLI to Studio and desktop packaging.

## Non-goals

IntentSmith is not currently:

- a hosted multi-tenant SaaS;
- a replacement for Ollama or another inference runtime;
- a new general-purpose coding-agent protocol;
- a promise of operating-system-grade sandboxing on every platform;
- an autonomous merge-to-production system;
- a compatibility layer for every model and agent at once.

## Intended user journey

1. Install IntentSmith and detect local hardware.
2. Connect or install a supported local model runtime.
3. Open a project and describe an intent.
4. Review the execution scope and any required approvals.
5. Let a worker propose changes through a contracted run.
6. Inspect the diff, event trail and deterministic gate results.
7. Accept, revise or reject the proposed change set.

## Product success

The project is successful when a developer can complete useful coding tasks locally with:

- no mandatory cloud account;
- a predictable and inspectable execution path;
- reliable cancellation and recovery;
- clear reasons for every failed or blocked verdict;
- swappable providers and workers that do not weaken Core's guarantees;
- a setup experience that does not require understanding the internal monorepo.
