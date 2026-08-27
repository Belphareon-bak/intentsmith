# WP-M5-PRIVACY — containment a operátorská remediation authority

**Typ:** M5 production hardening · **Stav:**
`THIRD_REVIEW_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED /
OPERATOR_REMEDIATION_REQUIRED`
· **Product:** `816a2a4c8a95b49d46f06b94b56feb64c8a40c90`
· **Privacy remediation:** `b15090a4cacd0a47a1dbd26f224fe19d7e399042`
· **Third-review remediation:** `665b42c8a40807f4b9c0f1762d99cc80fe4cc4ae`
· **Module baseline:** `6e7cd7410c83826c88d6d65f6af2ae29fc5df3e6`

## Výsledek implementace

- `PrivacyRotationReceipt@1` pokrývá přesně osm kategorií incidentu a
  zakazuje jakékoli secret material.
- `PrivacyHistoryReceipt@1` svazuje rozhodnutí, dokončenou akci, viditelnost
  repozitáře, čas a transportně autentizovaného uživatele.
- migrace 090 přidá dvě append-only tabulky, exact SQL triggery a odstraní
  plaintext credentials z existujících `user_settings`.
- HTTP, WS, SQLite a Studio settings používají stejnou fail-closed policy;
  SMTP/webhook secret je pouze v environmentu a licenční HMAC nemá známý
  fallback.
- writer nemá veřejnou mint factory; přesná subject identita vzniká privátně
  až po úspěšné globální transportní autentizaci a SQL boundary ověřuje její
  identitu i shodu actor ID;
- `scan-m5-privacy.js` odmítne dirty strom, čte exact HEAD bloby distribučního
  manifestu, nečte obsah citlivých cest a reachability počítá z deklarovaných
  refs, ne z fyzické existence dangling objektu.

## API

| Metoda | Route | Autorita |
|---|---|---|
| `GET` | `/api/security/privacy/remediation` | autentizovaný user subject |
| `POST` | `/api/security/privacy/rotations/:categoryId/attest` | stejný subject + exact body bez hodnot |
| `POST` | `/api/security/privacy/history/attest` | stejný subject + dvě explicitní potvrzení |

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
