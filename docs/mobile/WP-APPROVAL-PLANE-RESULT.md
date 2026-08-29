# WP-APPROVAL-PLANE — co bylo uděláno

**Typ:** záznam výsledku · **Zadání:** operátorská rozhodnutí 2026-08-19 (viz §1)
**Vstupní revision:** `5c5413e4` · **Výstupní revision:** `f5289d2e` (25 commitů)
**Etapy:** `5c5413e4`→`25c61a96` approval rovina · `25c61a96`→`f5289d2e` oprava
výkladu a `M1` (§7)
**Review:** [`p0-closeout-review.md`](../execution/p0-closeout-review.md) — zadání
pro nezávislé posouzení; verdikt zatím není
**Větev:** `wp/mobile-prototype-20260817`
**Navazující zadání:** [`docs/execution/approval-mediation.md`](../execution/approval-mediation.md)

> **Výklad opraven a kód srovnán 2026-08-20.** Tenhle balík stavěl approval
> jako **mýtné před každým zápisem**;
> [`rozhodnutí 028`](../decisions/028-approval-is-exceptional.md) to opravilo
> a §7 níž popisuje, čím. Auto-approve je dnes výchozí stav.
>
> **Co tenhle dokument je.** Záznam implementace s důkazem na konkrétních SHA.
> **Není to review verdikt.** Poslední review skončilo `CHANGES_REQUIRED` se
> dvěma `P0` blokátory; ty jsou opravené v `25c61a96`, ale **přijetí je akt
> review autority, ne tohohle dokumentu.** Čtyři `P1` nálezy zůstávají otevřené
> a jsou vyjmenované v §5.

---

## 1. Co operátor rozhodl

Tři rozhodnutí z 2026-08-19, která tenhle balík provádí:

1. **Praktická síla slibu**, ne silná. Silná varianta (žádný externí zapisovatel
   nikdy nepřepíše stav) by znamenala mediační vrstvu pro **všechny**
   zapisovatele — CAS nebo verzované úložiště, kterým by musel projít i editor
   a `git checkout`. Znovu se otevře při reálných kolizích, na síťovém
   filesystemu nebo při víc nezávislých editorech.
2. **S1 slovník** — nahradit jedinou zastaralou dvojici.
3. **Boundary ratchet** — schválené směry závislostí, odmítnuté pojmenování
   sdíleného jádra jako `src/mobile`.

Plus, po prvním review: **P0 balík A1–A4**, s tím že režim `lock` (databáze bez
producenta) je také fail-closed. Mediace ostatních zapisovatelů se **neotvírá**.

---

## 2. Co teď platí — a jak přesně to zní

> Zápisy uživatelských souborů **v cestě `FILE_WRITE` a nástroje `fs.write`**
> jdou přes jednu řízenou cestu. Dva běhy si nepřepíšou stejný kanonický cíl.
> Externí změna zápis zastaví, pokud je viditelná při poslední kontrole.
> Mikrointerval mezi kontrolou a atomickou náhradou souboru není pokrytý.
>
> **Ptá se jen tam, kde to říká politika** (`028`) — jinak zapisuje. Zámek,
> kanonizace, fencing i atomická náhrada platí i pro zápis bez otázky.

**Rozsah je v té větě schválně.** „Všechny zápisy" **není pravda** — viz §5.3.

| Vlastnost | Kde | Důkaz |
|---|---|---|
| Zápis se ptá a čeká | `src/executor/effects.js` → `guarded-write.js` | `effects-guarded-path` 13 PASS |
| Fail-closed bez roviny | `effects.js` — zapisuje **jen** `approval` | `effects-p0-regressions` A4 ×3 |
| Zrušení zastaví efekt | controller → handler/nástroj → `writeUserFile` | A1 + C1 |
| Timeout zastaví efekt | `executeWithTimeout` abortuje a **čeká** | A2 |
| Osiřelý efekt ≠ timeout | `ToolErrorCode.EFFECT_ORPHANED` | C2 ×2 |
| Jeden tah = jeden běh | `controller.js` razí `turnId` | A3 ×2, C3 ×2 |
| Zámek nepustí souběh | `acquireFileLock` odmítá i vlastní běh | `file-write-lock` 17 PASS |
| Atomická náhrada | `atomic-write.js` — temp + `rename` | `guarded-write` 15 PASS |

