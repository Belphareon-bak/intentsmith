# IntentSmith — víceúrovňová roadmapa k production-ready produktu

**Verze:** 3 · **Datum:** 2026-08-03 · **Vlastník:** operátor · **Stav:** pracovní
návrh ke schválení. Explicitní produktová rozhodnutí operátora zůstávají
závazná podle `DIRECTION.md`; nové členění milníků a exit kritéria začnou řídit
práci až po přijetí této roadmapy.

**Produkt:** [`PRODUCT.md`](PRODUCT.md) · **Pravidla:**
[`CONTRACT.md`](CONTRACT.md) · **Směr:** [`DIRECTION.md`](DIRECTION.md) ·
**Změřený stav:** [`SYSTEM-MAP.md`](SYSTEM-MAP.md)

> Roadmapa odpovídá na čtyři různé otázky: **kam směřujeme, co na čem závisí,
> které hranice musí držet a jak silný máme důkaz**. Tyto osy se nesmějí
> sloučit do jednoho dlouhého pořadníku ani do stovek předvyplněných záznamů.

## 1. Cíl

Výsledkem je IntentSmith 1.0: podporovatelný local-first produkt pro
technického power usera na Linuxu, který přes Theia Studio a lokální Ollamu
rozumí projektům, plánuje práci a provádí přesně omezené, auditovatelné a
vratné efekty. Produkt využije funkční základ C3; nepřepisuje jej bez
prokázaného přínosu.

Hlavní release demonstrace:

```text
čistá instalace
  → otevřít existující Git projekt v Theia Studiu
  → pokračovat v uložené konverzaci nad lokální Ollamou
  → zadat malou reálnou změnu
  → vidět plán a přesné approvaly
  → bezpečně provést patch a cílený test
  → vidět diff, výsledek, audit a případné selhání
  → použít jednoho specialistu a jednoho agenta
  → vidět a ovládat, co se systém naučil
```

## 2. Čtyři souřadnice roadmapy

### Rámec 0–5 — jak se rozhoduje o evoluci C3 → IntentSmith

| Úroveň | Otázka | Povinný výstup | Co se nesmí stát |
|---|---|---|---|
| **0. Východisko a směr** | Z čeho vycházíme a které principy C3 zachováváme? | `DIRECTION.md`, pravdivý baseline, produktové rails a potvrzené otevřené vady | greenfield přepis nebo přijetí dokumentace bez runtime ověření |
| **1. Co je hotové** | Co dnes skutečně existuje, běží a má uživatelský důkaz? | lehký obraz 22/22: jedna věta, evidence stupeň, `BROKEN`; hlubší fakta jen pro spuštěnou schopnost | vydat existenci modulu či zelený unit test za hotový produkt |
| **2. Co zlepšit** | Které pozorované chování, spoj nebo L3 číslo nedosahuje cíle? | ohraničený WP: baseline → změna → negativní/focused test → journey nebo číslo | široký refaktor bez změřeného problému |
| **3. Co nahradit** | Přinese cizí/open-source řešení prokazatelně víc než incumbent? | srovnávací dossier: funkce, kvalita, bezpečnost, integrace, migrace, rollback a malý pilot; rozhoduje operátor | přepis jen kvůli popularitě či novosti komponenty |
| **4. Jak vypadá produkt** | Co musí uživatel v 1.0 umět a co je mimo či conditional? | přijatý `PRODUCT.md`, hlavní demonstrace a explicitní `IN / OUT / CONDITIONAL` | seznam modulů vydávaný za produktovou definici |
| **5. Jak se tam dostaneme** | Jaké jsou závislosti, paralelní proudy a gates? | níže uvedený milestone/capability DAG, connectory, exit kritéria a malé WP | stovky předvyplněných záznamů před prvním uživatelským výsledkem |

Úrovně 0–5 nejsou šest sériových měsíců analýzy. Úroveň 4 uzavírá cíl na
začátku; úrovně 1–3 se pak aplikují právě na schopnost, která je podle úrovně 5
na řadě. Pro všech 22 schopností se udržuje jen lehký obraz.

