# IntentSmith — víceúrovňová roadmapa k production-ready produktu

**Verze:** 4 · **Datum:** 2026-08-08 · **Vlastník:** operátor ·
**Stav: PŘIJATO OPERÁTOREM 2026-08-21** společně s `PRODUCT.md`.

Členění milníků, závislostní DAG a exit kritéria této verze 4 od tohoto data
**řídí práci**. Dosud platila jen omezená autorita — prováděcí kontrakt
[`docs/execution/m1-batch.md`](docs/execution/m1-batch.md) pro běžící M1
a rozhodnutí 001–014 uzavřená 2026-08-08. Ta zůstávají v platnosti a nově je
zastřešuje přijatá roadmapa jako celek. Explicitní produktová rozhodnutí
operátora dál zůstávají závazná podle `DIRECTION.md`; kde by se rozcházela
s touto roadmapou, platí `DIRECTION.md`.

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

| Milník | Aktuální stav | Vstup | Uživatelský výsledek |
|---|---|---|---|
| **M0 Produktová pravda** | `ACCEPTED / PASS` | současný C3/IntentSmith strom | Víme, co produkt je a co skutečně běží; deklarace nelžou o chování. |
| **M1 Lokální runtime páteř** | `ACCEPTED / GATE_2_PASS` | M0 accepted; Gate 1 PASS | Stabilní Linux → Theia → chat → Ollama → persistence. |
| **M2 Řízená práce nad projektem** | `ACCEPTED / CLOSEOUT_PASS` | M1 accepted | Záměr se změní v přesně schválený patch, test a audit. |
| **M3 Modulární platforma** | `ACCEPTED / REVIEW_PASSED` | M2 accepted | Všech sedm oddílů má operátorské `REVIEW_PASSED`; legacy agent mutační surface je fail-closed odstavený a native extension cesta zůstává jedinou spustitelnou autoritou. |
| **M4 Auditovatelné self-learning** | `ACCEPTED / REVIEW_PASSED` | M2 accepted | První same-project smyčka je implementačně, integračně i operátorsky přijatá na exact candidatu `286f5ba8`. |
| **M5 Production hardening** | `8/9 REVIEW_PASSED / PRIVACY_CHANGES_REQUIRED / KEY_CUSTODY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED / M6_GATE_CLOSED` | M3 + M4 accepted | Decision 041 implementace dostala `REVIEW_PASSED` a trust store drží čtyři oddělené veřejné klíče. Úzký review ale našel stale M6 migration oracle a neoffline custody privátních klíčů; oracle remediation je implementovaná, custody zůstává otevřená. Osm rotací, history disposition a podepsaná M5 acceptance neproběhly. |
| **M6 IntentSmith 1.0 release** | `INTEGRATION_VERIFICATION_PENDING / DEVELOPMENT_REGISTRY_DRIFT / FULL_RELEASE_GATE_REQUIRED / ACCEPTANCE_BLOCKED` | M5 accepted; technická práce povolena přes zavřený gate | Současná integrace obsahuje 413 required programů, 352 deterministic. M5 externí podmínky, provider, modelové měření, celý M6 gate, 24h soak, review/demo a podpisy zbývají. Starší PASS platí jen pro původní kandidáty. |
| **M7 Remote Companion** | `FOLLOWUP_INTEGRATED / REVIEW_FINDINGS_REMEDIATED / RE_REVIEW_PENDING / NOT_ACCEPTED` | M6 + remote boundary | Integrované mobilní release pojistky, canonical JSON corpus a systemd renderer. Dvě review vady se opravují v současném kandidátu; nová evidence a review zbývají. UI mapping, produkční konfigurace, fyzická matice 13+7 a release podpisy nejsou hotové. |

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

**Dodatek 2026-08-21 na `1d0daf83`.** Registrace deseti eval sad z 19.–21. 8.
rozšířila deklarovaný offline rozsah o programy, které pod OS blokovaným
outboundem nikdy neběžely. Doběhly stejným postupem:

- run ID: `offline-egress-eval-10`, report
  `.intentsmith-artifacts/egress-scan/offline-egress-eval-10/report.json`;
- výsledek **10/10 PASS**, nejdelší sada 2 600 ms;
- klasifikace `network:none` je tím ověřená spuštěním, ne deklarací.

Poznámka k položce „stale harness count": pin byl 2026-08-03 opraven na 95,
ale mezitím znovu zastaral na 99 (drift z eval sad). Srovnán na `a9b71d71`;
fail-closed assertion `unprotected == []` držela po celou dobu.

**Runtime baseline změřen 2026-08-21 na `d612494b`** (existující strom, ne
čerstvý klon). Skutečný server, skutečné požadavky, skutečná Ollama:

| Krok | Výsledek |
|---|---|
| Start serveru | Naběhl na loopbacku, dynamický port z `~/.c3/port`, přístup přes `X-IntentSmith-Local-Capability`. Odpovídá invariantu L0-10 |
| Deterministická odpověď bez modelu | `40 ms`, `classifiedBy: deterministic`, `localComputation: true`, žádné volání modelu — pod L3 cílem 100 ms |
| Modelová odpověď přes lokální Ollamu | `qwen3.5:27b`, `52 990 ms` |
| Persistence | 4 zprávy uložené a čitelné |
| Restart | Čisté ukončení, nový běh na jiném portu |
| Obnovení po restartu | Všechny 4 zprávy neporušené |
| Deterministická odpověď po restartu | `39 ms`, znovu bez modelu |

Online discovery při startu proběhlo (`9 local + 0 catalog + 6 L4 = 15
kandidátů`, HuggingFace enrichment `8 exact / 1 odhad`), což potvrzuje default
`on` z rozhodnutí 2026-08-19 na běžícím produktu.

**Fresh-clone doplněn 2026-08-21 na `582ddd6b`.** Klon do prázdného adresáře,
čistý strom (0 změn), `npm ci --offline` prošel na 206 balíčcích — **install
provenance je tím offline doložená**. Server z čerstvého klonu naběhl,
deterministická odpověď `49 ms` bez modelu, modelová `qwen3.5:27b` za
`53 698 ms`, 4 zprávy uložené a po restartu neporušené.

**Studio doplněno 2026-08-22 na `2a3acdbf`.** `studio-electron-boundary` vrací
`STUDIO_ELECTRON_BOUNDARY_PASS`. Příčinou dřívějšího `electron-exited-before-cdp`
nebyl chybějící build ani izolace, ale **délka `TMPDIR`**: Chromium si v něm
zakládá unix domain sockety a `sun_path` má limit 108 bajtů, zatímco runtime root
pod `.intentsmith-artifacts` má 95 znaků. Sada teď dává Electronu krátký privátní
temp; backend zůstává pod runtime rootem.

**Exit kritérium je tím splněné celé.** Čistá instalace, server, Studio,
deterministický i modelový chat, persistence a restart mají doložený
reprodukovatelný baseline.

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
| Autorita dokumentů | `PŘIJATO` | Operátor přijal `PRODUCT.md` i `ROADMAP.md` 2026-08-21. |
| Backend/runtime | `OVĚŘENO` | Fresh-clone install provenance doložena 2026-08-21 na `582ddd6b`: `npm ci --offline`, server, deterministický i modelový chat, persistence a restart z čistého klonu. |
| Offline boundary | `MEASURED` | Před M6 opravit release-policy sentinel a aktivovat pravdivý PDF toolchain set. |
| Capability picture | `PŘIJATO` | 22/22 je v `SYSTEM-MAP.md`, přijato 2026-08-21. Přijetí obrazu **neznamená** PASS jednotlivých schopností — ty drží vlastní žebřík. |
| Studio/Theia | `PŘIJATO / PASS` | B4 produkční ACK a byte bridge jsou integrovány. Finální standalone fresh clone na `d518d7ec` prošel offline instalací, produkčním buildem a built negotiated Electron journey: literal Studio → skutečný server/SQLite/Ollama, 2 panely, cancel/error/reconnect, nulový egress a čistý shutdown. Registry B6 řádek připíná tento `lastGreen`. |
| L0-8 specialist boundary | `ROZHODNUTO` | Varianta A, strict injection — [rozhodnutí 019](docs/decisions/019-l0-8-specialist-boundary.md), přijato 2026-08-09, zapsáno 2026-08-21. Exit kritérium „otevřené L0 porušení má rozhodnutí" je tím splněné. Implementace nese `WP-M3-L0-8-INJECTION`, vynucení `-ENFORCEMENT`; do té doby platí zákaz nových interních importů specialistů. |

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
     system-route fallback. Navazující
     [`WP-M1-MODEL-CLEANUP-AUTHORITY`](docs/wp/WP-M1-MODEL-CLEANUP-AUTHORITY.md)
     centralizuje HTTP a scheduler delete do registry a odstraňuje direct chat
     effect. Chatový candidate source dnes vrací právě one-step rollback model,
     takže se před inventory pravdivě zaparkuje; funkční chatové odstranění
     čeká na explicitní retirement pravidlo. Registry sdílí mutation owner s
     binding application, chrání durable desired/rollback identitu,
     dvakrát ověřuje exact name+digest a fail-close převádí všechny retention
     timestampy na epoch; nulovou usage nepovažuje za důkaz nepoužití. Finding
     007 je focused remediovaný; direct bypass a
     assign/delete část findingu 006 jsou opravené. C1 ale netvrdí atomickou
     ochranu proti všemu aktivnímu model-use, více procesům ani durable delete
     audit. C2a je fresh-clone ověřený a single-process serializuje delete s
     direct pull a registry validací. C2b gateway i binding jsou fresh-clone
     ověřené na `cfcb63dd`. Gateway shared lease vzniká až po semaphore slotu a drží přes
     všechny provider pokusy, response body i retry delay. Binding cutover po
     případném pullu rezervuje previous+target přes exact re-resolve, runtime
     prepare, durable zápis, compensation a synchronní finalize; exact
     verification drží target přes provider probe i durable success zápis a
     před retry delay lease uvolní. Pokryté jsou čtyři z pěti živých cest;
     rozhodnutí o VRAM residency zůstává. [023](docs/decisions/023-m1-vram-artifact-use-authority.md)
     odděluje doporučenou úzkou artifact/delete ochranu od globální
     gateway/ComfyUI GPU residency. Tyto residualy vlastní
     [`finding 010`](docs/findings/010-model-delete-use-and-audit-boundary.md);
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
     Dnešní provisional reader používá JSON `user_settings.id=1` a pro
     missing/malformed/DB error fail-close. Není ale jedinou writer autoritou.
     **První checkpoint je implementovaný:** helper typovaně čte JSON,
     defaultuje failover na `false` a zapisuje vlastněnou `models` sekci
     transakčním merge. Detection scheduler jej už konzumuje, ale typed writer
     nemá produkčního volajícího a pět legacy mutation cest může stejný blob
     přepsat. [Rozhodnutí 020](docs/decisions/020-m1-model-failover-opt-in-surface.md)
     je proto `CHANGES_REQUIRED`; doporučuje oddělenou revisioned
     `model_automation_policy` autoritu a explicitní backup/import/reset
     adaptéry. Před
     aktivací je navíc nutný čerstvý role-suite proof svázaný s exaktním
     digestem; dnešní name-only score takovým důkazem není.
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
     po non-clobber hardlinku a odstranění staging jména potvrzen post-link
     directory fsyncem; bez exit 0 přesto nikdy není přijatelnou evidencí.
     Je výslovně `NOT_ISSUED`, jeho `sourceRevisionClaim` není samostatným
     důkazem HEAD a runner neimportuje DB, registry, upgrade manager ani WS.
     **Sedmý checkpoint je implementovaný:** parent přijímá pouze roli a
     požadované modelové jméno; provider bere z runtime config authority a
     exact name, canonical name i digest odvozuje ze striktního `/api/tags`.
     Jakákoli staged, tracked, untracked nebo ignorovaná změna pod `src/`,
     `scripts/`, `tests/` či v `package.json` běh před provider efektem
     odmítne, zatímco cizí rozpracované `docs/` do kandidáta nevstupují.
     Měřený child i policy moduly se načtou z privátního read-only exportu
     přesných blobů HEAD; parent přijme jen exit 0, prázdný stderr, jediný
     mode-0400 artifact, shodný inventory před/po a všech pět pinů. Samostatný
     immutable receipt zůstává `NOT_ISSUED` a deklaruje nulové DB, binding,
     config a broadcast efekty. Jeho standalone validator potvrzuje pouze
     `STRUCTURAL_ONLY`; silnější stav vznikne jen proti zvlášť odvozeným parent
     pinům. Parent run i source-export adresář se znovu ověřují po child běhu a
     těsně před publikací. Zděděné Node hooks se odmítnou před efekty
     vlastněnými parentem; nejde o OS sandbox ani tvrzení, že cizí preload před
     startem Node nikdy neběžel.
     **Osmý checkpoint je implementovaný:** migrace 048 přidává append-only
     `USER_APPLY/USER_ROLLBACK` operation journal. Každý řádek nese exact
     předchozí a cílovou artifact identitu, očekávanou i commitnutou revision,
     request key, aktéra a shodný neověřený `DESIRED_CHANGED` event. Operace
     zůstává pevně `NOT_VERIFIED/NOT_APPLIED`; rollback je nový stav s přímým
     odkazem na jediný apply, nikoli `DELETE`. Manual projection bez journalu,
     přehrání starší operace, odchod z manual authority, smazání či
     `INSERT OR REPLACE` projection, incident-shaped audit metadata i
     preexistující manual projection bez provenance se odmítnou. Dokud
     repository neumí atomický
     `SUPERSEDED_BY_USER`, jakýkoli incident stejné role blokuje manual
     operation před zápisem. Jde pouze o storage autoritu: repository writer,
     incident supersede, `model_overrides`, runtime config a broadcast se
     nemění.
     Migrační identita pro tento i každý další checkpoint je už fail-closed:
     přijaté [rozhodnutí 016](docs/decisions/016-migration-identity-guard.md)
     zavedlo v `684263e3` kompletní discovery a validaci před první DB mutací;
     samostatná attestace je `af889e3b`. **Devátý checkpoint je implementovaný
     na úrovni schématu:** migrace 049 dovolí manual operation nad incidentem
     pouze v jediné transakci s přesným desired přechodem, auditním
     `SUPERSEDED_BY_USER` a terminálním CAS. Event i terminální update znovu
     ověřují původní `DETECTED`/claim lineage; `RESTORED` a
     `SUPERSEDED_BY_USER` jsou immutable a retireovat lze pouze přesně
     auditovaný `SUPERSEDED_BY_USER`. Samostatný event, neúplná transakce,
     změněný incident snapshot, duplicitní origin a caller actor mimo přesnou
     `user:` gramatiku fail-close končí bez orphan zápisu. Jde stále jen o
     schema authority: veřejný repository writer v tomto checkpointu
     nepřistává a runtime efekt zůstává nulový.
     **Desátý checkpoint je implementovaný:** veřejné
     `recordUserBindingApply()` a `recordUserBindingRollback()` vlastní jedinou
     `BEGIN IMMEDIATE` transakci přes event, operation, desired revision a
     případný incident supersede. Vstupy mají přesné allowlisty, request key je
     idempotentní i po restartu a rollback přidává nový přímý reversal. Dva
     skutečné WAL workery prokázaly same-key replay i different-key stale CAS.
     Manual desired se publikuje pouze jako `PENDING_MANUAL` s
     `NOT_VERIFIED/NOT_APPLIED`; detection je do runtime potvrzení blokovaná.
     Přesný `DETECTED` nebo ACTIVATE-claimed incident lze atomicky supersedovat,
     aktivní, `FAILED` a `RESTORED` stav vrací typovaný runtime-coordinator
     blocker. Pozdější apply i rollback mohou auditovaný terminal projection
     retireovat, ale chyba po retirementu rollbackne celý authority snapshot.
     Repository stále nevytváří override, runtime config, proof ani broadcast.
     Repository zatím neobsahuje proof issuer/persistence, terminal
     activation/restore, runtime apply, startup rehydrate ani scheduler a žádný
     runtime modul jej nekonzumuje. Chybějící proof
     acceptance prahy a TTL jsou shromážděné v rozhodnutí 015; measurement-only
     runner může pokračovat, PASS issuance zůstává fail-closed. Implementovaný
     `USER_APPLY/USER_ROLLBACK` repository seam zachovává storage garanci
     `verified=0` bez skutečné verifikace a append-only rollback lineage.
     Legacy `upgrade-manager.js` přesto zůstává druhým netransakčním binding
     commit pointem; jeho sjednocení pro HTTP i chat vlastní B3-FAILOVER runtime
     integrátor s termínem před M1 acceptance, viz
     `docs/findings/008-model-binding-commit-point-split.md`.
     **Jedenáctý checkpoint je implementovaný na hranici aplikačního stavu:**
     migrace 050 převádí legacy override na pravdivý
     `LEGACY_UNVERIFIED`, zavádí append-only výsledky runtime apply, startup
     rehydrate, exact-digest verification a notification a dovolí
     `verified=1` pouze po přesné úspěšné verifikaci aktuální runtime generace.
     Repository výsledky zapisuje transakčně a odvozuje
     `PENDING/APPLIED_PENDING_VERIFICATION/VERIFIED/FAILED`; fixed manual
     operation z migrace 048 zůstává neměnná `NOT_VERIFIED/NOT_APPLIED`.
     Legacy `applyUpgrade()` a `rollbackUpgrade()` se po migraci 050 zastaví
     typovaně ještě před providerem, runtime změnou i DB zápisem. To je
     bezpečný review checkpoint, nikoli dokončený user journey: společná
     application service, provider inventory/pull, runtime CAS a kompenzace,
     HTTP/chat cutover, startup rehydrate a commit-layer broadcast jsou další
     krok [`WP-M1-BINDING-APPLICATION`](docs/wp/WP-M1-BINDING-APPLICATION.md).
     **Dvanáctý checkpoint je implementovaný jako společný manual runtime
     commit point:** aditivní migrace 051 uzavírá runtime generaci proti
     opakovanému apply a non-retryable retry, repository rozlišuje skutečnou
     změnu od no-opu a zachovává starší authority při neúspěšném rehydrate.
     Migrace 052 připíná provider pull intent před prvním provider efektem,
     jeho exact origin/actor/revision/target authority, pětiminutový obnovovaný
     lease s fencing revision a immutable terminal outcome. Živý claim druhý
     Worker isolate nepřevezme; striktně expirovaný claim lze CAS převzít a
     starý worker už nesmí zapsat terminál. Unikátnost targetu platí pro
     binding-service commandy nad jedním přesným provider originem; aliasy
     loopback originu a direct `/api/system/models/pull` zatím tuto autoritu
     nesdílejí. Provider a binding journal jsou navíc spojeny
     DB triggerem přes shodný request key, roli, revision, actora a digest.
     Same-target acceptance má append-only no-op receipt s historickým desired
     snapshotem, DB-assigned command frontierem a set-valued causal vazbou na
     celý dosud neuzavřený terminální provider prefix; živý command nesmí
     receipt předběhnout a timestamp sám není authority. Neuzavřený úspěšný
     provider command podle 018/Q5/A blokuje další desired transition, kromě
     přesného provider→binding dokončení nebo explicitního current-binding
     no-op closure. Guard pokrývá `UPDATE`, `DELETE` i SQLite
     `INSERT OR REPLACE`; receipt ani jeho set-valued causal vazbu nelze touto
     konfliktovou cestou přepsat. Scheduled restart recovery se po
     transientním inventory, identity, repository i runtime failure znovu
     ohraničeně naplánuje.
     Jedna application service vlastní exact loopback provider, durable intent,
     runtime CAS/kompenzaci, append-only apply/rollback, startup rehydrate,
     jediný startup inventory snapshot, sériovou post-listen verifikaci,
     HTTP/chat/registry cutover a commit-layer `model_changed`. Legacy public
     writery nemají produkčního volajícího. Focused sada na skutečné SQLite,
     skutečném runtime portu a test-owned loopback provideru prošla 73/73;
     repository sada včetně dvou Worker isolates s nezávislými WAL connections
     a direct-SQL tamperu prošla 39/39. HTTP `200 started` smí následovat až durable target intent nebo
     binding operation, nikdy pomocný `LEGACY_BASELINE_RECOVERY`. Read-only
     interní application status ukazuje pouze provider command relevantní k aktuální desired
     revision, takže historický `RECONCILED_ABSENT` nepřebije novější binding.
     Non-retryable apply podle 018/Q4/A vyžaduje explicitní HTTP rollback před
     novým apply; chat/Studio rollback surface zůstává `PENDING-OWNER`, takže
     nejde o dokončený UI recovery journey. Backend checkpoint je commitnutý
     a fresh-clone ověřený na `e7d89b5e`; nejde o GPU PASS,
     proof issuance nebo aktivaci automatického failoveru. WS publish zůstává
     podle 018/Q3 best-effort: pouze explicitní typed receipt smí potvrdit
     přijetí. Dnešní produkční void broadcaster proto pravdivě zapisuje
     `RECEIPT_NOT_ISSUED` a stav je degraded; exactly-once doručení bez outboxu
     se netvrdí.
     **Třináctý checkpoint uzavírá append-only identitu na každé SQLite insert
     hranici:** migrace 053 odmítá `INSERT OR REPLACE` kolizi nad proof, event,
     binding operation, application attempt, provider operation, provider
     attempt i no-op receipt/junction journalem. Chrání deklarované klíče i
     skrytý SQLite `rowid`; před první schema mutací odmítne starší journal s
     nekladným pořadím nebo `NULL` TEXT identitou. Preexistující business
     triggery při nesentinelovém authority/identity konfliktu mlčí nezávisle na
     pořadí jejich vytvoření. Sekvence eventů, application attemptů a provider
     attemptů smí přidělit jen databáze. Explicitní `-1` sentinel u jinak
     business-validního řádku vrátí celý statement s vlastněným signálem a bez
     trvalé mutace. Přesné negativní testy
     současně ověřují, že původní řádek zůstane beze změny, a pozitivní
     repository/application cesty zůstávají zelené. Checkpoint nepřidává
     proof issuer, automatic failover, scheduler ani provider efekt. U
     preexistujících kladných rowid/sekvencí nelze zpětně dokázat, zda je
     historicky přidělila DB nebo caller; to je přiznané jednorázové omezení
     upgradu, ne claim migrace. Zdrojový commit `bcc9eb84` prošel `npm ci
     --offline` a celou uvedenou focused/compatibility baterii z `--no-local`
     fresh klonu.
     Následný resource-lifecycle follow-up doplnil záložný úklid 90s legacy
     verify timeru do `finally`; původní success hranice zůstává explicitně po
     přijetí HTTP odpovědi, před parsováním těla. Deterministické regrese nyní
     končí 34/34 místo držení hotového procesu přibližně 90 s. Retry
     policy ani počet provider effectů se tím nemění. Zdrojový commit
     `da03e8bd` prošel offline instalací a focused/compatibility baterií z
     nového `--no-local` klonu; GPU, Ollama ani server nebyly spuštěny.
     Navazující typed-error oprava zachovává veřejný
     `MODEL_FAILOVER_ID_CONFLICT` i poté, co append-only migrace 053 přesunula
     kolizi z SQLite unique constraintu do vlastněného trigger signálu.
     Repository uznává jen osm přesných signal tokenů zakončených `:`;
     libovolný jiný `SQLITE_CONSTRAINT_TRIGGER`, včetně podobného prefixu,
     zůstává `MODEL_FAILOVER_STORAGE_CONTRACT`. Focused test tuto hranici
     mutačně připíná a žádný proof, provider effect ani runtime binding nemění.
     **Čtrnáctý checkpoint zapojuje pouze digest-bound detection:** samostatný
     koordinátor po explicitním literal-true opt-inu používá jeden strict
     loopback inventory snapshot ze stejného provideru jako manual binding.
     Celý snapshot a stabilita sedmi runtime bindingů projdou před prvním
     zápisem; poslední policy check je součástí stejné `BEGIN IMMEDIATE`
     transakce jako každý durable efekt. Koordinátor drží dva frozen detection
     porty — pět repository metod a jedinou inventory metodu — ne plný
     repository/provider.
     Smí pouze poprvé uložit exact
     `CONFIG_DEFAULT` nebo `LEGACY_OVERRIDE` desired baseline podložený jedním
     operationless `LEGACY_UNVERIFIED` compatibility override a
     nad shodnou persisted revision idempotentně vytvořit `DETECTED`.
     Existující desired binding nikdy neposouvá. Empty, malformed nebo
     canonical-ambiguous inventory, unseeded missing, digest/runtime drift,
     manual authority, nevysvětlený override, terminální incident a race
     končí bez aktivace. Produkční pětiminutový poll je recursive
     single-flight, zachovává první dosavadní delay a už nezahazuje výsledek
     přes `.catch(() => {})`. Checkpoint nemá proof, claim, recommendation,
     pull/delete, runtime binding ani broadcast autoritu; automatic
     activation/restore zůstává otevřená.
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
   závislost, mění connector nebo zatahuje effect/auto-exec scope. Akční
   rollback po verification failure navíc čeká na
   [022](docs/decisions/022-m1-studio-operation-bound-rollback.md): dnešní
   role-only route neumí svázat kliknutí s operací, o které uživatel rozhoduje.
