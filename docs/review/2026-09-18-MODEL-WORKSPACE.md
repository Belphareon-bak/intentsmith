# Modely ve Studiu: skutečné nové měření a čitelné výsledky

Autorita: operátorovo zadání z 2026-09-18: denní uložená inventura GPU,
skutečné opakované testování, vysvětlení skóre, tabulky rolí a kandidátů,
historie a srozumitelný Správce. Vstup `03597d1d`; větev
`work/hunt-model-controls-20260917`. Implementace přes `9298ef46`.
Stav: **INSTALLED / DETERMINISTIC_358_PASS_1_KNOWN_FAIL /
LIVE_REMEASUREMENT_WAITING / REVIEW_PENDING**. Release acceptance se nemění.

## Co se změnilo a proč

- GPU inventura uchovává typ karty, kapacitu a čas detekce v privátním souboru
  `gpu-inventory.json`, přežije restart a obnoví se po 24 hodinách. Neúspěšná
  detekce zachová poslední známou kapacitu s příznakem stáří. Každý scoring
  stále ověřuje současné obsazení, ovladač a umístění konkrétního modelu.
- Původních 44 sekund u Qwen3.5 nebyl nový CODE test. `run-Kc9WCM` skutečně
  použil COMPLETE výsledek z 17. 9. Nový ruční test bypassuje reuse v evaluatoru
  i historii a přidá nový nezměnitelný řádek. Plánovaný hunt smí platná měření
  nadále použít; UI to explicitně rozlišuje.
- Migrace 114 odstraňuje pouze unikátnost COMPLETE kontraktu. PK a append-only
  triggery zůstávají. Read model vybírá poslední COMPLETE pro přesný digest,
  roli, kontrakt a provider; doporučení nad nahrazeným měřením už není přímo
  aplikovatelné. Původní výsledky a rozhodnutí se nepřepisují.
- Ruční požadavek čeká nejvýše 30 minut na evaluation lock a aktuálně volné
  prostředky. Po uvolnění pokračuje automaticky, při vypršení pravdivě skončí
  bez nového skóre. Nevyklízí cizí GPU procesy. Fronta z ukončeného pokusu
  se už nevydává za aktivní čekající práci.
- Hunt řadí způsobilé kandidáty nejprve podle mezery v aktuálním skóre rolí.
  Chybějící skóre má přednost, pak nižší naměřené skóre; katalogové pořadí
  rozhoduje následně. Náhled nad kopií skutečné DB před měřením řadil pět
  prvních lokálních kandidátů pro CODE. Disková rezerva, cohort ledger,
  response-bound proof a konzervativní retention zůstávají v platnosti.
- Role jsou tabulka: účel, přiřazený model, aktuální skóre, dvě další nejvyšší
  místní skóre a oddělené akce Test/Přiřadit. Pořadí není autorita k přepnutí.
- Evaluace oddělují role, ukazují silné/slabé výsledky a jednotlivé úlohy se
  třemi opakováními. Detail je přes celou šířku; 59 kontrol jedné úlohy se
  rozbaluje zvlášť. Silné znamená průměr alespoň 80 % a rozpětí nejvýše
  20 bodů; slabé znamená pod 50 %. Nejde o obecnou úspěšnost programování.
- Historie obsahuje posledních 200 měření včetně verze Ollamy, času, trvání,
  identity a stavu, posledních 50 rozhodnutí pro aktuální kontrakty a starší
  upgrade záznamy. GPU hunt má posledních pět ukončených akcí a jejich výsledky.
- Kandidáti jsou tabulka s filtry/řazením a datem vydání, pokud ho inventář
  zná. Datum stažení ani první discovery se za vydání nevydává. Katalogová
  VRAM je odhad; ani uložená kapacita GPU nepotvrzuje produkční umístění modelu.
- Správce vysvětluje šest provozních oblastí, neznámé hodnoty ukazuje jako
  chybějící data místo 50 % a nevytváří z nich souhrnné skóre. Přijetí návrhu
  pouze uloží rozhodnutí, `executed:false / MANUAL_ACTION_REQUIRED`; výsledek
  je vidět v historii. Existující historické texty se nepřepisují.

## Ověření a zachované neúspěchy

Na backendové revizi `21438a32`: úplný offline/database profil 355 PASS /
1 FAIL / 3 BLOCKED. Tři sady PDF/OCR potom se skutečnými cestami runtime
3/3 PASS; sjednocené pokrytí 358 PASS / 1 FAIL. Jediný FAIL je známý
`nightly-orchestrator-self-test`: registry hash se liší od reviewed Gate 0
policy. Release pečeť nebyla obnovena ani oslabena.

