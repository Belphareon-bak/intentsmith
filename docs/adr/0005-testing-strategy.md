# ADR 0005: Testing Strategy

Status: accepted for Phase 0 review

Date: 2026-07-27

## Context

Trustworthy tests are the main migration control. LLM outputs and worker claims
cannot be the only source of pass/fail truth.

## Decision

Phase 1 starts with deterministic tests only:

- unit tests for pure state and policy;
- contract tests for boundary schemas;
- integration tests with fake model and fake worker;
- persistence migration tests;
- CLI and server health checks.

Real Ollama and external worker tests are separate later gates.

## Required Properties

- Failed assertions produce non-zero exit codes.
- Test reports are machine-readable.
- Blocked environment suites remain visible as blocked, not passed.
- Flaky real-model tests are tracked separately from deterministic failures.
- Generated runtime artifacts are not committed.

## Consequences

- Phase 1 can be green offline.
- Phase 2 and Phase 3 add real-provider gates without destabilizing core tests.
- LLM evaluation becomes evidence, not authority.
