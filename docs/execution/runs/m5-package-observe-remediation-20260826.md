# M5 PACKAGE + OBSERVE — adversariální remediation evidence

- **Původní review candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Remediation product commit:** `8be0094dcc006ba1e22e1937ca81f5b18bb767d2`
- **Stav oddílů:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`
- **PACKAGE final-candidate fresh clone:** `PASS` na `034e00f5`
- **Push:** neproveden

Tento řez opravuje review nálezy R01, R02 a R11. Není to nezávislý re-review,
M5 acceptance ani povolení otevřít M6 gate.

## R01 — verify-only je skutečně read-only

Při Node majoru mimo 22 vede `--verify-only` přímo do chyby a inkrementu
preflight counteru. NVM auto-fix větev je dosažitelná jen v instalačním režimu.
Adversariální fixture poskytuje Node 20 i spustitelné fake `nvm`; příkaz skončí
exit 1 a marker prokazuje, že fake NVM nebylo zavoláno. Preflight nadále
inventarizuje ostatní prerequisites, ale neinstaluje, nesourcuje runtime,
nestahuje, nebuildí ani neprovádí runtime sondy.

## R02 — pravdivý upgrade návod a smoke

Upgrade nyní vytváří a ověřuje backup ještě na běžícím původním releasu,
odkazuje na existující `STORAGE-ARCHITECTURE.md#state-backup` a po upgradu
používá veřejný `GET /api/health`. Smoke test ověřuje existenci cílového
dokumentu, absenci `docs/STORAGE.md` a `/api/status`, skutečnou route v serveru
a přesný výskyt obou dokumentovaných verify-only příkazů. Tyto dva příkazy
focused sada také skutečně spouští.

Původní offline fresh-clone install/build/journey na `ce6b8276` zůstává
historickým důkazem. Finální opakování na product `034e00f5` prošlo z
`git clone --no-local`: offline install/build, health, deterministic chat,
graceful shutdown i čistý source. Přesné digests jsou ve společném
[`m5-integration-closeout-20260826.md`](m5-integration-closeout-20260826.md).

## R11 — close bez finish

Listener `close` vždy volá `finalize(true)`. Existující `state.finalized` latch
odmítne druhou finalizaci po normálním `finish`. Regrese simuluje Node stav
`writableEnded=true`, `close` bez `finish` a dostane
`activeRequests=0/completedRequests=1/aborted=1`; samostatná regrese ověřuje
`finish → close` jako právě jeden 2xx completion.

## Důkazy

| Ověření | Výsledek |
|---|---:|
| `node --test tests/m5-install-profile.test.js` | `10/10 PASS` |
| `node tests/m5-observability.test.js` | `7/7 PASS` |
| `node tests/routes-smoke.test.js` | `119/119 PASS` |
| `node tests/server-shutdown.test.js` | `4/4 PASS` |
| `node tests/capability-01-server-behaviours.test.js` | `14/14 PASS` |
| `node --test tests/m5-global-auth.test.js` | `11/11 PASS` |
| `node tests/module-boundary-ratchet.test.js` | `13/13 PASS` |
| `node tests/artifact-validation.test.js` | `154/154 PASS` |
| `node tests/repository-hygiene.test.js` | `1848 tracked paths / PASS` |
| exact-HEAD privacy scan | `1848 tracked / 981 content-read / 0 findings` |
| `bash -n scripts/install.sh` + `git diff --check` | `PASS` |

Exact-HEAD privacy verdict zůstává
`PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE`: všech 13 incident objektů je stále
dosažitelných. Úplný deterministický gate se v průběžném bloku nespouštěl;
poslední připnutý historický stav je `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict:
FAIL`, `exitCode: 1`.
