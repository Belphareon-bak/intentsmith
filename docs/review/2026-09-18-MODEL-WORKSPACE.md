# Modely ve Studiu: skutečné nové měření a čitelné výsledky

Autorita: operátorovo zadání z 2026-09-18: denní uložená inventura GPU,
skutečné opakované testování, vysvětlení skóre, tabulky rolí a kandidátů,
historie a srozumitelný Správce. Vstup `03597d1d`; větev
`work/hunt-model-controls-20260917`. Implementace přes `9298ef46`.
Stav: **INSTALLED / DETERMINISTIC_358_PASS_1_KNOWN_FAIL /
LIVE_GUI_CODE_MEASUREMENT_PASS / REVIEW_PENDING**. Release acceptance se nemění.

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
kontraktem. Tento checkpoint čekání byl později uzavřen: cizí lock se uvolnil,
po vypršení residency cizích modelů požadavek sám pokračoval a dokončil
skutečných 21 vyhodnocení. Následovaly dva další nové CODE testy přes stejné
tlačítko, nativní potvrzení a produkční HTTP 202. Celkem **tři modely / 63
vyhodnocení / tři nové COMPLETE řádky**; žádné reuse. Níže je konečný výsledek.

| Model | CODE skóre | Samotná sada | Celý požadavek včetně čekání/přípravy | Nový DB run |
| --- | ---: | ---: | ---: | --- |
| `qwen3.5:27b` | 33.3 % | 4 min 59 s | 11 min 56 s | `eval_705a17a7-97ac-4f25-93de-27b7295871b7` |
| `qwen3.8:latest` | 71.4 % | 2 min 59 s | 3 min 54 s | `eval_5bfef5f3-8eb4-4781-b466-b94d4f933ffb` |
| `qwen3-coder:latest` | 11.4 % | 1 min 49 s | 3 min 36 s | `eval_51da4e2a-7465-4837-b310-41305e890ccf` |

Všechna měření použila `0.34.0-intentsmith.1`, proof RESPONSE_BOUND a shodný
CODE kontrakt `6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`.
Přesné digests a intervaly jsou v `live-new-evaluations.json`. Nový Qwen3.5
má dvě úlohy stabilně 1/1; složitější binding úloha uspěla až ve třetím
opakování, proto průměr 33,3 % místo původních 28,6 %. Qwen3.8 má stabilně
úspěšnou deduplikaci modelů, binding ochranu, VRAM lease a timeout při síťové
chybě; na zachování chybového stavu chatu selhal ve všech třech opakováních.
Nejde o tvrzení obecné úspěšnosti dokončování projektů ani o nový duelový verdikt.

Živý DOM po dokončení bez ručního obnovení ukázal CODE/Qwen3.8 jako Změřeno
se 71,4 %. Evaluace obsahují šest aktuálně změřených místních CODE modelů,
včetně všech tří nových výsledků a rozbalitelných detailů; dalších pět má
pravdivě chybějící měření. Historie ukazuje nové tři runy, délku sady a verzi
provideru. Přiřazení CODE zůstalo Qwen3.8 podle operátorovy dřívější volby.
Živé tlačítko Zkontrolovat ve Správci obnovilo poslední uloženou zprávu:
pokrytí přiřazených rolí měřením je nyní 100 %, provozní CRE ukazatel 32 %.
Čtyři oblasti mají stále pravdivě Chybí data. Vzniklo nové otevřené CRE
doporučení; schválení ani executor této kontroly nejsou součástí běhu.
Dvě dřívější přijetí zůstala v historii jako čekající na ruční provedení.


Po testech: **269 COMPLETE / 215 BLOCKED / 32 FAILED**, celkem 516 řádků.
Všech 513 původních řádků zůstalo obsahově shodných. Rovněž beze změny
234 rozhodnutí, sedm desired bindings a 14 binding operations. quick_check OK,
žádná FK chyba. V inventáři zůstalo stejných 11 identit/digestů: nula nově
stažených a nula smazaných modelů. Nízké CODE skóre se samo nestává důvodem
ke smazání modelu vhodného pro jinou roli.

