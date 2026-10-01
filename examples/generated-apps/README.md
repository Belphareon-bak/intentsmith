# Accepted generated application snapshots

These 11 JavaScript files are the exact model-produced source bytes from two
accepted CODE/backend/M2 application journeys. They were copied without fixes,
formatting changes or substituted reference implementations. No database,
runtime identity, prompt, full response, credential or machine path is included.

| Example | Files | Physical harness source | Generated project commit |
| --- | --- | --- | --- |
| Expense Ledger | 6 | `92f7b51c2423bdd2cc5633903a579b611d01f7f3` | `8b52262b4d7b3124451cde1a2bb8177315b2feef` |
| TaskFlow | 5 | `6f0f04d5034a5f7307882c3d0034f644c89f8dc4` | `523773dc9c4bf450cb4cbee9d2d3d7bf08f53792` |

The generated project commits identify the original private application Git
repositories; those Git objects are not imported here. `MANIFEST.json` pins
every exported file's byte count, SHA-256 and original Git blob identity.
All file contents match the original provider output, M2 preview, committed
blob and filesystem. The manifest also pins the already published Work Package
receipts at IntentSmith revision `f96c2d2358aef1e9239249d2f87949f200d83800`.

The runs used `qwen3.8:latest` at exact digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`. Ledger ran 2026-10-01 09:13–09:14 UTC;
TaskFlow ran 10:57–10:58 UTC. This export inspection makes no new model call
and does not repeat or broaden the historical functional acceptance.

## Use from the IntentSmith repository root

Node 24 and the repository's existing `type: module` package context support
these dependency-free modules. Each `run` creates fresh in-memory state and
accepts command tuples. The files contain exported functions rather than an
automatic process entrypoint. For example:

```sh
node --input-type=module -e "import {run} from './examples/generated-apps/expense-ledger/src/app.js'; console.log(JSON.stringify(run([['add',12.5,'food'],['add',7.25,'travel'],['add',3.5,'food'],['total'],['categories']])));"
node --input-type=module -e "import {run} from './examples/generated-apps/taskflow/src/app.js'; console.log(JSON.stringify(run([['add','First task',2],['add','Second task',3],['list',{sort:'priority'}]])));"
```

The trusted functional oracle and CLI adapter already exist in the public
`scripts/project-app-acceptance.js` and `scripts/project-taskflow-acceptance.js`.
They are not replaced by tests supplied with these generated files.

The accepted evidence covers two small in-memory applications through actual
isolated backend/M2 approval, focused tests, Git commit and restart. Installed
IDE generation, new application types, larger projects and release acceptance
have separate evidence. The complete history, including prior failures, is in
[Ledger WP](../../docs/wp/WP-PROJECT-APP-FUNCTIONAL-20261001.md) and
[TaskFlow WP](../../docs/wp/WP-PROJECT-TASKFLOW-FUNCTIONAL-20261001.md).
