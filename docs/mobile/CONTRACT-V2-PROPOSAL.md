# Kontrakt v2 pro šest domén — NÁVRH, revize 2

**Stav:** `NÁVRH` · **Předchozí review:** `CHANGES_REQUIRED` (f8d26e19)
**Datum revize:** 2026-08-11 · **Autor:** implementační session
**Autorizace:** `DR-008` — autorizuje **návrh, review a refreeze**, nic víc
**Určeno:** k novému nezávislému review; revidovat nesmí autor

> **Struktura podle doporučení review.** Jeden dokument, jak `DR-008` žádá, ale
> uvnitř rozdělený na **společné wire jádro (část A)** a **šest doménových
> příloh (část B)**. Domény bez providera zůstávají `unavailable`, dokud nemají
> Gate 1 a WP.

---

## 0. Co se změnilo proti revizi 1

Deset nálezů, všechny zapracované. Tři z nich byly věcné chyby, ne nepřesnosti:

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

1. **Návrh** (tento dokument) → nezávislé review → `REVIEWED`.
   `REVIEWED` **není** `REFROZEN` a neautorizuje nic.
2. **Gate 1 evidence pro `C3-002` a `C3-023`.** Bez obou se nerefreezuje.
3. **`REFROZEN` v2.**
4. Teprve pak **per fázi**: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve v tom WP vzniká routa, obrazovka a testy.

---

# ČÁST A — Společné wire jádro

Dědí ho všech šest domén. Doména nesmí žádné z těchto pravidel obejít ani
„upřesnit" po svém.

## A1. Verzování a capability negotiation

Revize 1 tvrdila „obálka beze změny" a přitom si říkala v2. To je rozpor:
runtime hlásí `m1.2026-07-30` a `capabilities` znají jen dosavadní domény.

**Dvě verze, oddělené:**

| | Co to je | Kdo se podle toho řídí |
|---|---|---|
| `protocolVersion` | **wire protokol** — tvar obálky, chyb, kurzoru | odmítnutí nekompatibilního klienta (`426 protocol_mismatch`) |
| `contractVersion` | **klientský kontrakt** — které domény a v jakém tvaru | co klient smí vykreslit |

`GET /m1/capabilities` nese nově:

```
{
  protocolVersion: "m1.<datum>",
  contractVersion: "v2",
  supportedProtocols: ["m1.2026-07-30", "m1.<v2>"],
  domains: {
    settings:  { status, scopes, since },
    projects:  { status, scopes, since },
    memory:    { status, scopes, since },
    workers:   { status, scopes, since },
    runs:      { status, scopes, since },
    search:    { status, scopes, since }
  }
}
```

`status` z uzavřeného seznamu:

| Hodnota | Význam |
|---|---|
| `available` | doména má providera, Gate 1 i WP; smí se vykreslit |
| `unavailable` | kontrakt ji zná, **provider neexistuje** — klient ji ukáže uzamčenou |
| `forbidden` | provider je, ale tohle zařízení na ni nemá scope |

**Neimplementovaná doména se hlásí `unavailable`, nikdy prázdným úspěchem.**
Prázdné pole znamená „nic tam není", a to je jiné tvrzení.

Klient, který dostane neznámou doménu, ji **ignoruje a zapíše do diagnostiky** —
§3.4 `UI-DESIGN` to tak už řeší pro scopes.

## A2. Obálka

Beze změny proti v1 (`ok`, `protocolVersion`, `scopes`, `principalId`,
`serverTime`, `data`), doplněná o `contractVersion`. Odpověď vždy hlásí scopes,
pod kterými požadavek **skutečně** proběhl.

## A3. Stránkování — keyset, ne offset

Revize 1 přebírala dnešní kurzor. Review ukázalo dvě vady, obě reálné:

1. je to **offset**, takže při řazení podle měnícího se `updatedAt` mezi
   stránkami položky přeskočí nebo zopakuje;
2. je to **veřejný JSON s nezabezpečeným kontrolním součtem** — klient si ho umí
   sestavit, takže slib „serverem vydaný" neplatí.

**v2 kurzor:**

```
cursor = HMAC-podepsaný payload {
  stream,          // doména + filtry, na které je vázaný
  sortKey,         // hodnota řadicího klíče poslední vydané položky
  id,              // rozřešení shody v sortKey
  snapshot,        // revize/čas, ke kterému stránka patří
  direction,       // forward | backward
  issuedAt
}
```

- **keyset**, ne offset: pokračuje se `WHERE (sortKey, id) < (…)`, takže vložení
  ani změna pořadí stránku neposune;
