# IntentSmith Mobile — testovací strategie a napojení na kanonický registr

**Status:** **`LOCAL_REGISTRY_CONVERGED / MOBILE_SUBSET_PASS / SHARED_VALIDATION_BLOCKED`**; mobilní zeleň není Gate 0 PASS
**Revize:** vstupy `RV-028`, `RV-036`, `RV-037`, reconciliation `RV-038`; Composition Review C `RV-039`/`RV-040`; registr a chráněné hodnoty `RV-042`/`RV-043`
**Datum:** 2026-08-01
**Stavová evidence:** produktový commit `4553b3ee`; registr `362`, `C3-031=7`, `C3-032=5`, `offline=178`, `database=33`, required ACTIVE deterministic `211`; všech 11 mobilních programů a `schema-migrations` PASS, ale celý profil skončil exit `1`, `208 PASS / 3 FAIL` kvůli `F-115` a `F-116`; žádný Gate 0 PASS, verdikt ani handoff nebyl vydán, fáze 3A je `NOT DONE` a `F-100` blokuje produkci
**Vychází z:** [DATA-MODEL.md](DATA-MODEL.md), [PLAN.md](PLAN.md) §2 a §8, [ADR 0001](../adr/0001-mobile-data-ownership.md)

**Aktuální hranice:** kód a `gateway-policy.js` drží přesný **13-route HTTP
allow-list**. Je to dnešní implementovaný/source-policy-frozen povrch, nikoli
formálně refrozený kontrakt v2 pro šest domén z `DR-008`. Dnešní `/m1` nemá
WebSocket ani SSE. Existují třída/DB tabulka a HTTP read/ack surface
(`GET /m1/notifications`, `POST /m1/notifications/ack`), ale bez produkčního
producenta a wiring nejde o dosažitelný end-to-end inbox; realtime je jen
budoucí neautorizovaný kandidát. Každé nové spárování razí nový `deviceId`,
takže staré operace nejsou z nového zařízení dostupné. Při zachovaném tokenu
téhož zařízení se nejasný timeout řeší `GET /m1/operations/:id`; seznam
stejného zařízení obnoví jen serverová pole otevřených pokusů, ne lokální
atribuci, rozřešenou historii, retry payload ani draft. Všechny čtyři dříve
chybějící successor programy jsou registrované a `MS-20` bylo při zachování ID
překlasifikováno z `C3-031` do `C3-032`. Registry i chráněné hodnoty prošly
nezávislým review; to nemění sdílený deterministický exit `1` ani absenci
Gate 0 PASS, verdiktu a handoffu.

**M4 pravda po `RV-035`:** review je `CHANGES_REQUIRED`. `F-111` zůstává
otevřené jako úzké child evidence stále blokujícího root findingu `F-014`, ne
jako další unikátní root: produkční router registruje email/telegram/push a
server navíc webhook/desktop, nikoli `MobileChannel`, takže běžná produkční
emise nevytvoří řádek `mobile_notifications`. `F-112` je otevřený **HIGH**
blocker a úzké ACK child evidence stále blokujících root findingů `F-011` a
`F-015`, ne další unikátní root: čtení se filtruje podle zařízení, ale ACK
předává jen ID a SQL aktualizuje jen podle ID; cílený řádek lze potvrdit napříč
zařízeními a broadcast sdílí jedno globální `read_at`. `F-015` navíc samostatně
drží závod `MAX(seq)+1` bez `UNIQUE`/transakční garance.

`DR-003` A a jeho specializace `DR-012` A byly `PRODUCT_OWNER` přijaty
společně: server-authoritativní append-only lifecycle a per-device receipt
tabulka jsou cílový kontrakt. `DR-013` A přijímá policy-controlled S1-safe
companion mirror. Rozhodnutí nejsou implementace: ACK izolace, sekvenční
závod, producer/projektor a Gate 1 důkazy chybějí, takže produkční wiring
zůstává blokovaný (`F-011`, `F-014`, `F-015`, `F-111`, `F-112`).

`F-113` je `RESOLVED` v source checkpointu `2a814434` (`RV-037`), prošlo
kompozičním review a má M3 testovací evidenci: každý persistence path pro
moderní i legacy řádky prochází
uzavřenou normalizací, platný záznam má přesně sedm allowlisted polí a
malformovaný nejvýše sedm bez fabrikace identity nebo času. `F-108` je
`RESOLVED`; jeho původní branch-aware census je historický, nikoli aktuální stav. Aktuální
census je `362/7/5/178/33/211`; sdílenou validaci blokují `F-115` a `F-116`.
Vstupy zůstávají pouze lokální, bez push a main integrace; `F-100`, `F-111`,
`F-112`, `F-081`, `GAP-2`, `GAP-9`, `MR-05` a `MR-25` zůstávají otevřené.

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Pravidlo, kterému se tento dokument podřizuje

> **Kanonický registr je `tests/registry.json`. Tento dokument žádný registr
> nezakládá, nenahrazuje ani nezrcadlí.**

PLAN.md §8 podmínka 3 zní: *„mobilní testy do registru od prvního dne — ať
nevznikne druhá nedohledatelná testovací plocha."* Nejjednodušší způsob, jak
tu podmínku porušit, je udělat si vedle registru „mobilní seznam testů".
Proto zde není seznam testů, ale **pravidla a šablony**, podle kterých mobilní
řádky mají vznikat přímo v `tests/registry.json` — každý ve chvíli, kdy vznikne
jeho program. Pět dnešních successor programů už toto pravidlo splňuje: každý
má vlastní řádek pod `C3-032` a registry delta byla schválena v `RV-042`.
§4.2 zaznamenává uzavření této mezery; každý budoucí program musí dodržet
stejné pravidlo.

---

## 1. Co registr vynucuje — ověřeno ve validátoru

Bez těchto sedmi faktů nelze mobilní testy zavést správně. Všechny zůstávají
ověřitelné v `scripts/test-registry.js` na aktuálním kandidátu `4553b3ee`.

| # | Fakt | Zdroj | Důsledek pro mobil |
|---|---|---|---|
| **F-1** | Registrovaná cesta **musí existovat** jako spustitelný program, jinak validátor selže: `registered path is missing or no longer runnable` | `test-registry.js:213` | **Testy nelze předregistrovat.** Řádek vzniká se souborem, ve stejném commitu. Rezervace ID dopředu není možná |
| **F-2** | Každý soubor pod `tests/` s podporovanou příponou musí být buď suite, nebo zdůvodněná výjimka (≥ 20 znaků) | `test-registry.js:208`, `:97` | Mobilní pomocný modul pod `tests/` bez registrace **shodí `G0-C3`**. Helper musí mít výjimku, nebo bydlet mimo `tests/` |
| **F-3** | `argv` musí být přesně `[executor, path]` — dva prvky, žádné přepínače | `test-registry.js:161` | Jeden program = jeden registrovaný řádek. Žádné parametrizované běhy typu `--suite=pairing` |
| **F-4** | Discovery prochází **jen** `tests/**` a `e2e/run-e2e.js` | `test-registry.js:52-63` | **Testy mobilního klienta mimo `tests/` jsou pro registr neviditelné.** To je přesně ta druhá plocha — řeší §5 |
| **F-5** | Symbolické odkazy jsou tvrdě odmítnuty | `test-registry.js:348` | Klientské testy nelze do `tests/` „nasymlinkovat" |
| **F-6** | `capabilityId` musí odpovídat `^C3-\d{3}$`; validátor **neověřuje**, že řádek existuje v `CAPABILITY-MATRIX.md` | `test-registry.js:141` | Nová capability ID se dají zavést tiše. `C3-031`/`C3-032` už existují; každé další ID proto vyžaduje samostatnou maticovou a registry kontrolu |
| **F-7** | `TEST-REGISTRY.md` je generovaný; ruční editace = `stale` a exit 1 | `validate-test-registry.js:27` | Po každé změně registru `node scripts/validate-test-registry.js --write-doc` |