8. **Ověření:** `node tests/ws-bridge.test.js`; **NOVÝ:**
   `node tests/m1-studio-client.test.js`; v čistém klonu frozen Yarn install,
   build a registrovaný Studio journey. Build neběží v dirty checkoutu.

#### WP-M1-QUALITY — až po třech konzumentech

1. **Výsledek:** model-backed refinement má právě jednoho vlastníka, nebo je
   na základě naměřené ceny/přínosu výslovně odstraněný; žádná odpověď se
   nerefinuje dvakrát.
2. **Povolené cesty:** synthesis, `src/chat/quality/**`, quality telemetrie,
   převzatý `response-finalizer.js`, fixní corpus a M1 quality testy.
   **Zakázané:** connector, gateway, routes, WS a Studio.
3. **Connector:** pouze čte přijaté Model/Conversation výsledky.
4. **Závislost:** přijaté CHAT, MODEL a STUDIO; běží sériově jako integrace.
5. **Demo:** report A/B se stejným modelem a corpusem, cena všech pokusů a
   reviewovatelná data pro rozhodnutí A-KEEP / B-LIMIT / C-REMOVE.
6. **Test:** aktivní kontrakt přesně odpovídá přijaté variantě; historický GPU
   A/B reportuje p50/p95, score delta, acceptance rate, tokeny a dobu.
7. **Stop:** metrika nerozliší kvalitu, corpus nemá přijatá chování, je nutná
   změna connectoru nebo GPU prerekvizita není bezpečná.
8. **Ověření:** `node tests/improvement-loops.test.js`,
   `node tests/chat-output-quality.test.js`,
   `node tests/chat-synthesis-hardening.test.js`; **NOVÝ:**
   `node tests/m1-quality-contract.test.js`; GPU A/B pouze sériově.

**Stav 2026-08-23:** historická implementace jednoho ownera a offline
acceptance vznikly na `759bcad0`; fyzické měřidlo bylo uzavřené na `20f61f2e`.
Operátor následně přijal [Decision 024](docs/decisions/024-m1-refinement-disposition.md)
`C-REMOVE`. Produkční `response-finalizer.js` proto už nespouští modelový
rewrite a persistuje přesně synthesis výsledek. Synthesis drží pouze bounded
retry a deterministické gate. Scorer a quality telemetry zůstávají, ale
telemetrie pravdivě uvádí `refinementDisposition=removed`, nulového ownera,
nulový pokus, latenci i tokeny. Fyzický A/B je zachovaný jako historický
rozhodovací experiment; krátká správná FACTUAL odpověď se score 59 je vedená
jako samostatný neblokující [finding 011](docs/findings/011-response-scorer-short-factual-calibration.md).
Implementace C a focused closeout jsou v `4b20a5dd`; B5 je `PASS/CLOSED`.

Fyzické A/B už není blokované prostředím. Po opravě příliš absolutního
compute preflightu na relativní non-Ollama baseline proběhl registrovaný run
`m1-b5-quality-ab-20f61f2e-20260823` na clean `20f61f2e`. Bezpečnost, 100% GPU
residency, headroom, corpus chování i přirozený restore prošly, ale quality
acceptance skončila **FAIL**: 2 pokusy, 0 accepted, 2 rejected, applied delta
0 za 1 027 tokenů a 14 291 ms. DNS odmítl lexikální Jaccard guard, nikoli
sémantická metrika; Praha byla false-positive scoreru a model vrátil totožný
text. Gate 2 disposition už není blokovaný: operátor přijal `C-REMOVE`.
Po focused ověření implementace se B5 uzavírá a otevírá B6. Exact evidence je v
[`wp-m1-quality-report.md`](docs/execution/runs/wp-m1-quality-report.md) a
varianty Gate 2 v [024](docs/decisions/024-m1-refinement-disposition.md).

### Povinné scénáře

1. deterministická odpověď bez modelu přes skutečný request;
2. modelová odpověď přes lokální Ollamu;
3. nedostupný provider jako selhání, ne uložený assistant turn se statusem OK;
4. cancel před, během a těsně před persistencí;
5. restart a obnovení konverzace;
6. skill/expertise confirmation patří tomu subsystému, který se právě ptal;
7. Studio ukáže progress a přesný konečný stav.

### Doložení povinných scénářů, 2026-08-22

Změřeno na `74ca2fa7`. Scénáře 3, 4 a 6 nevyžadovaly nový kód — pokrývaly je
registrované sady, které jen nikdy neběžely nebo se nikdy nenamapovaly.

| # | Scénář | Stav | Důkaz |
|---|---|---|---|
| 1 | deterministická odpověď bez modelu | **doloženo** | 40 / 39 / 49 ms, `classifiedBy: deterministic`, `localComputation: true`; i z čerstvého klonu |
| 2 | modelová odpověď přes lokální Ollamu | **doloženo** | `qwen3.5:27b`, 53,7 s; i z čerstvého klonu |
| 3 | nedostupný provider ≠ uložený OK turn | **doloženo** | `m1-chat-contract`, `llm-gateway-runtime-signal`, `capability-01-server-behaviours` — zelené v deterministickém gate na `f5d0771f`; aserce doslovné: „persistence exception is a typed terminal error, never false-success", „provider, persistence, and generic failures are valid non-success terminals", „empty controller output fails closed as a contract error terminal" |
| 4 | cancel před / během / těsně před persistencí | **doloženo** | Tytéž sady pokrývají všechny tři okamžiky: „pre-cancelled request cannot persist an assistant turn", „cancellation during request processing cannot persist an assistant turn", „non-cooperative handler cannot turn an aborted request into late success". Navíc `chat-pipeline` (profil `model`, nikdy neběžel) **PASS** přes běhový režim |
| 5 | restart a obnovení konverzace | **doloženo** | 4 zprávy před restartem i po něm; i z čerstvého klonu |
| 6 | confirmation patří tomu, kdo se ptal | **doloženo** | `confirmation-ownership` 5/5. Regrese z 2026-08-02: skill se zeptal „Potvrdit spuštění?", uživatel řekl „ano" a upgrade-approval intercept to snědl a přebindoval CHAT |
| 7 | Studio ukáže progress a přesný konečný stav | **doloženo** | `studio-electron-boundary` → `STUDIO_ELECTRON_BOUNDARY_PASS` na `2a3acdbf`. Nulový egress (`externalAttempts: 0`, `otherLoopbackAttempts: 0`), 65,8 s soak, boundary matice 403/403/200, deterministický turn přes WebSocket s `modelProviderRequestsDuringTurn: 0` a `forbiddenEffects: 0`, čisté ukončení obou procesů s `processGroupsClean` |

**Všech sedm povinných scénářů M1 je doložených.** Finální sjednocená B6
evidence na clean standalone source `d518d7ec2156…` je navíc provedla v jedné
fresh-install obálce přes skutečný server/SQLite/Ollamu a shipped Electron
build. Controlled backend byl použit jen pro reprodukovatelné error/cancel/
reconnect terminály. Report je v
[`m1-b6-fresh-install-20260823.md`](docs/execution/runs/m1-b6-fresh-install-20260823.md).

### L3 cíle a exit

**Změřeno 2026-08-22 na `8310b821`**, sériově proti živému serveru — detail
v [`docs/execution/runs/m1-l3-measurement-20260822.md`](docs/execution/runs/m1-l3-measurement-20260822.md):
deterministika p50 `2,77 ms` / p95 `31,6 ms` (12/12 klasifikováno `LOCAL`),
modelový chat cold `64,1 s`, warm p50 `30,1 s` / p95 `35,9 s`, throughput
`1,96 turnu/min`, nula provider errors. Historický refinement pokus přidal
1 027 tokenů a 14 291 ms při nulovém aplikovaném zisku. Po přijatém
`C-REMOVE` je produkční post-answer refinement delta konstrukčně přesně nula
volání, tokenů i milisekund; scorer zůstává jen telemetrií.

**B6 current-source měření 2026-08-23:** 20 HTTP deterministických vzorků mělo
p50 `1 ms`, nearest-rank p95 `34 ms` a transparentní cold max `114 ms`.
Modelový HTTP chat měl cold `51,2 s`, warm p95 `55,3 s` a throughput `1,11`
turnu/min; literal Studio model turn trval `52,3 s`. Exact `qwen3.5:27b`
provider audit měl 8 chat requestů, `num_ctx` pouze `1024/4096`, nula
refinement promptů a Studio nula neočekávaných outbound requestů.

