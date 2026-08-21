# Zadání — sdílená cesta pro zápis a politika, kdy se ptát

> **Přepsáno 2026-08-20 podle [`rozhodnutí 028`](../decisions/028-approval-is-exceptional.md).**
> Předchozí verze chtěla protáhnout všechny zapisovatele přes **approval**. To
> byl overkill: approval je výjimka, ne mýtné. Zapisovatelé dostanou sdílenou
> cestu (zámek, atomický zápis, záznam) **bez ptaní**; ptá se jen politika,
> a to ve třech pojmenovaných situacích.

**Určeno pro:** jednu novou agentní relaci (jedno zapisující vlastnictví)
**Větev:** `wp/mobile-prototype-20260817`
**Vstupní revision:** `076a5ac4`
**Worktree:** `/home/belphareon/worktrees/is-mobile-prototype`
**Předchozí balík:** [`docs/mobile/WP-APPROVAL-PLANE-RESULT.md`](../mobile/WP-APPROVAL-PLANE-RESULT.md)

---

## 0.0 Stav — co je hotové a co ne

| Fáze | Stav |
|---|---|
| **M0** politika (auto-approve default) | ✅ `19023a60` |
| **M1-a** práva souboru, `fsync`, unikátní temp | ✅ `70ce191f` |
| **M1-b** boot lease | ✅ `6eb855fc` |
| **M1-c** multi-device terminální výsledek | ⬜ **začni tímhle** |
| **M1-d** klient rozliší konce | ⬜ |
| **M2** sdílená cesta pro zbylé zapisovatele | ⬜ |

**Než otevřeš M2, nech P0 closeout projít review.** Poslední verdikt byl
`CHANGES_REQUIRED`, oba blokátory jsou opravené v `25c61a96`, ale nikdo to od té
doby neviděl. M2 je velký balík a stavět ho na nepotvrzeném základu je
nejlevnější cesta k přepracování. M1 na tom nestojí — ty opravy platí samostatně.

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

## 2. Pořadí

Reviewerovo pořadí platí — „nejprve zpevnit atomický zápis a boot lease,
následně převést patch engine, skill write a lifecycle/code-cleaner" — jen se
mění, **co** ten převod znamená. Ne approval, ale zámek + atomicita + záznam.

Fáze **M1** a **M2** jdou sériově. M1 je menší a M2 na něm stojí — až budou
zápisy chodit přes jednu cestu, bude případná vada v `commitFile` bolet všude.

**Nová fáze M0** jde před obojím, protože bez ní je produkt nepoužitelný:
otočit výchozí stav na auto-approve.

---

## 2.1 Fáze M0 — approval přestane být mýtné · ✅ **HOTOVO**

> Doděláno 2026-08-20. `src/executor/write-policy.js` + `guardedWrite({ approval:
> 'auto' })`. Seznam citlivých kategorií odsouhlasil operátor. Zbytek téhle
> sekce je popis toho, co se udělalo — ne úkol.

`src/executor/effects.js`

**Vada:** v režimu `approval` se `writeUserFile` ptá na **každý** zápis. BUILD
smyčka s třiceti patchi = třicet ťuknutí. Vrstva, která se ozve pokaždé, je
z pohledu uživatele k nerozeznání od rozbité.

**Udělat:**
- zavést místo, kde se **politika** rozhodne, jestli tenhle zápis potřebuje
  člověka. Bez pravidla → **zapisuje se** (auto-approve je default);
- první a jediné pravidlo zatím: **důležitý soubor** (`028` §2 `c`). Seznam
  musí být na jednom místě, čitelný a odsouhlasitelný — ne rozsypaný
  v podmínkách;
- `guard: 'none'`/`'lock'` zůstávají fail-closed, ale **z jiného důvodu**:
  ne kvůli chybějícímu souhlasu, ale kvůli chybějícímu zámku a záznamu.
  Přepsat i komentáře, které dnes tvrdí to první.

**Rozhodnuto 2026-08-20:** ptá se na **secrety a klíče**, **CI a nasazení**
a **přepis už aplikované migrace**. `.git/` se odmítá bez ptaní. Manifesty
(`package.json`) se **neptají** — agent je při stavbě mění běžně a správná páka
je kontrola instalace balíku, ne zápisu souboru.

**Test:** deset zápisů do běžných souborů za sebou → **nula approvalů**; zápis
do souboru z citlivého seznamu → approval; bez zapojené roviny → nezapisuje se.

---

## 3. Fáze M1 — spolehlivost (otevřené `P1`)

