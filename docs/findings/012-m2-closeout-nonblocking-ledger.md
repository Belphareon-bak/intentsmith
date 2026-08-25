# Finding 012 — M2 closeout neblokující ledger

- **Stav:** `OPEN / NON-BLOCKING AFTER M2 ACCEPTANCE`
- **Zdroj:** finální operátorské review M2, 2026-08-25
- **Review target:** `c070ed7383e522fb58b53a799cbbc0e16c4b09a7`
- **Počet:** 4 neblokující položky, 0 blockerů

Tento ledger zachovává drobné follow-upy bez změny připnutých a přijatých M2
kontraktů. Není oprávněním měnit revidované product bajty v closeout commitu.

## S1-N1 — LOW — dead-import durability stav

`src/planner/lifecycle-build.js` přidá pro ne-path write chybu do
`effectFailures` stav `write_failed`, i když `error.effectApplied === true` a
reason je `PROJECT_WRITE_DURABILITY_UNCONFIRMED`. Stejnou podmínku
`src/patch/patch-engine.js` rozlišuje jako `write_durability_unconfirmed`.

Pravda se neztrácí: exact reason se zachová, `effectFailures` je neprázdné,
evidence se persistuje a milestone skončí terminálně. `filesModified` na této
hranici není revalidační autorita.

**Doporučený follow-up:** odvodit dead-import state z `error.effectApplied`
stejně jako `ioFailure`, aby oba konzumenti sdíleli jeden slovník.

## S2-N1 — LOW — EffectResult errorCode není v user response

`src/chat/handlers/pre-handler.js` skládá non-success text a metadata pouze z
`terminalStatus`. Uživatel proto u `cancelled` nepozná
`APPROVAL_GRANT_EXPIRED` od `APPROVAL_GRANT_REVOKED`, přestože authority a
durable EffectResult je rozlišují správně.

**Doporučený follow-up:** přidat `effectErrorCode` do response metadat a
bezpečný důvod do non-success textu. Authority ani status vocabulary se nemění.

## S2-N2 — INFO — karanténovaný pending payload

`reconcileTerminalPendingEffects` karanténovaný legacy EffectResult přeskočí a
záměrně nemaže jeho pending payload BLOB. Tím se zachová izolovaná evidence a
modulový start zůstane dostupný, ale BLOB se automaticky neuvolní.

**Disposition:** přijato jako vzácná jednorázová retenční cena karantény.
Případný cleanup vyžaduje samostatnou authority a nesmí odstranit auditní
vazbu.

## S5-N1 — INFO — file rollback a Git in-doubt jsou sourozenci

Při Git `in_doubt` může `ProjectChangeResult` pravdivě nést
`terminalStatus: orphaned`, `rollback.status: succeeded` pro souborové změny a
současně `git.status: in_doubt`. Kontrakt tyto dvě projekce nespojuje a
`lateCompletionRejected` se odvozuje jen z focused procesu.

Současný konzument nečte parent `rollback.status` izolovaně, takže nevzniká
false success. Riziko vznikne až tehdy, kdyby budoucí UI nebo recovery četly
rollback bez sibling Git stavu.

**Doporučený follow-up:** před prvním samostatným konzumentem přidat jednotný
ProjectChange settlement accessor/view, který skládá file rollback, Git stav a
celkový terminal.

## Přijaté dřívější drobnosti

Finální review dále ponechává jako dokumentované neprodukované hranice:

- `git.commit` nemá producenta pro terminal `killed`; zákaz je dnes implicitní;
- `network.request` má v non-success větvi slabší pravidlo než `git.push`, ale
  M2 nemá network provider.

Ani jedna položka není M2 blocker. Jakmile vznikne příslušný producent, musí
nový WP přidat kontraktový a produkční důkaz místo spoléhání na tuto poznámku.
