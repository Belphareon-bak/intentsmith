# IntentSmith — víceúrovňová roadmapa k production-ready produktu

**Verze:** 4 · **Datum:** 2026-08-08 · **Vlastník:** operátor · **Stav:** pracovní
návrh ke schválení. Explicitní produktová rozhodnutí operátora zůstávají
závazná podle `DIRECTION.md`; nové členění milníků a exit kritéria začnou řídit
práci až po přijetí této roadmapy.

Plné operátorské přijetí této verze 4 zůstává otevřené. Pro právě běžící M1 je
však samostatně přijatým prováděcím kontraktem
[`docs/execution/m1-batch.md`](docs/execution/m1-batch.md) a operátor 2026-08-08
výslovně uzavřel rozhodnutí 001–014. Tato omezená autorita neznamená přijetí
ostatních milníků ani změnu jejich exit kritérií.

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

| Milník | Stav 2026-08-08 | Vstup | Uživatelský výsledek |
|---|---|---|---|
| **M0 Produktová pravda** | `IN_PROGRESS` | současný C3/IntentSmith strom | Víme, co produkt je a co skutečně běží; deklarace nelžou o chování. |
| **M1 Lokální runtime páteř** | `IN_PROGRESS / GATE_1_BLOCKED` | M0 accepted | Stabilní Linux → Theia → chat → Ollama → persistence. |
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
- **WP-M0-E Studio source/build probe:** v disposable čistém klonu zjistí, zda
  frozen Theia build reprodukuje skutečné Studio UI a zda jej lze spustit bez
  neočekávaného outboundu; nejde ještě o opravu Studia.

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

Post-fix scan proběhl na `a85c344f` z čistého dočasného klonu stejným síťovým
omezením, profily `offline,database` a `concurrency=1`:

- autoritativní run ID: `postfix-offline-database-a85c344f-run2`;
- výsledek: **200 PASS / 1 FAIL / 2 BLOCKED / 0 TIMEOUT / 0 SKIPPED**;
- procesní exit `1`, verdict `FAIL` — nejde o zelený celek;
- jediný FAIL: `nightly-orchestrator-self-test`, protože zapečetěný Gate 0
  kontrakt záměrně odmítá současný vývojový registry stav s blokovanými
  release-only toolchain sadami; před M6 se musí policy a required set obnovit;
- oba skryté outbound případy (`multi-source-integration`,
  `dependency-manager`) pod blokovanou sítí prošly s exit `0`;
- dvě exportní sady zůstávají pravdivě `BLOCKED` na PDF toolchainu;
- lokální evidence:
  `.intentsmith-artifacts/postfix-evidence/a85c344f/authoritative-run2/report.json`,
  SHA-256
  `a3af7b8531509c8be753ac87920dbeab9a5ac133d10634664a078c8c99925535`.

První post-fix kalibrace je zachovaná, ale odmítnutá: dočasný clone path ležel
pod adresářem pojmenovaným `.intentsmith-artifacts` a artifact root měl chybný
mód `0775`, čímž porušil preconditions dvou harness testů. Opravený run2 použil
mód `0700`; oba testy v něm prošly. Původní pre-fix ani odmítnutý run se
nepřepisují a nezapočítávají do autoritativního výsledku.

Na `ac320335` navíc proběhl izolovaný backendový user journey s prázdným
runtime prostředím a vlastní SQLite DB:

- focused sady #1, #2, deterministic latency, confirmation ownership, routes a
  WS skončily postupně `13`, `10`, `3`, `5`, `109` a `64` úspěšnými checky,
  všechny exit `0`;
- modelová CRE sada na `qwen3.5:27b` skončila **9/9**, exit `0`;
- skutečné HTTP health/create/deterministic/model požadavky skončily
  `200/201/200/200`; deterministický dotaz trval 22 ms a modelový 24 784 ms;
- po skutečném stop/start serveru nad stejnou DB byly obnoveny přesně čtyři
  turny ve správném pořadí, exit celého probe `0`.

Raw lokální evidence je v
`.intentsmith-artifacts/runtime-baseline.qAU9qe/`; její dva JSON souhrny mají
SHA-256 `2700a942…d8c37` a `8d123f79…42bb68`. Běh nepoužil fresh `npm ci` ani
Theia runtime a nemá commitnutý runner/environment manifest. Je to
current-checkout pozorování, nikoliv přenositelná release evidence, a proto samo
M0 neuzavírá.

WP-M0-E následně na dokumentačním HEAD `df8f1039` se zdrojovým stromem shodným
s `ac320335` provedl fresh-clone Studio probe. `npm ci`, frozen Yarn install a
production Theia build prošly exit `0`; commitnuté plné UI zůstalo byteově
stejné. Diagnostický runtime v OS network namespace při počátečním bootu přešel
do `ready`, navázal WS a přes skutečný panel vrátil `17*23 = 391` za 24 ms.

Probe ale končí `COMPLETED_WITH_PRODUCT_FAIL`, protože:

- skutečný package build `@c3/chat-panel` končí exit `1` na šesti chybných TS
  importech a jeho částečný emit zanechá 4 změněné + 36 nových generated
  souborů v disposable klonu;
- repozitář sám potvrzuje, že funkční `lib` je ručně udržovaný source-of-truth
  a stale TS se nesmí nechat přepsat přes něj; product build jej pouze zabalí;
