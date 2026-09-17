# Autonomní sázkař — implementační evidence 2026-09-12

Adresát: operátor a nezávislý reviewer. Autorita: explicitní požadavek operátora
na autonomní získávání dat a odstranění ručních pravděpodobností.
Worktree `/home/belphareon/worktrees/is-specialists-engines-20260911`, větev
`codex/specialists-engines-20260911`; vstup `2d19fd06`.
**IMPLEMENTED_SLICE / REVIEW_PENDING; LIVE_VALIDATION_BLOCKED (API key).**
Toto je evidence implementátora, nikoli nezávislé review nebo provozní přijetí.

## Výsledek

`c09e979e`: preference → skutečné veřejné CSV → historie/model/politika →
tikety → SQLite evidence → CLI/chat. Vlastní CPU DC model, 7 variant ve
chronologickém benchmarku, tržní alternativy, kalibrace, nezávislý numerický
řešič a další průzkumné ML porovnání. Ruční vektory pravděpodobností se odmítají.
`52c3ffb9`: vazba evidence na hostovou invokaci, zákaz vytvoření DB neplatnou
extension capability, striktní RFC3339 v externím scope, následná změna
kanceláře a doplnění testu celé české API cesty s kontrolovaným transportem.

Veřejné demonstrace:

| Běh | Preference / výsledek | Evidence |
|---|---|---|
| 24 h | kurz 1.5–3, p≥40 %, tři návrhy, 26 zdrojových snímků, 5 modelů | `/tmp/sazkar-autonomous-20260912-2/result.json` |
| 72 h | kurz 2–4, p≥20 %, rozestup ≤12 h, tři návrhy | `/tmp/sazkar-autonomous-20260912-3/result.json` |
| 72h akumulátory | 2–3 položky, kurz 2–4, p≥20 %, tři dvoupoložkové tikety; rozestupy 5.5/1.75/0 h | `/home/belphareon/Projects/coworker/intentsmith-specialists-20260911/try-auto-20260912/result.json` |
| Tipsport bez klíče | `PROVIDER_ERROR / ODDS_IO_KEY_REQUIRED`, žádný tiket, exit 2 | `/tmp/sazkar-tipsport-check-20260912/result.json` |

Ukázky jsou datované referenční výpočty; nepředstavují právě dostupnou nabídku
pro sázení. Databáze vlastní větve:
`.intentsmith-artifacts/betting/analysis.sqlite`. Akumulátorový běh má record ID
`c13dc085-7ce4-4f72-bdba-7a7ddb87aff7`.

Závěrečné zopakování na `13dc20d9` v 08:27 UTC vytvořilo stejné tři
dvoupoložkové návrhy. Výstup je v
`/home/belphareon/Projects/coworker/intentsmith-specialists-20260911/try-auto-final-20260912/`.
Record `03e6d6f8-6443-4ea5-b189-420227390685` má ověřenou hostovou vazbu
`sazeni.ticket_builder / operator:true` a všech 26 source observation ID.
Kurzy 2.034 / 2.052 / 2.0574; bodové odhady 45.18 / 44.00 / 43.67 %;
rozestupy 5.5 / 1.75 / 0 hodin. Jde opět o datovanou referenční nabídku.

## Kontroly a hranice důkazu

- Numerika a solver: 13/13 top-level testů; zahrnují 20 nezávisle enumerovaných
  sad, gradient přes centrální diference, pravděpodobnostní hmotu, chronologii,
  neznámé týmy, časové hranice/DST, přesné kurzy, neplatný vstup a zrušení.
- Integrace: 11/11 top-level testů; skutečný serializovaný handler s importem
  i autonomními preferencemi, scope a jeho zánik, cache, DB, chyby persistence,
  katalog/události/kurzy českého adapteru, absence klíče v uložených URL/auditu,
  celý live model→ticket běh nad kontrolovanými odpověďmi a hranice balíčku.
- Stávající `m5-outbound-policy.test.js`: PASS. `harness-exit-code.test.js`: PASS.
- Registry: 514 programů, nezměněný hash
  `2322ef86b7eabbf1b3a2b0bd513d2fba08d19320fd8290a47798e79823117993`.
- Vlastní měření a data: [výzkumný dokument](../research/2026-09-12-AUTONOMOUS-BETTING.md).
  Záměrně žádný claim, že historický model porazil tržní referenci.

První plný deterministický profil na `c09e979e`:
**342 PASS / 4 FAIL / 8 BLOCKED**, exit 1, run
`2026-09-12T08-12-43-845Z`.
Raw `.intentsmith-artifacts/test-runs/2026-09-12T08-12-43-845Z/report.json`.
Jedna nová hranice byla `module-boundary-ratchet`: šest očekávaných interních
propojů nebylo v dosavadním přesném seznamu. Jejich níže popsané zaznamenání
má samostatný commit podle agent-protocol §6. Test nebyl změněn ani oslaben.