### A. Milníky M0–M7 — kdy a proč

| Milník | Stav 2026-08-03 | Vstup | Uživatelský výsledek |
|---|---|---|---|
| **M0 Produktová pravda** | `IN_PROGRESS` | současný C3/IntentSmith strom | Víme, co produkt je a co skutečně běží; deklarace nelžou o chování. |
| **M1 Lokální runtime páteř** | `NOT_STARTED` | M0 accepted | Stabilní Linux → Theia → chat → Ollama → persistence. |
| **M2 Řízená práce nad projektem** | `NOT_STARTED` | M1 accepted | Záměr se změní v přesně schválený patch, test a audit. |
| **M3 Modulární platforma** | `NOT_STARTED` | M2 accepted | Expertise, tool, skill, specialista a agent přidají schopnost bez obcházení core. |
| **M4 Auditovatelné self-learning** | `NOT_STARTED` | M2 accepted | Jedna uzavřená, scoped a vratná učící smyčka zlepšuje skutečný scénář. |
| **M5 Production hardening** | `NOT_STARTED` | M3 + M4 accepted | Instalace, data, auth, procesy, síť, výkon a recovery jsou podporovatelné. |
| **M6 IntentSmith 1.0 release** | `NOT_STARTED` | M5 accepted | Zmražený kandidát projde úplnou release validací a operátorskou demonstrací. |
| **M7 Remote Companion** | `DESIGN_ONLY` | M6 + remote boundary | Samostatný vzdálený companion release nad bezpečným core rozhraním. |

`M0` je produktový milník této roadmapy, nikoliv historická release **Gate 0**.
Gate 0 se znovu aktivuje pouze v M6 nad zmraženým kandidátem.

Milníkový dependency DAG:

```text
M0 produktová pravda
 └─ M1 lokální runtime
     └─ M2 řízená práce + návrh RemoteCorePort
         ├─ M3 modulární platforma ─┐
         └─ M4 self-learning ──────┼─ M5 production hardening
                                   └─ M6 IntentSmith 1.0 release
                                       └─ M7 Remote Companion release
```

M3 a první dvě fáze M4 mohou po M2 postupovat souběžně proti připnutému
`ProjectContextQuery/Snapshot`, ale pouze v disjunktních cestách. M4 integrace
learned contextu dostane vlastní connector window a nesmí potichu změnit verzi,
proti níž běží specialista či agent. M5 začne až po přijatých povinných E2E obou
milníků. Návrh mobilu může po zmražení kontraktu `RemoteCorePort` v M2
pokračovat paralelně, ale jeho produkční adaptér, listener, pairing a mobilní
runtime zůstávají za příslušnými pozdějšími gates.

### B. Capability DAG — co na čem závisí

Čísla odpovídají `SYSTEM-MAP.md`; nejsou pořadím priority.

```text
#1 server / routing / DB
 ├─ #2 CRE ───────────────┐
 ├─ #4 conversation ──────┼─ #6 chat pipeline ── #21 Studio + WS
 └─ #18a model registry ─ #3 LLM gateway ─ #5 quality ┘

#6 chat + #5 quality ─────────────────────────────── #7 expertizy
[effect authority connector]
 ├─ #16 tools
 ├─ effectful kroky #9 skills
 ├─ efekty #8 specialistů
 └─ efekty #14 agentů

#7 expertise + #12 Code Intelligence + #16 tools ── #8 specialisté
#4 conversation + #16 tools ─────────────────────── #14 agenti

#4 conversation ─ #15 paměť / learning
[project-scope connector] ─ #12 Code Intelligence ─ #11 execution + patch
#4 + #11 + #12 ─ #10 lifecycle ─ #13 governance

#18a ─ #18b upgrade automatika
#16 + outbound policy ─ #17 notifikace / #19 marketplace / #20 media
```

Křížová závislost se neřeší přesunem souboru, pokud moduly skutečně sdílejí
logiku. Řeší se stabilním connectorem a boundary testem.

### C. Connectory — kde se části potkávají

