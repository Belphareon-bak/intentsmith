# IntentSmith — mapa systému

**Základ změřen 2026-08-02 na `17a8b9a8`; pre-fix OS-isolated scan proběhl na
`24457ba2`; registry klasifikace byla opravena v `06309bc8`, post-fix scan
aktuálního registru proběhl na `a85c344f` a izolovaný HTTP/restart baseline na
`ac320335`. Fresh-clone Studio probe proběhl na dokumentačním HEAD `df8f1039`
se zdrojovým stromem shodným s `ac320335`; registrovaný Electron boundary
runner byl znovu fresh-clone ověřen na `7236d221` a současný legacy runtime
byl offline buildem a 65s non-visual journey znovu potvrzen na `9464dacf`.
Finální M1 fresh-install journey prošel na `d518d7ec` přes built Electron,
skutečný server/SQLite/Ollamu i kontrolované negativní terminály.**
Neutrální dokument, nezávislý na nástroji.
Pravidla vývoje: [`CONTRACT.md`](CONTRACT.md) · Detail: [`docs/inventory/`](docs/inventory/)

> Čísla níže jsou **změřená**, ne převzatá. Kde se rozcházejí se starší
> dokumentací, platí tento dokument.

---

## Spuštění

```bash
npm install                   # 233 balíčků, ~16 s
node src/server.js            # http://127.0.0.1:3335
node --watch src/server.js    # vývoj
```

**Prerekvizity:** Node.js 22+ · SQLite (better-sqlite3) · Ollama pro LLM cesty
(bez ní běží deterministické intenty, ostatní vrací `LLM_PROVIDER_UNAVAILABLE`)

```bash
npm test                      # deterministické sady
node scripts/validate-test-registry.js
```

**Prerekvizity sad — stav k 2026-08-03.** Deklarace byla empiricky prověřena v
OS network namespace bez odchozí routy. Autoritativní post-fix run na
`a85c344f` vybral 203 programů a skončil `200 PASS / 1 FAIL / 2 BLOCKED`, exit
`1`; proto nejde o zelený celek:

| Sada | Stav |
|---|---|
| `export-pdf-docx`, `chat-export-budget` | **Vyřešeno.** Deklarováno jako `BLOCKED` s prerekvizitou `toolchain: python-pdf-runtime`. Instalace: `./scripts/install-pdf-runtime.sh` |
| `quality-gate` | **Nereprodukuje.** Bez `go` na PATH projde 22/22. |
| `multi-source-integration` | **Vyřešeno.** 12 offline testů zůstalo; 2 BBC/OpenMeteo testy jsou v samostatné `network: external` sadě. |
| `dependency-manager` | **Vyřešeno.** Unit test už nespouští skutečné `npm install`; fake executable ověřuje přesně tři pokusy bez sítě. |
| `harness-exit-code` | **Vyřešeno.** Po review import graphu je pin 95; mutační kontrola stále prokazuje odstranění isolation anchoru. |
| `nightly-orchestrator-self-test` | **M6 release baseline opravený a změřený.** Required PDF/export programy jsou pravdivě ACTIVE nad explicitním lokálním Python runtime, zapečetěný candidate plán má registry fingerprint `3593af7c…` a exact candidate `8abd6065` prošel `296/296` deterministickými programy včetně orchestration self-testů. |

Registr do 2026-08-02 **toolchain deklarovat neuměl** — `hasConcreteBlockedPrerequisite()`
uznával jen network/server/ollama/gpu, takže sada potřebující Python musela
zůstat `ACTIVE` a padat. To je přesně mezera, kvůli které `G0-C7` tuhle třídu
chyby nezachytil. Doplněno `requirements.toolchain`.

### Aktuální runtime baseline

Na přesném `ac320335` proběhl server v izolovaném runtime rootu s prázdným
`HOME/XDG/TMP`, vlastní DB, projekty a output adresářem, bez zděděných tajemství
a s vypnutým online discovery, ComfyUI a autonomií:

- health `200` za 19 ms a založení konverzace `201`;
- skutečný HTTP deterministický dotaz `17 * 23` vrátil přesný výsledek za 22 ms;
- skutečný HTTP modelový dotaz přes `qwen3.5:27b` vrátil odpověď za 24 784 ms;
- před restartem byly uloženy přesně čtyři turny; po stop/start nad stejnou DB
  byly načteny stejné čtyři role za 19 ms;
- samostatná modelová behavior sada CRE prošla **9/9**, exit `0`; studená první
  klasifikace trvala 20 966 ms, následující přibližně 1,1–1,3 s.

Lokální raw evidence zůstává mimo Git v
`.intentsmith-artifacts/runtime-baseline.qAU9qe/`; sanitizované JSON souhrny mají
SHA-256 `2700a942…d8c37` před restartem a `8d123f79…42bb68` po restartu. Toto
je **current-checkout pozorování**, nikoliv přenositelná release evidence:
neobsahuje commitnutý runner ani environment manifest. Tento starší baseline
sám neprokazoval fresh-clone instalaci ani Theia runtime; následný WP-M0-E je
změřil samostatně níže a odkryl dvě Studio produktové vady.

### Aktuální Studio baseline

WP-M0-E na `df8f1039` použil dva disposable čisté klony; produktové cesty jsou
od `ac320335` beze změny. `npm ci`, frozen Yarn install a production Theia build
prošly exit `0`. Build zabalil byte-identický commitnutý
`c3-chat-panel/lib/browser/chat-panel-module.js`, nikoliv stale TS source.
Samostatný package build `@c3/chat-panel` skončil exit `1` na šesti chybných
importech a před selháním změnil 4 trackované a vytvořil 36 untracked generated
výstupů pouze v disposable klonu. Repozitář přitom v `docs/dev-checklist.md`
výslovně označuje commitnutý JS za ručně udržovaný runtime a `tsc -b` zakazuje.

Diagnostický runtime v OS network namespace při počátečním bootu přešel do
`ready`, provedl WS handshake a přes skutečný Studio panel vrátil
deterministické `17*23 = 391` za 24 ms. Současně odkryl dvě produktové vady:

- renderer se pokusil načíst Google Fonts i pod blokovaným outboundem;
- sedm startup Studio HTTP rodin, včetně dříve vynechané `/api/agents`, vracelo
  `403`. Sanitizovaná CDP revalidace na `1fc8f03e` prokázala, že existující
  bootstrap capability na wire posílá;
  Chromium ale z `file://` posílá `Origin` nepřítomný a
  `Sec-Fetch-Site: cross-site`. Backend proto správně odmítá
  `CROSS_SITE_WITHOUT_ORIGIN` ještě před capability větví. Rozbitý je spoj mezi
  browser transportem a policy kontraktem, nikoliv instalace shimu.

