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

## Kompatibilní upřesnění podmíněné platnosti — 2026-09-09

Původní incident manifest `docs/convergence/PRIVACY-INCIDENT.json` a jeho
review `docs/review/2026-08-07-SECRET-TYPES.md §2` podmiňují rotaci skutečnou
platností credentials a u fixture hesel jejich reuse. Technická reprezentace
proto nově rozlišuje dokončenou rotaci a podepsané posouzení neaplikovatelnosti;
nevytváří povinnost rotovat neexistující účet. Všech osm kategorií i history
receipt zůstávají povinné. Původní completed-v1 validace a receipts se nemění.

`ROTATION_NOT_APPLICABLE` je samostatný payload s podepsaným historickým
posouzením, svázaným důkazním artefaktem a tvrzením, že nezůstává lokální ani
externí autorita. Dnešní chybějící konfigurace nestačí. Zánik dřívější autority
vyžaduje další důkaz revokace, expirace nebo vyřazení celé dotčené authority;
fixture důvod navíc potvrzuje nepoužití mimo testy. N/A se nikdy nepočítá jako
provedená rotace. Smíšený souhrn používá verzi 3 a M5 acceptance payload verzi
2; celý podpisový řetězec kontroluje počty proti osmi skutečným receipts.

Jde o opravu reprezentace původně podmíněného požadavku. Žádná konkrétní
kategorie nebyla tímto upřesněním označena N/A a nevznikl operátorský podpis,
revokace, history disposition ani M5 acceptance.