| Connector | Provider | Hlavní konzumenti | Minimální garance |
|---|---|---|---|
| `ConversationCommand/Result` | chat core | Studio, CLI, později Remote | request, progress, cancel, error a jediný terminální stav |
| `ModelRequest/Result` | LLM gateway | CRE, chat, quality, lifecycle | role/model, timeout, cancellation, provider failure bez false-success |
| `EffectRequest/Result` | effect broker | tools, skills, agenti, specialisté, lifecycle | normalizovaný efekt, authority, timeout, evidence |
| `ApprovalGrant` | approval service | effect broker, UI | exact payload, projekt/run, expiry, single use, revokace |
| `ToolRequest/Result` | tool registry/executor | chat, skills, specialisté, agenti, MCP adaptéry | typované vstupy/výstupy, risk class, překlad na effect, timeout/cancel |
| `ProjectContextQuery/Snapshot` | Code Intelligence | chat, skills, specialisté, agenti | project scope, revision a provenance |
| `ExtensionManifest/Context` | core registration boundary; forma čeká na L0-8 rozhodnutí | skills, specialisté, agenti, MCP adaptéry | verze, capabilities, enable/disable lifecycle, žádný interní import |
| `LearningObservation/Proposal/Outcome` | learning layer | paměť, skills, Code Intelligence | scope, evidence, gate, outcome, rollback/forget |
| `CoreEvent` | core runtime | Studio, notifikace, Remote port | typed progress/status/result bez přístupu do interních modulů |
| `RemoteCorePort` | core 1.0 | budoucí companion gateway | projekty, konverzace, settings, stored information, approvals, notifications a events; capability negotiation bez legacy bypassu |

Connector je stabilní, až když má jednoho vlastníka, pojmenovaného providera,
alespoň jednoho reálného konzumenta, pozitivní contract test a negativní
boundary test. Změnu connectoru vlastní jediný Work Package.

### D. Žebřík důkazu — co opravdu víme

```text
EXISTS → RUNTIME_VERIFIED → USER_JOURNEY_VERIFIED → ACCEPTED / PASS
```

`BROKEN` je samostatný příznak. `BLOCKED` a `NOT RUN` jsou výsledky běhu, ne
zelené stupně schopnosti. Detail určuje `CONTRACT.md` §5.

Pro všech 22 schopností se v M0 vede jen tento stupeň a jedna uživatelská věta.
Hluboká sedmidimenzionální inventura vzniká až u `RUNTIME_VERIFIED` schopnosti,
která vstupuje do aktivního WP.

## 3. Trvalé rails

Milník nesmí zlepšit jednu oblast tím, že poruší jinou.

| Rail | Otázka při každé změně |
|---|---|
| **R1 USER_AUTHORITY** | Může efekt vzniknout bez přesného původu, scope nebo approval? |
| **R2 LOCAL_FIRST** | Vzniká nečekaný outbound, cloudová závislost nebo cross-project únik? |
| **R3 OBSERVABLE_BEHAVIOR** | Je tvrzení ověřené tam, kde jej zažívá uživatel? |
| **R4 MEASURED_QUALITY** | Známe latenci, chybovost, kvalitu a cenu místo dojmu? |
| **R5 MODULAR_BOUNDARIES** | Komunikuje modul přes connector místo interního importu či bypassu? |
| **R6 REVERSIBILITY** | Jde změnu zrušit, rollbacknout a obnovit bez orphan stavu? |
| **R7 PRIVACY_AND_LEARNING_SCOPE** | Je provenance, retention, delete a learning scope explicitní? |

Aktivní WP pouze uvede, které rails může ovlivnit a jaký negativní test je
chrání. Nezakládá se nový rail registr.

## 4. M0 — Produktová pravda a ověřený baseline

### Výsledek

Nový člověk i agent začnou u pravdivých instrukcí, vidí cílový produkt a mohou
reprodukovat, co dnes skutečně funguje. Registry metadata jsou konfrontována s
runtime chováním.

### Work Packages

- **WP-M0-A Authority:** `PRODUCT`, pointer-only `AGENTS/CLAUDE`, oprava
  produktových faktů a této roadmapy.