- p95 deterministické odpovědi pod **100 ms** na referenčním stroji;
- warm/cold whole-response latence se změří odděleně; pokud operátor přijme
  streaming do scope M1, změří se i time-to-first-token a schválí jeho budget;
- p95 modelového chatu, throughput a refinement delta jsou změřené, ne odhadnuté;
- žádný false-success při provider error/cancel/timeout;
- Studio + WS + persistence journey projde po čerstvé instalaci;
- během základního scénáře nevznikne neočekávaný outbound.

Streaming zůstává samostatné produktové rozhodnutí. Pokud jej operátor přijme,
smí se zavést až po přijetí `ModelRequest/Result`, `ConversationCommand/Result`
a `CoreEvent`, protože sahá přes všechny tři. Refinement byl podle fixního
fyzického A/B a Decision 024 odstraněný. Jeho případný návrat vyžaduje nový
sémantický guard, uložený candidate text, širší přijatý corpus a nové
operátorské rozhodnutí.

## 6. M2 — Řízená práce nad projektem

### Výsledek

Uživatel otevře existující Git projekt, požádá o malou změnu, uvidí plán a
přesně vymezené approvaly, IntentSmith provede atomickou změnu, spustí focused
test a ukáže diff, stav a audit.

### Závislosti

M1 runtime páteř a stabilní `ConversationCommand/Result`. Vlastník effect
brokeru nejprve vytvoří a připne `EffectRequest/Result` a `ApprovalGrant`;
teprve jejich konzumenti smějí implementovat efektové cesty.

### Mobilní companion není M2, ale připravuje mu půdu

**Výklad operátora, 2026-08-21.** Mobilní aplikace je **vedlejší větev
a vlastní produkt** — netýká se přímo IntentSmithu, ale musí s ním komunikovat.
Právě ta komunikační část je důvod, proč na větvi
`wp/mobile-prototype-20260817` vznikají commity s prefixem `m2`.

**Není to zahájení M2.** Vývoj mobilu narazil na otázky, které M2 stejně čekají
— vlastnictví zápisu, rozhodovací rovina, approval hranice. Řeší se dřív
a mimo, aby M2 nezačínalo s nesrovnalostmi a neřešilo je až za běhu. Fakticky
jsou to **prerekvizity**, ne exekuce milníku.

V době této mobilní prerekvizity zůstával stav M2 `NOT_STARTED` a jeho vstupem
bylo přijaté M1. Prefix `m2` na mobilní větvi proto dál čti jako „hranice vůči
M2", ne jako důkaz, že na ní M2 běží.

**Stav 2026-08-24:** po přijetí M1 na `44a9ba87` operátor spustil vlastní M2.
První path-authority řez prošel původním nezávislým re-review na `8f31e34f`;
navazující N1–N3 a Opus hardening jsou implementačně zelené na `7dc6a807`, ale
nově požadovaný Opus `--effort max` verdict blokuje účtový spend limit. Stejný
review blocker má implementačně zelený `ProjectContextQuery/Snapshot` na
`5e19b825`. Effect authority a první skutečný filesystem-write consumer jsou
integrovány a po interním `CHANGES_REQUIRED` auditu opraveny na `ad4d7eb3`:
authority je durable, approval subject-bound a single-use, execution má
claim/recovery a canonical `file.write` fail-closed končí před efektem. Registry
má 407 programů, fingerprint `43de5e61…`, focused sady i artifact testy jsou
zelené. Connector přesto zůstává `CANDIDATE_V1` a žádný z těchto tří oddílů
není označen hotově, dokud příslušný Opus review nevrátí `REVIEW_PASSED`.
Oddíl 4 byl po interním `CHANGES_REQUESTED` auditu remediován na `a8a37b40`:
durable `ToolRequest/ToolResult` nyní vlastní exact append-only vazbu na
`EffectRequest`, terminal se projektuje jen z canonical `EffectResult`, approval
se přes reconnect settluje bez druhého observe a skutečný LOCAL `file.write`
už broker neobchází. Adapter throw/hang/cancel/timeout, mixed authority denial,
database unavailable, SQL forge i circuit-open bypass mají negativní proby.
Web, file read, exec a
database zůstávají pravdivě secure-unavailable; nejsou vydávány za hotové
providery. Registry má 411 programů a fingerprint `a5688cc4…`, module graph
1 093 hran bez růstu cyklů. Deterministický gate na `d172cc0f` zůstal pravdivě
`FAIL` s `247 PASS / 3 FAIL / 2 BLOCKED` a přesně baseline non-PASS množinou.
Connector dál zůstává `CANDIDATE_V1 / CHANGES_REQUESTED`, dokud Opus max
nevrátí `REVIEW_PASSED`. Oddíl 5 je implementačně zelený na `08d249ad`:
`ProjectChangeRequest/Result` váže úplnou sadu forward/rollback/test/Git
authority, SQLite 078 drží immutable material, approval set, lease fencing,
journal a terminal truth, focused test běží bez fallbacku v read-only
`bwrap` sandboxu a exact Git provider zachovává foreign staged/unstaged/untracked
stav. Skutečný `SIGKILL` před i po aktualizaci indexu, restart generation 2,
approval crash window, rollback, drift, pathspec magic a LF filename mají
negativní proby. Vlastní sady mají 22/22, 13/13, 10/10, 11/11 a 10/10 PASS.
Registry má 416 programů, fingerprint `318e38d8…`; aktuální module graph má 1 098 hran,
stále 3 cykly s membership 28 souborů. Oddíl 5 zůstává
`CANDIDATE_V1 / REVIEW_PENDING`. Deterministický gate na `181bb0cd` zůstal
pravdivě `FAIL` s `249 PASS / 3 FAIL / 2 BLOCKED`, nulovým timeoutem a přesně
nezměněnou baseline non-PASS množinou. Oddíl 6 má implementační kandidát
`5e6f25f7`: exact governance policy/decision/receipt a lifecycle
plan/approval/terminal kontrakty, deterministic governance evaluator,
proposal compiler, SQLite migraci 079, durable repository a application service,
skutečné start/approve/cancel/status HTTP hranice, Studio ovládání a karanténu
legacy lifecycle mutátorů. Focused sady mají dohromady 103/103 PASS a relevantní
M1/Studio/chat regrese 459/459 PASS; schema migrace mají 38/38, M1 failover
schema 20/20 a artifact validation 154/154. Registry má 426 programů,
fingerprint `5796d25d…`; aktuální module graph má 1 116 hran, stále 3 cykly
s membership 28 souborů. Oddíl 6 zůstává `IMPLEMENTED / REVIEW_REQUIRED`, dokud
Opus `--effort max` review nevrátí `REVIEW_PASSED`. Deterministický gate na
`01055661` zůstal pravdivě `FAIL` s `258 PASS / 3 FAIL / 2 BLOCKED`, nulovým
timeoutem a přesně nezměněnou baseline non-PASS množinou; žádná M2 sada
neselhala. Oddíl 7 má implementační kandidát `a7d4ce3d`: exact verzované
`RemoteCorePortDescriptor`, `RemoteCoreHello` a `RemoteCoreNegotiation`, strict
capability negotiation pro sedm remote tříd, explicitní unavailable provider a
negativní fyzickou hranici proti serveru, routes, DB, network, WS a legacy
listeneru. Focused sady mají 17/17 a 10/10 PASS, relevantní regrese 169/169
PASS a module ratchet zůstává 13/13 na přesných 1 116 hranách, 3 cyklech a 28
cyklických souborech. Registry má 428 programů, fingerprint `c487692d…`.
Oddíl 7 zůstává `IMPLEMENTATION_GREEN / REVIEW_REQUIRED`; listener, pairing,
authentication, device authority a remote runtime nevznikly. Celý M2 jako celek
není PASS. Deterministický gate na `d415e6d7` zůstal pravdivě `FAIL` s
`260 PASS / 3 FAIL / 2 BLOCKED`, nulovým timeoutem a přesně nezměněnou baseline
non-PASS množinou; obě nové remote sady prošly. Přijetí čeká, dokud všech sedm
exact-scope Opus `--effort max` review nevrátí `REVIEW_PASSED` a integrační
closeout nezůstane bez nové produktové regrese.

Následný cross-section bezpečnostní audit našel HIGH mezeru v section-5
`linux-bwrap-ro-v1`: read-only bind celého host rootu blokoval běžný zápis, ale
nezabránil čtení mimo projekt ani efektu přes pathname Unix socket. Oprava na
`05c5a856` zavádí `linux-bwrap-ro-v2` s prázdným mount rootem, pouze minimálním
runtime a exact project/binary bindy, read-only scaffoldingem, zákazem dalších
user namespaces a seccomp filtrem pro socket/connect, kernel keyring a
`io_uring_setup`. Reálné outside- i inside-project host-socket proby skončily
bez spojení; process supervision je 13/13, project change 10/10, Git
preservation 10/10 a úplná lifecycle application journey 4/4 PASS. Všech deset
lifecycle/governance sad bylo znovu zelených. Registry zůstává na 428
programech a 14 exclusions; po aktualizaci přesných `lastGreen` má fingerprint
`54dce9be…`. Tento hardening nerovná se Opus review ani M2 PASS a vyžaduje nový
clean gate nad committed evidence. Ten následně proběhl na `0046cd9d`:
report `2026-08-24T09-09-50-584Z` má pravdivý celkový `verdict: FAIL`,
`exitCode: 1`, přesně `260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT` a stejných
pět baseline non-PASS ID. Všech 27 vybraných M2 programů prošlo; čtyři
toolchain `soak` journey zůstaly samostatně zelené. Nevznikla M2 regrese, ale
M2 stále čeká na sedm finálních Opus max PASS.

Section-2 semantic audit byl následně remediován na `60d39810`: approval grant
constraints jsou společná contract/repository/SQLite authority, non-success
filesystem results jsou svázané s exact target/rollback truth, reconnect drží
durable conversation identity, restart orphan uvádí target, provider hash je
byte-exact a navazující project-change child result přiznává applied/ambiguous
write. Zpřísnění odhalilo neplatný broker failure fixture; po jeho čistě testové
korekci `64e0583a` doběhl celý gate s pravdivým `verdict: FAIL`, `exitCode: 1`,
`260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT` a přesně nezměněnými baseline ID.
To stále není Opus verdict ani M2 PASS.

Operátor následně přijal [Decision 030](docs/decisions/030-m2-closeout-authority.md),
která nahrazuje dřívější požadavek na sedm Opus review: finální nezávislé review
všech sedmi připnutých řezů provádí operátor. Zjednodušený proces 1B nemění
bezpečnostní gate — `CHANGES_REQUESTED` vrací řez do práce a celý M2 lze zavřít
teprve po operátorově `REVIEW_PASSED` bez nové regrese.

Navazující section-2 closeout hardening přidává migraci 082 pro pravdivé
`cancelled / APPROVAL_GRANT_EXPIRED|REVOKED` terminály pouze nad
nespotřebovaným grantem bez execution claimu. UNIQUE nonce/effect a single-use
hranice se nerozvolnily; nový skutečný pokus používá explicitní novou operation
generaci, zatímco reconnect stejné generace zůstává exact replay. Migrace 083
přidává append-only rollback observation receipts a jednotný settlement read
model. `matches_forward` a prokazatelné `matches_before` uzavírají účetní dluh,
`foreign` jej ponechává; runtime nikdy nekompenzuje standalone soubor a efekty
z `m2_execution_files` jsou z této authority vyloučené. Focused evidence je
effect repository 49/49, file runtime 10/10 a schema migrations 38/38; navazující
project-change 20/20, execution repository 13/13 a lifecycle journey 6/6 jsou
beze změny zelené. Přijatý module graph má 1 131 hran, stále 3 cykly a 28
souborů v cyklech. Stav je `IMPLEMENTATION_GREEN / REVIEW_PENDING`, ne M2 PASS.

První skutečný section-5 Opus max review následně proběhl a vrátil
`CHANGES_REQUESTED`, nikoli PASS. HIGH nález prokázal, že legitimní změna mimo
`ContextFilePolicy@1` source set po správném write/test/Git skončila výjimkou
bez terminalu a po restartu falešným orphaned/failed rollbackem. MEDIUM nález
prokázal whole-file RSS a jeden Git subprocess na každou foreign dirty cestu.
Oprava na `5d9b53c0` odděluje exact write proof od policy-limited revision,
terminalizuje observer failure, přidává skutečný `deploy.cfg` immediate i
SIGKILL recovery journey a používá jeden batched index read plus 64KiB
streaming hash. Focused výsledky jsou nově project change 14/14, Git 12/12,
governance 20/20 a lifecycle 5/5 PASS. Čistý gate na `5d9b53c0`, run
`2026-08-24T09-49-09-778Z`, zůstává pravdivě `FAIL / exitCode 1` s přesně
`260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT` a nezměněnou baseline non-PASS
množinou. Section 5 čeká na exact-scope Opus re-review; M2 stále nemá žádný
finální Opus PASS.

První re-review oba předchozí nálezy uzavřel, ale znovu vrátil
`CHANGES_REQUESTED`: focused test mohl po readbacku nahradit target symlinkem a
runtime přesto false-succeed; directory/symlink mismatch navíc vyhazoval z
rollback/recovery bez terminalu. `816c5b14` proto provádí final exact
after-image re-proof až po Git/revision observerech a všechny path-authority
výjimky klasifikuje jako foreign evidence. Čtyři symlink kombinace
(manifest/non-manifest × Git ano/ne), adresář, generation-2 takeover, opakovaný
restart i produkční lifecycle census jsou zelené. Runtime je 17/17, lifecycle
6/6, celý gate na `816c5b14` je pravdivě `FAIL / 260 PASS / 3 FAIL / 2 BLOCKED`
bez M2 non-PASS. Section 5 čeká na třetí Opus max kolo a stále není PASS.

Následný current-byte audit oddílu 2 uzavřel semantic authority grantu a
filesystem výsledku: migrace 080 odmítá podvržené grant constraints i přes
přímé SQL, reconnect identity již nezávisí na websocket session a applied
write/readback failure zůstává orphaned s rollback evidencí. Aktuální module graph má 1 117 hran,
stále 3 cykly a 28 souborů v cyklech; explicitně přijatá
nová hrana je pouze migrace 080 → effect-core fingerprint helper. Oddíl 2 je
implementačně zelený, ale bez Opus max `REVIEW_PASSED` zůstává kandidátem.

Decision 030 tento historický review požadavek nahrazuje operátorským review
přesných finálních bajtů. Closeout řez proto mechanicky přepíná všech sedm
veřejných M2 stage markerů — ProjectContext, Effect, Tool, Execution,
Governance, Lifecycle a RemoteCorePort — na `PINNED_V1`. Připnutí není
acceptance: všech sedm section balíků i integrační closeout zůstávají
`OPERATOR_REVIEW_PENDING`, dokud operátor nevydá `REVIEW_PASSED` bez nové
regrese.

**Stav 2026-08-25 — `ACCEPTED / CLOSEOUT_PASS`.** Operátor provedl nezávislé
review přesného product targetu `c070ed73` a vrátil `7/7 REVIEW_PASSED` bez
blockeru. Čtyři neblokující follow-upy jsou v Finding 012 a nemění přijaté
product bajty. Finální clean closeout gate na `cea9b202`, run
`2026-08-25T20-21-48-818Z`, zůstal pravdivě `verdict: FAIL / exitCode: 1` s
přesně přijatým zděděným baseline
`260 PASS / 3 FAIL / 2 BLOCKED / 0 TIMEOUT / 0 SKIPPED`; všech 27 vybraných M2
programů prošlo a non-PASS množina se nezměnila. Registry má 428 programů a
fingerprint `388d9324…`, schema `38/38`, M1 schema compatibility `20/20`,
module ratchet `13/13` a artifact validation `154/154`. Remote scope zůstává
pravdivě contract-only: listener, pairing, autentizace, device authority ani
remote runtime nejsou součástí M2. M3 a M4 jsou tímto vstupně odblokované;
project-bound symbol index zůstává explicitní post-M2 follow-up. Nic nebylo
pushnuto.

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

Implementační stav k 2026-08-26: všech šest povinných řezů a sjednocený
closeout jsou `ACCEPTED / REVIEW_PASSED`. Registry má 438 programů
a fingerprint `ca2aa642…`; aktuální module graph má 1 150 hran, stále 3 cykly
a 28 souborů v cyklech. Čerstvý úplný běh skončil pravdivě
`268 PASS / 2 FAIL / 2 BLOCKED`; žádný nový M3 non-PASS nevznikl. Oddíly
1–6 mají operátorské `REVIEW_PASSED`; oprava oddílu 7 odstavila legacy
agent mutátory typovaným HTTP 410 a připnula scheduler k M3 extension authority.
Oddíl 7 má po operátorském re-review `REVIEW_PASSED`; všech sedm oddílů je tím
přijatých. Evidence je v
[`m3-closeout-20260826.md`](docs/execution/runs/m3-closeout-20260826.md) a
operátorská matice v
[`2026-08-26-M3-OPERATOR-REVIEW-MATRIX.md`](docs/review/2026-08-26-M3-OPERATOR-REVIEW-MATRIX.md);
finální výsledek oddílu 7 je v
[`2026-08-26-M3-SECTION-7-OPERATOR-REVIEW-RESULT.md`](docs/review/2026-08-26-M3-SECTION-7-OPERATOR-REVIEW-RESULT.md).

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

