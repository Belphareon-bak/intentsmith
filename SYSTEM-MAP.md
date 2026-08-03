# IntentSmith — mapa systému

**Základ změřen 2026-08-02 na `17a8b9a8`; pre-fix OS-isolated scan proběhl na
`24457ba2`; registry klasifikace byla opravena v `06309bc8`, post-fix scan
aktuálního registru proběhl na `a85c344f` a izolovaný HTTP/restart baseline na
`ac320335`. Fresh-clone Studio probe proběhl na dokumentačním HEAD `df8f1039`
se zdrojovým stromem shodným s `ac320335`.**
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
- šest běžných Studio HTTP requestů vracelo `403`, protože browser request na
  wire nenesl local capability header. Kontrolní opaque-origin request bez
  capability vrátil `403`, s platnou capability `200`; backendová hranice je
  tedy správně fail-closed a rozbitá je browser delivery cesta.

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

---

## Rozsah

| | |
|---|---:|
| `src/**/*.js` | **144 944 ř.**, 405 souborů |
| `tests/**/*.js` | **143 023 ř.**, 351 trackovaných `.js` souborů |
| Registrovaných testových programů | **356** (`260 ACTIVE`, `81 BLOCKED`, `15 HISTORICAL`) |
| Tabulek v DB / migrací | 95 / 47 |
| HTTP rout | ~230 |
| **Schopností v `ACCEPTED/PASS`** | **1 z 22** (#2 CRE); #1 server/routing/DB je zatím `RUNTIME_VERIFIED` — jeho suite má 13 interních checků, zatímco behavior dokument obsahuje 16 řádků, takže tvrzení „13/13 chování“ není platný akceptační součet |

Registry fingerprint po pravdivém external splitu je
`35c590edcd7de9ecab6db870a0118e3ae67ff37ea99f58943c6b180ea04c60f4`.
Post-fix scan jej váže na `a85c344f`; `lastGreen.commit` však zůstává prázdný a
registry řádek sám proto není akceptační důkaz. Report SHA-256 je
`a3af7b8531509c8be753ac87920dbeab9a5ac133d10634664a078c8c99925535`.

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
| 21 | Ve Studiu chatuje, vidí progress, ruší práci a po reconnectu obnoví stav. | `RUNTIME_VERIFIED` + `BROKEN` | Fresh-clone initial boot, WS a deterministický chat prošly; HTTP capability delivery vrací 403, Google Fonts vytváří tichý outbound a stabilita/clean shutdown nejsou prokázané. |

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
   vykonávaným importem `specialists/accountant-cz/adapters.js` →
   `src/expertises/tool-adapter.js`; chybí fail-closed rekurzivní guard
9. Model upgrade nikdy neupgraduje sám
10. **Legacy listener nikdy neopustí loopback**
11. Významný efekt zůstává pod přesnou uživatelskou authority — **UNVERIFIED
    jako celek**; M2 musí spojit existující mediaci/approval cesty a zavřít bypassy
12. Žádná tichá background outbound komunikace — **PARTIAL**; background model
    discovery je off a rodičovský deterministický profil byl empiricky
    skenovaný, ale C3 Studio bundle bez opt-inu vkládá Google Fonts URL a
    explicitní outbound plochy ještě nemají jednotnou policy
13. Učení nerozšiřuje authority, nemění code/config a nekříží projekt bez
    opt-inu — **UNVERIFIED**; M4 vyžaduje negativní boundary testy

---

## Známý stav, který se vědomě neřeší

Zaznamenané, rozhodnuté, ne zapomenuté.

| Co | Stav |
|---|---|
| Bezpečnost, credentials, privacy incident `P-001`..`P-003` | Odloženo do odladění základu (rozhodnutí operátora) |
| Chybí globální auth guard; `validateApiToken()` je napsaná a nezapojená | Součást téhož balíku |
| WS terminal channel přijímá `exec` po handshaku bez tokenu | Neškodné na loopbacku (invariant 10) |
| Skills mají krok `shell`, jinde je shell denied | Zaznamenáno k prověření |
| Rehydrate vrací conversation ID bez ověření v DB | Zaznamenáno |
| Token streaming neexistuje — `onLLMToken` je konzument bez producenta | Odpověď přichází celá |
| Nedostupná Ollama při klasifikaci | Opravena na jeden pokus; změřeno přibližně 80 ms místo 6 091 ms |
| Automatické online model discovery | `C3_ENABLE_ONLINE_DISCOVERY`, default off; ostatní explicitní outbound plochy čekají na jednotnou policy |
| C3 Studio Google Fonts | `c3-chat-panel/lib/browser/chat-panel-module.js` vkládá dvě `fonts.googleapis.com` URL bez opt-inu; potvrzené otevřené L0-12 porušení pro M0/M1 |
| C3 Studio local HTTP | Skutečný renderer má bootstrap i validní capability, ale šest změřených HTTP requestů ji neposílá a končí 403; WS a deterministický chat přitom fungují. Browser delivery se musí opravit bez oslabení fail-closed backend boundary. |
| C3 Studio source/build | Funkční ručně udržovaný `lib` je skutečný entrypoint a clean product build jej zachová; stale TS package build je nekompilovatelný a jeho spuštění by po povrchní opravě mohlo funkční UI přepsat. |
| `multi-source-external.test.js` | Explicitní public-service smoke; není deterministická offline evidence |
| L0-8 specialist boundary | Potvrzeně porušený; strict injection versus public extension SDK vyžaduje rozhodnutí operátora |
| Self-learning | PatternTracker má produkční zápisy, ale `getRelevantPatterns()` nemá produkčního volajícího; `pattern-miner.js` nemá produkční import a cross-project learner nemá prokázanou smyčku. M4 vyžaduje jeden uzavřený same-project E2E. |
| Lineární matching rout, regex per request | Naměřeno 0,87 ms — vědomě ponecháno |
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
