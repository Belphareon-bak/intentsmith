# Nezávislost modulů — konsolidovaný podklad

**Revision:** `f9aa50ef` · **Datum:** 2026-08-08 · **verze 2**
**Graf přeměřen** na této revision registrovaným měřidlem P6 (411 modulů,
1 000 vnitřních hran, 3 cykly / 28 souborů — SCC beze změny proti 2026-08-07).
**Adresát:** operátor · vlastník `WP-M3-BOUNDARY`
**Navazuje na:** [`2026-08-07-MODULE-GRAPH.md`](2026-08-07-MODULE-GRAPH.md) ·
[`2026-08-07-L0-8-BOUNDARY.md`](2026-08-07-L0-8-BOUNDARY.md) ·
[`CONTRACT.md §6`](../../CONTRACT.md) · [`ROADMAP.md §14`](../../ROADMAP.md)

> **Tento dokument není evidence** ve smyslu [`docs/review/README.md`](README.md).
> Je to vstup rozhodnutí. Konsoliduje dvě read-only analýzy a operátorské
> upřesnění cílového modelu do jednoho podkladu, na kterém se dá stavět.
> Disposition nerozhoduje.

---

## Shrnutí pro rozhodnutí

Tři věci.

**1. Cílový model je „nezávislé moduly hostované povinným jádrem", ne
„samostatně spustitelné služby".** Operátorské upřesnění z 2026-08-08:

```text
core bez optional modulu            → musí fungovat
core + kompatibilní optional modul  → musí fungovat
optional modul bez core             → nepodporovaný scénář
optional modul proti fake Core API  → pouze izolovaný contract test
```

Optional modul nemusí mít vlastní server, DB, LLM klienta ani umět vytvořit
samostatný produkt. Fake jádro v unit testu neznamená samostatnost — jen
umožňuje vývoj modulu bez bootování celého IntentSmithu při každé změně. Skutečné
E2E je vždy `core + modul + Ollama`. Tím padá polovina obvyklé modularizační
ceny: kontrakt potřebuje jen jeden směr a fake adaptér jen jedna strana.

**2. Blokace nejsou importy.** Import graph je nejviditelnější, ale nejlevnější
vrstva. Skutečné blokace jsou sdílený mutovatelný `config`, přímý přístup do
společné DB, tři různé implementace téže operace, eager boot a chybějící
vynucení hranice. Bez nich by přesuny souborů byly kosmetika.

**3. Většina práce už má jméno.** `WP-M3-BOUNDARY` v roadmapě už má na starosti
`ExtensionManifest/Context` a fail-closed registrační hranici a čeká na
operátorské rozhodnutí L0-8. Měřidlo grafu existuje. Kontraktový vzor existuje
v `contracts/m1`. Nové jsou proti dnešní roadmapě tři věci: **boundary ratchet**,
**model binding jako vlastněný řez** a **disabled-boot test**.

---

## 1. Model nezávislosti

```text
  HTTP / WS / Studio adaptéry
              │
              ▼
  JÁDRO (vždy instalované; Ollama je runtime capability, ne podmínka bootu)
    Conversation · Chat · CRE · Project lifecycle · model binding
              │  publikuje verzovaný povrch
              ├── CoreEvent / ObservationEvent
              ├── ModelBindingQuery / BindingCommand
              ├── Lifecycle commands + results
              └── Approval + povinný effect audit
              ▲  konzumují, připínají se na verzi
  ODPOJITELNÉ MODULY
    observability sink · model testing · model discovery/update
    autonomy · skills · agenti · specialisté · marketplace · média
```

Pravidla, která z toho plynou:

- **Zdrojová závislost je jednosměrná; data nikoliv.** Pravidlo zní: *jádro
  nesmí importovat ani pojmenovávat implementaci odpojitelného modulu.* Události
  naopak běžně tečou z jádra ven — `CoreEvent` do observability, modelový stav
  do model testingu, lifecycle event do notifikací. Jádro přitom volá **jen
  vlastní abstrakci nebo event bus**; sink implementuje modul a předá ho při
  registraci composition rootu. Zdrojová hrana tedy zůstává
  `optional → core-contract`, i když runtime událost jde opačně.
