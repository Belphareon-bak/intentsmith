# Naming Audit

Status: preliminary

Date: 2026-07-27

## Selected Working Convention

| Name | Scope |
|---|---|
| IntentSmith | Whole product |
| IntentSmith Core | Local control plane |
| IntentSmith Studio | Theia IDE |
| IntentSmith Workers | OpenCode, OpenHands, and other agents |
| IntentSmith Skills | Workflows and specialists |
| IntentSmithtForge Local | Desktop distribution |
| `intentsmith` | CLI |
| `intentsmith-core` | Main package |

## Preliminary Risk Notes

- Formal trademark search was not completed in Phase 0.
- Domain and package-name availability were not reserved in Phase 0.
- Theia is an Eclipse Foundation trademark; IntentSmith Studio must not imply
  Eclipse endorsement.
- OpenCode, OpenHands, Serena, Promptfoo, Ollama, and related names are third
  party project names and should be used only as integration names.
- `IntentSmithtForge Local` appears to contain a double `t` in `Smitht`; this
  document preserves the supplied spelling until corrected by product decision.

## Phase 1 Blocker

Before publishing packages, docs, or a public repository, complete:

- trademark search for `IntentSmith`;
- npm name availability for `intentsmith` and `intentsmith-core`;
- GitHub organization/repository availability;
- domain availability;
- attribution and non-affiliation language for integrated third-party tools.
