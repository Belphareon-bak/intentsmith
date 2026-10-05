# Accepted generated application snapshots

These 24 JavaScript files are the exact model-produced source bytes from four
accepted CODE/backend/M2 application snapshots. They were copied without fixes,
formatting changes or substituted reference implementations. No database,
runtime identity, prompt, full response, credential or machine path is included.

| Example | Files | Physical harness source | Generated project commit |
| --- | --- | --- | --- |
| Expense Ledger | 6 | `92f7b51c2423bdd2cc5633903a579b611d01f7f3` | `8b52262b4d7b3124451cde1a2bb8177315b2feef` |
| TaskFlow | 5 | `6f0f04d5034a5f7307882c3d0034f644c89f8dc4` | `523773dc9c4bf450cb4cbee9d2d3d7bf08f53792` |
| Packaged IDE Expense Ledger | 6 | See its separate manifest below | `7a38869cb25c1d0e3826cbf66a81dd69f8be83a8` |
| [SQLite Catalog](sqlite-catalog/README.md) | 7 | `f5964604cb76cad916fdc1ef894bfc6519c7e0d5` | `a5e789cbda24e009c0eeefeda16c202877d1b88f` |

The generated project commits identify the original private application Git
repositories; those Git objects are not imported here. The unchanged parent
`MANIFEST.json` pins the first 11 files; IDE Ledger and SQLite each have their
own manifests with byte counts, SHA-256 and original Git blob identities.
All file contents match the original provider output, M2 preview, committed
blob and filesystem. The parent manifest also pins the published Work Package
receipts at IntentSmith revision `f96c2d2358aef1e9239249d2f87949f200d83800`.

The runs used `qwen3.8:latest` at exact digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`,
provider `0.34.0-intentsmith.1`. Ledger ran 2026-10-01 09:13–09:14 UTC;
TaskFlow ran 10:57–10:58 UTC. This export inspection makes no new model call
and does not repeat or broaden the historical functional acceptance.

## Use from the IntentSmith repository root

Node 24 and the repository's existing `type: module` package context support
these dependency-free modules. The Ledger and TaskFlow `run(commands)` examples
below create fresh in-memory state and accept command tuples. SQLite has a
separate [persistent `run(dbPath, commands)` interface](sqlite-catalog/README.md).
The files contain exported functions rather than an
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

## Separate packaged IDE snapshot

[Expense Ledger generated in the packaged IDE](expense-ledger-ide/README.md)
adds six exact modules from the separate 12:06–12:07 UTC CODE/composer/M2
run. Its original source export records `REVIEW_PENDING` at export time;
the subsequent independent physical review is **REVIEW_PASS**, receipt
SHA-256 `62a55072c97427194481836eb49116cfe55edf6f97f00d814e4f395b872ff137`.
The current scope and limitations are in the
[physical IDE report](../../docs/review/2026-10-01-STUDIO2-M2-FUNCTIONAL-UI.md).
Its separate manifest SHA-256 is
`a02b7353387e43f9db7ab4cea89abf13bc7f635380c22820183b303901817378`;
source-copy/privacy review is **REVIEW_PASS**. The earlier 11 source files
and their parent manifest remain unchanged. This adds no new execution
or broader functional acceptance.

## Separate unaccepted HTTP candidate

[HTTP Items](http-items-candidate/README.md) exports four exact generated
modules, 26,139 bytes. Its physical oracle passed; source/API review found
remaining defects. It is **NOT_ACCEPTED** and is excluded from the 24 accepted
modules above. The original contract, failed history and eight-call budget
are preserved.
