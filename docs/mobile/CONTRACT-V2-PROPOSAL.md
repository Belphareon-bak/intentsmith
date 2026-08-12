# Kontrakt v2 pro šest domén — NÁVRH, revize 4

**Stav:** `NÁVRH` · **Review revize 3:** `CHANGES_REQUIRED` (32b7c410)
**Datum revize:** 2026-08-12 · **Autor:** implementační session
**Autorizace:** `DR-008` — autorizuje **návrh, review a refreeze**, nic víc
**Určeno:** k novému nezávislému review; revidovat nesmí autor

> **Struktura podle doporučení review.** Jeden dokument, jak `DR-008` žádá, ale
> uvnitř rozdělený na **společné wire jádro (část A)**, **čtyři svědecké fixtures
> (část W)** a **šest doménových příloh (část B)**. Domény bez providera zůstávají
> `unavailable`, dokud nemají Gate 1 a WP.

---

## 0. Stav revize 4

Review revize 3 řeklo přesně to, co bylo potřeba slyšet: **část A není uzavřené
jádro, je to lepší kandidát**. Důvod byl strukturální — snapshot potřebuje
skutečné doménové revize, chybová algebra potřebuje validační schémata a crash
recovery potřebuje znát konkrétní efekt. Tyhle tři věci nejdou uzavřít odděleně
od části B.

Revize 4 na to odpovídá tím, že **přestává uzavírat jádro naslepo**. Přijímá
doporučené pořadí: mezi jádro a třináct schémat se vkládají **čtyři svědecké
fixtures** (část W), na kterých je každé pravidlo části A vidět v úplném tvaru.
Teprve až projdou review, rozkopírují se vzory na zbývajících devět rout.

### 0.1 Pět blokujících nálezů review revize 3

| # | Nález | Kde je oprava |
|---|---|---|
| 1 | `A3` snapshot přes `MAX()` nezachytí smazání, archivaci ani `NULL` vložení | `A3.2` — **`domainRevision`**, monotónní serverový čítač; `MAX()` zrušeno; `keyId` v payloadu; `expiresAt` odstraněno kvůli `MD-13` |
| 2 | `A5` není uzavřený slovník — chybí `unknownReason`, doménový `REJECTED`, validační důvody, approval/pairing kódy | `A5` — celý enum včetně `src/mobile/protocol.js`; `state_conflict` nese `actual` |
| 3 | `A4` crash kontrakt není splnitelný — klientský otisk, `PENDING` bez durable fáze, slib reconciliation proti `DATA-MODEL` | `A4.1` odmítá `fingerprint` jako neznámé pole; `A4.4` **durable fáze**; `A4.6` **třída trvanlivosti per mutace**; `A4.7` kanonizace |
| 4 | `A1`/`A2` nejsou wire dohoda — rozpor „preference vs. nejvyšší společná", nenegociovaná `contractVersion`, `A2` jen výčet | `A1.2` **první nabídnutá podporovaná**; `A1.3` druhá hlavička + matice; `A2` dva přesné uniony |
| 5 | `A7` sám přiznává neuzavřené `D-M5`; cache klíč bez `protocolVersion`; `serverIdentity` nedefinovaná | `A7.2` — **`D-M5` rozhodnuto review**, zapsáno; `A7.3` klíč a definice identity |

### 0.2 Rozhodnutí, která review revize 3 učinilo

Review je udělalo výslovně, aby revize 4 nemusela znovu čekat. Jsou zapracovaná
jako **normativní text**, ne jako otevřené body:

| Rozhodnutí | Kde |
|---|---|
| `D-M5` — per-doménové TTL přijato jako počáteční v2 politika | `A7.2` |
| Server smí doporučit **kratší** dobu, nikdy prodloužit hard limit | `A7.2` |
| Offline fallback hledání **zůstává** — označený, nikdy důkaz neexistence | `B6.5` |
| `MR-07`/`MR-20` jsou **budoucí normativní kontrakty**, ne `REQUIREMENTS_ONLY` | `B5`, `B4.3` |
| Retention událostí **není** ve wire kontraktu — jen pozorovatelná hranice | `B5.2`, `B5.4` |
| Samostatná `events` routa **zůstává** | `§9` |

### 0.3 Nevyjmenované rozpory, které review našlo mimo §0.2

Všechny opravené v tomto dokumentu:

| Rozpor | Oprava |
|---|---|
| `B1` tvrdilo, že klient posílá `fingerprint` | `B1.3` — klient posílá `operationId` + `version`; otisk počítá server |
| `B4` shazovalo **celou doménu** na `unavailable` | `B4.3` — `unavailable` je **jen `workers.dryRun`** |
| `B6` říkalo současně „serverové, nebo žádné" a „offline otevřené" | `B6.1` + `B6.5` — obojí sladěno, fallback nesplňuje `MR-10` a říká to |
| Test #6 tvrdil „každý restart ⇒ `UNKNOWN`", test #17 opak | `§10` — test #6 rozdělen podle bodů pádu `A4.5` |
| `afterSeq=0` mělo znamenat první dotaz **i** ležet pod retention | `B5.4` — první dotaz `afterSeq` **vynechá**; `410` vrací `resumeAfterSeq` |
| Pokračování hodnotou `oldestAvailableSeq` by přeskočilo nejstarší událost | `B5.4` — `resumeAfterSeq = oldestAvailableSeq − 1` |
| `§10` chtělo fixtures před refreeze, `§12` testy až po něm | `§10` rozděleno na `§10.1` **contract fixtures** (před) a `§10.2` **conformance testy** (po) |
| Dvakrát nadpis `0.1`, prázdný code fence, „bez těchto čtyř" | opraveno; fence odstraněn, věta v `B5.4` mluví o šesti polích |

### 0.4 Co v revizi 4 pořád vědomě CHYBÍ

Aby to nikdo nemusel hledat. **Devět z třinácti rout nemá normativní schéma.**
Část W dodává úplná schémata pro čtyři svědecké routy — `GET /m1/projects`,
`PATCH /m1/settings/:key`, `GET /m1/runs/:id/events`, `POST /m1/search`. Zbývá:

- `GET /m1/settings`, `GET /m1/projects/:id`, `GET /m1/memory`, `POST /m1/memory`,
  `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run`,
  `GET /m1/runs`, `GET /m1/runs/:id`;
- serverový redakční allow-list pro `RunEvent` (`B5.5`) — jeho **tvar** je v `W3`,
  jeho **obsah** patří do WP;
- mapování `INTEGER id` a `last_active` z jádra na wire je nyní v `B2.3`, ale
  týká se **jen projektů**; ostatní domény ho budou potřebovat také.

**Tenhle dokument o `APPROVED` nežádá.** Žádá o review části A a části W. Pokud
projdou, je zbytek mechanická práce podle vzoru; pokud neprojdou, ušetřilo se
devět schémat napsaných podle vadné abstrakce.

### 0.5 Pořadí — beze změny proti revizi 3

`PLAN.md` §8, podmínka 2 je autoritativní: *„Formální kontrakt `/m1` v2 se
nerefrozne, dokud backend nemá Gate 1 pro `C3-002` (chat sessions) a `C3-023`
(API/WS bridge)."*

1. **Návrh** → nezávislé review → **`APPROVED`**. `PLAN` §5 slovník `REVIEWED`
   nezná. `APPROVED` **není** `REFROZEN` a neautorizuje implementaci.
2. **Gate 1 evidence pro `C3-002` a `C3-023`.**
3. **`REFROZEN` v2.**
4. Per fázi: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve v tom WP vzniká routa, obrazovka a testy.

### 0.6 Erratum — nalezeno autorem po odevzdání, před review

Faktická kontrola citací (ne review; **autor revidovat nesmí**, řádek 6) našla
jednu nepřesnost, opravenou samostatným commitem nad `1927d1f2`:

| Kde | Bylo | Je |
|---|---|---|
| `B5.4a` | „`contracts/m1/index.js` vede `CoreEvent` jako `PROVISIONAL_V1`" | `PROVISIONAL_V1` je `M1_CONTRACT_STAGE` v `contracts/m1/shared.js` a je to stage **celého** kontraktu, ne značka jednoho typu |

Důsledek pro `B5.4a` je věcný, ne kosmetický: „připnout `CoreEvent`" nemůže být
lokální úkon nad jedním typem, protože dnešní kód stagování per kind nezná.

