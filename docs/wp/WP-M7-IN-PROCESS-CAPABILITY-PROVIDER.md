# WP-M7-IN-PROCESS-CAPABILITY-PROVIDER

**Type:** write-enabled M7 provider prerequisite

**Base revision:** `403ece7f` (mobile client integration evidence HEAD)

## 1. User outcome

Add a transport-free provider boundary that can expose the seven candidate M7
capabilities only when every operation has a named core handler, an injected
authority resolves the exact required scopes and every mutation crosses an
idempotent operation journal. This block prepares core composition; it does not
open a listener or activate the candidate contract.

## 2. Owned and forbidden paths

Owned:

- `src/remote/m7-in-process-capability-provider.js`;
- one focused provider test and its exact registry/module/documentation rows;
- evidence and review packet for this prerequisite.

Forbidden:

- `src/server.js`, routes, DB schema/repositories, listener or network code;
- a built-in allow-all authority or mutation path without a journal;
- session/pairing/revocation activation;
- changing the mobile candidate schemas, digests or wire contract;
- claiming any real backend operation exists merely because an injected test
  fixture conforms.

## 3. Connector

The provider is generic over the current M7 candidate requirements, manifests
and validators. It imports no candidate document and cannot activate itself.
Composition must inject the exact reviewed contract objects, operation handlers,
an authority resolver and a mutation journal.

## 4. Demonstration and stop conditions

Required before review:

- all 14 capability operations pass the existing candidate conformance harness;
- missing handlers advertise the entire capability as unavailable;
- invalid request, bad scope, bad result, unknown operation and request mutation
  fail before a false success;
- every mutation reaches the journal and the journal cannot execute the core
  handler twice;
- no server, DB, route, network or session activation is introduced.

Stop before real operation adapters, SQLite journal persistence, listener,
pairing or production activation; those require their own bounded WP and the
relevant contract/review checkpoint.
