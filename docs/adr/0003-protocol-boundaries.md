# ADR 0003: Protocol Boundaries

Status: accepted for Phase 0 review

Date: 2026-07-27

## Context

The product must integrate multiple workers, model providers, and tools without
making core depend on one implementation.

## Decision

Use narrow adapters:

- ACP for editor-agent style worker sessions;
- MCP for tools and context servers;
- provider contracts for local model backends;
- internal worker-sdk contracts for normalized worker events and results.

Core depends on interfaces and contracts only. Concrete adapters depend on core
contracts, never the reverse.

## Consequences

- OpenCode is the default P0 worker, but remains an external process.
- Serena is accessed through MCP and scoped capabilities.
- Ollama is the default local inference provider, but not domain logic.
- Phase 1 uses fake adapters first, so core can be tested without live models.