**Zapíná to `src/server.js`** — `createCompanionProducer` + `configureEffects` +
`setApprovalDeps` + úklid po restartu. Do 2026-08-19 neměl `setApprovalDeps`
v celém repu volajícího, takže trvalé approvaly v IDE byly mrtvý kód.

### `timeout` vs. `orphaned`

| | `timeout` | `orphaned` |
|---|---|---|
| Co víme | efekt **neproběhl** | **nevíme**, jestli proběhl |
| `retryable` | ano | **ne, nikdy** |
| Na telefonu | `run.failed` | `run.unknown` — „Stav běhu není jistý" |

Zopakovat efekt, o kterém nevíme, jestli proběhl, je nejrychlejší cesta k tomu,
aby proběhl dvakrát. Proto `orphaned` nespustí auto-retry a **nespadne ani do
LLM fallbacku**, který by ho zakryl klidnou větou.

---

## 3. Commity

| SHA | Co |
|---|---|
| `df4e96e3` | autorita mimo `src/mobile` → `src/approvals/{authority,fingerprint}.js` |
| `9f0cb4f6` | produkční zápis přes `guardedWrite`; `server.js` to zapíná |
| `f9bc0c94` | cancel, vlastnictví, idempotence, lifecycle, restart, S1 slovník |
| `3dc67e06` | kanonizace přes předka, lease přes commit, lease-takeover test |
| `85d98215` | rebaseline ratchetu (1048 → 1077) |
| `07b15675` | `2026_08_19_064_boot_identity` do ručního orákula migrací |
| `05fcc5f6` | dva telefony nad jednou frontou |
| `70682968` | rozhodovací plocha `/approvals-ui` |
| `6e948d6e` | srovnání dokumentace + protokol device matice |
| `86cedaa2` | **P0 balík** A1–A4 |
| `d797d0a0` | fixtury fs sad mimo `fs.write` |
| `25c61a96` | **P0-closeout** — orphaned, `fs.write` signál, `turnId` |

49 souborů, +3696 / −197.

> Migrace `064` je tu schválně **plnou verzí**, ne číslem. Sahá na
> `mobile_approvals` i `file_write_locks`, takže není čistě mobilní a nemá
> mobilní jméno; `mobile-migration-parity` proto holé číslo na mobilním povrchu
> odmítá — a má pravdu, protože po přečíslování by ukazovalo jinam.

---

## 4. Testy

**Nové:** `effects-p0-regressions` (15), `effects-guarded-path` (13),
`approval-lifecycle` (10), `multi-device-approvals` (8),
`desktop-approval-ui` (11).

**Změněné:** `guarded-write` (13 → 15), `file-write-lock` (15 → 17),
`tool-registry-e2e`, `capability-02` (C-15 přeformulován), `ide-durable-approval`,
`harness-exit-code`, `schema-migrations`, `mobile-companion-producer`,
`mobile-approval-authority`, `desktop-approval-surface`.

**Ověřená citlivost.** `effects-p0-regressions` se pustil proti `6e948d6e`
(předchozí commit) a výsledek je zapsaný v hlavičce té sady:

- jednotkové `A1` a `A2` prošly **i před opravou** — `guardedWrite` zrušení
  respektoval vždycky. Vada byla ve **volacím místě**, ne v jednotce;
- `A4` ×3 a `A3` se stejným `runId` před opravou **selžou**;
- `A1` přes handler a `A2` přes nástroj před opravou **zůstanou viset** — proto
  mají lhůtu (`withDeadline`): visící sada vypadá jako rozbitá infrastruktura,
  ne jako nález.

**Gate 2026-08-19:** `251 PASS / 4 FAIL / 3 BLOCKED` → celkově **FAIL**.
Mobilní gate `36/36` PASS, 1 withheld. Ratchet PASS (1075/1077).
Artifact validation 151/151.

Čtyři `FAIL` jsou **předchozí**, ověřené spuštěním na `5c5413e4`:

| Sada | Proč |
|---|---|
| `m1-model-failover-schema` | pinuje seznam migrací k `054`, rozbité od `055` |
| `nightly-orchestrator-self-test` | 3 `BLOCKED` řádky v registru mají `required: true` |
| `vram-coordination` | GPU/prostředí (`computeNumCtx` 8192 vs 4096) |
| `nightly-audit-runner-self-test` | čeká blocker `toolchain:x11-display:invalid-xauthority`, uvnitř auditu se nevyrobí |