- **WP-M0-B Runtime baseline:** čistá instalace, boot, Studio, chat,
  persistence/restart a jedna Ollama session.
- **WP-M0-C Offline boundary:** celý `network:none` rozsah v OS síťové izolaci;
  lživé testy opravit nebo správně překlasifikovat.
- **WP-M0-D Capability picture:** pro 22 schopností jen jedna uživatelská věta,
  evidence stupeň a `BROKEN` flag.

### Závislosti a paralelismus

Authority, read-only runtime měření a capability picture mohou běžet
paralelně. Operátorské přijetí `PRODUCT.md` a této roadmapy je první řídicí
checkpoint M0; klasifikační opravy se integrují po jedné. GPU se zde používá
jen pro jeden baseline běh, ne pro plošné ladění modelů.

### Exit kritéria

- žádný vstupní dokument neukazuje na neexistující soubor ani nespouští Gate 0
  jako běžnou první akci;
- operátor přijal `PRODUCT.md` a tuto roadmapu jako společnou definici cíle,
  scope, pořadí a exit kritérií;
- všech 22 schopností má jediný stavový žebřík a uživatelskou větu;
- čistá instalace, server, Studio, deterministický chat, modelový chat,
  persistence a restart mají reprodukovatelný baseline;
- všechny `network:none` programy byly spuštěny s OS blokovaným outboundem;
- každé selhání je rozlišeno na produktovou vadu, chybu testu, deklarovanou
  prerekvizitu nebo release-policy drift;
- otevřené L0 porušení má rozhodnutí nebo explicitní blocker.

### Aktuální evidence

Na `24457ba2` proběhl autoritativní sekvenční OS-isolated scan deklarovaného
offline rozsahu:

- run ID: `offline-egress-serial-24457ba2`;
- report:
  `.intentsmith-artifacts/egress-scan/offline-egress-serial-24457ba2/report.json`;
- příkaz:
  `unshare --user --map-root-user --net sh -c 'ip link set lo up && exec node scripts/nightly-audit.js --profile=offline --out-dir=.intentsmith-artifacts/egress-scan --run-id=offline-egress-serial-24457ba2 --concurrency=1 --deadline-hours=4'`;
- database control run ID: `database-egress-serial-24457ba2`, report
  `.intentsmith-artifacts/egress-scan/database-egress-serial-24457ba2/report.json`,
  výsledek **26/26 PASS**;
- offline profil: **171 PASS / 4 FAIL / 2 BLOCKED**;
- skutečné skryté outbound závislosti: `multi-source-integration` a
  `dependency-manager` test;
- C3 Studio runtime navíc bez opt-inu vkládá Google Fonts URL; tento potvrzený
  L0-12 nález není krytý backendovým offline profilem a musí jej uzavřít M1;
- ostatní dvě selhání: stale harness count (po review import graphu opraven na
  95) a release-policy pin nightly self-testu;
- dvě PDF sady jsou pravdivě `BLOCKED` na pojmenovaném toolchainu.

Dřívější paralelní report na stejném SHA není autoritativní: sdílený worktree
vyvolal dirty-tree race mezi sadami. Proto je pro toto tvrzení určen výhradně
výše uvedený sekvenční run.

Po opravách se celý scan musí zopakovat; původní výsledek se nepřepisuje.

## 5. M1 — Lokální runtime páteř

### Výsledek

Uživatel na podporovaném Linuxu otevře Theia Studio, založí nebo obnoví
konverzaci, dostane deterministickou i modelovou odpověď a stav přežije restart.

### Závislostní sekvence Work Packages

1. **WP-M1-CONTRACT:** z M0 runtime evidence připne minimální verzi
   `ConversationCommand/Result`, `ModelRequest/Result` a `CoreEvent`; jediný
   vlastník každého connectoru.
2. Proti této verzi mohou paralelně běžet:
   - **WP-M1-CHAT:** #2 CRE, #4 conversation, #6 chat; pravdivé
     success/error/cancel;
   - **WP-M1-MODEL:** #18a registry, #3 gateway, role binding, VRAM fit a
     provider failure; model/GPU běhy sériově;
   - **WP-M1-STUDIO:** #21 Theia/WS, progress, error, cancellation, reconnect UX
     a odstranění tichého Google Fonts egressu.