**Přijatý stav 2026-08-26:** první úplná M4 smyčka je
`ACCEPTED / REVIEW_PASSED` na exact product candidatu `286f5ba8`. Contract V1, append-only authority,
same-project producer, HTTP/Studio user gate, verzovaný ProjectLearningContext,
SPEC-planner konzument, durable baseline/observed artifacty, měření a první
lokální integrační E2E jsou popsány v
[`WP-M4-OBSERVATION-V1.md`](docs/wp/WP-M4-OBSERVATION-V1.md). E2E nad reálnou
SQLite a deterministickým fake plannerem prokázalo dvě nezávislé schválené
změny → pending proposal → explicitní approval → context injection → exact
plan conformance `0 → 10000` → rollback → delete. Nejde o modelový quality
benchmark ani o nezávislé review. Autoritativní module graph má 1 165 hran,
stále 3 cykly a 28 souborů v cyklech; outcome řez je product commit `885cf959`
a jeho jediná nová authority hrana byla explicitně přijata v `bd5eada6`.
Úplný deterministický run `2026-08-26T08-52-35-050Z` na source `286f5ba8`
skončil pravdivě `FAIL` / exit `1`, ale přesně zděděným baseline
`276 PASS / 2 FAIL / 2 BLOCKED / 0 TIMEOUT`; všech osm M4 programů prošlo a
žádný nový non-PASS nevznikl. Sjednocený closeout je v
[`m4-closeout-20260826.md`](docs/execution/runs/m4-closeout-20260826.md) a sedm
review řezů v
[`2026-08-26-M4-OPERATOR-REVIEW-MATRIX.md`](docs/review/2026-08-26-M4-OPERATOR-REVIEW-MATRIX.md).
Operátorské review všech sedmi oddílů skončilo bez blockeru a je
svázané v
[`2026-08-26-M4-OPERATOR-REVIEW-RESULT.md`](docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md).
M3 oddíl 7 tím uzavřen nebyl.

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

**Průběžný stav 2026-08-29:**
`8/9 REVIEW_PASSED / PRIVACY REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED /
ACCEPTANCE_BLOCKED / OPERATOR_REMEDIATION_REQUIRED / M6_GATE_CLOSED`.
Re-review exact kandidáta
`816a2a4c8a95b49d46f06b94b56feb64c8a40c90` přijalo DATA, AUTH a PERF vedle
pěti dříve přijatých oddílů. PRIVACY zůstává otevřené: veřejná globální auth
funkce dovolovala same-process callerovi dodat očekávanou i prezentovanou local
capability a vyrobit subject, který privacy writer uznal. Remediation se váže
na product commit `665b42c8`: raw mint už není veřejný, HTTP, WS a privacy
repository sdílí jedinou per-bootstrap autoritu a DB writer odmítne druhý
verifier. Tato oprava je historický předstupeň. Decision 041 candidate
`73fdf836` následně dostal `CHANGES_REQUIRED` kvůli přesným UTF-8 bytes,
restartovým UDF, expected bindings a Git-lineage mezerám. Jejich remediation
je implementovaná na `95a2cd6c`, `4beced1b` a `2b5da617`, ale nové
operátorské re-review exact kandidatu `75498c69` znovu skončilo
`CHANGES_REQUIRED`: SQLite ztrácelo bajtovou identitu přes `TEXT` a Git boundary
neviděla dočasnou produktovou změnu následovanou revertem. Remediation
`8632c490` přidává exact BLOB read, per-commit/per-parent a per-receipt historii,
zakazuje merge a odmítá replace refs, grafts a skryté index flags. Třetí review
kandidatu `37edf30d` skončil `REVIEW_PASSED`. Autorizovaná ceremonie následně
připnula čtyři veřejné Ed25519 role. Úzký review kandidatu `d81be45f` ale našel,
že M5-R19 srovnal jen model-failover test, zatímco M6 upgrade kontrakt zůstal na
79 a reálný upgrade skončil `80 !== 79`. Oracle remediation je v
integrovaném kandidátu navíc převázaná na jeho 87 migrací,
ale custody všech privátních klíčů na stejném online `/home` svazku zůstává
`CHANGES_REQUIRED`.
`WP-M5-PACKAGE` má review remediation implementovanou na product commitu
`8be0094d`; druhé review oddíl označilo `REVIEW_PASSED`. `--verify-only` při
cizím Node majoru pouze zapíše chybu a nikdy
nevolá ani nesourcuje NVM. Upgrade návod odkazuje na skutečný storage dokument,
provádí backup před shutdownem a používá reálný `/api/health`; smoke test tyto
odkazy, příkazy a route váže na strom. Původní exact fresh clone na `ce6b8276`
zůstává historickým důkazem nezměněné instalační větve, ne finálním candidate
důkazem. Remediation je v
[`m5-package-observe-remediation-20260826.md`](docs/execution/runs/m5-package-observe-remediation-20260826.md);
původní report zůstává v
[`m5-package-20260826.md`](docs/execution/runs/m5-package-20260826.md).
`WP-M5-DATA` má review remediation implementovanou na product commitu
`bcfa5c8d`; druhé review jej znovu otevřelo a navazující remediation je na
`c3170a12`. Oddíl zůstává `RE_REVIEW_REQUIRED`. Backup nyní publikuje snapshot
jen po exact úplném `wal_checkpoint(TRUNCATE)`. Restore vlastní celý
`c3.db/c3.db-wal/c3.db-shm` file-set, před výměnou vytváří durable safety
snapshot a nepřehraje novější stale WAL. Restore-lock identita i cílený Linux
`fuser` holder census jsou fail-closed pro unknown/unreadable stav; stale
cleanup používá karanténu a opakované inode/token ověření místo check→unlink.
Shared OS lease pokrývá celou skutečnou životnost SQLite spojení a exclusive
lease celý restore; produkční `fuser` census rozliší prokázané closed od
diagnostického/permission/unknown stavu fail-closed.
Focused DATA sada na evidence source prošla 17/17 a storage compatibility
34/34.
Nové adversariální regrese a širší kompatibilita jsou v
[`m5-data-remediation-20260826.md`](docs/execution/runs/m5-data-remediation-20260826.md);
původní round-trip důkaz zůstává v
[`m5-data-20260826.md`](docs/execution/runs/m5-data-20260826.md).
`WP-M5-AUTH` má review remediation implementovanou na product commitu
`122b5df5`; druhé review jej znovu otevřelo a tri-state WS remediation je na
`dc6e9b12`. Oddíl zůstává `RE_REVIEW_REQUIRED`. Jediný guard běží za
exact route matchem a před každým handlerem; veřejné jsou pouze tři health/root
GET klíče. Studio používá existující private per-process capability, admin/CLI
timing-safe token a vydané API tokeny route-class scopes. Production HTTP bez
credentialu končí 401, nedostatečný scope 403. WS provádí stejnou kontrolu při
upgradu a do session předává pouze transportem vytvořený immutable subject.
WS nyní zachovává všechny transportní credentials a tri-state parser odmítne
malformed, duplicate i mixed local/admin/bearer kombinaci před identity binding.
Native production loopback bez credentialu už není bypass. Focused AUTH sada
prošla 12/12 a WebSocket compatibility 87/87. Remediation důkaz je v
[`m5-auth-outbound-remote-remediation-20260826.md`](docs/execution/runs/m5-auth-outbound-remote-remediation-20260826.md);
původní black-box report zůstává v
[`m5-auth-20260826.md`](docs/execution/runs/m5-auth-20260826.md).
`WP-M5-PROCESS` má review remediation implementovanou na product commitu
`7a282a3f`; druhé review oddíl označilo `REVIEW_PASSED`. Provider orphan/unknown bez
empty důkazu už nevytvoří `process_terminated`, parent terminal ani rollback;
outstanding fence zachová after-image až do restartové recovery. Approval
existujícího plánu je stejně jako prepare a interní effect-start blokované do
úplného startup censu. Restartová signal authority je `linux-pidfd-v1`: pidfd
zůstává otevřený od nového identity checku přes TERM/KILL až po empty census,
takže numerický PID/PGID nelze vyměnit mezi kontrolou a signálem. Autoritativní
module graph má po subject-attestation hraně 1 187 hran, 3 cykly a 28 souborů v cyklech.
Remediation důkaz je v
[`m5-process-remediation-20260826.md`](docs/execution/runs/m5-process-remediation-20260826.md);
původní report zůstává v
[`m5-process-20260826.md`](docs/execution/runs/m5-process-20260826.md).
`WP-M5-OBSERVE` má review remediation implementovanou na product commitu
`8be0094d`; druhé review oddíl označilo `REVIEW_PASSED`.
Každý HTTP request má serverovou identitu; známé M2 request/lifecycle/run
identity se korelují do bezpečného completion recordu a response headers.
Failure taxonomy, bounded failure ledger a autentizovaný diagnostický endpoint
neukládají libovolné payloady ani credential hodnoty. Veřejný health nyní
pravdivě degraduje při nečitelné DB nebo neúplném startup recovery censu a
všechny tři aliasy používají jediný produkční handler. `close` bez `finish`
finalizuje request vždy jako aborted i při `writableEnded=true`; exact-once
latch zachová normální `finish → close` jako jediný success. Autoritativní
module graph má 1 187 hran, stále 3 cykly a 28 souborů v cyklech. Remediation
důkaz je v
[`m5-package-observe-remediation-20260826.md`](docs/execution/runs/m5-package-observe-remediation-20260826.md);
původní report zůstává v
[`m5-observe-20260826.md`](docs/execution/runs/m5-observe-20260826.md).
`WP-M5-OUTBOUND` má review remediation implementovanou na product commitu
`122b5df5`; druhé review oddíl označilo `REVIEW_PASSED`.
Produkční proces instaluje před optional/background službami jediný global
`fetch` guard a i loopback transport používá `redirect: manual`. Každá
`Location` dostane nové policy rozhodnutí. Privátní model-discovery capability
není exportovaná; exact wrapper ověřuje konkrétní path/query/header/body/method
profily pro Ollama, Hugging Face a WhatLLM. Opsaný scope literal je neúčinný.
Audit migrace 089 neukládá URL path/query, body, header ani credential hodnoty.
Autoritativní module graph má 1 187 hran, stále 3 cykly a 28 souborů v cyklech.
Remediation důkaz je v
[`m5-auth-outbound-remote-remediation-20260826.md`](docs/execution/runs/m5-auth-outbound-remote-remediation-20260826.md);
původní report zůstává v
[`m5-outbound-20260826.md`](docs/execution/runs/m5-outbound-20260826.md).
`WP-M5-PERF` má první review remediation na product commitu `034e00f5`;
druhé review jej znovu otevřelo a navazující remediation je na `b020ee19`.
Společný exact candidate je `816a2a4c`. Oddíl zůstává `RE_REVIEW_REQUIRED`.
`M5PerformanceEvidence@3`
váže raw v2 vzorky přes SHA-256/byte count a kandidát přes exact commit/tree.
Runner před i po měření vyžaduje stejný čistý HEAD; raw i envelope publikuje
private, durable a bez možnosti clobberu. Historické baseline už nenesou
callerem dodané metriky: exact parser je odvozuje z Git blobů připnutých revision,
cestou, blob OID a SHA-256. Nepodložené Studio soak/install+build hodnoty byly
staženy, nikoli přebarveny. GPU stav už není tvrzení v envelope: raw povinně
nese buď přesné měření, nebo read-only census receipt a typovaný `NOT_RUN`.
Nečitelný, chybějící nebo nulový RSS je measurement failure. Autoritativní
pětiminutový běh nad exact candidate `816a2a4c` naměřil 40/40 deterministic
HTTP s p95 `5,022 ms`, 40/40 ProjectContext s p95 `32,769 ms` a soak
`1 498/1 498` za `300 074 ms`, p95 `14,314 ms`, 0 chyb a peak RSS
`171,859 MiB`. Raw GPU stav je `not_run_not_requested` s dostupným prázdným
`nvidia-smi` censusem; fyzické GPU měření nebylo provedeno.
Remediation důkaz je v
[`m5-perf-remediation-20260826.md`](docs/execution/runs/m5-perf-remediation-20260826.md);
exact-candidate důkaz je v
[`m5-second-review-remediation-closeout-20260827.md`](docs/execution/runs/m5-second-review-remediation-closeout-20260827.md);
původní report zůstává označený `SUPERSEDED / REVIEW_CHANGES_REQUESTED`.

`WP-M5-REMOTE-PORT` a `WP-M5-CONDITIONAL-SURFACES` mají review remediation
implementovanou na product commitu `122b5df5`; druhé review oba oddíly označilo
`REVIEW_PASSED`. In-process adaptér nabízí
jen exact `conversations@1` a `projects@1`; pět capability bez úplného payload
kontraktu zůstává explicitně unavailable. Úspěšný project snapshot musí sedět
na requestový revision, normalizovaný query a všechny budget limity;
listener/pairing/auth patří M7.
Produkční conditional set obsahuje pouze podporovaný model discovery journey;
external notifications, marketplace, ComfyUI a core updater jsou defaultně
vypnuté, unsupported a jejich explicitní produkční zapnutí selže při startupu.
Preflight i všech pět runtime startupů používá jediný normalizovaný manifest.
Autoritativní module graph má 1 187 hran, stále 3 cykly a 28 souborů v cyklech.
Remediation důkaz je v
[`m5-auth-outbound-remote-remediation-20260826.md`](docs/execution/runs/m5-auth-outbound-remote-remediation-20260826.md);
původní report zůstává v
[`m5-remote-conditional-20260826.md`](docs/execution/runs/m5-remote-conditional-20260826.md).

`WP-M5-PRIVACY` má po několika review kolech poslední nezávislý verdict
`CHANGES_REQUIRED` kvůli neúplnému M5-R19 migration oracle a custody klíčů.
Decision 041 byte/history implementace nad candidatem `37edf30d` má
`REVIEW_PASSED`; trust store připíná čtyři oddělené veřejné role. Stale M6
upgrade oracle 79 byl na M5 kandidátu opravený na 80 a po modelové integraci
znovu převázaný na jejích skutečných 87 migrací, ale privátní klíče zůstávají
nešifrované na stejném online svazku. Oddíl zůstává `RE_REVIEW_REQUIRED`.
Migrace 090
odstraňuje známé plaintext credential klíče z `user_settings` a migrace 091
navíc vyžaduje pro každý rotation/history INSERT transportem autentizovanou
subject identitu až na SQL triggeru. Veřejný capability mint byl odstraněn,
syntaktický klon subjectu zápis neodemkne a receipt actor musí sedět na tutéž
identitu. Přímý canonical SQL INSERT proto fail-closed selže. Aplikace už
receipts nemintuje: autentizované POST surface vracejí typed `410`, SQLite
drží pouze raw signed display cache a autoritativní promotion dělá samostatný
Git CLI. Ten nyní vyžaduje exact BLOB bytes, globální nonce, index/manifest už
na podepsaném evidence HEAD, každý candidate→HEAD commit i parent a samostatný
candidate→receipt evidence HEAD důkaz; merge a lokální Git replacement/index
metadata fail-closed odmítá. Exact-HEAD scanner odvozuje čtené roots z
distribučního manifestu; na `b15090a4`
rozlišuje 1 853 scanned a 983 content-read souborů a má nula current-tree
findings. History scan měří dosažitelnost z přesného ref censu, ne fyzickou
existenci objektu, a rozlišuje pre-remediation, retain, rewrite a new-root
disposition. Všech 13 známých incident objektů je stále dosažitelných, takže
aktuální pravdivý stav je `HISTORY_REMEDIATION_REQUIRED`.
Původní důkaz je v
[`m5-privacy-20260826.md`](docs/execution/runs/m5-privacy-20260826.md).

Původní integrační kandidát `94ea4ea7` opravil test bootstrap a dal první
společný gate, ale jeho operátorský review skončil `0/9 REVIEW_PASSED`: našel
1 critical, 13 high a 4 medium blocking vady. Výsledek je zachovaný v
[`2026-08-26-M5-OPERATOR-REVIEW-RESULT.md`](docs/review/2026-08-26-M5-OPERATOR-REVIEW-RESULT.md).

