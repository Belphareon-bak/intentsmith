# IntentSmith — mapa systému

**Základ změřen 2026-08-02 na `17a8b9a8`; pre-fix OS-isolated scan proběhl na
`24457ba2`; registry klasifikace byla opravena v `06309bc8`, post-fix scan
aktuálního registru proběhl na `a85c344f` a izolovaný HTTP/restart baseline na
`ac320335`. Fresh-clone Studio probe proběhl na dokumentačním HEAD `df8f1039`
se zdrojovým stromem shodným s `ac320335`; registrovaný Electron boundary
runner byl znovu fresh-clone ověřen na `7236d221`.**
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
| `nightly-orchestrator-self-test` | ⚠️ **Očekávaný vývojový drift release policy.** Zapečetěný Gate 0 kontrakt fail-closed odmítá non-ACTIVE položky v offline/database required setu ještě před kontrolou fingerprintu. Před M6 se musí PDF runtime sady vrátit do pravdivého ACTIVE stavu a policy znovu zapečetit. |

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
| `src/**/*.js` | **154 374 ř.**, 418 `.js` souborů v checkpointu |
| `tests/**/*.js` | **164 987 ř.**, 370 `.js` souborů v checkpointu |
| Registrovaných testových programů | **375** (`278 ACTIVE`, `82 BLOCKED`, `15 HISTORICAL`) |
| Tabulek v DB / migrací | 103 / 54 |
| HTTP rout | ~230 |
| **Schopností v `ACCEPTED/PASS`** | **1 z 22** (#2 CRE); #1 server/routing/DB je zatím `RUNTIME_VERIFIED` — jeho suite má 13 interních checků, zatímco behavior dokument obsahuje 16 řádků, takže tvrzení „13/13 chování“ není platný akceptační součet |

Aktuální registry fingerprint je
`a2f1e67e4f01c6e834f52eb1b15e10a5eec0893638d167e77baf3a35690f77b8`.
Historický post-fix scan na `a85c344f` zůstává platný pouze pro tehdejší
fingerprint; současný registry řádek sám není akceptační důkaz.

Tool census ze zdroje: **3 JavaScript soubory, 5 694 řádků, 153 top-level
nástrojových deklarací**. Počet 213 v dřívější inventuře byl textový false count.

---

## Lehký capability picture 22/22

Stav je nejsilnější aktuálně doložená příčka, nikoliv procento hotovosti.
`BROKEN` označuje potvrzenou dílčí vadu a může stát vedle příčky. Modulový test
sám nikdy neposouvá schopnost na `USER_JOURNEY_VERIFIED`.

| # | Uživatelské chování | Stav | Nejbližší chybějící důkaz nebo potvrzená vada |
|---|---|---|---|
| 1 | Spustí server na loopbacku, připraví DB a obslouží API. | `RUNTIME_VERIFIED` | Fresh-clone install a přesné sjednocení 16 behavior řádků s důkazy. |
| 2 | CRE vybere hlídaný intent; deterministická cesta nevolá model. | `ACCEPTED/PASS` | Přijaté offline i Ollama behavior sady jsou 10/10 a 9/9. |
| 3 | Modelový požadavek jde na lokální Ollamu nebo skončí typovanou chybou. | `RUNTIME_VERIFIED` | HTTP/WS provider outage, timeout a cancel bez false-success. |
| 4 | Uživatel založí či obnoví konverzaci a historie přežije restart. | `RUNTIME_VERIFIED` | Current-SHA HTTP restart prošel; chybí cancel/error persistence journey. |
| 5 | Výsledek je deterministicky ohodnocen bez přidání nového obsahu. | `RUNTIME_VERIFIED` | Změřit score delta, přínos a latenci refinementu na korpusu. |
| 6 | Chat request projde routingem, syntézou a finalizací do jednoho pravdivého výsledku. | `RUNTIME_VERIFIED` | Celý success/error/cancel/timeout journey přes veřejnou hranici. |
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
| 21 | Ve Studiu chatuje, vidí progress, ruší práci a po reconnectu obnoví stav. | `RUNTIME_VERIFIED` + `BROKEN` | HTTP capability, nulový egress, deterministický WS turn, 65s soak a clean shutdown prošly dvakrát z fresh clone. Chybí dva panely, scoped cancel, reconnect/provider-failure journey a standardní build envelope; jeden dřívější pre-CDP `SIGTRAP` zůstává residual. |

Souhrn: **1 `ACCEPTED/PASS`, 13 `RUNTIME_VERIFIED`, 8 `EXISTS`; 6 řádků
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
| 16 | Nástroje | 5,7k | `tools/` — `registry.js` sám 5 094 ř. / **153 registrovaných nástrojů** |
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
8. Specialista neimportuje interní `src/**` — **aktuálně porušeno** jediným
   vykonávaným importem `specialists/accountant-cz/adapters.js:12` →
   `src/expertises/tool-adapter.js`; chybí fail-closed rekurzivní guard.
   Změřeno 2026-08-07: existující guard (`specialist-loader.js:521-531`) čte
   pouze `manifest.entry`, takže na všech 5 balíčcích vypíše **0 varování**,
   zatímco porušení trvá. `ToolAdapter` má 0 importů a v `ctx` chybí. Oba
   prototypy řešení postavené a spuštěné, výstup shodný s baseline —
   `docs/review/2026-08-07-L0-8-BOUNDARY.md`
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**
11. Významný efekt zůstává pod přesnou uživatelskou authority — **UNVERIFIED
    jako celek**; M2 musí spojit existující mediaci/approval cesty a zavřít bypassy.
    Změřeno 2026-08-07: samotné approval route (`POST /api/autonomy/approve/:id`,
    `POST /api/lifecycle/*/approve`, `POST /api/skills/executions/:id/confirm`)
    nemají žádnou per-route kontrolu — chrání je totéž co `GET /api/health`.
    Perzistentní audit efektů neexistuje; jediná audit tabulka `merge_audit_log`
    je o mergích. `docs/review/2026-08-07-AUTH-MATRIX.md`
12. Žádná tichá background outbound komunikace — **PARTIAL**; background model
    discovery je off a rodičovský deterministický profil byl empiricky
    skenovaný. Google Fonts egress byl odstraněn ze všech trackovaných Studio
    ploch a dva fresh-clone Electron CDP běhy na `7236d221` prokázaly nulový
    external/other-loopback provoz v ohraničeném journey. Explicitní outbound
    plochy však stále nemají jednotnou policy.
    Změřeno 2026-08-07: 82 `fetch` call sites, z toho 46 skutečně odchozích.
    Default konfigurace pod blokující instrumentací neprovedla **žádné** spojení
    mimo loopback — okno 75 s pokrylo startup, idle, shutdown a 30s agent
    scheduler, **nepokrylo** 5min poll ani 24h cyklus, pro delší horizont je to
    `NOT RUN`. Nejtěžší zbývající plocha je LLM-inicovaný egress: `executeWebSearch`
    a web scrape v tool executoru nemají síťový gate.
    `docs/review/2026-08-07-OUTBOUND-CENSUS.md`
13. Učení nerozšiřuje authority, nemění code/config a nekříží projekt bez
    opt-inu — **UNVERIFIED**; M4 vyžaduje negativní boundary testy

---

## Známý stav, který se vědomě neřeší

Zaznamenané, rozhodnuté, ne zapomenuté.

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
| Modelová kanonická identita a auto-rebind | **B3-IDENTITY, settings authority, storage schema, inertní repository/CAS, expired-claim recovery, measurement policy, izolovaný measurement runner a parent acceptance jsou implementovány; automatic runtime failover není aktivní:** `name` a `name:latest` se shodují v bindingu, overview, informačních validation/usage lookupách, registry delete/auto-clean, `getUnusedOldModels()` i direct system-route fallbacku; jiné explicitní tagy a fuzzy rodinné varianty se neslučují. Integrity check je detection-only a prázdná Ollama je `INCONCLUSIVE`. `src/db/user-settings.js` povolí opt-in jen pro literal boolean `true` v platném dokumentu. Migrace 046 odděluje versioned desired binding, incident state, append-only eventy a digest-bound role-suite proof; DB odmítne active projection i `verified` audit bez obsahově shodného proofu. Migrace 047 navíc přijme `CLAIM_EXPIRED` jen pro přesný claim po striktně překročené expiry. Repository atomicky pozoruje pouze existující config/legacy desired binding, zakládá detection, přiděluje ohraničené claims a auditovaně uvolní expirovaný claim přes `BEGIN IMMEDIATE`; reálné worker races prokázaly jednoho claim winnera i jeden expiry release s přesným idempotentním retry. Nový claim je samostatný CAS a může jej legitimně získat jiný worker. Manual apply/rollback repository a runtime application jsou popsány samostatně v řádku `Manual model binding application state`; automatic activation/restore je nadále vypnutá. Measurement policy raw-byte pinuje zdroje, verzovaný canonical JSON a přesnou mapu 7 rolí na 36 seřazených testů; role-specific prahy i TTL jsou pod defaultem C `null` a issuance je vypnuté. Child spouští právě jednu roli, dovolí jen vlastní IPv4 loopback `GET /api/tags` a `POST /api/chat`, zachytí skutečný randomizovaný prompt a ověří ordered suite i digest. Parent bere provider z configu, model/digest ze strict inventory a revision z čistého Git kandidáta; child a policy načte z privátního exportu přesných HEAD blobů a přijme jen exit 0, shodný inventory, pět pinů a jediný immutable mode-0400 artifact. Receipt je stále výslovně `NOT_ISSUED` s nulovým proof/failover efektem. Migrační preflight je před 049 implementovaný a attestovaný podle rozhodnutí 016; migrace 049 na úrovni DB vynucuje exact operation + desired + SUPERSEDED_BY_USER + terminal CAS a immutable terminal state. Stále neexistuje proof issuer/persistence, terminal automatic activation/restore, opt-in consumer ani scheduler. Rozhodnutí 015 čeká na schválené role-suite prahy a proof TTL. Generický `/api/settings` zůstává whole-document writer mimo schválený B3 scope a name-only score není digest-bound verification. Otevřený je i `PENDING-OWNER` atomický závod chatového cleanupu (`docs/findings/006-model-cleanup-bypasses-registry-guard.md`) a nesourodé SQLite/ISO timestampy age-based cleanupu (`docs/findings/007-model-cleanup-timestamp-ordering.md`). L0-9 se nemění. |
| Referenční modelový runtime profil | **B3-PROFILE implementováno, GPU evidence otevřená:** exact `qwen3.5:27b` má commitnutý sedmipoložkový profil s digestem, kalibračním stropem `num_ctx=4096`, 1 024 MiB headroomem, 100% GPU residency a zákazem fallbacku. Cache a request mohou kontext snížit, ne zvýšit; legacy i M1 gateway sdílejí resolver. Compaction používá jeden snapshot pro threshold, truncation, model/wire context a post-fill. Profil záměrně neobsahuje odhad vah/KV a bez trusted footprintu zůstává produkční preflight `UNKNOWN/VRAM_FOOTPRINT_UNKNOWN`; nový T3 GPU běh nebyl spuštěn. Media VRAM authority může cache později snížit a zůstává v `docs/findings/003-m1-vram-policy-is-duplicated.md`. |
| Token streaming neexistuje — `onLLMToken` je konzument bez producenta | Odpověď přichází celá |
| Nedostupná Ollama při klasifikaci | Opravena na jeden pokus; změřeno přibližně 80 ms místo 6 091 ms |
| Automatické online model discovery | `C3_ENABLE_ONLINE_DISCOVERY`, default off; ostatní explicitní outbound plochy čekají na jednotnou policy |
| C3 Studio Google Fonts | Oba runtime link loadery, ruční preview import i archivní v7 import jsou odstraněné; hygiene zakazuje obě Google Fonts domény ve spustitelných Studio assetech. Registrovaný runner prošel ve dvou fresh-clone Electron CDP bězích na `7236d221` s nulovým egresssem. Registry zůstává pravdivě `BLOCKED`, dokud standardní auditní orchestrátor nedodá build envelope. |
| C3 Studio local HTTP | Root cause byl potvrzen jako capability na wire + nepřítomný `Origin` + `Sec-Fetch-Site: cross-site`. Electron-main nyní doplňuje `Origin: null` jen pro přesný top-level file Studio request s odpovídající privátní capability; backend guard zůstal beze změny. Dva fresh-clone negativní journey na `7236d221` prokázaly startup/POST `2xx` i přesný fail-closed security trojúhelník; registry čeká jen na standardní build envelope, nikoli na další ruční journey. |
| C3 Studio source/build | Operátor přijal funkční ručně udržovaný `lib` jako současný autoritativní runtime. Stale TS je historický archiv; package build/clean/watch ani starý v7 fix payload nesmějí runtime přepsat nebo smazat. Současný vzhled není finální UI kontrakt. |
| `multi-source-external.test.js` | Explicitní public-service smoke; není deterministická offline evidence |
| L0-8 specialist boundary | Potvrzeně porušený; strict injection versus public extension SDK vyžaduje rozhodnutí operátora. **Evidence pro `§14` je od 2026-08-07 kompletní** — import graph, oba prototypy postavené a spuštěné, srovnávací tabulka. Vedle toho zjištěno, že 5 nástrojů existuje dvakrát bajtově identicky a core kopie `src/expertises/tools/**` nemá v `src/**` konzumenta |
| `src/expertises/tools/**` bez konzumenta | Runtime cesta vede přes kopii v balíčku specialisty; core kopii drží naživu jen testy. Disposition `RETAIN`/`RETIRE` nerozhodnuta |
| Self-learning | PatternTracker má produkční zápisy, ale `getRelevantPatterns()` nemá produkčního volajícího; `pattern-miner.js` nemá produkční import a cross-project learner nemá prokázanou smyčku. M4 vyžaduje jeden uzavřený same-project E2E. |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
| Manual model binding application state | **Backend runtime cutover FRESH-CLONE VERIFIED na `e7d89b5e`; append-only hardening FRESH-CLONE VERIFIED na `bcc9eb84`:** `npm ci --offline` a celá focused/compatibility baterie níže prošly z čistého klonu; migrace 050–053 drží append-only runtime generaci, provider pull intent/outcome a exact-digest verification; legacy override zůstává `LEGACY_UNVERIFIED`. Migrace 053 navíc vlastními signály odmítá `INSERT OR REPLACE` identity kolize ve všech souvisejících auditních journalech, vyžaduje neprázdnou TEXT identitu a nedovolí callerovi zadat event/application/provider-attempt sekvenci. Upgrade před první schema mutací odmítne preexistující `NULL` identitu nebo nekladné pořadí; původ kladné historické hodnoty zpětně prokázat nelze. Provider effect má exact loopback origin, DB-enforced request/actor/current-revision/target authority, obnovovaný pětiminutový claim, fencing a DB-assigned command sequence. No-op receipt atomicky uzavírá celý terminální prefix do připnutého frontieru; pending nebo neuzavřený úspěšný provider command blokuje apply, rollback i jinou desired projekci podle přijatého 018/Q5/A. DB guard chrání projekci přes `UPDATE`, `DELETE` i `INSERT OR REPLACE` a stejná konfliktová cesta nesmí přepsat receipt ani jeho causal junction. Jedna application service vlastní exact local provider, runtime CAS/kompenzaci, HTTP/chat/registry, startup rehydrate, sériovou post-listen verifikaci a commit-layer `model_changed`; staré writery nemají produkčního volajícího. Fresh-clone výsledky zahrnují application 73/73, repository 39/39, storage 16/16, failover schema 13/13, schema migrations 38/38, routes smoke 109/109 a registry 375 programů s fingerprintem `a2f1e67e…f77b8`. HTTP `200 started` následuje durable user-target intent nebo binding operation, nikdy pomocný legacy recovery intent; read-only interní status nekoreluje historický provider failure s novějším bindingem. Proposal post-commit failure se opraví idempotentním replayem bez druhého provider/runtime effectu. Produkční void broadcaster pravdivě končí `APPLIED_NOTIFICATION_DEGRADED`, nikoli falešným doručením; exactly-once WS delivery bez outboxu se netvrdí. Veřejný status/typed-error kontrakt ani Studio rollback surface tento WP nepřidal. Skutečný GPU/Ollama běh nebyl spuštěn. Celý B3/Gate 1 zůstává `BLOCKED` na 015, proof/automatic failover, UI recovery a GPU evidence. |
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
