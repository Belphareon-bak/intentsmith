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

## Pilotní čas a procesní incident

| Událost | Čas (Europe/Prague) | Commit / výsledek |
|---|---|---|
| governance přijata | 01:00:09 | `8116d09f` |
| diskový worktree registrován | 01:01:55 | `/home/belphareon/worktrees/is-boundary-ratchet` |
| fáze A dokončena | 01:12:08 | `b7afc721`, 6/6, registry 374 |
| fáze B dokončena | 01:16:13 | `23d23fc0`, live část pravdivě BLOCKED |
| fáze C dokončena | 01:16:21 | `954e1ecc` |

Počet vyžádaných operátorských zásahů během A–C: **0**. Přesný `T_saved`,
`T_recurring`, `T_net` ani návratnost se zatím nevyčíslují: chybí integrační
konec a běh obsahoval procesní incident, který by číslo zkreslil.

### Incident: dva writeři ve stejném ratchet checkoutu

Po založení větve jiná session přesunula worktree z původní diskové cesty na
kanonickou cestu výše a současně zapsala jinou implementaci
`scripts/module-boundary-ratchet.mjs`. V intervalu se překryly i baseline/test
práce. Osiřelá stará cesta obsahovala pouze jeden nově vzniklý checker soubor;
byla přesně odstraněna. Cizí implementace nebyla zahozena: stala se základem,
nad který se doplnila povinná P6 limitation notice, kompatibilní exact-pair
baseline a šest CLI testů.

Technický výsledek je deterministicky zelený, ale **procesní pilot není platný
úspěch**. Porušil normativní invariant jeden writer na checkout a místo dvou
kontrolovaných writerů vznikl třetí neohlášený writer uvnitř stejného WP.
Integrátor to musí započítat jako tvrdý procesní neúspěch nebo invalidaci tohoto
pilotního měření; nesmí z něj odvodit kladné `T_net`. Ratchet jako samostatný
aparát tím zneplatněn není.

### Integrační review — oprava current-tree acceptance

Nezávislý review po merge správně zachytil, že checker odebranou hranu povolí,
ale původní current-tree test natvrdo vyžadoval `1004 → 1004`. První legitimní
utažení grafu by proto shodilo registrovanou sadu, přestože checker skončil
PASS. Follow-up test nyní odvozuje baseline count z fixture, vyžaduje
`added=0`, `currentEdges <= baselineEdges`, přesný rozdíl `removed` a při
odebrání povinné `BASELINE_TIGHTENING_AVAILABLE`. Neoslabil se na pouhou
přítomnost slova PASS.

### Post-integration hardening — série počínaje `e2dcecd3`

Review po integraci našlo dvě provozní vady a několik omezení. Follow-up je
opravuje bez změny pair-based architektonické politiky:

- scanner může emitovat statickou i dynamickou podobu stejné rozřešené dvojice;
  checker je nyní deduplikuje **až po** odstranění markeru. Kolize tedy nezmění
  drift na nesouvisející `INVALID_GRAPH` a nová dvojice se reportuje jednou;
- `--write-baseline` nahradil ruční editaci JSONu. Vyžaduje čistý Git strom,
  odmítá syntetický graf a růst cyklu, před zápisem znovu hlídá stabilní
  revision/tree/scanner, první průchod s novými hranami nic nezapíše a druhý
  vyžaduje přesnou `--accept-edge` pro každou přijatou hranu;
- schema v2 váže baseline na zdrojový commit, jeho `src/**` tree a blob
  scanneru. V Git checkoutu se připnutý tree znovu proskenuje a musí přesně
  reprodukovat hrany i cyklické limity; ruční allowlist s historickou revizí
  tedy selže. Čistý export bez `.git` zůstane spustitelný, ale hlásí
  `UNVERIFIED` místo falešného ověření;
- autoritativní scanner je `scripts/module-graph.mjs`; datovaná P6 cesta je
  kompatibilitní wrapper. Limity jsou strukturovaná metadata scanneru, ne
  byteově připnutá věta baseline;
- drift má exit `1`, neplatný vstup nebo porucha nástroje exit `2`.

Tím se odstraňuje ruční práce nad tisíciřádkovým allowlistem, ale ne cena review:
první výpis delta, kontrola a případný druhý přesně autorizovaný writer průchod
zůstávají `T_recurring` podle pilotu §6.

Snapshot tohoto census zůstává pravdivě **416** souborů na `8116d09f`.
Relokovaný scanner na follow-up parentu naměřil **417 / 1 004 / 3 / 28**;
rozdíl jednoho source souboru je revision drift, nikoli oprava historického
měření. Protocol 1 stále neratchetuje změnu static↔dynamic a neskenuje čtyři
`.d.ts` soubory; obojí teď vypisuje jako explicitní limit, ne jako pokrytou
garanci.

### Binding-application integrační delta — `da898277` / `b05392e1`

Čistý merge binding-application checkpointu `d4b34ca4` do hardening větve
naměřil **420 source souborů, 1 010 exact-pair hran a beze změny 3 cykly / 28
souborů v cyklech**. Writer nejprve všech šest hran odmítl bez byteové změny
baseline a přijal je až po zopakování se šesti přesnými `--accept-edge`.

| Přijatá hrana | Důvod přijetí a zbývající dluh |
|---|---|
| `server.js → chat/handlers/pre-handler.js` | Composition root injektuje binding service do existujícího core chatu; exact chat approval seam vlastnil binding WP. |
| `server.js → upgrade/model-binding-application.js` | Skládá jediný manual binding commit point. Jako přímá znalost budoucí optional implementace zůstává dluhem pro `WP-M3-BOUNDARY`, ne novým povoleným směrovým pravidlem. |
| `server.js → upgrade/model-failover.js` | Zakládá repository pro tentýž connector v explicitně vlastněném startup seamu; fyzické odpojení modulu tím ještě prokázané není. |
| `upgrade/model-binding-application.js → config.js` | Jde jen o fallback čtení Ollama URL; `config.models` service mění přes runtime port. Server URL už předává, takže hrana je kandidát na pozdější utažení v řezu ModelBindingPort. |
| `upgrade/model-binding-application.js → core/logger.js` | Injektovatelný default úzké sdílené služby; nevytváří state authority. |
| `upgrade/model-binding-application.js → upgrade/model-identity.js` | Vnitřní závislost modelového modulu na jeho kanonizačním kontraktu. |

Všech šest cest leží v allowlistu `WP-M1-BINDING-APPLICATION`; žádná nevytvořila
nový SCC ani nesáhla na cizí connector. Proto jsou přijatelné jako současný
ratchet ceiling. Nejsou důkazem disabled bootu, vlastnictví `config.models` ani
zákazu `core → optional`; tyto acceptance podmínky zůstávají v
`WP-M3-BOUNDARY` a v odloženém model-binding řezu.

### Finální hardening integrace — `ec98803a`

Po uzavření aktivního model-binding writeru byl celý hardening integrován do
aktivní větve bez konfliktu. Nový `git clone --no-local` přesného merge SHA a
`npm ci --offline` skončily exit `0`; focused ratchet sada prošla 13/13.
Samostatný checker reprodukoval 1 010 baseline i current hran, 0 added,
0 removed, 3 cykly / 28 souborů a `BASELINE_PROVENANCE_VERIFIED`. Artifact
validation prošla 151/151, hygiene 1 521 cest a registry zůstal validní s
375 programy, 8 exclusions a fingerprintem
`a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8`.
Pracovní strom fresh klonu byl po běhu čistý. GPU, Ollama, server ani externí
síť nebyly spuštěny.