---

## 5. Co **ne**platí

### 5.1 `P1` nálezy z review — **všechny čtyři vyřešené**

1. ~~**Atomická náhrada ničí práva souboru.**~~ **Vyřešeno** `70ce191f` —
   režim cíle se přebírá, přidán `fsync` na soubor i adresář, temp jméno je
   `randomUUID()`. Tři testy v `effects-p0-regressions`.
2. ~~**Boot cleanup zaměňuje „jiný proces" za „mrtvý proces".**~~ **Vyřešeno**
   `6eb855fc` — zavedeny process leases s tepem (migrace
   `2026_08_21_065_process_leases`). Úklid se ptá na tep, ne na odlišnost, takže
   je bezpečný bez ohledu na to, kdo ho zavolá. Šest testů
   v `approval-lifecycle`.

3. ~~**Multi-device nedodává slíbený terminální výsledek.**~~ **Vyřešeno** —
   obě konfliktní větve vracejí `decision`, `state`, `decidedAt` a `decidedBy`;
   `race_lost` si řádek přečte znovu, protože rozhodl někdo jiný právě teď.
   Testy čtou **z odpovědi**, ne z databáze — klient ji nevidí.

4. ~~**Klient nerozliší `invalidated`/`cancelled` od lidského zamítnutí.**~~
   **Vyřešeno** — mobil i `/approvals-ui` mají čtyři konce místo dvou a u obou
   neosobních výslovně říkají „nikdo to nezamítl". Mobilní klient dřív vykresloval
   `decision === 'approve' ? 'schválen' : 'zamítnut'`, takže propadlý approval
   tvrdil rozhodnutí člověka, které nikdo neudělal.

   Test u toho našel vadu navíc: hláška na desktopu byla přilepená na položku
   fronty, kterou `refresh()` nahradí — uživatel ji viděl řádově milisekundy.
   Drží se teď stranou od dat a přežije obnovení.

### 5.2 `P0-3` fyzická device matice — `NOT RUN`

Protokol a záznamový list jsou hotové v
[`DEVICE-MATRIX-RUN.md`](DEVICE-MATRIX-RUN.md) včetně doslovných kroků pro řádky
3, 4, 5, 9, 10 a 12. Chybí jediné: telefon a někdo, kdo to odklikne. Emulátor
biometrii, Doze ani odpojení kabelu za běhu nereprodukuje.

### 5.3 Sdílená cesta pro zbylé zapisovatele — otevřená, první převeden

**Ne approval — zámek, atomický zápis a záznam** (`028` §4.3). Patch engine ani
skill write se ptát nemají; potřebují infrastrukturu, ne otázku.

**Patch engine je od 2026-08-21 převedený** (`M2-1`). `applyPatch`
i `rollbackPatch` jdou přes `writeUserFile`; `runId` a `signal` se předávají
z volacího místa (`lifecycle-build` → `runFixLoop` → `applyPatchSet`) a sada
`patch-engine-shared-write` to ověřuje **z volacího místa**, ne z jednotky. Její
citlivost je změřená proti `f5289d2e`: 12 ze 13 testů tam selže; třináctý je
označená pozitivní kontrola.

Řízená cesta pokrývá **tři** cesty. Zbytek změřený na `25c61a96`:

| Kategorie | Soubory | Poznámka |
|---|---|---|
| **Přes sdílenou cestu** | ✅ `patch/patch-engine.js` · zbývá: `skills/steps/write.js`, `planner/code-cleaner.js`, `planner/lifecycle-build.js`, `chat/handlers/utils/readme-generator.js`, `domains/scaffolds/*`, zbylých 9 zápisů v `tools/registry.js` | agentem generované změny uživatelských souborů |
| **Vlastní autorita** | `routes/projects.js` (14 zápisů) | explicitní uživatelský file-manager — approval na každé uložení by byl nesmysl |
| **Mimo** | `server-port-file`, `core/db-backup`, `core/history-drain`, `media/output-storage`, `packaging/auto-updater`, `marketplace/package-installer` | infrastruktura píšící do vlastních dat |

Zadání je v [`docs/execution/approval-mediation.md`](../execution/approval-mediation.md).

### 5.4 Pilotní seznam (`P1`), kterého se balík nedotkl

