# WP-M5-PRIVACY — containment a operátorská remediation authority

**Typ:** M5 production hardening · **Stav:**
`IMPLEMENTATION_GREEN / OPERATOR_REMEDIATION_REQUIRED / REVIEW_PENDING`
· **Product:** `a92b9fde94ec6cd64bbd7067afb1e198021e82d2`
· **Module baseline:** `a699b4362c7c42c9cb6fe36b14b22c753d0cbc6b`

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
- `scan-m5-privacy.js` odmítne dirty strom, nečte obsah citlivých cest a
  historical reachability reportuje jen počty.

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
Tento WP není nezávislé review ani M5 acceptance.