DevTools Network záznam nebyl zachován jako strojově čitelný artefakt; konkrétní
URL, wire header a Fonts pokus jsou current-host observation, zatímco uložený
backend log potvrzuje opakovaná boundary odmítnutí. Při teardownu přibližně šest
minut po startu skončil Electron po ztrátě GPU procesu `SIGTRAP`, současně s
řízeným `SIGTERM` backendu. Diagnostický namespace a `--no-sandbox` neumožňují
rozlišit environment teardown od produktové vady: počáteční journey prošla,
stabilita a clean shutdown nejsou prokázané.

Detail, přesné build příkazy a lokální screenshot/logy jsou v
[`docs/inventory/21-studio-ws.md`](docs/inventory/21-studio-ws.md). M0 tím
získalo fresh-clone install/build a initial boot/chat pozorování, ale Studio
část končí `PRODUCT_FAIL + STABILITY_INCONCLUSIVE`, ne `PASS`.

Následná oprava zachovala autoritativní `lib`, odstranila Google Fonts egress a
normalizovala opaque Electron Origin pouze za přesnou local capability. Na
`7236d221` pak remote fresh clone prošel `npm ci`, frozen Yarn instalací a
production buildem. První automatizovaný běh skončil časným pre-CDP `SIGTRAP`,
druhý odkryl chybnou interpretaci legacy `cre_decision` v runneru. Po opravě
proběhly dva samostatné `PASS`, exit `0`: 648 CDP událostí, nulový external i
other-loopback provoz, přesný boundary trojúhelník, korelovaný deterministický
turn bez provider requestu či efektu, nejméně 65 s live-ready a čisté exity
Electronu i backendu. Současný vzhled nebyl hodnocen. Červené běhy i oba PASS
artefakty jsou v
[`docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md`](docs/review/2026-08-08-STUDIO-ELECTRON-BOUNDARY.md).

T5 runner zůstává registry `BLOCKED`, protože standardní auditní orchestrátor
zatím nevyrábí jeho production build. To neanuluje current-host fresh-clone
výsledek, ale brání vydávat ručně splněnou prerekvizitu za nightly readiness.

---

## Rozsah