Reprodukovatelný build z čistého klonu · klíčová ceremonie a rotace (výměna
klíče = hromadné re-pairing) · revokace jako ověřený tok · trvalé spojení
a měření baterie 24 h · šifrování cache klienta · TalkBack na zařízení ·
Capacitor 6 mimo podporu. Dál: push (`N-1`) a celý `P2` vzdálený model.

---

## 6. Poznámka k procesu

Tentýž tvar vady se v tomhle balíku objevil **třikrát**: oprava byla v jedné
cestě a slib mluvil o dvou. Pokaždé existoval zelený test, který to nechytil,
protože testoval jednotku.

**Pravidlo, které z toho plyne:** u nové vlastnosti se ptát „kolik cest ji má
mít", ne „funguje ta jedna". Zelený test jednotky nedokazuje, že k ní cesta
vede.


---

## 7. Pokračování 2026-08-20 — oprava výkladu

Balík výš stavěl approval jako **mýtné před každým zápisem**. Operátor to
odmítl:

> „rozhodně není cílem abych povoloval každý zápis do souboru"

Nebyla to vada kódu — kód dělal, co bylo zadané — ale **vada zadání**.
Zaznamenaná v [`rozhodnutí 028`](../decisions/028-approval-is-exceptional.md).

| SHA | Co |
|---|---|
| `a2391fcd` | tenhle záznam + zadání pro pokračování |
| `ac3c7f6c` | upřesnění rozsahu `M1-b` (úklid volá jen `server.js`) |
| `790a9329` | **rozhodnutí 028** — approval je výjimka |
| `70ce191f` | **`M1-a`** — práva souboru, `fsync`, unikátní temp |
| `e9c7e4e6` | odkaz na migraci plnou verzí (`mobile-migration-parity`) |
| `19023a60` | **`M0`** — politika: ptá se jen na to, co je vyjmenované |
| `076a5ac4` | rebaseline ratchetu (1 hrana přibyla, 1 ubyla) |
| `6eb855fc` | **`M1-b`** — process leases, úklid rozlišuje mrtvý od cizího |
| `0a21b6ac` | **`M1-c`** — konfliktní větve nesou co, kdy a kdo |
| `e92291d4` | **`M1-d`** — propadlý ≠ zamítnutý člověkem, na obou plochách |
| `f5289d2e` | oprava: `orphaned` neprošel kontraktem `M1` (§7.5) |

### 7.1 Politika

`src/executor/write-policy.js` — **jedno čitelné místo**, protože seznam, který
se dá přečíst za minutu, se dá taky odsouhlasit.

| Kategorie | Chování |
|---|---|
| `secrets` — `.env*`, `*.pem`, `*.key`, `id_rsa`, keystore, credentials | **ptá se** |
| `ci-deploy` — workflows, Dockerfile, compose, fly/vercel | **ptá se** |
| `applied-migration` — přepis migrace, která už proběhla | **ptá se** |
| `.git/` | **odmítá** bez ptaní |
| všechno ostatní | zapíše |

Pravidlo, podle kterého seznam vznikl (operátor, 2026-08-20): *ptát se tam, kde
je frekvence blízká nule a důsledek sahá mimo to, co jde snadno vrátit.*

**Manifesty (`package.json`) v seznamu nejsou schválně.** Agent je při stavbě
mění běžně, takže by se to ozývalo pořád — a zajímavá otázka je stejně „smím
nainstalovat tenhle balík", ne „smím editovat manifest". To je jiná páka
a patří k instalaci.

**Nová migrace se neptá, přepis aplikované ano.** Nová je rutinní práce na
schématu; přepsat tu, která už běžela, znamená rozejít databázi s tím, co kód
tvrdí.

### 7.2 Co se u toho našlo

- **Politika měla vadu, kterou našel test.** Pravidla ukotvená na začátek
  řetězce neplatila pro cíl mimo pracovní strom, kde `canonicalTarget` vrací
  absolutní cestu — `/tmp/x/.github/workflows/deploy.yml` by prošlo bez ptaní.
  Ukotveno na hranici segmentu.
- **Chatový handler má vlastní, tvrdší seznam.** `.env` tam neprojde vůbec
  (`forbidden_file`) — neptá se, odmítne. Ponecháno: na secret je to správná
  odpověď. Pravidlo `secrets` se proto reálně uplatní hlavně na nástrojové
  cestě a později u dalších zapisovatelů.

