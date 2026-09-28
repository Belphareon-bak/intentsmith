# Temporary chat-learning setting

Authority: the operator's latest review explicitly leaves the learningEnabled decision to this worker; the preceding memory audit is accepted as credible. The intent correction code and clean offline,database audit are complete before this separate settings action.

Action: set only `intentsmith.memory.learningEnabled=false` in the live instance's single user_settings document through `updateUserSettings` from the running release. Preserve all unrelated keys and existing memory records. Scope is global to this IntentSmith instance, not per conversation/project. History, context and LTM reads remain enabled; M4 authority is independent.

Preflight: read-only live DB policy and scoped row count, exact runtime writer identity, valid settings document. Verification: before/after policy, exact equality of all other settings, and a receipt with timestamps and settings hashes without setting contents. No schema write, direct SQL update, service restart, provider request or source deployment. On malformed storage or an unexpected policy, stop without overwriting it.

Rollback: use the same typed writer to restore the prior learningEnabled override (delete this key if it was absent). Do not restore a whole stale settings document. Re-enable after the feedback detector and its consumers have been reviewed and verified.
