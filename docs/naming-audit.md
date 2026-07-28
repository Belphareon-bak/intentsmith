# Naming and product hierarchy

## Current convention

| Name | Meaning | Intended surface |
| --- | --- | --- |
| **IntentSmith** | The complete product and project | Repository, documentation and product identity |
| **IntentSmith Core** | Local control plane and source of lifecycle truth | Core packages and local service |
| **IntentSmith Workers** | External-agent adapter layer | OpenCode, OpenHands and future workers |
| **IntentSmith Expertises** | Read-only domain synthesis profiles | Expertise registry and composer |
| **IntentSmith Skills** | Versioned controlled workflows | Skills catalog and runner |
| **IntentSmith Specialists** | Self-contained domain execution plugins | Tools, knowledge and scenarios |
| **IntentSmith Autonomous Agents** | Scheduled deterministic monitoring and automation | Agent scheduler and runs |
| **IntentSmith Studio** | Theia-based visual development environment | Desktop/web IDE surface |
| **IntentSmith Forge Local** | Packaged local desktop distribution | Installer and end-user bundle |
| `intentsmith` | Command-line executable | Shell and automation |
| `intentsmith-core` | Reserved public package form | Packaging/registry use if published |

IntentSmith is the whole product. “Forge” is not a replacement product name; it is used only in **IntentSmith Forge Local**, the future desktop distribution.

“Worker” is reserved for an adapter executing one task run. It is not a synonym
for an Autonomous Agent, Specialist, Skill or Expertise.

## Repository naming

Internal npm packages use the `@intentsmith/*` scope. Public names should be checked again immediately before publication because registry, trademark and domain availability can change.

Do not introduce:

- an alternate top-level product name;
- predecessor working names in current product documentation;
- accidental concatenations of product and distribution names;
- generic package names without checking registry ownership.

## Documentation usage

- Use **IntentSmith** on first reference.
- Use **Core**, **Workers**, **Skills** and **Studio** when the product context is unambiguous.
- Use code formatting for executable and package identifiers.
- Label future components as planned; naming does not imply implementation.

## Pre-release publication checklist

Before the first public release:

1. repeat repository, package-registry, domain and trademark searches;
2. reserve the package scope and CLI name where possible;
3. verify casing in binaries, installers and telemetry-free diagnostics;
4. decide whether the repository remains `intentsmith` or adopts an organization namespace;
5. add brand assets only after the word mark is cleared.

This document records the working convention, not legal clearance.
