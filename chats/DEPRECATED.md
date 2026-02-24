# DEPRECATED — chats/

This directory contains a legacy standalone chat server from pre-v36 era.
It is **no longer used** — all functionality has been merged into the main `src/` tree.

Contents:
- `src/server.js` — old standalone server (uses `/api/experts` endpoints, no gateway)
- `conv-*` — old conversation data directories
- `package.json` — separate dependency file (not used by main project)

**Do not modify or import from this directory.**
It will be removed in a future major version.