- **Ollama je povinná runtime capability modelového chování jádra, ne podmínka
  úspěšného bootu.** Při nedostupnosti jádro nastartuje a vrací
  `LLM_PROVIDER_UNAVAILABLE` — [`DIRECTION.md:121`](../../DIRECTION.md),
  `PRODUCT.md §3` („degradovat srozumitelně"). Rozhodnutí „fake LLM klient se
  pro CRE nestaví" ([`DIRECTION.md:189`](../../DIRECTION.md)) platí jen pro
  **kvalitu a sémantiku CRE rozhodování**. Bez Ollamy se testovat musí: boot,
  timeout a cancel, unavailable degradace, validace kontraktů, lifecycle
  repository a workspace adaptéry, disabled optional moduly.
- **Porty nejsou pro náhraditelnost runtime.** Existují kvůli testovatelnosti
  lifecycle a odpojitelných modulů. Jinak by z nich vznikl aparát bez
  prokázaného přínosu.
- **Odpojený modul musí zmizet z boot grafu, ne z disku.** Smí zůstat
  nainstalovaný a jen disabled, pokud ho jádro vůbec nenačte. Musí zmizet
  z: import grafu jádra, routingu, timerů a background jobů, session state,
  pending confirmations, DB zápisů a externích efektů. Dnešní feature flag,
  po jehož vypnutí zůstává statický import v `server.js`, to nesplňuje.

## 2. Sedm podmínek v asymetrické podobě

| # | Podmínka | Platí pro | Dnešní stav |
|---|---|---|---|
| 1 | Jádro neimportuje ani nepojmenovává implementaci odpojitelného modulu; žádný nový cyklus | oba směry | částečně, bez vynucení |
| 2 | Modul vlastní svůj zapisovaný stav a jeho migrace | oba | ne |
| 3 | Komunikace přes připnutý verzovaný kontrakt | jádro publikuje, modul konzumuje | jen `contracts/m1` |
| 4 | Testy modulu běží proti fake jádru, bez serveru a produkční DB | jen odpojitelné | částečně |
| 5 | Jádro nastartuje bez modulu; modul bez deklarované schopnosti selže deklarovaně | asymetricky | ne |
| 6 | Manifest deklaruje podporovaný rozsah jádra a loader ho fail-closed ověří | **všechny odpojitelné**; formální `N/N−1` jen marketplace + Remote | ne |
| 7 | Samostatný artefakt, loader, upgrade, rollback, datová migrace | jen odpojitelné | ne |

Podmínka 5 je hlavní přejímací kritérium celého směru a je jako jediná
měřitelná dnes. Podmínky 6–7 se **nevztahují na jádro** — jádro a jeho
konzumenti se instalují společně.

## 3. Změřený stav

Graf přeměřen registrovaným měřidlem P6 na `f9aa50ef`: **411 modulů, 1 000
vnitřních hran, 3 cykly / 28 souborů**. Cyklová struktura je proti
[`2026-08-07-MODULE-GRAPH.md`](2026-08-07-MODULE-GRAPH.md) (407/992) beze změny;
ostatní čísla jsou přeměřená na téže revision.

| Fakt | Hodnota | Význam |
|---|---|---|
| Chat pipeline je jeden cyklus | 21 modulů, vtahuje `executor/tool-executor.js` a `specialists/specialist-loader.js` | Handlery nelze z jádra vytahovat po jednom |
| Další cykly | `chat/safety` 5 modulů, `planner/index ↔ lifecycle-build` 2 | Malé, oddělitelné |
| Cykly na úrovni adresářů | chat↔planner 35:1, chat↔llm 15:3, chat↔executor 1:1, chat↔specialists 1:1 | Čtyři back-edge jsou zatoulané utility pod `chat/handlers/utils/`, dvě jsou veřejný povrch CRE |
| `src/config.js` | 33 souborů importuje; `upgrade-manager` do něj za běhu **zapisuje** | Sdílený mutovatelný stav napříč moduly |
| `src/db/database.js` | 26 vnitřních + 29 vnějších konzumentů, 17 symbolů; import okamžitě otevře DB a spustí migrace | Import-time side effect + široká hranice |
| `src/core/logger.js` | 184 konzumentů, **1 symbol** | Nejlevnější existující kontrakt v repu |
| Barrel soubory | 11 souborů, 11 hran skrz, 97 kolem | Deklarovaná hranice bez vynucení |
| Import-boundary test | neexistuje | `tests/import-map.test.js` je promptová feature, `tests/architecture-check.test.js` checker cizích projektů |

## 4. Čtyři vady, které z toho plynou

**V1 — lifecycle má tři divergentní vstupy.**
[`routes/expertises.js:518`](../../src/routes/expertises.js) nečeká na
`static async create()` ([`planner/lifecycle.js:245`](../../src/planner/lifecycle.js)),
takže `startSpec()` dostane Promise a odpověď vrací `lifecycleId: undefined` —
endpoint nefunguje ani v happy pathu. Navíc předává `config` místo
`lifecycleConfig` a neposílá `projectPath`. Jedenáct volání `resume()` v témže
souboru vytváří `GitManager(undefined)`.
[`routes/projects.js:382`](../../src/routes/projects.js) obchází
`ProjectLifecycle` úplně a zapisuje lifecycle přímo přes `db.db.prepare()`.
Chatová cesta ([`chat/handlers/lifecycle-router.js:248`](../../src/chat/handlers/lifecycle-router.js))
je jediná správná, ale při chybějícím `context.projectPath` si vymyslí
`tmpdir()/lc-<ts>` — Git repozitář mimo uživatelem pojmenovaný rozsah,
kandidát na L0-11.

**V2 — model binding se zapisuje jako ověřený před ověřením.**
[`upgrade-manager.js:533`](../../src/upgrade/upgrade-manager.js) nastaví
`verified = true` natvrdo, `_persistOverride()` (`:826`) použije
`INSERT OR REPLACE` nad sloupcem s `DEFAULT 1`
([migrace 036](../../src/db/migrations/2026_03_12_036_v125_model_verified.js)).
Každý apply — včetně HTTP — tedy zapíše `verified=1` dřív, než verifikace
začne; background verify to nanejvýš později přepne na 0. Existující test
[`upgrade-ux-v125.test.js:345`](../../tests/upgrade-ux-v125.test.js) tuto
sémantiku konzervuje, takže oprava musí změnit kód, kontrakt i test.
Cesty se navíc liší schopností: HTTP posílá `onPullProgress`
([`routes/system.js:870`](../../src/routes/system.js)), chat ne
([`pre-handler.js:304`](../../src/chat/handlers/pre-handler.js)), takže chat
na neinstalovaném modelu spadne. `skipVerify` `applyUpgrade()` nečte, ale dvě
ze tří cest ho posílají; v `rollbackUpgrade()` (`:591`) živý je.
Po `0915c542` nemá `model-registry.assignModel()` (`:439`) žádného volajícího.

**V3 — telemetry a policy tuning jsou smíchané.** `TurnTelemetry` vzniká jen
v [`ws-bridge/session-adapter.js:200`](../../src/ws-bridge/session-adapter.js);
HTTP `/api/chat` stejnou cestu nemá. Autonomy je sice opt-in a default OFF
([`config.js:23`](../../src/config.js)), ale po dosažení trust threshold volá
`creEngine.setOverrideThreshold()`
([`autonomy/controller.js:233`](../../src/autonomy/controller.js), obnova při
bootu na `:42`). To je aktivní ladění policy, ne pasivní observability, a je to
přímá hranice L0-13.

**V4 — odpojení dnes neexistuje, jen vypnutí.** [`server.js:110-127`](../../src/server.js)
staticky importuje všechny route moduly bez ohledu na flagy; podmíněná je až
registrace (`:816`). Pre-handler zná jména volitelných modulů natvrdo
([`pre-handler.js:56/89/101`](../../src/chat/handlers/pre-handler.js)). Vypnutý
modul zůstává v grafu jádra.

## 5. Co už existuje a nemá se stavět znovu

| Existuje | Kde | Použít na |
|---|---|---|
| Měřidlo modulového grafu | [`2026-08-07-module-graph.mjs`](2026-08-07-module-graph.mjs) | Základ ratchetu; nepsat nový scanner |
| Kontraktový vzor s verzí, stage a exact-key validací | [`contracts/m1/`](../../contracts/m1/) | Šablona pro další kontrakty jádra |
| `WP-M3-BOUNDARY` s `ExtensionManifest/Context` | `ROADMAP.md §14` | Domov pro extension hranici |
| Pravidlo „connector mění jediný vlastník, konzument je připnutý" | `CONTRACT.md §6` | Pravidlo je zapsané, chybí aplikace mimo chat/model |
| Otevřené rozhodnutí L0-8 (strict DI vs. veřejné extension API) | [`2026-08-07-L0-8-BOUNDARY.md`](2026-08-07-L0-8-BOUNDARY.md) | Je to táž otázka jako rozhodnutí R3 níže |
| `B3-FAILOVER` s požadavkem desired/active a pravdivého verify | `ROADMAP.md` | Domov pro opravu V2 |

## 6. Rozhodnutí, která to potřebuje

Všechna vznikla podle protokolu M1 jako **BLOCK** — mění nebo zužují přijaté
rozhodnutí, případně vykládají L0. Stav k 2026-08-08:

| Stav | Položky |
|---|---|
| **ACCEPTED** (operátor, 2026-08-08) | asymetrický model §1 · **R1** · **R8** |
| **DEFERRED na konkrétní WP** | R2 → krok C · R3 → `WP-M3-BOUNDARY` (je to táž otázka jako otevřené L0-8) · R4, R5, R6 → krok E · R7 → krok F |
| **OPEN** | žádná mimo výše uvedené |

`DEFERRED` neznamená rozhodnuto. Znamená, že rozhodnutí má přiřazený WP a
uzavře se před jeho prvním zapisujícím commitem, ne dřív. Zejména **osud
`/api/lifecycle/start` (R5) rozhodnutý není** — obě varianty zůstávají
na stole.

| # | Rozhodnutí | Návrh | Proč blokuje |
|---|---|---|---|
| R1 | **Doménový seznam jádra** | znění v §6.1; expertises jsou **odpojitelný modul** | Je nutným vstupem cestové mapy, ale sám ještě neurčuje přesné soubory pro směrové pravidlo |
| R2 | **Zúžit „`cre-decision.js` se nedělí"** na „nedělí se rozhodovací logika" | Vydělit jen verzovaný slovník `DecisionType`, `IntentType`, `ToolType` a decision envelope; registrace přes `CreToolRegistryPort`; původní symboly dočasně re-exportovat | Mění přijaté rozhodnutí [`DIRECTION.md:190`](../../DIRECTION.md) |
| R3 | **Contract vs. port vs. DI** | Veřejný kontrakt jen pro povrch jádra a extension manifest; interní repository jsou privátní detail modulu injektovaný z composition rootu | Je to táž otázka jako otevřené L0-8 |
| R4 | **Lifecycle cesta** | Command nese `projectId`; service načte kanonickou cestu z `ProjectRepository`; neexistující projekt nebo cesta = explicitní odmítnutí; `tmpdir()` fallback zrušit | Ruší dnešní chování a dotýká se L0-11 |
| R5 | **Osud `/api/lifecycle/start`** | Buď sjednotit, nebo retire s `410`. Neopravovat třetí paralelní implementaci | Odebrání endpointu je změna veřejného povrchu |
| R6 | **Fake LLM** | „Fake klient se nestaví" platí pro kvalitu a sémantiku CRE rozhodování; neplatí pro LLM adaptér lifecycle a workflow ani pro boot, cancel, degradaci, validaci kontraktů a disabled moduly | Zužuje [`DIRECTION.md:189`](../../DIRECTION.md) |
| R7 | **Autonomy** | Autonomy jen vydá `CrePolicyChangeProposal`; aplikace přes explicitní approval s odvolatelným scope | Mění dnešní auto-apply, výklad L0-13 |
| R8 | **Rozsah nezávislého upgradu** | Manifest s deklarovaným rozsahem má **každý** odpojitelný modul a loader ho ověří fail-closed (§6.2); formální `N/N−1` garanci mají jen marketplace a Remote Companion; vestavěné moduly smějí mít užší rozsah, ale nesmějí se načíst proti nekompatibilnímu jádru | Zužuje jinak neomezený scope; brání aparátu bez přínosu |

### 6.1 Doporučené znění R1

> Funkční jádro tvoří **Conversation/Chat, CRE a Project Lifecycle**. Jejich
> nutnou infrastrukturou jsou composition root, publikované core kontrakty,
> LLM gateway a aktivní model binding, project identity/scope, persistence
> kernel a effect/approval/audit boundary. **Expertises jsou odpojitelný
> modul**; jádro vlastní pouze obecnou extension a prompt-contribution hranici.

Proč expertises ven: `PRODUCT.md §2` zásada 6 je řadí mezi rozšíření přes
verzované kontrakty a `§3` je uvádí v sekci Rozšiřitelnost, ne jako podmínku
základního chatu. Osmnáct importních hran dokládá dnešní provázanost, ne
doménovou nutnost. L0-2 říká, že `mergeExpertisePrompt()` je čistá funkce —
neříká, kde leží.

| V jádře | V odpojitelném expertise modulu |
|---|---|
| `ExtensionManifest/Context` | builtin expertizy |
| obecný `PromptContribution` kontrakt | store a wizard |
| `DecisionHint` / routing proposal, který CRE smí odmítnout | auto-selection |
| validace capabilities | `mergeExpertisePrompt()` |
| konečná autorita CRE | compatibility a capability enforcery |
| namespacovaný extension state | expertise handler, integrace se specialisty |
| | vlastní repository a migrace |

L0-2 zůstává závazným contract testem expertise modulu. Vypnutý modul znamená,
že chat, CRE a lifecycle pokračují bez auto-selection, expertise rout, store
a handleru.

**Cena:** není to přesun jednoho souboru. `SessionState` i CRE mají dnes
expertise-specific pole a chat pipeline je součástí 21modulového SCC. Patří to
proto celé do `WP-M3-BOUNDARY`, ne do levného kroku C.

### 6.2 Minimální manifest odpojitelného modulu

```json
{
  "moduleVersion": "2.1.0",
  "coreContract": ">=1.4 <2",
  "requiredCapabilities": ["core.events.v1", "model.binding.query.v1"]
}
```

Loader modul odmítne, pokud rozsah nesedí nebo capability chybí. Odmítnutí je
deklarované, ne tiché.

### 6.3 Vlastnictví zápisu a pořadí integrace

Na `f9aa50ef` je aktivním zapisujícím vlastníkem **B3-FAILOVER**: 8 změněných
souborů, nová migrace `046_model_failover`, `m1-model-failover-schema.test.js`
a rozpracovaný `tests/registry.json`. `ROADMAP.md §12` dovoluje v jednom
worktree právě jednoho zapisujícího vlastníka — ale ve stejné větě dovoluje
souběžně **„read-only trace, review a přípravu testů bez zápisu"**. Z toho
plyne pořadí:

1. **Krok D se neotevírá jako paralelní WP.** Jeho požadavky se přidají jako
   acceptance criteria běžícího B3: jedna command path, privátní repository,
   immutable startup config, `verified` až po skutečné verifikaci.
2. **Ratchet (A) se smí připravovat souběžně**, protože je to příprava testu
   bez zápisu do vlastněných cest. Nesmí přitom sáhnout na `src/**` ani na
   `tests/registry.json`.
3. **Registrace a integrace ratchetu až na čistém M1 checkpointu.** Baseline se
   připne k integračnímu SHA, ne k rozpracovanému stromu; změní-li se graf
   během B3/B4, ratchet se přeměří. Allowlist se nikdy neopravuje širokou
   adresářovou výjimkou — jen přesnými `from → to` dvojicemi.
4. **Disabled-boot test (B) až po stabilizaci M1.** Sahá do composition rootu
   a serverového bootu, což jsou cesty, kterých se B3/B4 dotýká.
5. **Krok C se nepředsouvá.** Přesun čtyř utilit nerozbije hlavní SCC a bez
   už integrovaného ratchetu by vytvářel konflikty v chatové oblasti bez
   měřitelné ochrany.

## 7. Pořadí práce

Mapované na existující jména roadmapy. Nezakládá nový paralelní track.

| Krok | Obsah | Závisí na |
|---|---|---|
| **A. Ratchet** | Checker nad `src/**` na základě existujícího měřidla: statické importy, re-exporty, literal `import()`, `require()`. **Nemění runtime `src/**`.** Dnešní dluh připnout přesným `from → to` allowlistem, ne povolením adresáře. Zakázat novou hranu a nový cyklus. Negativní fixture dokazující, že zakázaný import test shodí. Registrovat v `tests/registry.json` **až na volném registru** (§6.3) | příprava hned; integrace na M1 checkpointu |
| **A2. Směrové pravidlo** | Do ratchetu doplnit `core → optional` zákaz | R1 + přijatá cestová mapa z `WP-M3-BOUNDARY` / R3 |
| **B. Disabled boot** | Test: jádro nabootuje s `C3_ENABLE_*=false` a nevznikne route, timer, background job, session state, pending confirmation, DB zápis ani externí efekt. Druhá půlka: modul bez deklarované schopnosti selže deklarovaně. Součástí je i boot bez dostupné Ollamy s `LLM_PROVIDER_UNAVAILABLE` | R1 |
| **C. Levné cykly** | Přesun čtyř utilit (`readme-generator`, `search-metrics`, `fetch-quality`, `search-retry`) k vlastníkům; vydělení CRE slovníku. **Nerozpouští 21modulový chat SCC ani nevytahuje expertises** — obojí je práce WP-M3-BOUNDARY | R2 |
| **D. Model binding** — jako acceptance criteria běžícího `B3-FAILOVER`, ne nový WP | `ModelBindingApplicationService` + privátní repository; immutable startup config; stav `desired/active/candidate/verificationStatus/digest/verifiedAt/revision`; žádný zápis `verified=1` před úspěšnou verifikací; jediný command pro HTTP i chat; model testing vrací pouze attestation; discovery pouze navrhuje; smazání přes atomický binding guard, ne přímý Ollama call z chatu | R8; neotevírat souběžně s běžícím B3 |
| **E. Lifecycle** | Jedna `LifecycleApplicationService` pro chat i HTTP; jen lifecycle repository smí zapisovat lifecycle tabulky; Git, LLM, workflow a DB přes fakeovatelné adaptéry; parity test pro všechny živé vstupy; negativní test bez projektu a mimo povolený scope | R4, R5, R6 |
| **F. Observability a autonomy** — `WP-M3-BOUNDARY` | Jádro emituje stejný `CoreEvent`/`ObservationEvent` z HTTP i WS; sink je optional, bounded a jeho selhání nerozbije chat; autonomy je konzument bez přístupu k implementaci CRE; effect audit zůstává povinnou částí jádra | R7 |
| **G. Extension** — `WP-M3-BOUNDARY` | `ExtensionManifest/Context` (§6.2), přesné capabilities, fail-closed odmítnutí nekompatibilní verze, confirmation s vlastníkem a ID; volitelné funkce mizí z pre-handleru; odpojený modul se neúčastní routingu. Sem patří i **vytažení expertises** a rozetnutí chat SCC | R1, R3, R8, C |
| **H. Balíčky** — `WP-M5-PACKAGE` | Package exports, vlastněné migrace, atomická instalace a rollback; contract negotiation jen pro marketplace a Remote Companion | R8, G |

Teprve po **G** je pravdivé „modul lze připojit a odpojit". Teprve po **H**
„modul lze samostatně upgradovat". Do té doby jde o zdrojovou a testovací
modularitu — což je legitimní mezistav, ale nesmí se za ten cíl vydávat.

## 8. Co tento dokument nedokazuje

- Neběžela žádná live validace nad Ollamou; změna bindingu ani pull by nebyly
  read-only.
- HTTP/WS parita není ověřená, jen popsaná z kódu.
- Cykly a počty jsou statická analýza; runtime cesty se mohou lišit tam, kde se
  používá `import()` s vypočítanou cestou (měřidlo P6 uvádí 10 míst).
- Čísla `config.js` a `db/database.js` se mezi dvěma nezávislými měřeními lišila
  o 1–2 podle grep vzoru. Směr je robustní, přesné hodnoty se mají brát
  z registrovaného měřidla, ne z ad-hoc grepu.
- Dokument **nepatří do `tests/registry.json`** — není to test, je to vstup
  rozhodnutí. Do registru se zapíše až spustitelný ratchet z kroku A, a to
  teprve v okamžiku, kdy je registr volný (viz §6.3).

---

**Historie:** v1 na `0915c542`; v2 na `f9aa50ef` — přeměřený graf, asymetrický
model zpřesněn (Ollama jako runtime capability, směr importů vs. směr dat,
odpojení = zmizení z boot grafu), R1 uzavřeno ve prospěch „expertises jsou
odpojitelný modul", R6 a R8 rozšířeny, doplněn stav rozhodnutí a §6.3
vlastnictví zápisu.