### M1-a Atomický zápis zachová práva — ✅ **HOTOVO** (`70ce191f`)

> Režim cíle se přebírá (`stat` → `open` s módem → `chmod`), přidán `fsync` na
> soubor i adresář, temp jméno je `randomUUID()`. Tři testy
> v `effects-p0-regressions`. Zbytek sekce je popis, ne úkol.

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

### M1-b Boot cleanup nesmí rušit živé procesy — ✅ **HOTOVO** (`6eb855fc`)

> Zvolen **lease s heartbeatem**, ne singleton: i singleton musí poznat, že
> předchozí držitel umřel, jinak by po pádu jeho značka blokovala start navždy —
> takže by se stejně zvrhl v lease plus odmítnutí startu. Migrace
> `2026_08_21_065_process_leases`, modul `src/approvals/process-lease.js`,
> TTL 90 s / tep 30 s. Zbytek sekce je popis, ne úkol.

`src/approvals/authority.js` (`reapApprovalsFromPreviousBoot`),
`src/executor/file-lock.js` (`releaseStaleLocks`)

**Vada:** komentář slibuje, že se dva procesy navzájem neuklízejí, ale SQL
uzavře **všechno** s jiným `boot_id`. Sonda review potvrdila, že proces B zruší
živý approval i zámek procesu A.

**Upřesnění rozsahu (ověřeno na `25c61a96`):** úklid volá **jen `src/server.js`**,
gateway ne. V dnešním zapojení (jeden core + gateway) proto nehrozí, že by
gateway sebrala approvaly coru — na to by musely běžet **dva cory** nad jednou
databází. Vada je tím pádem latentní, ne aktivní: nic ale dvěma corům nebrání
a komentář v kódu tvrdí něco, co kód nedělá. Oprava má obojí srovnat — buď
lease/heartbeat, nebo **napsat a vynutit**, že jeden core na databázi je
podmínka.

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

**Rozsah — jen mobil.** Druhé review tvrdilo, že nejednotný kontrakt má
i `src/routes/approvals.js`. Ověřeno: **nemá.** Desktopová replay větev
(dnes ř. 154–161) vrací kompletní trojici včetně `decidedAt` a `decidedBy`;
odkazovaný řádek 110 je výpis fronty, ne rozhodovací cesta. Opravuje se
`src/mobile/handlers.js`, desktop zůstává.

### M1-d Klient rozliší konce

Mobil i `/approvals-ui` musí `invalidated` a `cancelled` ukázat jinak než lidské
zamítnutí. Autorita to rozlišuje (`decisionState`), plochy zatím ne všude.

---

## 4. Fáze M2 — dát zapisovatelům sdílenou cestu (ne approval)

**Pravidlo rozdělení** (reviewerovo, nezjednodušovat):

| Kategorie | Cesta |
|---|---|
| agentem generované změny uživatelských souborů | **přes sdílenou cestu** — zámek, atomický zápis, záznam. Approval jen když politika řekne (`028` §2) |
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

**Patch engine approval nepotřebuje** — má vlastní temp+rename a backup/revert.
Potřebuje zámek (aby si dva běhy nerozbily týž soubor), atomicitu opravenou
v M1-a a záznam. Ptát se má až tehdy, když konkrétní patch sáhne na soubor
z citlivého seznamu.

**U každého:**
- `runId` musí být **identita tahu/efektu**, ne relace (viz `A3`);
- `signal` se musí předat (viz `A1`/`C1`) — a ověř to **na volacím místě**,
  ne jen na jednotce;
- výsledek se pojmenuje: nezapsáno ≠ chyba ≠ osiřelo;
- fail-closed se nesmí obejít.

**Rozsah slibu se rozšiřuje až s kódem.** V `src/executor/effects.js` §12
a v handbooku §P0-2 je věta se seznamem pokrytých cest — přepiš ji **až** když
to bude pravda, a ani o řádek dřív. Zároveň ji přeformuluj: slib už není
„zeptá se", ale „jde přes jednu cestu a **zeptá se podle politiky**".

---

## 4.1 Mimo tenhle balík — rozhodovací body `a` a `b`

`028` §2 `a`/`b` (změna směru proti roadmapě, potřeba nového pravidla) **nejsou
zápisy**. Vzniknou v planneru a potřebují **volajícího**, ne mediaci
zapisovatelů. Autorita je na ně připravená — bere volný `subjectType`.

Je to samostatná práce a do tohohle zadání nepatří. Nezačínej ji tady.

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