První review našlo 18 technických nálezů a jejich remediation vedla ke
společnému candidate `034e00f5`. Druhé review označilo pět oddílů
`REVIEW_PASSED` a čtyři znovu otevřelo sedmi dalšími nálezy. Jejich remediation
je na `c3170a12`, `dc6e9b12`, `b020ee19` a `b15090a4`; nový společný exact
product candidate je `816a2a4c` a evidence source `6e7cd741`. Final fresh
clone, autoritativní pětiminutový PERF artifact a celý gate byly zopakovány.
Gate report `2026-08-26T21-57-25-661Z` je pravdivě
`284 PASS / 2 FAIL / 2 BLOCKED`, `verdict: FAIL`, `exitCode: 1`, se stejnými
čtyřmi zděděnými ID a všemi osmi M5 programy v profilu PASS.
Second-review closeout a odpověď jsou v
[`m5-second-review-remediation-closeout-20260827.md`](docs/execution/runs/m5-second-review-remediation-closeout-20260827.md)
a
[`2026-08-27-M5-SECOND-REVIEW-RESPONSE.md`](docs/review/2026-08-27-M5-SECOND-REVIEW-RESPONSE.md).
M3 oddíl 7 je samostatně přijatý a zapsaný. M5 acceptance dál blokují re-review
čtyř opravených oddílů, všech osm skutečných operátorských rotací a history
disposition.

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

- `WP-M5-PACKAGE` na `ce6b8276` rozdělil podporovaný výchozí core profil a
  explicitní full PDF profil. Core chybějící optional runtime pravdivě hlásí;
  full nad stejnou podmínkou fail-close. `--offline` navíc blokuje Corepack,
  npm/Yarn síť i Ollama probe a exact fresh clone prošel pouze z cache.
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
- Docker je explicitně `unsupported`: default Compose profil nemá žádnou
  službu, legacy služby vyžadují profil `unsupported`, backend zachovává
  `127.0.0.1` a lockfile instalace nemá fallback. Bez autentizované ingress
  boundary se tato cesta nesmí prezentovat jako produkční deployment.
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

**Implementační stav 2026-08-28:** `SIGNED_AUTHORITY_CHANGES_REQUIRED /
TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED` na původním review kandidatu
`8abd6065bd614a15bf9f7814dea14ed1e040c616` (tree
`f41a6af70b29d9024ba1006aabe417aad2ff26aa`). Historický producer skutečně
spustil 311/311 vybraných programů zeleně, ale úplný registry required set má
369 položek: chybělo 47 modelových a 11 serverových programů. Finální validator
navíc odvozoval PASS ze self-asserted gitignored JSON namísto opětovného
vyhodnocení raw reportů, sedmi artifact rolí a exact receipt chainu. Application
upgrade, L0-11 a dlouhý soak/resource řádek nebyly prokázány v síle, kterou
release matice vyžaduje. Proto je dřívější `TECHNICAL_IMPLEMENTATION_PASS`
stažený; 311/311 zůstává pouze pravdivým dílčím výsledkem. Historický closeout je v
[`m6-integration-closeout-20260827.md`](docs/execution/runs/m6-integration-closeout-20260827.md)
a superseding review výsledek v
[`2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT.md`](docs/review/2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT.md); původní review jednotka je v
[`2026-08-27-M6-OPERATOR-REVIEW-PACKET.md`](docs/review/2026-08-27-M6-OPERATOR-REVIEW-PACKET.md).
Nejde o `ACCEPTED`, povolení merge/tag/publish ani náhradu otevřené M5 brány.

### Stav remediation po operátorském review

Čtyři false-green třídy už mají implementovanou náhradu a čekají na nový
stabilní candidate + re-review:

- finální release evidence se znovu odvozuje z raw logů připnutých v Git a
  validuje exact artifact/receipt chain; ignorovaný JSON nemůže vydat PASS;
- locked plán používá množinovou rovnost se všemi současnými 366
  `ACTIVE + required` programy;
- devět required live-server consumer journeys už není posíláno do runneru,
  který žádný server nevlastní. Plan v6 je odděluje do serializované
  runner-owned fáze s per-program SQLite/HOME/projects, PID+nonce port-file
  atestací, exact cleanupem a content-addressed server+test logem. Modelová
  fáze tím obsahuje pouze 44 programů bez server prerequisite; podrobnosti jsou
  v Decision 040;
- auditní povolení toolchain blockeru nyní samo nestačí: Git, bwrap,
  bubblewrap, prlimit, unshare, iproute2 a PDF interpreter procházejí exact
  executable preflightem a každá candidate audit fáze používá fail-fast;
- registry zakazuje konstrukčně nesplnitelný stav `ACTIVE + required +
  external-network`. Devět modelových programů je povinných a jejich test-owned
  transport propustí pouze přesné lokální Ollama endpointy; případný WebSearch
  pokus se odmítne před transportem a projde pouze fail-closed fallbackem. Čtyři
  skutečné/volitelné externí E2E programy jsou podle vlastního kontraktu
  `manual + required:false`.
- required previous-version journey spouští skutečný server 136.0.0 nad
  persistentní DB a poté tentýž stav otevře současnou aplikací 136.1.0;
  receipt v2 dokládá stejný inode/device SQLite souboru, přesných 56 → 79
  migrací, celý canary a skutečný `lo`-only user/network namespace;
- L0-11 má durable cross-process model claims, append-only pull/delete intent a
  terminály, loopback-only provider scope, bounded stalled-pull recovery a
  explicitně retired legacy chat cleanup. Focused autorita prošla 11/11,
  původní model-use 24/24, VRAM 8/8 a binding/chat 108/108.
- původních třináct `ACTIVE` položek označených `soak` bylo podle skutečného
  runtime překlasifikováno na model/server/database/offline. Soak acceptance
  nyní tvoří pouze dva nové owned-production-server programy: přesný 24h běh
  a pětiminutové ramp + sustained maximum-throughput měření v samostatném
  Linux network namespace. Zkrácené sondy vracejí pouze `DEV_ONLY` a release
  parser je odmítá.

Autoritativní module graph má 1 199 hran, stále 3 cykly a 28 souborů v
cyklech. Dvě nové authority-validation hrany byly přijaty explicitně bez růstu
cyklu; předchozí odstraněná chat → model-identity hrana baseline zpřísnila.

Dosud chybí skutečný 24hodinový soak, plný maximum-throughput/resource receipt,
nový úplný candidate run a operátorský re-review. Operátor 2026-08-27 odložil
všechny live chat/LLM a model-quality běhy kvůli probíhající optimalizaci a
možné výměně modelů; jejich stav je `DEFERRED_MODEL_OPTIMIZATION`, nikoli PASS
nebo FAIL, a starší modelové artefakty se k novému kandidátu nepřipnou. Proto
žádný z těchto řádků není ještě vydáván za `REVIEW_PASSED` ani za M6 acceptance.

### Vstup

Normální acceptance vstup vyžaduje `M1–M5 ACCEPTED`. M1–M4 jsou přijaté, ale
M5 zůstává `8/9 REVIEW_PASSED / PRIVACY CHANGES_REQUESTED` a nemá skutečných 8/8
rotací ani history disposition. Operátor výslovně povolil dokončit technickou
implementaci M6 bez čekání; toto povolení neotevírá acceptance gate. Product
candidate je zmražený a Gate 0/attestační řetěz může být dokončen až po
externích autoritách.

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

### Contract integration checkpoint 2026-08-29

První bezpečný connector-only blok je `IMPLEMENTATION_GREEN /
FULL_GATE_GREEN / REVIEW_PENDING` na exact product candidatu `54a10fd0`
odvozeném z M6 candidate `0f9e2c64`. Přenáší transport-free consumer pin,
executable capability/payload/session kontrakty, sanitizované fixtures,
provider conformance harness a test-only simulátor. Šest nových registrovaných
offline sad má focused výsledek `63/63 PASS`; nový integrační test porovnává
mobilní piny přímo s aktuálními M2/M5 exporty a volá skutečný M5 negotiation.
Souvislý offline+database gate má `311/311 PASS`; registry fingerprint je
`e0fb9ec59e860128fbb9b16664604b349fbfe9f515ada52b0b2ed22fe5047a63`.

Stav se tím nemění na runtime dostupnost: requirements zůstávají
`CANDIDATE_NOT_ACCEPTED`, provider a transport jsou absent a žádný produkční
modul kandidátní session nebo simulátor neimportuje. Přesný scope a stop
conditions drží
[`WP-M7-MOBILE-CONTRACT-INTEGRATION`](docs/wp/WP-M7-MOBILE-CONTRACT-INTEGRATION.md).

### Client/Android integration checkpoint 2026-08-29

Přesný mobilní klient a Android shell ze zdrojového commitu `7cf1c8b7` jsou
přeneseny produktovým commitem `ac1ee5ac` bez starého serveru, DB, migrací nebo
legacy gateway. Exact product candidate `6a5094ed` (tree `a86f0717…b3e6`) má
mobilní gate `20/20 PASS`, Android release boundary `11/11 PASS` a souvislý
offline+database gate `325/325 PASS`. Registry obsahuje 485 programů s
fingerprintem `67e9dd37…20e6`. Aktuální module graph má 1 212 hran,
stále 3 cykly a 28 souborů v cyklech; jediná nová hrana je
explicitní consumer pin `src/mobile/client/app.js ->
src/mobile/client/remote-core-v1.js`.

Stav je zatím `CLIENT_IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PRODUCTION_TRANSPORT_BLOCKED / PRODUCTION_SIGNING_NOT_AUTHORIZED`. Hostový
debug build není device, TalkBack, wire-transport ani distribuční důkaz a
`remote-core-v1` zůstává fail-closed bez fallbacku na legacy `/m1`. Rozsah a
stop conditions drží
[`WP-M7-MOBILE-CLIENT-INTEGRATION`](docs/wp/WP-M7-MOBILE-CLIENT-INTEGRATION.md);
měření a review rozsah jsou v
[`m7-mobile-client-integration-20260829.md`](docs/execution/runs/m7/m7-mobile-client-integration-20260829.md).

### Mobile release-binding remediation checkpoint 2026-08-29

Nezávislý integrační audit doložil, že původně přenesený mobilní commit
`7cf1c8b7` je předkem pozdějšího reviewovaného headu `ab1940aa`. Centrální
M7 proto na exact candidatu `d43e7ada` doplnila pouze chybějící product/test
řezy `aa8e8440` a `b46062f9`: APK i AAB se nově bajtově vážou na přesný
reviewovaný client source, runtime identitu, origin, CSP a Android
network-security policy; lint zůstává nezávislý na production signing
credentials. Starý serverový mobilní prototyp zůstává správně vynechaný.

Všech šest převzatých cílových blobů odpovídá přesnému zdrojovému commitu.
Android release boundary je `13/13`, mobile gate `28/28`, harness chrání
`121` database-reachable rootů, artifact boundary je `158/158` a module
ratchet `13/13 PASS`. Nesouběžný úplný offline+database gate skončil
`333/333 PASS`. Dva dřívější souběžné běhy zůstávají pravdivě FAIL, protože
si dva runnery ve stejném worktree vzájemně zpřístupnily untracked testovací
adresáře. V tomto historickém checkpointu bylo nezávislé review pending;
signing, distribuce, device a transport evidence neproběhly.

Následná remediation na exact product kandidatu `caaa14ca` nahradila
neomezený N+1 operation list jedním bounded snapshot/keyset statementem a
doplnila kanonický source manifest, source-derived plugin registry, samostatný
APK/AAB signer a nezávislé Android metadata/network-policy pozorování. Exact
offline+database profil má `333/333 PASS`, Android boundary `15/15` a mobile
gate `28/28`. Nezávislé review přijalo `CORE_COMPOSITION`,
`MOBILE_RELEASE_BINDING` i související `M6_REGISTRY_RATCHET`; výsledek je v
[`2026-08-29-M7-COMPOSITION-MOBILE-M6-RATCHET-REVIEW-RESULT.md`](docs/review/2026-08-29-M7-COMPOSITION-MOBILE-M6-RATCHET-REVIEW-RESULT.md).
Verdikty nepovolují provider activation, transport, produkční signing,
distribuci ani device test a nepřijímají M7 jako celek.

### Transport-free provider checkpoint 2026-08-29

Generic in-process provider je `IMPLEMENTATION_GREEN / FULL_GATE_GREEN /
REVIEW_PENDING / NOT_ACTIVE` na exact product candidatu `c5b50589` (tree
`c147f7ff…516`). Všech 14 kandidátních operací prošlo existujícím provider
conformance harness; capability se neinzeruje, pokud chybí jediný handler nebo
mutation journal. Request je validován před autoritou, handler dostane jen
přesný operation scope, každá mutace prochází at-most-once callbackem journalu
a result se znovu váže k requestu a vrací jako immutable clone.

Provider nic neimportuje z route, serveru, DB, session ani network vrstvy,
neumí otevřít listener a hlásí `activation: not_active`. Focused provider má
`9/9 PASS`, mobilní gate `21/21 PASS` a celý offline+database gate
`326/326 PASS`; registry obsahuje 486 programů s fingerprintem
`a47d511f…5e943`. Tento checkpoint neimplementuje reálné operation handlery,
persistentní journal, session/pairing/revokaci ani wire transport. Přesný rozsah
je v
[`WP-M7-IN-PROCESS-CAPABILITY-PROVIDER`](docs/wp/WP-M7-IN-PROCESS-CAPABILITY-PROVIDER.md)
a evidence v
[`m7-in-process-capability-provider-20260829.md`](docs/execution/runs/m7/m7-in-process-capability-provider-20260829.md).

### Project core adapters checkpoint 2026-08-29

První skutečná capability je `IMPLEMENTATION_GREEN / FULL_GATE_GREEN /
REVIEW_PENDING / NOT_ACTIVE`. `project.list` čte reálný
SQLite katalog, po project-access rozhodnutí dvakrát pozoruje workspace a před
emitováním autorizaci opakuje. HMAC kurzor váže device, subject, capability,
operaci, filtry, úplný snapshot a offset. `project-context.query` přijímá jen
`projectId`, hostový root vyřeší až uvnitř core a deleguje do přijatého M2
provideru. Projektové cesty se na mobilní hranici nevracejí.

Focused adapter je `8/8 PASS`; provider, journal a mobilní kontrakty zůstávají
zelené. Dvě přesné importní hrany byly přijaty na `a0233a00` bez růstu cyklů;
aktuální module graph má 1 216 hran, stále 3 cykly a 28 souborů v cyklech.
Registry má 488 programů, fingerprint `82c2d70a…10e2`. Po opravě vědomého DB
bootstrap censusu prošel exact candidate `e937344a` souvislým offline+database
gate `328/328 PASS`. Produkční session autorita, kurzorový klíč, composition
root, listener a transport zůstávají záměrně nepřítomné; nezávislé review
teprve následuje.

### Conversation core adapters checkpoint 2026-08-29

`conversations@2` má kompletní transport-free handler set: autorizovaný
SQLite list, snapshotovanou newest-to-oldest historii a injektovanou přijatou
M1 command cestu. `command` i `mutation` teď povinně procházejí durable
operation journalem; M1 command používá své kontraktově vázané `requestId` a
restartový replay nevolá core podruhé. Nové user/assistant řádky persistují
stejné `turnId`; legacy řádky dostávají jen deterministický read fallback.

Focused adaptéry jsou `8/8`, provider `11/11`, journal `12/12` a mobile gate
`24/24 PASS`. Jediná nová importní hrana byla explicitně přijata v
`4ee0a1d9`; aktuální module graph má 1 217 hran, stále 3 cykly a 28 souborů v
cyklech. Registry má 489 programů, fingerprint `9a98ae69…594b`. Dva červené
meziběhy zůstávají evidované; po opravě odvozeného roadmap pinu a exact PDF
runtime invokace prošel candidate `91f022a9` souvislým offline+database gate
`329/329 PASS`. Provider zůstává neaktivní a listener/session/pairing nejsou
součástí tohoto bloku.

### Settings + stored-information core checkpoint 2026-08-29

`settings@1` vystavuje jen Git-pinned allowlist pěti skutečně používaných UI
hodnot; celý historický `user_settings` dokument, credential pole, provider
endpointy a modelová aktivace na mobilní hranici nejsou. Každá hodnota i
snapshot mají content revision. Update vyžaduje fresh snapshot, typed hodnotu,
durable M7 journal a injektovaný approval/effect mediator; pending/rejected
rozhodnutí write callback nedostane.

`stored_information@1` dostal samostatnou migraci 102 pro append-only
`manual_note`, partition podle subjectu a volitelný project scope. Project
autorita se kontroluje před mediací i před zápisem a znovu před emitováním
chráněných bytes. HMAC cursor váže device, subject, filtry a úplný snapshot.
Legacy `task_memory`/`memory` nejsou vydávány za identity-safe data a vracejí
explicitní typed unavailable výsledek.

Focused adapter je `10/10`, schema `55/55`, M1 schema `20/20`, provider
`11/11`, journal `12/12` a oba mobilní contract programy `14/14 + 11/11 PASS`.
Registry má 490 programů s fingerprintem `f322661b…a53a`; module graph má 1 219 hran,
stále 3 cykly a 28 souborů v cyklech. Produkční mediator,
composition root, session, pairing, listener a transport zůstávají záměrně
nepřítomné. Souvislý offline+database gate a nezávislé review teprve následují.