- renderer se pod blokovaným outboundem pokusil načíst Google Fonts;
- původně popsaných šest běžných Studio HTTP rodin vracelo 403; pozdější
  zachovaný capture navíc potvrdil vždy spouštěnou `/api/agents` jako sedmou
  rodinu. Původní nezachované DevTools pozorování připsalo stav chybějícímu
  local capability headeru.
  Následná sanitizovaná CDP revalidace na `1fc8f03e` toto vysvětlení vyvrátila:
  capability na wire byla, ale Chromium poslalo `Origin` nepřítomný a
  `Sec-Fetch-Site: cross-site`; policy proto správně skončila
  `CROSS_SITE_WITHOUT_ORIGIN` dřív, než capability vyhodnotila. Backendová
  boundary se nesmí oslabit.

Síťové detaily jsou current-host DevTools observation, nikoliv zachovaný
strojově čitelný export. Přibližně šest minut po startu skončil Electron během
teardownu diagnostického namespace po GPU fatalu signálem `SIGTRAP`, zatímco
backend přijal řízený `SIGTERM`. Počáteční journey tedy prošla, ale stabilita a
clean shutdown zůstávají `INCONCLUSIVE`.

Přesné instalační/build příkazy, hashe, metodická omezení a screenshot/log jsou v
`docs/inventory/21-studio-ws.md`; lokální artefakty v
`.intentsmith-artifacts/m0e-studio-probe-df8f1039/`.

### Stav M0 a nejbližší spustitelný balík

| Část | Stav | Zbývá |
|---|---|---|
| Autorita dokumentů | `DRAFT_COMPLETE` | Operátorské přijetí `PRODUCT.md` a `ROADMAP.md`. |
| Backend/runtime | `PARTIAL` | Fresh-clone install provenance; backendový HTTP restart už je current-SHA ověřen. |
| Offline boundary | `MEASURED` | Před M6 opravit release-policy sentinel a aktivovat pravdivý PDF toolchain set. |
| Capability picture | `DRAFT_COMPLETE` | 22/22 je v `SYSTEM-MAP.md`; operátorské přijetí neznamená automaticky PASS jednotlivých schopností. |
| Studio/Theia | `MEASURED` | Fresh clone na `7236d221` prošel instalací a buildem; po dvou zachovaných červených kalibračních bězích následovaly dva samostatné runtime `PASS` s nulovým egresssem, 65s live-ready soakem a čistým shutdownem. Runner zůstává registry `BLOCKED`, dokud auditní orchestrátor nedodá build envelope; M1 cancel/reconnect journey není hotový. |
| L0-8 specialist boundary | `CARRIED_BLOCKER` | Vlastník: integrační vlastník `WP-M3-BOUNDARY`. Termín: před jeho prvním zapisujícím commitem; do té doby platí zákaz nových interních importů specialistů. |

**WP-M0-E je diagnosticky dokončený takto:**

Následný implementační checkpoint nepřipíná vzhled současného UI. Studio používá
jen jako dočasný nosič runtime a přes CDP pozoruje výhradně síťový transport;
DOM, screenshoty, CSS a privátní `_c3` session model jsou mimo kontrakt.

**Aktuální automatizovaná revalidace (2026-08-08):** remote fresh clone na
`7236d221` prošel `npm ci`, frozen Yarn instalací a production buildem. První
běh skončil na časném pre-CDP `SIGTRAP`; druhý odhalil chybný předpoklad runneru
o legacy `cre_decision`. Po opravě následovaly dva po sobě jdoucí `PASS`, oba
exit `0`, s nulovým external/other-loopback provozem, přesným security
trojúhelníkem, korelovaným deterministickým turnem, 65s live-ready soakem a
čistými exity. Červené výsledky zůstávají v review balíčku a nepřeznačují se.
Viz [`Studio Electron boundary evidence`](docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md).

1. **Výsledek:** operátor přijal, že skutečný source-of-truth je ručně
   udržovaný commitnutý `lib`;
   clean product build jej zachová, Theia se otevře, WS i deterministický chat
   fungují. Package build, local HTTP a outbound podmínky neprošly; stabilita a
   clean shutdown nejsou tímto probe prokázané.
2. **Povolené cesty:** celý strom jen read-only; zápisy pouze do disposable
   klonu a jeho artifact rootu. **Zakázané:** osm rozpracovaných inventur,
   v současném checkoutu celé `c3-ide/**/lib/**` včetně
   `c3-ide/extensions/c3-chat-panel/lib/**`, registry, product code a instalace
   globálních nástrojů.
3. **Connector:** žádný se nemění; probe pouze porovná TS vstupy, build output a
   skutečný package entrypoint.
4. **Vstup:** source revision `ac320335`; dokumentační commity mohou být navíc,
   ale nesmějí změnit source digest.
5. **Demo:** screenshot/log z X11 Studia, stav `ready`, WS handshake a
   deterministický chat 24 ms jsou zachované v lokálním artifact rootu;
   Electron log zachovává i teardown `SIGTRAP`.
6. **Test:** frozen install/build a initial boot/journey `PASS`;
   `@c3/chat-panel` package build, nulový runtime outbound a Studio HTTP cesty
   `FAIL`; stabilita/clean shutdown `INCONCLUSIVE`. Výsledky se neslučují do
   zeleného souhrnu.
7. **Stop:** dotčená zapisující část je zastavená před opravou. Operátor musí
   přijmout source disposition; backendový local guard se nesmí oslabit a stale
   TS se nesmí nechat přepsat přes funkční UI.
