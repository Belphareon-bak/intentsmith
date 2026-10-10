# Workery a specialisté IntentSmithu — audit 2026-10-10

**Výsledek: dvě prokázané chyby opraveny; lokální worker scénáře PASS;
celkové specialistické ověření PARTIAL. Stav kandidáta REVIEW_PENDING / NOT_DEPLOYED.**
Zbývá jeden registrovaný účetní HTTP test FAIL a živé ověření odpovědí modelů
BLOCKED_GPU. Počty testů ani publikace větve nejsou integrační přejímkou.

## Rozsah a přesná identita

Operátor požádal o funkční ověření a opravy během práce na IDE. Postup:
inventarizace zdrojů a běžícího produktu → izolované testy → reprodukce chyby
na skutečném HTTP/SQLite → oprava s negativními kontrolami → závěrečné gate.
Autorita a zapisovaný scope jsou ve
[WP](../wp/WP-WORKER-SPECIALIST-AUDIT-20261010.md).

| Objekt | Ověřená identita / stav |
|---|---|
| GitHub main při startu | `138e958be927df9835c091d3ad41d44b347e85b5` |
| Testovaná IDE baseline | `46337ee66f8788f9ca2f041c165d4e35b3f242cf` |
| Oprava workeru a skutečný 5m soak | `7f546eff1fd8bc3f851b15b7d52efb063551754e` |
| Zdroj obou oprav a závěrečných gate | `4defa69ed4abb542535425ec79e752d955676af6` |
| Běžící release, oddělený od kandidáta | `3c804a8a859a9f44efd200585795f5373e85fc3c`, PID `976926` |
| Vlastní větev | `work/worker-specialist-audit-20261010` |

Vlastní checkout vychází z živě ověřeného main a fast-forward přebírá čistý
IDE backend. Hlavní checkout má cizí změny s vlastnictvím UNKNOWN; žádné nebyly
převzaty. Oba opravované runtime soubory byly v IDE baseline a běžícím release
bajtově shodné. Opravy tudíž řeší i chyby přítomné v release, ale dosud tam
nejsou nasazeny. Frontend, IDE checkouty, provozní DB, modelové bindingy,
ovladače a cizí dlouhý soak zůstaly mimo zásahy této práce.

Read-only inventura provozu: aktivní `accountant-cz 2.1.0`, `code-reviewer 1.1.0`,
`sazeni 3.2.0`, `translator 1.0.0`; jediná dostupná worker šablona
`project-health`. Scheduler běží, ale nemá naplánovanou instanci.
Funkční scénáře tedy běžely na vlastních produktových procesech a databázích.

## Opravy a reprodukce

1. **Přejmenování workeru mazalo stav a posouvalo plán.** PUT konfigurace
   přepisovalo `state` na `{}` i při změně pouhého názvu/popisu. Po nové změně
   projektu worker vytvořil `INIT_BASELINE` místo notifikace. Oprava porovnává
   validované parametry: prezentace zachová baseline, cooldown i due time;
   změna parametrů stále resetuje baseline a přeplánuje běh.
   Rozšířeny stávající produktový HTTP test a skutečný 5m soak, bez odstranění
   původních assertions. Ověřen také stale digest, restart a změna projektu.
   Reprodukční test byl před opravou červený a po ní zelený.

   Skutečný soak: interval `300000 ms`, první změnový běh a jediná notifikace
   pozorovány po `300492,7 ms`, 150 kontrol před due time; rename nezměnil
   state ani plán, restart zachoval další termín, manuální opakování
   nevytvořilo duplikát. Provider model calls `0`. Testovaný worker soubor
   i soak test jsou mezi `7f546eff` a `4defa69e` bajtově shodné.

2. **Nedostupný či odmítající specialistický host obcházel fail-closed.**
   Příprava účetního/betting hostu byla před `try/catch` executorové chyby.
   Explicitně vybraný účetní s chybějícím hostem vracel nabídku jiné expertízy
   namísto neúspěchu nástroje. Příprava nyní prochází stejným zachycením chyby:
   fail-closed nástroj vrátí `FAILED` a `fallbackSuppressed: true`.
   Zrušení požadavku se dále propaguje jako abort.
   Dvě skutečné HTTP negativní kontroly simulují chybějící a odmítající host;
   před opravou obě selhaly, po opravě prošly bez volání modelu. Účetní
   deterministická sada má 4/4 testy PASS, runtime sada 57/57 PASS.