**[F] Gate 0 dopad:** `G0-C5` je definovaný jako *všechny* řádky s profilem
`offline` (T1) a `database` (T2), stav `ACTIVE`, `required: true` — reviewed
registr aktuálně obsahuje 178 `offline` a 33 `database`, tedy 211
deterministických programů (`GATE-CRITERIA.md`). M3 spustilo všech 211 a skončilo
exit `1`, `208 PASS / 3 FAIL`, na `F-115`/`F-116`; mobilní subset byl PASS.
Každý nový deterministický test číslo i otisk znovu mění a vyžaduje novou
evidenci. To není důvod testy nepsat — je to důvod psát je vědomě.

---

## 2. Konvence, které se přebírají beze změny

Odvozeno z 362 existujících řádků, ne vymyšleno.

### 2.1 Tvar ID

```
IS-T<tier>-<cesta bez přípony, oddělovače → pomlčka, velkými písmeny>
```

`tests/mobile/boundary-legacy-api-unreachable.test.js` →
`IS-T3-TESTS-MOBILE-BOUNDARY-LEGACY-API-UNREACHABLE-TEST`

Výjimka podle stávající praxe: u cest `tests/e2e/*` se prefix `TESTS-` vypouští
a přípona `.e2e` se do ID nepromítá (`tests/e2e/01-health-smoke.e2e.js` →
`IS-T3-E2E-01-HEALTH-SMOKE`).

**[F] Pozor:** ID není odvozená hodnota, ale **zmrazený identifikátor**, a pět
existujících řádků to dokazuje. Ve čtyřech se `T`-token v ID rozchází s polem
`tier` (`IS-T3-TESTS-VRAM-COORDINATION-TEST` má `tier: "T1"`; totéž tři řádky
`cre-*`), v jednom chybí přípona `-TEST`
(`IS-T1-TESTS-ARTIFACT-VALIDATION` pro `tests/artifact-validation.test.js`). Při pozdější změně tieru se ID nepřepisuje
— jinak se rozbijí odkazy z evidence. Nové mobilní ID se odvodí správně a pak už
se nemění.

### 2.2 Profily, tiery, fixtures, timeouty

| Profil | Tier | Fixture | expected / timeout | Kdy |
|---|---|---|---|---|
| `offline` | `T1` | `isolated-home` | 30 s / 120 s | Čistá logika bez sítě, DB a serveru |
| `database` | `T2` | `isolated-sqlite` | 60 s / 300 s | Deterministické proti dočasné SQLite |
| `server` | `T3` | `owned-isolated-local-server` | 120 s / 900 s | Skutečné dva listenery |
| `model` | `T3` | `isolated-model` | dle vzoru | Vyžaduje model — mobil sem nepatří, snad kromě P5 |
| `soak` | `T4`/`T5` | `isolated-soak-root` | dle vzoru | Dlouhoběžné |

`owner` je ve všech 362 řádcích `"primary implementer"`; mobil nezavádí nového
vlastníka, dokud ho operátor nepojmenuje.

### 2.3 Stavy

- `ACTIVE` — smí přinášet zelenou evidenci.
- `BLOCKED` — **musí pojmenovat konkrétní technickou prerekvizitu** (`G0-C7`).
  „Ještě není hotovo" není prerekvizita; „sada dosud čeká na externě
  spuštěný listener, který nevlastní ani deterministicky neuklízí" ano.
- `KNOWN_DEFECTIVE` — test existuje, ale jeho aserce neplatí. Nikdy se nepočítá
  jako zelený (`G0-C6`).
- `HISTORICAL` — nesmí být `required`.

---

## 3. Capability ID pro mobil — **`D-T1` historicky rozhodnuto**

`C3-031` a `C3-032` už v `CAPABILITY-MATRIX.md` existují. Jejich vznik není
budoucí krok. Reviewed registry fakta jsou `C3-031=7` a `C3-032=5`: čtyři
successor programy byly přidány a `MS-20` bylo při zachování ID přesunuto pod
`C3-032`. Popisy capability řádků jsou navíc historicky zastaralé vůči
existujícímu listeneru a PWA klientovi; jejich oprava patří vlastníkovi
`docs/convergence/CAPABILITY-MATRIX.md`, ne docs-only `WP-MOBILE-026`.

Rozdělení dvou ID není kosmetika: `C3-031` je **serverová bezpečnostní hranice**,
která má cenu i kdyby žádný telefon nikdy nevznikl (PLAN.md: S-1..S-4 jsou na
mobilu nezávislé). `C3-032` je klient. Slepit je znamená, že selhání klienta
zabarví bezpečnostní evidenci a naopak.

### 3.1 Historické pravidlo a dokončený registry krok

Původní rozhodnutí požadovalo capability řádky a první skutečný program v
jednom atomickém commitu. Capability řádky i serverové registry programy už
vznikly; toto pravidlo proto nelze vydávat za budoucí pořadí.

Tento užší krok je dokončený: po Composition Review C přidal `eee04db9` čtyři
řádky pro approval lifecycle/cache a `MS-13`/`MS-14` a `MS-20` při zachování ID
překlasifikoval z `C3-031` na `C3-032`; `RV-042` změnu schválilo. Chráněné
hodnoty na `4553b3ee` schválilo `RV-043`. To je registry closure, nikoli Gate 0
PASS: úplný běh skončil `208/3`.

### 3.2 Historický původ a aktuální stav

Oba capability řádky historicky zavedl commit `f9b0b60` na větvi
`codex/legacy-listener-loopback-boundary`; v aktuálním stromu už jsou přítomné.
Autoritou je aktuální `CAPABILITY-MATRIX.md` a `tests/registry.json`, nikoli
název původní větve ani tento dokument:

| Závislost | Co s ní |
|---|---|
| `C3-031` má **sedm** programů | Serverová mobilní bezpečnostní evidence zůstává oddělená od klientských successorů |
| `C3-032` má **pět** přímých programů | Approval lifecycle, cache boundary, `MS-13`, `MS-14` a `MS-20`; registry delta schválilo `RV-042` |

Nic dalšího z toho commitu tato větev neřeší ani nekomentuje.

---

## 4. Rodiny mobilních testů

Devět rodin. Rodina je **jmenná konvence a rozsah odpovědnosti**, ne kontejner —
v registru neexistuje pole „rodina" a nezavádí se.

