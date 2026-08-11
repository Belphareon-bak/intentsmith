# Kontrakt v2 pro šest domén — NÁVRH, revize 3

**Stav:** `NÁVRH` · **Review revize 2:** `CHANGES_REQUIRED` (de73f893)
**Datum revize:** 2026-08-12 · **Autor:** implementační session
**Autorizace:** `DR-008` — autorizuje **návrh, review a refreeze**, nic víc
**Určeno:** k novému nezávislému review; revidovat nesmí autor

> **Struktura podle doporučení review.** Jeden dokument, jak `DR-008` žádá, ale
> uvnitř rozdělený na **společné wire jádro (část A)** a **šest doménových
> příloh (část B)**. Domény bez providera zůstávají `unavailable`, dokud nemají
> Gate 1 a WP.

---

## 0. Stav revize 3

Revize 2 dostala `CHANGES_REQUIRED` se sedmi blokujícími nálezy. **Tahle revize
uzavírá společné jádro (část A) a rozhodnutí, která review vyžádalo. Doménové
přílohy (část B) normativní schémata ještě nemají** — viz §0.2. Netvrdím tedy,
že je dokument refreeze-grade; není.

Review také oprávněně vytklo, že §0 revize 2 hlásila „všech deset vyřešeno",
zatímco pět z nich bylo opravených **směrem**, ne uzavřených kontraktně. Tahle
tabulka proto rozlišuje obojí.

### 0.1 Sedm nálezů z review revize 2

| # | Nález | Stav |
|---|---|---|
| 1 | A4: identita operace a sémantika `UNKNOWN` | **uzavřeno** — otisk počítá server nad `{protocolVersion, operationType, resource, expectedVersion, payload}`; `UNKNOWN` je lokální úsudek do lookupu; body pádu a reconciliation v `A4.5` |
| 2 | A5 nebyl uzavřený slovník | **uzavřeno** — celý enum, HTTP status, `retryable`, povinné `details`, `reason` uniony a vztah k `MutationOutcome` |
| 3 | A7 odporoval cache lifecycle | **uzavřeno** — `EXPIRED` se nezobrazí ani offline; **globální TTL odstraněno**, je to otevřené rozhodnutí `D-M5` |
| 4 | B4.3 a B5 jsou požadavky, ne kontrakty | **částečně** — `410` nově vrací `oldestAvailableSeq`; úplné DTO a redakční allow-list chybí (§0.2) |
| 5 | A3 odkládal riziko do WP | **uzavřeno** — `snapshot` definován per stream, tie-break, `NULLS LAST`, rotace klíče, expirace, zákaz překladu `c1`↔`c2` |
| 6 | A1 nebyla úplná negotiation | **uzavřeno** — konkrétní verze, hlavička, výběr, downgrade, **capability po funkcích** |
| 7 | DTO a §10 nejsou refreeze-grade | **neuzavřeno** (§0.2) |

### 0.2 Co v revizi 3 vědomě CHYBÍ

Aby to nikdo nemusel hledat: **část B nemá normativní request/response schémata**
pro těch 13 rout, chybí `T` u jednotlivých `MutationOutcome<T>`, mapování
`INTEGER id`/`last_active` z jádra na wire, tělo `POST /m1/search`, definice
`RunEventData` a serverový redakční allow-list. Matice v §10 je checklist
negativních scénářů, **ne** sada pozitivních fixtures, kterou `ROADMAP` žádá.

Bez toho **nemá smysl žádat o `APPROVED`**. Tahle revize je předkládaná proto,
aby se uzavřelo jádro dřív, než se nad ním postaví třináct schémat — ne proto,
aby se prohlásila za hotovou.

### 0.3 Rozhodnutí, která review zodpovědělo a jsou zapracovaná

| Rozhodnutí | Kde |
|---|---|
| TTL `60 s / 15 min` **neschváleno** | `A7.2` — TTL z kontraktu odstraněno |
| Dry-run má **vlastní scope** | `A6` — `execute:worker-dry-run` |
| Read-only `POST /m1/search` **schváleno** | `B6.3` beze změny |
| `events` **neslučovat** s detailem běhu | `§9` beze změny |
| `REVIEWED` **není** platný stav | `§12` — nahrazeno; `PLAN` §5 ho nezná |
| Offline fallback hledání | `§11` — otevřené, `SCREENS` ho nezakazuje |

### 0.4 Co bylo opraveno už v revizi 2