8. **Reprodukce:** v disposable klonu `npm ci`; poté z adresáře `c3-ide/`
   `corepack yarn install --frozen-lockfile`, `corepack yarn build` a
   `corepack yarn workspace @c3/chat-panel build`. Runtime používá skutečný
   X11/Wayland display a OS network namespace. Příkazy se nespouštějí z kořene
   přes `corepack yarn --cwd`, protože kořenový `packageManager` je `npm` a
   Corepack takový příkaz odmítne dřív, než zpracuje `--cwd`.

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

Logicky nezávislé CHAT/MODEL/STUDIO balíky mohou být připravené souběžně, ale
v současném jediném worktree je zapisuje a integruje vždy jen jeden vlastník.
GPU běhy jsou vždy sériové. `tests/registry.json`, tento dokument a společný
connector upravuje jen integrační vlastník po přijetí jednotlivého balíku.

### Proč je toto pořadí nutné — skutečný call graph

Read-only trace na `ac320335` odhalil vady ve spojích, nikoli důvod k přepisu
jádra:

1. jedna Studio WS session obsluhuje více konverzací, ale chat state je
   klíčovaný socketovým `sessionId`, zatímco DB historií `conversationId`;
2. progress události nenesou `conversationId` a Studio je při souběhu posílá
   poslednímu aktivnímu panelu;
3. commitnutý Studio klient volá `C3WS.sendCancel()` bez `conversationId`;
   správně scoped backend proto skončí ve své kompatibilní fallback větvi a
   zruší všechny turny na socketu;
4. HTTP fallback nekontroluje `response.ok`, takže typovaný `503` může zobrazit
   jako assistant JSON;
5. selhání zápisu assistant turnu se zaloguje, ale finalizer přesto vrátí
   úspěch;
6. gateway přijme HTTP `200` s prázdným modelovým obsahem jako úspěch;
7. synthesis a finalizer mohou každý spustit vlastní refinement, zatímco
   telemetrie je neumí rozlišit;
8. commitnutý 7 062řádkový Studio runtime je podle package entrypointu i
   `docs/dev-checklist.md` skutečný ručně udržovaný source; malý stale TS source
   je jiná implementace a jeho package build je nekompilovatelný;
9. dnešní persistence „restart“ test používá jeden in-memory store; skutečný
   backend stop/start byl doložen až M0 probe, ještě ne Studio journey;
10. historický nález: provider failure po úspěšných tool datech se měnil na
    implicitní fallback. Rozhodnutí 001/A nyní připíná terminální `error` a
    oddělená partial data; produkční konzument partial schématu zatím neexistuje;
11. Electron bootstrap i validní local capability na wire existují, ale původní
    Chromium request neměl `Origin` a nesl `Sec-Fetch-Site: cross-site`, takže
    server správně odmítl request před capability větví. Bounded main-process
    normalizer je implementovaný a dva fresh-clone negativní journey na
    `7236d221` jej připnuly bez oslabení serveru; M1 ještě vyžaduje vlastní
    built multi-panel journey nad novým runtime;
12. historický diagnostický Electron runtime skončil při teardownu po GPU
    fatalu `SIGTRAP`. Následné dva M0 fresh-clone běhy měly 65s live-ready soak
    a čistý shutdown; M1 přesto musí samostatně prokázat dvoupanelový
    provider/cancel/reconnect journey a jeho bounded soak.
13. legacy WS event `cre_decision` dnes nese mode detection (`conversation`),
    nikoli finální CRE intent (`LOCAL`). M0 runner proto determinismus dokládá
    přesným výsledkem, nulovým provider provozem a nulovými efekty; M1 connector
    musí pojmenování a sémantiku eventu sjednotit bez domýšlení chybějícího pole.

### Implementačně připravené Work Packages M1

Názvy testů označené **`NOVÝ`** jsou plánované výstupy příslušného WP a v
současném stromu ještě neexistují. Ostatní uvedené příkazy jsou existující
focused regression sady.

#### WP-M1-CONTRACT — jediný povinný první zápis

1. **Výsledek:** verze 1 připne korelaci, scope konverzačního stavu a jedinou
   terminální sémantiku shodnou pro HTTP, WS a Studio.
2. **Povolené cesty:** nové `contracts/m1/**`, `src/ws-bridge/protocol.js`,
   `c3-ide/extensions/c3-protocol/src/**`, **NOVÝ** `tests/m1-contract.test.js`.
   **Zakázané:** controller, routes, gateway, session-adapter, Studio UI a quality.
3. **Connector:** `ConversationCommand/Result`, `ModelRequest/Result`, `CoreEvent`
   v1; vlastní je tento jediný WP.
4. **Vstup:** přijatý M0 a pojmenovaný čistý base SHA.
5. **Navržený kontrakt k operátorskému schválení:** `conversationId` je state a
   durability key; `sessionId` pouze transport/telemetrie. Command a každý event
   nesou `requestId`, `conversationId`, `turnId`; cancel je scoped. Result je
   právě jeden z `ok | cancelled | timeout | error`; případné `degraded` se
   přidá jen explicitním rozhodnutím. `ModelRequest` rozliší `callerRole`,
   `modelRole` a účel `classify | answer | synthesize | refine`; prázdný output
   není úspěch. Streaming zůstává mimo tento kontrakt.
6. **Test:** pozitivní round-trip všech tří connectorů v JS i TS; negativně
   chybějící/cizí ID, verze/status, response na error, error na ok, prázdný
   modelový obsah, duplicitní terminal, out-of-order sequence a unscoped cancel.