## Záznam změny přesného importního seznamu

Zdroj měření `52c3ffb94b2168f73fbaf006274f98ede66a725e`, čistý pracovní strom.
Použit autoritativní `scripts/module-boundary-ratchet.mjs --write-baseline`
s přesně šesti explicitními `--accept-edge`; žádná wildcard nebo změna limitů.
Celkem **1309 → 1315 hran, žádná odebraná; 3 cykly / 28 souborů beze změny**.
Posouzení implementátorem je níže; nezávislé přijetí konektoru zůstává pending.

| Nová hrana | Důvod v autorizované implementaci |
|---|---|
| `data-host → betting/odds-io` | pevné API resources a jejich scope má core host |
| `data-host → network/outbound-policy` | používá společný auditovaný outbound mechanismus |
| `data-store → db/migrations/...089_m5_outbound_audit` | přebírá přesné existující audit schema/fingerprint, nevytváří paralelní slabší kopii |
| `default-host → betting/data-host` | lazy default core capability |
| `default-host → betting/data-store` | oddělená persistentní evidence hostu |
| `specialist-loader → betting/default-host` | runtime dostane host, balíček nedostane přímou síť/DB |

Žádná hrana ze `specialists/**` do `src/**` nevznikla. Oddělená DB se vytvoří
až při legitimní hostové invokaci, nikoli při discovery nebo neplatném volání
extension capability. Sdílený checkout, cizí procesy, GPU a živá DB se neměnily.

## Zbývající non-PASS a přijetí

Dosavadní větev nese tři samostatné známé non-PASS oblasti, které tato práce
nesmí překlasifikovat na úspěch:

1. `artifact-validation`: rezervační manifest neobsahuje již existující
   `2026_09_11_112_model_hunt_append_only.js`; doloženo i na vstupním kódu.
2. `nightly-orchestrator-self-test`: přijatá Gate 0 policy má původní registry
   fingerprint před přidáním specialistických testů v předchozím WP.
   Registry delta se zde dále nezměnila a přijatá policy nebyla přepsána.
3. `mobile-browser-a11y`: runner vrací FAIL, vlastní log hlásí chybějící
   Chromium runtime/BLOCKED, bez proběhlých assertions.

Osm registrovaných BLOCKED: `chat-export-budget`, `export-pdf-docx`,
`m2-execution-git-preservation`, `m2-execution-process-supervision`,
`m2-execution-project-change`, `m2-lifecycle-application-service`,
`m5-process-hardening`, `workspace-budget`. Jde o jejich deklarované a zatím
nepotvrzené toolchain předpoklady; není to tvrzení, že systém nemá Git.

Závěrečný plný profil na čistém
`13dc20d9bffb2ffdb687ce775cf5176f478e15ce`:
**343 PASS / 3 FAIL / 8 BLOCKED / 0 TIMEOUT / 0 SKIPPED**, verdict FAIL,
exit 1. Run `2026-09-12T08-26-42-188Z`, od 08:26:42 do 08:32:17 UTC;
raw `.intentsmith-artifacts/test-runs/2026-09-12T08-26-42-188Z/report.json`.
Obě sady sázkaře, outbound a module-boundary ratchet prošly.
Registry otisk se nezměnil. Plný profil se neoznačuje jako PASS.

Vnitřní log artifact-validation ukázal kromě známého chybějícího rezervačního
manifestu ještě opomenutý číselník hran v ROADMAP: **156 PASS / 2 FAIL**.
Následná změna je pouze dokumentační: doplňuje 1 315 hran a tento report,
nemění zdrojový kód ani test. Cílená kontrola dokumentace po opravě je uvedena
níže; není zpětným přepsáním výsledku plného profilu.

`node tests/artifact-validation.test.js` po dokumentační opravě:
**157 PASS / 1 FAIL / 0 SKIPPED**, exit 1. ROADMAP census již PASS; jediná
zbývající assertion je přesně známá chybějící rezervace migrace 112.
Log `.intentsmith-artifacts/betting-research-20260912/artifact-final-docs.log`.
`git diff --check` PASS. Poslední commit doplňuje pouze ROADMAP, SYSTEM-MAP
a tuto implementační evidenci; celý profil nad ním opakován nebyl.

Kód není aktivovaný ve sdíleném provozním checkoutu. Chybí skutečný API klíč,
živá validace českých kanceláří, nezávislé review a prospektivní důkaz kvality.
Settlement, plánované doručování, Studio formulář a rozšířené datové zdroje
zůstávají v kontraktu jasně neimplementované.