Ostatní citace na kód **prošly** — `approval-authority.js` („fingerprint is
computed, never accepted"), `handlers.js` (lookup vrací `CONFIRMED`),
`gateway-policy.js` (dotaz v URL končí v logách a historii),
`routes/projects.js` (`GET /api/projects`, `status active|archived|deleted`),
`agents/runner.js:167` (`dryRun(config)`), migrace `..._013_v78_archive_status`,
`gateway-instance.js` (per-proces `instance_id`), `MD-13` (kurzor bez TTL),
`DATA-MODEL` §4.4 (lookup není rekonciliace) a `projects` bez `updated_at`.

Nově **doložený**, dřív jen tvrzený, je konverzační charakter `CoreEvent`:
`validateCoreEvent` vyžaduje `conversationId` i `turnId` u každé události.

---

# ČÁST A — Společné wire jádro

Dědí ho všech šest domén. Doména nesmí žádné z těchto pravidel obejít ani
„upřesnit" po svém.

## A1. Verze a negotiation

### A1.1 Dvě nezávislé osy

| | Hodnota | Co určuje |
|---|---|---|
| Dnešní wire | `m1.2026-07-30` | dnešních 13 rout |
| Wire v2 | **`m1.2026-08-12`** | tvar obálky, chyb, kurzoru `c2`, `MutationOutcome` |
| Kontrakt v1 | `v1` | dnešní funkce |
| Kontrakt v2 | **`v2`** | které funkce existují a v jakém tvaru |

Wire a kontrakt se **mění nezávisle**: oprava tvaru chyby zvedne wire, přidání
domény zvedne kontrakt. Review právem namítlo, že nezávislá osa, která se
**nikde nenegociuje**, není osa — je to nevyslovený předpoklad. `A1.3` ji proto
negociuje.

### A1.2 Wire negotiation — první nabídnutá, ne nejvyšší společná

Revize 3 říkala současně „klient řadí podle preference" a „server vybere
nejvyšší společnou". Když klient pošle `m1.2026-07-30, m1.2026-08-12`, dávají
tyhle algoritmy jiný výsledek. **Platí výběr podle klientovy preference**, protože
jinak je pořadí v hlavičce dekorace.

**Syntaxe hlavičky** (ABNF, `RFC 5234`):

```
X-M1-Protocol = version *( OWS "," OWS version )
version       = "m1." 4DIGIT "-" 2DIGIT "-" 2DIGIT
OWS           = *( SP / HTAB )
```

- pořadí je **preference klienta, sestupně**;
- duplicita je `bad_request`, `reason: unknown_parameter`, `field: "X-M1-Protocol"`;
- víc než 8 položek je `bad_request`, `reason: value_out_of_range`;
- položka, kterou syntaxe nepřipouští, se **ignoruje** (ne odmítne) — jinak by
  nový klient nemohl nabídnout budoucí tvar verze.

**Výběr:** server projde seznam **zleva doprava** a vezme **první**, kterou umí.

1. Bez hlavičky se předpokládá `m1.2026-07-30`, aby dnešní klient nepřestal
   fungovat.
2. Žádná společná → `426 protocol_mismatch` s `supportedProtocols[]`.
   **Downgrade dělá klient vědomě**, server ho nikdy nevnutí mlčky.
3. **Každá** odpověď hlásí zvolenou verzi v `protocolVersion` — včetně
   `capabilities` a včetně chyb.

### A1.3 Contract negotiation — druhá nabídka a matice kompatibility

```
X-M1-Contract = contract *( OWS "," OWS contract )
contract      = "v" 1*DIGIT
```

Stejné pořadí (preference) a stejný první-shodný výběr. Server publikuje
**matici kompatibility**; v2 má tvar:

| `protocolVersion` | kompatibilní `contractVersion` |
|---|---|
| `m1.2026-07-30` | `v1` |
| `m1.2026-08-12` | `v2`, `v1` |

**Postup:** nejdřív se vybere wire verze (`A1.2`), pak **první klientem nabídnutá
kontraktní verze, která je s ní v matici kompatibilní**.

- Bez hlavičky `X-M1-Contract` se předpokládá **nejnižší** kontrakt kompatibilní
  se zvolenou wire verzí — dnešní klient tedy dostane `v1`, ne `v2`.
- Žádná kompatibilní dvojice → `426 protocol_mismatch` s `supportedProtocols[]`
  **i** `supportedContracts[]` a s polem `selectedProtocol` (co server vybral na
  první ose), aby klient viděl, na které ose dohoda selhala.

`m1.2026-08-12` + `v1` je platná dvojice schválně: dovoluje opravit tvar chyby
bez toho, aby klient musel současně přijmout šest nových domén.

### A1.4 Capability po funkcích, ne po doménách

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

## A2. Obálka — dva přesné uniony

Revize 3 měla jen výčet polí. Review chtělo uniony; tady jsou. **Exact schema:
každé pole je povinné a přítomné, pole navíc se nevydávají.**

```
SuccessEnvelope<T> = {
  ok:              true,
  protocolVersion: string,       // zvolená v A1.2
  contractVersion: string,       // zvolená v A1.3
  serverTime:      ISO-8601,     // UTC, milisekundy, se sufixem Z
  principalId:     string|null,  // viz A2.1
  scopes:          string[],     // viz A2.1
  data:            T
}

ErrorEnvelope = {
  ok:              false,
  protocolVersion: string,
  contractVersion: string,
  serverTime:      ISO-8601,
  principalId:     string|null,
  scopes:          string[],
  error: {
    code:      <A5 enum>,
    retryable: boolean,
    details:   object            // tvar určuje A5; nikdy chybějící, nejhůř {}
  }
}
```

### A2.1 `principalId` a `scopes`, když žádný principál není

Revize 3 tvrdila, že odpověď **vždy** nese scopes, pod kterými požadavek
skutečně proběhl. U `token_missing` žádný principál ani scopes neexistují.
Pravidlo:

- **autentizovaný požadavek** → `principalId` je `deviceId`, `scopes` jsou ty,
  pod kterými požadavek **skutečně** proběhl (ne ty udělené, ne ty požadované);
- **neautentizovaný** (`token_missing`, `token_invalid`, `token_expired`,
  `token_revoked`, `pairing_*`) → `principalId: null`, `scopes: []`.

Pole **nikdy nechybí**. `null` a `[]` jsou tvrzení („žádný principál"), zatímco
nepřítomnost je nejednoznačná mezi „žádný" a „server to nevyplnil".

### A2.2 Změna proti wire v1

Dnešní `mobileError()` vkládá `protocolVersion` **dovnitř** `error`. Wire v2 ho
má v obálce. To je právě ta změna tvaru chyby, kvůli které se zvedá wire verze —
a důvod, proč dvojice `m1.2026-08-12` + `v1` v matici existuje.

## A3. Stránkování — kurzor `c2`

Dnešní `c1` je offset s nezabezpečeným součtem: klient si ho sestaví a při řazení
podle měnícího se klíče přeskočí nebo zopakuje položku.

### A3.1 Tvar

```
c2 = "c2." + base64url(payload) + "." + base64url(HMAC-SHA256(payload, key(keyId)))
payload = {
  v: 2,
  keyId,         // který podpisový klíč, viz A3.4
  stream,        // doména + kanonizované filtry + řazení
  principalId, deviceId,
  snapshot,      // viz A3.2
  sortKey, id,   // poslední vydaná položka
  direction,     // forward | backward
  issuedAt       // diagnostika; NENÍ expirace, viz A3.4
}
```

`keyId` je v payloadu proto, že bez něj server nerozliší **kurzor podepsaný
odvolaným klíčem** od **kurzoru s vadným podpisem**. To jsou dvě různá sdělení:
první je `key_rotated` (klient smí okamžitě restartovat stránkování), druhé je
`malformed` (klient má podezřelý vstup a patří do diagnostiky). Bez `keyId` by
server musel zkoušet všechny klíče a stejně by nevěděl, který se čekal.

### A3.2 `snapshot` — monotónní `domainRevision`, ne `MAX()`

**Revize 3 to měla špatně a review to doložilo protipříkladem.** `MAX(updated_at)`
není revize množiny:

- projekty `A=10`, `B=9`, `snapshot=10`; `B` se smaže nebo archivuje;
  `MAX` zůstane `10`, přestože membership se změnila;
- u paměti vložení záznamu s `last_used_at = NULL` `MAX` nezmění vůbec;
- u `search` je „otisk dotazu + čas první stránky" konstanta requestu, ne revize
  prohledávaných dat — server neměl s čím porovnávat.

**Nová definice.** `domainRevision` je **monotónně rostoucí serverový čítač na
doménu**, zvyšovaný při **každém** `INSERT`/`UPDATE`/`DELETE`, který se dotkne
množiny viditelné přes `/m1` — včetně změny `status` na `archived` nebo
`deleted`, včetně vložení řádku s `NULL` řadicím klíčem.

```
snapshot = { "<domain>": <revision>, ... }   // vektor, ne skalár
```

| Stream | `snapshot` |
|---|---|
| `settings` | nestránkuje se |
| `projects` | `{ projects: rev }` |
| `memory` | `{ memory: rev }` |
| `workers` | `{ workers: rev }` |
| `runs` (seznam) | `{ runs: rev }` |
| `runs/:id/events` | nestránkuje se kurzorem — má `afterSeq`, viz `B5.4` |
| `search` | **vektor revizí všech prohledávaných domén** + `queryFingerprint` |

Server porovná `snapshot` z kurzoru s aktuálním. **Jakákoli nerovnost** →
`cursor_unknown`, `reason: snapshot_gone`, `restart: true`.

> **Je to schválně konzervativní.** Restart při jakékoli změně domény je levnější
> a **pravdivější** než děravé `MAX`. Kdyby se ukázalo, že to v provozu bolí, je
> správná odpověď jemnější klíč revize (per filtr, ne per doména) — ne návrat
> k heuristice, která smazání nevidí.

**Požadavek na backend.** Čítač dnes neexistuje. Musí vzniknout jako tabulka
`m1_domain_revision(domain TEXT PRIMARY KEY, revision INTEGER NOT NULL)`
inkrementovaná **ve stejné transakci** jako doménový zápis. Inkrement mimo
transakci je stejná chyba jako `MAX()`: čtenář by viděl novou revizi před novými
daty, nebo stará data pod starou revizí po zápisu.

### A3.3 Stabilita řazení

- **Tie-break je vždy `id`**: `ORDER BY sortKey DESC, id DESC`. Bez něj dvě
  položky se stejným časem nemají určené pořadí.
- **`NULL` řadí poslední** (`NULLS LAST`) ve všech streamech.
- **Membership se během chůze nemění**: filtr je součástí `stream` a je
  kanonizovaný, takže jiný filtr = jiný kurzor.
- Změna `sortKey` položky ji může přesunout přes už vydanou hranici. Protože
  `domainRevision` roste při **každé** změně, projeví se to jako `snapshot_gone`,
  ne jako tichý přeskok. `snapshot` je proto **povinný u každého stránkovaného
  streamu**, ne jen u těch s měnitelným klíčem.

### A3.4 Klíč, životnost, koexistence

- HMAC klíč je **serverový** a rotovatelný; každý má `keyId`. Kurzor s `keyId`,
  který server už nedrží → `cursor_unknown`, `reason: key_rotated`. Kurzor
  s platným `keyId` a vadným podpisem → `cursor_unknown`, `reason: malformed`.
- **`expiresAt` v kurzoru NENÍ.** Revize 3 ho měla povinné, což odporovalo
  `MD-13` v `DATA-MODEL.md`: *„TTL: žádné — kurzor nezastarává, jen se stává
  neplatným."* `MD-13` je autoritativní model a **nemění se**; místo toho se
  ruší expirace. Kurzor umírá na `snapshot_gone` nebo `key_rotated`, tedy na
  **událost**, ne na hodiny. Rotace klíče je tím pádem i horní mez jeho života.
- `issuedAt` zůstává jako **diagnostické** pole. Server na něj nesmí navěsit
  žádné rozhodnutí — kdyby chtěl, je to změna `MD-13`, ne detail implementace.
- Kurzor je vázaný na `principalId` **i** `deviceId` — cizí zařízení jím
  stránku nevydá.
- **`c1` a `c2` se nikdy nepřekládají.** `c1` platí jen na routách wire v1,
  `c2` jen na v2. Záměna → `cursor_unknown`, `reason: cursor_version_mismatch`.
  Prefix `c2.` v `A3.1` je tam proto, aby se ta záměna poznala **před** ověřením
  podpisu.

> **Migrace.** Implementace `c2` patří do WP. **Sémantika koexistence je ale
> součástí refreeze** — jinak by první WP musel rozhodovat, co se stane se
> starým kurzorem. Dnešní `/m1/conversations` používá `updated_at DESC` s
> offsetem, takže na v2 přechází na `c2` **povinně**, ne volitelně; historie
> zpráv je append-only a mohla by zůstat, ale nezůstane, aby nevznikly dva
> režimy.

## A4. Mutace

### A4.1 Identita operace — otisk počítá server, klientský se odmítá

Dnešní hranice to už dělá správně: `operation-journal.js` počítá otisk serverově
a `approval-authority.js` říká výslovně, že se otisk **počítá, nepřijímá od
volajícího**.

**Tělo mutace má exact schema:**

```
MutationRequest = {
  operationId:     string,   // povinné, viz A4.2
  payload:         object,   // povinné, tvar určuje doména
  expectedVersion: string?   // volitelné
}
```

**Jakékoli další pole na nejvyšší úrovni je `400 bad_request`,
`reason: unknown_field`, `details.field` = jméno pole.** To výslovně zahrnuje
`fingerprint`: revize 3 říkala, že se klientský otisk „ignoruje", což je horší
než odmítnutí — klient by mohl uvěřit, že se použil. Odmítnutí je jediné
chování, které nemůže vzniknout nedorozumění.

**Server počítá** kanonický otisk nad:

```
{ protocolVersion, operationType, resource, expectedVersion, payload }
```

### A4.2 `operationId`

- `UUIDv4` v kanonickém tvaru, lowercase, 36 znaků;
- cokoli jiného → `400 bad_request`, `reason: malformed_operation_id`;
- unikátní **v rámci `deviceId`**, ne globálně — operace je vázaná na dvojici
  `(deviceId, operationId)`.

### A4.3 `MutationOutcome<T>`

```
MutationOutcome<T> = {
  operationId:    string,
  deviceId:       string,
  operationType:  string,
  resource:       string,
  state:          "CONFIRMED"|"REJECTED"|"PENDING"|"UNKNOWN",
  phase:          <A4.4>,          // durable fáze, vždy přítomná
  fingerprint:    string,          // serverem počítaný
  result:         T|null,          // jen u CONFIRMED, jinak null
  reason:         string|null,     // rejectedReason u REJECTED,
                                   // unknownReason u UNKNOWN, jinak null
  at:             ISO-8601
}
```

`T` je určeno **per mutace** v doménové příloze — u `PATCH /m1/settings/:key` je
to `SettingKey` (`W2`).

### A4.4 Durable fáze — co dělá `PENDING` splnitelným

Review namítlo správně: *„u trvalého `PENDING` ,opakování provede efekt jednou'
není samo o sobě proveditelné — server bez durable fáze/lease nepozná, zda efekt
nezačal těsně před pádem."* Žurnál dnes umí jen `PENDING → CONFIRMED |
REJECTED | UNKNOWN` a při pádu procesu smete `PENDING` na `UNKNOWN`
(`operation-journal.js`, sweep podle vlastníka). To nestačí.

**Kontrakt proto zavádí durable `phase`, zapisovanou vždy _před_ krokem,
který popisuje:**

| `phase` | Zapsáno **před** | Co smí restart udělat |
|---|---|---|
| `RECEIVED` | jakýmkoli dotykem domény | **bezpečně zopakovat** — efekt prokazatelně nezačal |
| `DISPATCHED` | prvním dotykem domény nebo providera | **nezopakovat**; podle třídy `A4.6` |
| `SETTLED` | zápisem terminálního stavu | stav je určen, jen se dočte |

`RECEIVED → DISPATCHED` je právě ta hranice, kterou revize 3 neměla, a bez ní
věta „opakování provede efekt jednou" nebyla ověřitelná. Fáze je **durable**
(commit před krokem), ne v paměti — jinak by ji pád vzal s sebou.

Sweep po pádu procesu se tím opravuje: `RECEIVED` se **nemetá na `UNKNOWN`**,
zůstává `PENDING` a je znovu proveditelná. Na `UNKNOWN` jde jen `DISPATCHED`.

### A4.5 Body pádu

| Pád | `phase` po restartu | Co musí platit |
|---|---|---|
| před efektem | `RECEIVED` | `PENDING`; opakování se stejným klíčem provede efekt **jednou** |
| po dotyku domény, před zápisem výsledku | `DISPATCHED` | řeší se podle **třídy trvanlivosti** (`A4.6`) — obecná odpověď neexistuje |
| po zápisu terminálního stavu | `SETTLED` | lookup vrátí zapsaný stav (`CONFIRMED`/`REJECTED`), **ne `UNKNOWN`** |

### A4.6 Třída trvanlivosti — povinná deklarace pro každou mutaci

Review odmítlo generické „transakce nebo reconciliation" a mělo pravdu: `A4.5`
revize 3 slibovala, že reconciliation efekt **vždy** dohledá, zatímco
`DATA-MODEL.md` §4.4 říká opak — *„`GET /m1/operations/:id` je čtení posledního
zapsaného stavu, ne rekonciliace… Operace označená `UNKNOWN` zůstane `UNKNOWN`"*
a skutečné dohledání je samostatný úkol `MR-25`.

**Každá mutace v2 proto deklaruje jednu ze tří tříd:**

| Třída | Co znamená | Co platí ve fázi `DISPATCHED` |
|---|---|---|
| `TXN` | doménový zápis, inkrement `domainRevision` a terminální stav žurnálu jsou **v jedné DB transakci** | fáze `DISPATCHED` po restartu **neexistuje** — buď se commitla celá, nebo nic. Lookup vrací `CONFIRMED`/`REJECTED`, případně `PENDING` k zopakování |
| `LOOKUP` | efekt je u providera mimo transakci, ale provider má **idempotentní klíč a dotaz na výsledek** | reconciliation při startu efekt dohledá a stav dorovná; `UNKNOWN` je dočasné |
| `TERMINAL_UNKNOWN` | efekt dohledat **nejde** | `UNKNOWN` je **trvalý** a kontrakt to přiznává; klient nesmí opakovat automaticky |

**Deklarace pro čtyři mutace, které v2 má:**

| Mutace | Třída | Proč |
|---|---|---|
| `PATCH /m1/settings/:key` | **`TXN`** | hodnota i žurnál jsou ve stejné SQLite DB |
| `POST /m1/memory` | **`TXN`** | totéž |
| `PATCH /m1/workers/:id` | **`TXN`** | mění se konfigurační řádek, ne běh |
| `POST /m1/workers/:id/dry-run` | **`LOOKUP`** | běh je mimo transakci; **vyžaduje**, aby `runId` vznikl a byl zažurnálovaný **před** dispatchem, jinak není co dohledat |

**Důsledek, který stojí za vyslovení:** protože tři ze čtyř mutací jsou `TXN`,
je pro ně bod pádu „po efektu, před zápisem výsledku" **nedosažitelný** — a spor
mezi `A4.5` a `DATA-MODEL` §4.4 tím mizí, místo aby se přeargumentoval. Čtvrtá
(`dry-run`) je `LOOKUP` a **dokud ten lookup neexistuje, hlásí se
`workers.dryRun` jako `unavailable`** (`A1.4`, `B4.3`). Třída
`TERMINAL_UNKNOWN` v v2 **není použita** — je v kontraktu proto, aby budoucí
mutace měla poctivou možnost, ne aby se do ní schovávaly ty dnešní.

`MR-25` zůstává tím, čím je: obecná reconciliation nad libovolnou operací. v2 ji
nepotřebuje, protože si vybral mutace, které se bez ní obejdou.

### A4.7 Kanonizace otisku — normativní

Bez tohohle je „stejný otisk" neověřitelné tvrzení. Vstupem je
`{ protocolVersion, operationType, resource, expectedVersion, payload }`,
výstupem `sha256` hex.

1. **Serializace** je JSON, UTF-8, bez mezer (`JSON.stringify` nad kanonickou
   formou) — jako dnešní `canonicalJson()` v `protocol.js`.
2. **Klíče objektů** se řadí rekurzivně vzestupně podle **UTF-16 code unit**
   (chování `Array.prototype.sort` bez comparatoru), aby se otisk shodoval
   s dnešní implementací. **Pole si pořadí drží** — pořadí v seznamu je význam.
3. **Absent ≠ null.** Chybějící klíč se **vypustí**; `null` se **zachová**.
   `{a: null}` a `{}` mají **různý** otisk. Dnešní `canonicalize()` vypouští
   `undefined` a `null` nechává — toto pravidlo to jen povyšuje na kontrakt.
   `expectedVersion`, které klient neposlal, se do otisku vloží **jako
   nepřítomné**, ne jako `null`.
4. **Čísla**: jen konečná. `NaN` a `±Infinity` → `400 bad_request`,
   `reason: value_out_of_range`. `-0` se normalizuje na `0`. Celá čísla se píšou
   bez exponentu a bez desetinné tečky.
5. **Řetězce** se normalizují na **Unicode NFC** před serializací. Bez toho by
   dvě vizuálně shodná těla dala různý otisk a stejný `operationId` by skončil
   jako `operation_conflict`.
6. **`resource`** má tvar `<type>:<id>`. `type` je z uzavřeného seznamu
   (`settings`, `memory`, `worker`) a **lowercase**; `id` se **nenormalizuje** —
   klíč nastavení `llm.Temperature` a `llm.temperature` jsou různé zdroje, pokud
   je taková doména rozlišuje. Doména, která je nerozlišuje, to musí říct
   v příloze.
7. **`operationType`** je stabilní řetězec, ne HTTP metoda ani cesta:
   `settings.write`, `memory.append`, `workers.toggle`, `workers.dryRun` —
   shodný s klíčem funkce v `A1.4`.

### A4.8 Pravidla

| Situace | Chování |
|---|---|
| Stejný `operationId`, **stejný** otisk | vrátí **původní výsledek**, neprovede podruhé |
| Stejný `operationId`, **jiný** otisk | `409 operation_conflict`, `details.operationId` |
| `expectedVersion` neplatí | `409 state_conflict` s `expectedVersion`, `actualVersion` **a `actual`** (serverová hodnota) |
| Cizí `deviceId` | `404 not_found` — operace je vázaná na `(deviceId, operationId)` |
| `fingerprint` v těle | `400 bad_request`, `reason: unknown_field` |

### A4.9 `UNKNOWN` — lokální úsudek vs. serverový stav

- `UNKNOWN` je **lokální úsudek klienta**, dokud se nezeptá
  `GET /m1/operations/:id`. Klient ho **nikdy neposílá na server**.
- **Serverový `UNKNOWN`** existuje jen tehdy, když server sám nedokáže efekt
  rozhodnout, a **povinně** nese `reason` z uzavřeného `unknownReason` unionu
  (`A5`). `UNKNOWN` bez `reason` je porušení kontraktu.
- Když server efekt provedl a zapsal `CONFIRMED`, lookup **musí** vrátit
  `CONFIRMED` — dnešní `handlers.js` to tak dělá.

## A5. Chybová algebra — celý uzavřený enum

Revize 3 tvrdila uzavřenost a chyběly jí čtyři skupiny. Toto je celý enum;
**nic mimo něj se nevydává.** Skupina „párování a schválení" je tady proto, že
wire v2 pokrývá **všech 26 rout** — `A3.4` výslovně převádí dnešní
`/m1/conversations` na v2, takže nelze tvrdit, že se v2 týká jen nových třinácti.

| Kód | HTTP | `retryable` | Povinné `details` |
|---|---|---|---|
| **Dostupnost** ||||
| `server_unavailable` | 503 | ano | — |
| `domain_unavailable` | 503 | ne | `feature` |
| **Identita** ||||
| `token_missing` | 401 | ne | — |
| `token_invalid` | 401 | ne | — |
| `token_expired` | 401 | ne | — |
| `token_revoked` | 401 | ne | — |
| **Párování a schválení** ||||
| `pairing_already_used` | 409 | ne | — |
| `pairing_expired` | 409 | ne | — |
| `pairing_disabled` | 403 | ne | — |
| `approval_expired` | 409 | ne | `operationId` |
| `approval_superseded` | 409 | ne | `operationId` |
| **Autorizace** ||||
| `scope_required` | 403 | ne | `required[]` |
| **Zdroj** ||||
| `not_found` | 404 | ne | `resource` |
| `route_not_allowed` | 404 | ne | — |
| **Stav** ||||
| `state_conflict` | 409 | ne | `expectedVersion`, `actualVersion`, **`actual`** |
| `operation_conflict` | 409 | ne | `operationId` |
| **Vstup** ||||
| `bad_request` | 400 | ne | `reason`, `field?` |
| `cursor_unknown` | 400 | ne | `reason`, `restart: true` |
| **Protokol** ||||
| `protocol_mismatch` | 426 | ne | `supportedProtocols[]`, `supportedContracts[]`, `selectedProtocol\|null` |
| **Události** ||||
| `event_window_gone` | 410 | ne | `oldestAvailableSeq`, **`resumeAfterSeq`** |
| **Limity** ||||
| `rate_limited` | 429 | ano | `retryAfterMs` |
| `operation_limit` | 429 | ne | `open`, `limit` |

`state_conflict` nese **`actual`** — serverovou hodnotu. Revize 3 v `A4` slibovala,
že ji vrací, a v `A5` povolovala v `details` jen dvě verze. Rozpor je tím
odstraněn ve prospěch `A4`: bez hodnoty nemá klient co zobrazit a musel by se
doptat druhým requestem.

### A5.1 `cursor_unknown.reason`

`malformed` | `unrecognized` | `stream_mismatch` | `snapshot_gone` |
`key_rotated` | `cursor_version_mismatch` | `principal_mismatch`

`expired` je **odstraněno** — kurzor podle `A3.4` nemá expiraci.
`principal_mismatch` je nové: kurzor cizího `principalId`/`deviceId` byl v `A3.4`
popsaný, ale neměl kód.

### A5.2 `bad_request.reason` — včetně validačních důvodů

| `reason` | Kdy | `field` |
|---|---|---|
| `missing_field` | povinné pole chybí | povinné |
| `wrong_type` | pole má jiný typ, než schéma žádá | povinné |
| `unknown_field` | pole navíc (exact schema) | povinné |
| `malformed_operation_id` | `operationId` není `UUIDv4` | — |
| `value_out_of_range` | mimo `constraint`, `NaN`, `±Infinity`, příliš dlouhý seznam | povinné |
| `query_too_long` | dotaz hledání přes limit | — |
| `unknown_parameter` | neznámý query parametr nebo vadná hlavička | povinné |
| `anchor_unknown` | kotva neexistuje | — |
| `anchor_with_cursor` | kotva a kurzor současně | — |
| `malformed_body` | tělo není platný JSON objekt | — |

Validace je **schematická, ne doménová**: `missing_field`/`wrong_type`/
`unknown_field` říkají, že tělo nevyhovělo schématu. To, že hodnota vyhověla
schématu a **doména** ji odmítla, je `REJECTED` s `rejectedReason` (`A5.4`), ne
`bad_request`. Jediná výjimka je `value_out_of_range`, protože `constraint` je
součástí DTO a tím i schématu.

### A5.3 `unknownReason` — uzavřený union

Shodný se `UNKNOWN_REASONS` v `src/mobile/protocol.js` a s tabulkou
`DATA-MODEL.md` §4.4. Kontrakt ho **přebírá, nezavádí vlastní**:

`upstream_timeout` | `upstream_unreachable` | `connection_lost_after_dispatch` |
`upstream_error_status` | `process_terminated` | `result_persistence_failed` |
`gateway_exception` | `unspecified`

Seznam je krátký schválně: **každý kód má v kódu producenta.** Přidat kód, který
nikdo nevydá, je slib, který server nedrží — proto v něm není
`client_disconnected`. Rozšíření unionu je změna **wire verze**.

### A5.4 `rejectedReason` — doménový union

`REJECTED` je `200` s `state: REJECTED`; `reason` je z tohoto seznamu a **každá
položka patří právě jedné doméně**, která ji musí ve své příloze uvést:

| `reason` | Doména | Význam |
|---|---|---|
| `not_editable` | settings | klíč je `editable: false`, mění se z desktopu |
| `desktop_only` | settings | klíč je v pravém sloupci `R-5` |
| `value_rejected` | settings | hodnota prošla schématem, doména ji nepřijala |
| `text_rejected` | memory | prázdná nebo jinak nepřijatelná poznámka |
| `memory_full` | memory | dosažen limit ručních poznámek |
| `worker_busy` | workers | worker právě běží, přepnutí by bylo nejednoznačné |
| `dry_run_unsupported_kind` | workers | typ workera dry-run nepodporuje |

**Prázdný seznam pro doménu je platný stav** a znamená „tahle mutace se nikdy
neodmítá doménově". Rozšíření je změna **kontraktní verze**, ne wire.

### A5.5 Vztah k `MutationOutcome`

HTTP chyba a `state` se **nemíchají**:

- odmítnutí na úrovni protokolu (401/403/426) je HTTP chyba **bez**
  `MutationOutcome`;
- odmítnutí **doménové** je `200` s `state: REJECTED` a `rejectedReason`;
- konflikty (409) jsou HTTP chyba, protože klient nemá co potvrzovat;
- `400` je HTTP chyba — tělo, které neprošlo schématem, žádnou operaci
  nezaložilo, takže není co vracet jako `MutationOutcome`.

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

### A7.2 TTL — `D-M5` rozhodnuto

Review revize 3 `D-M5` **rozhodlo** a přijalo per-doménové návrhy z `DATA-MODEL`
jako počáteční v2 politiku. Kontrakt je tím pádem **normativní**, ne otevřený:

| Doména | `FRESH` do | `STALE` do | Poznámka |
|---|---|---|---|
| `settings` | 1 h | 24 h | |
| `projects` | 15 min | 7 dnů | |
| `memory` | 1 h | 7 dnů | **jen zobrazené okno**, bez prefetch |
| `workers` | 5 min | 7 dnů | `run.state` se necachuje vůbec (`B4`) |
| `runs` | — | — | průběh se necachuje (`B5`) |
| `search` | — | — | výsledky hledání **nemají vlastní cache** (`B6.5`) |

Po **hard limitu** (druhý sloupec) je záznam **vždy `EXPIRED`** a **maže se**.

**Server smí doporučit kratší dobu, nikdy klientovi tenhle hard limit
prodloužit.** Doporučení se posílá jako `cacheHint.maxAgeMs` v obálce domény;
klient bere `min(hint, hard limit)`. Prodloužení vyžaduje **změnu kontraktu**,
ne serverovou hlavičku — jinak by se bezpečnostní vlastnost dala vypnout
konfigurací.

### A7.3 Klíč a úklid

```
cacheKey = serverIdentity + deviceId + protocolVersion
         + contractVersion + domain + canonicalFilter
```

`protocolVersion` v klíči je oprava z review: `A1.1` říká, že wire a kontrakt se
mění nezávisle, takže tvar cachovaného DTO se může změnit **beze změny**
`contractVersion`. Bez `protocolVersion` v klíči by se pak mísily dva tvary
téhož záznamu.

**`serverIdentity` — definice.** Je to **stabilní neprůhledný identifikátor
serverové instance, vydaný při párování** a od té chvíle neměnný. Není to URL
ani hostname: obojí se mění, aniž by se změnila data (DHCP, tunel, jiný port),
a naopak zůstává stejné po reinstalaci, po které data táž nejsou.

**Požadavek na backend.** Dnes takový identifikátor **neexistuje**.
`gateway-instance.js` má `instance_id` ve tvaru `gw-<uuid>`, ale ten vzniká
**per proces** a při každém startu je jiný — jako cache klíč by mazal cache při
každém restartu gateway. Musí vzniknout **perzistentní** identita vázaná na
databázi, vydaná v odpovědi párování a uložená v zařízení. Změna
`serverIdentity` je pro klienta **jiný server**: cache se zahodí celá.

Úklid nastává při: revokaci, odhlášení, **ztrátě scope**, změně
`serverIdentity`, změně `protocolVersion`, změně `contractVersion` a novém
spárování.

> **Co kontrakt slíbit nemůže:** vzdálený wipe offline telefonu. Revokace maže
> data teprve tehdy, když ji zařízení **autenticky přijme**. Slibovat víc by byla
> nepravda o bezpečnostní vlastnosti.

## A8. Routy

Kontrakt routy jmenuje, jejich vznik neautorizuje. 13-route allow-list platí až
do WP, který routu implementuje.

---

# ČÁST W — Čtyři svědecké fixtures

Review navrhlo tenhle mezikrok a je přijatý: **než se napíše třináct schémat,
napíšou se čtyři, na kterých je vidět celé jádro v úplném tvaru.** Kdyby
abstrakce z části A někde nesedla, projeví se to tady — na čtyřech příkladech,
ne na třinácti.

| # | Routa | Co prověřuje |
|---|---|---|
| `W1` | `GET /m1/projects` | `A1` `A2` `A3` `A5` `A7` |
| `W2` | `PATCH /m1/settings/:key` | `A2` `A4` `A5` `A6` |
| `W3` | `GET /m1/runs/:id/events` | tail, retention, `CoreEvent` |
| `W4` | `POST /m1/search` | citlivé tělo, kurzor, kombinace scopů |

Fixtures jsou **normativní**: rozdíl mezi implementací a fixture je chyba
implementace. Časy a identifikátory jsou v nich ilustrativní.

## W1 — `GET /m1/projects`

### Request

```http
GET /m1/projects?limit=2 HTTP/1.1
Authorization: Bearer <device token>
X-M1-Protocol: m1.2026-08-12, m1.2026-07-30
X-M1-Contract: v2, v1
```

Query parametry — exact schema, neznámý parametr je `bad_request`,
`reason: unknown_parameter`:

| | Typ | Default |
|---|---|---|
| `limit` | `1..100` | `50` |
| `cursor` | `c2` řetězec | — |
| `state` | `active` \| `archived` | `active` |

`cursor` a `state` současně je **povoleno** jen tehdy, když se `state` shoduje
s tím, co je zapečené ve `stream` kurzoru; jinak `cursor_unknown`,
`reason: stream_mismatch`.

### Odpověď — `200`

```json
{
  "ok": true,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:14:22.481Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["read:projects"],
  "data": {
    "items": [
      {
        "id": "17",
        "name": "IntentSmith",
        "state": "active",
        "createdAt": "2026-05-02T10:00:00.000Z",
        "updatedAt": "2026-08-12T08:59:01.000Z",
        "conversationCount": null,
        "version": "v1:9c2f81a4e07b3d5566aa0f1c48e2b7d9",
        "fetchedAt": "2026-08-12T09:14:22.481Z"
      },
      {
        "id": "12",
        "name": "C3 IDE",
        "state": "active",
        "createdAt": "2026-03-11T07:20:00.000Z",
        "updatedAt": "2026-08-11T19:02:44.000Z",
        "conversationCount": null,
        "version": "v1:2b7e5590aa13c8d4471f6e0392bcda85",
        "fetchedAt": "2026-08-12T09:14:22.481Z"
      }
    ],
    "nextCursor": "c2.eyJ2IjoyLCJrZXlJZCI6ImsxIn0.O1n7Qb2xR",
    "end": false,
    "cacheHint": { "maxAgeMs": 900000 }
  }
}
```

Poznámky, které jsou součástí kontraktu:

- `id` je **řetězec**, i když jádro má `INTEGER PRIMARY KEY`. Číselné `id` na
  wire je past na klienty, které je zaokrouhlí nebo přeformátují.
- `cacheHint.maxAgeMs` je **doporučení**; klient bere `min(900000, 15 min)`
  podle `A7.2`. Server ho nesmí zvýšit nad hard limit s efektem.
- `end: false` a `nextCursor` jdou spolu. `end: true` znamená `nextCursor: null`.

### Odpověď — `cursor_unknown` po změně domény

```json
{
  "ok": false,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:15:10.002Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["read:projects"],
  "error": {
    "code": "cursor_unknown",
    "retryable": false,
    "details": { "reason": "snapshot_gone", "restart": true }
  }
}
```

**Tohle je ta oprava z `A3.2` viditelně.** Mezi stránkami byl projekt `B`
archivován. `MAX(updated_at)` by se nezměnil a klient by dostal děravou stránku;
`domainRevision` se zvýšil, takže dostane pravdu.

### Odpověď — chybějící scope

```json
{
  "ok": false,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:15:44.910Z",
  "principalId": "dev_7f3a2c",
  "scopes": [],
  "error": {
    "code": "scope_required",
    "retryable": false,
    "details": { "required": ["read:projects"] }
  }
}
```

`scopes: []` je zde **skutečně použité** scopes (žádné), ne udělené —
`A2.1`.

## W2 — `PATCH /m1/settings/:key`

### Request

```http
PATCH /m1/settings/llm.temperature HTTP/1.1
Authorization: Bearer <device token>
X-M1-Protocol: m1.2026-08-12
X-M1-Contract: v2
Content-Type: application/json

{
  "operationId": "9f1c4d2e-7b60-4a11-93cc-0e5d2f8a1b34",
  "payload": { "value": 0.7 },
  "expectedVersion": "v1:2b7e5590aa13c8d4471f6e0392bcda85"
}
```

Server počítá otisk nad:

```json
{
  "protocolVersion": "m1.2026-08-12",
  "operationType": "settings.write",
  "resource": "settings:llm.temperature",
  "expectedVersion": "v1:2b7e5590aa13c8d4471f6e0392bcda85",
  "payload": { "value": 0.7 }
}
```

### Odpověď — `200 CONFIRMED`

```json
{
  "ok": true,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:20:03.117Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["write:settings"],
  "data": {
    "operationId": "9f1c4d2e-7b60-4a11-93cc-0e5d2f8a1b34",
    "deviceId": "dev_7f3a2c",
    "operationType": "settings.write",
    "resource": "settings:llm.temperature",
    "state": "CONFIRMED",
    "phase": "SETTLED",
    "fingerprint": "8a41f0…",
    "result": {
      "key": "llm.temperature",
      "section": "llm",
      "label": "Teplota",
      "type": "float",
      "value": 0.7,
      "default": 0.8,
      "editable": true,
      "version": "v1:c50d9a71b3e2884f0163ad7c9e5b21f6",
      "constraint": { "min": 0, "max": 2, "step": 0.1 },
      "fetchedAt": "2026-08-12T09:20:03.117Z"
    },
    "reason": null,
    "at": "2026-08-12T09:20:03.117Z"
  }
}
```

`result` je `T` = `SettingKey` — `A4.3` žádá, aby `T` bylo určeno per mutace.
`version` v `result` je **nová** hodnota, takže klient nemusí číst znovu.

### Odpověď — `200 REJECTED` (doménové odmítnutí)

```json
{
  "ok": true,
  "data": {
    "operationId": "9f1c4d2e-7b60-4a11-93cc-0e5d2f8a1b34",
    "state": "REJECTED",
    "phase": "SETTLED",
    "result": null,
    "reason": "not_editable",
    "at": "2026-08-12T09:20:03.117Z"
  }
}
```

*(obálková pole zkrácena — jsou stejná jako výše a jsou povinná)*

`ok: true` u `REJECTED` je schválně: požadavek proběhl, doména odpověděla ne.
`A5.5`.

### Odpověď — `409 state_conflict`

```json
{
  "ok": false,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:21:40.775Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["write:settings"],
  "error": {
    "code": "state_conflict",
    "retryable": false,
    "details": {
      "expectedVersion": "v1:2b7e5590aa13c8d4471f6e0392bcda85",
      "actualVersion": "v1:c50d9a71b3e2884f0163ad7c9e5b21f6",
      "actual": 1.1
    }
  }
}
```

**`actual` je ta oprava rozporu** mezi `A4` a `A5` z revize 3: klient ukáže
„na serveru je 1.1" bez druhého requestu.

### Odpověď — `400` na klientský otisk

```json
{
  "ok": false,
  "error": {
    "code": "bad_request",
    "retryable": false,
    "details": { "reason": "unknown_field", "field": "fingerprint" }
  }
}
```

`A4.1`: **odmítnutí, ne ignorování.**

## W3 — `GET /m1/runs/:id/events`

### Request

```http
GET /m1/runs/run_88c1/events?waitMs=20000&limit=100 HTTP/1.1
Authorization: Bearer <device token>
X-M1-Protocol: m1.2026-08-12
X-M1-Contract: v2
```

**První dotaz `afterSeq` vynechává.** Revize 3 měla `afterSeq=0` jako „od
nejstarší", což bylo současně „pod retention hranicí" a mělo tedy vracet `410`.
Nepřítomnost parametru je jednoznačná; `afterSeq=0` je nadále platná hodnota
s běžným exkluzivním významem („po události 0"), a pokud leží pod retention,
dostane `410` jako každá jiná.

### Odpověď — `200`

```json
{
  "ok": true,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:30:00.000Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["read:runs"],
  "data": {
    "events": [
      {
        "runId": "run_88c1",
        "seq": 41,
        "at": "2026-08-12T09:29:58.220Z",
        "type": "tool",
        "level": "info",
        "text": "čtu konfiguraci [redigováno]",
        "data": { "tool": "read_file", "durationMs": 12 }
      }
    ],
    "nextAfterSeq": 41,
    "oldestAvailableSeq": 12,
    "caughtUp": true,
    "runTerminal": false,
    "waitTimedOut": false
  }
}
```

Šest polí odpovědi má šest různých úkolů. Bez nich znamená prázdná odpověď
zároveň „zatím nic", „běh skončil" i „staré události jsou pryč":

| Situace | Odpověď |
|---|---|
| Zatím nic nového | `events: []`, `caughtUp: true`, `runTerminal: false` |
| Běh skončil | `runTerminal: true` + koncová událost v `events` nebo dříve |
| Server čekal `waitMs` a nic nepřišlo | `waitTimedOut: true`, `caughtUp: true` |
| `afterSeq` pod retention | `410` — viz níže |

### Odpověď — `410 event_window_gone`

```json
{
  "ok": false,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:31:12.400Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["read:runs"],
  "error": {
    "code": "event_window_gone",
    "retryable": false,
    "details": { "oldestAvailableSeq": 12, "resumeAfterSeq": 11 }
  }
}
```

**`resumeAfterSeq = oldestAvailableSeq − 1` je oprava z review.** `afterSeq` je
exkluzivní, takže kdyby klient pokračoval hodnotou `oldestAvailableSeq`,
**přeskočil by právě nejstarší dostupnou událost** — přesně tu, kterou mu server
říká, že ještě má. Klient pokračuje od `resumeAfterSeq` a **mezeru přizná**;
poslat ho na začátek, který retention smazala, by byla nepravda.

Retention **délka** ve wire kontraktu není (rozhodnutí review): kontrakt zmrazuje
jen **pozorovatelnou hranici** (`oldestAvailableSeq`) a **postup obnovy**
(`resumeAfterSeq`). Provoz smí délku měnit, aniž by měnil kontrakt.

## W4 — `POST /m1/search`

### Request

```http
POST /m1/search HTTP/1.1
Authorization: Bearer <device token>
X-M1-Protocol: m1.2026-08-12
X-M1-Contract: v2
Content-Type: application/json

{
  "query": "migrace kurzoru",
  "scope": ["conversations", "projects", "memory"],
  "limit": 20
}
```

`POST` je zde **read-only** (`B6.3`) a **nemá `operationId`** — nic nemění.
Tělo má exact schema; `operationId` v něm je `bad_request`,
`reason: unknown_field`.

### Odpověď — `200` s částečným scope

Zařízení má `read:search` + `read:conversations`, ale **ne** `read:memory`:

```json
{
  "ok": true,
  "protocolVersion": "m1.2026-08-12",
  "contractVersion": "v2",
  "serverTime": "2026-08-12T09:40:00.000Z",
  "principalId": "dev_7f3a2c",
  "scopes": ["read:search", "read:conversations", "read:projects"],
  "data": {
    "query": "migrace kurzoru",
    "scopeRequested": ["conversations", "projects", "memory"],
    "scopeSearched": ["conversations", "projects"],
    "scopeSkipped": [{ "domain": "memory", "reason": "scope_required" }],
    "snapshot": {
      "conversations": 8841,
      "projects": 210,
      "queryFingerprint": "3d9b…"
    },
    "truncated": true,
    "results": [
      {
        "domain": "conversations",
        "id": "conv_4410",
        "title": "Kontrakt v2 — kurzor",
        "snippet": "…migrace kurzoru c1 → c2 je součástí…",
        "at": "2026-08-11T16:20:00.000Z"
      }
    ],
    "nextCursor": "c2.eyJ2IjoyLCJzdHJlYW0iOiJzZWFyY2gifQ.Kk91",
    "end": false
  }
}
```

Tři pole místo jednoho `scope` jsou tam schválně: **odpověď musí přiznat, kde
se nehledalo, a proč.** Revize 3 měla jen `scope` a nedalo se z něj poznat, jestli
prázdný výsledek znamená „nic tam není" nebo „tam se nedívalo".

`snapshot` je **vektor revizí prohledávaných domén** + `queryFingerprint`
(`A3.2`). Změna kterékoli z nich → `snapshot_gone` na další stránce.

`truncated: true` je **jiný stav** než `end: true`: „našel jsem víc, než vracím"
vs. „tohle bylo všechno".

`results[].snippet` prochází stejnou redakcí jako `B5.5` a **nikdy nenese celý
obsah** (`B6.4`).

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

`version` je v DTO **povinná**, protože ji zápis vyžaduje.

### B1.3 Zápis

Po **jednotlivých klíčích**, ne dávkou: dávka by při konfliktu přepsala i to, co
uživatel neviděl.

Klient posílá **`operationId`, `payload` a čtenou `version` jako
`expectedVersion`** — a nic víc (`A4.1`). **Otisk počítá server; `fingerprint`
v těle je `400`.** Revize 3 tady stále tvrdila, že ho klient posílá, což
odporovalo `A4`; opraveno.

Při neshodě `409 state_conflict` s `actual` a klient **ukáže serverovou
hodnotu**, nepřepíše ji potichu.

| | |
|---|---|
| Routy | `GET /m1/settings`, `PATCH /m1/settings/:key` |
| Mutace | `settings.write`, třída **`TXN`** (`A4.6`) |
| `T` v `MutationOutcome<T>` | `SettingKey` |
| `rejectedReason` | `not_editable`, `desktop_only`, `value_rejected` |
| Stránkování | ne — seznam je uzavřený; kdyby přerostl, platí A3 |
| Cache | `FRESH` 1 h · `STALE` 24 h (`A7.2`) |
| Offline | **čitelné z cache** s ukazatelem stáří; zápis offline nejde a řekne se to předem |
| Obrazovky | `MS-10`, `MS-11` |
| Není v doméně | pravý sloupec `R-5`; `MD-15` lokální preference (jsou zařízení, ne účtu) |

## B2. Projekty (Fáze 3B, `MR-14`)

### B2.1 Oprava faktu z revize 1

Revize 1 tvrdila, že backend projektová data nemá. **To je nepravda.**
`src/routes/projects.js` má `GET /api/projects` s lifecycle a vazbou konverzací;
`UI-REVIEW` §4 to potvrzuje. Kontrakt proto **není zadání nové domény, ale
adaptér nad existující**.

### B2.2 Mapování stavů

Jádro zná **`active | archived | deleted`** (`status`, migrace
`2026_02_24_013_v78_archive_status.js`).

| `/m1` | jádro | pozn. |
|---|---|---|
| `active` | `active` | |
| `archived` | `archived` | |
| — | `deleted` | **na `/m1` se nevydává vůbec** |

`preparing` a `done` **v v2 nejsou.** Kdyby je produkt chtěl, musí nejdřív
vzniknout v jádře; UI je nesmí odvozovat.

### B2.3 Mapování polí jádra na wire — doplněno

`§0.2` revize 3 přiznávalo, že tohle mapování chybí. Pro projekty:

| Wire | Jádro | Pravidlo |
|---|---|---|
| `id: string` | `id INTEGER` | **desítkový zápis do řetězce.** Číselné `id` na wire je past |
| `createdAt` | `created_at DATETIME` | do ISO-8601 UTC s `Z` a milisekundami |
| `updatedAt` | **`last_active DATETIME`** | jádro sloupec `updated_at` **nemá** |
| `state` | `status` | `B2.2`; `deleted` se nevydává |
| `conversationCount` | — | `null`, dokud WP nedoloží zdroj |

**`updatedAt` ← `last_active` je pojmenování, ne fakt o čase změny.** `last_active`
je poslední aktivita, ne poslední úprava záznamu — a je to jediné, co jádro má.
Kontrakt to proto říká nahlas: **`updatedAt` v této doméně znamená „naposledy
aktivní"**. Řazení `updatedAt DESC` je tedy řazení podle aktivity, což je pro
`MS-12` správné chování, ale nesmí se z něj usuzovat, že se záznam změnil.

Řadicí klíč je tím pádem měnitelný, takže `snapshot` je povinný (`A3.3`) —
a protože `domainRevision` roste i při archivaci a mazání, chytí i ty
(`W1`).

### B2.4 DTO

```
Project = {
  id:                string,
  name:              string,
  state:             "active"|"archived",
  createdAt:         ISO-8601,
  updatedAt:         ISO-8601,        // = last_active, viz B2.3
  conversationCount: integer|null,    // null = jádro ho nedodalo, ne nula
  version:           string,
  fetchedAt:         ISO-8601
}
```

`conversationCount` je **nullable schválně**: `null` znamená „neumím spočítat",
což je jiné tvrzení než `0`.

**Pole, která v2 vědomě NEZAVÁDÍ:** `Popis`, `Cíl`, `Vlastník`, záložky
`Soubory`, `Úkoly`, `Nastavení` projektu, `2 běžící úkoly`. Nemají zdroj a
`UI-REVIEW` §3.1 je jmenuje. (Jádro `description` má, ale `PLAN` ho na mobil
nepustil — kdyby se to mělo změnit, je to rozhodnutí, ne doplnění pole.)

### B2.5 Vazba na konverzace

Konverzace dostává volitelné `projectId`; „mimo projekt" je `null`, ne zvláštní
projekt — ten by šel smazat. Seznam konverzací umí `?projectId=`; filtr je
součástí `stream` v kurzoru (A3), takže kurzor z jiného filtru se odmítne.

### B2.6 Rozsah

| | |
|---|---|
| Routy | `GET /m1/projects`, `GET /m1/projects/:id` |
| Mutace | **žádné** |
| Scope | `read:projects` — **`write:projects` v2 není** |
| Stránkování | A3, řazení `updatedAt DESC, id DESC` |
| Cache | `FRESH` 15 min · `STALE` 7 dnů (`A7.2`) |
| Offline | **čitelné z cache** s ukazatelem stáří; `conversationCount` se offline nezobrazuje |
| Obrazovka | `MS-12` — **nestaví se do WP a Gate 1** |

Zakládání a editace projektu z telefonu je samostatné rozhodnutí, ne součást v2.

## B3. Paměť (Fáze 4, `MR-17`, `MR-18`)

### B3.1 Rozsah

`PLAN.md` §5, Fáze 4: „LTM a task memory read-only, **ruční poznámka, bez mazání**".
`DATA-MODEL.md` klade mazání paměti mimo 1.0.

Operátor 2026-08-11: paměť **není vlastní sekce**, je karta pod `Nastavení`.

### B3.2 DTO — `manual` je provenance, ne `kind`

```
MemoryRecord = {
  id:         string,
  kind:       "ltm"|"task",                   // co to je
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
| Mutace | `memory.append`, třída **`TXN`** (`A4.6`) |
| `T` v `MutationOutcome<T>` | `MemoryRecord` |
| `rejectedReason` | `text_rejected`, `memory_full` |
| Stránkování | A3, řazení `lastUsedAt DESC NULLS LAST, id DESC` |
| Cache | `FRESH` 1 h · `STALE` 7 dnů, **jen zobrazené okno, bez prefetch** (`A7.2`) |
| Offline | **čitelné z cache**; zápis offline nejde |
| Obrazovka | karta pod `Nastavení` |

> **Proč `NULLS LAST` a `domainRevision` spolu.** Nový záznam s
> `lastUsedAt: null` se řadí na konec a `MAX(last_used_at)` by se jím nezměnil —
> přesně protipříklad z review (`A3.2`). `domainRevision` se zvýší při vložení,
> takže se změna pozná.

## B4. Workeři (Fáze 5, `MR-19`, `MR-20`)

### B4.1 DTO — oddělená konfigurace, běh a výsledek

```
Worker = {
  id:      string,
  name:    string,
  kind:    string,
  config:  { enabled: boolean },                     // co je nastavené
  run:     { state: "idle"|"running", startedAt },   // co se děje teď
  last:    { outcome: "ok"|"failed"|"cancelled"|null, at, runId } | null,
  version: string,
  fetchedAt: ISO-8601
}
```

Vypnutý worker je `config.enabled: false`, ne `state: disabled`. Rozbitý worker
je `last.outcome: failed`, ne `state: failed`.

### B4.2 Co smí telefon

**Zapnout a vypnout** (`PATCH`, `write:workers`, s `A4`, třída `TXN`).

### B4.3 Dry-run — `unavailable` je **jen `workers.dryRun`**

Review to doložilo kódem: `AgentRunner.dryRun(config)` validuje **definici
dodanou v requestu**. Nenačte workera podle `:id`, neověří jeho serverovou verzi
a nesimuluje zdroje, triggery ani akce.

**Rozhodnutí:** `MR-20` vyžaduje **skutečný dry-run nad serverovou verzí
workera**:

1. běh se pouští **nad workerem podle `:id`**, ne nad tělem requestu;
2. veškeré efekty jdou do **izolovaného effect sinku**; ostrý zápis je nedosažitelný;
3. `runId` vzniká a je **zažurnálovaný před dispatchem** — bez toho není třída
   `LOOKUP` (`A4.6`) splnitelná;
4. nejasný konec je `UNKNOWN` s `unknownReason`, ne selhání;
5. výsledek je **typovaný**, ne volný text.

**Dokud to nevznikne, hlásí se jako `unavailable` funkce `workers.dryRun` — a jen
ona.** Revize 3 shazovala celou doménu; review to označilo za rozpor s `A1.4`,
který capability zavedl **po funkcích** právě proto, aby `workers.read`
a `workers.toggle` mohly fungovat. Opraveno.

**Přejmenovat dnešní validaci na dry-run a vydávat ji za `MR-20` je zakázané.**
**Ostrý běh z telefonu v2 není.**

| | |
|---|---|
| Routy | `GET /m1/workers`, `PATCH /m1/workers/:id`, `POST /m1/workers/:id/dry-run` |
| Mutace | `workers.toggle` (**`TXN`**), `workers.dryRun` (**`LOOKUP`**) |
| `T` v `MutationOutcome<T>` | `Worker` / `DryRunResult` (tvar definuje WP) |
| `rejectedReason` | `worker_busy`, `dry_run_unsupported_kind` |
| Cache | `FRESH` 5 min · `STALE` 7 dnů (`A7.2`) |
| Offline | seznam **čitelný z cache**; `run.state` **nikdy z cache** — běží/neběží je autorita |

## B5. Průběh běhu (`MR-07`)

### B5.1 Proč je jiná

Otevřená je **sama existence pravdivého zdroje**. `PLAN.md` §5.1: blokující
`/m1/chat` ani žurnál operací **nejsou agent log**. `/m1` nemá WS ani SSE.

Podle rozhodnutí review je to **budoucí normativní kontrakt**, ne
`REQUIREMENTS_ONLY`: kontrakt se zmrazí, capability `runs.events` zůstane
`unavailable`, dokud provider nevznikne.

### B5.2 Co musí vzniknout na serveru

1. **Trvanlivý** proud — událost přežije odpojení;
2. **`seq` monotónní a unikátní** (`F-015` ukazuje, co dělá `MAX(seq)+1` bez garancie);
3. **uzavřený slovník typů**;
4. **ukončený** — běh má koncovou událost; „přestalo přicházet" není konec;
5. **retention, jejíž hranice je pozorovatelná** — délka je věc provozu, ale
   `oldestAvailableSeq` musí být pravdivé.

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

`data` je typovaný union podle `type` — volné `meta` je nezkontrolovatelné.
Konkrétní tvar per `type` definuje WP; **jeden příklad je normativní už teď**
(`W3`, `type: "tool"`), aby bylo vidět, že to není volný objekt.

### B5.4 Čtení a obnova

Úplný tvar odpovědi a obou chybových případů je ve **`W3`**. Normativně zde:

- `GET /m1/runs/:id/events?afterSeq=&limit=&waitMs=`;
- **`afterSeq` je exkluzivní**; **první dotaz ho vynechá** — nepřítomnost
  znamená „od nejstarší dostupné". `afterSeq=0` **není** zvláštní hodnota;
- `waitMs` je horní mez long-pollu, ořezaná serverem; `0` znamená neblokovat;
- odpověď má **šest** polí: `events`, `nextAfterSeq`, `oldestAvailableSeq`,
  `caughtUp`, `runTerminal`, `waitTimedOut`. Bez nich znamená prázdná odpověď
  zároveň „zatím nic", „běh skončil" i „staré události jsou pryč";
- `410 event_window_gone` nese `oldestAvailableSeq` **i
  `resumeAfterSeq = oldestAvailableSeq − 1`**, protože při exkluzivním `afterSeq`
  by pokračování hodnotou `oldestAvailableSeq` nejstarší událost přeskočilo.

`RunState`: `running` | `finished` | `failed` | **`interrupted`** |
**`cancelled`** | **`timed_out`**. Poslední tři revize 1 neměla, takže přerušený
běh vypadal jako neúspěšný.

### B5.4a Vztah k `CoreEvent`

`ROADMAP` žádá, aby `RemoteCorePort` vznikal nad připnutým `CoreEvent`. Dnešek:

- **Stage.** `contracts/m1/shared.js` vede `M1_CONTRACT_STAGE = 'PROVISIONAL_V1'`.
  Je to stage **celého** kontraktu `/m1`, ne značka jednotlivého typu; `CoreEvent`
  je jedna z jeho pěti kind (`M1_CONTRACT_KIND.CORE_EVENT`). Připnout `CoreEvent`
  tedy neznamená označit jeden typ — znamená to povýšit stage celého kontraktu,
  nebo zavést pro kind samostatné stagování, které dnes neexistuje.
- **Tvar.** `validateCoreEvent` (`contracts/m1/index.js`) vyžaduje `conversationId`
  **i** `turnId` u každé události. `CoreEvent` je tím pádem konverzačně
  orientovaný **doložitelně**, ne dojmem: běh bez konverzace jím projít nemůže,
  protože by neměl čím ta dvě povinná pole vyplnit.

**Tenhle kontrakt proto nezavádí druhý konektor.** `RunEvent` je **projekce nad
`CoreEvent`**, ne paralelní proud; WP musí doložit mapování `CoreEvent` →
`RunEvent` a to, že `CoreEvent` byl kvůli tomu připnut. Kdyby projekce nešla, je
to rozhodnutí o novém konektoru a patří do samostatného kola, ne sem.

### B5.5 Redakce

`text` i `data` procházejí **redakcí na serveru**. Obecné „projde redakcí" ale
není testovatelný kontrakt, takže redakce je **allow-list, ne blacklist**:

- vydává se **jen** to, co je v allow-listu pro daný `type`;
- cokoli mimo něj se nahradí `"[redigováno]"`, ne vynechá — vynechání by mezeru
  skrylo (viz `W3`, kde je náhrada vidět uvnitř `text`);
- allow-list je součástí WP a testuje se **pozitivně i negativně**.

Agent log je jinak boční kanál kolem scopů.

### B5.6 Zakázané

**Žádné procento hotovo** (`UI-REVIEW` §3.3, `D-UI-4`) — potřebuje známý celek,
který neexistuje. Na jeho místě `RunSilence`: uplynulý čas a nic dalšího.

| | |
|---|---|
| Routy | `GET /m1/runs`, `GET /m1/runs/:id`, `GET /m1/runs/:id/events` |
| Mutace | **žádné** |
| Cache | **žádná** — průběh je o tom, co se děje teď |
| Offline | **nečitelné** |
| Obrazovka | `MS-15` — **nestaví se** |

## B6. Hledání (`MR-10`)

### B6.1 Serverové hledání je jediné, co splňuje `MR-10`

`D-S3`: kdo nenajde zprávu, nesmí z toho usoudit, že neexistuje. **`MR-10`
splňuje pouze serverové hledání.**

Revize 3 z toho udělala „hledání je serverové, nebo žádné" a současně nechala
`Offline` v tabulce jako otevřené — review to právem označilo za vnitřní rozpor.
Rozlišení, které to řeší: **„nesplňuje `MR-10`" a „je zakázané" nejsou totéž.**
Serverové hledání je jediné, co `MR-10` splňuje; lokální fallback (`B6.5`) je
označená vymoženost, která se za splnění **nevydává**.

### B6.2 Rozsah v odpovědi

Úplný tvar je ve **`W4`**. Normativně:

```
{
  query,
  scopeRequested,   // co klient chtěl
  scopeSearched,    // kde se skutečně hledalo
  scopeSkipped,     // [{domain, reason}] — a proč ne
  snapshot,         // vektor domainRevision + queryFingerprint (A3.2)
  truncated,        // našel jsem víc, než vracím — JINÝ stav než `end`
  results: [...],
  nextCursor, end
}
```

Server **nikdy nehledá tam, kam uživatel nemá scope**, a odpověď to přiznává —
proto tři pole místo jednoho. Domény: `conversations` | `projects` | `memory`.

### B6.3 `POST`, ne `GET`

Dotaz je potenciálně `S2` a v URL by skončil v historii prohlížeče a v logách;
`gateway-policy.js` na to sám v komentáři upozorňuje.

**`POST /m1/search` s tělem, sémanticky read-only.** Nemá `operationId` (A4),
protože nic nemění; je to výjimka z „POST = mutace" a je zapsaná tady, aby
nebyla objevena později jako nesrovnalost.

Dotaz má **maximální délku** a překročení je `bad_request`, `reason: query_too_long`,
ne tiché ořezání. Kurzor je vázaný na dotaz, filtry, řazení, `principal`/`deviceId`
a `snapshot` (A3) — cizí ani starý kurzor stránku nevydá.

### B6.4 Klasifikace výsledku

Výsledek nese **jen to, co uživatel smí vidět bez dalšího dotazu**: identifikátor,
titulek, kontextový úryvek, odkaz. **Nikdy celý obsah** — jinak hledání obchází
scope na detail. Úryvek prochází stejnou redakcí jako `B5.5`.

### B6.5 Offline fallback — rozhodnuto, a jeho meze jsou kontrakt

Review rozhodlo: **fallback zůstává.** Kontrakt ho proto musí popsat, jinak by
si jeho meze určila implementace.

| Pravidlo | |
|---|---|
| **Rozsah** | **jen neexpirovaná lokální cache** (`FRESH` nebo `STALE` podle `A7.2`). `EXPIRED` se neprohledává — `A7.1` ho zakazuje i zobrazit |
| **Označení** | výsledek je **viditelně** označený jako hledání v uloženém, s ukazatelem stáří nejstarší prohledané domény |
| **Zákaz** | **nikdy** nesmí tvrdit úplnost. Prázdný výsledek se hlásí jako „v uloženém nic — online se nehledalo", nikdy jako „nenalezeno" |
| **`MR-10`** | fallback **`MR-10` nesplňuje** a v `COVERAGE` se za jeho splnění nepočítá |
| **Vlastní cache** | **nevytváří ji** — hledá nad tím, co v cache leží z domén; výsledky hledání se necachují (`A7.2`) |
| **Kurzor** | fallback **nestránkuje serverovým kurzorem**; `c2` je serverová hodnota a offline pro ni není zdroj |

| | |
|---|---|
| Routa | `POST /m1/search` |
| Mutace | **žádné** (read-only `POST`) |
| Scope | `read:search` **plus** čtecí scope každé prohledávané domény |
| Cache | výsledky **necachovat**; fallback čte cache domén |
| Offline | **fallback podle `B6.5`** |
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

**13 + 13 = 26 rout.** Zdvojnásobení povrchu je samo o sobě věc k posouzení, ne
detail. Samostatná `events` routa zůstává (rozhodnutí review).

---

## 10. Testy — dvě různé věci, které si revize 3 pletla

Review si všimlo, že `§10` žádalo fixtures **před** refreeze, zatímco `§12`
říká, že testy vzniknou **až po** refreeze ve WP. Nejsou to tytéž testy.

### 10.1 Contract fixtures — **před** refreeze, jsou součástí dokumentu

Zmrazený pár požadavek/odpověď, který jde přečíst a posoudit **bez
implementace**. Nespouští se; je to normativní text.

| Stav | |
|---|---|
| Hotovo | **4 ze 13** — část W (`W1`–`W4`) |
| Chybí | 9 rout (`§0.4`) |
| Kdy | před refreeze, podle vzoru části W |

### 10.2 Conformance testy — **po** refreeze, vznikají ve WP

Spustitelné testy proti implementaci. Matice níže je jejich **zadání**, ne ony
samy. Řádek 6 je rozdělen podle bodů pádu `A4.5` — revize 3 měla v řádku 6
„každý restart ⇒ `UNKNOWN`", což si odporovalo s řádkem 17.

| # | Scénář | Očekávané |
|---|---|---|
| 1 | Doménová routa bez doménového scope | `403 scope_required` |
| 2 | Cizí `deviceId` v cestě k operaci nebo záznamu | `404`, ne cizí data (IDOR) |
| 3 | `admin` scope na doménové routě | odmítnuto — bypass neexistuje |
| 4 | Stejný `operationId`, stejný otisk | **původní** výsledek, žádný druhý efekt |
| 5 | Stejný `operationId`, jiný otisk | `409 operation_conflict` |
| 6a | Pád ve fázi `RECEIVED` | `PENDING`; opakování provede efekt **jednou** |
| 6b | Pád ve fázi `DISPATCHED`, třída `TXN` | stav je terminální — mezistav neexistuje |
| 6c | Pád ve fázi `DISPATCHED`, třída `LOOKUP` | `UNKNOWN` + reconciliation dorovná |
| 7 | Pád ve fázi `SETTLED` | lookup vrací zapsaný stav, **ne `UNKNOWN`** |
| 8 | Kurzor z jiné domény / filtru / řazení | `cursor_unknown`, `restart: true` |
| 9 | **Smazání nebo archivace** položky mezi stránkami | `snapshot_gone` — *(regrese proti `MAX()`)* |
| 10 | Vložení záznamu s `NULL` řadicím klíčem mezi stránkami | `snapshot_gone` — *(tentýž protipříklad)* |
| 11 | `afterSeq` pod retention | `410` s `oldestAvailableSeq` **i `resumeAfterSeq`** |
| 12 | Klient pokračuje od `resumeAfterSeq` | **nejstarší dostupná událost se neztratí** |
| 13 | Běh přerušen | `interrupted`, ne `failed` |
| 14 | Hledání mimo udělený scope | doména se neprohledá a `scopeSkipped` to přizná |
| 15 | Tajemství v `text` běhu nebo v úryvku | nahrazeno `[redigováno]`, ne vynecháno |
| 16 | Dry-run | **nulový** efekt v ostrých datech, `runId` v žurnálu před dispatchem |
| 17 | Funkce bez providera | `unavailable` **jen ta funkce**, ne celá doména |
| 18 | Desktop-only klíč `R-5` přes `/m1` | nedostupný ke čtení i zápisu |
| 19 | Podvržený nebo cizí `c2` kurzor | `cursor_unknown`; `c1` na v2 routě → `cursor_version_mismatch` |
| 20 | Kurzor s neznámým `keyId` | `key_rotated`, **ne** `malformed` |
| 21 | Klient nabídne jen neznámou wire verzi | `426` se `supportedProtocols`, **žádný tichý downgrade** |
| 22 | Klient nabídne `v1, v2` v tomto pořadí | vybere se **`v1`** — první nabídnutá, ne nejvyšší |
| 23 | `fingerprint` v těle mutace | `400 bad_request`, `reason: unknown_field` |
| 24 | Neautentizovaný požadavek | `principalId: null`, `scopes: []` — pole **přítomná** |
| 25 | Server pošle `cacheHint` delší než hard limit | klient použije **hard limit** |
| 26 | Offline hledání v `EXPIRED` cache | neprohledá se; výsledek se nevydává za úplný |

---

## 11. Otevřené body — co zbylo

Review revize 3 zodpovědělo `D-M5`, offline fallback, `MR-07`/`MR-20`, retention
i samostatnou `events` routu. Všechno je zapracované jako normativní text.
**Zbývají tři, a všechny jsou práce, ne rozhodnutí:**

1. **Devět zbývajících schémat** (`§0.4`, `§10.1`). Podle vzoru části W.
2. **Redakční allow-list** pro `RunEvent` (`B5.5`). Tvar je normativní, obsah je
   WP.
3. **Projekce `CoreEvent` → `RunEvent`** (`B5.4a`). Jestli nejde, je to nový
   konektor a patří do samostatného kola.

**Požadavky na backend, které kontrakt zavádí a které dnes nemají
implementaci** — vypsané zvlášť, aby se na ně nepřišlo až ve WP:

| # | Co | Kde | Dnešní stav |
|---|---|---|---|
| 1 | `m1_domain_revision` a inkrement v téže transakci | `A3.2` | neexistuje |
| 2 | Durable `phase` v žurnálu (`RECEIVED`/`DISPATCHED`/`SETTLED`) | `A4.4` | žurnál má jen stavy |
| 3 | Sweep po pádu **nesmí** metat `RECEIVED` na `UNKNOWN` | `A4.4` | dnes mete vše |
| 4 | Perzistentní `serverIdentity` vydaná při párování | `A7.3` | jen per-proces `instance_id` |
| 5 | `keyId` a rotace podpisových klíčů kurzoru | `A3.4` | neexistuje |
| 6 | Idempotentní `runId` před dispatchem dry-runu | `A4.6`, `B4.3` | neexistuje |

## 12. Pořadí po schválení

Podle `PLAN.md` §8 podmínky 2 a §5.3, v tomto pořadí:

1. `APPROVED` — schválený návrh. **Neautorizuje nic.**
2. **Gate 1 evidence pro `C3-002` a `C3-023`.**
3. `REFROZEN` v2.
4. Per fázi: příslušná Gate 1 závislost + **vlastní Work Package**.
5. Teprve pak routa, obrazovka, conformance testy (`§10.2`).

Zamýšlené pořadí fází: **2 nastavení → 3B projekty → 4 paměť → 5 workeři.**
Domény 5 a 6 v něm **nefigurují** — rozhodnutí je zařadilo do kola, ne do fronty.