Tři věcné chyby: projektová premisa (jádro projekty **má**), mazání paměti
(`PLAN` říká „bez mazání"), a `manual` jako provenance místo `kind`. Plus pořadí
Gate 1 a refreeze.

| # | Nález | Jak je vyřešený |
|---|---|---|
| 1 | Pořadí Gate 1 a refreeze si odporovalo | §0.1 — refreeze **až po** Gate 1 `C3-002` a `C3-023` |
| 2 | Chyběl kontrakt mutací | `A4` — `MutationOutcome<T>` pro **každou** mutaci |
| 3 | Dry-run neměl rozhodnutou sémantiku | `B4.3` — dnešní `dryRun()` **není `MR-20`**; zapsáno jako požadavek na backend |
| 4 | Polling událostí nerozlišil konec, ticho a ztracené okno | `B5.4` — `caughtUp`, `runTerminal`, `event_window_gone` |
| 5 | Hledaný dotaz v URL | `B6.3` — read-only **`POST`** s tělem |
| 6 | „v2" bez wire verze a capability negotiation | `A1` — oddělená wire verze, capability per doména |
| 7 | Paměť porušovala schválený rozsah | `B3` — **`DELETE` odstraněn**, `manual` je provenance, ne `kind` |
| 8 | Projektová premisa fakticky chybná | `B2.1` — projekty v jádře **existují**; kontrakt je adaptér |
| 9 | Kurzor není prokazatelně serverem vydaný | `A3` — keyset kurzor se snapshotem, podepsaný |
| 10 | DTO a cache pravidla nedostatečná | `A7` + DTO v každé příloze |

**Rozhodnutí uzavřená podle akčního plánu review:** bez mazání paměti, bez
zápisu projektů, bez ostrého běhu workera, `read:search` zůstává samostatný
opt-in scope.

### 0.1 Pořadí — oprava blokujícího nálezu

Revize 1 předpokládala refreeze a **potom** Gate 1 pro fáze. `PLAN.md` §8,
podmínka 2 schváleného kompromisu, to má obráceně a je autoritativní:
*„Formální kontrakt `/m1` v2 se nerefrozne, dokud backend nemá Gate 1 pro
`C3-002` (chat sessions) a `C3-023` (API/WS bridge)."*

Platné pořadí:

1. **Návrh** (tento dokument) → nezávislé review → **`APPROVED`**.
   `PLAN` §5 slovník `REVIEWED` nezná, takže se nezavádí. `APPROVED` **není**
   `REFROZEN` a neautorizuje žádnou implementaci.
2. **Gate 1 evidence pro `C3-002` a `C3-023`.** Bez obou se nerefreezuje.
3. **`REFROZEN` v2.**
4. Teprve pak **per fázi**: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve v tom WP vzniká routa, obrazovka a testy.

---

# ČÁST A — Společné wire jádro

Dědí ho všech šest domén. Doména nesmí žádné z těchto pravidel obejít ani
„upřesnit" po svém.

## A1. Verze a negotiation

### A1.1 Konkrétní verze, ne zástupné znaky

| | Hodnota | Co určuje |
|---|---|---|
| Dnešní wire | `m1.2026-07-30` | dnešních 13 rout |
| Wire v2 | **`m1.2026-08-12`** | tvar obálky, chyb, kurzoru `c2`, `MutationOutcome` |
| Kontrakt | **`v2`** | které funkce existují a v jakém tvaru |

Wire verze a kontraktní verze se **mění nezávisle**: oprava tvaru chyby zvedne
wire, přidání domény zvedne kontrakt.

### A1.2 Průběh dohody

1. Klient posílá hlavičku `X-M1-Protocol` se **seznamem** verzí, které umí,
   v pořadí preference.
2. Server vybere **nejvyšší společnou** a **každá** odpověď ji hlásí v
   `protocolVersion` — včetně `capabilities` a včetně chyb.
3. Bez hlavičky se předpokládá `m1.2026-07-30`, aby dnešní klient nepřestal
   fungovat.
4. Žádná společná → `426 protocol_mismatch` s polem `supportedProtocols`.
   **Downgrade dělá klient vědomě**, server ho nikdy nevnutí mlčky.

### A1.3 Capability po funkcích, ne po doménách

Jeden stav na doménu neumí vyjádřit, že `workers.read` a `workers.toggle` jsou,
zatímco `workers.dryRun` není. `GET /m1/capabilities` proto vrací **funkce**:

```
features: {
  "settings.read":   { status, scopes: [...], since },
  "settings.write":  { ... },
  "projects.read":   { ... },
  "memory.read":     { ... },
  "memory.append":   { ... },
  "workers.read":    { ... },
  "workers.toggle":  { ... },
  "workers.dryRun":  { ... },
  "runs.list":       { ... },
  "runs.events":     { ... },
  "search.query":    { ... }
}
```

`status` se určuje **v tomto pořadí**, aby byl jednoznačný:

1. provider neexistuje → **`unavailable`** (bez ohledu na scopes);
2. provider je, zařízení nemá **všechny** vypsané scopes → **`forbidden`**;
3. jinak → **`available`**.

**Neimplementovaná funkce se hlásí `unavailable`, nikdy prázdným úspěchem.**
Neznámou funkci klient ignoruje a zapíše do diagnostiky (§3.4 `UI-DESIGN`).

## A2. Obálka

`ok`, `protocolVersion` (dohodnutá, A1.2), `contractVersion`, `scopes`,
`principalId`, `serverTime`, `data`. Odpověď vždy hlásí scopes, pod kterými
požadavek **skutečně** proběhl.

## A3. Stránkování — kurzor `c2`

Dnešní `c1` je offset s nezabezpečeným součtem: klient si ho sestaví a při řazení
podle měnícího se klíče přeskočí nebo zopakuje položku.

### A3.1 Tvar

```
c2 = base64url(payload) + "." + HMAC-SHA256(payload, serverKey)
payload = {
  v: 2,
  stream,        // doména + kanonizované filtry + řazení
  principalId, deviceId,
  snapshot,      // viz A3.2
  sortKey, id,   // poslední vydaná položka
  direction,     // forward | backward
  issuedAt, expiresAt
}
```

### A3.2 Snapshot — co to je pro každý stream

`snapshot` je **hodnota, podle které se pozná, že podklad už není tentýž**.
Definuje se per stream, ne obecně:

| Stream | `snapshot` |
|---|---|
| `settings` | nestránkuje se |
| `projects` | `MAX(updated_at)` nad viditelnou množinou |
| `memory` | `MAX(last_used_at)` nad viditelnou množinou |
| `workers` | `MAX(updated_at)` |
| `runs` | `MAX(seq)` posledního běhu |
| `search` | otisk dotazu + čas vydání první stránky |

Server porovná `snapshot` z kurzoru s aktuálním. Neshoda → `cursor_unknown`,
`reason: snapshot_gone`. **Není to úsudek o „velikosti změny"** — je to
rovnost dvou hodnot.

### A3.3 Stabilita řazení

- **Tie-break je vždy `id`**: `ORDER BY sortKey DESC, id DESC`. Bez něj dvě
  položky se stejným časem nemají určené pořadí.
- **`NULL` řadí poslední** (`NULLS LAST`) ve všech streamech.
- **Membership se během chůze nemění**: filtr je součástí `stream` a je
  kanonizovaný, takže jiný filtr = jiný kurzor.
- Změna `sortKey` položky ji může přesunout přes už vydanou hranici. Proto je
  `snapshot` **povinný u každého streamu, kde je řadicí klíč měnitelný** —
  `projects`, `memory`, `workers`. Tam se změna projeví jako `snapshot_gone`,
  ne jako tichý přeskok.

### A3.4 Klíč, expirace, koexistence

- HMAC klíč je **serverový**, rotovatelný; kurzor podepsaný odvolaným klíčem →
  `cursor_unknown`, `reason: key_rotated`.
- `expiresAt` je povinné; prošlý kurzor → `cursor_unknown`, `reason: expired`.
- Kurzor je vázaný na `principalId` **i** `deviceId` — cizí zařízení jím
  stránku nevydá.
- **`c1` a `c2` se nikdy nepřekládají.** `c1` platí jen na routách wire v1,
  `c2` jen na v2. Záměna → `cursor_unknown`, `reason: cursor_version_mismatch`.

> **Migrace.** Implementace `c2` patří do WP. **Sémantika koexistence je ale
> součástí refreeze** — jinak by první WP musel rozhodovat, co se stane se
> starým kurzorem. Dnešní `/m1/conversations` používá `updated_at DESC` s
> offsetem, takže na v2 přechází na `c2` **povinně**, ne volitelně; historie
> zpráv je append-only a mohla by zůstat, ale nezůstane, aby nevznikly dva
> režimy.

## A4. Mutace

### A4.1 Identita operace — otisk počítá server

Revize 2 nechávala otisk počítat klienta a jen z `payload`. To neváže operaci na
typ ani na cíl, takže stejný klíč se stejným tělem na **jiné routě** by vypadal
jako replay. Dnešní hranice to už dělá správně: `operation-journal.js` počítá
otisk serverově a `approval-authority.js` říká výslovně, že se otisk **počítá,
nepřijímá od volajícího**.

**Klient posílá:**

```
{ operationId, payload, expectedVersion? }
```

**Server počítá** kanonický otisk nad:

```
{ protocolVersion, operationType, resource, expectedVersion, payload }
```

`resource` je úplný cíl (`settings:llm.temperature`, `worker:42`). Otisk od
klienta se **ignoruje**, i kdyby dorazil.

### A4.2 `MutationOutcome<T>`

```
{ operationId, deviceId, operationType, resource,
  state,        // CONFIRMED | REJECTED | PENDING | UNKNOWN
  fingerprint,  // serverem počítaný
  result,       // T, jen u CONFIRMED
  reason,       // uzavřený union, u REJECTED a UNKNOWN
  at }
```

### A4.3 Pravidla

| Situace | Chování |
|---|---|
| Stejný `operationId`, **stejný** otisk | vrátí **původní výsledek**, neprovede podruhé |
| Stejný `operationId`, **jiný** otisk | `409 operation_conflict` |
| `expectedVersion` neplatí | `409 state_conflict`, vrací serverovou hodnotu |
| Cizí `deviceId` | `404` — operace je vázaná na `(deviceId, operationId)` |

### A4.4 `UNKNOWN` — oprava sémantiky

Revize 2 tvrdila, že ztráta odpovědi znamená serverový `UNKNOWN`. **Neplatí.**
Když server efekt provedl a zapsal `CONFIRMED`, lookup musí vrátit `CONFIRMED` —
dnešní `handlers.js` to tak dělá.

- `UNKNOWN` je **lokální úsudek klienta**, dokud se nezeptá `GET /m1/operations/:id`;
- serverový `UNKNOWN` existuje **jen tehdy**, když server sám nedokáže efekt
  rozhodnout, a nese `unknownReason` z uzavřeného seznamu.

### A4.5 Body pádu

Kontrakt musí platit v každém z nich; test #6 se dělí odpovídajícím způsobem:

| Pád | Co musí platit po restartu |
|---|---|
| před efektem | `PENDING` nebo nic; opakování se stejným klíčem provede efekt **jednou** |
| po efektu, před zápisem výsledku | lookup vrátí `UNKNOWN` s důvodem; **reconciliation** dohledá efekt a stav dorovná |
| po `CONFIRMED`, před odpovědí | lookup vrátí **`CONFIRMED`**, ne `UNKNOWN` |

„Žurnál se zapisuje první" atomicitu **nezaručuje**. Kontrakt proto žádá jedno
ze dvou: **doménový zápis a terminální stav žurnálu v jedné transakci**, nebo
**reconciliation při startu**, která nedokončené operace dorovná proti skutečnému
efektu. WP musí doložit, kterou variantu zvolil.

## A5. Chybová algebra — celý uzavřený enum

Revize 2 tvrdila uzavřenost a přitom používala kódy mimo tabulku. Toto je celý
enum; **nic mimo něj se nevydává**.

| Kód | HTTP | `retryable` | Povinné `details` |
|---|---|---|---|
| `server_unavailable` | 503 | ano | — |
| `token_missing` / `token_invalid` / `token_expired` / `token_revoked` | 401 | ne | — |
| `scope_required` | 403 | ne | `required[]` |
| `not_found` | 404 | ne | `resource` |
| `route_not_allowed` | 404 | ne | — |
| `state_conflict` | 409 | ne | `expectedVersion`, `actualVersion` |
| `operation_conflict` | 409 | ne | `operationId` |
| `bad_request` | 400 | ne | `reason`, `field?` |
| `cursor_unknown` | 400 | ne | `reason`, `restart: true` |
| `protocol_mismatch` | 426 | ne | `supportedProtocols[]` |
| `domain_unavailable` | 503 | ne | `feature` |
| `event_window_gone` | 410 | ne | `oldestAvailableSeq` |
| `rate_limited` | 429 | ano | `retryAfterMs` |
| `operation_limit` | 429 | ne | `open`, `limit` |

**Uzavřené `reason` uniony:**

- `cursor_unknown`: `malformed` | `unrecognized` | `stream_mismatch` |
  `snapshot_gone` | `expired` | `key_rotated` | `cursor_version_mismatch`
- `bad_request`: `anchor_unknown` | `anchor_with_cursor` | `unknown_parameter` |
  `value_out_of_range` | `query_too_long`

**Vztah k `MutationOutcome`:** HTTP chyba a `state` se **nemíchají**. Odmítnutí
na úrovni protokolu (401/403/426) je HTTP chyba **bez** `MutationOutcome`.
Odmítnutí doménové je `200` s `state: REJECTED` a `reason`. Konflikty (409) jsou
HTTP chyba, protože klient nemá co potvrzovat.

## A6. Scopes

| Funkce | Scope |
|---|---|
| `settings.read` / `settings.write` | `read:settings` / `write:settings` |
| `projects.read` | `read:projects` |
| `memory.read` / `memory.append` | `read:memory` / `write:memory` |
| `workers.read` / `workers.toggle` | `read:workers` / `write:workers` |
| `workers.dryRun` | **`execute:worker-dry-run`** — samostatný |
| `runs.list` / `runs.events` | `read:runs` |
| `search.query` | `read:search` + čtecí scope každé prohledávané domény |

Dry-run má **vlastní scope**: `write:workers` je konfigurace, dry-run je příkaz
ke spuštění. Spojit je do jednoho by znamenalo, že kdo smí přepnout přepínač,
smí i spouštět. `FORBIDDEN_SCOPES` platí beze změny; `admin` nic neobchází.

## A7. Cache

### A7.1 Životní cyklus — beze změny proti `DATA-MODEL`

`FRESH` → zobrazí se bez upozornění · `STALE` → **jen čtení**, povinný ukazatel
stáří · `EXPIRED` → **nezobrazí se ani offline** a při úklidu se maže.

Revize 2 dovolovala zobrazit `EXPIRED` s poznámkou. To je v přímém rozporu
s invariantem a je **odstraněno**.

### A7.2 TTL — nerozhodnuto, a kontrakt ho neurčuje

Revize 2 zaváděla globální `60 s / 15 min`. Nemá to oporu v žádném rozhodnutí a
review to neschválilo. `DATA-MODEL` má per-doménové návrhy (nastavení 1 h / 24 h,
projekty 15 min / 7 dnů, paměť 1 h / 7 dnů, workeři 5 min / 7 dnů), ale ty jsou
stále vedené jako **návrh `D-M5`**.

**Kontrakt proto TTL neurčuje.** Je to otevřené rozhodnutí (§11) a musí padnout
před refreeze — ne uvnitř tohoto dokumentu.

### A7.3 Klíč a úklid

Klíč cache: `serverIdentity` + `deviceId` + `contractVersion` + `domain` +
`canonicalFilter`. `serverIdentity` tam je proto, že tentýž telefon může být
spárovaný s jiným strojem; bez ní by se oddíly mísily.

Úklid nastává při: revokaci, odhlášení, **ztrátě scope**, změně
`serverIdentity`, změně `contractVersion` a novém spárování.

> **Co kontrakt slíbit nemůže:** vzdálený wipe offline telefonu. Revokace maže
> data teprve tehdy, když ji zařízení **autenticky přijme**. Slibovat víc by byla
> nepravda o bezpečnostní vlastnosti.

## A8. Routy

Kontrakt routy jmenuje, jejich vznik neautorizuje. 13-route allow-list platí až
do WP, který routu implementuje.

# ČÁST B — Šest doménových příloh

## B1. Nastavení (Fáze 2, `MR-12`, `MR-13`)

### B1.1 Rozhodnuté

`R-5` je **uzavřené a závazné** (`PLAN.md` §5.4). Dělení se nemění, jen se
přepisuje do wire formátu. **Filtr je na serveru**, ne skrývání v UI:
desktop-only klíč se přes `/m1` nesmí ani přečíst.

| Na mobil | Desktop-only |
|---|---|
| LLM: model, temperature, context | GPU offload, batch size, threads, NUMA, rope scaling |
| Notifikace: kanály, tichý režim, priority | webhook secret, HMAC, trusted domains |
| Vzhled: téma, font, density | custom CSS injection |
| Paměť: LTM on/off, threshold | eviction strategy, hard token caps |
| Systém: jazyk, časová zóna, měna | worker threads, DB vacuum, log retention |
| — | **celá Security sekce** a Feature flags |

### B1.2 DTO

```
SettingKey = {
  key:        string,                       // stabilní, ne lokalizovaný
  section:    "llm"|"notifications"|"appearance"|"memory"|"system",
  label:      string,
  type:       "bool"|"int"|"float"|"enum"|"string",
  value:      boolean|number|string,
  default:    boolean|number|string,
  editable:   boolean,                      // false = viditelné, mění se z desktopu
  version:    string,                       // otisk hodnoty; zápis ho vrací (A4)
  constraint: { min?, max?, step?, options?: string[], maxLength? } | null,
  fetchedAt:  ISO-8601                      // A7
}
```

`version` je v DTO **povinná**, protože ji zápis vyžaduje — v revizi 1 chyběla.

### B1.3 Zápis

Po **jednotlivých klíčích**, ne dávkou: dávka by při konfliktu přepsala i to, co
uživatel neviděl. Nese `operationId` + `fingerprint` (A4) a čtenou `version`;
při neshodě `409 state_conflict` a klient **ukáže serverovou hodnotu**, nepřepíše
ji potichu.

| | |
|---|---|
| Routy | `GET /m1/settings`, `PATCH /m1/settings/:key` |
| Stránkování | ne — seznam je uzavřený; kdyby přerostl, platí A3 |
| Offline | **čitelné z cache** s ukazatelem stáří; zápis offline nejde a řekne se to předem |
| Obrazovky | `MS-10`, `MS-11` |
| Není v doméně | pravý sloupec `R-5`; `MD-15` lokální preference (jsou zařízení, ne účtu) |

## B2. Projekty (Fáze 3B, `MR-14`)

### B2.1 Oprava faktu z revize 1

Revize 1 tvrdila, že backend projektová data nemá. **To je nepravda.**
`src/routes/projects.js` má `GET /api/projects` s lifecycle a vazbou konverzací;
`UI-REVIEW` §4 to potvrzuje. Kontrakt proto **není zadání nové domény, ale
adaptér nad existující**.

### B2.2 Mapování stavů — a proč je potřeba

Jádro zná **`active | archived | deleted`**. Revize 1 zavedla
`active | preparing | done | archived` bez mapování, což by znamenalo vymýšlet
stavy, které zdroj nemá.

| `/m1` | jádro | pozn. |
|---|---|---|
| `active` | `active` | |
| `archived` | `archived` | |
| — | `deleted` | **na `/m1` se nevydává vůbec** |

`preparing` a `done` **v v2 nejsou.** Kdyby je produkt chtěl, musí nejdřív
vzniknout v jádře; UI je nesmí odvozovat.

### B2.3 DTO

```
Project = {
  id:                string,
  name:              string,
  state:             "active"|"archived",
  createdAt:         ISO-8601,
  updatedAt:         ISO-8601,
  conversationCount: integer|null,   // null = jádro ho nedodalo, ne nula
  version:           string,
  fetchedAt:         ISO-8601
}
```

`conversationCount` je **nullable schválně**: `null` znamená „neumím spočítat",
což je jiné tvrzení než `0`. Původ počtu musí WP doložit; dokud není, vydává se
`null`.

**Pole, která v2 vědomě NEZAVÁDÍ:** `Popis`, `Cíl`, `Vlastník`, záložky
`Soubory`, `Úkoly`, `Nastavení` projektu, `2 běžící úkoly`. Nemají zdroj a
`UI-REVIEW` §3.1 je jmenuje.

### B2.4 Vazba na konverzace

Konverzace dostává volitelné `projectId`; „mimo projekt" je `null`, ne zvláštní
projekt — ten by šel smazat. Seznam konverzací umí `?projectId=`; filtr je
součástí `stream` v kurzoru (A3), takže kurzor z jiného filtru se odmítne.

### B2.5 Rozsah

| | |
|---|---|
| Routy | `GET /m1/projects`, `GET /m1/projects/:id` |
| Scope | `read:projects` — **`write:projects` v2 není** |
| Stránkování | A3, řazení `updatedAt DESC` |
| Offline | **čitelné z cache** s ukazatelem stáří; `conversationCount` se offline nezobrazuje |
| Obrazovka | `MS-12` — **nestaví se do WP a Gate 1** |

Zakládání a editace projektu z telefonu je samostatné rozhodnutí, ne součást v2.

## B3. Paměť (Fáze 4, `MR-17`, `MR-18`)

### B3.1 Oprava rozsahu z revize 1

`PLAN.md` §5, Fáze 4: „LTM a task memory read-only, **ruční poznámka, bez mazání**".
`DATA-MODEL.md` klade mazání paměti mimo 1.0. Revize 1 přesto zaváděla
`DELETE`. **Odstraněno.**

Operátor 2026-08-11: paměť **není vlastní sekce**, je karta pod `Nastavení`.

### B3.2 DTO — `manual` je provenance, ne `kind`

Revize 1 měla uzavřený `kind: ltm | task` a zároveň povolovala `kind: manual`.
Rozporné. Opraveno oddělením:

```
MemoryRecord = {
  id:         string,
  kind:       "ltm"|"task",          // co to je
  origin:     "conversation"|"run"|"manual",  // odkud se to vzalo
  text:       string,
  createdAt:  ISO-8601,
  lastUsedAt: ISO-8601|null,
  strength:   number,                // počítá server; klient NIKDY nedopočítává
  version:    string,
  fetchedAt:  ISO-8601
}
```

`origin` je to, co uživateli vysvětluje, **proč** si to systém pamatuje.

### B3.3 Co smí telefon

Jen **přidat ruční poznámku** (`origin: manual`), pod `write:memory`, s `A4`.

**Mazání ani editace v v2 nejsou.** Ladit paměť z telefonu je přesně ta třída
akcí, kterou `R-5` drží na desktopu. Rozšíření rozsahu vyžaduje nové výslovné
rozhodnutí, autorizační model a negativní testy.

| | |
|---|---|
| Routy | `GET /m1/memory`, `POST /m1/memory` |
| Stránkování | A3, řazení `lastUsedAt DESC NULLS LAST` |
| Offline | **čitelné z cache**; zápis offline nejde |
| Obrazovka | karta pod `Nastavení` |

## B4. Workeři (Fáze 5, `MR-19`, `MR-20`)

### B4.1 DTO — oddělená konfigurace, běh a výsledek

Revize 1 měla `enabled` i `state: disabled` současně a `failed` se překrývalo
s `lastRunOutcome`. Rozděleno:

```
Worker = {
  id:      string,
  name:    string,
  kind:    string,
  config:  { enabled: boolean },                     // co je nastavené
  run:     { state: "idle"|"running", startedAt } ,  // co se děje teď
  last:    { outcome: "ok"|"failed"|"cancelled"|null, at, runId } | null,
  version: string,
  fetchedAt: ISO-8601
}
```

Vypnutý worker je `config.enabled: false`, ne `state: disabled`. Rozbitý worker
je `last.outcome: failed`, ne `state: failed`.

### B4.2 Co smí telefon

**Zapnout a vypnout** (`PATCH`, `write:workers`, s `A4`).

### B4.3 Dry-run — dnešní implementace `MR-20` NENÍ

Review to doložilo kódem: `AgentRunner.dryRun(config)` validuje **definici
dodanou v requestu**. Nenačte workera podle `:id`, neověří jeho serverovou verzi
a nesimuluje zdroje, triggery ani akce.

**Rozhodnutí tohoto návrhu:** `MR-20` vyžaduje **skutečný dry-run nad serverovou
verzí workera**. To dnes neexistuje, takže doména je v tomto bodě — stejně jako
doména 5 — **zadáním pro backend**, ne popisem hotového stavu:

1. běh se pouští **nad workerem podle `:id`**, ne nad tělem requestu;
2. veškeré efekty jdou do **izolovaného effect sinku**; ostrý zápis je nedosažitelný;
3. běh je v **žurnálu operací** (`A4`), takže po restartu jde dohledat;
4. nejasný konec je `UNKNOWN`, ne selhání;
5. výsledek je **typovaný**, ne volný text.

Dokud to nevznikne, hlásí se doména `unavailable` (A1). **Přejmenovat dnešní
validaci na dry-run a vydávat ji za `MR-20` je zakázané.**

**Ostrý běh z telefonu v2 není.**

| | |
|---|---|
| Routy | `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run` |
| Offline | seznam **čitelný z cache**; `run.state` **nikdy z cache** — běží/neběží je autorita |

## B5. Průběh běhu (`MR-07`)

### B5.1 Proč je jiná

Otevřená je **sama existence pravdivého zdroje**. `PLAN.md` §5.1: blokující
`/m1/chat` ani žurnál operací **nejsou agent log**. `/m1` nemá WS ani SSE.

### B5.2 Co musí vzniknout na serveru

1. **Trvanlivý** proud — událost přežije odpojení;
2. **`seq` monotónní a unikátní** (`F-015` ukazuje, co dělá `MAX(seq)+1` bez garancie);
3. **uzavřený slovník typů**;
4. **ukončený** — běh má koncovou událost; „přestalo přicházet" není konec;
5. **známá retention** — jak dlouho události žijí.

### B5.3 DTO

```
RunEvent = {
  runId, seq, at,
  type:  "started"|"step"|"tool"|"warning"|"error"|"finished",
  level: "debug"|"info"|"warn"|"error",
  text:  string,                  // redigovaný, viz B5.5
  data:  RunEventData | null      // typovaný podle `type`, NE volné meta
}
```

`data` je typovaný union podle `type` — revize 1 měla volné `meta`, což je
nezkontrolovatelné.

### B5.4 Čtení a obnova — rozlišení konce, ticha a ztraceného okna

`GET /m1/runs/:id/events?afterSeq=` vrací:

```
{
  events: [...],
  nextAfterSeq,        // odkud pokračovat; `afterSeq` je EXKLUZIVNÍ
  oldestAvailableSeq,  // spodní hranice retention — mezera se pozná dřív, než na ni klient narazí
  caughtUp,            // true = dostal jsi vše, co teď existuje
  runTerminal,         // true = běh skončil, další události nebudou
  waitTimedOut         // true = server čekal `waitMs` a nic nepřišlo
}
```

`GET` přijímá `?afterSeq=&limit=&waitMs=`. `afterSeq` je **exkluzivní**; první
dotaz posílá `afterSeq=0`, což znamená od nejstarší dostupné události. `waitMs`
je horní mez long-pollu, ořezaná serverem; `0` znamená neblokovat.

```
```

Bez těchto čtyř znamená prázdná odpověď zároveň „zatím nic", „běh skončil"
i „staré události jsou pryč". Nyní:

| Situace | Odpověď |
|---|---|
| Zatím nic nového | `events: []`, `caughtUp: true`, `runTerminal: false` |
| Běh skončil | `runTerminal: true` + koncová událost |
| Server čekal a nic nepřišlo | `waitTimedOut: true` |
| `afterSeq` je pod retention hranicí | `410` **`event_window_gone`** s **`oldestAvailableSeq`** — klient pokračuje odtud a **přizná mezeru**; posílat ho na začátek, který retention smazala, by byla nepravda |

`RunState`: `running` | `finished` | `failed` | **`interrupted`** |
**`cancelled`** | **`timed_out`**. Poslední tři revize 1 neměla, takže přerušený
běh vypadal jako neúspěšný.

### B5.4a Vztah k `CoreEvent`

`ROADMAP` žádá, aby `RemoteCorePort` vznikal nad připnutým `CoreEvent`. Dnešní
`contracts/m1/index.js` vede `CoreEvent` jako `PROVISIONAL_V1` a je konverzačně
orientovaný — běhy jím neprocházejí.

**Tenhle kontrakt proto nezavádí druhý konektor.** `RunEvent` je **projekce nad
`CoreEvent`**, ne paralelní proud; WP musí doložit mapování `CoreEvent` →
`RunEvent` a to, že `CoreEvent` byl kvůli tomu připnut. Kdyby projekce nešla, je
to rozhodnutí o novém konektoru a patří do samostatného kola, ne sem.

### B5.5 Redakce

`text` i `data` procházejí **redakcí na serveru**. Obecné „projde redakcí" ale
není testovatelný kontrakt, takže redakce je **allow-list, ne blacklist**:

- vydává se **jen** to, co je v allow-listu pro daný `type`;
- cokoli mimo něj se nahradí `"[redigováno]"`, ne vynechá — vynechání by mezeru
  skrylo;
- allow-list je součástí WP a testuje se **pozitivně i negativně** (§10, řádek 12).

Agent log je jinak boční kanál kolem scopů.

### B5.6 Zakázané

**Žádné procento hotovo** (`UI-REVIEW` §3.3, `D-UI-4`) — potřebuje známý celek,
který neexistuje. Na jeho místě `RunSilence`: uplynulý čas a nic dalšího.

| | |
|---|---|
| Routy | `GET /m1/runs`, `GET /m1/runs/:id`, `GET /m1/runs/:id/events` |
| Offline | **nečitelné** — průběh je o tom, co se děje teď |
| Obrazovka | `MS-15` — **nestaví se** |

## B6. Hledání (`MR-10`)

### B6.1 Rozhodnuté

`D-S3`: lokální hledání nad načteným oknem požadavek **nesplňuje** — kdo nenajde
zprávu, nesmí z toho usoudit, že neexistuje. Hledání je serverové, nebo žádné.

### B6.2 Rozsah v odpovědi

```
{
  query, scope, snapshot,
  truncated,          // našel jsem víc, než vracím — JINÝ stav než `end`
  results: [...],
  nextCursor, end
}
```

`scope`: `conversations` | `projects` | `memory`. Server **nikdy nehledá tam, kam
uživatel nemá scope**, a odpověď to přiznává.

### B6.3 `POST`, ne `GET` — oprava nálezu 5

Dotaz je potenciálně `S2` a v URL by skončil v historii prohlížeče a v logách;
`gateway-policy.js` na to sám v komentáři upozorňuje.

**`POST /m1/search` s tělem, sémanticky read-only.** Nemá `operationId` (A4),
protože nic nemění; je to výjimka z „POST = mutace" a je zapsaná tady, aby
nebyla objevena později jako nesrovnalost.

Dotaz má **maximální délku** a překročení je `bad_request`, ne tiché ořezání.
Kurzor je vázaný na dotaz, filtry, řazení, `principal`/`deviceId` a `snapshot`
(A3) — cizí ani starý kurzor stránku nevydá.

### B6.4 Klasifikace výsledku

Výsledek nese **jen to, co uživatel smí vidět bez dalšího dotazu**: identifikátor,
titulek, kontextový úryvek, odkaz. **Nikdy celý obsah** — jinak hledání obchází
scope na detail. Úryvek prochází stejnou redakcí jako `B5.5`.

| | |
|---|---|
| Routa | `POST /m1/search` |
| Scope | `read:search` **plus** čtecí scope každé prohledávané domény |
| Offline | **otevřené rozhodnutí** — viz §11 bod 6 |
| Obrazovka | `MS-09` — **nestaví se** |

---

## 9. Routy, které kontrakt požaduje

Vznik žádné z nich tenhle dokument neautorizuje (A8).

| Doména | Routy |
|---|---|
| Nastavení | `GET /m1/settings`, `PATCH /m1/settings/:key` |
| Projekty | `GET /m1/projects`, `GET /m1/projects/:id` |
| Paměť | `GET /m1/memory`, `POST /m1/memory` |
| Workeři | `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run` |
| Průběh | `GET /m1/runs`, `GET /m1/runs/:id`, `GET /m1/runs/:id/events` |
| Hledání | `POST /m1/search` |

**13 + 13 = 26 rout** (o jednu méně než revize 1 — `DELETE /m1/memory/:id` je
pryč). Zdvojnásobení povrchu je samo o sobě věc k posouzení, ne detail.

---

## 10. Matice kontraktních testů — **neúplná**

`ROADMAP` žádá **pozitivní contract test i negativní boundary test**. Níže je
zatím jen negativní polovina. **Pozitivní fixtures pro každou z 13 rout, normativní
schémata a testovací ID chybí** (§0.2) — bez nich to není refreeze gate, ale
checklist. Řádky 16–19 doplňuje revize 3 podle nálezů review.

| # | Scénář | Očekávané |
|---|---|---|
| 1 | Doménová routa bez doménového scope | `403 scope_required` |
| 2 | Cizí `deviceId` v cestě k operaci nebo záznamu | `404`, ne cizí data (IDOR) |
| 3 | `admin` scope na doménové routě | odmítnuto — bypass neexistuje |
| 4 | Stejný `operationId`, stejný otisk | **původní** výsledek, žádný druhý efekt |
| 5 | Stejný `operationId`, jiný otisk | `409 operation_conflict` |
| 6 | Restart mezi zápisem a odpovědí | stav `UNKNOWN`, dohledatelný přes `/m1/operations/:id` |
| 7 | Kurzor z jiné domény / filtru / řazení | `cursor_unknown`, `restart: true` |
| 8 | Změna podkladu mezi stránkami | `snapshot_gone`, ne tichý přeskok |
| 9 | `afterSeq` pod retention | `410 event_window_gone` |
| 10 | Běh přerušen | `interrupted`, ne `failed` |
| 11 | Hledání mimo udělený scope | doména se neprohledá a odpověď to přizná |
| 12 | Tajemství v `text` běhu nebo v úryvku | redigováno |
| 13 | Dry-run | **nulový** efekt v ostrých datech, záznam v žurnálu |
| 14 | Doména bez providera | `unavailable`, ne prázdný úspěch |
| 15 | Desktop-only klíč `R-5` přes `/m1` | nedostupný ke čtení i zápisu |
| 16 | Pád **po efektu, před zápisem výsledku** | lookup `UNKNOWN` + reconciliation dorovná (`A4.5`) |
| 17 | Pád **po `CONFIRMED`, před odpovědí** | lookup vrací **`CONFIRMED`**, ne `UNKNOWN` |
| 18 | Podvržený nebo cizí `c2` kurzor | `cursor_unknown`; `c1` na v2 routě → `cursor_version_mismatch` |
| 19 | Klient nabídne jen neznámou wire verzi | `426` se `supportedProtocols`, **žádný tichý downgrade** |

---

## 11. Otevřené body

Uzavřeno v revizi 3 podle review: identita operace, chybová algebra, cache
lifecycle, snapshot a negotiation. Zbývá:

1. **TTL cache (`D-M5`).** Kontrakt ho vědomě neurčuje (`A7.2`). `DATA-MODEL` má
   per-doménové návrhy, ale jsou to návrhy. **Musí padnout rozhodnutí před
   refreeze** — jinak je „čitelné z cache" věta bez obsahu.
2. **`MR-07` a `MR-20`: kontrakt, nebo `REQUIREMENTS_ONLY`?** Review odpovědělo,
   že chybějící provider kontraktu nebrání a capability zůstane `unavailable`.
   Tenhle návrh to tak drží. Pokud má být opak — tedy že jde jen o zadání pro
   backend — musí se obě domény označit `REQUIREMENTS_ONLY` a **`DR-008` ani
   Fáze 1 se neuzavírají**.
3. **Retention událostí** (`B5.2` bod 5). Určí provoz, ne tento dokument; ale
   `oldestAvailableSeq` na ni odkazuje, takže hodnota musí existovat před
   refreeze.
4. **Projekce `CoreEvent` → `RunEvent`** (`B5.4a`). Jestli nejde, je to nový
   konektor a patří do samostatného kola.
5. **Migrace `c1` → `c2`.** Sémantika koexistence je v `A3.4` a je součástí
   refreeze; implementace patří do WP.
6. **Offline fallback hledání.** Revize 2 přeložila „hledání nad cache
   `MR-10` nesplňuje" na „hledání v cache je zakázané". To není totéž a review
   to označilo za nepřesnost: `SCREENS` u `MS-09` zřetelně označený omezený
   fallback nezakazuje. **Rozhodněte:** buď fallback zůstává a kontrakt ho musí
   popsat (rozsah, označení, zákaz vydávat se za úplný výsledek), nebo se mění
   obrazovkový kontrakt `MS-09`. Do rozhodnutí je řádek `Offline` v `B6`
   otevřený.

## 12. Pořadí po schválení

Podle `PLAN.md` §8 podmínky 2 a §5.3, v tomto pořadí:

1. `APPROVED` — schválený návrh. **Neautorizuje nic.**
2. **Gate 1 evidence pro `C3-002` a `C3-023`.**
3. `REFROZEN` v2.
4. Per fázi: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve pak routa, obrazovka, testy.

Zamýšlené pořadí fází: **2 nastavení → 3B projekty → 4 paměť → 5 workeři.**
Domény 5 a 6 v něm **nefigurují** — rozhodnutí je zařadilo do kola, ne do fronty.
