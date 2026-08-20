# Zadání — mediace zápisů přes efektovou autoritu

**Určeno pro:** jednu novou agentní relaci (jedno zapisující vlastnictví)
**Větev:** `wp/mobile-prototype-20260817`
**Vstupní revision:** `25c61a96`
**Worktree:** `/home/belphareon/worktrees/is-mobile-prototype`
**Předchozí balík:** [`docs/mobile/WP-APPROVAL-PLANE-RESULT.md`](../mobile/WP-APPROVAL-PLANE-RESULT.md)

---

## 0. Než začneš

```bash
cd /home/belphareon/worktrees/is-mobile-prototype
git log --oneline -1          # musí být 25c61a96
ls node_modules | wc -l       # když 0 → npm ci --offline
```

**Worktree byl 2026-08-20 externě smazaný a obnovený.** Commity byly celou dobu
v bare repu, ale `node_modules` je po obnovení prázdné. Prázdné `node_modules`
vypadá jako regrese (`better-sqlite3` chybí) — není to regrese, je to chybějící
instalace.

**Hygiena gate** (jinak výsledek nic neznamená):

- **neupravuj strom, dokud gate běží** — runner kontroluje čistotu gitu
  u každé suity a špinavý strom hlásí jako `FAIL` s `exit 0`;
- **před gatem smaž `.intentsmith-artifacts/direct-tests/`** — každé ruční
  `node tests/…` tam nechá běhový adresář a `harness-exit-code` pod
  `C3_AUDIT_RUN=1` vyžaduje prázdno. Je gitignorovaný, takže `git status` mlčí;
- **srovnání proti base commitu dělej přes `git worktree add`**, nikdy
  `checkout` + `stash` — ta kombinace strom rozbije a oprava vyžaduje
  `git reset --hard`.

**Trvale červené sady** (ověřeno na `5c5413e4`, nesouvisí s touhle prací):
`m1-model-failover-schema`, `nightly-orchestrator-self-test`,
`vram-coordination`, `nightly-audit-runner-self-test`. Plus 3 `BLOCKED`.
Výchozí stav gate je tedy `251 PASS / 4 FAIL / 3 BLOCKED`. **Nesnaž se je
opravit** — nejsou v rozsahu.

---

## 1. Co už platí (nepředělávat)

Zápis v cestě `FILE_WRITE` a nástroje `fs.write` jde přes
`src/executor/effects.js` → `guardedWrite`. Fail-closed: zapisuje jen režim
`approval`. Zrušení i timeout efekt **zastaví**; osiřelý efekt je
`EFFECT_ORPHANED`, nikdy `retryable`, a na telefonu `run.unknown`.

Detaily a důkazy: [`WP-APPROVAL-PLANE-RESULT.md`](../mobile/WP-APPROVAL-PLANE-RESULT.md) §2.

---

## 2. Pořadí (reviewerovo, dodržet)

> „Nejprve zpevnit atomický zápis a boot lease, následně převést patch engine,
> skill write a lifecycle/code-cleaner. Infrastrukturní zápisy a uživatelský
> file-manager musí zůstat oddělené autority, ne dostávat mobilní approval na
> každé uložení."

Fáze **M1** a **M2** jdou sériově. M1 je menší a M2 na něm stojí — až budou
zápisy chodit přes jednu cestu, bude případná vada v `commitFile` bolet všude.

---

## 3. Fáze M1 — spolehlivost (otevřené `P1`)

### M1-a Atomický zápis zachová práva

`src/executor/atomic-write.js`

**Vada:** `commitFile` vyrobí temp soubor s výchozími právy a přejmenuje ho přes
cíl. Sonda review přepsala `0755` na `0664` — skript přestal být spustitelný.

**Udělat:**
- převzít režim existujícího cíle (`stat` → `chmod` na temp před `rename`);
  u neexistujícího cíle nechat výchozí umask;
- **`fsync`** na temp soubor před `rename` a na adresář po něm — bez toho může
  `rename` přežít pád, ale obsah ne;
- jméno temp souboru **bezpečně unikátní** — dnes `pid + Date.now()`, což se dá
  ve dvou procesech ve stejné milisekundě trefit. Použij `randomUUID()`.

**Test:** soubor `0755` po schváleném přepsání zůstane `0755`; po pádu mezi
zápisem a `rename` zůstane starý obsah celý.

### M1-b Boot cleanup nesmí rušit živé procesy

`src/approvals/authority.js` (`reapApprovalsFromPreviousBoot`),
`src/executor/file-lock.js` (`releaseStaleLocks`)

**Vada:** komentář slibuje, že se dva procesy navzájem neuklízejí, ale SQL
uzavře **všechno** s jiným `boot_id`. Sonda potvrdila, že proces B zruší živý
approval i zámek procesu A. Gateway přitom běží jako vlastní proces nad touž
databází.