Cesta: `tests/mobile/<rodina>-<případ>.test.js`, malými písmeny, pomlčky.

| Rodina | Prefix cesty | Profil | Capability | Co dokazuje |
|---|---|---|---|---|
| **MB — Boundary** | `tests/mobile/boundary-*` | `server` (+ `offline` pro rozhodovací logiku) | `C3-031` | Vzdálený peer nedosáhne legacy API ani terminálu; hranice z PLAN.md §2 |
| **MS — Scope** | `tests/mobile/scope-*` | `offline`, `database` | `C3-031` | Fail-closed scope enforcement, žádný tichý fallback |
| **MP — Pairing** | `tests/mobile/pairing-*` | `database`, `server` | `C3-031` | Jednorázovost, TTL, odolnost proti hrubé síle, nemožnost eskalace, vypínač |
| **MC — Cache** | `tests/mobile/cache-*` | `offline` | `C3-032` | FRESH/STALE/EXPIRED, úklid, invalidace, `I-2` |
| **MO — Offline** | `tests/mobile/offline-*` | `offline` | `C3-032` | `I-3`, `I-4`, `I-5`, `I-11` — co se odmítne, co se nikdy nefrontuje a proč klíč operace není fronta |
| **ML — Lifecycle** | `tests/mobile/lifecycle-*` | `offline`, `database` | `C3-032` | Logout, expirace, revokace: co se maže, v jakém pořadí, co zbyde a před čím se varuje |
| **MV — Privacy** | `tests/mobile/privacy-*` | `offline` | `C3-032` | S2/S3 se nedostanou do logu, notifikací ani diagnostiky |
| **MN — Contract** | `tests/mobile/contract-*` | `offline`, `database`, `server` | `C3-031` | Rozlišitelné chybové stavy, kurzor, idempotence approvalu a deduplikace podle klíče operace (DATA-MODEL §8) |
| **MX — Client** | `tests/mobile/client-*` | `offline` | `C3-032` | Most k testům klientské aplikace (dnes PWA — `M-1`) — viz §5. Pět přímých successorů klient importuje a každý je správně registrovaný pod `C3-032` |

### 4.1 Proč je většina rodin `offline`

Protože doménová pravidla z DATA-MODEL.md jsou **čisté funkce**: „smí se tento
záznam offline zobrazit?", „co maže logout?", „je tenhle stav STALE?", „patří
tahle položka do logu?". Takové věci se testují bez sítě, serveru i telefonu —
a proto mohou být `ACTIVE` a nést zelenou evidenci dřív, než existuje jediný
řádek klientského kódu.

To je záměr: **pravidla mají testy dřív než obrazovky.** Mapa obrazovek odkazuje
na plánovaná ID jako na návrhový katalog. Sedm serverových programů je pod
`C3-031` a pět přímých successorů správně pod `C3-032`. Ostatní katalogová ID
zůstávají jen plánem.

### 4.2 Co je dnes `ACTIVE` — a co zůstává `BLOCKED`

Vlastněný supervizor **existuje** v `tests/helpers/server-supervisor.js`.
Kanonický registr vede jako required `ACTIVE` celkem **11 mobilních programů**:

- `mobile-data-model.test.js` a `mobile-migration-parity.test.js` jsou čistě
  databázové (`network:none`);
- `mobile-gateway-boundary.test.js`, `mobile-gateway-supervisor.test.js`,
  `mobile-operation-isolation.test.js` a `mobile-fault-injection.test.js`
  používají vlastněný listener pouze na loopbacku;
- approval lifecycle, cache boundary, `MS-13`, `MS-14` a `MS-20` jsou pět
  přímých successorů pod `C3-032`.

Všech 11 má `requirements.server:false`: nečekají na cizí proces a v M3 prošly.
To ale **neprokazuje vzdálenou hranici**. Skutečný
non-loopback peer ani bind na VPN adrese otestovaný nebyl a `GAP-2` zůstává
otevřená. Všech 32 řádků s profilem `server` má
`requirements.server:true`; bez externího, identity-verified server
supervizoru proto nejsou runtime-eligible a na vlastněný listener převedené
nejsou. Jejich ledgerový `state` je ale 7 `ACTIVE`, 12 `BLOCKED` a 13
`KNOWN_DEFECTIVE` — ne 32× `BLOCKED`.

Přímá M3 evidence je `4/0` lifecycle, `10/0` cache, `61/0` MS-13, `74/0`
MS-14, `43/0` MS-20, `38/0` gateway, `41/0` data model, `15/0` fault injection,
`14/0` operation isolation, `11/0` migration parity, `9/0` gateway supervisor
a `28/0` schema migrations. Úplný izolovaný runner přesto skončil `208/3`.

Obecný popis profilu `server` v `TEST-REGISTRY.md` je tedy prerekvizita pro
tyto dosud nepřevedené řádky, ne tvrzení, že v repozitáři neexistuje žádný
supervizor. **Rozhodovací logika hranice** (route allow-listy, default deny,
mapa scope → operace) se nadále testuje lokálně; vzdálené provozní tvrzení
z ní odvodit nelze.

> Rozdělení je podstatné: *„vzdálený peer nedosáhne na `/api/*`"* je tvrzení
> o nasazení a vyžaduje pravý non-loopback důkaz. *„rozhodovací funkce vrátí
> deny pro cestu, která není v allow-listu"* je tvrzení o kódu a lze je
> prokázat lokálně. Druhé bez prvního nic nedokazuje o vzdálené realitě.

**Closure evidence `C3-032` / successorů.** V `tests/registry.json` jsou programy
`tests/mobile-approval-lifecycle-regression.test.js`,
`tests/mobile-approval-cache-boundary.test.js`,
`tests/mobile-ms13-approvals.test.js`, `tests/mobile-ms14-decision.test.js` a
`tests/mobile-ms20-ui.test.js`. Všech pět je pod `C3-032`; čtyři záznamy přibyly
a `MS-20` zachovalo ID. `RV-042` schválilo registry delta, `RV-043` chráněné
hodnoty. M3 potvrdilo mobile PASS, ale celý běh `208/3` není Gate 0 PASS.

### 4.3 Stále otevřené produkční blokery z `RV-035`, zachované v `RV-036`

Existence komponent není test end-to-end kontraktu. Před jakýmkoli produkčním
claimem musí nová nebo rozšířená evidence fail-closed prokázat:

1. **`F-111` — skutečný producent.** Jde o úzké child evidence root `F-014`,
   ne další unikátní root. Produkční notification router musí
   z normální emise vytvořit očekávaný řádek `mobile_notifications`, který pak
   stejné zařízení přečte přes `GET /m1/notifications`. Přímá konstrukce
   `MobileChannel` nebo seed databáze tento důkaz nenahrazuje.
2. **`F-112` — izolovaný ACK.** Jde o úzké child evidence root findingů
   `F-011`/`F-015`, ne další unikátní root; `F-015` navíc samostatně vyžaduje
   concurrency test závodu `MAX(seq)+1` a DB uniqueness/transakční garance.
   HTTP negativní test musí prokázat, že zařízení
   A nedokáže ACKnout cílený řádek zařízení B ani při znalosti ID. Broadcast
   musí mít samostatný stav přečtení pro každé zařízení. `PRODUCT_OWNER` přijal
   `DR-003` A, jeho specializaci `DR-012` A a companion pravidlo `DR-013` A.
   Cílový append-only lifecycle, per-device receipts a policy-controlled S1-safe
   mirror však nejsou implementované; concurrency ochrana a Gate 1 důkazy chybějí.
