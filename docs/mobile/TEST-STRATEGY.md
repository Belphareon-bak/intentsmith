# IntentSmith Mobile — testovací strategie a napojení na kanonický registr

**Status:** návrh k review; žádný test se tímto dokumentem nezakládá
**Datum:** 2026-07-30
**Ověřeno proti:** `54913a1` na `codex/intentsmith-1.0`
**Vychází z:** [DATA-MODEL.md](DATA-MODEL.md), [PLAN.md](PLAN.md) §2 a §8, [ADR 0001](../adr/0001-mobile-data-ownership.md)

Legenda: **[F]** ověřený fakt v tomto repu · **[R]** doporučení · **[?]** rozhodnutí operátora · **[D]** odloženo

---

## 0. Pravidlo, kterému se tento dokument podřizuje

> **Kanonický registr je `tests/registry.json`. Tento dokument žádný registr
> nezakládá, nenahrazuje ani nezrcadlí.**

PLAN.md §8 podmínka 3 zní: *„mobilní testy do registru od prvního dne — ať
nevznikne druhá nedohledatelná testovací plocha."* Nejjednodušší způsob, jak
tu podmínku porušit, je udělat si vedle registru „mobilní seznam testů".
Proto zde není seznam testů, ale **pravidla a šablony**, podle kterých mobilní
řádky vzniknou přímo v `tests/registry.json` — každý ve chvíli, kdy vznikne jeho
program.

---

## 1. Co registr vynucuje — ověřeno ve validátoru

Bez těchto sedmi faktů nelze mobilní testy zavést správně. Všechny jsou
z `scripts/test-registry.js` na `54913a1`.

| # | Fakt | Zdroj | Důsledek pro mobil |
|---|---|---|---|
| **F-1** | Registrovaná cesta **musí existovat** jako spustitelný program, jinak validátor selže: `registered path is missing or no longer runnable` | `test-registry.js:213` | **Testy nelze předregistrovat.** Řádek vzniká se souborem, ve stejném commitu. Rezervace ID dopředu není možná |
| **F-2** | Každý soubor pod `tests/` s podporovanou příponou musí být buď suite, nebo zdůvodněná výjimka (≥ 20 znaků) | `test-registry.js:208`, `:97` | Mobilní pomocný modul pod `tests/` bez registrace **shodí `G0-C3`**. Helper musí mít výjimku, nebo bydlet mimo `tests/` |
| **F-3** | `argv` musí být přesně `[executor, path]` — dva prvky, žádné přepínače | `test-registry.js:161` | Jeden program = jeden registrovaný řádek. Žádné parametrizované běhy typu `--suite=pairing` |
| **F-4** | Discovery prochází **jen** `tests/**` a `e2e/run-e2e.js` | `test-registry.js:52-63` | **Testy mobilního klienta mimo `tests/` jsou pro registr neviditelné.** To je přesně ta druhá plocha — řeší §5 |
| **F-5** | Symbolické odkazy jsou tvrdě odmítnuty | `test-registry.js:348` | Klientské testy nelze do `tests/` „nasymlinkovat" |
| **F-6** | `capabilityId` musí odpovídat `^C3-\d{3}$`; validátor **neověřuje**, že řádek existuje v `CAPABILITY-MATRIX.md` | `test-registry.js:141` | Nová capability ID se dají zavést tiše. Právě proto je §3 návrh, ne fait accompli |
| **F-7** | `TEST-REGISTRY.md` je generovaný; ruční editace = `stale` a exit 1 | `validate-test-registry.js:27` | Po každé změně registru `node scripts/validate-test-registry.js --write-doc` |

**[F] Gate 0 dopad:** `G0-C5` je definovaný jako *všechny* řádky s profilem
`offline` (T1) a `database` (T2), stav `ACTIVE`, `required: true` — dnes 199 sad
(`GATE-CRITERIA.md`). Každý nový deterministický mobilní test to číslo zvyšuje
a mění otisk registru; podle `GATE-CRITERIA.md` § *Scope of a verdict* tím
**padá kandidátský verdikt** a evidence se generuje znovu. To není důvod testy
nepsat — je to důvod psát je vědomě a ne uprostřed evidenčního běhu.

---

## 2. Konvence, které se přebírají beze změny

Odvozeno z 350 existujících řádků, ne vymyšleno.

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

`owner` je ve všech 350 řádcích `"primary implementer"`; mobil nezavádí nového
vlastníka, dokud ho operátor nepojmenuje.