### 7.3 Testy a gate

`tests/write-policy.test.js` (11 PASS). Nejostřejší tvrzení je **negativní**:
deset běžných zápisů za sebou vyrobí **nula** approvalů.

`effects-p0-regressions` 15 → **18 PASS** (tři pro `M1-a`).

Gate 2026-08-20: **`252 PASS / 4 FAIL / 3 BLOCKED`**, ratchet PASS (1077/1077),
artifact-validation 151/151. Čtyři `FAIL` jsou ty předchozí ze §4.

### 7.4 Dvě opravená vlastní tvrzení

- *„patch engine musí přes approval"* — ne. Zaměněná **efektová autorita** za
  **ptaní se člověka**. Patch engine potřebuje zámek a atomicitu, ne otázku.
- *„projekty a specialisté na mobilu neexistují"* — nepravda. Jsou rozhodnuté,
  `Projekty` jsou v `NAV_ITEMS` jako `locked`, `MR-14` je
  `BLOCKED_BY_CONTRACT_AND_GATE1`, `MS-12` vyspecifikovaná a nestaví se.
  **Zablokovaná fronta, ne chybějící nápad.**


---

## 7.5 Oprava: `orphaned` neprošel kontraktem

**Nález review 2026-08-21, potvrzený reprodukcí.** P0-closeout posílal
`status: 'orphaned'` v terminálním rámci `m1`. Jenže `M1_TERMINAL_STATUS`
(`contracts/m1/shared.js`) je **zmrazený** na `ok | cancelled | timeout | error`
a `classifyTerminal` cokoli jiného odmítne jako `terminal:invalid-status`.

Rámec tedy **neprošel validací** a osiřelý běh spadl do obecné chybové cesty —
přesná informace o stavu se ztratila. Tvrzení z commitu `25c61a96`, že
„`TERMINAL_S1` to mapuje na `run.unknown`", bylo **nepravdivé**.

### Byl to týž omyl potřetí

Ověřil jsem mapovací tabulku (`TERMINAL_S1` skutečně posílá neznámé hodnoty na
`run.unknown`) a **neověřil jsem, že se rámec vůbec odešle**. Stejná chyba jako
„test jednotky neprokazuje cestu" — jen o patro výš.

Chybějící strážce je doplněný: `tests/effects-p0-regressions.test.js` `C4`
ověřuje, že vyzařovaný rámec projde `validateConversationResult`.

### A druhá nepravda ve stejné větě

`projectCoreEvent` v `companion-producer.js` **nemá v `src/` žádného
volajícího**. Projekce běhů na telefon (`run.ok` / `run.failed` / `run.unknown`)
tedy není zapojená vůbec — ani pro úspěšné běhy. Věta o tom, co „telefon uvidí",
byla nepravdivá dvakrát.

### Co platí teď

Posílá se `status: 'error'` s kódem `EFFECT_ORPHANED` a větou, která říká, že
není jisté, jestli operace proběhla. Z platných hodnot je `error` nejméně
nepřesná:

| | znamená | vhodnost |
|---|---|---|
| `ok` | proběhlo v pořádku | **lež** |
| `timeout` | lhůta vypršela, **nestalo se nic** | **nebezpečné** — přesně ta domněnka, které má osiřelý stav zabránit |
| `cancelled` | někdo to zrušil | nepřesné, nikdo nic nerušil |
| `error` | neproběhlo v pořádku, podívej se | **nejméně nepřesné** |

`error` vyžaduje chybový objekt a zakazuje `response`, takže text jde
v `message`. Informace se neztrácí, jen jde kanálem, kam se klient pro tenhle
stav dívá.

### Mezera v kontraktu — pojmenovaná, ne obejitá

**`M1` nemá pro „nevím" slovo.** To je skutečná mezera a patří do rozšíření
kontraktu (`CONTRACT-V2-PROPOSAL.md`), ne do jednostranného rozšíření zmrazeného
enumu. `DR-008` autorizuje návrh → review → refreeze; propašovat hodnotu mimo
ten postup je přesně to, co `terminal:invalid-status` chytil.

Dokud to slovo nevznikne, zbývá nepřesnost: klient uvidí „chyba" tam, kde
pravdivé je „nevím". Chatová odpověď to říká přesně („Stav operace není
jistý…"), takže uživatel, který čte konverzaci, se nesplete.