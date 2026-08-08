# Import a connector census pro budoucí module boundary

**Datum:** 2026-08-09
**Zdrojová revision:** `8116d09f96b9c92338e0791f74bb825a572603a6`
**Ratchet checkpoint:** `b7afc721f810f248364275f679ce1af77108d81a`
**Metoda:** existující P6 scanner, bez nového parseru. Bucket je první část
cesty za `src/`; root soubor (`server.js`, `config.js`) zůstává vlastním
bucketem. Bucket **není** rozhodnutí `core / optional`.

## Shrnutí

| Metrika | Hodnota |
|---|---:|
| P6 source souborů | 416 |
| Vnitřních importních hran | 1 004 |
| Hran uvnitř stejného top-level bucketu | 457 |
| Hran přes top-level boundary | **547** |
| Unikátních směrovaných boundary dvojic | **137** |
| Dynamických boundary hran | 134 |
| Cykly / soubory v cyklech | **3 / 28** |
| Barrels / importy přes barrel / deep bypass | 11 / 9 / 97 |
| Přímých hran ze `src/server.js` | **87** |

Z čísel neplyne, že má vzniknout 137 portů. Plyne z nich, že fyzické přesuny
bez vlastnictví stavu, kontraktu a composition boundary samy modularitu
nevytvoří. Ratchet v1 těchto 1 004 hran hlídá směrově slepě; cestová mapa pro
`core → optional` zůstává úkolem `WP-M3-BOUNDARY`.

## Nejdůležitější řezy

| Řez | Naměřená závislost | Důsledek |
|---|---|---|
| Chat ↔ planner | 10 : 1 | lifecycle není samostatný adaptér; back-edge je součást architektonického dluhu |
| Chat ↔ LLM | 12 : 3 | gateway má kontrakt M1, ale tři back-edge stále spojují provider vrstvu s chatem |
| Chat ↔ executor | 1 : 1 | patří do 21souborového SCC, ne do levného přesunu utility |
| Chat ↔ specialists | 1 : 1 | specialist loader je uvnitř hlavního chat SCC |
| Chat → expertises | 17 | potvrzuje cenu vytažení expertises do extension boundary |
| Planner → DB | 13 | lifecycle repository není vlastněný řez; planner bere globální singleton přímo |
| Routes → planner / upgrade | 11 / 11 | HTTP adaptéry přímo skládají doménové implementace |
| Server → routes / upgrade / chat | 17 / 9 / 6 | composition root eager zná konkrétní volitelné implementace |

### Sdílený stav není totéž co levný společný kontrakt

- `src/config.js` má **33** P6 importérů. `src/upgrade/upgrade-manager.js` a
  `model-registry.js` navíc mění modelové bindingy napříč moduly; tento řez
  proto vyžaduje jednoho vlastníka, ne jen nový název portu.
- `src/db/database.js` má **26** přímých source importérů a import otevře
  sdílenou DB/repository vrstvu. Lifecycle, chat, skills, autonomy i WS tak
  sdílejí mutable state bez modulového vlastníka.
- `src/core/logger.js` má **184** přímých importních hran, ale publikuje úzkou
  službu a není srovnatelný s config/DB authority. Samotný vysoký fan-in tedy
  není důkaz špatné hranice.

## Co je dnes skutečně verzovaný connector

P6 měří jen cíle uvnitř `src/**`, takže `contracts/m1/**` v jeho 1 004 hranách
není. Samostatný runtime scan našel pět source konzumentů:

| Konzument | Connector |
|---|---|
| `src/routes/chat.js` | `contracts/m1/index.js` |
| `src/llm/gateway.js` | `index.js` + `shared.js` |
| `src/llm/cre-bridge.js` | `index.js` + `shared.js` |
| `src/ws-bridge/protocol.js` | `index.js` |
| `src/ws-bridge/ws-server.js` | `shared.js` |

To je použitelný vzor vlastnictví a verze, ne kompletní extension boundary.
Lifecycle command, model-binding query/command, observation sink ani obecný
extension manifest dnes stejně verzovaný veřejný řez nemají.

## Úplný top-level adjacency census

Tabulka obsahuje všech **137** směrovaných dvojic. Číslo je počet P6 hran;
pořadí cílů je sestupně podle počtu.

