# M2 migration identity remediation — 2026-08-26

- **Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED`
- **Původní M2 tip:** `9f8a7019`
- **Remediation source:** `d6831917b1cabf43d54fa2245b39b0f98dab1395`
- **Boundary baseline commit:** `523405155c191ebdbbb3548aac01421af737574e`
- **Push:** neproveden

Tento report nahrazuje pouze tvrzení o aktuální migrační identitě v původním
M2 closeoutu. Starý review zůstává historickým důkazem nad starým product
targetem, ale nové commity neschválil a verdict se na ně nepřenáší.

## Příčina a autoritativní řešení

Union census `2026-08-26T22:34+02:00` nad 366 živými lokálními a remote refs
mimo `archive/**` a `recovery/**` našel 107 různých migračních cest. Potvrdil:

- `087`–`088` vlastní M4;
- `089`–`091` vlastní M5;
- `096` vlastní model-evaluation import audit;
- `092`–`095` byly globálně volné.

Původní M2 identity byly proto přesunuty takto:

| Retired M2 stamp | Autoritativní stamp |
|---|---|
| `2026_08_23_070_m2_effect_authority` | `2026_08_23_092_m2_effect_authority` |
| `2026_08_24_081_m2_effect_result_semantic_authority_v2` | `2026_08_24_093_m2_effect_result_semantic_authority_v2` |
| `2026_08_25_082_m2_preexecution_approval_terminals` | `2026_08_25_094_m2_preexecution_approval_terminals` |
| `2026_08_25_083_m2_effect_rollback_receipts` | `2026_08_25_095_m2_effect_rollback_receipts` |

Runner nejdřív validuje union manifestu a projektované DB historie. Přesné
staré stampy adoptuje spolu s finální post-validací v jediné transakci,
zachová `applied_at` a migrační těla znovu nespouští. Částečná stará historie
po adopci pokračuje jen dosud neaplikovanými kroky. Karanténní schema `093`
zachovává původní persistovaný `source_migration` z `081`, a je proto
byte-kompatibilní s již aplikovanou databází.

## Ověření

Vše proběhlo bez Ollamy, GPU scoringu a zásahu do timeru.

| Kontrola | Výsledek |
|---|---|
| schema migration suite | `41/41 PASS` |
| úplná adopce starých stampů | PASS, `applied_at` zachováno, `up()` znovu nevoláno |
| částečná stará historie | PASS, adopce a následná aplikace `094/095` |
| M2 effect authority + filesystem runtime | `49/49 + 10/10 PASS` |
| M1 schema compatibility | `20/20 PASS` |
| artifact validation | `154/154 PASS` |
| všech 31 registrovaných `tests/m2-*` programů | `31/31 programů PASS` |
| module boundary ratchet | `13/13 PASS`; `1131` hran; `3` cykly; `28` souborů v cyklech |
| `git diff --check` | PASS |

Boundary baseline byl vytvořen výhradně oficiálním writerem nad čistým
commitem `d6831917`; všech 13 nových hran bylo explicitně přijato a 13 starých
hran po přejmenování odstraněno. Provenance replay ukazuje přesně 1 131 hran.

## Zbývající brána

Tento stav není `ACCEPTED`. Je nutný nový nezávislý review přesného rozsahu
`9f8a7019..52340515` a následného documentation-only report commitu. Před
integrací je navíc nutné prokázat společný manifest s model-evaluation,
M4 a M5 migracemi bez číselných kolizí.