Backend a timer zůstaly enabled/active, další tick 19. 9. v 03:05:11 CEST,
nejvýše dva kandidáti a původní disková rezerva 40 GiB. Vlastní evaluační
služba je inactive, její sidecar 11435 po dokončení nedostupný. Následná
aktivita na systémové Ollamě 11434 patří mimo tyto ukončené požadavky a nebyla
ukončena. Cizí soak PID 15110 stále běží. Potvrzení vyššího skóre není
nezávislé přijetí implementace; to zůstává REVIEW_PENDING.

## Evidence a hranice

Privátní root: `/home/belphareon/Projects/coworker/intentsmith-model-workspace-20260918`.
Starší evidence rooty zůstaly beze změny. Do výsledného archivu nepatří kopie
produkční DB, autentizační capability, administrační environment ani celé
snímky s nesouvisející konverzací. Snímky této delty jsou omezené na panel modelů.
Samostatný dlouhý soak a cizí GPU journey nebyly zastavené; jejich výsledek
není součástí tohoto tvrzení. Lepší ovládání není důkaz vyšší kvality modelů.

## Jak číst sedm CODE úloh

Nejde o procento libovolných projektů, které model dokončí. Sada vyžaduje
opravu konkrétních chyb z historie repozitáře a ověřuje ji funkčními kontrolami.
Každá ze sedmi úloh má v průměru stejnou váhu; počet kontrol uvnitř úlohy se liší.

| Úloha | Co se skutečně ověřuje |
| --- | --- |
| `patch_8cae1b583963` | Deduplikace identit, vyřazení null a pořadí starých nepoužívaných modelů. |
| `patch_0fe346cc820c` | Ochrana modelů během přepnutí role, rollbacku, provider účinků a obnovy; 59 funkčních kontrol. |
| `patch_6fc5e4eb7dce` | Zákaz smazání během používání/VRAM operace a správné uvolnění lease; osm kontrol. |
| `patch_ef4ae48ec16e` | Vyjádření nízké jistoty duelu, který rozlišuje jediná úloha. |
| `patch_e8cdbe02e5de` | Úspěch tahu až po uložení; chyba/zrušení/timeout nesmí vytvořit falešný úspěch. |
| `patch_22149f55b861` | Zrušení verification timeoutu před parsováním úspěšné odpovědi. |
| `patch_adb1258cfec0` | Zrušení verification timeoutu také při síťové chybě. |

První dva podobné popisky ve Studiu pocházejí ze stejného zdrojového modulu;
rozbalení „Co se ověřuje“ odhalí rozdílné kontrolované scénáře. Nízký výsledek
se neopravuje změkčením těchto požadavků. Vhodným dalším krokem huntu je měřit
ostatní místní CODE kandidáty stejným kontraktem.

Po novém CODE výsledku Qwen3.8 náhled nad novou kopií DB sám změnil prioritu:
nejprve VISION (aktuální 53,3 %), pak R2 (65,8 %), následně CODE (71,4 %).
Nejde o napevno zadanou preferenci CODE. `priority-preview.json` a
`priority-preview-after.json` zachycují oba stavy bez stažení nebo změny
produkční DB. Vydání v tabulce kandidátů zůstává údajem z discovery katalogu;
tato delta není nezávislou revizí správnosti všech jeho dat vydání.

## Uzavřený archiv

Manifest připíná 2024 souborů; archiv byl po vytvoření celý přečten a každý
člen porovnán s SHA-256. Obsahuje ověřený `source.bundle` s úplnou historií
na kódové revizi 9298ef46, fyzické snímky, všechny zachované testovací neúspěchy,
produkční HTTP/DOM a nové měřicí výsledky. Archivní `review-packet.md` je
checkpoint před přidáním tohoto checksumového závěru. Soubory označené
`final-governor-*` zachycují stav před posledním klikem Zkontrolovat; jeho
novější výsledek (100% pokrytí) je v `installed-governor-refreshed.json`.

Privátní archiv: `intentsmith-model-workspace-sha256-8f64ea4356e0927727227b087a02e00f6f01c72844c83bd3ff899228c0a39c57.tar.gz`

SHA-256: `8f64ea4356e0927727227b087a02e00f6f01c72844c83bd3ff899228c0a39c57` · 73 082 662 bajtů.
Produkční DB, skutečné credentials a nesouvisející konverzační snímek jsou
z archivu vyloučené. Diagnostické Studio skončilo exit 0; běžný launcher
bez CDP znovu otevřel nainstalovaný build a dosáhl stavu ready.
[Strojový souhrn a identity](../execution/runs/model-workspace-20260918.json).