## Závěrečné důkazy a jejich hranice

| Kontrola | Výsledek | Co dokazuje |
|---|---|---|
| Profil `offline,database`, zdroj `4defa69e` | **416/416 programů PASS** | Registrované lokální gate včetně scheduleru, worker runtime, specialistů, autentizace, SQLite a skutečných účetních toolchainů |
| Cílené produktové HTTP sady, zdroj `4defa69e` | **8 PASS / 1 FAIL** | Worker create/edit/run, crash recovery, plánování, restart, účetní deterministický chat, betting, translator, followup a IDE backend |
| Skutečný 5m worker soak, zdroj `7f546eff` | **1/1 program PASS** | Časování bez zkrácení intervalu, rename, jedna notifikace, restart a úklid vlastních procesů |
| Code Reviewer, doplňkový skutečný HTTP probe na `4defa69e` | **PASS** | Kritický nález `src/auth.js:2` ve skutečném projektu; disable odmítne výběr 409 a běh; chybějící specialista 404; enable obnoví funkci; žádná inference |
| Registry reconciliation + validation | **PASS, 603 programů** | Platnost registru, nikoli provedení všech 603 programů |

Všechny výsledky závěrečných dvou registrovaných běhů obsahují čistý přesný
source HEAD a `cleanup.leakDetected: false`. Registry fingerprint je
`ddb9d94de4d481bb83c5e6041cb81a7701d98be305575646422bc1e67b1835f6`.

Účetní workflow integration skutečně spouští lokální PDF/OCR nad syntetickými
doklady a vytváří ZIP/XML výstupy. Přímé DPH výpočty, odmítnutí neplatných
vstupů a restart persistence jsou ověřeny bez modelu. Betting HTTP používá
řízenou nabídku, nikoli aktuální trh. Translator a generování specialisty
v IDE ověřují směrování, prompt a produktovou cestu s řízeným providerem;
**neověřují jazykovou kvalitu živého modelu**. Code Reviewer probe ověřuje
konkrétní lokální detekci, nikoli úplnost bezpečnostního auditu libovolného kódu.

Registrované server sady v posledním běhu:

- PASS `chat-accountant-deterministic-http`
- **FAIL `chat-accountant-model-contract`** — 52/53 vnitřních testů PASS
- PASS `chat-sazeni-http-journey`
- PASS `chat-specialist-followup-http`
- PASS `chat-translator-model-contract`
- PASS `ide-backend-product-http-journey`
- PASS `m3-agent-crash-recovery-product-journey`
- PASS `m3-agent-product-http-journey`
- PASS `m3-agent-scheduled-product-journey`

## Co zůstává otevřené

**Účetní směrování: FAIL / rozhodnutí o významu pending.** Existující test
`chat-accountant-model-contract.test.js:540` selhává už v setupu: po výběru
expertízy `accountant` očekává, že „Vysvětli kontrolní hlášení za květen 2026.“
bez inference otevře `accountant.document_workflow`. Aktuální expertise route
nejprve volá modelový klasifikátor; zakázaný provider způsobí HTTP 503
`LLM_PROVIDER_UNAVAILABLE`, místo očekávaných 200. Explicitní výběr
specialisty `accountant-cz` stejný lokální workflow zpřístupní.
Selhání bylo přítomné už v baseline. Registrovaný test ani jeho význam nebyly
oslabeny či překlasifikovány. Nový negativní host test dokazuje opravený
fail-closed samostatně a tento původní FAIL nenahrazuje.

Operátorovi byl položen cílený dotaz: má „Vysvětli“ vyvolat výklad a workflow
až výslovný pokyn, nebo vždy otevřít účetní workflow pro období? Bez odpovědi
není změna významu schválená. Po rozhodnutí je třeba sjednotit směrování
s požadovanou sémantikou a zopakovat tento konkrétní HTTP test.

**Živá kvalita modelů: BLOCKED_GPU / LIVE_NOT_RUN.** `nvidia-smi` hlásí
`Failed to initialize NVML: Driver/library version mismatch`.
Načtený modul je `595.91.07`, instalovaná knihovna/driver `595.99.02`
(NVML uvádí `595.99`). Prázdné `ollama ps` tuto chybu neřeší.
Nebyla spuštěna GPU inference, opravovány ovladače ani restartován host
během cizího dlouhého soaku. Po jeho ukončení patří oprava ovladače do
samostatného servisního okna, následovaného skutečnými dialogy všech čtyř
specialistů na konkrétních modelových digestech.

