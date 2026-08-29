# WP-M7-PERSISTENT-MUTATION-JOURNAL

**Type:** write-enabled M7 recovery prerequisite

**Base revision:** `abc2968d` (provider evidence HEAD)

## 1. User outcome

Persist the identity and first validated outcome of every M7 mutation before a
remote retry can perform the operation twice. The identity is the candidate
session contract tuple `deviceId + subjectId + operationId`; operation type and
canonical request digest must also match.

## 2. Owned and forbidden paths

Owned:

- one new M7 operation-journal validation module, migration and repository;
- the minimal provider identity/result-validation correction needed to inject
  the exact trusted device identity and persist only contract-valid results;
- focused tests, registry/module/schema pins and evidence documentation.

Forbidden:

- listener, route, session or pairing activation;
- actual approval/settings/notification/stored-information handlers;
- automatic retry after an unknown outcome;
- deleting or overwriting journal history;
- storing the mutation request payload (only its canonical digest is retained);
- importing the retired legacy mobile gateway or its mutable journal.

## 3. Storage and recovery contract

Migration slot `101` is reserved after a fresh census of 378 live refs and all
27 local worktrees found no identity above `100`. The schema is append-only.
An intent record is committed before `execute()`. The first validated result is
then appended exactly once. Same identity and bytes replays the stored result;
same identity with another operation type or digest is a typed conflict. An
intent without an outcome or an exception after execution is `UNKNOWN` and is
never executed automatically again.

The request body is not retained. Result bytes are retained as canonical BLOB
because exact replay requires them. Every read reparses and revalidates raw
bytes; the SQLite deterministic validator is re-registered by every repository
instance after process restart.

## 4. Demonstration and stop conditions

Required before review:

- concurrent retries execute the handler at most once;
- restart replay returns the first validated result with `replayed: true`;
- cross-device and cross-subject identities remain separate;
- digest conflict, incomplete intent, thrown handler, invalid result, tampered
  bytes, update/delete and a second SQLite connection without the validator all
  fail closed;
- migration/schema/registry/module/artifact compatibility remains green.

Stop before abandonment control-plane semantics, retention/purge policy,
session-owner liveness, operation list/get wire adapters or any listener.
