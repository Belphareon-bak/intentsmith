# WP-M7-CONVERSATION-CORE-ADAPTERS

**Type:** write-enabled M7 core capability block

**Base revision:** `0f6d212c` (project-core evidence HEAD)

**Current state:** `IN_PROGRESS / NOT_ACTIVE`

## 1. User outcome

Complete the transport-free `conversations@2` capability against production
core boundaries: authorized SQLite-backed conversation list/history and an
injected accepted M1 `conversation.execute` command. A retried command must
cross the durable M7 operation journal exactly like a mutation.

## 2. Owned and forbidden paths

Owned:

- conversation list/history read models and authenticated cursor use;
- the injected M1 command adapter and result sanitization;
- provider hardening so every effectful operation (`command` or `mutation`)
  requires the durable journal;
- durable `turnId` correlation on newly persisted user/assistant messages;
- focused negative tests, registry/module pins and evidence documentation.

Forbidden:

- HTTP, WebSocket, TLS, listener, pairing, session or activation code;
- treating request identity, scope, cursor keys or conversation ownership as
  trusted authority;
- importing routes/server/session transport into the adapter;
- truncating or silently normalizing invalid protected message content;
- running a real model, Ollama, physical GPU or mobile device test;
- implementing another M7 capability in this block.

## 3. Authority contract

Authenticated device and subject enter only through the provider context.
Every conversation is checked through an injected access authority before its
metadata, content or command reaches the core and checked again before a result
is released. Missing, deleted and denied conversations share one non-oracular
result.

List/history snapshots are bounded, rebuilt from SQLite and content-addressed.
The shared HMAC cursor is bound to capability/version, operation, device,
subject, normalized query, complete snapshot revision and offset. History
pages are ascending inside a page and walk from the newest messages toward
older messages without mixing snapshots.

`conversation.execute` delegates only to an injected accepted M1 command port.
Both `command` and `mutation` provider operations require the durable journal;
commands without an `operationId` use their contract-bound `requestId` as the
journal identity. Handler execution remains at-most-once inside one journal
transition and replayed results must pass the exact operation-pair validator.

New M1 chat turns persist the contract `turnId` with the user and assistant
messages. Legacy rows without that metadata get a deterministic local fallback
identifier; the adapter does not invent terminal cancellation evidence that
was never persisted.

## 4. Demonstration and stop conditions

Required before review:

- real temporary SQLite conversations/messages produce valid list and newest
  to oldest history pages through the transport-free provider;
- deleted/denied data, cursor tamper, cross-subject replay and snapshot drift
  fail closed without content or existence oracles;
- command denial, core failure, post-execution revocation and replay preserve
  exact M1 identity without leaking internal error text;
- command and mutation both require/cross the journal and cannot invoke their
  handler twice through one journal callback;
- persisted M1 user/assistant messages share the requested `turnId`;
- full offline+database gate remains green.

Stop before production composition, cursor-key/session generation, listener,
pairing, revocation, wire transport or real LLM/device work.

## 5. Output

To be filled after the exact product candidate and evidence are frozen. This
block is not M7 acceptance or runtime activation.