- **podepsaný** serverovým klíčem — klient ho nesestaví, čímž slib platí;
- **vázaný na `stream`**: kurzor z jiné domény, jiného filtru nebo jiného řazení
  se odmítne `cursor_unknown` s `restart: true`;
- **`snapshot`** umožní poznat, že se podklad mezi stránkami změnil natolik, že
  pokračování by lhalo → `cursor_unknown`, `reason: snapshot_gone`.

`hasMore`, `end`, `nextCursor` zůstávají v obálce; `end` je **potvrzený konec**,
ne odvozený z počtu (§8.6). `limit` se ořezává, neodmítá.

Kde obrazovka začíná na konci streamu, používá se `anchor` s kurzorem mířícím
zpět — mechanismus je hotový a ověřený (`MR-05`).

> **Dopad na v1:** dnešní kurzor v `MR-05` je offsetový a **funguje**, protože
> stream zpráv je append-only a vzestupný. Migrace na keyset je součástí WP,
> který v2 implementuje, ne tohoto dokumentu.

## A4. Mutace — jednotný `MutationOutcome`

`DATA-MODEL.md` `MD-19` (`D-S1`) je závazný: **každá logická mutace dostává vlastní
`operationId`**, stejný klíč se stejným otiskem vrací původní výsledek, a
nejasný timeout přechází do `UNKNOWN`. Revize 1 to měla jen u dry-runu — to byla
díra, ne zkratka.

**Platí pro všechny mutace v2 bez výjimky:** `PATCH /m1/settings/:key`,
`POST /m1/memory`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run`.

### Požadavek

Každá mutace nese v těle:

```
{ operationId, fingerprint, payload }
```

`operationId` mintuje **klient** (`MD-19`) a drží ho přes všechny retry téhož
vědomého pokusu. `fingerprint` je kanonický otisk `payload` — server ho počítá
znovu a **neporovnává těla, ale otisky**.

### Odpověď

```
MutationOutcome<T> = {
  operationId,
  deviceId,
  operationType,       // uzavřený seznam
  state,               // CONFIRMED | REJECTED | PENDING | UNKNOWN
  fingerprint,
  result,              // T, jen u CONFIRMED
  reason,              // jen u REJECTED / UNKNOWN, z uzavřeného slovníku
  at
}
```

### Pravidla

| Situace | Chování |
|---|---|
| Stejný `operationId`, **stejný** `fingerprint` | vrátí **původní výsledek**, neprovede podruhé |
| Stejný `operationId`, **jiný** `fingerprint` | `409 operation_conflict` — je to jiný záměr pod stejným klíčem |
| Klient nedostal odpověď | stav je `UNKNOWN`, **ne neúspěch**; řeší se `GET /m1/operations/:id` |
| Operace vázaná na zařízení | dvojice `(deviceId, operationId)`; cizí zařízení ji nedohledá |

Mutace je zapsaná v žurnálu operací dřív, než se projeví — jinak by po restartu
existoval efekt bez záznamu.

## A5. Chyby

Uzavřený slovník. Doména **nesmí zavést nový kód**, aniž ho tenhle dokument
vyjmenuje.

| Kód | Kdy |
|---|---|
| `bad_request` + `reason` | parametr, kterému server nerozumí — **nikdy se tiše neignoruje** |
| `cursor_unknown` + `reason` + `restart` | kurzor, který server nevydal, z jiného streamu, nebo `snapshot_gone` |
| `operation_conflict` | stejný klíč, jiný otisk (A4) |
| `state_conflict` | zápis proti verzi, která už neplatí |
| `scope_required` | chybí doménový scope |
| `domain_unavailable` | doména je v kontraktu, provider není (A1) |

## A6. Scopes

Čtení a zápis zvlášť. Čtení bez zápisu je platný stav a obrazovka v něm musí být
použitelná, ne zamčená.

| Doména | Čtení | Zápis | Pozn. |
|---|---|---|---|
| Nastavení | `read:settings` | `write:settings` | |
| Projekty | `read:projects` | — | **zápis v2 není** (B2.5) |
| Paměť | `read:memory` | `write:memory` | jen přidání poznámky (B3.3) |
| Workeři | `read:workers` | `write:workers` | bez ostrého běhu (B4.3) |
| Průběh | `read:runs` | — | |
| Hledání | `read:search` | — | **plus** čtecí scope každé prohledávané domény |

`read:projects` už pairing vydává. Ostatní se do `PAIRABLE_SCOPES` přidají až
s příslušným WP. **Žádný nesmí být dosažitelný přes `admin`** — `FORBIDDEN_SCOPES`
platí beze změny.

## A7. Cache, klasifikace a úklid

`I-10` platí: cache je odvozená a zahoditelná. **v2 nezavádí čtvrtou výjimku**
k dnešním třem (`MD-14`, `MD-15`, `MD-19`).

`DATA-MODEL.md` `MD-05`/`I-10` vyžaduje u každého cachovaného záznamu `fetchedAt` a
verzi/otisk. Proto pro každou cachovanou doménu platí:

| | |
|---|---|
| Klíč | `deviceId` + doména + filtr — **partition po zařízení**; nové spárování cizí oddíl nevidí |
| Metadata | `fetchedAt` a `version` u **každého** záznamu, ne u kolekce |
| Stáří | `FRESH` < 60 s · `STALE` < 15 min · `EXPIRED` dál |
| Co smí `STALE` | zobrazit se **s ukazatelem stáří**; nesmí být podkladem mutace |
| Co smí `EXPIRED` | zobrazit se jen s výslovným „stará data"; nikdy jako potvrzená odpověď |
| Úklid | při revokaci, odhlášení a změně `deviceId` se oddíl **maže celý** |

Každá doména má v příloze řádek `Offline` s jednou ze tří hodnot: **čitelné
z cache**, **nečitelné**, **nikdy z cache**.

## A8. Routy

Kontrakt routy **jmenuje**, jejich vznik neautorizuje. 13-route allow-list platí
až do WP, který routu implementuje.

---

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
  nextAfterSeq,      // odkud pokračovat
  caughtUp,          // true = dostal jsi vše, co teď existuje
  runTerminal,       // true = běh skončil, další události nebudou
  waitTimedOut       // true = server čekal a nic nepřišlo
}
```

