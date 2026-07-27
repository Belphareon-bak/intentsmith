# ADR 0010: Transaction Context Is Owned By The Store, Not The Module

Status: accepted for Phase 1.1

Date: 2026-07-27

## Context

`BetterSqliteStore.transaction()` detects a reentrant call so it does not issue
a nested `BEGIN IMMEDIATE`; better-sqlite3 exposes one connection with a single
transaction slot, and nesting fails outright.

The first implementation kept that detection in a module-level
`AsyncLocalStorage`. Because the context is keyed by async execution and not by
connection, every store shared it. Opening a transaction on store A and then
starting one on store B inside it made B look reentrant. B skipped its own
`BEGIN IMMEDIATE`, so B's statements ran in autocommit: a failure inside B's
callback rolled back nothing, and B's writes survived a transaction that was
supposed to undo them.

This is reachable whenever more than one database is open in one process, for
example a test using two stores, or a future maintenance or migration path.

## Decision

The `AsyncLocalStorage` is a private field of `BetterSqliteStore`. Each instance
owns its own context, so `getStore()` returns a value only when *this* store
already has a transaction open in the current async context.

Alternatives considered and rejected:

- **Keying a shared map by connection.** Equivalent behaviour with extra
  bookkeeping and a lifetime question on close. Instance ownership gets the
  same isolation from the object model itself.
- **A global transaction mutex across all stores.** Would serialize independent
  databases against each other for no correctness benefit.

## Consequences

- A transaction on another database nested inside this one gets its own real
  transaction, with its own commit and rollback.
- Reentrancy still joins the open transaction on the same store, so lifecycle
  code that composes repository calls inside one transaction is unaffected.
- Top-level transactions on one store remain serialized on that store's queue.
- Independent stores share no synchronization.