3. **WP-M1-QUALITY:** #5 změří skutečnou hodnotu refinementu nad přijatými
   chat/model výsledky; integrační journey znovu ověří všechny tři connectory.

### Povinné scénáře

1. deterministická odpověď bez modelu přes skutečný request;
2. modelová odpověď přes lokální Ollamu;
3. nedostupný provider jako selhání, ne uložený assistant turn se statusem OK;
4. cancel před, během a těsně před persistencí;
5. restart a obnovení konverzace;
6. skill/expertise confirmation patří tomu subsystému, který se právě ptal;
7. Studio ukáže progress a přesný konečný stav.

### L3 cíle a exit

- p95 deterministické odpovědi pod **100 ms** na referenčním stroji;
- warm/cold whole-response latence se změří odděleně; pokud operátor přijme
  streaming do scope M1, změří se i time-to-first-token a schválí jeho budget;
- p95 modelového chatu, throughput a refinement delta jsou změřené, ne odhadnuté;
- žádný false-success při provider error/cancel/timeout;
- Studio + WS + persistence journey projde po čerstvé instalaci;
- během základního scénáře nevznikne neočekávaný outbound.

Streaming zůstává samostatné produktové rozhodnutí. Pokud jej operátor přijme,
smí se zavést až po přijetí `ModelRequest/Result`, `ConversationCommand/Result`
a `CoreEvent`, protože sahá přes všechny tři. Refinement se ponechá, omezí nebo
odstraní podle dat
`scoreBefore/scoreAfter`, ne podle dvou anekdot.

## 6. M2 — Řízená práce nad projektem

### Výsledek

Uživatel otevře existující Git projekt, požádá o malou změnu, uvidí plán a
přesně vymezené approvaly, IntentSmith provede atomickou změnu, spustí focused
test a ukáže diff, stav a audit.

### Závislosti

M1 runtime páteř a stabilní `ConversationCommand/Result`. Vlastník effect
brokeru nejprve vytvoří a připne `EffectRequest/Result` a `ApprovalGrant`;
teprve jejich konzumenti smějí implementovat efektové cesty.

### Závislostní sekvence Work Packages

1. **WP-M2-EFFECT:** canonical effect broker vlastní policy, approval, timeout,
   cancellation, audit, revokaci a připne effect/approval connectory.
2. **WP-M2-CODE:** #12 připne `ProjectContextQuery/Snapshot`; může běžet vedle
   kroku 1, protože nemění effect connector.
3. **WP-M2-TOOLS** a **WP-M2-EXEC:** #16 jednotný `ToolRequest/Result` a #11
   sandbox/patch/Git/test/rollback mohou běžet paralelně až proti připnutým
   connectorům z kroků 1–2.
4. **WP-M2-LIFECYCLE:** #10 plán/provedení a #13 governance až nad přijatými
   Code Intelligence a execution connectory.
5. **WP-M2-REMOTE-CONTRACT:** až nad připnutými `ConversationCommand/Result`,
   `EffectRequest/Result`, `ApprovalGrant` a `CoreEvent` vytvoří verzi 1
   `RemoteCorePort` pro projekty, konverzace, settings, stored information,
   approvals, notifications a events. Contract obsahuje capability negotiation,
   threat model, contract test a negativní boundary test; dosud neimplementovaný
   provider se hlásí jako unavailable, nikdy jako prázdný úspěch. Žádný listener,
   pairing ani remote runtime.

### Exit kritéria

- zápis, exec ani network efekt neproběhne bez odpovídající authority;
- approval je vázán na normalizovaný payload, projekt, run, expiry a single use;
- path traversal a změna mimo projekt selžou před efektem;
- cancel, timeout, kill a restart revokují authority a nezanechají orphan proces;
- neúspěšný test nebo worker claim nemůže vytvořit úspěšný terminální stav;
- patch je atomický a doložený diffem; rollback round-trip je otestovaný;
- uživatel vidí plán, approval, diff, test a konečný stav v jednom journey;
- `RemoteCorePort` má zmraženou verzi, kompatibilitní pravidla, contract test a
  negativní důkaz, že nedává přístup k legacy listeneru ani interním modulům.