### Operation control checkpoint 2026-08-29

Kontrolní rovina `operation.list/get/abandon` je implementačně zelená bez
aktivace transportu. List a get čtou pouze partition důvěryhodného device a
subjectu; HMAC cursor váže filtry, úplný snapshot a offset. Abandon vyžaduje
vlastní durable `operation.abandon` intent, fresh revision cíle a zapisuje
append-only receipt v migraci 103. Původní effect ani jeho journal se nemění,
cancel ani retry se nespouští. Focused sada je `6/6 PASS`; souvislý gate a
nezávislé review následují. Čtyři přesné nové module-boundary hrany byly
přijaty bez růstu cyklů; aktuální module graph má 1 223 hran, stále 3 cykly
a 28 souborů v cyklech. Approval capability zůstává mimo tento blok: různé
produkční approval zdroje nemají jednotnou autoritativní expiraci a její
normalizace vyžaduje operátorské rozhodnutí.

### Core composition checkpoint 2026-08-29

Jediný transport-free composition root skládá reálné project, conversation,
settings a stored-information adaptéry nad společným durable mutation
journalem. Stejný provider zpřístupňuje neinzerovaný operation recovery a
remote health control plane. Focused composition test je `5/5 PASS`; provider
zůstává `not_active` a pravdivě inzeruje právě čtyři ze sedmi capability.

`approvals`, `events` a `notifications` zůstávají `unavailable`: composition je
nenahrazuje prázdnými nebo fixture handlery. Sedm přesných importních hran z
composition rootu bylo explicitně přijato bez růstu cyklů; autoritativní
module graph má 1 230 hran, stále 3 cykly a 28 souborů v cyklech. Exact
candidate `d43e7ada` prošel nesouběžným souvislým offline+database gate
`333/333 PASS`; nezávislé review následuje. Session, listener, pairing,
network transport, production klíče ani runtime activation tento blok
nepřidává.

### Session authority checkpoint 2026-08-29

Transport-free `M7SessionAuthority@1` má na `12e1adfc` podmíněný
`REVIEW_PASSED`; novější O-01/O-02 bytes jsou `IMPLEMENTATION_GREEN /
REVIEW_PENDING / NOT_ACTIVE / TRANSPORT_ABSENT`. Migrace 105 drží jednorázové
pairing claims bez raw code, exact 32-byte Ed25519 device key, krátké
single-use challenge, generační session stav, counter/nonce replay ochranu,
expiry a revokaci. Každý povolený i typovaně odmítnutý authority pokus vytváří
append-only audit; denial evidence neobsahuje raw claim, nonce ani podpis.

Reviewed focused autorita měla `9/9`, mobilní session contract `12/12`, schema
`55/55`, M1 schema `20/20`, M6 runtime evidence `8/8`, module ratchet `13/13`
a nightly self-test PASS. Review vázal 494 programů a fingerprint
`bf26d0a5…effb5`; tehdejší M6 plán pokrýval všech 395 ACTIVE+required programů
a profilová Gate 0 matice 334 offline+database programů. O-01 nyní přidal
podpis exact invocation envelope a O-02 podepsaný standalone challenge request;
oba řezy vyžadují nové review. O-04 navíc zvedá aktuální registry piny na
396/335 v tehdejším checkpointu; pozdější event/notification blok má vlastní
aktuální census níže.

Blok záměrně neotevírá listener a neaktivuje provider. Operátor schválil
samostatný `POST /remote/v1/session/challenge` a Ed25519 podpis každé invocation;
implementace zůstává fail-closed a transport-free do jejich review. Produkční
klíče, signing, device test, tag, publish ani push neproběhly.

### M2-only approval adapter checkpoint 2026-08-29

O-04 je `IMPLEMENTATION_GREEN / REVIEW_PENDING / NOT_ACTIVE`. Closure-brandovaný
port může vydat pouze skutečná přijatá M2 lifecycle application service; M7
adaptér odmítá strukturální klon a nikdy nepřebírá ownera ani origin z remote
payloadu. Owner-scoped list používá bounded index migrace 106. Exact plan,
view a revision se ověří před approve/reject a skutečný efekt následně znovu
projde M2 workspace, governance, expiry, grant a execution autoritou. Focused
journey dokazuje stale no-write, validní zápis, právě jeden approval intent,
durable replay, reject a subject partition. Default composition bez portu dál
inzeruje 4/7; s genuine portem je approval pátá dostupná capability. Listener
a transport nejsou aktivní. Přesně tři O-04 importní hrany byly explicitně
přijaty. Autoritativní module graph má 1 235 hran, stále 3 cykly a 28 souborů
v cyklech.

### Events + notifications core checkpoint 2026-08-30

`events@1` a `notifications@1` jsou `IMPLEMENTATION_GREEN / REVIEW_PENDING /
NOT_ACTIVE / TRANSPORT_ABSENT`. Skutečný M1 session emitter může přes explicitně
injektovaný observer plnit subject-bound, paměťově omezený event read model;
payload se neukládá ani nepřenáší, ztracené retention okno je typované a
konfliktní sequence zneplatní pouze daný run.

Notifikace vstupují výhradně closure-brandovaným read-only portem skutečné M3
`AgentRepository`. Remote projekce neemituje body ani volná `data`, každou
položku dvakrát autorizuje a cursor bezpečně znovu proskenuje skryté položky.
ACK je device + subject partitionovaný, nesmí překročit pozorovanou sequence,
projde durable operation journalem a migrace 107 drží exact canonical BLOB
receipt. Connection-local SQLite validator se registruje i po restartu.
Legacy HTTP route ani globální M3 `read_at` se nepoužívají.

Focused sady jsou `7/7` events, `8/8` notifications a `8/8` composition.
Šest přesných hran bylo přijato na `f1b93dd6`; autoritativní module graph má 1 241 hran,
stále 3 cykly a 28 souborů v cyklech. Registry má 497 programů,
398 `ACTIVE + required`, profilová offline+database množina má 337 programů a
fingerprint `7adffb24…b2ee`. M6 omission sentinely, nightly policy i self-test
jsou implementačně zelené, ale tento nový ratchet ještě nemá nezávislý review.
Default composition bez optional portů dál pravdivě inzeruje 4/7; žádný
listener, pairing, produkční signing nebo transport tento blok nezapíná.

Souvislý offline+database gate nad exact candidatem `277c7ee9` skončil
`337 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED`, `verdict: PASS`,
`exitCode: 0`. Registry hash v reportu je přesně
`7adffb2446dca9a292c6b635a345f8591923893e8a45a76e13ec05b96d51b2ee`.
Předchozí kontrolní výsledky `329/0/0/8` a `335/0/0/2` zůstávají zachované a
pravdivě `BLOCKED`; otevření přesně deklarovaných lokálních toolchainů a
připnutí existujícího PDF runtime vytvořilo nový zelený běh, nepřebarvilo staré
reporty. Live LLM, Ollama a GPU nebyly spuštěné. Implementační evidence je v
[`m7-events-notifications-core-adapters-20260830.md`](docs/execution/runs/m7/m7-events-notifications-core-adapters-20260830.md)
a review vstup v
[`2026-08-30-M7-EVENTS-NOTIFICATIONS-AND-RATCHET-REVIEW-PACKET.md`](docs/review/2026-08-30-M7-EVENTS-NOTIFICATIONS-AND-RATCHET-REVIEW-PACKET.md).

### LAN/VPN transport admission checkpoint 2026-08-30

O-03 je rozpracované jako `IMPLEMENTATION_GREEN / REVIEW_PENDING /
LISTENER_ABSENT`. Nový transport admission modul neotevírá socket a nemá import
na session autoritu. Validuje pouze budoucí dedicated listener boundary: exact
TLS 1.3 bez proxy trustu, konkrétní privátní LAN/VPN bind bez wildcardu,
socketem pozorovanou private/ULA/CGNAT peer adresu, přesný Host, metodu a sedm
`/remote/v1/*` cest. Query, legacy `/api/*`, `/m1/*`, `/c3/ws`, credentials,
cookies, forwarding hlavičky, transfer encoding, duplicitní hlavičky a
nadlimitní bodies selžou před budoucí session/provider autoritou.

Peer identita se pro rate limiting odvozuje HMAC-SHA-256 z kanonické IP; raw IP
ani pairing code nejsou v plánu. Pairing plán vyžaduje digest claimu a odděluje
global, peer a peer+claim bucket; invocation rozlišuje read `60/min` a mutation
`10/min`. Plán výslovně říká `DURABLE_RATE_LIMIT_CONSUMER_REQUIRED`: durable
consumer ani produkční HMAC klíč zatím neexistují, takže listener nesmí být
aktivován. Focused policy je `8/8 PASS`. Registry má aktuálně 498 programů,
399 `ACTIVE + required`, profilová množina 338 (`270 offline + 68 database`) a
fingerprint `7188ed91…afaf`. Souvislý gate nad exact kandidátem `bba4bbf3`
skončil `338/338 PASS`, exit 0; report má SHA-256 `df1fa205…01356`.
Implementační report je v
[`m7-lan-vpn-transport-admission-20260830.md`](docs/execution/runs/m7/m7-lan-vpn-transport-admission-20260830.md)
a review packet v
[`2026-08-30-M7-LAN-VPN-TRANSPORT-ADMISSION-REVIEW-PACKET.md`](docs/review/2026-08-30-M7-LAN-VPN-TRANSPORT-ADMISSION-REVIEW-PACKET.md).

### Durable rate-limit checkpoint 2026-08-30

Odpojený limiter je `IMPLEMENTATION_GREEN / REVIEW_PENDING /
LISTENER_ABSENT`. Přijme jen closure-genuine plan z transport admission policy
a jen přes genuine receiver. V jedné SQLite `IMMEDIATE` transakci předem
vyhodnotí všechny buckety; při denial nebo chybě se žádný sibling counter
nezmění. Fixed window je restart-safe i cross-process, časový návrat a aktivní
config drift selžou zavřeně. Migrace 108 ukládá pouze opaque HMAC identity,
route, limity a current-window counter; expired řádky se časově čistí a
absolutní počet řádků má fail-closed strop.

Focused sada je `10/10 PASS`, včetně dvou současně startovaných procesů, které
nad limitem 10 dohromady dostaly přesně 10 allow a 10 deny. Schema je `55/55`,
M1 migration oracle `20/20` a M6 runtime/technical evidence `8/8 + 8/8`.
Registry má 499 programů, 400 `ACTIVE + required`, profil 339
(`270 offline + 69 database`) a fingerprint `f2b34a87…e750b`. Module edge,
který dovoluje limiteru ověřit genuine admission plan, je přijatý jako jediný
nový spoj; aktuální module graph má 1 247 hran, 3 cykly a 28 souborů v cyklech. Exact
candidate `b23f63d6` následně prošel souvislým offline+database gate
`339/339 PASS`, exit 0; report má SHA-256 `1e19ab67…0d80`. Limiter i aktuální
M6 registry ratchet dostaly nezávislé `REVIEW_PASSED`; výsledek je v
[`2026-08-30-M7-DURABLE-RATE-LIMITER-REVIEW-RESULT.md`](docs/review/2026-08-30-M7-DURABLE-RATE-LIMITER-REVIEW-RESULT.md).
Produkční klíč, listener ani síť nevznikly.

### Disconnected request-authority pipeline checkpoint 2026-08-30

Nový řez je `IMPLEMENTATION_GREEN / FULL_OFFLINE_DATABASE_GATE_GREEN /
REVIEW_PENDING / NOT_ACTIVE / LISTENER_ABSENT`. Jedna closure-brandovaná
pipeline přijímá raw transport metadata a raw body bytes a vynucuje pořadí
admission → trusted operation classification → durable limiter → canonical
JSON/fatal UTF-8 → signed session authority → private core provider. Všech
sedm mobilních rout prochází touto hranicí; žádný produkční modul ji zatím
nekonzumuje.

Integrační test odkryl a opravil skutečnou chybu: čtyři session-control routy
sdílely limiter bucket, ale rozdílné request routeId způsobovalo falešný
`CONFIG_DRIFT`. Genuine buckety nyní nesou stabilní `configurationId`, zatímco
decision dál eviduje skutečnou routu. Focused pipeline je `7/7`, admission
`9/9`, limiter `11/11`, session `11/11` a mobilní kontrakty `13/13 + 14/14`.
Harness vědomě přijal 124. DB-reachable root a negativní bootstrap sentinel
zůstal účinný.

Registry má 500 programů, 401 `ACTIVE + required`, profil 340
(`270 offline + 70 database`) a fingerprint `a7bbe1f7…ff5e`. Module graph má
1 247 hran, 3 cykly a 28 souborů v cyklech. Exact candidate `5c185b0f` prošel
souvislým gate `340/340 PASS`, exit 0; raw report má SHA-256
`b6e4f44a…4a08`. Současné session/admission/limiter bytes, pipeline a M6
registry ratchet jsou předané k nezávislému review v
[`2026-08-30-M7-DISCONNECTED-REQUEST-PIPELINE-REVIEW-PACKET.md`](docs/review/2026-08-30-M7-DISCONNECTED-REQUEST-PIPELINE-REVIEW-PACKET.md).
Implementační report je
[`m7-disconnected-request-pipeline-20260830.md`](docs/execution/runs/m7/m7-disconnected-request-pipeline-20260830.md).

Tento řez neaktivuje doporučené varianty `M7-TLS-01`, `M7-RATE-01`,
`M7-NET-01` ani `M7-PAIR-01`. In-flight fence je zatím per pipeline instance;
listener před aktivací musí prokázat singleton composition nebo silnější
shared authority.

### VPN-only listener a Android companion checkpoint 2026-09-08

Operátorem přijaté varianty `M7-TLS-01/A`, `M7-RATE-01/A`, `M7-NET-01/A`
a `M7-PAIR-01/A` jsou implementované, ale bez produkčního key materialu a
reálného síťového/device běhu nejsou release evidence. Server skládá exact
VPN origin na portu 7443, TLS 1.3 HTTP/1.1 framing, systemd-credential TLS a
limiter authority, lokálně autentizované pětiminutové single-use pairing
claimy a všech 17 remote operací přes existující session/provider hranici.
Android klient používá native HTTPS bez proxy a redirectů, pin leaf SPKI,
fatální UTF-8/kanonické JSON a Ed25519 proof pro pairing, session control i
invocation; privátní seed je softwarový a v klidu zabalený non-exportable
AndroidKeyStore AES-GCM klíčem, nejde tedy o tvrzení hardware-backed Ed25519.

Produkční implementace je v `ae00d8f6`, exact Android importní ratchet v
`f600c564` a content-addressed fyzická runtime-evidence hranice v `4d0f8462`.
Mobilní gate prošel `45/45`; native client `7/7`, Android release boundary
`18/18`, UI adapter `4/4`, remote core `7/7`, credential boundary
`31/31`, MS20 UI `43/43`, app runtime `1/1` a browser accessibility `22/22`.
Offline Gradle zkompiloval Java cestu a spustil `M7CanonicalJsonTest`.
Nezávislé review kandidáta `07b582d1` následně uzavřelo všech osm technických
řezů jako `REVIEW_PASSED`; Android verdict byl poctivě omezený na zdroj, protože
na fyzickém zařízení nic neběželo. `M7_OVERALL` proto zůstalo `NOT_ACCEPTED`.

Product follow-up `f3a8753e` přidal společný devítiprvkový JSON corpus, jehož
kanonické UTF-8 bajty ověřuje Node i Android/JUnit, a testovaný recovery postup
pro terminální chybu aktivace. `9ae1a516` navíc přidal inertní generátor
user-systemd unity: přijímá jen veřejné VPN hodnoty a cesty k zašifrovaným
credential obálkám, emituje pouze `LoadCredentialEncrypted=`, nečte credential
bytes, nic neinstaluje ani neaktivuje. `systemd-analyze --user verify` nad
vyrenderovanou dočasnou unitou prošel bez výstupu.

Registry má 511 programů, 412 `ACTIVE + required`, deterministic scope 351
(`278 offline + 73 database`) a fingerprint `922f65e9…0b40`. Autoritativní
module graph má 1 273 hran, 3 cykly a 28 souborů v cyklech.
M6 locked plan zahrnuje všech 412 povinných programů; omission test navíc
jednotlivě zamyká všech jedenáct nových listener/Android programů. Nightly
orchestrator používá stejný fingerprint a přesné profilové počty. Focused
výsledky zahrnují shared Node corpus `11/11`, Android M7 JUnit `4/4`, VPN config
a renderer `11/11`, candidate plan `20/20` a orchestrator self-test PASS.