Původní invocation mimo `.intentsmith-artifacts` skončila 73 PASS / 276 FAIL /
10 BLOCKED: testovací TMPDIR nesplňoval požadovaný kořen. Správně izolovaný
meziběh měl 345 PASS / 4 FAIL / 10 BLOCKED; tři skutečné regrese byly zastaralé
migration-count a Studio renderer oracles, opravené v `547c7c50`/`21438a32`.
Pokus o souběžné doplnění tří prerekvizit byl odmítnut kvůli dočasným souborům
jiné právě běžící sady; opakování po dokončení plného auditu prošlo. Původní
logy zůstávají. Žádný z těchto neúspěchů se nepřebarvuje na PASS.

Úplný profil na konečném `9298ef46` znovu **358 PASS / 1 FAIL /
0 BLOCKED / 0 TIMEOUT** v jediném běhu. Všechny source-tree kontroly čistoty
prošly; jediný FAIL je stejná release pečeť.

Dva řízené fyzické Electron journeys na `547c7c50` a `21438a32` PASS:
filtr/sort/unknown VRAM, skutečný click přes native confirmation a HTTP,
0 → 33 % a ETA, role alternativy, oddělené matice, detaily, historie provideru,
UNKNOWN bez čísel, význam přijetí návrhu, posledních pět akcí. Negativní HTTP
503 zůstane u správného modelu a umožní opakování. Tyto hodnoty jsou fixtures,
nikoli skóre lokálních modelů. Limity: řízený backend, NODE_ENV=test,
diagnostický --no-sandbox, user/network namespace, capture až po startu.

Fyzická kontrola produkčního Studia odhalila špatnou čitelnost vloženého
širokého detailu; `9298ef46` ho přesouvá do samostatného řádku a seznamy kontrol
sbalí. Tato oprava nemění měřicí backend ani kontrakty. Fyzický re-run z čistého
instalačního snapshotu `9298ef46` PASS, včetně šířky detailu alespoň 80 %
panelu. SHA-256 skutečného Electron frontend bundle:
`da111b7be5b7941f7e153a0fd53806ec6beef403f059508b32531f27c43b8061`.
Zachovány i dva odmítnuté pokusy: překlep v plné SHA před startem
(`source-revision-mismatch`) a závěrečná kontrola sdíleného checkoutu během
vytvoření dočasné fixtury jinou sadou (`source-worktree-dirty`). Ani jeden
není fyzický PASS; následující běh použil čistý oddělený snapshot.

## Živá instalace a měření

Finální čistý detached snapshot `9298ef46e776e59cee01dc5e4354ae1b0d552c4e`
byl nainstalován v 10:57 CEST. Backend i timer jsou aktivní, launcher --check
PASS. Konfigurace PDF interpreteru zůstala zachovaná. Po obou instalacích
se všech 513 dřívějších evaluací, 234 rozhodnutí, sedm desired bindings a
14 binding operations shoduje s předinstalační zálohou. quick_check OK,
žádná FK chyba. Aktuální zdroj má 101 migrací; historický živý ledger měl
103 aplikovaných položek a po jediné nové migraci 114 má 104. Tato čísla
nejsou zaměnitelná.

GPU inventura je RTX 3090 / 24576 MiB / driver 595.91.07, detekována
18. 9. 10:34:53 CEST, další obnova 19. 9. ve stejný čas. Stejný záznam
přežil dva restarty backendu. Běžné Studio bylo otevřeno launcherem proti
produkčnímu backendu a DB: role, aktuální matice, skutečných sedm CODE úloh,
Historie, kandidáti a Správce ověřeny čtením skutečného DOM. Finální detail
má colspan 5 a sbalený seznam kontrol; nejde jen o mock renderer.
Tento běh používá dříve uživatelem povolený --no-sandbox a dočasný lokální
CDP pro diagnostiku. Nesouvisející konverzace není součástí panelových snímků.

První produkční klik na Nový test Qwen3.5/CODE přijal HTTP 202 do
`run-pZ3Uln`. Požadavek správně čekal na GPU lock cizího journey
(PID 758418, následně 771215). Před inferencí byl vlastní požadavek
zastaven kvůli instalaci finální úpravy detailu; zůstal CANCELLED, žádné
nové skóre nevzniklo. Znovu založený požadavek z finálního Studia přijal
HTTP 202 v 10:58:18 CEST, `run-t9d9xd`, se stejným přesným digestem a CODE
kontraktem. V tomto checkpointu **stále čeká na cizí GPU lock**. Staré
2/7 se nevydává za nový výsledek. Živá nová inference a nový CODE výsledek
Qwen3.8 budou mít samostatný níže doplněný výsledek; zatím se netvrdí PASS.

## Evidence a hranice

Privátní root: `/home/belphareon/Projects/coworker/intentsmith-model-workspace-20260918`.
Starší evidence rooty zůstaly beze změny. Do výsledného archivu nepatří kopie
produkční DB, autentizační capability, administrační environment ani celé
snímky s nesouvisející konverzací. Snímky této delty jsou omezené na panel modelů.
Samostatný dlouhý soak a cizí GPU journey nebyly zastavené; jejich výsledek
není součástí tohoto tvrzení. Lepší ovládání není důkaz vyšší kvality modelů.