3. **`F-113` — `RESOLVED` a evidované.** Test v
   `mobile-ms20-ui.test.js` vkládá moderní i legacy záznamy s extra poli a
   prokazuje, že `normalizeEntry()` vrátí jen sedm allowlistovaných polí, aliasy
   `type`/`state` použije jen bez kanonického pole, extras odstraní a u malformed
   vstupu nefabrikuje identitu ani čas. Oprava `2a814434` prošla `RV-037`,
   Composition Review C `RV-039`/`RV-040`, registry `RV-042` a mobilní M3 PASS.

Testy pro `F-111`/`F-112` a jejich produkční implementace stále chybějí.
`F-113` má source, kompoziční, registry i mobilní M3 evidenci. Dokumentace sama
produktový kontrakt ani implementační autoritu nemění a celý profil `208/3`
zůstává blokovaný.

---

## 5. Testy klientské aplikace — kde vzniká druhá plocha

**[F]** Discovery prochází jen `tests/**` a `e2e/run-e2e.js` (`F-4`).
Klientská aplikace bydlí mimo `tests/`, takže její vlastní testy by
**v registru nebyly**. To je doslova ta „druhá nedohledatelná testovací
plocha", proti které je podmínka 3 v PLAN.md §8 napsaná.

> **Oprava po retrospektivním zápisu `M-1`.** Dřívější znění tohoto odstavce
> mluvilo o aplikaci React Native / Expo. **Klientem pro Fáze 0–1 je PWA**
> (PLAN.md §7.2) v `src/mobile/client/`, servírovaná mobilní gateway. `M-1`
> nebylo rozhodnutí učiněné před implementací: dodatečně ratifikovalo už
> postavenou PWA. Tento historický drift zůstává trvale přiznaný jako `F-099`
> (navazuje na `F-074`). Na podstatě §5 to nic nemění — je to pořád kód mimo
> `tests/**` — ale mění to dvě věci, které se nesmí zamlčet:
>
> 1. **PWA successor programy i jejich registry napojení existují.** Approval
>    lifecycle/cache, `MS-13`, `MS-14` a `MS-20` mají vlastní přímé řádky pod
>    `C3-032`; `RV-042` schválilo registraci bez prázdného wrapperu.
> 2. **Toolchain je jiný než u RN.** Podmínka 5 níže (profil odpovídá
>    skutečnosti) se tím nezjednodušuje: prohlížečová sada potřebuje běhové
>    prostředí, které běžný `offline` profil nemá, a pak je to prerekvizita
>    a `BLOCKED`, ne `offline`.

Tři varianty a doporučení:

| # | Varianta | Hodnocení |
|---|---|---|
| **V-1** | Klientské testy jen v `mobile/`, registr o nich neví | ❌ Přesně zakázaný stav. Zelená v CI klienta by nikdy neprošla ledgerem |
| **V-2** | **Registrovaný můstek**: `tests/mobile/client-suite.test.js` je normální registrovaný program, který spustí testovací sadu klienta a **fail-closed** ji přeloží na exit kód | ✅ **[R]** Registr vidí jeden řádek s pravdivým verdiktem; ledger zůstává jediný |
| **V-3** | Klientské testy fyzicky pod `tests/` | ❌ Rozbije layout aplikace a stejně potřebuje toolchain klienta; `F-5` navíc zakazuje symlinky |

**Podmínky pro V-2** — bez nich je můstek horší než nic:

1. **Fail-closed.** Chybějící toolchain, chybějící `node_modules` klienta,
   nespuštěná sada → **nenulový exit**. Nikdy „přeskočeno = zelená". Přesně tenhle
   vzorec je v tomto repu evidovaný jako `G0-R016` (false-green).
2. **Bez skrytého přeskakování.** Když sada nemůže běžet, patří řádku stav
   `BLOCKED` s pojmenovanou prerekvizitou — ne tichý průchod.
3. **Vlastněné artefakty.** Výstup jen pod artefaktovým rootem, ne do
   sledovaného stromu (`G0-R011`).
4. **Bez síťování.** Instalace závislostí není součástí testu; chybí-li, je to
   `BLOCKED`.
5. **Profil odpovídá skutečnosti.** Můstek, který spustí jestovou sadu klienta,
   není `offline` jen proto, že nechodí na síť — pokud vyžaduje toolchain, který
   běžný běh nemá, je to prerekvizita a patří do `requirements` a `BLOCKED`.

Klient i pět přímých successor programů existují, přímo testují PWA a jsou
správně registrované pod `C3-032`; kanonický registr se uzavřel bez prázdného
souhrnného wrapperu (`eee04db9`, `RV-042`).

**Prohlížečová sada podle podmínky 5 (`786d4c74`).**
`tests/mobile-browser-a11y.test.js` je první sada, na kterou podmínka 5 doopravdy
dopadá: renderuje klienta v Chrome, aby změřila to, co markup říct nemůže —
kontrast (§10), dotykové cíle (§8), geometrii trust baru (§4) a strom
přístupnosti. Řádek je proto `BLOCKED` s `requirements.toolchain
["chromium-runtime"]`, ne `offline`. Fail-closed podle podmínky 1: chybějící
`puppeteer` nebo prázdná cache prohlížeče končí nenulově s pojmenovanou
prerekvizitou. Do `npm run test:mobile` zařazená není — baterie by pak padala
na stroji bez prohlížeče; spouští se `npm run test:mobile:browser`.

---

## 6. Přesně aplikovatelný návrh zápisu do registru

Kvůli `F-1` **nelze** vložit řádek do `tests/registry.json` dřív, než vznikne
odpovídající program. Následující bloky zůstávají obecné **šablony pro budoucí
programy**, ne aktuální Gate 0 patch. Dnešních pět successorů už je registrováno
a `MS-20` zachovalo své ID.

Postup pro jeden nový test (opakuje se, nikdy hromadně; oba capability řádky už
existují):

```
1. vznikne tests/mobile/<rodina>-<případ>.test.js
2. do tests/registry.json přibude jeho řádek podle šablony níže
3. node scripts/validate-test-registry.js --write-doc
4. commit obsahuje program + řádek registru + regenerovaný TEST-REGISTRY.md
```

Poslední krok je jediný správný tvar. Program bez řádku shodí `G0-C3` (`F-2`); řádek
bez programu shodí validátor (`F-1`). Nejde je oddělit ani omylem.

### 6.1 Šablona — deterministický mobilní test (`offline`, `ACTIVE`)

