# WP-M5-PRIVACY — containment a operátorská remediation authority

**Typ:** M5 production hardening · **Stav:**
`SIGNED_AUTHORITY_CHANGES_REQUIRED / REMEDIATION_IMPLEMENTED /
RE_REVIEW_REQUIRED / OPERATOR_REMEDIATION_REQUIRED`
· **Reviewed signed-authority product:** `73fdf8365c97c49292752a0e46697345eada0f44`
· **Raw/SQLite remediation:** `95a2cd6c`
· **Git-lineage remediation:** `4beced1b`
· **Module baseline:** `2b5da617`

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