Čistý exact candidate `07b582d171eb590d4c4c55ea7a8837bfdf9315e1`
(tree `78fb2adc88ba9a9d2604f8a837bf3d0cd68503a6`) nejdřív bez otevřených
toolchain autorit skončil pravdivě `BLOCKED / exit 2 / 342 PASS / 8 BLOCKED`.
Všech osm jsou přesně programy požadující deklarovaný lokální PDF, Git,
Bubblewrap nebo `prlimit`. Následný kandidátním plánem povolený běh otevřel jen
pět exact toolchain autorit a skončil `PASS / exit 0 / 350 PASS / 0 non-PASS`.
Finální report `2026-09-08T22-41-31-787Z` má SHA-256
`72f8c9e7…cc96`; oba reporty zůstávají zachované.

Aktuální exact candidate `9ae1a5164d31f8cd4f1e3880eac79576399ef21f`
(tree `944db57faa8472eb2966bd57826b2e1fead9fe5b`) zopakoval obě větve: raw běh
`2026-09-08T23-42-36-615Z` skončil pravdivě `343 PASS / 8 BLOCKED / exit 2`,
zatímco běh se stejnými pěti exact toolchain autoritami
`2026-09-08T23-46-27-677Z` skončil `351/351 PASS / exit 0`; jeho SHA-256 je
`ccbba183…12ec`.

Stav je `PREVIOUS_8_OF_8_REVIEW_PASSED / FOLLOWUP_IMPLEMENTATION_GREEN /
FOLLOWUP_REVIEW_PENDING / REAL_VPN_DEVICE_EVIDENCE_BLOCKED / NOT_ACCEPTED`.
Nebyl měněn firewall ani instalovaný/aktivní systemd stav, nevznikl produkční
secret, nic nebylo pushnuto ani publikováno a neproběhl fyzický telefon, VPN
bind, TalkBack, signing/distribuce, GPU/Ollama ani live LLM chat. Review packet
je `docs/review/2026-09-09-M7-PROD-READINESS-FOLLOWUP-REVIEW-PACKET.md`.

Povinné výsledky:

- oddělený listener, autentizace a pairing;
- device scope, expiry a revokace;
- negativně prokázáno, že legacy `/api/*` a `/c3/ws` nelze obejít stejným
  vzdáleným listenerem;
- audit každé remote authority akce;
- projekty, konverzace, settings, stored information, approvals, notifications
  a typed runtime events přes verzovaný kontrakt;
- kompatibilita verzí core/companion a pravdivé degraded/offline chování.

### Lokální mobilní konvergence 2026-09-09

Na větvi `work/mobile-completion-20260908` je výsledný merge
`f7f78d5a113df0029ff16dea5bbfdf8469b6623f`, přesně z `1ab8d942` a `f812259d`.
Native companion a fyzická release evidence z B jsou integrované spolu s
mobile accessibility a povinnou dirty-source pojistkou. Locale inventář pro
aktuální B přidal jeden registrovaný offline program, nikoli starý `/m1` BE.
Mobile gate `46/46`, browser `24/24`, release boundary `19/19`, skutečný
throwaway APK/AAB build a binding prošly. Fresh-clone deterministic běh má
`350 PASS / 1 FAIL / 0 BLOCKED`, exit 1: jediný FAIL je očekávaný rozchod
registru se sealed Gate0 policy podle `CONTRACT.md` §8. Staré LOC/census
problémy se neopakovaly. Raw report není převyprávěn jako PASS.

Stav řezu je `SCOPED_COMPLETE / INDEPENDENT_REVIEW_PENDING / NOT_PROD_READY`.
Aktuální inventory: 511 programů, fingerprint `84235937…0ff6`.
Tento checkpoint nepřebírá novější B `036ba6bd..0b0a4669`, nemění přijetí M5/M6
ani neuzavírá M7. UI mapping dalších obrazovek, fyzické VPN/device/TalkBack
důkazy, produkční podpisy a distribuce zbývají. Podrobnosti a stav všech MM:
[review packet](docs/review/2026-09-09-MOBILE-CONVERGENCE-REVIEW.md).
Bez push, aktivace služeb nebo zásahu do cizího BE checkoutu.

### Technické dokončení core — 2026-09-09

Operátor přijal postup core 1.0 před samostatným M7 a autorizoval technickou
integraci v existujícím checkoutu. Aktivní rozsah:
[WP-CORE-COMPLETION-20260909](docs/wp/WP-CORE-COMPLETION-20260909.md).
Nezávislé review merge `f7f78d5a` přijalo MC1/MC2, ale MC3 vrátilo
`CHANGES_REQUIRED`: source manifest hashoval legacy CSP i při M7 buildu.
Review B `036ba6bd..9ae1a516` přijalo canonical JSON/recovery a B registry
scope; renderer vrátilo `CHANGES_REQUIRED` kvůli systemd injection přes
procentní suffix v bind address. Obě konkrétní vady a potvrzený privacy
false-positive jsou opravené s negativními kontrolami. Integrační kandidát
čeká na čerstvý běh a nové nezávislé review; není release acceptance.

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
cestami a connectory. **Vlastnictví má dvě úrovně: projektově až tři zapisující
WP, v jednom checkoutu vždy právě jeden zapisující vlastník.** Standardem
zůstává jeden worktree; další vzniká pouze po explicitním schválení, na disku,
po dobu skutečně souběžného WP a po integraci se odstraní. Sdílet checkout smějí
jen prokazatelně filesystem-read-only běhy. Paralelně mohou běžet read-only
trace, review a příprava testů bez zápisu. Jeden integrační vlastník skládá
přírůstky po malých commitech a měřené dokumenty aktualizuje na merge SHA;
lokální GPU role jsou sériové. Podrobná pravidla a kritéria prvního pilotu:
`docs/review/2026-08-08-PARALLEL-PILOT.md`.

Agent pokračuje autonomně uvnitř schváleného WP. Zastaví dotčenou část při
změně veřejného connectoru, produktu/scope, bezpečnostní či datové nejasnosti,
konfliktu vlastnictví nebo výsledku, který zpochybňuje směr. Nezávislé části
mohou pokračovat.

## 13. Aktuální pořadí

1. **`PRODUCT.md` i tato roadmapa jsou od 2026-08-21 přijaté operátorem.**
   Přijetí PRODUCT.md proběhlo s jednou opravou: online discovery je `IN /
   GOVERNED` a **default on** podle rozhodnutí z 2026-08-19, čímž se
   `WP-M5-OUTBOUND-GATE` mění z volitelné plochy na podmínku vydání.
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
   Směrově slepý exact-edge ratchet P6 je po hardeningu integrován na merge
   `ec98803a` s baseline 1 010 hran / 3 cykly / 28 souborů; směrové pravidlo
   dál čeká na přijatou path mapu M3. První paralelní procesní pilot je
   invalidovaný kvůli dvěma writerům v jednom checkoutu a nesmí být vydán za
   kladný ekonomický výsledek.
5. B1 contract a B2 chat jsou implementované; Gate 1 volby 001–014 jsou
   schválené a zapsané. **Operátor 2026-08-09 přijal i zbývající pětici
   015/020/021/022/023** — 015 `A + 7d provisional`, 020 `E`, 021
   `B/REJECT/A/B`, 022 `A`, 023 `A` — vždy s korekcemi zapsanými v příslušném
   dokumentu. Přijetí odemklo implementaci, nikoli samo o sobě aktivaci.
   Terminální activation proofu (015) i produkční ACK `m1-wire-v1` (021) mají
   od 2026-08-22 vlastní implementační a offline důkazy; globální GPU residency
   (023, M2) zůstává mimo tuto dávku a Gate 1 stále čeká na fyzický T3 pilot.

   **Závazná Gate 1 fronta** v tomto pořadí:

   | # | Položka | Stav 2026-08-22 | Proč tady |
   |---|---|---|---|
   | 1 | 023 VRAM delete race | **HOTOVO** `51936ee1` | aditivní, bez veřejného kontraktu a bez GPU |
   | 2 | 022 operation-bound recovery | **HOTOVO** `05b6c44b`, `c0a0340f` | nejmenší code položka, offline ověřitelná |
   | 3 | společná rezervace migrací | **HOTOVO** `2013e522` | union census přes všechny větve; `066` = 020, `067` = 015 |
   | 4 | 020 oddělená policy storage | **HOTOVO** `b9731302` | první migrační položka |
   | 5 | 015 proof ↔ artefakty a striktní expiry | **HOTOVO** `6368bd2f` | druhá migrační položka, těží ze stejného census |
   | 6 | 021 byte bridge + built journey + produkční ACK | **HOTOVO** `2b6b151b`, `2e33e342`, `241b39ab` | Electron boundary je built a produkční server token pravdivě ACKuje |
   | 7 | autorizovaný GPU pilot | **HOTOVO / PASS** source `31859488` | run `m1-b3-gpu-31859488-20260823`: cold/warm/classify/cancel PASS, exact 4096 profil, 100% residency a přirozený restore bez administrativního efektu |

   **Položky 1–6 uzavřené 2026-08-22.** Deterministický gate na `a317da53` měl
   `{"PASS":229,"FAIL":3,"BLOCKED":2}` přes 234 sad. Navazující plný gate na
   `10b3d080` po B3 closeoutu a vyřešení živé kolize migrace 068→069 má
   `{"PASS":232,"FAIL":3,"BLOCKED":2}` přes 237
   sad: všechny tři nově registrované B3 sady jsou PASS a tři FAILy zůstávají
   přesně stejné prostředím podmíněné sady (`nightly-audit-runner-self-test`,
   `nightly-orchestrator-self-test`, `vram-coordination`). Dvě BLOCKED jsou
   stejné PDF toolchain prerekvizity. Fyzický T3 pilot následně na clean
   `31859488` prošel `1/1`; Gate 1 je proto PASS a B5 je odblokované.

   Levné a bezpečnostní změny se tím dokončí před drahou Studio
   infrastrukturou a obě migrační položky dostanou čísla z jednoho census.
   Census z 2026-08-22 přes 351 živých větví je v
   [`docs/execution/migration-reservation.md`](docs/execution/migration-reservation.md):
   union je obsazený souvisle `001`–`065`, takže dřívější `058`/`059` už kolidují
   s mobilní linkou. Platí `066` = 020 a `067` = 015.
6. **B3-IDENTITY a B3-PROFILE jsou implementované a focused offline
   ověřené:** canonical presence
   identity chrání schválené binding/delete/cleanup cesty a integrity scan je
   detection-only. Cleanup C1 nyní centralizuje HTTP/scheduler delete a
   odstraňuje direct chat effect; dnešní chatový candidate source je celý
   one-step rollback-protected a proto zůstává bezpečně zaparkovaný do
   retirement rozhodnutí. Registry sdílí binding mutation owner, chrání durable desired/rollback identitu,
   dvakrát ověřuje exact artifact a numericky fail-close řeší retention.
   C1 je fresh-clone ověřený na source `da95ab15` a baseline `3ff178fd`.
   Finding 007 je remediovaný; finding 006 je `PARTIAL`. C2a má fresh-clone
   ověřenou per-canonical autoritu pro delete, pull a validaci. C2b gateway a
   binding jsou `FRESH_CLONE_VERIFIED` na `cfcb63dd`: queued request model nerezervuje, aktivní
   provider lifecycle drží lease přes body/retry a všechny terminal paths
   vracejí lease i semaphore. Binding cutover znovu ověří exact identitu pod
   previous+target lease a verification drží target až přes durable success
   zápis. Jsou tím pokryté čtyři z pěti živých cest. VRAM disposition,
   multiprocess claim a durable audit dál drží finding 010 otevřený; 023
   přesně odděluje artifact-use hranu od pozdější GPU effect authority. Sdílený
   runtime profil nyní omezuje oba gateway vstupy a conversation compaction;
   neprohlašuje GPU PASS. B3-FAILOVER implementace popsaná níže je hotová a
   nový sériový T3 běh od 4096 zůstává její fyzickou acceptance branou.
   Settings authority a fail-closed storage
   schema, repository/CAS claim základ a striktní expired-claim recovery jsou
   implementované bez modelového effectu. Recovery je záměrně expire→nový CAS,
   takže jiný worker může legitimně vyhrát; není to atomický same-worker reclaim.
   Measurement policy už fail-closed pinuje role-suite autoritu a verzovanou
   serializaci. Izolovaný measurement-only runner vytváří soukromý kanonický
   artifact bez DB/proof/binding efektu; parent navíc odvozuje provider,
   inventory, digest a HEAD, spouští child z exact-blob source exportu a vydá
   pouze immutable `NOT_ISSUED` receipt. Fake-provider CHAT a D1 pokrývají
   ordered suite, skutečný randomizovaný prompt i negativní drift. Manual
   binding storage nyní drží neověřenou append-only apply/rollback lineage,
   migrace 049 fail-closed vynucuje přesný atomický incident supersede a
   veřejné repository operace jej provádějí v jednom commit pointu bez runtime
   effectu. Migrace 050 navíc zavádí append-only application outcomes a
   exact-digest verification authority; legacy override demotuje na
   `LEGACY_UNVERIFIED` a staré apply/rollback writery po jejím nasazení
   typovaně blokuje před efektem. Migrační preflight je
   implementovaný a attestovaný podle
   [rozhodnutí 016](docs/decisions/016-migration-identity-guard.md). Legacy
   apply/rollback writery už nemají produkčního volajícího. Explicitním
   blockerem ve findingu 008 byl před aktuálním candidate post-DB
   `runtime.commit()` reconciliation: durable `APPLIED` neměl při pozdním
   finalize failure typovaný recovery stav. Primární application checkpoint je
   dokončený v
   [`WP-M1-BINDING-APPLICATION`](docs/wp/WP-M1-BINDING-APPLICATION.md);
   vratné provozní defaulty jsou shromážděné v
   [018](docs/decisions/018-m1-manual-binding-application-policy.md). Společná
   HTTP/chat application service, exact local provider, runtime CAS/kompenzace,
   startup rehydrate a commit-layer broadcast jsou implementované a
   fresh-clone ověřené na `e7d89b5e`. Startup inventory je pouze census hint;
   exact manual binding se před runtime změnou znovu resolveuje pod lease.
   Operationless `LEGACY_UNVERIFIED` override zůstává name-only kompatibilitní
   residual. Navazující úzký
   [`WP-M1-BINDING-FINALIZE-RECOVERY`](docs/wp/WP-M1-BINDING-FINALIZE-RECOVERY.md)
   je aktivní od `20b1b933` a tento historický post-DB residual řeší. Atomický
   candidate přidává migraci 054,
   append-only direct/recovery receipt, odvozený interní
   `RUNTIME_RECONCILIATION_REQUIRED` a fail-closed preflight úplné trigger
   autority i přesné pre-054 history stopy. Recovery smí znovu přečíst exact
   provider identitu, ale nesmí vytvořit druhý pull, nový user-provider intent
   ani zopakovat runtime efekt. Verification a notification bez receipt odmítá
   DB. Historický success se
   nepotvrzuje backfillem a interní stav se do veřejného connectoru nemapuje
   jako nový enum. Schema/repository i application/runtime cutover tvoří kvůli
   produkční kompatibilitě jeden nedělitelný source candidate. Review jednotkou
   je `0a6bde54` spolu s opravným `7c4aa73c`; výsledné SHA `7c4aa73c` prošlo
   čistým lokálním klonem, offline instalací a celou focused/compatibility
   baterií. Navazující detection-only koordinátor po opt-inu ukládá exact
   desired baseline a `DETECTED`; podporovaný opt-in povrch a oddělená
   revisioned policy storage jsou nyní přijaté a implementované podle
   [020](docs/decisions/020-m1-model-failover-opt-in-surface.md).
   Navazující closeout aktivoval A-bootstrap/7d policy (`6037c4bc`), přidal
   atomický operator-only proof issuer (`d87549e4`, `3af419ed`), terminální
   claim/proof/policy/CAS přechody (`9a61b95a`) a append-only runtime finalize
   receipt i jednorázový `DEGRADED_PROOF_EXPIRED` health event (`c8ffbccc`).
   Produkční runtime (`6a231a42`) provádí `ACTIVATE/REAPPLY/RESTORE` přes stejného
   mutation ownera jako ruční binding a shared model lease; nesmí pull, delete
   ani proof renewal a po startu obnoví nedokončenou finalizaci. Equality na
   expiry je negativně připnutá. Measurement parent od `56ff8053` exportuje
   tranzitivní uzávěru přesných Git HEAD blobů místo ručního seznamu.

   Registrovaný runtime audit na `7ea36580` prošel `8/8` a proof/source-closure
   audit na `56ff8053` `4/4`. Fresh clone exact
   `56ff805331b1863faeb441adbbe8dd771410b382` offline nainstaloval 233 balíčků
   (0 vulnerabilities) a reprodukoval application `6/6`, terminal repository
   `7/7`, parent acceptance `16/16`, binding `108/108`, migrations `38/38` a
   ratchet `13/13`. B3 implementace a offline fresh-clone evidence jsou tím
   hotové. Historický T3 preflight blokoval cizí aktivní CUDA proces; syntetické
   proof fixture nejsou produkční measurement proof.
   Registrovaný T3 preflight na clean `4f339e30` následně skončil před prvním
   provider efektem typovaným `GPU_PILOT_PREREQUISITE_BLOCKED`: cizí model byl
   rezidentní, compute procesy byly dva, free VRAM 10 638 MiB proti minimu
   20 128 MiB a baseline utilization 99 %. Vlastní measurement zůstal `null`.
   Plný offline/database gate na `10b3d080` navíc prošel 232 sadami; tři FAILy
   a dvě BLOCKED jsou beze změny proti známému environmentálnímu baseline.
   Nový autorizovaný T3 běh `m1-b3-gpu-31859488-20260823` na clean
   `3185948840b96bb76567a43da69eb1505545e308` následně prošel: cold 26 891 ms,
   warm 590 ms, classification 798 ms, skutečný cancel 154 ms, 100% residency,
   minimum 5 489 MiB free a přirozený restore na prázdný Ollama/compute stav.
   Tím je B3 fyzicky přijaté; skutečný failover-candidate proof zůstává
   nevydaný a netvrdí se.
   Fresh clone exact `10b3d080068c81f387aa38244634a710d6281ea5` po offline
   instalaci reprodukoval application `6/6`, terminal `7/7`, schema `20/20`,
   všechny migrace `38/38`, parent `16/16`, issuer `6/6`, binding `108/108` a
   ratchet `13/13`; klon zůstal čistý.