```json
{
  "id": "IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST",
  "path": "tests/mobile/cache-freshness-states.test.js",
  "argv": ["node", "tests/mobile/cache-freshness-states.test.js"],
  "capabilityId": "C3-032",
  "tier": "T1",
  "fixture": "isolated-home",
  "profile": "offline",
  "timeoutMs": 120000,
  "expectedDurationMs": 30000,
  "requirements": {
    "network": "none",
    "database": false,
    "server": false,
    "ollama": false,
    "gpu": false
  },
  "required": true,
  "owner": "primary implementer",
  "state": "ACTIVE",
  "lastGreen": { "commit": null, "artifact": null },
  "flakeCount": 0,
  "quarantineExpiry": null
}
```

### 6.2 Šablona — hraniční test (`server`, `BLOCKED` s prerekvizitou)

```json
{
  "id": "IS-T3-TESTS-MOBILE-BOUNDARY-LEGACY-API-UNREACHABLE-TEST",
  "path": "tests/mobile/boundary-legacy-api-unreachable.test.js",
  "argv": ["node", "tests/mobile/boundary-legacy-api-unreachable.test.js"],
  "capabilityId": "C3-031",
  "tier": "T3",
  "fixture": "owned-isolated-local-server",
  "profile": "server",
  "timeoutMs": 900000,
  "expectedDurationMs": 120000,
  "requirements": {
    "network": "loopback",
    "database": true,
    "server": true,
    "ollama": false,
    "gpu": false
  },
  "required": true,
  "owner": "primary implementer",
  "state": "BLOCKED",
  "lastGreen": { "commit": null, "artifact": null },
  "flakeCount": 0,
  "quarantineExpiry": null
}
```

Prerekvizita takového řádku se formuluje konkrétně. Obecná absence
supervizoru už pravda není. U nepřevedené lokální
sady je přesná prerekvizita *„sada dosud nevlastní listener a deterministický
teardown"*; u vzdáleného MB důkazu je to *„neexistuje schválená non-loopback
fixture s ověřenou identitou peeru a `GAP-2` evidencí"*. Záznam patří tam,
kde `G0-C7` prerekvizity hledá, ne do náhradního registru.

### 6.3 Šablona — stavový test proti dočasné DB (`database`)

```json
{
  "id": "IS-T2-TESTS-MOBILE-PAIRING-SINGLE-USE-TEST",
  "path": "tests/mobile/pairing-single-use.test.js",
  "argv": ["node", "tests/mobile/pairing-single-use.test.js"],
  "capabilityId": "C3-031",
  "tier": "T2",
  "fixture": "isolated-sqlite",
  "profile": "database",
  "timeoutMs": 300000,
  "expectedDurationMs": 60000,
  "requirements": {
    "network": "none",
    "database": true,
    "server": false,
    "ollama": false,
    "gpu": false
  },
  "required": true,
  "owner": "primary implementer",
  "state": "ACTIVE",
  "lastGreen": { "commit": null, "artifact": null },
  "flakeCount": 0,
  "quarantineExpiry": null
}
```

> `isolated-sqlite` a `C3_DB_PATH` jsou u těchto testů nepodkročitelné:
> `G0-R012` eviduje, že otevření DB je **importní vedlejší efekt** a test bez
> izolované cesty zmigruje operátorovu skutečnou databázi.

### 6.4 Historická kolize s integrační větví a dnešní closure

Zápis do `tests/registry.json` v době původního návrhu kolidoval s integrační
prací — položkovým uzavíráním 92 `REBUILD` položek a deterministickým
manifestem. Každý řádek mění otisk registru a tím i kandidátský verdikt
(`GATE-CRITERIA.md`); toto obecné pravidlo platí dál.

**Původní znění:** dokud integrační práce běží, mobilní řádky se **nezapisují**.
Šablony výše jsou hotové k aplikaci a jsou závislé jen na existenci programu
a na rozhodnutí z §3. **Náhradní registr se nezakládá** — ani „prozatímní",
ani „jen pro mobil".

> **[Historický snapshot před `eee04db9`.]** Mobilní sady
> (`tests/mobile-gateway-boundary.test.js`, `mobile-data-model.test.js`,
> `mobile-gateway-supervisor.test.js`, `mobile-operation-isolation.test.js`,
> `mobile-fault-injection.test.js`, `mobile-migration-parity.test.js`)
> v `tests/registry.json` **zapsané jsou pod `C3-031`**. Pod touto capability je
> navíc `MS-20`, které se musí překlasifikovat. Žádný `C3-032` program zapsaný
> není a čtyři successor programy vyjmenované v §4.2 jsou stále mimo registr.
> Zapisuje se to sem, protože
> podmínka, kterou realita obešla a dokument o tom mlčí, je přesně ten druh
> nepravdy, kvůli kterému `RV-021` vzniklo.
>
> Co z toho plyne a co ne: **dopad na otisk registru a na kandidátský verdikt
> platí beze změny** (`GATE-CRITERIA.md`) a je věcí vlastníka integrační větve,
> ne tohoto dokumentu. **Náhradní registr se nezakládá** — to platí dál a bez
> výjimky.

**Aktuální closure:** `eee04db9`/`RV-042` zapsalo čtyři přímé programy a
překlasifikovalo `MS-20` při zachování ID; stav je `C3-031=7`, `C3-032=5`.
`4553b3ee`/`RV-043` srovnalo chráněné hodnoty. Náhradní registr nevznikl.

### 6.5 Číslo migrace se přiděluje proti celému vývoji, ne proti tomuhle stromu

Registrová ID nejsou jediný identifikátor, který si tahle větev nesmí přidělit
sama. **Totéž platí pro čísla migrací** a stálo to jednou celý refresh:
`d6fee86f` musel přesunout mobilní gateway migrace z `046`/`047`/`048` na
`055`/`056`/`057`, protože hlavní linie mezitím tatáž čísla obsadila, zatímco
mobilní větev byla 294 commitů pozadu.

Přejmenovat soubory nestačilo. `discoverMigrations()` řadí **lexikograficky přes
celý název včetně data**, takže se musel posunout i datový prefix — jinak by
mobilní migrace běžely před `046`. A `schema_migrations.version` **je** ten
název: v databázi, která migraci už aplikovala, přejmenování osiří razítko
a migrace se spustí podruhé. Proto se čísluje správně předem, ne až u merge.

**Pravidlo.** Před přidělením čísla — a znovu těsně před commitem, který
migraci přidává — spusť:

```bash
node scripts/check-migration-numbers.mjs        # kolize + další volné číslo
node scripts/check-migration-numbers.mjs --next # jen číslo
```

Skript prochází **všechny registrované worktree včetně jejich pracovních
stromů** (nezacommitovaná migrace v cizím worktree se počítá), `main` a HEAD
větev; `--all-branches` rozšíří záběr na všechny lokální větve mimo `archive/`.
Vrací `1`, když si číslo z tohohle stromu nárokuje jinde jiná migrace.
Sdílená čísla `008` a `030` jsou historie: existují v každém stromu, jejich
plné verze se liší a přečíslovat je už nelze — skript je hlásí, ale neblokuje.

**Stav k `2026-08-10`:** mobilní větev drží `055`–`060`, modelová linie
(`905a3422`, `integration/gate1-prod-ready-20260809` a deset dalších větví)
drží `061`. Pravidlo z `WP-MOBILE-027-COMPLETION.md` §6.3 — „prefix vyšší než
`2026_08_09_057`" — je tím překonané; doslovné splnění by vyrobilo kolizi.

