# M5 AUTH + OUTBOUND + REMOTE/CONDITIONAL — adversariální remediation evidence

- **Původní review candidate:** `94ea4ea715d0019f66b47a039872aefbee2a9daa`
- **Remediation product commit:** `122b5df5303e08a38cdd62a35e6577b118795c30`
- **Stav oddílů:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`
- **Push:** neproveden

Tento řez opravuje review nálezy R07, R12, R13, R15 a R16. Není to nezávislý
re-review, M5 acceptance ani povolení otevřít M6 gate.

## R07 — úplná WS credential autorita

Globální parser rozlišuje `absent`, `valid` a `ambiguous` pro HTTP bearer i WS
bearer subprotocol. Malformed nebo duplicate credential proto není zaměněný za
nepřítomný. WS upgrade předává globální autoritě skutečné transportní headers
a samostatně parsovanou local capability; validní local capability spolu s
admin headerem, dva bearer protokoly i malformed bearer končí typed 400 před
identity binding.

## R12 a R13 — redirect a scoped outbound capability

Každý transport včetně loopback fast-path dostává `redirect: manual`. Každá
`Location` se znovu parsuje a autorizuje před dalším transportem; loopback
redirect na ne-loopback bez capability vytvoří durable deny a cíl se nevolá.
Povolený redirect na druhý exact Ollama endpoint dostane druhý durable allow.

Model-discovery capability je privátní closure v `outbound-policy.js`, není
exportovatelným tokenem ani stringovým literálem. Jediný scoped vstup
`modelDiscoveryFetch()` kontroluje metodu, nulové body, caller-supplied headers,
path a query pro tři skutečné profily: Ollama library/index family, Hugging Face
model search a WhatLLM root. Cizí Hugging Face path s Authorization headerem,
query navíc i opsaný `{ surface, scope }` selžou před transportem.

## R15 — exact project result binding

Validace úspěšného `ProjectContextSnapshot@1` po kontrole vlastního kontraktu a
digestu porovnává s requestem `workspaceRevision`, normalizovaný query a
`maxFiles/maxBytes/maxTokens`. Tři self-consistent forged snapshots mění vždy
jednu z těchto vazeb a všechny končí
`REMOTE_CORE_RESULT_IDENTITY_MISMATCH`.

## R16 — jeden conditional manifest

Preflight vytvoří a ověří `M5ConditionalSurfaceDisposition@1`. Tentýž objekt je
pak jedinou runtime enablement autoritou pro model discovery, external
notifications, marketplace, ComfyUI a updater. Server žádný z těchto pěti
přepínačů podruhé nečte z raw env/config; whitespace `C3_UPDATE_REPO` je OFF v
preflightu i runtime.

## Důkazy

| Ověření | Výsledek |
|---|---:|
| `node tests/m5-global-auth.test.js` | `11/11 PASS` |
| `node tests/m5-outbound-policy.test.js` | `10/10 PASS` |
| `node tests/m5-remote-core-adapter.test.js` | `12/12 PASS` |
| `node tests/m5-conditional-surfaces.test.js` | `9/9 PASS` |
| `node tests/ws-bridge.test.js` | `87/87 PASS` |
| M2 remote contract + boundary | `17/17 + 10/10 PASS` |
| Hugging Face / Model Sweep / Online Discovery / WhatLLM | `19/19 + 39/39 + 78/78 + 117/117 PASS` |
| model-discovery opt-in | `5/5 PASS` |
| `node tests/module-boundary-ratchet.test.js` | `13/13 PASS` |
| `node tests/artifact-validation.test.js` | `154/154 PASS` |
| `node tests/repository-hygiene.test.js` | `1847 tracked paths / PASS` |
| exact-HEAD privacy scan | `1847 tracked / 981 content-read / 0 findings` |
| `git diff --check` | `PASS` |

Exact-HEAD privacy verdict zůstává
`PASS_CURRENT_TREE_HISTORY_STILL_REACHABLE`: všech 13 incident objektů je stále
dosažitelných. Úplný deterministický gate se v průběžném bloku nespouštěl;
poslední připnutý historický stav je `284 PASS / 2 FAIL / 2 BLOCKED`, `verdict:
FAIL`, `exitCode: 1`.
