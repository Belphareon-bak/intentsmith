# Produkční follow-up: podklady pro nezávislé review

Stav: IMPLEMENTED_CANDIDATE / REVIEW_REQUIRED. Autorita: explicitní zadání
operátora, PRODUCT §3 a přijatý WP-M2-LIFECYCLE-V1. Tento packet není nový
kontrakt ani acceptance verdikt.

## Připnutý rozsah

Předchozí auditový kandidát: `8f9fb230009e44de528a5df62ce63f43234fa08e`.
Společný implementation/test source: `c6c9ee3a4c687729d0f266277dee5b9279c9880d`.
Delta: `git diff 8f9fb230..c6c9ee3a`. Kumulativní audit navazuje na
`983121eece58b8522f736d4c8bc7c7e0ea4f657a`; není zatím sloučen do živého
konsolidačního checkoutu.

Root vlastní backend a integraci; druhý writer pracoval v existujícím
model-spec6000 checkoutu pouze na Studio consumeru a jeho regresích. Dva další
read-only proudy zkontrolovaly integraci a model containment. Studio větev je
zachovaná v merge DAG. Cizí checkouty, produkční DB a modelové bindingy zůstaly
nedotčené. Žádný další worktree nevznikl.

## Pozorovatelná změna produktu

`/m2-draft src/app.js, src/helper.js :: popis změny` přijímá nejvýše tři explicitní
JS/MJS/CJS soubory. Každý generuje jediným sériovým CODE požadavkem v kanonickém
pořadí cest. Všechny původní soubory projdou preflight před prvním hovorem;
předchozí navržené peer obsahy vstupují do dalšího hovoru v úplnosti pod stejným
limitem. Částečný výsledek se neukládá jako plán ani nezapisuje do projektu.

Hotová dávka prochází existující strict proposal/governance cestou. Studio
ukáže všechny before/after obsahy a přesný plán. Jediné `/m2-approve` spustí
stávající atomický ProjectChange, právě jeden focused process a případný rollback.
Defaultní focused process parsuje všechny cíle bez spuštění jejich kódu;
funkční správnost potvrzuje pouze explicitně dodaný behaviorální test.

`/m2-cancel` nyní funguje také během approval/focused testu, i při souběžném M1
turnu. Odešle durable cancel se stejnou identitou plánu; neodvozuje zrušení z
pouhého odpojení HTTP. Obě pořadí odpovědí zachovají terminál a pozdní pending
odpověď ho neotevře znovu.

## Opravené nálezy a původ

| Nález | Výsledek a důkaz |
|---|---|
| Studio blokovalo cancel během approve | `1d5cd383` + `782849d5`: VM skutečného dispatcheru a chat entry, obě pořadí HTTP, duplicitní cancel, transportní chyba, stale origin a konfliktní terminály. |
| CJS source mohl uniknout textovému parserovému wrapperu a projít chybně | `dada8bc7`: `vm.compileFunction`; skutečný parser odmítne `}); void 0; (function(){`, přijme validní CJS top-level return a nic nevyhodnocuje. |
| Cesta `--eval=process.exit(0),x.js` mohla přepsat Node program | `9ececb27`: `--` před všemi cestami; validní i chybný obsah takto pojmenovaného souboru se skutečně parsuje. |
| Cancel/timeout při posledním context pin se hlásil jako unavailable | `c6c9ee3a`: normalizace pouze při odmítnutí preparation, žádná abort kontrola po úspěšném uložení plánu. |
| Legacy gateway mohl obejít strop role | Převzatý `dca0e89b` jako `9019766d`, 32 focused PASS; zachované výchozí hodnoty a oddělené skutečné stropy. |
| Transportní chyba měření se mohla uložit jako COMPLETE se skóre nula | Minimální produktová/testová delta `0e563cc8` jako `97cc4ea3`; 37 pairwise + 62 upgrade PASS, bez závislosti na novém hunt schématu. |

Read-only engineering review zkontrolovalo finální multi-file backend na
`c6c9ee3a`; předané P1/P2 byly opraveny. Tyto spolupracující agentní kontroly
nejsou požadované nezávislé Claude Opus `--effort max` review ani operátorská
acceptance. Původní SPEC review mělo CHANGES_REQUIRED; centrální oprava a nové
240s SPEC chování vyžadují re-review v úplném kumulativním řezu.

## Mapa pro recenzenta

- `src/lifecycle/m2-code-draft.js`: exact vstup, fixní parser, JSON výstup, limity a jeden CODE adapter.
- `src/lifecycle/m2-lifecycle-application-service.js`: `draftSmallProjectChange` → re-pin → `prepareSmallProjectChange` → stávající authority/governance/execution.
- `src/routes/m2-lifecycle.js`: autentizovaný POST draft, disconnect/cancel, explicitní origin a existing status/approve/cancel.
- `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`: skutečně udržovaný Studio consumer, multi-file input, celý diff a souběžný durable cancel.
- `tests/m2-lifecycle-application-service.test.js`: skutečný SQLite/Git/bwrap, tři soubory, funkční import, rollback posledního vadného souboru, druhý nedokončený výstup/cancel/stale, budget a no-partial-plan.
- `tests/m2-lifecycle-studio-surface.test.js`: spuštění skutečných browser funkcí ve VM; není náhradou Electron journey.
- `tests/m2-code-draft-model.test.js`: fyzický CODE adapter, dva soubory, 12 Gregorian assertions, přesný approval a rekonstrukce služby.