### 2.3 Stavy

- `ACTIVE` — smí přinášet zelenou evidenci.
- `BLOCKED` — **musí pojmenovat konkrétní technickou prerekvizitu** (`G0-C7`).
  „Ještě není hotovo" není prerekvizita; „neexistuje vlastněný supervizor
  odděleného listeneru" ano.
- `KNOWN_DEFECTIVE` — test existuje, ale jeho aserce neplatí. Nikdy se nepočítá
  jako zelený (`G0-C6`).
- `HISTORICAL` — nesmí být `required`.

---

## 3. Capability ID pro mobil — **[?] `D-T1` rozhodnuto, neaplikováno**

`CAPABILITY-MATRIX.md` má dnes `C3-001`..`C3-030` a **žádný mobilní řádek**.
Mobilní testy musí na něco ukazovat. Tři možnosti:

| Varianta | Hodnocení |
|---|---|
| Použít `C3-023` (API a WS bridge) pro všechno mobilní | Zamlží, o čem evidence mluví. `C3-023` je stávající IDE bridge; mobilní gateway je jiný listener s jinou hranicí |
| Nová capability ID | **[R]** Čisté, ale mění Gate 0 ledger — patří operátorovi, ne mobilní větvi |
| Nechat mobilní testy bez capability | Nelze, `F-6` to nedovolí |

**[R] Návrh k rozhodnutí operátorem** — dva řádky do `CAPABILITY-MATRIX.md`:

```markdown
| C3-031 | Mobile gateway and device authorization | UNVERIFIED | Separate listener, scoped device tokens, and pairing are designed but not implemented; see `docs/mobile/PLAN.md` §2 | primary implementer |
| C3-032 | Mobile companion client | UNVERIFIED | Client state, cache, and offline behavior are designed in `docs/mobile/DATA-MODEL.md`; no client exists | primary implementer |
```

Rozdělení dvou ID není kosmetika: `C3-031` je **serverová bezpečnostní hranice**,
která má cenu i kdyby žádný telefon nikdy nevznikl (PLAN.md: S-1..S-4 jsou na
mobilu nezávislé). `C3-032` je klient. Slepit je znamená, že selhání klienta
zabarví bezpečnostní evidenci a naopak.

### 3.1 Kdy se řádky přidají — rozhodnuto

> **Oba capability řádky se přidají atomicky ve stejném commitu jako první
> skutečný mobilní test.** Ne dřív.

Důvod je symetrický s `F-1`: registr zakazuje registraci neexistující cesty,
protože visící registrace je nepravdivý ledger. Capability řádek bez jediného
testu je totéž o patro výš — schopnost vedená v matici, ke které se nikdy nikdo
nechystal nic ověřit.

Obsah toho commitu je pevný a nedělitelný:

```
1. oba capability řádky do docs/convergence/CAPABILITY-MATRIX.md
   (přesné znění výše, beze změn)
2. existující testovací soubor tests/mobile/<rodina>-<případ>.test.js
3. jeho řádek v tests/registry.json
4. node scripts/validate-test-registry.js --write-doc
5. regenerovaný docs/convergence/TEST-REGISTRY.md
```

Tím nevznikne ani dočasně nepravdivá matice, ani visící registrace. Každý
další mobilní test už jen opakuje kroky 2–5; capability řádky se přidávají
jednou.

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
| **MX — Client** | `tests/mobile/client-*` | `offline` | `C3-032` | Most k testům klientské aplikace — viz §5 |

### 4.1 Proč je většina rodin `offline`

Protože doménová pravidla z DATA-MODEL.md jsou **čisté funkce**: „smí se tento
záznam offline zobrazit?", „co maže logout?", „je tenhle stav STALE?", „patří
tahle položka do logu?". Takové věci se testují bez sítě, serveru i telefonu —
a proto mohou být `ACTIVE` a nést zelenou evidenci dřív, než existuje jediný
řádek klientského kódu.

To je záměr: **pravidla mají testy dřív než obrazovky.** Mapa obrazovek na to
navazuje tím, že každý tok odkazuje na budoucí testovací ID.

### 4.2 Co naopak `ACTIVE` být nemůže