7. **Stop:** operátor veřejné schéma nepřijal, kontrakt by musel obsahovat M2
   effect/approval authority nebo by TS/JS sdílení vyžadovalo novou závislost.
8. **Ověření:** **NOVÝ:** `node tests/m1-contract.test.js`; existující:
   `node tests/ws-bridge.test.js`; v disposable klonu z adresáře `c3-ide/`
   `corepack yarn workspace @c3/protocol build`.

#### WP-M1-CHAT — pravdivý turn a persistence

1. **Výsledek:** dva chaty nesdílejí stav; success/error/cancel/timeout mají
   jediný pravdivý request-level výsledek a úspěšný assistant je durable před
   odpovědí.
2. **Povolené cesty:** `src/chat/controller.js`, `conversation-store.js`,
   dočasně `response-finalizer.js`, chat/abort error typy, `src/routes/chat.js`,
   **NOVÉ** `tests/m1-chat-*.test.js`. **Zakázané:** `src/llm/**`, `src/ws-bridge/**`,
   `c3-ide/**` a quality/synthesis internals.
3. **Connector:** pouze adaptér přijatého v1; sémantiku nemění.
4. **Závislost:** `WP-M1-CONTRACT`; `response-finalizer.js` se po přijetí předá
   výhradně `WP-M1-QUALITY`.
5. **Demo:** dva oddělené chaty, deterministický request, modelový request,
   stop/start nad stejnou SQLite a přesně obnovené turny.
6. **Test:** pozitivně HTTP deterministic pod 100 ms bez LLM a durable restart;
   negativně provider/timeout/persist exception a cancel před, během i těsně
   před persistencí bez assistant turnu nebo false-success; backendový
   konverzační stav A se nesmí objevit v konverzaci B. Izolaci Studio panelů
   vlastní `WP-M1-STUDIO`.
7. **Stop:** změna connectoru, filesystem attachment authority nebo nové
   rozhodnutí o `degraded` výsledku.
8. **Ověření:** `node tests/deterministic-answer-latency.test.js`,
   `node tests/confirmation-ownership.test.js`, `node tests/routes-smoke.test.js`,
   `node tests/chat-persistence.test.js`; **NOVÝ:**
   `node tests/m1-chat-contract.test.js`.

#### WP-M1-MODEL — jedna pravdivá Ollama hranice

1. **Výsledek:** role binding, VRAM fit, timeout/cancel/provider failure a
   modelový výstup mají přesný typ a každé volání je přiřaditelné účelu.
