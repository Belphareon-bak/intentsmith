# 030 — Jedna current-contract autorita modelových evaluací

**Stav:** implementováno, čeká na nezávislé review · **Datum:** 2026-08-25
**WP:** `WP-MODEL-EVALUATION-CONSOLIDATION` · **Migrace:** 082

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
6. Automatický failover/proof issuer není zapnut. Historické proof DB schema a
   rozhodnutí 006/015 zůstávají auditní stopou, nikoli dnešním issuing
   kontraktem. Jejich případné budoucí oživení vyžaduje nové current-suite
   rozhodnutí a nezávislé review.
7. Každá role má víceúlohové supply minimum a minimálně dvě stabilně
   rozlišující úlohy; CHAT navíc samostatné EN/CS minimum.
8. Katalog, universe a provozní telemetry nesmějí odvozovat lokální quality
   score, blacklist ani doporučení. Uchovávají pouze fakta či raw provozní
   události; externí benchmark může pouze prioritizovat měření.
9. Pairwise výhra je akční až po portfolio solveru. Read model vyžaduje
   explicitní `activationEligible=true`, jinak fail-close vrátí
   `PORTFOLIO_NOT_APPROVED`.

## Důsledky

- name-only nebo jiný digest nikdy není současný výsledek;
- timestamp se čte přímo, bez arbitrárního 14denního přeznačení;
- cleanup selže zavřeně při neznámém digestu usage nebo ne-COMPLETE evaluaci;
- historické docs a migrace mohou obsahovat staré názvy, ale produkční source,
  route, registry a aktivní test ledger ne;
- implementační green znamená nejvýše `REVIEW_PENDING`, dokud operátor
  neprovede nezávislé review a všechny milníky nejsou PASS.
