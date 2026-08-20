# WP-APPROVAL-PLANE — co bylo uděláno

**Typ:** záznam výsledku · **Zadání:** operátorská rozhodnutí 2026-08-19 (viz §1)
**Vstupní revision:** `5c5413e4` · **Výstupní revision:** `25c61a96` (12 commitů)
**Větev:** `wp/mobile-prototype-20260817`
**Navazující zadání:** [`docs/execution/approval-mediation.md`](../execution/approval-mediation.md)

> **Pozor — výklad opraven 2026-08-20.** Tenhle balík stavěl approval jako
> **mýtné před každým zápisem**. [`Rozhodnutí 028`](../decisions/028-approval-is-exceptional.md)
> to opravuje: auto-approve je default, approval je výjimka pro pojmenované
> situace. Co je v §2 níž popsané jako hotové, **funguje** — jen se toho má
> ptát podstatně méně často. Rozsah v §5.3 se tím zmenšuje.
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
| `07b15675` | migrace 064 do ručního orákula |
| `05fcc5f6` | dva telefony nad jednou frontou |
| `70682968` | rozhodovací plocha `/approvals-ui` |
| `6e948d6e` | srovnání dokumentace + protokol device matice |
| `86cedaa2` | **P0 balík** A1–A4 |
| `d797d0a0` | fixtury fs sad mimo `fs.write` |
| `25c61a96` | **P0-closeout** — orphaned, `fs.write` signál, `turnId` |

49 souborů, +3696 / −197.

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

### 5.1 Otevřené `P1` nálezy z review

1. **Atomická náhrada ničí práva souboru.** `commitFile` vytváří temp bez
   převzetí režimu cíle — sonda přepsala `0755` na `0664` a skript přestal být
   spustitelný. Chybí i `fsync` a bezpečně unikátní jméno temp souboru.
   → `src/executor/atomic-write.js`
2. **Boot cleanup zaměňuje „jiný proces" za „mrtvý proces".** Komentář slibuje,
   že se dva procesy navzájem neuklízejí, SQL ale uzavře všechno s jiným
   `boot_id`. Sonda potvrdila, že proces B zruší **živý** approval i zámek
   procesu A. Chce to lease/heartbeat, nebo vynucený singleton nad databází.
   → `src/approvals/authority.js`, `src/executor/file-lock.js`
3. **Multi-device nedodává slíbený terminální výsledek.** Druhý telefon dostane
   `409` jen s rozhodnutím, bez `decidedAt` a `decidedBy`; závodní větev nedodá
   ani rozhodnutí. Test to obchází čtením z DB, takže nedokazuje dokumentované
   „co, kdy a kdo". → `src/mobile/handlers.js`, `MULTI-DEVICE.md`
4. **Klient nerozliší `invalidated`/`cancelled` od lidského zamítnutí.**

### 5.2 `P0-3` fyzická device matice — `NOT RUN`

Protokol a záznamový list jsou hotové v
[`DEVICE-MATRIX-RUN.md`](DEVICE-MATRIX-RUN.md) včetně doslovných kroků pro řádky
3, 4, 5, 9, 10 a 12. Chybí jediné: telefon a někdo, kdo to odklikne. Emulátor
biometrii, Doze ani odpojení kabelu za běhu nereprodukuje.

### 5.3 Sdílená cesta pro zbylé zapisovatele — neotevřená

**Ne approval — zámek, atomický zápis a záznam** (`028` §4.3). Patch engine ani
skill write se ptát nemají; potřebují infrastrukturu, ne otázku.

Řízená cesta pokrývá **dvě** cesty. Změřeno na `25c61a96`:

| Kategorie | Soubory | Poznámka |
|---|---|---|
| **Přes sdílenou cestu** | `patch/patch-engine.js`, `skills/steps/write.js`, `planner/code-cleaner.js`, `planner/lifecycle-build.js`, `chat/handlers/utils/readme-generator.js`, `domains/scaffolds/*`, zbylých 9 zápisů v `tools/registry.js` | agentem generované změny uživatelských souborů |
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