## 7. M3 — Modulární platforma

### Výsledek

Modul přidá skutečnou schopnost bez zásahu do interního core a bez získání
nové pravomoci. Skill je verzované procedurální know-how: nese účel a trigger,
typované vstupy, fixní a proměnné části, prompty či šablony, volbu nástrojů,
checkpointy/approvaly a kritéria kvality i výstupu. Co už definuje, se při
dalším použití nevymýšlí znovu.

### Závislostní sekvence Work Packages

1. Operátor rozhodne L0-8: strict dependency injection, nebo verzované veřejné
   extension API.
2. **WP-M3-BOUNDARY:** podle rozhodnutí připne `ExtensionManifest/Context`,
   lifecycle a fail-closed import/registration boundary. Název ani kontrakt
   nepředjímá, že výsledkem musí být veřejné SDK.
3. Proti této připnuté hranici mohou paralelně běžet:
   - **WP-M3-EXPERTISE:** #7 měřitelný vliv expertizy bez nového efektu;
   - **WP-M3-SKILL:** #9 použití již existujícího verzovaného skillu od triggeru
     přes parametry, volbu nástrojů a checkpointy po ověřený výstup; efektové
     kroky jdou pouze přes M2 broker;
   - **WP-M3-SPECIALIST:** #8 platforma + jeden code-review E2E specialista;
   - **WP-M3-AGENT:** #14 platforma + jeden local project-health E2E agent;
   - **WP-M3-MCP-PILOT (`OPTIONAL_EXPERIMENT`):** jeden read-only nástroj dovnitř
     a jeden ven. M3 neblokuje; do produktu se povýší jen po operátorském
     přijetí měřeného přínosu, jinak se explicitně odloží.

### Exit kritéria

- extension lze instalovat, zapnout, vypnout a odebrat bez změny core;
- deaktivovaný modul se neúčastní routingu a nemá pending efekty;
- `src/**` není neformální extension API; schválená registrační hranice je
  verzovaná a boundary-testovaná;
- uživatel zadá ve Studiu/chatu úlohu, routing vybere specialistu, specialista
  využije expertise, Code Intelligence a strukturovaný tool result a uživatel
  uvidí výsledek; disabled/uninstalled specialista fail-closed nezasáhne;
- agent má zdroj, trigger, podmínku, akci a skutečně viditelný výsledek ve Studiu;
  disabled agent nic nespustí a nevytvoří vedlejší efekt;
- existující verzovaný skill z uživatelského triggeru sváže typované vstupy,
  fixní/proměnné kroky, prompty/šablony, nástroje, checkpointy a quality/output
  criteria; opakované použití toto know-how reprodukuje bez nového návrhu;
- všechny efekty agentů, specialistů, skills a MCP používají stejnou policy,
  approval a audit hranici.

Současný přímý import specialisty do interního `src/**` není přijatelný konečný
stav. Rozhodnutí v kroku 1 určí podobu hranice; roadmapa ji sama nerozhoduje.

## 8. M4 — Auditovatelné self-learning

### Výsledek

Jedna skutečná same-project učící smyčka zlepší opakovanou práci a uživatel
vidí, z čeho závěr vznikl, může jej schválit, odmítnout, rollbacknout nebo
smazat.

### První povinný E2E

> Po opakovaně schválených změnách navrhne systém projektovou konvenci nebo
> vzorec. Uživatel vidí zdrojovou evidenci a návrh schválí. Code Intelligence
> jej s provenance vrátí v dalším project contextu a následující plán jej
> respektuje. Uživatel může vzorec odmítnout, zeslabit nebo smazat.

### Závislostní sekvence Work Packages

1. **WP-M4-OBSERVATION:** připne jednotný
   `LearningObservation/Proposal/Outcome`.