2. **Povolené cesty:** `src/llm/{auth-types,cre-bridge,gateway,model-ctx}.js`,
   `src/upgrade/{model-registry,model-profiles}.js`, nové model contract testy.
   **Zakázané:** chat, Studio/WS, quality a online upgrade automatika, kromě
   následujících přesně schválených follow-up checkpointů:
   - **B3-IDENTITY (006/D+):** nový `src/upgrade/model-identity.js`, identity
     comparisons v `model-registry.js` a `upgrade-manager.js`, plus přímý
     fallback `src/routes/system.js`. Pokryje registry, overview,
     usage/validation, `getUnusedOldModels()`, registry auto-clean a přímý
     system-route fallback. Chatový cleanup je kanonicky chráněn při vytvoření
     seznamu, ale jeho direct provider delete zůstává samostatný atomický
     authority residual v `docs/findings/006-model-cleanup-bypasses-registry-guard.md`;
     age-based cleanup navíc čeká na sjednocení SQLite/ISO timestampů ve
     `docs/findings/007-model-cleanup-timestamp-ordering.md`;
     `checkBindingIntegrity()` přejde na `DETECTED/PROPOSED` a vytvoří přesně
     nula assign/override/broadcast efektů;
   - **B3-PROFILE (009/A):** jediný artefakt
     `src/llm/model-runtime-profile.js`, jeho spotřeba v `model-ctx.js` a úzká
     změna `src/chat/context-compact.js`; existující
     `tests/m1-model-gpu-pilot.test.js` a
     `tests/context-compact-model-ctx.test.js` jsou povolené. Threshold, safety
     truncate, provider request i post-log fill musí používat tentýž snapshot
     efektivního kontextu. **Implementováno a offline ověřeno:** exact
     `qwen3.5:27b` má commitnutý strop 4096, digest, 1 GiB headroom, 100% GPU
     residency a zákaz fallbacku; request jej smí snížit, ne zvýšit. Profil
     není fyzický VRAM FIT důkaz a 4096 zůstává kalibrační kandidát do nového
     skutečného T3 běhu;
   - **B3-FAILOVER (006/D+):** teprve po přijetí IDENTITY samostatný opt-in
     desired/active failover. Přesný scope je nový
     `src/db/user-settings.js`, `src/upgrade/model-failover.js`, malé aditivní
     `src/db/migrations/*model_failover*.js`, `model-registry.js`, identity a
     verify části `upgrade-manager.js` a scheduler seam v `src/server.js`.
     Autoritou opt-inu je JSON `user_settings.id=1`; missing/malformed/DB error
     fail-close. Je to schválená výjimka do upgrade automatiky, nikoli změna
     L0-9 před důkazem. **První checkpoint je implementovaný:** nový helper
     typovaně čte JSON, defaultuje failover na `false` a zapisuje vlastněnou
     `models` sekci transakčním merge. Runtime jej zatím nekonzumuje. Před
     aktivací zbývá vyřešit generický whole-document writer `/api/settings`
     bez neautorizovaného rozšíření scope a vytvořit čerstvý role-suite proof
     svázaný s exaktním digestem; dnešní name-only score takovým důkazem není.
     **Druhý checkpoint je implementovaný:** migrace 046 vytváří oddělený
     versioned desired binding, incident projection s `row_version`,
     append-only audit a append-only digest-bound PASS proof. DB odmítá active
     failover i `verified` audit bez čerstvého proofu shodného v roli, suite,
     canonical name, digestu, policy a deklarovaných PASS prazích. Projection
     koření aktivní binding v konkrétním `active_event_id`; oddělený
     `last_event_id` může sledovat claim jen s odpovídajícím claim tuple. Tento
     **Třetí checkpoint je implementovaný:** inertní repository pozoruje pouze
     existující config/legacy desired binding, idempotentně zakládá detection a
     přiděluje ohraničené claims v `BEGIN IMMEDIATE`. Přes dva skutečné SQLite
     workery projde právě jeden claim a druhý končí typovaným stale výsledkem;
     audit a projekce se při chybě rollbackují společně. Caller nesmí dodat čas,
     event, operation ani token a `USER_APPLY/USER_ROLLBACK` zůstávají zavřené,
     dokud nevznikne atomický override+supersede seam. **Čtvrtý checkpoint je
     implementovaný:** striktně expirovaný claim lze jednou auditovaně uvolnit
     a potom znovu claimnout běžným CAS. Rovnost s expiry je stále live;
     migrace 047 odmítá falešný `CLAIM_EXPIRED`, repository vrací přesný
     idempotentní retry a dva reálné workery vytvoří jeden release event.
     Expire a nový claim jsou bezpečně dvě transakce, nikoli garance stejného
     workera. **Pátý checkpoint je implementovaný:** immutable measurement
     policy pinuje raw bytes role/suite zdrojů, verzovaný canonical JSON,
     přesnou mapu 7 rolí na 36 seřazených testů a role-specific acceptance
     shape. Default C má issuance vypnuté a všechny prahy i TTL `null`; role
     measurement hash proto není PASS proof autorita. **Šestý checkpoint je
     implementovaný:** samostatný measurement-only child odmítne zděděné
     Node flagy i neznámé environment klíče, povolí pouze exaktní vlastní
     IPv4 loopback provider, zachytí plný skutečný request/response včetně
     randomizované matematiky, znovu ověří contract a inventory digest
     před/po a publikuje kanonický read-only measurement artifact. Artifact je
     výslovně `NOT_ISSUED`, jeho `sourceRevisionClaim` není samostatným
     důkazem HEAD a runner neimportuje DB, registry, upgrade manager ani WS.
     Repository zatím neobsahuje proof issuer/persistence, terminal
     activation/restore, manual supersede, runtime apply, startup rehydrate ani
     scheduler a žádný runtime modul jej nekonzumuje. Chybějící proof
     acceptance prahy a TTL jsou shromážděné v rozhodnutí 015; measurement-only
     runner může pokračovat, PASS issuance zůstává fail-closed.
3. **Connector:** adaptér `ModelRequest/Result` v1; nemění schéma.
4. **Závislost:** `WP-M1-CONTRACT`; offline fake běhy nečekají na GPU.
5. **Demo:** skutečná Ollama odpověď; negativní unavailable cesta používá
   izolovaný fake/uzavřený port, nikdy nezastavuje sdílenou Ollamu a nikdy
   nevrací prázdný úspěch.
6. **Test:** fake Ollama pokryje validní, prázdný/malformed, 404/500/503,
   refused socket, timeout, queued cancel, retry policy a uvolnění semaforu.
   Sériový GPU běh změří cold/warm, klasifikaci, answer, mid-generation cancel,
   model/num_ctx a VRAM před/peak/po.
7. **Stop:** nutnost pull/delete/rebind modelu, nebezpečný VRAM stav, změna
   connectoru nebo požadavek na streaming.
8. **Ověření bez GPU:** `node tests/llm-gateway-runtime-signal.test.js`,
   `node tests/model-ctx.test.js`; **NOVÝ:**
   `node tests/m1-model-contract.test.js`;
   GPU jen registrovanou T3 sadou s `concurrency=1`.

#### WP-M1-STUDIO — skutečný klient, ne regex nad bundlem

1. **Výsledek:** built Theia správně koreluje panely, ukáže progress i přesný
   terminal, scoped cancel/reconnect a nemá tichý Fonts egress.
2. **Povolené cesty:** `src/ws-bridge/{ws-server,session-adapter}.js` bez
   protocolu; relevantní `c3-ide/extensions/c3-chat-panel/lib/**`, Electron
   bridge a nové Studio client/journey testy. Archivovaný chat-panel TypeScript
   není implementační plocha.
   **Zakázané:** chat controller, routes, LLM, quality a přijatý protocol.
   **Operátorsky schválené Gate 1 výjimky:** 010/A+ smí odstranit stale
   `c3-protocol/lib/**` z trackingu, změnit `.gitignore` a
   `c3-ide/package.json` pro jeho generated prebuild; 012/B smí změnit pouze existence-aware history
   větev v `src/routes/chat.js`; 014/A smí změnit pouze legacy rehydrate control
   payload/handler v `src/ws-bridge/ws-server.js`, autoritativní Studio klient,
   localStorage clamp a úzký durable-readiness šev v `conversation-store.js`.
   Nejde o obecné rozmrazení protocolu, routes ani store a schéma M1 v1 zůstává
   zakázané.