## Přiznané limity

- Nejvýše 3 malé soubory; existující soubor do 1600 B, instrukce do 512 B a system+celý prompt do 2200 B. Výstup do 8192 B na soubor, ale peer kontext může další hovor dříve odmítnout. Žádné automatické krácení nebo retry.
- Produkční kontext 4096 a max 1536 výstupních tokenů na hovor; celá generace včetně přípravy má 120s deadline. Vybraný soubor beze změny je důvod odmítnout celou dávku.
- Není to celý projektový builder, nové programovací jazyky, autonomní plánování nebo důkaz porozumění rozsáhlému projektu. Post-release kontrakty zůstávají DRAFT/NOT IMPLEMENTED.
- Modelový test volá produkční službu přímo; neprochází inicializací serverového DURABLE binding startup authority. Raw provider digest se ověřuje nezávisle, ale spojený Studio→HTTP→binding→model→approval→execution→restart procesu stále není doložen.
- Rekonstrukce služby není restart celého procesu. Samostatné Studio, HTTP a modelové důkazy se nesčítají do jednoho uživatelského journey.
- M5 chybí podepsané category/history receipts, druhá ověřená offline kopie operátorských klíčů a acceptance. Novější upstream custody záznam navíc drží reviewer-key recovery jako NOT_RUN před odstraněním online kopie. Operátorova historie „žádné skutečné přístupy“ je zaznamenaný nepodepsaný fakt, nikoli vyrobená rotace nebo receipt.

## Integrace s další živou prací

Konsolidační upstream byl read-only připnutý na `d7781a8e`. Jeho novější dirty
hunt/eval práce má UNKNOWN vlastníka. Nepřebírat rozpracovanou migraci
`2026_09_11_111_model_hunt_provider_identity.js`: toto číslo v našem kandidátu
už patří `2026_09_11_111_conversation_web.js`. Vyžaduje společné nové číslo a
schema/upgrade ověření, nikoli mechanický merge. Širší hunt/autocheck opravy
`c09f7d76`, `3cb23831`, `0cbe8e2a` nejsou v tomto řezu; jejich šest module edges
se při budoucí integraci musí přičíst k vlastnímu baseline, ne jej přepsat.

## Ověření tohoto společného kandidátu

| Důkaz | Výsledek |
|---|---|
| Celý deterministic profil | 353/353 PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED; všech 353 log hashů ověřeno |
| Production HTTP | 24/24 kroků PASS, exact prepare/approve/test/Git/status + multi-file scope odmítnutí |
| Studio build | PASS; oba skutečné Electron programy 2/2 PASS, soukromý Xvfb ukončen, source čistý |
| Skutečný CODE model | 2 soubory, 2 dokončené hovory přesného Qwenu, 4096/1536, 12 funkčních assertions PASS, 35.448s |
| Registry/artifact/diff | PASS; registry 515 programů beze změny |

Celý měřený rozsah běžel na c6c9ee3a se současnými závislostmi. Build vznikl na
9ececb27 se shodnými Studio bytes. [Podrobné příkazy, failure historie a modelová
hranice](../execution/runs/multifile-code-draft-20260911.md).

Manifest `401` artefaktů: `.intentsmith-artifacts/production-followup-evidence.json`,
SHA256 `913d76af40884ffca86c39c4c5c4ce98522d18ce4096ba9fa98a42565bf711b5`. Přenosný archiv důkazů:
`.intentsmith-artifacts/production-followup-evidence.tar.gz`,
SHA256 `4283edc99d4d495ea46f0e2c0797eff0721bf06e4843e4f82d26fefd3ef727aa`. Každý člen archivu byl znovu zkontrolovaný proti manifestu.
Cesty archivu začínají `snapshot/`, `model-spec6000/` nebo `.intentsmith-artifacts/`
podle původního umístění pod společným auditovým rootem.
Kumulativní Git bundle: `.intentsmith-artifacts/intentsmith-production-review-20260911.bundle`,
vyžaduje existující base 983121ee; jeho přesný hash a final HEAD jsou v
`.intentsmith-artifacts/production-followup-handoff.json`. Žádný push se neprovedl.

## Otázky pro nezávislé review

1. Může model změnit cíle, test, projekt, actor/origin nebo udělit approval? Sledujte finální serializovaný plán.
2. Dodržují všechny hovory společný deadline, kompletní peer kontext a no-partial-plan pravidlo při pozdějším selhání?
3. Odmítá závěrečný pin stale root/revision a zachová approval/test/cancel jeden pravdivý durable terminál a atomický rollback?
4. Jsou cesty bezpečně oddělené od Node options a syntaktická kontrola oddělená od funkčního tvrzení?
5. Platí role ceiling i přes legacy gateway a neskryje agregace provider selhání?
6. Odpovídá každé readiness tvrzení přesnému source, závislostem a skutečně provedené uživatelské hranici?

Nejbližší další výsledek: nezávislé review tohoto přesného řezu, následně
spojený Studio/server/model journey a vyřešení kolize při konsolidaci. Rozšíření
na větší aplikaci potřebuje deterministicky vybraný kontext a funkční acceptance;
pouhé zvýšení tokenových limitů není doložené řešení.