**Udělat** — jedno z dvojího, rozhodni a **napiš proč**:
- **lease/heartbeat**: tabulka živých bootů s `last_seen`, úklid sebere jen ty,
  co nedýchají déle než N; nebo
- **vynucený singleton** nad databází (advisory lock), a úklid pak smí být
  bezpodmínečný, protože druhý zapisovatel nemůže existovat.

**Test:** proces A drží živý approval a zámek → úklid jménem procesu B se jich
**nedotkne**; po skutečně mrtvém bootu se sebere obojí.

### M1-c Multi-device terminální výsledek

`src/mobile/handlers.js` (`handleApprovalDecide`), `docs/mobile/MULTI-DEVICE.md`

**Vada:** druhý telefon dostane `409` jen s rozhodnutím, bez `decidedAt`
a `decidedBy`; závodní větev (`race_lost`) nedodá ani rozhodnutí. Dokument
přitom slibuje „co, kdy a kdo". Test to obchází čtením z DB — je slabý a je
potřeba ho zpřísnit, ne jen kód opravit.

**Udělat:** obě konfliktní větve vracejí efektivní `decision` + `decidedAt` +
`decidedBy`. Test musí číst **z odpovědi**, ne z databáze.

### M1-d Klient rozliší konce

Mobil i `/approvals-ui` musí `invalidated` a `cancelled` ukázat jinak než lidské
zamítnutí. Autorita to rozlišuje (`decisionState`), plochy zatím ne všude.

---

## 4. Fáze M2 — převést zapisovatele

**Pravidlo rozdělení** (reviewerovo, nezjednodušovat):

| Kategorie | Cesta |
|---|---|
| agentem generované změny uživatelských souborů | **přes efektovou autoritu** |
| explicitní uživatelský file-manager (`routes/projects.js`, 14 zápisů) | **vlastní autorita** — approval na každé uložení je nesmysl |
| infrastruktura píšící do vlastních dat | **mimo** — `server-port-file`, `core/db-backup`, `core/history-drain`, `media/output-storage`, `packaging/auto-updater`, `marketplace/package-installer` |

**Převést v tomhle pořadí** (od nejrizikovějšího):

1. `src/patch/patch-engine.js` — hlavní cesta BUILD smyčky, dnes vlastní
   temp+rename i vlastní backup/revert. Pozor: má revert, který musí zůstat
   konzistentní s tím, že zápis nemusí nastat.
2. `src/skills/steps/write.js` — skill write step.
3. `src/planner/code-cleaner.js`, `src/planner/lifecycle-build.js`.
4. `src/chat/handlers/utils/readme-generator.js`, `src/domains/scaffolds/*`.
5. zbylých 9 zápisových nástrojů v `src/tools/registry.js`.

**U každého:**
- `runId` musí být **identita tahu/efektu**, ne relace (viz `A3`);
- `signal` se musí předat (viz `A1`/`C1`) — a ověř to **na volacím místě**,
  ne jen na jednotce;
- výsledek se pojmenuje: nezapsáno ≠ chyba ≠ osiřelo;
- fail-closed se nesmí obejít.

**Rozsah slibu se rozšiřuje až s kódem.** V `src/executor/effects.js` §12
a v handbooku §P0-2 je věta se seznamem pokrytých cest — přepiš ji **až** když
to bude pravda, a ani o řádek dřív.

---

## 5. Definice hotového

- každý převedený zapisovatel má regresní test, který dokazuje, že
  **volací místo** předává `signal` i `runId` (ne jen že jednotka funguje);
- `commitFile` zachová práva a přežije pád bez poloviny souboru;
- úklid při startu se nedotkne živého procesu;
- druhý telefon dostane `decision` + `decidedAt` + `decidedBy` z odpovědi;
- gate je zpátky na `251 PASS / 4 FAIL / 3 BLOCKED` (žádná nová chyba),
  ratchet PASS, mobilní gate `36/36`;
- počty v `README.md` (řádky 10–11), `SYSTEM-MAP.md` (řádek 146) a census
  v `harness-exit-code.test.js` sedí — po přidání sad je **přepočítej**,
  nedopisuj odhadem;
- `WP-APPROVAL-PLANE-RESULT.md` §5.3 se aktualizuje o to, co už je hotové.

---

## 6. Co **ne**dělat

- neopravovat čtyři trvale červené sady;
- nerozšiřovat slib v dokumentaci před kódem;
- nedávat approval infrastrukturním zápisům ani file-manageru;
- neotvírat silnou variantu slibu (mediace pro všechny zapisovatele včetně
  editoru) — to je samostatné rozhodnutí operátora;
- fyzickou device matici (`P0-3`) neřešit tady; má vlastní protokol
  a potřebuje telefon.
