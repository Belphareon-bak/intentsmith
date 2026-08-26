# Decision 035 — M5 privacy remediation authority

**Datum:** 2026-08-26 · **Stav:** `IMPLEMENTED / OPERATOR_ACTION_REQUIRED`
· **Product:** `a92b9fde94ec6cd64bbd7067afb1e198021e82d2`

## Rozhodnutí

Nosnou remediací incidentu `G0-PRIVACY-001` je rotace osmi přesně
pojmenovaných kategorií credentials. Přepis Git historie expozici neruší;
může pouze omezit budoucí dosažitelnost v repozitáři. Rotace ani destruktivní
změna historie proto nesmí být odvozena z automatického běhu.

Každá dokončená rotace dostane jediný content-addressed
`PrivacyRotationReceipt@1`. Git historie dostane jediný
`PrivacyHistoryReceipt@1` až poté, co autentizovaný operátor potvrdí jednu z
těchto shodných dvojic rozhodnutí a akce:

| Rozhodnutí | Dokončená akce |
|---|---|
| `retain_and_rotate` | `retained` |
| `rewrite_and_rotate` | `rewrite_completed` |
| `new_root_and_rotate` | `new_root_completed` |

Receipt nikdy nepřijímá hodnotu, poznámku, hash, prefix ani sufix tajemství.
Aktér pochází jen z globálně autentizované transportní identity. Záznamy
jsou append-only; replay je konflikt. Souhrn smí vrátit
`OPERATOR_REMEDIATION_RECORDED` jen při 8/8 kategoriích a jednom history
receipt. Jde o operátorskou atestaci, ne o automatické ověření u externího
poskytovatele.

## Současný strom a settings

Produkční scanner kontroluje pouze trackované cesty a bezpečné textové
zdroje. U citlivé cesty neotevře obsah a výsledek obsahuje jen pravidlo, cestu a
řádek. Historical probe provádí jen `git cat-file -e`; nevypisuje object ID ani
obsah. Scanner odmítne dirty worktree, aby revision opravdu označovala
kontrolované bajty.

Migrace 090 odstraní ze `user_settings` známé credential klíče i ve vnořených
legacy dokumentech. Stejná policy blokuje jejich opětovné vložení přes SQLite,
obecné settings HTTP API i WS `sync_settings`. SMTP a webhook authority jsou
environment-only; Studio už credential pole nenabízí. Chybějící
`C3_LICENSE_SECRET` nemá repository-known fallback a validace licence fail-close
spadne na free tier.

## Hranice

- scanner není secret manager ani důkaz revokace u třetí strany;
- 13 objektů z incident manifestu je pouze známé minimum. Starší census
  zaznamenal další databázové a attachment cesty mimo manifest; jejich obsah se
  bez operátorského rozhodnutí neotevírá;
- přepis historie, force push, zrušení repozitáře i skutečná rotace jsou
  operátorské akce mimo tento commit;
- bez 8/8 rotation receipts a history receipt zůstává M5 exit kritérium
  nesplněné.

Toto rozhodnutí není nezávislé review ani M5 acceptance.