Rodina **MB** ve své skutečné podobě potřebuje dva běžící listenery a vlastněný
supervizor procesu. Ten podle `TEST-REGISTRY.md` neexistuje (profil `server` je
*„hard-blocked until an owned, identity-verified server supervisor exists"*).

Řádky MB proto vzniknou jako `BLOCKED` s pojmenovanou prerekvizitou —
a to je korektní stav podle `G0-C7`, ne odklad. Zároveň se **rozhodovací logika
téže hranice** (route allow-listy, default deny, mapa scope → operace) testuje
`offline` a `ACTIVE` už teď.

> Rozdělení je podstatné: *„vzdálený peer nedosáhne na `/api/*`"* je tvrzení
> o nasazení a chce `server` profil. *„rozhodovací funkce vrátí deny pro cestu,
> která není v allow-listu"* je tvrzení o kódu a chce `offline` profil.
> První bez druhého se nedá napsat; druhé bez prvního nic nedokazuje o realitě.

---

## 5. Testy klientské aplikace — kde vzniká druhá plocha

**[F]** Discovery prochází jen `tests/**` a `e2e/run-e2e.js` (`F-4`).
Aplikace React Native / Expo (PLAN.md §7) bude bydlet mimo — a její jestové
testy tedy **v registru nebudou**. To je doslova ta „druhá nedohledatelná
testovací plocha", proti které je podmínka 3 v PLAN.md §8 napsaná.

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

Můstek se registruje **až s klientem**. Do té doby neexistuje ani soubor, ani
řádek (`F-1`).

---

## 6. Přesně aplikovatelný návrh zápisu do registru

Kvůli `F-1` **nelze** vložit nic z následujícího do `tests/registry.json` dřív,
než vznikne odpovídající program. Následující blok je proto **šablona**, ne
registr: pole jsou vyplněná tak, jak mají vypadat, a jediné, co se při skutečném
zápisu mění, je ověření, že `path` existuje.

Postup pro jeden test (opakuje se, nikdy hromadně):

```
0. jen u ÚPLNĚ PRVNÍHO: oba capability řádky do CAPABILITY-MATRIX.md (§3.1)
1. vznikne tests/mobile/<rodina>-<případ>.test.js
2. do tests/registry.json přibude jeho řádek podle šablony níže
3. node scripts/validate-test-registry.js --write-doc
4. commit obsahuje program + řádek registru + regenerovaný TEST-REGISTRY.md
```

Krok 4 je jediný správný tvar. Program bez řádku shodí `G0-C3` (`F-2`); řádek
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

Prerekvizita takového řádku se formuluje konkrétně — *„neexistuje vlastněný
supervizor, který by spustil oddělený mobilní listener vedle loopback serveru
a ověřil jeho identitu"* — a bydlí tam, kde `G0-C7` prerekvizity hledá, ne
v tomto dokumentu.

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

### 6.4 Kolize s integrační větví

Zápis do `tests/registry.json` teď koliduje s probíhající prací na integrační
větvi — položkovým uzavíráním 92 `REBUILD` položek a deterministickým
manifestem. Každý řádek navíc mění otisk registru a tím i kandidátský verdikt
(`GATE-CRITERIA.md`).

**Proto:** dokud integrační práce běží, mobilní řádky se **nezapisují**.
Šablony výše jsou hotové k aplikaci a jsou závislé jen na existenci programu
a na rozhodnutí z §3. **Náhradní registr se nezakládá** — ani „prozatímní",
ani „jen pro mobil".

---

## 7. Katalog testovacích ID pro budoucí odkazování

Mapa obrazovek a coverage matice potřebují na co ukazovat dřív, než testy
existují. Odkazuje se proto na **plánované ID**, které se odvodí z cesty podle
§2.1 a je tím pádem předvídatelné, ne vymyšlené.

> **Tohle není registr.** Řádek se stává skutečným až krokem z §6. Do té doby je
> ID pouze závazek, jak se ten test bude jmenovat, až vznikne. Cokoli z toho může
> zaniknout, změnit rozsah nebo se sloučit.

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
| `IS-T1-TESTS-MOBILE-OFFLINE-OPERATION-KEY-UNKNOWN-STATE-TEST` | `offline-operation-key-unknown-state` | Nejasný timeout → `UNKNOWN`; klient nevyrobí nový klíč automaticky | `offline` |
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
| `IS-T1-TESTS-MOBILE-LIFECYCLE-OPERATION-JOURNAL-WIPE-TEST` | `lifecycle-operation-journal-wipe` | `MD-19`: logout a revokace mažou žurnál; expirace ho ponechává | `offline` |
| `IS-T1-TESTS-MOBILE-LIFECYCLE-LOGOUT-UNRESOLVED-WARNING-TEST` | `lifecycle-logout-unresolved-warning` | Logout s `PENDING`/`UNKNOWN` varuje, že efekt na serveru může zůstat nerozřešený | `offline` |

### MV — Privacy (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-PRIVACY-LOG-REDACTION-TEST` | `privacy-log-redaction` | `MD-18` neobsahuje S2 ani S3, ani zkráceně, ani jako otisk | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-NOTIFICATION-CONTENT-TEST` | `privacy-notification-content` | `MD-08` nese ukazatel, ne obsah — kvůli zamčené obrazovce | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-DIAGNOSTICS-TEST` | `privacy-diagnostics` | Diagnostika a export neobsahují token ani obsah | `offline` |
| `IS-T1-TESTS-MOBILE-PRIVACY-STORAGE-CLASS-TEST` | `privacy-storage-class` | Každý typ `MD-xx` leží jen v úložišti povoleném jeho třídou | `offline` |

### MN — Contract (`C3-031`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-CONTRACT-ERROR-STATES-TEST` | `contract-error-states` | Šest chybových stavů z DATA-MODEL §8.3 je rozlišitelných | `offline` |
| `IS-T1-TESTS-MOBILE-CONTRACT-CURSOR-REJECTION-TEST` | `contract-cursor-rejection` | Odmítnutý kurzor → plný refresh, nikdy dopočet | `offline` |
| `IS-T3-TESTS-MOBILE-CONTRACT-APPROVAL-IDEMPOTENCY-TEST` | `contract-approval-idempotency` | Druhé rozhodnutí je rozpoznatelný konflikt, ne druhé schválení | `server` |
| `IS-T1-TESTS-MOBILE-CONTRACT-PAGINATION-END-TEST` | `contract-pagination-end` | Konec okna je explicitní; neúplný seznam se nezobrazí jako úplný | `offline` |
| `IS-T1-TESTS-MOBILE-CONTRACT-OPERATION-KEY-REUSE-TEST` | `contract-operation-key-reuse` | Síťový retry drží tentýž klíč; nové vědomé provedení dostane nový | `offline` |
| `IS-T3-TESTS-MOBILE-CONTRACT-OPERATION-KEY-CONFLICT-TEST` | `contract-operation-key-conflict` | Tentýž klíč s jiným payloadem → fail-closed konflikt, ne druhý efekt | `server` |
| `IS-T2-TESTS-MOBILE-CONTRACT-OPERATION-KEY-PERSISTENCE-TEST` | `contract-operation-key-persistence` | Deduplikační záznam přežije retry interval i restart serveru | `database` |
| `IS-T1-TESTS-MOBILE-CONTRACT-OPERATION-STATUS-LOOKUP-TEST` | `contract-operation-status-lookup` | Stav operace se zjistí podle klíče **bez payloadu**; dotaz je čtení bez vedlejšího účinku | `offline` |
| `IS-T2-TESTS-MOBILE-CONTRACT-OPERATION-KEY-RATE-LIMIT-TEST` | `contract-operation-key-rate-limit` | Rate limit vzniku nových operací na zařízení/principal | `database` |

### MX — Client (`C3-032`)

| Plánované ID | Cesta | Tvrzení | Profil |
|---|---|---|---|
| `IS-T1-TESTS-MOBILE-CLIENT-SUITE-TEST` | `client-suite` | Můstek dle §5, fail-closed | `offline` (dokud nevyžaduje toolchain) |

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
| **6** | S klientskou aplikací | MX | Můstek, ne druhá plocha |

---

## 10. Otevřená rozhodnutí

| # | Otázka | Doporučení |
|---|---|---|
| ~~`D-T1`~~ | Zavést `C3-031` a `C3-032` do `CAPABILITY-MATRIX.md`? | **ROZHODNUTO:** ano, dvě ID, ale **atomicky s prvním skutečným mobilním testem** (§3.1) |
| **D-T2** | Můstek na klientské testy (V-2), nebo klient bez registru (V-1)? | V-2 s pěti podmínkami z §5 |
| **D-T3** | Kdy se smí zapsat první mobilní řádek do `tests/registry.json`? | Až integrační větev dokončí manifest a uzavírání `REBUILD` (§6.4) |
| **D-T4** | Je `IS-T1-...-REVOKE-CANNOT-WIPE-OFFLINE-TEST` legitimní test, nebo dokumentace? | Test — zamyká přijatý limit `M-R1` proti pozdějšímu „vylepšení" |

---

*Navazuje: mapa obrazovek a toků pro fáze 1–5 → coverage matice.*
