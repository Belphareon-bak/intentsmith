# Oprava vzhledu modelových ovládacích prvků a hlášení chyby testu

Autorita: operátor 17. 9. 2026 — Qwen nejde otestovat a nová tlačítka nezapadají do Studia.
Source pro review: `c4186466..08f8d1c5`; UI navazuje na backend z `09cbd0d6`.
Tento rozsah nemění backend, CLI, GPU policy, mazání ani binding autoritu.

Živý log potvrzuje tři operátorovy POST `/api/system/models/evaluate` v
20:27:29, 20:27:42 a 20:27:58 CEST. Všechny skončily HTTP 503 s přesným
`GPU_DRIVER_LIBRARY_MISMATCH`. Kernel NVIDIA je 595.84, NVML 595.91,
modul na disku 595.91.07. Je nutný restart počítače; neproveden.
Hvězdička označuje binding, do API názvu modelu se nepředává.

Tlačítka testování, stažení, přiřazení, obnovy scoringu i huntu používají
stávající motiv C, stejné písmo, rámečky, zaoblení a primární/sekundární barvy.
Filtry mají vlastní přehledný řádek a stejně vysoké vstupy. Chyba/pending testu
je přímo u vybraného modelu a role v Evaluacích i Rolích. Selhání neotevře hunt
jako úspěšně zahájený; stav pending se uvolní a další pokus zůstává možný.

Zaměřené testy: desktop 18, read model 19, Studio client 132, artifact 158 PASS.
První zápis nové testovací fixture měl syntaktickou chybu; zachováno jako
desktop-test.log. První běh Studio client fixture postrádal nové helpery;
opraven pouze setup vykonávající skutečný renderer, zachováno studio-test.log.
První celý profil na `1fd1391e` byl vědomě přerušen při vizuální opravě výšky
filtru: 210 PASS, 1 přerušený FAIL, 148 SKIPPED. To není zelený běh ani regresní
nález. Finální profil se spustil znovu na čistém `08f8d1c5`.

Fyzický Electron má řízený backend, privátní user/network namespace,
NODE_ENV=test a diagnostický --no-sandbox. Pozitivní cesta a síťová policy
se nemění. Následný samostatný negativní test probíhá až po ukončeném baseline
network capture: skutečný nativní confirm, skutečný POST z rendereru pro
qwen3.5:27b/CODE, skutečná HTTP 503 a assertion alertu uvnitř téhož řádku.
Negativní odpověď není maskována jako 2xx ani zahrnuta do pozitivního network
PASS. Request/response ID, tělo, potvrzení a viditelnost mají vlastní JSON.
Screenshoty dokládají vzhled; nepředstavují nové GPU skóre.

Evidence root: `/home/belphareon/Projects/coworker/intentsmith-model-controls-followup-20260917`.
Předchozí archiv a review zůstávají beze změny. Nezávislé review je pending.

## Finální výsledek na 08f8d1c5

**INSTALLED / REVIEW_PENDING / GPU_SCORING_BLOCKED**. Celý offline/database
profil: **358 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT**; celkový verdict FAIL.
Jediný non-PASS je již existující registry seal v nightly-orchestrator-self-test.
Finální fyzický Electron PASS včetně následného negativního testu a jeho
nativního potvrzení. Výšky tří filtrů jsou změřené 30/30/30 px.
Build SHA-256: `ee6fee696641c5f3decf3295211ba23980116d205a6261a5b855480290984921`.

Instalován čistý detached snapshot `08f8d1c5e8dd888650e4dad4d301110177a28b69`.
Launcher --check PASS. Živý POST Qwen/CODE správně odmítnut HTTP 503
GPU_DRIVER_LIBRARY_MISMATCH; ruční unit inactive. Backend i timer active,
timer enabled. Nové GPU skóre nevzniklo, počítač nebyl restartován.
Před/po instalační záloze jsou shodné hashe 503 evaluací, 220 rozhodnutí,
7 desired bindings a 11 binding operations; quick_check OK a 0 FK chyb.
Startup přidal své rehydrate/verification attempts a finalize receipts;
neslibuje se byte-identita celé DB.

Raw evidence, screenshoty a source bundle jsou připnuté manifestem
(616 souborů) a lokálním archivem v nadřazeném coworker adresáři:
`intentsmith-model-controls-followup-sha256-fd0dd3a4df0e365b68ade071f20b08f173b40c34e21b74cd4606d60a40585e26.tar.gz`.
SHA-256: `fd0dd3a4df0e365b68ade071f20b08f173b40c34e21b74cd4606d60a40585e26`.
Source bundle zachovává původní historii včetně již deklarovaných historických
privacy nálezů. Archiv neobsahuje produkční DB, runtime credentials ani config
backup; nebyl zveřejněn. Původní rozsah a evidence:
[model controls](2026-09-17-HUNT-MODEL-CONTROLS.md).