**Číslo se ale nečte odsud.** Mezi napsáním předchozího odstavce a jeho
zacommitováním vznikl worktree `is-m1-proof-issuance-impl` a obsadil `062`
(`2026_08_10_062_model_failover_proof_issuance`). Dokument, který drží konkrétní
číslo, zastarává během jedné relace — proto ho drží skript a proto se pouští
**znovu těsně před commitem**, ne jen na začátku práce. Skript navíc neuvidí
větev, která ještě nevznikla; to je limit, který se nedá odstranit, jen zúžit
tím, že se kontrola opakuje co nejpozději.

**Tvar odkazu.** Mobilní povrch (`src/mobile/`, mobilní migrace, `tests/mobile-*`,
`docs/mobile/`) smí psát holé číslo **jen pro mobilní migraci**. Cizí migrace se
odkazuje plnou verzí (`2026_03_01_024_v91_security`), kterou žádné naše
přečíslování neznehodnotí. Vynucuje to poslední test
v `tests/mobile-migration-parity.test.js` — po `d6fee86f` zůstalo v komentářích
a v dokumentaci `046`/`047`/`048`, což jsou dnes reálné cizí migrace
(`048` = `model_binding_operations`), takže čtenář odkazu skončil u cizí tabulky.

---

## 7. Katalog testovacích ID pro budoucí odkazování

Mapa obrazovek a coverage matice potřebují na co ukazovat i dřív, než některé
testy existují. Odkazuje se proto na **plánované ID**, které se odvodí z cesty
podle §2.1 a je tím pádem předvídatelné, ne vymyšlené. Pět existujících
successor programů vede přesnými cestami §4.2 a je správně registrovaných pod
`C3-032`. Tento katalog kanonický registr nenahrazuje.

> **Tohle není registr.** Řádek se stává skutečným až krokem z §6. Do té doby je
> ID pouze závazek, jak se ten test bude jmenovat, až vznikne. Cokoli z toho může
> zaniknout, změnit rozsah nebo se sloučit.

> **Co znamená značka „hotovo" v tabulkách níže.** Znamená **program existuje,
> je registrovaný a lokálně běží zeleně**. **Neznamená** schváleno,
> integrováno ani produktově hotovo. Historická review vrátila
> `CHANGES_REQUIRED`; bounded successory pak dostaly v `RV-028`
> `APPROVED_WITH_FOLLOWUPS`, kompozice prošla `RV-039`/`RV-040`, registr
> `RV-042`/`RV-043` a mobilní subset M3. Ani tento výsledek nepovyšuje zeleň na
> produktový stav: celý profil je `208/3`. Autoritou zůstává registr a běhová
> evidence, ne tento dokument.

### 7.0 Co se zatím nesmí testovat, protože to nemá být postavené

Test k neexistující a **kontraktem blokované** schopnosti je horší než žádný:
zafixuje tvar, který kontrakt teprve určí, a vypadá jako pokrytí.

| Požadavek | Stav | Co to znamená pro testy |
|---|---|---|
| `MR-07` průběh běhu | `BLOCKED_BY_CONTRACT` | K `MS-15` nevzniká UI ani jeho testy. **Existující sady kolem `/m1/chat` a žurnálu operací nesmí být vydávány za pokrytí `MR-07`** — nejsou to testy agent logu |
| `MR-10` hledání | `BLOCKED_BY_CONTRACT` | K `MS-09` nevzniká UI ani jeho testy. Test hledání nad cachovaným oknem by prokazoval něco, co požadavek **nesplňuje** |
| `MR-14` projekty | `BLOCKED_BY_CONTRACT_AND_GATE1` | K `MS-12` nevzniká UI ani jeho testy. Řádky pro projektovou doménu vzniknou až s kontraktem a Gate 1 |
| `MR-05` kurzorové stránkování | `MISSING_IMPLEMENTATION` | `MN-cursor-rejection` a `MN-pagination-end` popisují **serverové** chování a smí vzniknout; kompoziční/registry prerekvizita je splněná, ale klientská část čeká na vlastní autorizovaný Work Package a sdílenou validaci |

Blokáda se týká **testů k blokovaným schopnostem**, ne doménových pravidel:
`offline` testy pravidel z DATA-MODEL.md (co se nefrontuje, co se maže, co je
`STALE`) platí dál a jsou naopak žádoucí dřív než obrazovky (§4.1).

### MB — Boundary (`C3-031`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-BOUNDARY-ROUTE-POLICY-TEST` | `boundary-route-policy` | Rozhodovací funkce: default deny, allow-list jen `/m1/*` | `offline` |
| `IS-T3-TESTS-MOBILE-BOUNDARY-LEGACY-API-UNREACHABLE-TEST` | `boundary-legacy-api-unreachable` | Vzdálený peer nedosáhne na žádnou `/api/*` | `server` |
| `IS-T3-TESTS-MOBILE-BOUNDARY-WS-TERMINAL-UNREACHABLE-TEST` | `boundary-ws-terminal-unreachable` | Vzdálený peer nedosáhne na `/c3/ws` ani terminal channel | `server` |
| `IS-T3-TESTS-MOBILE-BOUNDARY-LOOPBACK-ONLY-TEST` | `boundary-loopback-only` | Stávající listener zůstává na loopbacku i s mobilní gateway | `server` |
| `IS-T1-TESTS-MOBILE-BOUNDARY-ADMIN-TOKEN-ABSENT-TEST` | `boundary-admin-token-absent` | Telefon nikdy nedrží `C3_ADMIN_TOKEN` | `offline` |

### MS — Scope (`C3-031`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-SCOPE-FAIL-CLOSED-TEST` | `scope-fail-closed` | Chybějící/neznámý scope → deny, nikdy tichý fallback | `offline` |
| `IS-T1-TESTS-MOBILE-SCOPE-SECURITY-ROUTES-DENIED-TEST` | `scope-security-routes-denied` | Device token nedosáhne na `/api/security/*` ani se scopem | `offline` |
| `IS-T2-TESTS-MOBILE-SCOPE-TOKEN-EXPIRY-TEST` | `scope-token-expiry` | Expirovaný a revokovaný token jsou odmítnuty rozlišitelně | `database` |
| `IS-T1-TESTS-MOBILE-SCOPE-CLIENT-HINT-ONLY-TEST` | `scope-client-hint-only` | Klientský scope (`MD-12`) je nápověda; vynucení je serverové | `offline` |

### MP — Pairing (`C3-031`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T2-TESTS-MOBILE-PAIRING-SINGLE-USE-TEST` | `pairing-single-use` | Druhé uplatnění kódu → konflikt, atomicky | `database` |
| `IS-T2-TESTS-MOBILE-PAIRING-TTL-TEST` | `pairing-ttl` | Kód po expiraci neplatí | `database` |
| `IS-T2-TESTS-MOBILE-PAIRING-BRUTE-FORCE-TEST` | `pairing-brute-force` | Odolnost proti hádání kódu | `database` |
| `IS-T1-TESTS-MOBILE-PAIRING-NO-ESCALATION-TEST` | `pairing-no-escalation` | Párováním nelze získat admin scope | `offline` |
| `IS-T1-TESTS-MOBILE-PAIRING-KILL-SWITCH-TEST` | `pairing-kill-switch` | Párování lze globálně vypnout jedním přepínačem | `offline` |
| `IS-T1-TESTS-MOBILE-PAIRING-CODE-NOT-PERSISTED-TEST` | `pairing-code-not-persisted` | `MD-16` nepřežije párování ani při chybě | `offline` |

