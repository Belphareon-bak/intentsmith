# IntentSmith Test Registry

This registry is derived from executable files and package scripts. Historical counts are not authoritative.

| ID | Tier | Command / source | Environment | Current state | Last evidence |
|---|---|---|---|---|---|
| G0-T0-GIT | T0 | `git status --porcelain=v2 --branch` | local Git | PASS at branch creation | target branch clean at `a7b90e3`; `ffd21cf` is comparison input only |
| G0-T0-DISPOSITION | T0 | `git diff --name-status a7b90e3..ffd21cf` | local Git | PENDING | 225 changed paths observed |
| G0-T0-HYGIENE | T0 | tracked sensitive-path and artifact scan | local filesystem metadata | BASELINE_RED | tracked DB, log, report, transcript and generated-project paths observed |
| G0-T0-SYNTAX | T0 | source and test syntax registry | Node 22 | PENDING | corrupt `tests/intent-classifier.test.js` known |
| G0-T0-INSTALL | T0 | `npm ci` in isolated checkout/cache | Node 22, lockfile only | PENDING | documented `tree-sitter` peer conflict |
| G0-T1-HARNESS | T1 | harness failing-fixture meta-test | Node 22 | PENDING | parent audit previously exposed false-green behavior |
| G0-T1-RELEASE | T1/T3 | `npm run test:release` | deterministic/fake providers | PENDING | historical registry is red |
| G0-T1-RUN-ALL | T1/T3 | `npm run test:run-all` | deterministic/fake providers | PENDING | runner coverage under audit |
| G0-T2-SCRIPT-GROUPS | T1/T3 | every deterministic npm test group | per command | PENDING | commands to be expanded from `package.json` |
| G0-T3-E2E | T3 | `npm run test:e2e:all` | local server and pinned model where required | PENDING | environment preflight required |
| G0-T5-NIGHTLY | T5 | local nightly registries | isolated worktrees/artifacts | PENDING | existing runner evidence must be audited |

Required per-run fields: exact command, commit, start/end time, environment, stdout/stderr artifact, exit code, classified failures, cleanup result, and evidence hash.