3. **Connector:** konzument `ConversationCommand/Result` a `CoreEvent` v1.
4. **Závislost:** `WP-M1-CONTRACT` a výsledek `WP-M0-E`. Operátor přijal ručně
   udržovaný `lib` jako současný source-of-truth; případná pozdější relokace je
   byte/behavior-preserving a nesmí produkt nahradit menší stale variantou.
   Oprava cancelu začíná ve Studio klientovi (`wsSendCancel` / `_cancelExecution`)
   doplněním `conversationId`; správná scoped backend větev se zachová a její
   `cancel all` kompatibilní fallback se pouze negativně otestuje.
5. **Demo:** skutečná Theia, dva panely s prokládanými eventy, jeden cancel a
   jeden success, provider stop, restart/reconnect a nulový Fonts request.
6. **Test:** Operátor po nálezu 011 změnil M1 acceptance na **WS send +
   fail-closed offline stav**. Pro všechny tři send call sites se samostatně
   ověří unavailable WS, `sendChat() === false` i synchronní throw; s prompty
   `FILE_WRITE`, `SHELL` a generic tool je počet `/chat`, provider,
   filesystem i tool efektů přesně nula a input zůstane `NOT_SENT`/retryable.
   HTTP send parity se
   vrátí až nad M2 effect authority. Browser local capability projde na přesný
   backend origin a nikdy jinam; základní Studio HTTP cesty nevracejí boundary
   `403`; `503` nikdy assistant; cancel A neovlivní B; late assistant po cancelu je
   odmítnut; každá terminal větev vypne spinner; syntakticky platná identita
   explicitně uvedená v `invalidIds` úplného ACK zmizí, zatímco lokálně
   malformed identita zůstane s daty quarantined/degraded;
   clean build načte stejné runtime chování a nevytvoří Fonts request; bounded
   soak a řízený shutdown skončí bez renderer/GPU crashu. Rehydrate ACK je
   autoritativní jen jako úplný `validIds/invalidIds` partition nad explicitně
   durable storem; partial ACK, history `404` ani absence ve `validIds` nesmí
   zrušit identitu. Typovaný matching reject ukončí rehydrate okamžitě jako
   degraded; cizí/replayed reject se nesmí vydat za terminál aktuálního běhu.
   Clean-clone protocol output smí před prebuildem chybět; po něm musí být
   ignorovaný/untracked, exportovat M1 a tracked strom zůstane čistý.
7. **Stop:** build přepisuje/odstraňuje dnešní UX, potřebuje novou browser test
   závislost, mění connector nebo zatahuje effect/auto-exec scope.
8. **Ověření:** `node tests/ws-bridge.test.js`; **NOVÝ:**
   `node tests/m1-studio-client.test.js`; v čistém klonu frozen Yarn install,
   build a registrovaný Studio journey. Build neběží v dirty checkoutu.

#### WP-M1-QUALITY — až po třech konzumentech

1. **Výsledek:** refinement má jednoho vlastníka a naměřenou přidanou hodnotu,
   cenu i latenci; žádná odpověď se nerefinuje dvakrát.
2. **Povolené cesty:** synthesis, `src/chat/quality/**`, quality telemetrie,
   převzatý `response-finalizer.js`, fixní corpus a M1 quality testy.
   **Zakázané:** connector, gateway, routes, WS a Studio.
3. **Connector:** pouze čte přijaté Model/Conversation výsledky.
4. **Závislost:** přijaté CHAT, MODEL a STUDIO; běží sériově jako integrace.
5. **Demo:** report A/B se stejným modelem a corpusem plus konkrétní přijatý a
   odmítnutý refinement včetně ceny.
6. **Test:** fake model pro skip, přesně jeden refine, zlepšení, semantic drift,
   horší/prázdný výsledek, provider error a cancel; GPU A/B reportuje p50/p95,
   score delta, acceptance rate, tokeny a dobu.
7. **Stop:** metrika nerozliší kvalitu, corpus nemá přijatá chování, je nutná
   změna connectoru nebo GPU prerekvizita není bezpečná.
8. **Ověření:** `node tests/improvement-loops.test.js`,
   `node tests/chat-output-quality.test.js`,
   `node tests/chat-synthesis-hardening.test.js`; **NOVÝ:**
   `node tests/m1-quality-contract.test.js`; GPU A/B pouze sériově.

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

### Již potvrzená příprava, aby M5 nezačalo novou inventurou

- `scripts/install.sh` dnes dělá PDF runtime povinnou instalační podmínkou,
  přestože PDF je deklarovaná conditional prerekvizita. `WP-M5-PACKAGE` začne
  rozdělením podporovaného core profilu a explicitních optional komponent;
  nesmí pouze přeskočit chybu instalace.
- `src/core/db-backup.js` umí create/list/prune/stats, ale nemá state restore.
  `WP-M5-DATA` začne skutečným backup→poškození→restore→porovnání round-tripem,
  ne dalším testem existence backup souboru.
