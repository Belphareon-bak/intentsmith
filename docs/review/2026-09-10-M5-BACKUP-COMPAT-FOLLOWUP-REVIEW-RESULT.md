# M5 backup compatibility follow-up — independent review result

Review result: `REVIEW_PASSED`.

Reviewed candidate:
`b4136a43959d7bda4fa339f8fc10b9d0e89a51d8`.

Narrow product range:

```text
d9b96dc750ef3547ed24c474641aed177c3abdae..b4136a43959d7bda4fa339f8fc10b9d0e89a51d8
```

The original review of restore candidate `65bcbc4b` accepted the supported
historical migration model and found one low-severity gap: duplicate detection
ran before current source versions were combined with the historical allowlist.
A future source migration that reused an allowlisted historical identity could
therefore be silently collapsed by `Set`.

The follow-up checks the combined list before sorting and throws
`BACKUP_SUPPORTED_SCHEMA_DUPLICATE` on overlap. Its regression creates an
actual migration source with the historical `061` identity and proves that the
authoritative discovery path rejects it. Independent follow-up inspection found
the change minimal and correct.

Implementer verification on this candidate passed restore 20/20, pre-082
upgrade 1/1, schema migrations 55/55 and boundary 13/13. This review closes the
backup-compatibility code finding. It does not complete M5 privacy rotation,
offline custody, history disposition, acceptance or the M6 release gate.
