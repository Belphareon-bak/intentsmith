# Kontrakt: obecné autonomní zlepšování modelu

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Autorita návrhu: zadání operátora
2026-09-11; nyní platí PRODUCT §3 a L0-9/L0-11/L0-13 beze změny.

## Výsledek a rozsah

Po explicitním zapnutí programu systém sbírá povolené zkušenosti, sestavuje
trénovací kandidáty, automaticky provádí omezené experimenty a předloží
lepší ověřený modelový artefakt. Zlepšení vah/adaptérů se vykazuje odděleně
od změny promptu, retrievalu, paměti a výměny základního modelu. Samotný
lepší prompt nebo higher aggregate skóre není dokončením tohoto kontraktu.

„Obecné“ znamená přenos do více předem vymezených úloh a projektů, ne
garantované zlepšení libovolného úkolu. První experiment má porovnat
parameter-efficient adapter a prompt/retrieval baseline na stejném základu.
Plný trénink velkého modelu není předpokládaná vlastnost jedné 24GB GPU.
Adapter musí mít přesnou identitu základních vah a tokenizeru; ověřit se
musí i export, kvantizace a skutečné spuštění přes podporovaný provider.
Viz [primární dokumentace PEFT checkpointů](https://github.com/huggingface/peft/blob/main/docs/source/developer_guides/checkpoint.md).

## Kontrakty a životní cyklus

Navržené typy: `LearningConsent@1`, `TrainingDatasetManifest@1`,
`TrainingRun@1`, `ModelCandidate@1`, `PromotionDecision@1`.
Manifest nese source/project/revision IDs, souhlas, původ/licenci dat,
redakce, časovou a projektovou příslušnost, dělení datasetu a digests.
Run nese base/adapter/tokenizer digests, kód/environment, seed, hyperparametry,
rozpočet GPU/RAM/disku/času a skutečné náklady. Výsledek smí být také
FAILED, CANCELLED, INCONCLUSIVE nebo NO_IMPROVEMENT.

`eligible evidence → curated dataset → train → evaluate → independent review
→ proposed promotion → explicit activation → observe → retain/rollback`.
Použít stávající model registry, evaluator, role binding a usage authority;
nevytvářet druhé úložiště modelových identit nebo přímé zápisy do DB.
Předběžné vlastněné oblasti: `src/learning/**`, adapter existujícího
`src/upgrade/**`/model registry a odpovídající interní kontrakty; změna
veřejného connectoru potřebuje review jeho producenta i konzumentů.

## Ochrany a skutečné měření

- Trénink jen z explicitně povolených dat; odhlášený projekt a cizí tenant
  nemají jediný příklad v datasetu. Tajemství ani autentizační materiál nepatří
  do datasetu. Syntetický výstup modelu není automaticky správná reference.
- Dělit po projektech, čase a původu; deduplikovat také near duplicates.
  Held-out a skryté regresní úlohy nejsou dostupné generátoru tréninku ani
  použité k iterativnímu ladění. Samohodnocení autora nestačí.
- Předem zmrazit metriky: úspěch reálných úloh, CZ/EN, factuality, bezpečnost,
  instrukční poslušnost, p95, paměť a náklady. Párové opakované měření,
  nejistota a minimální praktické zlepšení; jednotlivé role mají vlastní
  verdict. Žádná aktivace z průměru, který zakryje kritickou regresi.
- Autor a reviewer zachovají přijatou nezávislost artefaktů. Negativní
  testy pokryjí poisoning, reward hacking, memorization a cross-project leak.
- Jedna GPU autorita, žádné vytlačení aktivní uživatelské práce, pevný
  počet experimentů, deadline a stop/kill/recovery. Pád nezanechá aktivní
  neúplný checkpoint; opakování nemůže překročit celkový rozpočet.
- Mazání datasetu není zapomenutí v natrénovaných vahách. Revokace souhlasu
  blokuje nové použití, označí všechny odvozené kandidáty a vyžádá stažení
  nebo přetrénování bez daných dat. Historická auditní stopa neobsahuje obsah.

## Akceptační demonstrace

Na dvou oddělených projektech a nejméně třech zmražených kategoriích úloh
porovnat původní model, pouze lepší kontext a nový adapter. Zlepšení musí
přetrvat na neviděných datech a po exportu do skutečného providera, bez
porušení regresních mezí. Ukázat zamítnutí horšího kandidáta, cancel tréninku,
restart, explicitní nasazení, rollback a revokaci datasetu. Vše s přesnými
artefakty a nezávislým review. Bez zlepšení kontrakt není splněný.

Implementační WP musí předem definovat spustitelné testy těchto hranic,
hardware dataset a freeze kvalitativních prahů. Bez nich je implementace
blokovaná; tato dokumentace není výkonnostní ani kvalitativní důkaz.