- `validateApiToken()` existuje, ale není globálně připojený; agents API používá
  vlastní admin token. `WP-M5-AUTH` nejprve sepíše skutečný route/WS matrix a
  pak zavede jediný fail-closed guard bez rozbití loopback development mode.
  **Matrix je hotový** (2026-08-07, [`docs/review/2026-08-07-AUTH-MATRIX.md`](docs/review/2026-08-07-AUTH-MATRIX.md)):
  251 unikátních route, per-route kontrolu má 7, zbytek chrání jediná hraniční
  kontrola. Tři věci mění zadání: middleware chain neexistuje, takže guard má
  právě jedno možné místo a musí klasifikovat podle klíče route; most k agent
  route zahazuje hlavičky; a v produktu jsou dvě neslučitelné auth sémantiky.
  `validateApiToken()` je použitelná bez přepisu a vrací `scopes`.
- přímé efekty jsou rozptýlené v routes, tools, skills, agentech, marketplace,
  notifications, media a upgrade kódu. M5 je nesmí inventarizovat znovu:
  vychází z přijatého M2 brokeru a pouze hledá zbývající bypassy.
- dnešní `docker/Dockerfile` a `docker/docker-compose.yml` nastavují
  `C3_HOST=0.0.0.0`, což runtime správně odmítá, a zároveň používají nepřipnuté
  image/model pulls. Docker se proto nyní
  neprezentuje jako podporovaná instalační cesta; oprava nebo explicitní
  `unsupported` disposition patří do `WP-M5-PACKAGE`.
- `c3-ide/node_modules` není součástí baseline. Theia frozen install/build a
  native ABI se nejprve změří v M0/M1 a teprve jejich přijatá cesta se balí.

### Závislostní provedení M5

1. **PACKAGE + DATA contracts:** připnout podporovaný artifact/install profil,
   data directories, schema/migration a restore kontrakt. Tyto dva WP mohou být
   logicky připravené souběžně, ale sdílené installer/version soubory integruje
   jediný vlastník.
2. **AUTH, PROCESS, OBSERVE:** proti přijatým M2 connectorům paralelně navrhnout
   route/WS guard, process lifecycle a request/run correlation; žádný z nich
   nesmí měnit veřejnou sémantiku connectoru.
3. **OUTBOUND v rámci AUTH/conditional policy:** empiricky zachytit každý
   network call site; default instalace prochází s blokovaným outboundem,
   explicitní funkce má scope, approval a audit.
4. **PERF:** až nad stabilními M1–M4 journeys stanovit budgety podle cold/warm,
   p50/p95, error rate, RAM/VRAM a soak dat, nikoli je vymyslet před měřením.
5. **REMOTE-PORT + CONDITIONAL-SURFACES:** implementovat jen zmražený M2
   kontrakt a odvodit přesný required release set.
6. **PRIVACY:** operátorská rotace a rozhodnutí o Git historii proběhnou před
   release freeze; agent nikdy nevypisuje hodnoty tajemství ani nepřepisuje
   historii bez výslovného souhlasu.

Každý první negativní test je už pojmenovaný: install bez optional PDF musí
uspět nebo pravdivě BLOCKED podle zvoleného profilu; poškozená DB se obnoví ze
zálohy; neautorizovaný HTTP i WS request selže; crash zruší grant a uklidí child
proces; blokovaná síť zachytí tichý egress; unsupported conditional plocha se
nesmí inzerovat jako funkční. Přesné test file paths se vytvoří až ve vlastním
WP, aby roadmapa nepředstírala již existující důkaz.

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

Architektura dovoluje nejvýše tři logicky paralelní zapisující WP s disjunktními
cestami a connectory. **Aktuální operátorské pravidlo jednoho worktree však
znamená právě jednoho zapisujícího vlastníka v daném okamžiku.** Paralelně mohou
běžet read-only trace, review a příprava testů bez zápisu. Jeden integrační
vlastník skládá přírůstky po malých commitech; lokální GPU role jsou sériové.

Agent pokračuje autonomně uvnitř schváleného WP. Zastaví dotčenou část při
změně veřejného connectoru, produktu/scope, bezpečnostní či datové nejasnosti,
konfliktu vlastnictví nebo výsledku, který zpochybňuje směr. Nezávislé části
mohou pokračovat.

## 13. Aktuální pořadí

1. Plné přijetí `PRODUCT.md` a roadmapy v4 zůstává otevřené; pro současnou
   práci je samostatně přijatý M1 batch a rozhodnutí 001–014.
2. **Dokončený M0-E source checkpoint:** ručně udržovaný chat-panel `lib` je
   současný autoritativní runtime; stale TS je archiv a package `build`,
   `watch`, `clean` ani historický fix script jej nesmějí přepsat nebo smazat.
3. **Dokončený M0 runtime checkpoint:** bounded browser HTTP transport,
   odstranění Google Fonts a fresh-clone Theia→WS/HTTP negativní journey mají
   dva po sobě jdoucí `PASS` na `7236d221`. Současné UI bylo pouze funkčním
   nosičem, ne vizuální baseline. Zbývá standardizovat build envelope, aby
   registrovaná T5 sada nemusela pravdivě zůstávat `BLOCKED`.
4. Operátorsky rozhodnout L0-8 nejpozději před `WP-M3-BOUNDARY`; M0 jej může
   uzavřít pouze jako explicitně pojmenovaný blocker s vlastníkem a termínem.
5. B1 contract a B2 chat jsou implementované; Gate 1 volby 001–014 jsou
   schválené a zapsané. Proof-policy otázka 015 má implementovaný vratný
   measurement-only default C; operátorské prahy A/B a proof TTL zůstávají
   otevřené. B3 a B4 proto zůstávají pravdivě `BLOCKED`.
