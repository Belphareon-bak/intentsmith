# Sanitized pre-082 schema fixture

- Source backup: `c3-pre-082-20260825T220813+0200.sqlite`
- Source SHA-256: `8a2c98e2dca1d7533f6f90093b2bbb4380848c87b393e9df806995d8fd1fef14`
- SQL fixture SHA-256: `0868564a855baf315abe20a4f61ac9d9818fa80d6c263043d355aabc14e31e3f`
- Source `PRAGMA quick_check`: `ok`
- Source migration stamps retained: 62
- User/application rows retained: 0

The SQL was mechanically derived from the source backup's `sqlite_master`
schema plus its `schema_migrations` rows. SQLite-owned `sqlite_sequence` and
FTS shadow-table declarations were omitted because SQLite recreates them when
the corresponding schema is replayed. No application table rows, user text,
tokens, paths, model output, or other operator data are present.

The fixture intentionally retains both historical collision triggers:
`trg_model_automation_policy_events_sequence` and
`trg_model_failover_proofs_require_artifacts`. It therefore exercises the exact
ordering defect that used to stop migration 076 before the compatibility
repairs could run.