### MC — Cache (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-CACHE-FRESHNESS-STATES-TEST` | `cache-freshness-states` | FRESH/STALE/EXPIRED podle `fetchedAt` a TTL | `offline` |
| `IS-T1-TESTS-MOBILE-CACHE-EXPIRED-PURGE-TEST` | `cache-expired-purge` | EXPIRED se maže při startu a přechodu do pozadí, ne až při zobrazení | `offline` |
| `IS-T1-TESTS-MOBILE-CACHE-ONLY-EXPLICIT-TEST` | `cache-only-explicit` | `I-2`: offline je čitelné jen explicitně cachované | `offline` |
| `IS-T1-TESTS-MOBILE-CACHE-INVALIDATION-TEST` | `cache-invalidation` | Refresh, kurzor a notifikace invalidují; TTL není invalidace | `offline` |
| `IS-T1-TESTS-MOBILE-CACHE-STALE-BLOCKS-ACTION-TEST` | `cache-stale-blocks-action` | Nad STALE daty nelze provést žádnou mutaci ani rozhodnutí | `offline` |
| `IS-T1-TESTS-MOBILE-CACHE-DISCARDABLE-TEST` | `cache-discardable` | `I-10`: smazání cache nezpůsobí ztrátu dat kromě `MD-14`/`MD-15` | `offline` |

### MO — Offline (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-OFFLINE-MUTATIONS-REFUSED-TEST` | `offline-mutations-refused` | `I-3`: změna serverového stavu se offline odmítne, neuloží | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-NEVER-QUEUED-TEST` | `offline-never-queued` | `I-4`: approval, příkaz, bezpečnostní a admin operace nemají frontu | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-APPROVAL-HIDDEN-TEST` | `offline-approval-hidden` | `MD-07` se offline nezobrazí vůbec | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-DRAFT-NO-AUTOSEND-TEST` | `offline-draft-no-autosend` | `I-5`: draft se po reconnectu neodešle sám | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-DRAFT-LOCAL-ONLY-TEST` | `offline-draft-local-only` | `D-M1`: mobilní draft se nezapisuje do serverových draftů | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-OPERATION-KEY-NOT-A-QUEUE-TEST` | `offline-operation-key-not-a-queue` | `I-11`: `PENDING`/`UNKNOWN` se nikdy neodešle sám; klíč neprodlužuje jednorázové oprávnění approvalu | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-OPERATION-KEY-UNKNOWN-STATE-TEST` | `offline-operation-key-unknown-state` | Nejasný timeout → `UNKNOWN`; klient nevyrobí nový klíč a ověřuje přes `GET /m1/operations/:id`, ne přes konverzaci | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-OPERATION-KEY-RECOVERY-TEST` | `offline-operation-key-recovery` | `MD-19` §4.1: server klíč nezná → retry jen s dostupným původním kanonickým požadavkem; jinak **žádný náhradní požadavek** | `offline` |
| `IS-T1-TESTS-MOBILE-OFFLINE-OPERATION-KEY-LIMIT-TEST` | `offline-operation-key-limit` | `MD-19` §4.3: po dosažení stropu se mutace odmítne fail-closed a **nejstarší `PENDING` se nemaže** | `offline` |

### ML — Lifecycle (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-LIFECYCLE-LOGOUT-WIPE-TEST` | `lifecycle-logout-wipe` | Logout maže vše podle §4 DATA-MODELu; token dřív než cache | `offline` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-REVOKE-WIPE-TEST` | `lifecycle-revoke-wipe` | Zjištěná revokace maže cache dřív, než se cokoli zobrazí | `offline` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-EXPIRY-READONLY-TEST` | `lifecycle-expiry-readonly` | Po expiraci je cache read-only do konce TTL | `offline` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-REVOKE-CANNOT-WIPE-OFFLINE-TEST` | `lifecycle-revoke-cannot-wipe-offline` | **`M-R1` je vlastnost:** revokace bez spojení nemaže nic. Test zamyká *dokumentovaný* limit, aby ho nikdo omylem „neopravil" tvrzením, že remote wipe funguje | `offline` |
| `IS-T2-TESTS-MOBILE-LIFECYCLE-TOKEN-STORAGE-TEST` | `lifecycle-token-storage` | `I-6`: token nikdy v cache DB ani preferencích | `database` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-OPERATION-JOURNAL-WIPE-TEST` | `lifecycle-operation-journal-wipe` | `MD-19`: logout a revokace mažou lokální index; expirace ho v dnešním `app.js` ponechá, ale nové spárování razí nový `deviceId`, takže staré serverové operace seznamem ani lookupem neobnoví | `offline` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-LOGOUT-UNRESOLVED-WARNING-TEST` | `lifecycle-logout-unresolved-warning` | Logout s `PENDING`/`UNKNOWN` varuje, že efekt na serveru může zůstat nerozřešený | `offline` |

### MV — Privacy (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-PRIVACY-LOG-REDACTION-TEST` | `privacy-log-redaction` | `MD-18` neobsahuje S2 ani S3, ani zkráceně, ani jako otisk | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-NOTIFICATION-CONTENT-TEST` | `privacy-notification-content` | `MD-08` nese ukazatel, ne obsah — kvůli zamčené obrazovce | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-DIAGNOSTICS-TEST` | `privacy-diagnostics` | Diagnostika a export neobsahují token ani obsah | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-STORAGE-CLASS-TEST` | `privacy-storage-class` | Každý typ `MD-xx` leží jen v úložišti povoleném jeho třídou | `offline` |

### MN — Contract (`C3-031`)

