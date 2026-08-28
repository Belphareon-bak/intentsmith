# 030 — Jedna current-contract autorita modelových evaluací

**Stav:** `IMPLEMENTATION_GREEN / REREVIEW_REQUIRED` · **Datum:** 2026-08-28
**WP:** `WP-MODEL-EVALUATION-CONSOLIDATION` · **Migrace:** 082, 096, 097, 099

## Kontext

Projekt současně nesl v123 name-only scoring tabulky, HTTP/WS/UI validační
runtime, v136.1 exact-artifact historii a samostatnou v123 proof-measurement
cestu. Stejný model proto mohl mít několik různých „skóre“ bez jednoznačné
role, digestu, contractu a stáří. Operátor rozhodl paralelní starou implementaci
odstranit; C3 repo zůstává případnou historickou referencí.

## Rozhodnutí

1. Jedinou autoritou měření je append-only `model_evaluation_runs`, current
   pouze při shodě exact digestu a versioned suite contract SHA.
2. Jedinou autoritou čtení je `ModelEvaluationReadModel`; API, CLI, Studio,
   governor a registry nesmějí sestavovat vlastní agregát ani TTL fallback.
3. Role decision se ukládá append-only do `model_evaluation_decisions` s odkazy
   na oba COMPLETE runy a přesnou politikou.
4. Binding a evaluace jsou různé autority. Hunt nesmí binding změnit; ruční
   exact-digest binding application zůstává jedinou aktivační cestou.
5. v123 runtime, endpointy, UI/WS, report a proof-measurement skripty se mažou.
   Migrace 082 nejprve ověří import, archivuje důkaz a až potom dropne staré
   runtime tabulky.
6. Veřejné repository writery automatického failover/proof lifecycle jsou
   odstraněné. Historické proof DB schema a rozhodnutí 006/015 zůstávají
   upgrade/auditní stopou, nikoli dnešním issuing kontraktem. Jejich případné
   budoucí oživení vyžaduje nové current-suite rozhodnutí, implementaci a
   nezávislé review.
7. Každá role má víceúlohové supply minimum a minimálně dvě stabilně
   rozlišující úlohy; CHAT navíc samostatné EN/CS minimum.
8. Katalog, universe a provozní telemetry nesmějí odvozovat lokální quality
   score, blacklist ani doporučení. Uchovávají pouze fakta či raw provozní
   události; externí benchmark může pouze prioritizovat měření.
9. Pairwise výhra je akční až po portfolio solveru. Read model vyžaduje
   explicitní `activationEligible=true`, jinak fail-close vrátí
   `PORTFOLIO_NOT_APPROVED`.
10. Suite contract používá explicitní vykonávaný promptový a grading materiál,
    včetně jazyka, rubric, VISION image digestů a CODE `buildPrompt`; closure
    source není prompt identity.
11. Nedostatečný kvalitativní důkaz je `INCONCLUSIVE`. Propustnost jej nesmí
    změnit na vítězství a DB outcome se odvozuje ze stabilního `reasonCode`.
12. Usage digest je observed runtime identity pouze z přímé provider response.
    Exact inventory pod lease dokládá očekávání, ne obsloužený artefakt;
    desired binding ani druhý inventory snapshot se pro usage audit nepoužijí.
13. Nový autoritativní scoring běh musí předat očekávaný exact artefakt runneru
    a každá provider response jej musí přímo attestovat digestem. Chybějící či
    jiný digest je terminální chyba, nikdy `COMPLETE` score.
14. Applicability měření má vlastní verzovaný kontrakt a znamená technickou
    kompatibilitu. Discovery `preferredCategories` jsou pouze ranking prior a
    nesmějí vytvářet `NOT_APPLICABLE`.
15. Current a reuse identity zahrnuje současně `suite_name`, `suite_version` a
    `suite_contract_sha256`; žádná z těchto částí není volitelná.
16. `started_at` a `completed_at` jsou skutečné hranice modelového běhu.
    Artifact-wide VRAM spill lze bez nového modelového loadu převzít jen pro
    exact digest, shodné GPU a shodný context window a musí odkazovat na
    původní placement run.

## Důsledky

- name-only nebo jiný digest nikdy není současný výsledek;
- timestamp se čte přímo, bez arbitrárního 14denního přeznačení;
- cleanup selže zavřeně při neznámém digestu usage nebo ne-COMPLETE evaluaci;
- model bez usage řádků používá jen provider `modified_at` grace clock; jakýkoli
  neověřitelný či malformed usage řádek retenci zablokuje, nikoli uvolní;
- historické docs a migrace mohou obsahovat staré názvy, ale produkční source,
  route, registry a aktivní test ledger ne;
- role je součást exact run identity i decision lineage; role-neutral měření by
  vyžadovalo vlastní explicitní schema a nové rozhodnutí;
- raw telemetry smí zůstat diagnostická, ale nesmí produkovat derived
  `disabled` stav ani vstupovat do manual bindingu či discovery;
- implementační green znamenal nejvýše `REVIEW_PENDING`; candidate `d8a2a108`
  přešel na `ACCEPTED` po nezávislém rereview a reprodukci `227/227` v runu
  `2026-08-25T17-15-48-322Z`; navazující review později našlo blokující
  migrační kolize. Následná coverage revize rovněž našla parser drift,
  preference vydávané za nepoužitelnost, neúplnou suite identity, falešné
  start timestampy a neuzavřenou evidenci. Tyto nálezy jsou implementačně
  opravené a čistý finální gate na `03134931` prošel `279/279` v runu
  `2026-08-28T18-12-18-428Z`, ale současný candidate zůstává
  `REREVIEW_REQUIRED`, nikoli `ACCEPTED`.