| From | To buckets (edge count) |
|---|---|
| `agents` | core (2) |
| `architect` | llm (12), core (11), planner (1) |
| `autonomy` | config.js (3), db (1) |
| `channels` | core (1) |
| `chat` | core (51), expertises (17), llm (12), memory (12), planner (10), code-intel (7), config.js (7), db (7), skills (5), agents (3), upgrade (2), executor (1), specialists (1) |
| `code-intel` | core (25), context (1), ws-bridge (1) |
| `config.js` | timeout-policy.js (1) |
| `context` | core (2), code-intel (1) |
| `core` | config.js (1) |
| `db` | core (4), config.js (1) |
| `domains` | core (1) |
| `executor` | core (6), context (3), patch (3), config.js (2), chat (1), llm (1), upgrade (1) |
| `expertises` | core (6) |
| `licensing` | core (1) |
| `llm` | core (7), chat (3), config.js (2), system (1), upgrade (1) |
| `marketplace` | core (2) |
| `media` | core (3), llm (1), system (1), ws-bridge (1) |
| `memory` | core (7) |
| `notifications` | core (10) |
| `packaging` | core (1) |
| `patch` | core (5), code-intel (3) |
| `planner` | core (23), code-intel (16), db (13), config.js (4), executor (4), llm (2), architect (1), chat (1), context (1), memory (1), patch (1), upgrade (1) |
| `routes` | planner (11), upgrade (11), chat (8), core (7), expertises (5), config.js (3), system (3), ws-bridge (3), db (2), media (2), packaging (2), skills (2), agents (1), architect (1), marketplace (1), specialists (1) |
| `runtime-environment.js` | security (2) |
| `server-port-file.js` | security (1) |
| `server.js` | routes (17), upgrade (9), chat (6), notifications (6), agents (5), core (5), memory (4), expertises (3), llm (3), media (3), ws-bridge (3), db (2), marketplace (2), security (2), specialists (2), system (2), autonomy (1), config.js (1), executor (1), licensing (1), packaging (1), planner (1), runtime-environment.js (1), server-port-file.js (1), setup (1), skills (1), telemetry (1), timeout-policy.js (1), tools (1) |
| `setup` | core (1) |
| `skills` | llm (7), config.js (3), core (2), db (2) |
| `specialists` | chat (1), core (1), executor (1), expertises (1) |
| `system` | core (3) |
| `telemetry` | core (1) |
| `tools` | core (2), memory (1) |
| `upgrade` | core (8), config.js (5), system (1) |
| `ws-bridge` | core (3), chat (1), config.js (1), db (1), executor (1), packaging (1), security (1), telemetry (1) |

Reciproční top-level dvojice jsou přesně: `architect ↔ planner` (1:1),
`chat ↔ executor` (1:1), `chat ↔ llm` (12:3), `chat ↔ planner` (10:1),
`chat ↔ specialists` (1:1) a `code-intel ↔ context` (1:1). Adresářová
reciprocita není sama SCC; skutečné tři SCC jsou uvedené níže.

## Cyklická struktura

1. **21 souborů:** chat controller/CRE + handlery +
   `executor/tool-executor.js` + `specialists/specialist-loader.js`;
2. **5 souborů:** `chat/safety/engine.js` a čtyři policy soubory;
3. **2 soubory:** `planner/index.js ↔ planner/lifecycle-build.js`.

Nový edge ratchet zakáže růst a nový cyklus. Nerozpustí ale existující SCC;
to vyžaduje vlastněné contracts a composition změny ve `WP-M3-BOUNDARY`.

## Konkrétní vstup pro WP-M3-BOUNDARY

1. **Nejdřív přijmout cestovou mapu.** Doménový seznam jádra z R1 je nutný,
   ale nestačí k automatickému přiřazení těchto bucketů.
2. **Oddělit state authority.** Model binding musí být jediným writerem
   modelových hodnot; lifecycle repository jediným writerem lifecycle tabulek.
3. **Publikovat core-owned kontrakty.** Optional implementace smí jádro
   konzumovat, ale jádro nesmí importovat její konkrétní loader/handler.
4. **Přestavět composition root.** Disabled modul nesmí být mezi 87 hranami
   `server.js`, routami, timery ani background joby.
5. **Až potom zapnout směr.** Nad přijatou mapou se do stejného ratchetu přidá
   `core → optional` pravidlo; v1 si klasifikaci nesmí domýšlet.

## Limity

- P6 nevidí deset computed `import()` míst, obsah template literals ani HTML
  `<script src>`; checker tuto větu vypisuje při každém běhu.
- 134 dynamických boundary hran jsou literal importy, nikoli důkaz runtime
  aktivace. Lazy syntax sama neznamená odpojitelný modul.
- Census měří zdrojové importy, ne vlastnictví DB tabulek, config klíčů,
  timerů nebo efektů. Ty musí mít vlastní contract/disabled-boot důkaz.
- Dokument není přijatá path mapa ani návrh 137 portů; je úplný měřený vstup
  pro operátorské rozhodnutí v `WP-M3-BOUNDARY`.
