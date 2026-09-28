# WP-M1-CONTRACT — run report

## Identita checkpointu

- **brief:** `docs/execution/m1-batch.md` § B1
- **base:** `2a59637e806b1ec5dac6de35b970eee54e1764b0`
- **implementační commit:** `93b76a78ca06b8a5a1a895aeb71f07b560939949`
- **větev:** `claude/gate1-mobile-app-progress-5sywlt`
- **stav:** B1 `COMPLETE`; rozhodnutí 001/A a 002/A operátor potvrdil na Gate 1
- **push:** neproveden; dávka jej v průběhu zakazuje

Base se během přípravy posunul cizím, nepřekrývajícím dokumentačním
commitem z `c9569aea` na `2a59637e`. B1 přijal nový fyzický base a cizí
inventury neupravoval.

## Změněný kontrakt

Commit zavádí aditivní `PROVISIONAL_V1`, nikoli migraci dnešních
konzumentů:

- `ConversationCommand/Result`, `ModelRequest/Result` a `CoreEvent` nesou
  `requestId`, `conversationId` a `turnId`;
- `conversationId` je durability identita, `sessionId` je z kontraktu
  vyloučen;
- cancel je vázaný na celou trojici ID;
- terminál je přesně jeden z `ok | cancelled | timeout | error`;
- pouze `ok` může renderovat a persistovat assistant odpověď;
- `error` smí nést jen ohraničené souhrny tool výsledků, nikdy raw
  `value`;
- prázdný modelový výstup není úspěch;
- eventy mají rostoucí `sequence`, jeden poslední terminál a top-level
  rozlišení `progress | terminal`;
- pozdní `ok` po cancelu je odmítnut a nepersistuje se;
- export v `src/ws-bridge/protocol.js` je pouze aditivní, legacy handshake
  verze se nemění.

JS validátor je kanonický runtime kontrakt. TypeScript mirror má stejné
uzavřené uniony a runtime validaci. Standardní registrovaný test jej na
podporovaném Node 22 skutečně vykoná přes native type stripping; nekontroluje
jen text zdroje.

## Autonomní defaulty, potvrzené operátorem 2026-08-08

- `D-1`: `degraded` nebyl přidán. Provider failure s dřívějšími tool daty
  zůstává `error`; schéma dovoluje sanitizované partial souhrny, ale produkční
  `persistPartialToolResults` dnes nemá konzumenta. Report proto netvrdí, že se
  partial skutečně ukládá. Nikdy se nerenderuje jako assistant. Detail je v
  `docs/decisions/001-m1-degraded-vs-error.md`.
- `D-2`: první terminál je definitivní. Pozdní assistant po cancelu se
  odmítne. Detail je v
  `docs/decisions/002-m1-late-assistant-after-cancel.md`.
- streaming je podle roadmapy mimo přijatý connector v1; v1 pouze rezervuje
  kompatibilní progress event. Nejde o formální dávkový `PARK` a nevznikl pro
  něj parkovací záznam v rozhodovací frontě.

Operátor potvrdil 001/A a 002/A beze změny. Tím je rozhodovací část B1
uzavřená; produkční Studio consumer a runtime delivery zůstávají B4 scope.

## Otestovaný kandidát

Focused a povinná baterie nad hlavním checkoutem:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-contract.test.js` | 26 passed, 0 failed | 0 |
| `node tests/ws-bridge.test.js` | 64 passed, 0 failed | 0 |
| `node tests/artifact-validation.test.js` | 151 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 360 programů, 8 exclusions, valid | 0 |
| `node tests/repository-hygiene.test.js` | 1450 tracked paths | 0 |
| `git diff --check` | bez chyb | 0 |

Registry fingerprint kandidáta je
`e5bfba40b015d5dd3d0d44ab1fb8031003d2ec608a93740ebf231e4b4b08bc5e`.

Po commitu byl vytvořen nový disposable local clone mimo `Projects`.
`git rev-parse HEAD` v něm vrátil přesně
`93b76a78ca06b8a5a1a895aeb71f07b560939949`. V tomto checkoutu proběhlo:

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `corepack yarn@1.22.22 install --frozen-lockfile` | instalace dokončena; pouze peer/engine warnings | 0 |
| `corepack yarn@1.22.22 workspace @c3/protocol build` | `tsc -b`, build dokončen | 0 |
| `node tests/m1-contract.test.js --typescript-runtime=<clone>/c3-ide/extensions/c3-protocol/lib/m1.js` | 27 passed, 0 failed | 0 |

Build zapisoval generated `lib` pouze v disposable klonu. Autoritativní Studio
runtime ani `c3-ide/**/lib/**` v hlavním checkoutu nezměnil.

## Zachycená červená evidence a opravy

Červené mezivýsledky nebyly přepsány na green:

1. `corepack yarn --cwd <clone>/c3-ide install --frozen-lockfile` skončil
   exitem 1, protože Corepack vybral kořenové `packageManager: npm`.
   Reprodukovatelný příkaz proto explicitně pinuje `yarn@1.22.22` a běží z
   `c3-ide/`.
2. První disposable compile skončil exitem 1 na `TS2352` v `m1.ts`.
   Bezpečná post-validation type assertion byla opravena; následující dva
   čisté buildy skončily exitem 0.
3. První artifact-validation po registraci skončil `150 passed, 1 failed`,
   protože README stále uvádělo 359 programů. README i negativní drift pin
   byly atomicky srovnány na 360/263 ACTIVE; opakovaný běh je 151/151.
4. Finální read-only review nejprve vrátilo dva `HIGH`: fail-open použití
   terminálního seam a volitelný TS runtime test. Oba byly opraveny a
   re-review vrátil `APPROVED`.

## Omezení a následní vlastníci

- Produkční HTTP, WS ani Studio konzument zatím nový kontrakt nepoužívá.
  Jejich migraci vlastní B2–B4; B1 netvrdí runtime produktovou integraci.
- `c3-ide/extensions/c3-protocol/lib` zůstal v hlavním stromu beze změny.
  Produkční Studio evidenci proto nesmí nahradit source-level green.
- `engines >=22.0.0 <23` zahrnuje i starší Node 22 bez defaultního native
  type strippingu. Takové prostředí skončí setup failure, ne false-green.
  Před release profilem musí integrační vlastník zpřesnit minimální Node,
  nebo deklarovat konkrétní toolchain prerequisite.
- Nebyl spuštěn Electron, Ollama ani GPU; B1 je dependency-free contract WP a
  tyto runtime důkazy nejsou jeho acceptance podmínkou.
