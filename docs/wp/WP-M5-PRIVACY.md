# WP-M5-PRIVACY — containment a operátorská remediation authority

**Typ:** M5 production hardening · **Stav:**
`KEY_CUSTODY_CHANGES_REQUIRED / M5_R19_PRODUCT_REMEDIATION_IMPLEMENTED /
RE_REVIEW_REQUIRED / OPERATOR_REMEDIATION_REQUIRED`
· **Reviewed signed-authority product:** `75498c69cb7587378b0fe29e44dde7cc03c9cc4c`
· **Raw/SQLite remediation:** `95a2cd6c`
· **Git-lineage remediation:** `4beced1b`
· **Module baseline:** `2b5da617`
· **Latest byte/history remediation:** `8632c490`

## Výsledek implementace

- `SignedAuthorityReceipt@1` používá oddělený offline Ed25519 klíč role
  `m5-privacy-operator`, pokrývá přesně osm kategorií a jeden history receipt
  a zakazuje jakékoli secret material.
- History payload svazuje disposition, dokončenou akci, post-disposition HEAD,
  ref census a privacy scan; disposition musí ležet v product candidate lineage.
- migrace 090 přidá dvě append-only tabulky, exact SQL triggery a odstraní
  plaintext credentials z existujících `user_settings`.
- HTTP, WS, SQLite a Studio settings používají stejnou fail-closed policy;
  SMTP/webhook secret je pouze v environmentu a licenční HMAC nemá známý
  fallback.
- aplikace nemá podpisový klíč ani mint factory. SQLite je jen nedůvěryhodná
  display cache raw envelope bytes a každý summary je znovu ověřuje proti
  Git-pinned trust store a přesným candidate/evidence bindings;
- `scan-m5-privacy.js` odmítne dirty strom, čte exact HEAD bloby distribučního
  manifestu, nečte obsah citlivých cest a reachability počítá z deklarovaných
  refs, ne z fyzické existence dangling objektu.

## API

| Metoda | Route | Autorita |
|---|---|---|
| `GET` | `/api/security/privacy/remediation` | autentizovaný user subject |
| `POST` | `/api/security/privacy/rotations/:categoryId/attest` | autentizace, potom typed `410`; body se nečte |
| `POST` | `/api/security/privacy/history/attest` | autentizace, potom typed `410`; body se nečte |

## Aktuální operátorský stav

| Položka | Stav |
|---|---:|
| Rotation receipts | **0 / 8** |
| History disposition receipt | **chybí** |
| Známé incident objekty stále dosažitelné | **13 / 13** |
| Obsah osobních objektů otevřen | **ne** |

Implementace je připravená k review, ale samotná operátorská remediation
neproběhla. Nikdo nesmí tento stav přeznačit na splněné privacy exit kritérium.

## Verifikace

```bash
node --test tests/m5-privacy-remediation.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/routes-smoke.test.js
node tests/module-boundary-ratchet.test.js
node scripts/scan-m5-privacy.js
```

Přesné výsledky jsou v
[`m5-privacy-20260826.md`](../execution/runs/m5-privacy-20260826.md).
Navazující second-review evidence je v
[`m5-second-review-remediation-closeout-20260827.md`](../execution/runs/m5-second-review-remediation-closeout-20260827.md).
Tento WP není nezávislé review ani M5 acceptance.

## Superseding review 2026-08-27

Operátorský re-review přijal DATA, AUTH a PERF, ale v PRIVACY našel CRITICAL
bypass: veřejný `authorizeGlobalRequest()` přijímal od stejného volajícího
očekávanou i prezentovanou capability a globální WeakSet pak takto vydaný
subject uznal na privacy writer hranici. Oprava tohoto WP musí používat jedinou
per-bootstrap auth instanci a privacy repository musí přijímat jen subject
vydaný touto přesnou produkční instancí.

Remediation `665b42c8` odstranila veřejný raw mint, sdílí jednu per-bootstrap
instanci mezi HTTP, WS a privacy repository a databázový writer navíc trvale
váže na první konkrétní verifier. Klon subjectu, subject z cizí auth instance i
pokus připojit k téže DB repository s jiným verifierem selžou před insertem.
Focused regrese jsou zelené, ale jde o implementační důkaz; až do operátorského
re-review zůstává poslední nezávislý verdict `CHANGES_REQUESTED`.

## Decision 041 re-review a remediation 2026-08-28

Nezávislý review candidatu `73fdf836` skončil `CHANGES_REQUIRED`. Našel
ztrátu bajtové identity při neplatném UTF-8, chybějící SQLite UDF po restartu,
nepovinné hodnoty expected bindings, neúplnou candidate→HEAD boundary,
index/manifest existující až po podepsaném evidence HEAD, forked history
lineage, rozdílnou disposition v M5 acceptance a nonce unikátní jen per role.

