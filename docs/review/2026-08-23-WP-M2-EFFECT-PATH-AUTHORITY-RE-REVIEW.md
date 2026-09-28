# Nezávislé re-review — WP-M2-EFFECT, první řez (project-path authority)

- **Předmět:** přesný rozsah `25cdaac8..eb22d10c`
- **Reviewer:** nezávislý, mimo implementační stream
- **Datum:** 2026-08-23
- **Verdikt:** `REVIEW_PASSED` v rozsahu tohoto řezu

R1, R2, R3, R5 a R6 jsou uzavřené a přeověřené vlastními sondami.
R4 přijímám jako `DOCUMENTED_RESIDUAL`, R7 jako zaznamenané.
Nové nálezy N1–N3 níže nejsou blokující; patří do ledgeru, ne do tohoto řezu.

`REVIEW_PASSED` se týká **jen** první project-path authority řezu. Nemění nic
na tom, že `WP-M2-EFFECT` jako celek je otevřený, `EffectRequest/Result`
a `ApprovalGrant` jsou `NOT_PINNED` a M2 není PASS.

## 1. Oprava mého vlastního nálezu

Poznámka k názvu testu v původním review byla chybná. `git show
c3b882d0:docs/wp/WP-M2-EFFECT-PATH-AUTHORITY.md` ukazuje, že §6 jmenoval
`tests/module-boundary-ratchet.test.js` správně; „module boundary" byl jen
popisek řádku výsledku. V implementaci nebylo co opravovat.

## 2. Přeověřená čísla

Vše spuštěno znovu, ne převzato.

| Tvrzení | Výsledek |
|---|---|
| patch engine 69/69 | ✅ |
| lifecycle BUILD 97/97 | ✅ |
| execution loop 59/59 | ✅ |
| module boundary ratchet 13/13 | ✅ |
| registry 397, `be1adcf9…` | ✅ `registryHash` souhlasí |
| runner `verdict: FAIL`, `exitCode: 1`, 233/3/2 | ✅ `sourceRevision` = `664d91d8`, non-PASS ID beze změny |
| strom čistý, bez upstreamu, nic nepushnuto | ✅ |

## 3. Disposition nálezů

### R1 — `CLOSED`

`project_path_violation` je terminální v preview i apply fázi. Ověřeno, že
`_buildResult` předává `iterationLog` přes `buildReport` beze ztráty polí,
takže `report.iterations[].state`, `.pathAuthority` a `.rejectedPatches`
skutečně existují. Dodaný test navíc asertuje `qualityGateCalls === 0`
a `testCalls === 0` a nezměněný validní soubor ze stejné sady — to je silnější
důkaz než jen stopReason.

`stopReason` se dostane i do uživatelsky viditelného důvodu selhání milestonu
(`execution loop project_path_violation: …`).

### R2 — `CLOSED`, s upřesněním mého původního popisu

Vaše kompatibilitní korekce je správná a přebírám ji. Ověřil jsem baseline
`44a9ba87`: při `stripped === 0` caller stejně spadl do
`out-of-scope errors unfixable`. U **osamoceného** nepoužitelného vstupu tedy
nešlo o změnu výsledku, jen důvodu — tam jsem regresi popsal příliš silně.

Skutečná regrese byla v **souběhu**: jakmile nepoužitelný vstup (absolutní
cesta, adresář, dangling symlink, `EACCES`) stál v `scope_files` vedle
stripnutelného souboru, baseline recovery uspěla a první řez ji tvrdě zabil.
Totéž u dvou a více stripnutelných souborů. To je opravené.

Přeověřeno sondou proti `_testInternals.stripDeadImports`:

| Vstup | Výsledek |
|---|---|
| absolutní cesta uvnitř projektu | `ok`, normalizována, `filesModified: ['a.js']` |
| `/etc/passwd` | `ok`, skip `untrusted_scope_path/absolute_outside_project`, žádné čtení |
| adresář | `ok`, skip `not_a_file` |
| dangling symlink | `ok`, skip `symlink_unresolvable/ELOOP` |
| `EACCES` | `ok`, skip `read_failed/EACCES` |
| in-project alias | `ok`, skip `untrusted_scope_path/canonical_target_mismatch` |
| dva stripnutelné soubory | `ok`, `stripped: 2`, oba na disku |
| `../out.js` | `ok: false`, `project_path_violation/traversal` — terminální |

Traversal tedy zůstal terminální i po uvolnění zbytku. To je správná dělicí
čára.

### R3 — `CLOSED`

`allowed.js -> secret.js` vrací `canonical_target_mismatch`, `secret.js`
zůstal bajtově nezměněný. Deklarované jméno je teď skutečně tím, co authority
autorizuje.

### R4 — `DOCUMENTED_RESIDUAL`, přijímám

