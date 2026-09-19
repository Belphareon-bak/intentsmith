# Úklid pracovních kopií po dokončení projektového flow

Stav: **PLANNED_AFTER_PROJECT_FLOW / INVENTORY_ONLY**.
Autorita: explicitní požadavek operátora 2026-09-19 uvolnit co nejvíce místa,
ale až po dokončení aktuální práce. Tento dokument neoznačuje projektové flow
za hotové a nepotvrzuje odstranění žádných dat.

Předchozí práce: [obecné projektové flow zkoušené na SystemSmith_1](WP-SYSTEMSMITH-PROJECT-FLOW-20260919.md).
SystemSmith_1 je zkušební zadání. Cílem jsou přenositelné schopnosti stavby
nových i převzetí existujících projektů, nikoli specializace produktu na
systémové monitory.

## Výchozí měření 2026-09-19 kolem 08:55 CEST

`df -h /home/belphareon /tmp`: filesystem `/home` 477 GiB celkem,
427 GiB využito, 46 GiB dostupných, 91 %. `/tmp` je samostatný tmpfs,
83 MiB využito; jeho úklid neuvolní místo na `/home`.

`du -xhd1` / `du -sh`, zaokrouhlené hodnoty, bez následování symlinků:

| Oblast | Obsazeno | Co prověřit před úklidem |
| --- | ---: | --- |
| `~/worktrees` | 70 GiB | Absorbované větve, nepoužívané checkouty, testovací sandboxy |
| `~/Projects` | 61 GiB | Pracovní kopie a reprodukovatelné buildy, nikoli plošně projekty |
| `~/Projects/intentsmith-audit-20260911-FNF2jj` | 25 GiB | Podmnožina Projects; staré runtime adresáře vedle zachovaných důkazů |
| `~/Projects/intentsmith-review-20260917` | 13 GiB | Podmnožina Projects; cizí review kopie, vlastnictví/užívání neověřeno |
| `~/.local/share/intentsmith/releases` | 42 GiB | Aktivní runtime, běžící Studio, rollback a vazby instalačních dokladů |
| `~/.local/state/intentsmith/installation-backups` | 1,9 GiB | Zachovat obnovitelnost a doloženou retenci |
| `~/.cache` | 3,8 GiB | Ověřit původ a použití, největší Puppeteer 2,3 GiB |

To jsou obsazené velikosti, **nikoli množství bezpečně odstranitelného místa**.
Podmnožiny se nesčítají s rodičem. Aktivní instalace při měření:
`d22f64ac2328f1c0b109b2fce94c5f7943448033`, backend aktivní PID 2529279.
Hlavní checkout IntentSmithu zůstává na `832db06f`; probíhá i cizí práce,
včetně měření CODE. Aktuální editorový odkaz operátora míří do
`~/worktrees/is-mobile-completion-20260908`; stáří adresáře není důkaz nečinnosti.

## Provedení až po předchozí práci

1. Obnovit inventuru velikostí, všech relevantních Git kořenů/worktreeů,
   větví, neodeslaných commitů a dirty/untracked/ignored dat. Znovu zjistit
   procesy, cwd, otevřené soubory a odkazy služeb, timerů, symlinků i závislostí.
2. Začít starými jednorázovými testovacími prostředími, která už mají
   uchované reporty a logy. Použít workspace-budget jako podklad a ověřit
   přesné cíle; nemazat celou `.intentsmith-artifacts` ani spoléhat jen na cwd.
3. Odstranit pouze nepoužívané pracovní kopie s prokázaně zachovanými commity
   a vypořádanými lokálními daty. Zachovat cizí rozpracovanou práci a důkazy.
   Samostatné klony prověřit zvlášť; jediný `git worktree list` je nepokrývá.
4. Prověřit reprodukovatelné buildy/cache. Nainstalované releasy řešit až
   s vazbami na aktivní procesy, návratovou verzi a instalační/M6 doklady;
   neodstraňovat jednotlivé soubory z integritně vázané instalace.
5. Uložit seznam skutečně odstraněných cest a důvodů, změřit `df`/`du` po
   úklidu, ověřit backend/launcher a zachování referencovaných důkazů.
   Rozlišit součet odstraněných adresářů od skutečné změny volného místa.

Úklid zachová používané modelové artefakty, databáze, konverzace a uživatelské
projekty; cizí běžící úlohy nebude ukončovat kvůli odstranění jejich souborů.
Nejasně vlastněné položky mají stav UNKNOWN do jejich prověření.