Remediation používá fatal UTF-8 decoder a byte equality, obnovuje všechny
persistentní UDF při konstrukci repository, vyžaduje šest přesně typovaných
bindings, kontroluje celý evidence-only Git rozsah a čistý strom, vyžaduje
index i manifest na každém podepsaném evidence HEAD, váže history před product
candidate, porovnává obě disposition a používá globální nonce množinu.
Implementace ani focused testy nejsou review PASS; offline ceremonie zůstává
blokovaná do nového nezávislého `REVIEW_PASSED`.

## Druhý Decision 041 re-review a remediation 2026-08-28

Re-review kandidatu `75498c69` potvrdil předchozí opravy a focused
`375/375`, ale našel dva nezávislé HIGH blockery: SQLite `TEXT` round-trip
normalizoval neplatnou UTF-8 sekvenci před raw verifierem a koncový Git diff
neviděl produktovou změnu následovanou revertem. Lokální `refs/replace`, grafts
a skryté index flags navíc oslabovaly lokální CLI autoritu.

Commit `8632c490` čte každý stored envelope jako přesný BLOB, validuje celý
lineární rozsah commit po commitu i per parent a totéž opakuje pro každý
receipt evidence HEAD. Merge commity jsou explicitně zakázané. Všechny Git
čtecí operace vypínají replacement objects a před verifikací odmítnou replace
refs, grafts, `assume-unchanged` i `skip-worktree`. Reálný temp-Git test
spouští oba standalone CLI a prokazuje, že mutate→receipt→revert končí FAIL.
Aktuální focused a structural sada je `382/382 PASS`; není to review PASS ani
oprávnění k offline key ceremony.

## Třetí Decision 041 review, ceremonie a M5-R19 2026-08-29

Třetí nezávislý review kandidatu `37edf30d` uzavřel byte/history implementaci
jako `REVIEW_PASSED`. Následně autorizovaná ceremonie vytvořila čtyři oddělené
Ed25519 role mimo repozitář a připnula pouze jejich veřejné SPKI a odvozené
`keyId` do `contracts/authority/trusted-public-keys-v1.json`.

Privacy review současně našel M5-R19: required offline
`tests/m1-model-failover-schema.test.js` zůstal po migraci 100 na starém tipu
098. Oracle nyní vědomě připíná 80 migrací, tip
`2026_08_28_100_signed_privacy_receipts` a úplný applied seznam. Sada prošla
`20/20`; úzký review ale našel stejný stale počet 79 v produkčním M6 upgrade
kontraktu. Loopback-only upgrade jej reprodukoval jako `80 !== 79`. Původní
kontrakt a fixture byly sjednocené na 80; po sloučení modelové autority jsou
navázané na skutečných 87 migrací integrovaného kandidáta. Nový candidate
vyžaduje re-review.

Review současně odmítl custody model: čtyři nešifrované privátní klíče zůstaly
po network-isolated generování na trvale připojeném stejném `/home` svazku a pod
stejným OS účtem. Před podpisem musí být stejné keypairy přesunuty do skutečně
offline úložiště a reviewer key musí mít oddělenou custody. Osm rotací, history
disposition a M5 acceptance zůstávají neprovedené.

## Kompatibilita podmíněné remediation — 2026-09-09

Následný source review přijal rozlišení podepsané dokončené rotace a
historicky doložené neaplikovatelnosti podle původního incidentu a
`2026-08-07-SECRET-TYPES.md §2`; přesnou reprezentaci popisuje doplnění
Decision 035. Všech osm kategorií, historie, oddělené role a kryptografické
svázání zůstávají. Smíšený souhrn nepočítá N/A jako rotaci. Původní completed-v1
vstupy se nadále ověřují beze změny. Nové regresní případy nad původním kódem
prokázaly 39 PASS / 6 FAIL; soukromý opravený návrh 45/45 PASS včetně skutečného
Git/CLI smíšeného řetězce a nezávislého source review.

Aktuální provozní stav tím není přijat: historické použití musí doložit
operátor, současná absence konfigurace není důkaz neaplikovatelnosti.
Custody, skutečné operace, podpisy a history disposition zůstávají otevřené.

## Operátorská rozhodnutí 2026-09-10

- History disposition je vybraná jako `retain_and_rotate`; podepsaný history
  receipt zatím nevznikl a 13 známých incident objektů zůstává dosažitelných.
- Produkční klíče mají být přesunuty beze změny identity na celý LUKS2 svazek
  samostatného odpojitelného média. 16 GB je pro klíče, 13 receipts a manifesty
  více než dostatečné. Konkrétní médium zatím nebylo připojeno ani změněno.
- Reviewer key dál vyžaduje fyzicky oddělenou custody. Jeden společný disk tuto
  podmínku nesplní.

Stav zůstává 0/8 category receipts, bez history receiptu a bez M5 acceptance.