Přeověřeno, že chování je přesně takové, jaké hlavička modulu teď přiznává:
in-project hardlink na soubor mimo projekt vrátí jeho bajty ze čtecí cesty,
zatímco zápis inode mimo projekt ověřeně nezměnil. Přiznané omezení na správném
místě je pro tento řez dostatečné; uzavření patří dirfd/openat2 brokeru.

### R5 — `CLOSED`

Adresář → `not_a_file`, dangling symlink → `symlink_unresolvable`. Traversal,
symlink ven i absolutní cesta zůstaly `project_path_violation`. Kbelíky už
nemíchají typ souboru s porušením hranice.

### R6 — `CLOSED`

Race sonda po úspěšném preflightu: `state: project_path_violation`,
`pathAuthority.reason: outside_project` na úrovni sady, sentinel mimo projekt
nedotčený, první soubor vrácený zpět.

### R7 — `ACKNOWLEDGED`

Historie se nepřepisovala, změna je zaznamenaná. Uzavřeno.

## 4. Nové nálezy — neblokující

### N1 — LOW/MEDIUM — `canonical_target_mismatch` není porušení hranice, ale hlásí se jako ono a je terminální

Ověřeno: legitimní in-project layout `current/ -> v2/` (žádný únik, canonical
cíl je prokazatelně pod rootem) vrátí u `current/app.js`
`state: project_path_violation`, `reason: canonical_target_mismatch`. Přes R1
to ukončí **celou** iteraci fix loopu a milestone dostane důvod
`execution loop project_path_violation`.

Kontrola sama je správná a R3 zavírá. Problém je zařazení: `resolveProjectTarget`
v tom okamžiku už dokázal, že cíl je uvnitř projektu, takže `project_path_violation`
je pro tento případ stejný mis-bucketing, jaký R5 opravil o pár řádků výš.
Praktický dopad: projekt se symlinkovaným adresářem v cestě je nepatchovatelný
a hlásí to jako pokus o únik.

Dodaný test pokrývá alias na *soubor*, ne symlinkovaný *adresář* v cestě, takže
tohle rozhodnutí není zamčené ani zdokumentované.

**Doporučení:** vlastní stav (např. `canonical_target_mismatch`) oddělený od
`project_path_violation` a samostatné rozhodnutí o terminalitě. Fail-closed
drop jako u `not_a_file` je pro provably-contained cíl obhajitelnější než
zabití iterace. Ať už zvolíte cokoli, patří to do WP §5 a do testu.

### N2 — LOW — evidence pole nemají čtenáře

`milestone._loopReport` (obě místa) i `milestone._deadImportCleanup` vznikly
v `664d91d8` a grepem přes `src/`, `tests/`, `docs/` i `scripts/` nemají
**žádného konzumenta**. Sedí na tranzientním objektu; `handleMilestoneFailure`
persistuje jen `local_plan._blockedAttempts` a `_lastBlockedAt`.

Disposition R1 („loop report obsahuje…") je doslova pravdivá — struktura tam je
a ověřil jsem to. Ale reálná evidence, kterou dnes někdo uvidí, je `logger.warn`.
Není to blokující a je to tvar už otevřené audit položky; jen to nesmí být
vykazováno jako doručený audit.

### N3 — LOW — selhaný zápis se míchá mezi nepoužitelné vstupy

Ověřeno: `ENOSPC` na `rename` uprostřed dead-import batche skončí v `skipped`
se `state: write_failed` a funkce vrátí `ok: true`. Dotčený soubor zůstal
atomicky nedotčený a zbytek se dokončil, takže chování je pro best-effort
recovery v pořádku.

Terminologicky ale `skipped` teď míchá „tenhle vstup nešel použít" s „efekt se
pokusil proběhnout a selhal". Stačí to odlišit v poli nebo ve wordingu WP §5.5.

## 5. Co drží

- Dělicí čára mezi terminálním porušením hranice a přeskočitelným vstupem je
  po opravě konzistentní: traversal, absolutní ven, symlink ven a target race
  končí zavřeně, zbytek degraduje s typovaným důkazem.
- Testy jsou nepřátelské, ne potvrzovací. `qualityGateCalls === 0`
  a bajtové sentinely na obou stranách hranice jsou správný druh důkazu.
- Přiznání ABA závodu i hardlink exposure v hlavičce modulu se nezměkčilo pod
  tlakem review. To si udržte.
- `verdict: FAIL / exitCode: 1` je v ROADMAP.md i WP §8 uvedený pravdivě, ne
  přebarvený na „gate prošel".

## 6. Rozsah tohoto verdiktu

`REVIEW_PASSED` platí pro containment třídu `P1-FX-001` a `P1-FX-003`
v rozsahu `44a9ba87..eb22d10c`. Nedotčené a stále otevřené zůstávají
approval/payload authority, durable rollback, cancellation/restart revokace,
process supervision, network/Git/tool mediation, audit a skutečný M2 user
journey. N1–N3 patří do `docs/findings/001`, ne do tohoto řezu.