Bez těchto čtyř znamená prázdná odpověď zároveň „zatím nic", „běh skončil"
i „staré události jsou pryč". Nyní:

| Situace | Odpověď |
|---|---|
| Zatím nic nového | `events: []`, `caughtUp: true`, `runTerminal: false` |
| Běh skončil | `runTerminal: true` + koncová událost |
| Server čekal a nic nepřišlo | `waitTimedOut: true` |
| `afterSeq` je pod retention hranicí | `410` **`event_window_gone`** — klient musí načíst od začátku, nesmí předstírat spojitost |

`RunState`: `running` | `finished` | `failed` | **`interrupted`** |
**`cancelled`** | **`timed_out`**. Poslední tři revize 1 neměla, takže přerušený
běh vypadal jako neúspěšný.

### B5.5 Redakce

`text` i `data` procházejí **redakcí na serveru**: tajemství, tokeny a obsah,
na který zařízení nemá scope, se nevydávají. Agent log je jinak boční kanál
kolem scopů.

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
| Offline | **nečitelné** — hledání v cache je past z `B6.1` |
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

## 10. Matice kontraktních testů

Review ji vyžaduje jako podmínku refreeze. Každý řádek je **negativní** scénář —
tvrdí, co se stát nesmí.

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

---

## 11. Otevřené body — pro revidujícího

Uzavřeno podle akčního plánu review: **bez mazání paměti, bez zápisu projektů,
bez ostrého běhu workera, `read:search` samostatný.** Zbývá:

1. **`MR-07` a `MR-20` možná nejsou dodatelné jako kontrakt.** `B5.2` a `B4.3`
   popisují, co musí vzniknout na serveru. Jestli to nevznikne, schvalujete
   **zadání pro backend**, ne kontrakt — a Fáze 1 zůstává otevřená.
2. **26 rout.** Sloučení `events` pod `/m1/runs/:id` by ubralo routu za cenu
   horšího stránkování. Nedoporučuji, ale je to volba.
3. **`POST /m1/search` jako read-only** je vědomá výjimka z „POST = mutace"
   (`B6.3`). Alternativa `GET` s hashem dotazu je horší: hash v URL je pořád
   korelovatelný.
4. **Retention událostí** (`B5.2` bod 5) musí určit provoz, ne tento dokument.
5. **Migrace kurzoru v1 → keyset** (`A3`) patří do WP, který v2 implementuje.
   Dnešní offsetový kurzor v `MR-05` funguje a nechává se běžet.

---

## 12. Pořadí po schválení

Podle `PLAN.md` §8 podmínky 2 a §5.3, v tomto pořadí:

1. `REVIEWED` — schválený návrh. **Neautorizuje nic.**
2. **Gate 1 evidence pro `C3-002` a `C3-023`.**
3. `REFROZEN` v2.
4. Per fázi: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve pak routa, obrazovka, testy.

Zamýšlené pořadí fází: **2 nastavení → 3B projekty → 4 paměť → 5 workeři.**
Domény 5 a 6 v něm **nefigurují** — rozhodnutí je zařadilo do kola, ne do fronty.