6. **B3-IDENTITY a B3-PROFILE jsou implementované a focused offline
   ověřené:** canonical presence
   identity chrání schválené binding/delete/cleanup cesty a integrity scan je
   detection-only; atomický chat cleanup a retention-time residualy jsou
   pravdivě oddělené jako findings 006 a 007. Sdílený runtime profil nyní
   omezuje oba gateway vstupy a conversation compaction; neprohlašuje GPU
   PASS. V jediném worktree po malých commitech následuje nový sériový T3 běh
   od 4096, potom **B3-FAILOVER**. Settings authority a fail-closed storage
   schema, repository/CAS claim základ a striktní expired-claim recovery jsou
   implementované bez modelového effectu. Recovery je záměrně expire→nový CAS,
   takže jiný worker může legitimně vyhrát; není to atomický same-worker reclaim.
   Measurement policy už fail-closed pinuje role-suite autoritu a verzovanou
   serializaci. Izolovaný measurement-only runner vytváří soukromý kanonický
   artifact bez DB/proof/binding efektu; fake-provider CHAT a D1 pokrývají
   ordered suite, skutečný randomizovaný prompt i negativní drift. Proof issuer,
   terminal state-machine, manual supersede, runtime apply, startup rehydrate a
   scheduler zůstávají otevřené a failover se dosud neaktivuje. Proof issuance
   čeká na prahy a TTL z rozhodnutí 015; nový skutečný GPU běh zůstává
   samostatnou blokovanou evidencí, dokud není legitimně čistý checkout.
7. B4 pokračuje 010/A+ a 011/A, potom v pořadí 014 server → 014 klient → 012
   route → 012 klient → společný DB-backed wire test. Read-only review může
   běžet souběžně; GPU běhy nikdy.
8. Teprve po built M1 multi-panel/cancel/provider/reconnect journey, soak a
   přijetí B3+B4 otevřít B5 QUALITY a následnou B6 exit demonstraci.
9. M2 effect authority a project-change journey se otevírají až po M1.

## 14. Rozhodovací fronta — otázka až ve chvíli, kdy má data

| Rozhodnutí | Kdy je skutečně potřeba | Jaká evidence musí být na stole |
|---|---|---|
| Přijetí `PRODUCT.md` a `ROADMAP.md` | Teď, před uzavřením M0 | Tento 22/22 obraz, backend baseline, offline scan a známý Studio gap. |
| Autoritativní Studio source/build disposition | **Rozhodnuto 2026-08-07** | Commitnutý `lib` je runtime; stale TS je inertní archiv a současné UI není finální vizuální baseline. |
| `degraded` versus terminální `error` po částečném tool výsledku | **Rozhodnuto 2026-08-08: 001/A** | Terminální `error`; partial data mají oddělené schéma, ale `persistPartialToolResults` zatím nemá produkčního konzumenta. |
| Streaming v 1.0 | Po přijetí non-streaming M1 baseline | Cold/warm whole-response latency, cílový TTFT a cena změny tří connectorů. |
| Strict injection versus veřejná extension boundary pro L0-8 | Před M3-BOUNDARY | Skutečný import graph, specialista E2E a nejmenší prototyp obou variant. |
| Zachovat/odložit/ukončit upgrade automatiku 18b | Před M5 conditional freeze | Úmyslný check/approve/reject/rollback journey, outbound a údržbová cena. |
| Které notifications/marketplace/media plochy jsou podporované | Před M5-CONDITIONAL-SURFACES | Funkční Studio journey, prerekvizity a bezpečnostní/rollback náklady každé plochy. |
| Open-source náhrada incumbent komponenty | Teprve při změřeném bottlenecku | Baseline, malý pilot, přínos funkcí/kvality, integrace, migrace a rollback. |
| Remediace kompromitované Git historie | Před M6 freeze | Seznam typů tajemství k rotaci, dopad variant a výslovný operátorský souhlas. |
| Remote listener/pairing | Až po M6 | Zmražený `RemoteCorePort` a negativně prokázaná oddělená security boundary. |

### Které řádky mají evidence připravenou (2026-08-07)

Čtyři read-only sondy na `1fc8f03e` doplnily podklady pro dva řádky fronty.
Rozhodnutí zůstávají otevřená — dodána je jen evidence, kterou tabulka vyžaduje.

| Řádek fronty | Stav evidence |
|---|---|
| Strict injection versus veřejná extension boundary pro L0-8 | **kompletní** — import graph, oba prototypy postavené a spuštěné se shodným výstupem, srovnávací tabulka: [`docs/review/2026-08-07-L0-8-BOUNDARY.md`](docs/review/2026-08-07-L0-8-BOUNDARY.md). Chybí jen specialista E2E, který je `NAPSÁNO` a patří do `WP-M3-BOUNDARY` |
| Remediace kompromitované Git historie | **kompletní** — seznam typů k rotaci ověřený proti kódu a dopad tří variant: [`docs/review/2026-08-07-SECRET-TYPES.md`](docs/review/2026-08-07-SECRET-TYPES.md). Zbývá výslovný operátorský souhlas |

Mimo frontu vznikly dva podklady pro `WP-M5-AUTH`:
[`AUTH-MATRIX`](docs/review/2026-08-07-AUTH-MATRIX.md) a
[`OUTBOUND-CENSUS`](docs/review/2026-08-07-OUTBOUND-CENSUS.md).

Roadmapa se mění jen při novém důkazu nebo operátorském rozhodnutí. Dokončený
milník se označí výsledkem a odkazem na demonstraci; nepřepisuje se tak, aby
vypadal zeleně zpětně.
