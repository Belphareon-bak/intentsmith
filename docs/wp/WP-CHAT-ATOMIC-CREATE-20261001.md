# WP — atomické vytvoření souboru v M2

**Stav:** implementační kandidát; nezávislé review a integrační přejímka otevřené.

**Autorita:** explicitní požadavek operátora z 2026-10-01 na skutečné
`create-only` pro přirozený chat, bez přepsání souboru vzniklého po preview.
Platí `PRODUCT.md` § autorita uživatele, `CONTRACT.md` §6/§10, přijaté
`docs/wp/WP-M2-TOOL-CONTRACT-V1.md` a
`docs/wp/WP-M2-EFFECT-CONTRACT-V1.md`. Tento WP není novým zdrojem
produktového rozhodnutí.

**Vstup:** čistý integrační commit `4cbb4b55ee8ef5fa0e1c6ec3401d3e9802c2af32`
v izolovaném detached worktree. Chatový jazykový handler vlastní souběžný
WP; tento kandidát jej nemění.

## Rozsah a rozhraní

- `ToolRequest@1`: `toolId: 'file.create'`, `toolVersion: 1`, přesný vstup
  `{path: <project-relative>, content: <doslovný řetězec>}`.
- Binding: `kind: 'fs.write'`, `requiredCapability: 'project.fs.create'`,
  přesný SHA-256 a byte length. `EffectRequest@3` má tento jediný zapisující
  význam. `ApprovalGrant@1` a `EffectResult@1` zůstávají exact-scope.
- `file.write@1` zachovává původní overwrite význam. `EffectRequest@2`
  zůstává výhradně root listing; ani jeden přijatý kontrakt se nepřeznačuje.
- SQLite migrace `2026_10_01_121_m2_atomic_create` rozšiřuje jen přesně
  připnuté request/result triggery pro nový tvar; historické requesty a
  výsledky zůstávají čitelné.

## Prováděcí invariant

Po schválení provider znovu zkontroluje projektový relativní cíl, existující
parent, symlink a přítomnost cíle. Do unikátního soukromého temp inode ve
stejné složce zapíše přesné bajty a provede `fsync`. Poslední revalidace
předchází `link(2)` z temp jména na požadované jméno. `link(2)` je
**atomická no-clobber hranice**: soubor, symlink nebo jiný záznam vytvořený
jiným procesem mezi preview a tímto syscall způsobí `EEXIST`; cizí bajty
zůstávají nedotčené. Po úspěšném linku se provede `fsync` parentu, odstraní
se temp jméno, parent se znovu synchronizuje a kontroluje se přesný inode,
počet hardlinků a obsah. Pozdní selhání je applied/orphaned s rollback debt,
nikoli falešný úspěch. Bez existujícího parentu se nic nevytváří.

Stávající Node path API stále neumí vyloučit nepřátelskou výměnu celé parent
složky mezi poslední revalidací a `link(2)`. To je explicitní zbytkové riziko
stejné třídy jako přijatý `file.write@1` path ABA; úplné řešení vyžaduje
dirfd/openat2 primitive. Tento WP dokazuje no-clobber pro *jméno předané
syscallu*, nikoli absolutní odolnost proti nepřátelskému přesunu parentu.

## Přejímka

1. Skutečný M2 `ToolRequest → EffectRequest → grant → provider → terminal`
   nad privátní SQLite/project: úspěšné přesné bajty, restart a idempotentní
   replay; cizí actor nesmí schválit.
2. Existující soubor před přípravou i soubor vzniklý až po ní skončí
   `EFFECT_FS_CREATE_EXISTS` bez změn a bez rollback debt. Injekce souběhu
   přímo v `linkSync` prokáže no-clobber na commit hranici.
3. Cancel před linkem, hardlink/symlink, selhání parent fsync a nesprávná
   capability se ověří bez GPU. Typovaný SQL validator odmítne padělaný
   v3 request i result s falešným before digestem.
4. Dosavadní M2 runtime, broker, repository a schema upgrade scénáře
   zůstanou zelené; red-first mutace `link → rename` musí skutečně selhat.
5. Nezávislý reviewer připne přesný commit a vrátí `REVIEW_PASS`; teprve potom
   integrace s chatovým handlerem a samostatný reálný M1/HTTP test.

**Zakázaný rozsah:** GPU/model, produkční DB/služba, legacy přímý zápis,
úprava `src/chat/handlers/file.js`, mobil, push a cizí worktree.
