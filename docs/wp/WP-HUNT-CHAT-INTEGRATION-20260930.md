# GPU hunt + chat + Studio 2 — integrační kandidát

**Stav:** SOURCE_MERGED_CANDIDATE / OFFLINE_FOCUSED_PASS / REVIEW_PENDING /
NOT_DEPLOYED / REAL_NO_GO. Tato pracovní větev vychází z chat/Studio 2 commitu
`09247504143ac0a37d75d7d52867768447790ad2` a slučuje přesný Hunt commit
`e37189b252a195f30e98b8f58ab25ec68dba7d85` se zachováním obou rodičů.
Žádný krok tohoto WP neotevírá GPU, Ollamu, živou DB, timer, instalovanou
službu ani modelové vazby. Zveřejnění větve není nezávislé přijetí kandidáta.

## Vlastněný rozsah

- Sjednotit chatové skládání historie: archivní souhrn, uživatelské opravy,
  rozpočet okna, CODE retry a projektovou instrukci. Konfliktní větev
  `decisions.js` vyžaduje ještě porovnání s paralelní opravou těsného kontextu.
- Převzít Hunt sběr, nezávislé dvojí známkování, arbitráž, rozhodovací metodu,
  plán/retenci a jejich zdrojová historická evidence. Schéma má migrace
  117, 118, 119 a 120 v tomto pořadí, celkem 107.
- Sloučit registr přes ID sad: 568 programů, 474 ACTIVE, 79 BLOCKED,
  15 HISTORICAL a 23 explicitních support vyloučení. Generovaný katalog
  vzniká kanonickým validátorem.
- Přenést dostupný detail uložených odpovědí a obou posudků do skutečného
  `intentsmith-studio2` modelového pracoviště a jeho prototypové šablony.
  Historický `chat-panel-module.js` zůstává odstraněný; historický simulační
  report si jeho tehdejší renderer připíná přes Git objekt Hunt commitu.

## Dosavadní důkazy v izolované větvi

| Kontrola | Výsledek | Meze |
|---|---|---|
| Chat contract | 36/36 PASS | deterministické scénáře |
| Migration schema | 61/61 PASS | nové dočasné DB, žádná živá DB |
| Model failover schema | 20/20 PASS | nové dočasné DB |
| Evaluation read model | 20/20 PASS | single-grader známka jen historická, aktuálně BLOCKED |
| Nové Hunt suite | 12/12 PASS | poslední úplná simulace trvala 116 s; bez inference |
| Studio 2 model workspace | 9/9 PASS | přesné ID detailu, transkript, dvě revize, rozsouzení, fail-closed odlišná identita |
| Detail uložených posudků | 24/24 grading acceptance, 21/21 read model, 9/9 Studio 2 PASS | `GET .../evaluations/:runId` nyní ověřuje oba append-only posudky a případné rozsouzení; zdrojový běh zůstává neměnný, skóre sporu je null až do ověřeného COMPLETE řádku; test Studia používá skutečný výstup read modelu |
| Studio 2 view | PASS | shoda generovaného rendereru s prototypem, scénáře a 3000 fuzz kroků |
| Desktop hunt | 34/34 PASS | Node 24 v `PATH`, lokální izolované závislosti |
| Module graph | 1457 hran, 3 cykly / 28 členů; ratchet PASS | 23 nových přesných hran přijato oficiálním nástrojem nad čistým merge commitem `e20a7265` |
| Celý offline/database profil | **399 PASS / 1 FAIL / 0 BLOCKED**, verdikt FAIL | sériový běh na čistém `4edd1be6`; jediný FAIL je neaktualizovaná zapečetěná Gate 0 politika registru; report `.intentsmith-artifacts/test-runs/hunt-chat-integration-serial-4edd1be6/report.json` |

## Neuzavřené brány

1. Při extrémně těsném okně může být vybrán souhrn, ale jeho zkrácení odstranit
   konkrétní fakt; starší uživatelský údaj se také nemusí vejít. Přítomnost
   řádku `summary` není důkazem zachování jeho významu. Tato integrační
   varianta čeká na porovnání s paralelní fail-closed opravou a nezávislé review.
2. Sjednocený zdroj ani syntetická simulace nejsou důkazem aktuálních živých
   skóre. Poslední read-only kontrola instalovaného provideru uváděla 84/84
   použitelných model–role dvojic `MISSING`, žádné přijaté rozhodnutí.
   Druhý skutečný posudek a rozsouzení celé matice, kvalifikace hodnotitelů,
   rozhodovací holdout a provozní revize stále chybějí.
3. Celý offline/database profil na `4edd1be6` není zelený: 399/400 PASS,
   zapečetěná Gate 0 pečeť registru zůstává FAIL. Nezávislé zdrojové review
   nové projekce posudků a nové live acceptance se provádějí samostatně;
   celý profil po této opravě nebyl znovu spuštěn. Instalace a mobilní
   napojení nejsou součástí tohoto kandidáta.

**Předání:** [aktuální projektový checkpoint](../review/2026-09-30-COMPLETION-TRACKER.md)
je časově označený snímek před tímto sloučením. Hunt matice a její přesné
hranice jsou v [matrici 28. 9.](../review/2026-09-28-HUNT-MATRIX-COMPLETION.md).