**Přejímka: REVIEW_PENDING / NOT_DEPLOYED.** Neproběhl nezávislý review,
merge do main/IDE ani důkaz na budoucím integračním release. Nejbližší
proveditelný krok je převzít dva fix commity do IDE integračního bodu a
spustit jejich HTTP gate na přesném výsledném HEAD. Při integraci lze oba
fix commity cherry-picknout; celá audit větev obsahuje i IDE baseline.

## Reprodukce a archiv

Node `v24.21.0` je nutný v PATH i pro potomky. OCR runtime:
`/home/belphareon/.local/share/ucetni`; PDF Python:
`/home/belphareon/.local/share/intentsmith/python/pdf/bin/python3`.
Root dependencies jsou čteny z existujícího lokálního Node 24 prostředí;
IDE workspace package odkazy směřují na vlastní checkout a third-party
balíčky na existující IDE instalaci. Do těchto sdílených závislostí se nezapisovalo.

```bash
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
export UCETNI_RUNTIME_DIR=/home/belphareon/.local/share/ucetni
export INTENTSMITH_PDF_PYTHON=/home/belphareon/.local/share/intentsmith/python/pdf/bin/python3
node scripts/nightly-audit.js --profile=offline,database --concurrency=1 \
  --run-id=worker-specialist-full-4defa69e-20261010 \
  --allow-blocker=toolchain:accountant-ocr-runtime,toolchain:bubblewrap,toolchain:bwrap,toolchain:git,toolchain:iproute2,toolchain:nftables,toolchain:prlimit,toolchain:python-pdf-runtime,toolchain:python3,toolchain:systemd-analyze,toolchain:tar
npm run test:registry
git diff --check
```

Příkaz je záznam skutečného běhu. Při opakování použít nový run-id; existující
audit runner odmítne přepsat. Exact stable ID výběr devíti server sad i soak
je v publikované [evidence receipt](evidence/worker-specialist-audit-20261010/receipt.json).
Lokální surová evidence v tomto checkoutu:

- `.intentsmith-artifacts/test-runs/worker-specialist-full-4defa69e-20261010/`
- `.intentsmith-artifacts/test-runs/worker-specialist-product-4defa69e-20261010/`
- `.intentsmith-artifacts/test-runs/worker-rename-real-soak-7f546eff-20261010/`
- `.intentsmith-artifacts/worker-edit-red.log`, `worker-edit-green.log`
- `.intentsmith-artifacts/accountant-host-red.log`, `accountant-host-green.log`
- `.intentsmith-artifacts/code-reviewer-4defa69e.log`

Kompaktní receipt obsahuje SHA-256 původních reportů/logů, identitu prostředí,
jednotlivé server výsledky a kopii skutečného soak důkazu. Surové reporty/logy
a potřebné testové DB jsou zachovány lokálně; syntetická data nejsou provozní DB.

Předchozí běhy jsou také zachovány. První široký paralelní běh byl přerušen
kvůli nepřipravenému prostředí (Node PATH, OCR/PDF, IDE workspace závislosti)
a kolizi kontroly čistoty s dočasnými zdroji runner self-testu. Meziběh po
prvním fixu odhalil neaktualizovaný LOC census a byl přerušen pro doplnění
druhého fixu. Tyto FAIL/INTERRUPTED artefakty nejsou změněny na PASS;
závěr stojí na závěrečném sériovém zdroji `4defa69e`.

Workspace report po testech: **89 checkoutů, 0 bezpečně retirable**, vlastní
checkout čistý na `4defa69e`, cca 2,53 GiB včetně chráněné evidence. Odstraněny
byly pouze dva vlastní prázdné `runtime/home` adresáře z nedokončeného probe;
sedm runtime kořenů obsahujících důkazy bylo ponecháno. Planner navrhoval také
607 cizích sandboxů; žádný nebyl odstraněn. Výjimka budgetu chrání současné IDE,
běžící release, UNKNOWN změny a důkazní historii. Cleanup receipt a hash
finálního workspace reportu jsou v kompaktní evidence.