7. B4 má focused implementované 011/A, obě poloviny 014/A a obě poloviny
   012/B: bounded request
   ID/set, úplný partition, typed reject, explicitní durable-store autoritu,
   přesné klientské slot/snapshot vlastnictví, quarantine a bounded persisted
   restore, existence-aware atomický history snapshot a fail-closed klientskou
   interpretaci přesného HTTP 200, 404 a race výsledků. Společný DB-backed live
   wire přes produkční WS server, route a commitnutý klient je také hotový.
   Generated prebuild část 010/A+ je implementovaná a clean-clone ověřená.
   Operátor přijal [017/A+A](docs/decisions/017-m1-negotiated-wire-shape.md):
   required-offer `m1-wire-v1` a exact transportní context wrapper.
   Required-offer checkpoint byl clean-clone focused implementovaný na
   `7551b907`: Studio token nabízí, ACK-bound latch se při reconnectu resetuje
   a server v tomto checkpointu token ještě neACKoval; M1-shaped frame bez
   negotiation skončí před legacy controllerem.
   Exact server ingress/egress adapter a Studio source producer/terminal ledger
   jsou focused implementované; clean clone `f2d9055c` navíc offline sestavil
   skutečný generated protocol i production bundle a načetl consumer bez
   testového stubu. Commit `7b887e88` tuto ruční kontrolu přenesl do
   fail-closed root `postbuild`: exact clean clone provedl protocol codec,
   terminal stream, izolované načtení consumeru, bundle inclusion a Fonts
   egress guard a vydal byte-level hashe všech tří artefaktů. Jde o build
   integrity, ne behavioral journey. Owned-loopback checkpoint `4cfcb8f2`
   následně přes skutečné sockety ukončí první connection, znovu vyjedná M1,
   autoritativně ověří a přes loopback HTTP obnoví 3/3 durable identity a po
   reconnectu doručí další korelovaný success. Nejde o server restart ani
   Electron evidence. Produkční ACK `m1-wire-v1` je od `241b39ab` zapnuté a
   built Electron journey `391fa39d` na exact `417eaabb` prokázal pět terminálů,
   reconnect, nulový externí egress a nulový legacy pád; byte bridge má navíc
   samostatnou fresh-clone evidenci `326a9a08`. Cancel terminal ordering už
   závazně plyne z přijatého
   004/C a není nová otázka. Disposable fresh clone na `9464dacf` dříve offline
   reprodukoval production build a 65s non-visual legacy Electron boundary
   journey s nulovým egresssem a čistým shutdownem; tím se ověřilo prostředí,
   nikoli negotiated M1 consumer ani finální UI. Read-only review může běžet
   souběžně; GPU běhy nikdy.
8. B4 je implementačně a built/fresh-clone evidencí uzavřené. Fyzický T3 pilot
   na `31859488` je PASS a MODEL/B3 je přijaté. B5 QUALITY skončilo
   `PASS/CLOSED` implementací Decision 024/C na `4b20a5dd`. B6 fresh-install
   exit na `d518d7ec` prošel všemi sedmi scénáři, L3 gate, nulovým egresssem a
   čistým shutdownem. Gate 2 i M1 jsou proto `ACCEPTED/PASS`; M2 smí navázat.
9. M2 effect authority a project-change journey se otevírají až po M1.

### Integrovaná model-evaluation autorita (2026-08-26)

Historický product/test kandidát `79328185` navázal na zamítnutý `74beafea`
a vytvořil jedinou role-specific exact-artifact model-evaluation cestu.
Migrace 097 karanténuje 11
cross-role decisions; migrace 099 odstraňuje telemetry-derived blacklist.
Historický strict-role snapshot měl 28 `COMPLETE`, 11 `BLOCKED`, 52 `MISSING`
a 0 `FAILED` buněk. Aktuální exact-edge module graph má 1 198 hran, 3 cykly a
28 souborů v cyklech; zahrnuje sjednocený inventory normalizátor a versioned
technical applicability. Finální čistý gate `2026-08-27T20-32-24-822Z` prošel 279/279 na
`79328185`; předchozí 278/1 fail i přerušený ENOSPC běh zůstávají v handoff
evidenci. Nezávislý Opus max rereview rozsahu `74beafea..26ab3291` vrátil
`REVIEW_PASSED`; záznam je v
[`2026-08-28-WP-MODEL-EVALUATION-CONSOLIDATION-OPUS-MAX-REREVIEW.md`](docs/review/2026-08-28-WP-MODEL-EVALUATION-CONSOLIDATION-OPUS-MAX-REREVIEW.md).
Následný autorizovaný běh 2026-08-28 použil izolovaný response-attesting
sidecar, live DB migroval do 099 a po pozdější applicability remediaci uzavřel
všech 79 technicky kompatibilních párů: 55 `COMPLETE`, 24 `BLOCKED`, 0
applicable `MISSING`; 12 raw `MISSING` buněk je explicitní N/A. Systémová
Ollama 0.32.14 zůstala beze změny a
durable runtime je proto stále `PROVIDER_CAPABILITY_BLOCKED`. Následné review
našlo hard filtr přes `preferredCategories`, neúplnou cache/export identitu,
nepublikovanou provenienci 40 starších intervalů a stale dokumentaci. Produktový
head `ccf54377` tyto vady opravil a čistý gate na něm prošel 279/279. Další
review našlo neúplnou snapshot inventory projekci, která při offline replay
ztrácela tři VISION capabilities. Produktový head `53ded662` proto ukládá
SHA-bound `params`, `family`, `category` a `capabilities`; replay pouze ze
snapshotu a stejné DB reprodukuje 55/24/0/12 bez Ollamy. Čistý gate
`2026-08-28T20-11-17-080Z` na něm prošel 279/279. Z 55 COMPLETE výsledků je
15 intervalů `VERIFIED` a 40 `LEGACY_UNVERIFIED`; u starších řádků reader
publikuje pouze historický recorded-at timestamp, nikoli start nebo duration.
Nezávislé evidence rereview rozsahu `d6137d4c..3f027938` zopakovalo offline
replay, SHA/tamper kontrolu, backup manifest i nový clean-clone gate `279/279`
a vrátilo
[`REVIEW_PASSED`](docs/review/2026-08-28-WP-MODEL-EVALUATION-EVIDENCE-REREVIEW.md).
Scoring/evidence balík je proto `ACCEPTED`; systémový response-digest provider
zůstává samostatně `SYSTEM_PROVIDER_BLOCKED`. Podrobnosti jsou v
[`model-scoring-live-20260828.md`](docs/execution/runs/model-scoring-live-20260828.md).
Následné explicitně autorizované odstranění čtyř VRAM-blocked artefaktů
uvolnilo 71,47 GiB bez změny DB historie nebo bindingů. Současná installed
inventory má 9 artefaktů a coverage 55 `COMPLETE`, 0 `BLOCKED`, 0 applicable
`MISSING`, 8 N/A; bounded důkaz je v
[`model-removal-live-20260828.json`](docs/execution/runs/model-removal-live-20260828.json).

### M6 integrace model-evaluation autority (2026-08-29)

Přijatý exact-artifact scoring řez je integrován do současné M6 linie merge
commitem `ff9a7dfc`. Integrace zachovává durable M6 model-artifact claimy,
odstraňuje paralelní auto-failover/proposal writery a používá jediný
role-specific read model. M6 technical-evidence kontrakt je verze 5: zrušené
legacy `upgrade-apply` a `upgrade-flow` programy nahrazuje manual-binding
application autorita, konsolidovaný model-upgrade test a skutečný pre-082
upgrade regression. Registry má 463 programů (`369 ACTIVE`, z toho 364
required), fingerprint `ab85f58a854d9271dcf39f321d583f8024ee09b79355e863c5857eaefe29cbca`.
Aktuální module graph má 1 211 hran, stále 3 cykly a 28 souborů v cyklech.

Stav řezu je `IMPLEMENTATION_GREEN / INTEGRATION_REVIEW_PENDING`, nikoli M5
nebo M6 acceptance. Na exact product candidatu `73385eeb` prošel focused
release blok `298/298` a jeden souvislý offline+database gate `303/303`, bez
FAIL, BLOCKED, TIMEOUT nebo změny source SHA. Registry, hygiene a module
ratchet jsou zelené. Modelový chat, fyzický GPU běh, aktivace bindingů a timer
nebyly spuštěny podle operátorského odkladu. Systémová Ollama 0.32.14 proto
zůstává pravdivě `SYSTEM_PROVIDER_BLOCKED`. Podrobný integrační záznam je v
[`m6-model-evaluation-integration-20260829.md`](docs/execution/runs/m6/m6-model-evaluation-integration-20260829.md).

### M6 signed operator-demo authority (2026-08-29)

Fail-closed devítikrokový demo plán, raw observation validator a samostatná
offline podepsaná approval hranice jsou integrovány na exact product candidatu
`d71ac77a`. Runner umí jen plan/record/validate a úplné pozorování stále vrací
`DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL`; nemá podpisový ani approval mód.
Finální signed-authority verifier znovu načte observation z evidence HEAD a
ověří kanonické UTF-8 bytes, exact candidate/tree/registry a všechny raw
artefakty. Focused hranice je `301/301 PASS`; po pravdivě červeném
diagnostickém běhu kvůli stale registry pinu byl pin opraven a nový souvislý
offline+database gate skončil `304/304 PASS`. Skutečné demo ani approval receipt
neproběhly, takže M6 acceptance zůstává `BLOCKED`.

### M7 persistentní mutation journal (2026-08-29)

Transport-free capability provider má nově durable append-only hranici pro
remote mutace. Intent se commitne před zavoláním core handleru, první
contract-valid outcome se uloží jako kanonický BLOB a restartový replay vrátí
tentýž výsledek s `replayed: true` bez druhého efektu. Identita zahrnuje
`deviceId + subjectId + operationId`; jiný request digest nebo operation type
je terminální konflikt a neúplný či nejednoznačný intent se automaticky
neopakuje. Request payload se neukládá.

Implementace je v `9f6407c2`, dvě přesné authority-validation hrany byly
samostatně přijaty v `2a67f2d3`. Aktuální module graph má 1 214 hran, stále
3 cykly a 28 souborů v cyklech. Focused journal/provider testy jsou 10/10 +
10/10, mobile gate 22/22 a artifact integrita 158/158. Souvislý
offline+database gate na exact kandidatu `ea97c410` skončil 327/327 PASS.
Listener, pairing, session authority, core mutační adaptéry a transport
zůstávají nepřítomné; stav je
`IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING / NOT_ACTIVE`.

### M7 project core adapters (2026-08-29)

Transport-free provider má první dva reálné read handlery: autorizovaný,
snapshotovaný `project.list` a rootless `project-context.query` nad přijatým M2
manifest/retrieval providerem. Katalog je omezený na 200 active projektů,
workspace i katalog se kontrolují opakovaně a autorita se před emitováním
znovu ověří. Continuation cursor je opaque HMAC a váže úplnou trusted identitu
i snapshot; hostové rooty neopouštějí core.

Implementace je v `5906bf62`; dvě přesné importní hrany byly samostatně
přijaty v `a0233a00`. Aktuální module graph má 1 216 hran, stále 3 cykly a 28
souborů v cyklech. Focused adapter je 8/8, registry má 488 programů s
fingerprintem `82c2d70a…10e2`. První full gate na mezikandidatu `54e62859`
pravdivě skončil 327/1 kvůli stale DB-bootstrap oraclu; oprava je v `e937344a`
a nový souvislý gate skončil 328/328 PASS. Stav je `IMPLEMENTATION_GREEN /
FULL_GATE_GREEN / REVIEW_PENDING / NOT_ACTIVE`; session, pairing, listener,
transport a fyzická device cesta nejsou součástí tohoto bloku.

### M7 conversation core adapters (2026-08-29)

Produkční read-model nyní mapuje autorizované `conversations` a `messages` z
SQLite do přesných candidate payloadů bez existence/content oracle. HMAC
kurzory vážou subject, device, operation, dotaz, celý snapshot a offset;
history stránky jdou od nejnovějších ke starším, uvnitř stránky chronologicky.
Před i po čtení/příkazu se opakuje authority kontrola a drift vrací jen
typovaný fail-closed výsledek.

Implementace je v `6da1e94d`; jediná přesná importní hrana byla přijata v
`4ee0a1d9`. Aktuální module graph má 1 217 hran, stále 3 cykly a 28 souborů v
cyklech. Focused výsledky jsou `8/8 + 11/11 + 12/12`, mobile gate `24/24` a
registry 489 programů s fingerprintem `9a98ae69…594b`. První full gate na
`4ee0a1d9` zůstává evidovaný jako FAIL a první pokus na `91f022a9` jako
BLOCKED kvůli nepředanému PDF interpreteru; exact opakování na témž čistém
candidate skončilo `329/329 PASS`. Produkční composition, session authority,
pairing, listener, transport a fyzická device cesta zůstávají mimo tento blok.

### M7 settings + stored-information core adapters (2026-08-29)

Mobilní settings read-model je pevný allowlist nad produkčním settings
dokumentem a mutation cesta je revision-bound, journaled a dostupná jen přes
injektovaný approval/effect mediator. Nová fingerprintovaná migrace 102 drží
append-only ruční poznámky oddělené podle subjectu a projektu; legacy memory
tabulky se bez identity migrace nevystavují. Focused sady jsou zelené, registry
má 490 programů / fingerprint `f322661b…a53a` a module graph 1 219 hran bez
růstu cyklů. Dva úplné běhy pravdivě odhalily tři stale M6 migrace/registry
oracly; po jejich přesné opravě exact candidate `1b0654f0` prošel souvislým
offline+database gate `330/330 PASS`. Nezávislé review je pending; runtime
composition a transport nejsou aktivní. Přesný kontrakt práce drží
[`WP-M7-SETTINGS-INFORMATION-CORE-ADAPTERS`](docs/wp/WP-M7-SETTINGS-INFORMATION-CORE-ADAPTERS.md).

## 14. Rozhodovací fronta — otázka až ve chvíli, kdy má data

| Rozhodnutí | Kdy je skutečně potřeba | Jaká evidence musí být na stole |
|---|---|---|
| Přijetí `PRODUCT.md` a `ROADMAP.md` | Teď, před uzavřením M0 | Tento 22/22 obraz, backend baseline, offline scan a známý Studio gap. |
| Autoritativní Studio source/build disposition | **Rozhodnuto 2026-08-07** | Commitnutý `lib` je runtime; stale TS je inertní archiv a současné UI není finální vizuální baseline. |
| `degraded` versus terminální `error` po částečném tool výsledku | **Rozhodnuto 2026-08-08: 001/A** | Terminální `error`; partial data mají oddělené schéma, ale `persistPartialToolResults` zatím nemá produkčního konzumenta. |
| Streaming v 1.0 | Po přijetí non-streaming M1 baseline | Cold/warm whole-response latency, cílový TTFT a cena změny tří connectorů. |
| Strict injection versus veřejná extension boundary pro L0-8 | Před M3-BOUNDARY | Skutečný import graph, specialista E2E a nejmenší prototyp obou variant. |
| Zachovat/odložit/ukončit upgrade automatiku 18b | Před M5 conditional freeze | Úmyslný check/approve/reject/rollback journey, outbound a údržbová cena. |
| Topologie model delete/use authority | Před uzavřením cleanup C2 a L0-11 | Úplný call graph provider consumerů, race aktivní use→rebind→delete a dopad single-process versus durable cross-process claimu. |
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
