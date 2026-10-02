# SQLite Catalog — accepted generated source

Seven exact model-produced modules, 8,965 bytes, from the accepted real
IntentSmith CODE/backend/M2 SQLite journey. No generated source was edited,
formatted or replaced. The ninth model generation repaired CLI dispatch;
the other six modules are exact retained outputs of the previous failed plan.
All seven files match provider output, approved preview, durable material,
filesystem and the original project Git blobs.

**APPLICATION_ACCEPTANCE_REVIEW_PASS / PHYSICAL_SQLITE_SCENARIO_ACCEPTED.**
Physical harness source `f5964604cb76cad916fdc1ef894bfc6519c7e0d5`;
original private project commit `a5e789cbda24e009c0eeefeda16c202877d1b88f`.
The final run was 2026-10-02 08:18:22–08:18:41 UTC with `qwen3.8:latest`,
digest `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`. The independent acceptance receipt SHA-256 is
`41d18e640cfbeaa9aaad38813ba822335f472438c5b96e72a0de823f9fb7302f`.
`MANIFEST.json` records every byte count, SHA-256, Git blob and generation
position, the final receipt hashes and the preserved historical lineage.

## Application interface

`run(dbPath, commands)` opens a SQLite catalog, executes a whole tuple batch
atomically and closes the database. Commands are `add`, `get`, `list`,
`search`, `update` and `delete`; prices use integer cents. The trusted public
contract and oracle are in `scripts/project-sqlite-catalog-acceptance.js` and
`scripts/project-sqlite-catalog-oracle.mjs`. Their independent checks include
CRUD, Unicode, prepared SQL, literal search, native schema constraints,
invalid batches and reopening the same database from another process.

From this repository root with Node 24 and its existing ESM package context:

```sh
node --input-type=module -e "import {run} from './examples/generated-apps/sqlite-catalog/src/app.js'; console.log(JSON.stringify(run('./catalog.sqlite',[['add','SKU-1','First item',2,1500],['list']])));"
node --input-type=module -e "import {run} from './examples/generated-apps/sqlite-catalog/src/app.js'; console.log(JSON.stringify(run('./catalog.sqlite',[['list']])));"
```

These usage commands create a local database at the supplied path. The
modules export functions; they have no automatic CLI entrypoint or external
dependencies. This source export adds no new execution or model call.

## Scope and retained history

The real journey verified exact approval, the unchanged functional oracle,
Git commit and backend restart. The oracle verifies row persistence between
CLI child processes within one sandbox. Every separate canonical sandbox
has a fresh private `/tmp` database; backend restart verifies durable M2
state, source bytes and commit, followed by a new functional test. Reusing
the same application database across separate sandboxes is not claimed.
Pending/final restart and replay assertions were reached by the real runner;
their HTTP response bodies are not separately retained.

This directory contains domain source and hash identities only: no database,
private runtime IDs, machine paths, prompts, full responses, credentials or
private Git objects. Earlier failed model runs and rollback evidence remain
unchanged. Installed Studio renderer, deployment, broader planning quality,
CHAT, mobile and whole-product release have separate acceptance gates.
See the [SQLite WP](../../../docs/wp/WP-PROJECT-SQLITE-CATALOG-FUNCTIONAL-20261001.md)
and [CODE context/continuation WP](../../../docs/wp/WP-CODE-PEER-CONTEXT-BUDGET-20261001.md).
