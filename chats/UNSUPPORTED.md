# Standalone chats package

This standalone `chats/` package is unsupported and is not shipped as part of
the core IntentSmith 1.0 product. Starting it only emits
`C3_STANDALONE_CHATS_UNSUPPORTED_NOT_SHIPPED` and exits; it does not open a
database or start a listener.

This disposition does not apply to the canonical `/chat-ui` surface or the
main IntentSmith server. Those product surfaces are outside this decommission.

Existing standalone chats data is preserved. This change does not delete,
migrate, transform, open, or otherwise inspect an existing database, WAL,
attachment, history, configuration, log, session, or backup.

Any future export, recovery, or erase of standalone chats data requires its
own explicitly authorized Work Package. This decommission is not a privacy
erase or factory reset.
