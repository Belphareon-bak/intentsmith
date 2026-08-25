# Decision 030 — M2 closeout authority

- **Stav:** `ACCEPTED`
- **Datum:** 2026-08-25
- **Rozhodl:** operátor projektu
- **Rozsah:** M2 effect authority, recovery settlement, review a closeout

## Kontext

Section-2 review potvrdilo, že single-use grant identity je bezpečnostní replay
hranice, zatímco runtime dosud neuměl pravdivě uzavřít neprovedený expirovaný
nebo revokovaný grant. Stejný review zároveň ukázal, že standalone `fs.write`
EffectResult ukládá pouze digesty, nikoli before-image bajty. Skutečný
kompenzátor proto existuje jen v project-change authority oddílů 4/5, kde
`m2_execution_files.before_bytes` drží přesný obnovovací materiál.

## Rozhodnutí

### 1. Review proces

Použije se zjednodušená varianta 1B: implementace a evidence se nejdřív
dokončí a připnou, potom operátor provede nezávislé review přesných bajtů.
Lokální Opus review není podmínkou. M2 nelze uzavřít bez operátorova
`REVIEW_PASSED`; `CHANGES_REQUESTED` vrací příslušný řez do implementace.

### 2. Neprovedený approval grant

Grant lze terminálně uzavřít pouze tehdy, když je nespotřebovaný a neexistuje
pro něj execution claim. Expirace i revokace mají effect status `cancelled`,
ale rozdílný přesný kód:

| Stav autority | EffectResult |
|---|---|
| expirovaný, nespotřebovaný, bez claimu | `cancelled / APPROVAL_GRANT_EXPIRED` |
| revokovaný, nespotřebovaný, bez claimu | `cancelled / APPROVAL_GRANT_REVOKED` |

Oba výsledky mají `rollback.required:false`, `rollback.status:not_required` a
`lateCompletionRejected:false`. `timed_out` zůstává vyhrazeno situaci, kdy
provider mohl běžet. Grant nonce, `effect_id` a single-use UNIQUE hranice se
nerozvolňují a nevznikají multi-generační granty.

Další skutečný pokus musí mít novou ToolRequest/operation/effect identitu.
Runtime používá explicitní kladnou `effectRetryGeneration`; stejná generace je
exact idempotentní reconnect replay, vyšší generace je nový pokus.

### 3. Standalone rollback settlement A′

Standalone section-2 runtime nebude zapisovat before-image bajty ani provádět
slepou kompenzaci. Append-only receipt zaznamená descriptor-pinned pozorování:

| Pozorování | Význam |
|---|---|
| `matches_forward` | přesná autorizovaná after-image je přítomná; účetní dluh je vypořádaný |
| `matches_before` | prokazatelná before-image je přítomná; rollback se nedluží |
| `foreign` | cizí nebo neprokazatelný stav; bez zápisu, dluh zůstává |

`beforeDigest:null` z restartového `EFFECT_RECOVERY_ORPHANED` není důkaz, že
soubor před efektem neexistoval. Takový missing target se klasifikuje
fail-closed jako `foreign`. EffectResult zůstává neměnný; jediný repository
accessor skládá EffectResult, receipt a aktuální `rollbackDebt`.

Receipt authority se nevztahuje na efekty přítomné v `m2_execution_files`.
Oddíly 4/5 dál vlastní jediný multi-file kompenzátor nad trvalými
`before_bytes`.

### 4. Zděděný gate baseline

M2 lze přijmout s přesně nezměněným zděděným baseline `3 FAIL / 2 BLOCKED`.
Report musí zůstat pravdivě `verdict: FAIL / exitCode: 1`, uvést přesná stejná
non-PASS ID a nesmí baseline popsat jako prošlý gate. Jakýkoli nový non-PASS je
M2 regrese a přijetí blokuje.

### 5. Remote hranice

M2 přijímá contract-only remote boundary. Listener, pairing, autentizace,
device authority a vzdálený runtime nejsou součástí M2 a nesmí být tvrzeny
jako implementované.

## Důsledky a omezení

- Receipt opravuje settlement truth bez přepisování append-only EffectResultu.
- `foreign` receipt je trvalý důkaz prvního bezpečného pozorování a sám dluh
  neuzavírá.
- Bez trvalé standalone before-image nelze bezpečně obnovit libovolné původní
  bajty. Toto omezení je přijaté; přidání takové retence vyžaduje nové
  rozhodnutí.
- Přijetí této decision neznamená přijetí M2. M2 zůstává `REVIEW_PENDING`,
  dokud operátor nepřijme všech sedm připnutých review řezů a integrační
  closeout.