2. Proti němu mohou paralelně pracovat **WP-M4-MEMORY** (#15 scope,
   provenance, TTL, decay, forget, retention, export/delete) a první část
   **WP-M4-CODEINTEL** (producer pozorování, proposal a user gate).
3. **WP-M4-CONTEXT:** až nad verzovaným výstupem Code Intelligence zapojí
   relevantní pattern a TaskMemory zpět do runtime rozhodování. Změnu
   `ProjectContextQuery/Snapshot` vlastní v této fázi jediný WP a znovu ověří
   všechny M3 konzumenty.
4. Integrační E2E změří outcome proti baseline a ověří rollback/delete.

Detekce opakovaného postupu → návrh nového skillu → user gate → nová verze je
další učící smyčka M4. Nepředbíhá první prokázané Code Intelligence E2E.

### Exit kritéria

- každý learned item má projekt, zdroj, confidence, čas a verzi;
- adaptace je proposal, ne přímý efekt;
- uživatel ji může odmítnout, rollbacknout nebo smazat;
- negativní test prokazuje, že učení nemění permission, code ani config;
- cross-project retrieval je default off a vyžaduje explicitní opt-in;
- pattern není pouze zapsaný — má pojmenovaného runtime konzumenta;
- outcome má měřitelnou kvalitu oproti baseline a lze jej přiřadit verzi.

## 9. M5 — Production hardening

### Výsledek

IntentSmith není jen funkční checkout; lze jej bezpečně nainstalovat,
aktualizovat, provozovat, diagnostikovat a obnovit na podporovaném Linuxu.

### Work Packages

- **WP-M5-AUTH:** globální API auth, definitivní loopback boundary a žádný WS
  bypass.
- **WP-M5-PROCESS:** sandbox depth, resource limity, cancellation a orphan
  cleanup po crash/restart.
- **WP-M5-DATA:** backup/restore, migrace, upgrade/rollback, retention a delete.
- **WP-M5-PRIVACY:** operátorská rotace tajemství a rozhodnutí o kompromitované
  historii; hodnoty tajemství se nikdy nereportují.
- **WP-M5-PACKAGE:** podporovaný Linux installer/package a upgrade cesta.
- **WP-M5-OBSERVE:** request/run correlation, failure taxonomy, health a
  provozní diagnostika.
- **WP-M5-PERF:** chat, Studio, Code Intelligence, lifecycle, RAM/VRAM a soak
  budgety podle M1–M4 měření.
- **WP-M5-REMOTE-PORT:** implementuje core adaptér proti zmraženému M2
  `RemoteCorePort`, verifikační a kompatibilitní vrstvu; listener, pairing a
  mobilní UI ještě ne.
- **WP-M5-CONDITIONAL-SURFACES:** před freeze odvodí přesný seznam zapnutých a
  dokumentovaně podporovaných conditional ploch (upgrade discovery,
  notifications, marketplace, media) a pro každou připne required M6 journey,
  nebo ji pro release vypne a pravdivě označí jako unsupported.

### Exit kritéria

- fresh install a upgrade z podporované předchozí verze;
- backup lze skutečně obnovit a výsledek porovnat;
- crash/restart nezanechá otevřený grant, nekonzistentní turn ani orphan proces;
- default install neprovádí tichou odchozí komunikaci;
- všechny outbound call sites mají policy, scope a audit;
- privacy incident má provedenou operátorskou remediaci;
- žádný známý critical/high bezpečnostní nebo datový blocker;
- p95, error rate, RAM/VRAM a dlouhý běh splňují schválené budgety;
- implementace `RemoteCorePort` odpovídá připnuté verzi, odmítá nekompatibilní
  klienta a negativní boundary test dál blokuje legacy bypass;
- required M6 set je deterministicky odvozený i pro všechny zapnuté či
  podporovaně dokumentované conditional plochy;
- dokumentace instalace, recovery a známých limitů odpovídá skutečnému buildu.

## 10. M6 — IntentSmith 1.0 release

### Vstup

M1–M5 journeys jsou `ACCEPTED`; release candidate je zmražený. Teprve zde se
znovu aktivuje Gate 0 a attestační řetěz.

### Povinná validační matice