| | |
|---|---:|
| `src/**/*.js` | **215 275 ř.**, 582 `.js` souborů v pracovním kandidátu |
| `tests/**/*.js` | **232 499 ř.**, 505 `.js` souborů v pracovním kandidátu |
| Registrovaných testových programů | **500** (`406 ACTIVE`, `79 BLOCKED`, `15 HISTORICAL`) |
| Tabulek v čerstvé DB / aplikovaných migrací | **169 / 95** |
| HTTP rout | ~230 |
| **Schopností v `ACCEPTED/PASS`** | **1 z 22** (#2 CRE); #1 server/routing/DB je zatím `RUNTIME_VERIFIED` — jeho suite má 13 interních checků, zatímco behavior dokument obsahuje 16 řádků, takže tvrzení „13/13 chování“ není platný akceptační součet |

Aktuální registry fingerprint je
`a7bbe1f71db2989bc32da23f9b30c3fd216fa3a175b02d15c311691fc8f0ff5e`.
Historický post-fix scan na `a85c344f` zůstává platný pouze pro tehdejší
fingerprint; současný registry řádek sám není akceptační důkaz.

Aktuální model-evaluation autoritu popisují
[`MODEL-SCORING-ACTIVATION.md`](docs/MODEL-SCORING-ACTIVATION.md) a
[`030-model-evaluation-authority-consolidation.md`](docs/decisions/030-model-evaluation-authority-consolidation.md).
Tyto dokumenty nahrazují historické auto-failover/proof lifecycle popisy v
pozdější capability tabulce: veřejné auto-transition repository writery jsou
odstraněné a gateway, binding verification i autoritativní scoring vyžadují
digest přímo v provider response. Na hostu nainstalovaná systémová Ollama
0.32.14 jej neposkytuje, takže durable runtime zůstává záměrně fail-closed.
Remediovaný source rozsah `74beafea..26ab3291` prošel nezávislým Opus max
`REVIEW_PASSED`. Autorizovaný installed-panel scoring 2026-08-28 proběhl přes
izolovaný patchovaný sidecar. Přijatý 13artefaktový snapshot obsahuje 79
kompatibilních model-role párů: 55 `COMPLETE`, 24 `BLOCKED`, 0 applicable
`MISSING`; 12 raw `MISSING` je explicitní N/A. Z COMPLETE evidence má 15 běhů
ověřený skutečný interval a 40 starších current-contract řádků je veřejně
označeno `LEGACY_UNVERIFIED` bez publikovaného startu a duration. Produktový
head `53ded662` navíc ukládá SHA-bound normalizovaný inventory vstup a jeho
offline replay nad stejnou DB reprodukuje 55/24/0/12 bez kontaktu s providerem.
Nezávislé rereview rozsahu `d6137d4c..3f027938` zopakovalo replay, SHA/tamper
kontrolu, manifest i clean-clone gate 279/279 a vrátilo
[`REVIEW_PASSED`](docs/review/2026-08-28-WP-MODEL-EVALUATION-EVIDENCE-REREVIEW.md).
Scoring/evidence balík je `ACCEPTED`; systémový response-digest provider zůstává
samostatně `SYSTEM_PROVIDER_BLOCKED`. Evidence:
[`model-scoring-live-20260828.md`](docs/execution/runs/model-scoring-live-20260828.md).
Po následném explicitně autorizovaném odstranění čtyř VRAM-blocked exact
artefaktů má současná inventory 9 modelů a 55/0/0/8 coverage
(`COMPLETE/BLOCKED/applicable MISSING/N/A`); DB historie i bindingy zůstaly
beze změny. Důkaz:
[`model-removal-live-20260828.json`](docs/execution/runs/model-removal-live-20260828.json).

Tool census ze zdroje: **9 JavaScript soubory, 8 664 řádků, 153 top-level
nástrojových deklarací**. Počet 213 v dřívější inventuře byl textový false count.

---

## Lehký capability picture 22/22

Stav je nejsilnější aktuálně doložená příčka, nikoliv procento hotovosti.
`BROKEN` označuje potvrzenou dílčí vadu a může stát vedle příčky. Modulový test
sám nikdy neposouvá schopnost na `USER_JOURNEY_VERIFIED`.

| # | Uživatelské chování | Stav | Nejbližší chybějící důkaz nebo potvrzená vada |
|---|---|---|---|
| 1 | Spustí server na loopbacku, připraví DB a obslouží API. | `ACCEPTED/PASS` | B6 fresh clone spustil skutečný server nad izolovanou SQLite, obsloužil API a skončil s čistým shutdownem. |
| 2 | CRE vybere hlídaný intent; deterministická cesta nevolá model. | `ACCEPTED/PASS` | Přijaté offline i Ollama behavior sady jsou 10/10 a 9/9. |
| 3 | Modelový požadavek jde na lokální Ollamu nebo skončí typovanou chybou. | `ACCEPTED/PASS` | B6 doložil exact lokální `qwen3.5:27b`, HTTP 503 outage a cancel/error seams bez false-success. |
| 4 | Uživatel založí či obnoví konverzaci a historie přežije restart. | `ACCEPTED/PASS` | B6 obnovil exact 50/50 zpráv po skutečném restartu; outage ani cancel neuložily assistant success. |
| 5 | Výsledek je deterministicky ohodnocen bez přidání nového obsahu. | `ACCEPTED/PASS` + `BROKEN` | Decision 024/C odstranilo post-answer modelový rewrite po fyzickém A/B; scorer telemetrie zůstává špatně zkalibrovaná pro krátké správné FACTUAL odpovědi (finding 011). |
| 6 | Chat request projde routingem, syntézou a finalizací do jednoho pravdivého výsledku. | `ACCEPTED/PASS` | B6 prošel success/error/cancel/restart přes veřejné HTTP i negotiated Studio `m1-wire-v1`; refinement caller je odstraněný. |
| 7 | Expertiza se vybere a měřitelně ovlivní odpověď. | `RUNTIME_VERIFIED` + `BROKEN` | Explicitní `code_reviewer` se stále neroutuje; chybí route→chat E2E. |
| 8 | Zapnutý specialista využije expertizu a nástroje; vypnutý nezasáhne. | `RUNTIME_VERIFIED` + `BROKEN` | L0-8 interní import a chybějící enable→route→output→disable E2E. |
| 9 | Skill z triggeru získá vstupy a approval a provede známý postup. | `RUNTIME_VERIFIED` | Celý skill až po ověřený výstup a negativní effect boundary. |
| 10 | Lifecycle vede projekt od záměru přes plán a provedení ke kontrole. | `RUNTIME_VERIFIED` | Celý SPEC→roadmap→build→review a recovery journey. |
| 11 | Po approvalu provede scoped patch, test a při selhání rollback. | `EXISTS` | Skutečný uživatelský patch/test/diff/rollback journey. |
| 12 | Code Intelligence vysvětlí projekt a vrátí schválenou konvenci do dalšího kontextu. | `EXISTS` + `BROKEN` | Pattern miner nemá produkční import; chybí learn→next-context round-trip. |
| 13 | Governance zachytí architektonický, API nebo regresní drift. | `EXISTS` | Reálný lifecycle checkpoint, který vadu skutečně zablokuje. |
| 14 | Zapnutý agent reaguje na zdroj a ukáže výsledek; vypnutý nic neudělá. | `RUNTIME_VERIFIED` | První viditelný agent E2E a disabled negativní cesta. |
| 15 | Projektová paměť se uloží, vrátí a lze ji zeslabit či smazat. | `EXISTS` + `BROKEN` | PatternTracker se zapisuje, ale nemá produkčního konzumenta. |
| 16 | Typovaný nástroj projde jednotnou policy/approval hranicí a vrátí strukturovaný výsledek. | `EXISTS` | Chat/skill→tool→effect→audit journey a společná M2 authority. |
| 17 | Uživatel nakonfiguruje a obdrží auditovanou notifikaci. | `EXISTS` | Skutečné doručení ve Studiu a negativní channel cesta. |
| 18a | Uživatel vidí lokální modely a stabilní role přizpůsobené VRAM. | `RUNTIME_VERIFIED` | Current-SHA role/binding/degradation journey přes API a Studio. |
| 18b | Explicitně vyvolaná kontrola navrhne upgrade, který lze schválit či odmítnout. | `RUNTIME_VERIFIED` | Úmyslný check→approve/reject→rollback a finální disposition. |
| 19 | Explicitně otevřený katalog transakčně instaluje, aktualizuje či odebere balíček. | `EXISTS` | Lokální katalog a external install/rollback journey. |
| 20 | Uživatel generuje, ruší a spravuje média bez konfliktu o VRAM. | `EXISTS` + `BROKEN` | Studio render I/O a neukončený `healthTimer`; chybí ComfyUI journey. |
| 21 | Ve Studiu chatuje, vidí progress, ruší práci a po reconnectu obnoví stav. | `ACCEPTED/PASS` | Built B6 doložil 2 panely, 5 terminálů, 12 progress eventů, cancel/error, reconnect, exact negotiation, nulový egress a čistý shutdown. |

Souhrn: **7 `ACCEPTED/PASS`, 7 `RUNTIME_VERIFIED`, 8 `EXISTS`; 6 řádků
mají dílčí `BROKEN`**. Žádná další schopnost zatím nemá obhajitelný stav
`USER_JOURNEY_VERIFIED`. Inventury jsou detailní pracovní podklad; tento lehký
obraz je jediný stavový souhrn.

---

## Schopnosti a jejich soubory

Toto je závazné mapování schopnost → kód. **Hranice schopností nekopírují
adresáře** — u čtyř schopností kód leží jinde, než by název adresáře čekal.

> **2026-08-02:** #11 se srovnalo — `execution-loop.js`, `error-normalizer.js`
> a `fix-strategy.js` přešly z `planner/` do `executor/`. Byla to uzavřená
> trojice se dvěma dotyky ven.
>
> **#13 se srovnat nedá a je to doloženo.** `architecture-check.js`
> a `architecture-policy.js` importuje `lifecycle-planning.js`
> a `lifecycle-build.js`, tedy #10. Přesun do `architect/` by křížové importy
> jen otočil, ne odstranil. Governance a lifecycle **nejsou oddělitelné
> přesunem souborů** — sdílejí kód, ne jen adresář.

### Základ

| # | Schopnost | Ř. | Soubory |
|---|---|---:|---|
| 1 | Server, routing, DB | 12,5k | `server.js`, `routes/`, `db/`, `config.js`, `security/`, `core/` |
| 2 | CRE | 4,3k | `chat/cre-decision.js`, `chat/cre-routing-patches.js` |
| 4 | Konverzace | 2,3k | `chat/conversation-store.js`, `chat/context-*.js`, `chat/ltm-context.js`, `chat/export-pipeline.js` |
| 18a | Správa modelů | 0,9k | `upgrade/model-profiles.js`, `upgrade/model-registry.js` |
| 3 | LLM gateway | 2,9k | `llm/` |
| 5 | Quality Gate v2 | 2,9k | `chat/quality/` |
| 6 | Chat pipeline | 20,4k | `chat/handlers/` (45), `chat/controller.js` |
| 21 | Studio + WS | 1,3k + **14,9k** | `ws-bridge/` + **`c3-ide/` (139 souborů TS/TSX, 20+ rozšíření)** — Theia IDE je **plocha produktu**, viz `DIRECTION.md` |
| 7 | Expertizy | 9,5k | `expertises/` **mimo** specialist-runtime, scenario-engine, knowledge-base |
| 16 | Nástroje | 7,6k | `tools/` — legacy `registry.js` drží **153 registrovaných nástrojů**; M2 typed authority je v `m2-tool-*.js` |
| 9 | Skills | 1,8k | `skills/` — 8 vykonávaných step typů + samostatná substitution helper vrstva |
| 15 | Paměť | 3,1k | `memory/` |
| 12 | Code Intelligence | 11,6k | `code-intel/` |
| 11 | Execution + patch | 6,9k | `patch/`, `executor/` — **hranice sedí od 2026-08-02** |
| 10 | Project lifecycle | 14,5k | `planner/` **mimo** soubory patřící #13 |
| 13 | Governance | 4,7k | `architect/`, **+ `planner/architecture-{guardian,check,policy}.js`, `planner/api-contract-registry.js`, `planner/critic-agent.js`, `code-intel/regression-predictor.js`** |

### Rozšíření a volitelné subsystémy

| # | Schopnost | Ř. | Poznámka |
|---|---|---:|---|
| 8 | Specialisté | ~2,9k | `specialists/` **+ 1 516 ř. v `expertises/`**; 1.0 vyžaduje platformu + jeden E2E |
| 14 | Agenti | 6,5k | `agents/` **+ `chat/handlers/agent-wizard.js`**; 1.0 vyžaduje platformu + jeden E2E |
| 17 | Notifikace | 3,3k | `notifications/` |
| 18b | Upgrade automatika | 9,5k | `upgrade/` mimo #18a; automatické discovery je opt-in, nikoliv jediná outbound plocha |
| 19 | Marketplace | 0,9k | `marketplace/` |
| 20 | Media | 1,3k | `media/` |

Nedokončené / mimo 1.0: licencování, setup wizard.

**Legacy plocha:** `src/ui/architect/` (web UI na `/architect`) je zděděný
předchůdce C3 Studia z doby před přechodem na Theia. Není to fallback pro 1.0.
Osud neurozhodnut — viz `DIRECTION.md` §4.

---

## Kde se testuje bez modelu a kde ne

| Převážně `offline` — ověřitelné bez Ollamy | Převážně `model` — vyžaduje Ollamu |
|---|---|
| #12 Code Intelligence (13/17) | **#2 CRE** (rozhodnuto: bez Ollamy nemá smysl) |
| #13 Governance (11/12) | **#10 Lifecycle** (19 sad `model`) |
| #11 Execution (8/10) | #5 QGv2 (11/24) |
| #16 Nástroje (4/5) · #18a (vše) | #7 Expertizy (9/24) |

---

## Třináct invariantů

Jsou závaznou release podmínkou a vývojovými rails. Ne všechny dnes platí:
otevřený nebo neověřený stav je uveden níže a nesmí se vydávat za splnění. Plné
znění v [`CONTRACT.md`](CONTRACT.md) §2.

1. CRE je jediná autorita — žádná zpráva ji neobejde
2. `mergeExpertisePrompt()` je čistá funkce
3. ExpertiseEnforcer: max 2 retries, temperature decay −0,1
4. 5D vektor `{reasoning, creativity, determinism, riskTolerance, verbosity}`
5. QGv2 je deterministický a idempotentní, bez LLM
6. Patch engine: 3-tier anchor, atomický zápis, plný rollback
7. Execution loop: max 8 iterací
8. Specialista neimportuje interní `src/**` — **M3 candidate splněno.**
   `ToolAdapter` i registry poskytuje host jen jako deklarované capability.
   Rekurzivní package scanner fail-closed odmítá interní, symlink/computed,
   effectful builtin, third-party bare a známé ambient-effect cesty. Přesný
   modulový ratchet má 1 148 hran, 3 cykly a 28 souborů v cyklech. Scanner je
   statická extension hranice, nikoli hostile-code runtime sandbox.
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**
11. Významný efekt zůstává pod přesnou uživatelskou authority — **OPEN_VIOLATION
    jako celek**. M2 a M3 uzavřely project/file/process/Git/network i extension
    efektové cesty. M5 privacy a M6 promotion jsou převedené na offline Ed25519
    receipts a nedůvěryhodnou SQLite cache, ale Decision 041 re-review candidatu
    `73fdf836` skončil `CHANGES_REQUIRED`. Remediation bajtové identity,
    restartových UDF, exact bindings a Git lineage čeká na nové nezávislé
    review. Dokud tato authority není přijatá, passing M2/M3/model programy
    nesmějí L0-11 povýšit na `VERIFIED`.
    Změřeno 2026-08-07: samotné approval route (`POST /api/autonomy/approve/:id`,
    `POST /api/lifecycle/*/approve`, `POST /api/skills/executions/:id/confirm`)
    nemají žádnou per-route kontrolu — chrání je totéž co `GET /api/health`.
    Perzistentní audit efektů neexistuje; jediná audit tabulka `merge_audit_log`
    je o mergích. `docs/review/2026-08-07-AUTH-MATRIX.md`. První M2 kandidát
    `37fab4f9` zavřel absolutní/traversal/symlink a jednoduché path-race bypassy
    pro patch, preview, rollback a dead-import write; invariant však zůstává
    `UNVERIFIED`, dokud neexistuje a neprojde celý effect/approval connector,
    revokace, process/network/Git mediace, audit a uživatelský journey.
12. Žádná tichá background outbound komunikace — **IMPLEMENTATION_GREEN /
    LONG_HORIZON_PENDING**. Global production `fetch` guard je instalovaný před
    optional/background službami. Externí request bez exact scope se durably
    audituje a zastaví před transportem; model discovery zachovává operátorský
    default-on stav, ale má přesný metadata-read scope, tři HTTPS originy a
    append-only decision/terminal audit. Google Fonts egress zůstává odstraněný.
    Změřeno 2026-08-07: 82 `fetch` call sites, z toho 46 skutečně odchozích.
    Default konfigurace pod blokující instrumentací neprovedla **žádné** spojení
    mimo loopback — okno 75 s pokrylo startup, idle, shutdown a 30s agent
    scheduler, **nepokrylo** 5min poll ani 24h cyklus, pro delší horizont je to
    `NOT RUN`. LLM-inicovaný web egress zůstává na M2 hranici unavailable,
    protože query není přesnou autoritou provider fallbacku a redirectů; global
    guard navíc blokuje každý případný legacy bypass.
    `docs/review/2026-08-07-OUTBOUND-CENSUS.md`
13. Učení nerozšiřuje authority, nemění code/config a nekříží projekt bez
    opt-inu — **VERIFIED** na M4 product candidate `286f5ba8`: operátorské
    review prošlo `7/7 REVIEW_PASSED`; produkční learning repository zapisuje
    jen do vlastních `m4_*` tabulek, runtime konzumenti jsou omezení na
    project-bound prompt context a outcome attribution a cross-project cesta
    je fail-closed default-off bez explicitního opt-inu.

---

## Otevřené release-blocking vady

Kanonické místo pro selhání, které je **předchozí, release-blocking a nezpůsobené
právě rozpracovanou změnou** — `CONTRACT.md §10`,
[`agent-protocol.md §12`](docs/development/agent-protocol.md). Každá položka
uvádí padající test nebo bránu, co blokuje, pozorovanou kauzalitu a prioritu.
Detail smí být v samostatném findingu; ten se odsud odkazuje, nenahrazuje tento
seznam. **Nezakládá se na to další sledovací dokument.**

Tahle sekce není totéž co „Známý stav, který se vědomě neřeší" níže: tam patří
věci, u kterých už operátor rozhodl, že se odkládají. Sem patří to, co blokuje
a rozhodnuté není.

Nepatří sem selhání, které `CONTRACT.md §8` označuje jako při vývoji očekávané —
`nightly-orchestrator-self-test` a rozchod se zapečetěným fingerprintem registru.

| Vada | Blokuje | Kauzalita | Priorita |
|---|---|---|---|
| _nic otevřeného_ | — | — | — |

Změřeno 2026-08-22 na `fbbe1e74`, profil `offline,database`, 234 sad:
`{"PASS":229,"FAIL":3,"BLOCKED":2}`. Tři selhání jsou předchozí a prostředím
podmíněná, shodná s baseline před Gate 1 sérií.

Změřeno 2026-08-21 na `f5d0771f`, profil `offline,database`, 231 sad:
`{"PASS":222,"FAIL":7,"BLOCKED":2}`. Všechny čtyři vady výše ověřeny jako
**předchozí** — běh na čistém `43687e6b` ve worktree dal bajtově shodný výstup
selhání. Zapsány podle `CONTRACT.md §10`, neabsorbovány.

Uzavřeno 2026-08-21: **`module-boundary-ratchet`** — všech 29 přidaných hran
zrevidováno a přijato jmenovitě (`--accept-edge`), všechny uvnitř `src/eval/**`
a `src/upgrade/**` z eval série, `removed=0`, smyčky beze změny (`3`/`28`).
Baseline přepsán na `0765ccab`, 1 020 → 1 049 hran. `MODULE_BOUNDARY_RATCHET_PASS`.

Uzavřeno 2026-08-21: **`m1-model-failover-parent-acceptance`** — parent exportuje
pro child přesně vyjmenovaný blob set `CANDIDATE_SOURCE_PATHS`, ale
`src/upgrade/model-failover.js` mezitím začal importovat `src/db/user-settings.js`,
který v seznamu nebyl. Child proto padal na `Cannot find module` a všech šest
selhání byla kaskáda z tohohle jednoho. Tranzitivní uzávěra ověřena skriptem —
chyběl právě ten jeden soubor. 9 failed → 15 passed / 0 failed.

Uzavřeno 2026-08-21: **`harness-exit-code`** — `module-boundary-ratchet.test.js`
jako jediný root test vytvářel temp adresáře bez statického isolation
bootstrapu. Doplněn kanonický import; tím se odkryl evidenční census, zastaralý
nezávisle na téhle práci (pin 95, skutečnost 99 — drift 95→98 přinesly eval
sady z 19.–21. 8.). Fail-closed assertion `unprotected == []` držela po celou
dobu. rc=1 → rc=0.

Uzavřeno 2026-08-21: **`m1-model-binding-application`** — `upgrade/candidate-trial.js`
volal Ollama delete endpoint vlastní cestou a obcházel tím kanonickou identitu
i exclusive mutation autoritu. Mazací funkce se tam teď dostává injekcí
z runtime kontextu (rozhodnutí 019, strict injection), takže bez autority se
fail-closed nemaže a nevzniká modulová hrana. 97/1 → 98/0.

**Změřeno 2026-08-21: `BLOCKED` neznamená rozbité.** Operátor upozornil, že
tyhle cesty se v C3 běžně používaly a testovaly — jen nefungovaly dokonale.
Ověřeno spuštěním: server nastartován a **26 registrovaných `server`-profilových
sad puštěno přímo proti němu**, mimo `nightly-audit` (`server` je tam hard
blocker, který `--no-block` ani `--allow-blocker` neobejdou).

**Výsledek 21 PASS / 5 FAIL.** Health, chat API, konverzace, projekty, přílohy,
expertizy, specialisté, agenti, skills, paměť, notifikace, bezpečnost, kvalita,
export, websocket, security hardening, model upgrade, feedback, drafts,
features a agent execution prošly na první pokus.

Jediné diagnostikované selhání nebylo vadou produktu: `03-conversations`
očekával `200` s prázdným polem u neexistující konverzace, zatímco route vrací
`404` podle [rozhodnutí 012](docs/decisions/012-m1-rehydrate-empty-history-authority.md),
varianta B, schválené operátorem 2026-08-08. Test nesl předrozhodovací C3
očekávání; srovnán, sada je 16/16.

Zbylá čtyři selhání (`19-rate-limit`, `22-autonomy`, `56-chat-with-project`,
`60-ws-chat`, `80-ws-semantic-events`) **nejsou diagnostikovaná** a nesmí se
vydávat ani za vady, ani za zastaralá očekávání, dokud se nezměří.

Zbylá tři selhání a dvě `BLOCKED` sady **vadami nejsou**:

| Sada | Proč to není vada |
|---|---|
| `nightly-orchestrator-self-test` | `CONTRACT.md §8` — rozchod se zapečetěným fingerprintem registru je při vývoji očekávaný stav |
| `nightly-audit-runner-self-test` | Samostatně prochází (`rc=0`). Uvnitř auditu čeká na blocker `toolchain:x11-display`, který se uvnitř auditu nevyrobí — prostředí |
| `vram-coordination` | GPU a prostředí, ne kód |
| `chat-export-budget`, `export-pdf-docx` | `BLOCKED` s deklarovaným `toolchain: python-pdf-runtime`; chybějící runtime je očekávaný, ne vada |

## Známý stav, který se vědomě neřeší

Zaznamenané, rozhodnuté, ne zapomenuté.

Upřesnění 020: výraz „settings authority“ v historickém souhrnném řádku níže
znamená lokálně validující helper, nikoli prokázanou jedinou writer autoritu.
Pět živých mutation cest nad `user_settings` tuto hranici vyvrátilo; závazný
aktuální stav je samostatný řádek `Model failover opt-in surface`.

| Co | Stav |
|---|---|
| Bezpečnost, credentials, privacy incident `P-001`..`P-003` | Odloženo do odladění základu (rozhodnutí operátora) |
| Chybí globální auth guard; `validateApiToken()` je napsaná a nezapojená | Součást téhož balíku. Změřeno 2026-08-07: 251 unikátních route, per-route kontrolu má 7; middleware chain neexistuje (server je `http.createServer` + jedna route tabulka), takže guard má právě jedno možné místo. Most k agent route navíc zahazuje hlavičky. `docs/review/2026-08-07-AUTH-MATRIX.md` |
| WS terminal channel přijímá `exec` po handshaku bez tokenu | Neškodné na loopbacku (invariant 10). Totéž platí pro `control/edit_approve`, který po handshaku **zapisuje soubor**, a pro `chat`. Terminal má capability guard (`shell-security.js` whitelist), ne auth guard |
| Dvě neslučitelné auth sémantiky | `security.js:20-38` je fail-closed, `agents/api.js:18` fail-open. Dnes latentní — tři handlery, které fail-open guard hlídá, nejsou připojené (`GET /api/secrets` → 404) a `mountAgentRoutes()` je mrtvý kód |
| `webhookSecret` uložený v plaintextu v `user_settings` | Šifrování at-rest neexistuje; hodnota se kopíruje do každé zálohy, takže rotace je vratná restorem. `api_tokens` naopak drží jen hash. `docs/review/2026-08-07-SECRET-TYPES.md` |
| Git historie obsahuje `data/c3.db` (+ `-wal`) a jednu přílohu navíc | Mimo `trackedObjectManifest` v `PRIVACY-INCIDENT.json`, který pokrývá containment současného stromu, ne historický rozsah. Vše dosažitelné, obsah neotevřen |
| Skills mají krok `shell`, jinde je shell denied | Zaznamenáno k prověření |
| Rehydrate ACK autorita je neúplná | Server prvních 32 ID ověří, ale delší set tiše usekne a přesto vrátí autoritativní ACK; klient komplement `validIds` maže. Missing i funkční in-memory store mohou stejným způsobem označit vše za neplatné. Běžné UI drží 1–3 panely, reachability je dnes hlavně corrupt/manual persisted state. Schváleno 014/A: durable-store guard, úplný partition nebo typovaný reject a bezpečný local restore; implementace otevřená. |
| Modelová kanonická identita a auto-rebind | **B3 IDENTITY IMPLEMENTED; automatic failover zůstává explicitně default-off:** `name` a `name:latest` sdílejí konzervativní presence identitu, exact artifact authority navíc vždy váže digest. Settings, desired binding, claim recovery, manual binding application, provider effect journal a runtime finalization jsou durable a fail-closed; proof issuance/automatic failover se bez schválených role-suite prahů neaktivuje. M6 Decision 037 doplnila produkční cross-process artifact claims pro všech pět živých use cest včetně VRAM, append-only pull/delete audit, loopback-only destruktivní scope a stalled-pull recovery. Globální Ollama/ComfyUI GPU residency zůstává podle Decision 023/A samostatná kapacitní hranice a není součástí L0-11 artifact-delete tvrzení. |
| Model deletion and retention authority | **M6 L0-11 IMPLEMENTED / RE_REVIEW_REQUIRED:** produkční `modelUseAuthority` se před binding rehydrate váže na SQLite repository z migrace 098. Shared use a exclusive pull/delete claims nesou boot ID, PID, UID a `/proc` start ticks; `BEGIN IMMEDIATE` dává jediného winnera, živý nebo nečitelný owner blokuje a pouze prokazatelně mrtvý/reused owner dostane terminál `OWNER_GONE_RECOVERED`. Gateway, registry validation, binding cutover/verification a VRAM drží shared claim do `finally`; pull/delete drží exclusive claim. Provider intent je durable před prvním efektem a terminál je append-only `SUCCEEDED`, `FAILED` nebo `ORPHANED`. Orphan i intent-only crash fence blokují další use/mutace; 120s pull idle timeout abortuje reader a startup smí obnovit jen stejný exact pull/origin/operation, po úspěchu přidá `RECONCILED_SUCCEEDED`. Destruktivní origin je pouze uncredentialed HTTP loopback; remote/path/query origin selže před inventory. Legacy chat cleanup vrací `MODEL_CLEANUP_CHAT_RETIRED` bez preview/inventory/efektu, protože jeho kandidát byl chráněný one-step rollback. Delete orphan zůstává bezpečně blokující pro operátora, nikoli falešně dokončený. |
| Referenční modelový runtime profil | **B3-PROFILE ACCEPTED / GPU PASS:** fyzický T3 na clean source `31859488` ověřil exact `qwen3.5:27b`, digest `7653528b…ec06e`, `num_ctx=4096`, plnou GPU residency, zakázaný fallback a mid-generation cancel bez false success. Finální B6 provider audit na `d518d7ec` pozoroval jen bezpečný adaptivní kontext `1024/4096`, nikdy hodnotu nad profilem, 8 chat requestů na přesný model a nulový refinement prompt. Malý non-Ollama desktop workload se posuzuje relativně a nebyl ukončen; cizí Ollama, nedostatek VRAM a vysoká utilization zůstávají fail-closed. Sdílená media VRAM authority patří až do M2 a zůstává ve findingu 003. |
| Model failover opt-in surface | **CHANGES_REQUIRED / rozhodnutí 020:** typed `updateModelSettings()` nemá produkčního volajícího a A samotné by ponechalo pět živých mutation cest nad stejným JSON blobem. Ani dnešní B neřeší validní `true`, stale overwrite nebo writer provenance. Doporučená E oddělí revisioned `model_automation_policy`, append-only audit a typed GET/PUT; legacy settings ji nesmí aktivovat ani přepsat a import/reset ji mění jen explicitním verzovaným adaptérem. Detection scheduler zůstává do rozhodnutí default off. Viz [`020`](docs/decisions/020-m1-model-failover-opt-in-surface.md). |
| Token streaming neexistuje — `onLLMToken` je konzument bez producenta | Odpověď přichází celá |
| Nedostupná Ollama při klasifikaci | Opravena na jeden pokus; změřeno přibližně 80 ms místo 6 091 ms |
| Automatické online model discovery | `C3_ENABLE_ONLINE_DISCOVERY`, **default on od 2026-08-19** (operátorské rozhodnutí v `DIRECTION.md`), vypíná se hodnotou `false`. Review remediation je implementation-green na `122b5df5`, ale čeká na re-review: všechny transporty používají manual redirect, každá `Location` dostává nové rozhodnutí a neexportovaná capability váže exact Ollama/Hugging Face/WhatLLM path, query, headers, body a method profily. Opsaný scope literal není autorita. |
| M5 performance release budget | **SECOND-REVIEW REMEDIATION IMPLEMENTED / RE-REVIEW REQUIRED:** `M5PerformanceEvidence@3` a raw v2 vážou každé GPU tvrzení na raw measurement nebo read-only census receipt a nepřijmou nečitelný či nulový RSS jako nejlepší hodnotu. Exact clean candidate `816a2a4c` má autoritativní 5min run: HTTP p95 `5,022 ms`, ProjectContext p95 `32,769 ms`, soak `300 074 ms` / `1 498` vzorků / p95 `14,314 ms`, nula chyb, peak RSS `171,859 MiB`; GPU je pravdivě `not_run_not_requested` s dostupným prázdným `nvidia-smi` censusem, nikoli měřeno. 24h soak, maximum-throughput a nové fyzické GPU měření zůstávají `NOT RUN`. |
| M5 production hardening review | **8/9 REVIEW_PASSED / PRIVACY CHANGES_REQUIRED / KEY CUSTODY CHANGES REQUIRED / ACCEPTANCE_BLOCKED:** osm oddílů zůstává přijatých. Decision 041 byte/history implementace na `37edf30d` dostala nezávislé `REVIEW_PASSED` a trust store má čtyři rozdílné veřejné Ed25519 identity. Úzký review `d81be45f` reprodukoval stale M6 upgrade oracle `80 !== 79`; jeho remediation je implementovaná. Všechny privátní klíče ale zůstávají nešifrované na stejném trvale připojeném `/home` svazku pod účtem aplikace/workerů, takže offline custody není splněná. Osm skutečných rotací, history disposition ani M5 acceptance neproběhly. M6 gate zůstává zavřený. |
| M6 IntentSmith 1.0 candidate | **KEY_CUSTODY_CHANGES_REQUIRED / CURRENT_REGISTRY_RATCHET_REVIEW_PASSED_AT_B23F63D6 / CURRENT_FULL_GATE_GREEN_AT_B23F63D6 / TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED:** Decision 041 remediation dál drží byte/Git-history boundary a integrovaný upgrade kontrakt je po disconnected M7 limiter migraci připnutý na skutečných 95 migrací. Exact candidate `b23f63d6` má 400 ACTIVE+required, profil 339 a celý `offline + database` gate `339/339 PASS`; aktuální ratchet dostal nezávislé `REVIEW_PASSED`. Skutečné demo, approval receipt, plný throughput a live LLM/GPU evidence neproběhly; 24h soak běží izolovaně nad starším exact kandidátem a není přenositelný na nový SHA. Žádný receipt, tag, publish ani push neproběhl. |
| M7 Remote Companion | **CORE_COMPOSITION_REVIEW_PASSED_AT_CAAA14CA / MOBILE_RELEASE_BINDING_REVIEW_PASSED_AT_CAAA14CA / SESSION_AUTHORITY_CONDITIONAL_REVIEW_PASSED_AT_12E1ADFC / DURABLE_LIMITER_REVIEW_PASSED_AT_B23F63D6 / O01_O02_O04_EVENTS_NOTIFICATIONS_REVIEW_PENDING / TRANSPORT_ADMISSION_FULL_GATE_GREEN_REVIEW_PENDING / LATEST_FULL_GATE_GREEN_AT_B23F63D6 / NOT_ACCEPTED / PROVIDER_NOT_ACTIVE / LISTENER_ABSENT:** transport-free session autorita ověřuje Ed25519 podpis každé invocation a samostatný podepsaný challenge request; listener ji stále nekonzumuje. Default composition bez optional portů pravdivě inzeruje `4/7`; genuine přijatý M2 port přidá approvals a nové M1/M3 porty přidávají events a notifications, takže transport-free handler closure umí pokrýt všech `7/7` capability bez aktivace provideru. Admission policy fail-closed připíná TLS 1.3, concrete LAN/VPN bind, private socket peer a exact request hranici. Disconnected limiter atomicky a restart-safe spotřebuje genuine HMAC bucket plan; na `b23f63d6` dostal `REVIEW_PASSED`, ale není připojený k listeneru a nevlastní produkční klíč. Produkční certifikát, listener wiring, key custody, signing/distribuce a device matice ještě neproběhly, proto M7 není accepted. |
| C3 Studio Google Fonts | Oba runtime link loadery, ruční preview import i archivní v7 import jsou odstraněné; hygiene zakazuje obě Google Fonts domény ve spustitelných Studio assetech. Registrovaný runner prošel ve dvou fresh-clone Electron CDP bězích na `7236d221` s nulovým egresssem. Registry zůstává pravdivě `BLOCKED`. **Měřeno 2026-08-21:** build envelope už chybějící překážkou není — `yarn install --offline` + `yarn build` trvají dohromady **54 s** a postaví všech šest artefaktů. **Vyřešeno 2026-08-22: `STUDIO_ELECTRON_BOUNDARY_PASS`.** Příčinou `electron-exited-before-cdp` byla délka `TMPDIR` — Chromium v něm zakládá unix domain sockety a `sun_path` má limit 108 bajtů, runtime root pod `.intentsmith-artifacts` má 95 znaků. Bisekce: `HOME` ani `XDG_*` nevadí, shodí to výhradně `TMPDIR`; bez namespace padá stejně, takže izolace ani D-Bus (falešná stopa) příčinou nebyly. Sada dává Electronu krátký privátní temp. Evidence: nulový egress, 65,8 s soak, boundary matice 403/403/200, čistý shutdown. |
| C3 Studio local HTTP | Root cause byl potvrzen jako capability na wire + nepřítomný `Origin` + `Sec-Fetch-Site: cross-site`. Electron-main nyní doplňuje `Origin: null` jen pro přesný top-level file Studio request s odpovídající privátní capability; backend guard zůstal beze změny. Dva fresh-clone negativní journey na `7236d221` prokázaly startup/POST `2xx` i přesný fail-closed security trojúhelník; registry čeká jen na standardní build envelope, nikoli na další ruční journey. |
| C3 Studio source/build | Operátor přijal funkční ručně udržovaný `lib` jako současný autoritativní runtime. Stale TS je historický archiv; package build/clean/watch ani starý v7 fix payload nesmějí runtime přepsat nebo smazat. Současný vzhled není finální UI kontrakt. |
| C3 Studio current-HEAD runtime | **M1 ACCEPTED / B6 PASS:** produkční ACK `241b39ab` aktivoval exact `m1-wire-v1`; byte bridge je součástí shipped preloadu a postbuild guardu. Standalone fresh clone na `d518d7ec` prošel offline npm/Yarn instalací, produkčním Theia/Electron buildem a jednou B6 evidence envelope. Literal Studio renderer vedl deterministický i modelový turn přes skutečný server, izolovanou SQLite a exact lokální Ollamu; controlled wire backend reprodukoval 2 panely, success, provider error, ordered cancel a reconnect. Síťový census měl nula external/other-loopback/unsupported pokusů, všechny spinnery se vyčistily a Electron i backend skončily bez forced killu. Current UI je funkční M1 baseline, nikoli finální vizuální baseline. Důkaz: `docs/execution/runs/m1-b6-fresh-install-20260823.md`. |
| `multi-source-external.test.js` | Explicitní public-service smoke; není deterministická offline evidence |
| L0-8 specialist boundary | **M3 ACCEPTED / REVIEW_PASSED.** Rozhodnutí 019/A je implementované jako strict capability injection, `ExtensionManifest/Context` a rekurzivní fail-closed scanner všech package JS souborů. Oddíl 7 navíc fail-closed odstavil 13 legacy agent mutation routes a připnul scheduler k `AgentExtensionService.resolveExecution`; všech sedm oddílů má operátorské `REVIEW_PASSED`. Nejde o hostile-code runtime sandbox. Vedle toho zůstává starší zjištění, že 5 nástrojů existuje dvakrát bajtově identicky a core kopie `src/expertises/tools/**` nemá v `src/**` konzumenta. |
| `src/expertises/tools/**` bez konzumenta | Runtime cesta vede přes kopii v balíčku specialisty; core kopii drží naživu jen testy. Disposition `RETAIN`/`RETIRE` nerozhodnuta |
| Self-learning | **M4 ACCEPTED / REVIEW_PASSED na `286f5ba8`:** content-addressed observation/proposal/outcome, append-only authority, explicitní user gate, same-project Code Intelligence producer, verzovaný `ProjectLearningContext`, exact SPEC conformance a durable outcome measurement tvoří jednu uzavřenou smyčku. Reálná SQLite E2E cesta prošla od dvou změn přes approval a plan conformance `0 → 10000` po rollback/delete; nejde o model-quality benchmark. Cross-project retrieval je default off. Osm M4 programů prošlo 73/73 a úplný gate zachoval přesně zděděné `276 PASS / 2 FAIL / 2 BLOCKED`; sedm oddílů nezávisle přijato bez blockeru. `M4-N1` zůstá INFO: slabší SPEC model může na striktním fail-closed conformance kontraktu selhat. |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
| Manual model binding application state | **Backend runtime cutover FRESH-CLONE VERIFIED na `e7d89b5e`; append-only hardening FRESH-CLONE VERIFIED na `bcc9eb84`:** `npm ci --offline` a celá focused/compatibility baterie níže prošly z čistého klonu; migrace 050–053 drží append-only runtime generaci, provider pull intent/outcome a exact-digest verification; legacy override zůstává `LEGACY_UNVERIFIED`. Migrace 053 navíc vlastními signály odmítá `INSERT OR REPLACE` identity kolize ve všech souvisejících auditních journalech, vyžaduje neprázdnou TEXT identitu a nedovolí callerovi zadat event/application/provider-attempt sekvenci. Upgrade před první schema mutací odmítne preexistující `NULL` identitu nebo nekladné pořadí; původ kladné historické hodnoty zpětně prokázat nelze. Provider effect má exact loopback origin, DB-enforced request/actor/current-revision/target authority, obnovovaný pětiminutový claim, fencing a DB-assigned command sequence. No-op receipt atomicky uzavírá celý terminální prefix do připnutého frontieru; pending nebo neuzavřený úspěšný provider command blokuje apply, rollback i jinou desired projekci podle přijatého 018/Q5/A. DB guard chrání projekci přes `UPDATE`, `DELETE` i `INSERT OR REPLACE` a stejná konfliktová cesta nesmí přepsat receipt ani jeho causal junction. Jedna application service vlastní exact local provider, runtime CAS/kompenzaci, HTTP/chat/registry, startup rehydrate, sériovou post-listen verifikaci a commit-layer `model_changed`; staré writery nemají produkčního volajícího. Fresh-clone výsledky zahrnují application 73/73, repository 39/39, storage 16/16, failover schema 13/13, schema migrations 38/38, routes smoke 109/109 a registry 375 programů s fingerprintem `a2f1e67e…f77b8`. HTTP `200 started` následuje durable user-target intent nebo binding operation, nikdy pomocný legacy recovery intent; read-only interní status nekoreluje historický provider failure s novějším bindingem. Proposal post-commit failure se opraví idempotentním replayem bez druhého provider/runtime effectu. Produkční void broadcaster pravdivě končí `APPLIED_NOTIFICATION_DEGRADED`, nikoli falešným doručením; exactly-once WS delivery bez outboxu se netvrdí. Veřejný status/typed-error kontrakt ani Studio rollback surface tento WP nepřidal. Skutečný GPU/Ollama běh nebyl spuštěn. Celý B3/Gate 1 zůstává `BLOCKED` na 015, proof/automatic failover, UI recovery a GPU evidence. |
| Manual binding finalize reconciliation | **FRESH-CLONE VERIFIED na `7c4aa73c`:** review jednotka `0a6bde54..7c4aa73c` prošla nezávislým read-only code/evidence review. Migrace 054 nepovyšuje historický success, přidává append-only `DIRECT_CONFIRMED`/`RECOVERED_BY` receipt a DB blokuje verification/notification bez potvrzení nejnovější runtime generace. Před první mutací navíc vyžaduje úplnou pre-054 trigger autoritu a právě jeden přesný legacy history řádek pro každý změněný `RUNTIME_APPLY`; chybějící i duplicitní stopa fail-close zastaví upgrade. Repository před receipt odvozuje interní `RUNTIME_RECONCILIATION_REQUIRED` s `runtimeFinalizeStatus: UNKNOWN`; veřejný stav zůstává kompatibilně `PENDING` / `NOT_APPLIED`. Application zapisuje receipt po synchronním runtime commitu a před proposal/broadcast/verification; nejasné commit/receipt okno řeší operation-scoped exact startup generation bez druhého pullu nebo nového user-provider intentu. Recovery znovu čte exact provider identitu. Nová post-054 `upgrade_history` vzniká s přímým nebo recovery-confirmed receiptem; pre-054 změněný `RUNTIME_APPLY` musí mít svou původní atomickou history stopu. Čistý lokální klon prošel `npm ci --offline`, focused/compatibility sadami, registry 376 programů, hygiene 1 527 cest a ratchetem 1 016/1 016 hran. Neúspěšný startup recovery nemá schválenou veřejnou degraded/fail-fast policy. Operationless legacy override je dál name-only `LEGACY_UNVERIFIED`; celý M1/Gate 1 zůstává otevřený. |
| Rate limiter je na loopbacku mrtvý kód | Vědomě ponecháno |

---

## Co je zastaralé

`docs/ROADMAP.md`, `docs/convergence/*`, `docs/README.md`, historický `todo.md`
a `docs/archive/*` obsahují **legacy tvrzení**. `AGENTS.md` a `CLAUDE.md` jsou
nyní shodné ukazatele bez stavových claimů. Příklady rozporů, které tento
dokument opravuje:
15 expertíz (skutečně 18) · `chat/cre-decision-types.js` (neexistuje) ·
11 guardů (12) · `cre-decision.js` ~2 900 ř. (4 196) · tabulka intentů se
třemi neexistujícími a sedmi chybějícími · „~98 % hotovo" · „3 500+ verified tests".

Ponechány jako reference. **Autoritou je tento dokument.**
