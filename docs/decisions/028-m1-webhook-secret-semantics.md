# 028 — webhook HMAC musí mít jednu pravdivou autoritu

- **typ:** credential lifecycle a runtime connector
- **stav:** `ACCEPTED 2026-08-11: A / IMPLEMENTATION_PENDING`; implementaci
  aktivuje až vlastní ohraničený WP v přijatém pořadí
- **finding:** [011 — user_settings authority](../findings/011-user-settings-authority-and-secret-exposure.md)
- **závislost:** rozhodnutí 026/A musí být přijaté pro cílovou env autoritu,
  ale implementace 028/A předchází 026 transferu/scrub kroku; support claim by
  navíc vyžadoval 027/B

## Ověřený problém

`GET /api/security/webhook-secret` a skutečný `WebhookChannel` čtou
`C3_WEBHOOK_SECRET` z environmentu. `POST` ale vygeneruje jinou hodnotu a uloží
ji do `user_settings`, aniž by runtime změnil. UI tak může hlásit úspěšnou
rotaci, která nemá vliv na podpisy; generic GET přitom DB hodnotu odkryje.

## Varianty

### A — environment-only, bez aplikačního setteru (přijato s 026/A)

`WebhookChannel` i status čtou jedině operator-owned environment. Dnešní
nefunkční generator skončí stabilním `410 CREDENTIAL_SOURCE_READ_ONLY`; read
vrací jen `configured` a exact `source: "PROCESS_ENV" | "ROOT_ENV_FILE"` podle
026, bez prefixu/sufixu hodnoty. Změna je mimo aplikaci a vyžaduje restart.

### B — server-generated, jednorázově zobrazený managed secret

Explicitní rotate vytvoří nový secret, commitne jej přes 026/B, atomicky
přepne runtime autoritu a vrátí plaintext právě jednou. Běžný read vrací jen
configured/source. Clear je samostatná potvrzená akce; restart načte tutéž DB
autoritu.

### C — operator-supplied write-only managed secret

Lépe se integruje s externím secret managementem, ale vyžaduje bezpečný vstup,
validaci a recovery. Server ji po zápisu nikdy nevrátí.

## Implementační hranice po přijetí

Route-specific auth guard zůstává; generic settings cestou nelze secret
nastavit, číst ani smazat. Autoritativní Studio Security panel odstraní nebo
deaktivuje tlačítko „Regenerovat“ a pravdivě zobrazí read-only environment
source. Legacy **DB** secret se přenese/scrubne pouze postupem 026, ne tichým
přepisem. U varianty A neexistuje post-commit runtime activation, one-time
return ani aplikační rollback/degraded větev.

Testovací objem: nejvýše čtyři případy ve sdílené settings-authority/Studio
sadě — stabilní `410` bez DB/runtime efektu, configured/source-only read,
startup/restart env parity a ignorování potom exact scrub legacy DB hodnoty.
Skutečný externí webhook patří až do operátorského journey pro případný 027/B.

## Přijatý potvrzovací blok

```text
028: A
028-authority: ENVIRONMENT-ONLY
028-app-setter: HTTP-410-CREDENTIAL-SOURCE-READ-ONLY
028-read: CONFIGURED-AND-EXACT-SOURCE-ONLY
028-runtime: RESTART-REQUIRED-AFTER-OPERATOR-CHANGE
028-secret-value: NEVER-IN-DB-HTTP-WS-LOG-OR-BACKUP
028-review: OWN-SUBJECT-REVIEW-A-AND-B
```