`R-3` je podle `DR-011` **cílový kontrakt**, ne současný implementační stav.
Zelený test jedné větve nesmí být použit jako důkaz produkčního producenta
approvalů, 5/15minutové TTL autority, povinného otisku ani autoritativní vazby
na run/operaci/normalizovaný obsah. Tyto end-to-end vlastnosti blokuje `F-100`.

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-CONTRACT-ERROR-STATES-TEST` | `contract-error-states` | Šest chybových stavů z DATA-MODEL §8.3 je rozlišitelných | `offline` |
| `IS-T1-TESTS-MOBILE-CONTRACT-CURSOR-REJECTION-TEST` | `contract-cursor-rejection` | Odmítnutý kurzor → plný refresh, nikdy dopočet | `offline` |
| `IS-T3-TESTS-MOBILE-CONTRACT-APPROVAL-IDEMPOTENCY-TEST` | `contract-approval-idempotency` | Tři rozlišené případy podle `MD-07` §`R-3.1`: týž klíč + týž otisk → **odpověď ze záznamu bez druhého efektu**; týž klíč + jiný otisk → **fail-closed konflikt**; **druhé uplatnění oprávnění nikdy**, ani s platným klíčem | `server` |
| `IS-T1-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST` | `contract-pagination-end` | Konec okna je explicitní; neúplný seznam se nezobrazí jako úplný | `offline` |
| `IS-T1-TESTS-MOBILE-CONTRACT-OPERATION-KEY-REUSE-TEST` | `contract-operation-key-reuse` | Síťový retry drží tentýž klíč; nové vědomé provedení dostane nový | `offline` |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-KEY-CONFLICT-TEST` | `contract-operation-key-conflict` | Tentýž klíč s jiným payloadem → fail-closed konflikt, ne druhý efekt | `server` |
| `IS-T2-TESTS-MOBILE-CONTRACT-OPERATION-KEY-PERSISTENCE-TEST` | `contract-operation-key-persistence` | Deduplikační záznam přežije retry interval i restart serveru | `database` |
| `IS-T1-TESTS-MOBILE-CONTRACT-OPERATION-STATUS-LOOKUP-TEST` | `contract-operation-status-lookup` | Stav operace se zjistí podle klíče **bez payloadu**; dotaz je čtení bez vedlejšího účinku | `offline` |
| `IS-T2-TESTS-MOBILE-CONTRACT-OPERATION-KEY-RATE-LIMIT-TEST` | `contract-operation-key-rate-limit` | Rate limit vzniku nových operací na zařízení/principal | `database` |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-DEVICE-BOUND-TEST` | `contract-operation-device-bound` | Cizí ani uhádnutý klíč nepřekročí hranici zařízení; revokovaný a vypršelý token nepřečtou ani vlastní operaci, a revokace se hlásí dřív než expirace | registrovaný program, PASS v M3, bez main integrace — `tests/mobile-gateway-boundary.test.js` |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-RETRY-NO-SECOND-EFFECT-TEST` | `contract-operation-retry-no-second-effect` | Zopakování s **týmž** klíčem odpoví ze záznamu a **nedojde k druhému odeslání** k upstreamu | registrovaný program, PASS v M3, bez main integrace — tamtéž |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-UNKNOWN-REASON-TEST` | `contract-operation-unknown-reason` | Důvod `UNKNOWN` je kód z uzavřeného seznamu (volný text degraduje na `unspecified`), `unknown_at` je orazítkované a lookup zapisuje `last_checked_at` | registrovaný program, PASS v M3, bez main integrace — tamtéž |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-CRASH-SWEEP-TEST` | `contract-operation-crash-sweep` | Start gateway překlopí `PENDING` po pádu procesu na `UNKNOWN` / `process_terminated` a **nesahá** na už rozřešené záznamy | registrované programy, PASS v M3, bez main integrace — tamtéž + `mobile-data-model.test.js` |

### MX — Client (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-CLIENT-SUITE-TEST` | `client-suite` | Historický návrh souhrnného můstku dle §5. Prázdný wrapper nevznikl; místo něj existuje pět přímých registrovaných `C3-032` programů | historický návrh, nikoli registry řádek |

---

## 8. Co se v mobilních testech nedělá

Zapsáno, protože každý z těchto vzorců už tenhle repozitář jednou stál důvěru.

| Zákaz | Evidence |
|---|---|
| „Očekávaný pass rate" a tolerance typu 89–97 % | `CLAUDE.md` §12, přesně tohle Gate 0 odhalil jako false-green |
| `assert(true)`, předčasný `return`, přijímání HTTP 5xx | `G0-R016` — 25 sad `KNOWN_DEFECTIVE` z tohoto důvodu |
| Test píšící do sledovaného stromu | `G0-R011` — jen pod artefaktový root |
| Import DB bez `C3_DB_PATH` | `G0-R012` — zmigruje operátorovu skutečnou databázi |
| Sada, která se sama „přeskočí" místo selhání | `G0-C6`, `G0-C7` |
| Změkčení aserce kvůli varianci místo stavu v registru | `CLAUDE.md` §12 |
| **Vydávat lokální zeleň za zrevidovanou, integrovanou nebo produktově hotovou** | Nález `F-070` z `RV-021`: přesně takové tvrzení review vrátilo. Zeleň je stav sady, ne stav produktu |
| **Testovat schopnost, která je `BLOCKED_BY_CONTRACT`** | §7.0 — zafixovalo by to tvar, který kontrakt teprve určí, a vypadalo by to jako pokrytí |

---

## 9. Pořadí, ve kterém testy vznikají

Nezávisí na fázích klienta, ale na tom, co brání čemu.

| # | Kdy | Co | Proč teď |
|---|---|---|---|
| **1** | Před jakýmkoli síťovým zpřístupněním | MB `offline` část, MS celá | `B2`/`S-3` jsou nepodkročitelné i pro spike (PLAN.md §8, bod 4) |
| **2** | Se vznikem gateway | MB `server` část jako `BLOCKED` s prerekvizitou | `B3` má být **před** `B4` |
| **3** | Se vznikem párování | MP | `B4` je nejrizikovější nový kód |
| **4** | Se vznikem klientského stavu | MC, MO, ML, MV | Pravidla mají testy dřív než obrazovky |
| **5** | S kontraktem `/m1` | MN | Nezmrazuje kontrakt; testuje rozlišitelnost, ne tvary |
| **6** | S klientskou aplikací | MX | **Dokončeno pro dnešní successory:** pět přímých programů je pod `C3-032`, bez prázdného wrapperu; budoucí klientský program musí dostat vlastní registry řádek (§4.2, §5) |
| **7** | Až bude společný kontrakt z kola `DR-008` schválený a refrozen jako v2, bude splněná příslušná Gate 1 evidence a vznikne samostatný implementační Work Package | Testy k autorizované doméně; kolo pokrývá nastavení, projekty, paměť, agenty, průběh běhu (`MR-07`) a hledání (`MR-10`) | Ani přijetí `DR-008`, ani samotné schválení kontraktu implementaci neautorizuje; test nesmí předběhnout fázi — §7.0 |

---

## 10. Otevřená rozhodnutí

| # | Otázka | Doporučení |
|---|---|---|
| ~~`D-T1`~~ | Zavést `C3-031` a `C3-032` do `CAPABILITY-MATRIX.md`? | **ROZHODNUTO a provedeno.** Oba capability řádky existují; reviewed registr má `C3-031=7`, `C3-032=5` (§3.1–§4.2) |
| ~~`D-T2`~~ | Můstek na klientské testy (V-2), nebo klient bez registru (V-1)? | **ROZHODNUTO a provedeno pro současné successory:** pět přímých fail-closed programů má vlastní řádky, bez prázdného wrapperu; podmínky §5 zůstávají závazné |
| ~~`D-T3`~~ | Kdy zapsat chybějící successor řádky do `tests/registry.json`? | **PROVEDENO:** po Composition Review C v `eee04db9`, s ID-preserving přesunem `MS-20`; `RV-042` schválilo registry delta |
| **D-T4** | Je `IS-T1-...-REVOKE-CANNOT-WIPE-OFFLINE-TEST` legitimní test, nebo dokumentace? | Test — zamyká přijatý limit `M-R1` proti pozdějšímu „vylepšení" |

---

*Navazuje: mapa obrazovek a toků pro fáze 1–5 → coverage matice.*