- fresh-clone install/build na podporovaném Linuxu;
- deterministické offline a database profily, znovu s empiricky blokovanou sítí;
- server/WS/Studio user journeys;
- lokální Ollama/GPU role na referenční konfiguraci, sekvenčně;
- effect/approval/security/data/recovery negativní testy;
- specialista, agent a learning E2E;
- `RemoteCorePort` contract, compatibility a negativní security-boundary testy;
- všech 13 L0 invariantů má pojmenovaný aktuální důkaz; žádný není
  `OPEN_VIOLATION`, `UNVERIFIED` ani `PARTIAL`;
- každá enabled/supported conditional plocha projde svým odvozeným journey;
- upgrade + backup/restore round-trip;
- soak/nightly a resource budgety;
- Gate 0 evidence a nezávislé read-only review.

### Exit

- všechny required výsledky jsou PASS; `BLOCKED`, `NOT RUN` ani známý false-green
  se nepočítá;
- release artefakt odpovídá testovanému commitu a buildu;
- známá omezení a deferred scope jsou explicitní;
- operátor provede uživatelskou demonstraci a vydání schválí;
- až potom merge, tag a publish podle samostatně schváleného release kroku.

## 11. M7 — Remote Companion, samostatný release

M7 nezačíná implementací vzdáleného listeneru. Návrh mobilního klienta může
postupovat paralelně proti `RemoteCorePort`, ale produkční pairing/listener/UI
začíná až po M6 a samostatně prokázané remote security boundary.

Povinné výsledky:

- oddělený listener, autentizace a pairing;
- device scope, expiry a revokace;
- negativně prokázáno, že legacy `/api/*` a `/c3/ws` nelze obejít stejným
  vzdáleným listenerem;
- audit každé remote authority akce;
- projekty, konverzace, settings, stored information, approvals, notifications
  a typed runtime events přes verzovaný kontrakt;
- kompatibilita verzí core/companion a pravdivé degraded/offline chování.

## 12. Pravidla Work Package bez dalšího aparátu

Aktivní WP se vejde do těchto osmi položek:

1. uživatelský výsledek;
2. povolené a zakázané cesty;
3. vlastněný connector a jeho verze;
4. vstupní revision a závislosti;
5. malá demonstrace;
6. focused pozitivní a negativní test;
7. stop condition / eskalace;
8. přesný ověřovací příkaz a výsledek.

Maximálně tři paralelní zapisující WP, pouze s disjunktními cestami a
connectory. Jeden integrační vlastník skládá hotové přírůstky po malých
commitech. Read-only průzkumy mohou běžet paralelně; lokální GPU role sériově.

Agent pokračuje autonomně uvnitř schváleného WP. Zastaví dotčenou část při
změně veřejného connectoru, produktu/scope, bezpečnostní či datové nejasnosti,
konfliktu vlastnictví nebo výsledku, který zpochybňuje směr. Nezávislé části
mohou pokračovat.

## 13. Aktuální pořadí

1. Dokončit faktickou a konzistenční kontrolu návrhu `PRODUCT.md` + `ROADMAP.md`.
2. Operátorsky přijmout produktový kontrakt a roadmapu; případné změny scope se
   zapíší jako rozhodnutí, ne jako tichá editace.
3. Dokončit M0: znovu spustit offline izolaci po klasifikačních opravách a
   uzavřít lehký capability picture 22/22.
4. Operátorsky rozhodnout L0-8 nejpozději před `WP-M3-BOUNDARY`; M0 jej může
   uzavřít pouze jako explicitně pojmenovaný blocker s vlastníkem a termínem.
5. Zahájit M1 nejprve connector WP; proti připnuté verzi potom tři disjunktní
   WP chat, model/GPU a Studio a nakonec quality/integration. GPU běhy se
   nesouběží.
6. Po M1 demonstraci otevřít M2 effect authority a project-change journey.

Roadmapa se mění jen při novém důkazu nebo operátorském rozhodnutí. Dokončený
milník se označí výsledkem a odkazem na demonstraci; nepřepisuje se tak, aby
vypadal zeleně zpětně.
