# G0-R026 route factory smoke-test truthfulness

## Defect

The registered route smoke suite stated that every route factory must construct
and return a route map, but its catch block only printed a warning. Its mock
also omitted the `path` dependency required while constructing expertise
routes. The observed run therefore printed an expertise-factory exception,
reported `50 passed, 0 failed`, and exited 0.

## Repair

- The shared construction fixture supplies the production `path` module.
- A factory exception now calls the suite's failing assertion before it is
  rendered, so it contributes to the final failure count and process exit.
- No product route, assertion target, or accepted response contract changed.

## Focused proof

| Command | Result | Exit |
|---|---|---:|
| `node tests/routes-smoke.test.js` with an isolated `C3_DB_PATH` | all eight factories return route maps; 53 passed, 0 failed | 0 |
| same command after temporarily removing `path` from the construction fixture | named `createExpertiseRoutes()` construction failure; 50 passed, 1 failed | 1 |

The temporary mutation was restored. These worktree results are not a Gate
verdict; the positive command is repeated against the committed candidate.
