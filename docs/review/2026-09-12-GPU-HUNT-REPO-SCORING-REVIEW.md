# GPU hunt: repo úlohy a skutečně dostupný scoring ve Studiu

**QUALITY_PILOT_COMPLETE / STUDIO_SCORING_VISIBLE / INSTALLED_PANEL_RUNNING / REVIEW_PENDING.**
Checkpoint 2026-09-12, přibližně 18:14 CEST. Výslovné zadání operátora:
pokračovat v implementaci/testování, zpřístupnit scoring v IDE, commitovat a pushovat.
Rozsah navazuje na `a0b73c47`; runtime/implementační evidence končí `9d5e207a`.

## Změny

- Studio načte čerstvou evaluaci při otevření záložky, má „Obnovit scoring“,
  čas dat a sloupec Ollama. Chybějící historickou verzi neodhaduje.
  HTTP chyba zůstává chybou; další explicitní načtení umí uspět.
- Vizuální kontrola odhalila dva vlastníky widgetu `c3-sidebar`. Aplikace
  načítala jak aktuální `@c3/chat-panel`, tak starý `@c3-ide/c3-sidebar`.
  Pozdější registrace vytvářela prázdnou navigaci a aktuální center mount
  vůbec nevznikl. `9d5e207a` odstranil starou závislost pouze z aplikace;
  historický zdroj zůstal. Nový generovaný frontend starý sidebar nenačítá.
- Reasoning má 12 úloh místo 8, R2 10 místo 6. Čtyři připnuté repo scénáře:
  falešný clean npm auditu, pozdní guard historie, opravený guard jako
  negativní kontrola a neplatný zápis do immutable odpovědi. Každý nese
  zdrojový commit, soubor, řádky, nezměněné bytes a SHA-256. Úryvky byly
  porovnány s Gitem; testy skutečně přehrávají audit a obě varianty historie.
  Jde o čtyři scénáře ze tří vad, nikoli čtyři nezávislé rodiny problémů.
- Opraveno nejednoznačné zadání `reason_logic`: nyní explicitně existují
  jen dva boxy. Původní formulace neopravňovala očekávat box 2.
- Nové verze `v136.1-reasoning-repo.1` a `v136.1-review-repo.1` mění
  kontrakty D1/D2/R1/R2. CODE/CHAT/VISION mají ověřeně stejné kontrakty.
  Stará měření se nepřepisují. Prahy, tři opakování a response proof zůstaly.

## Měřený pilot

Dva instalovaní kandidáti, R1/R2, šest COMPLETE souhrnů v provozní DB,
0 roleErrors, vše `RESPONSE_BOUND` na `0.34.0-intentsmith.1`.
Žádný pull ani binding efekt.

| Model | R1 score | R2 score |
|---|---:|---:|
| Phi4 | 0.819444 | 0.616389 |
| Devstral Small 2 | 0.713889 | 0.818333 |
| Qwen3.8 (R1 incumbent) | 0.925000 | — |
| Qwen3:14b (R2 incumbent) | — | 0.563333 |

R1: Qwen3.8 vyhrál proti Phi4 s marží kandidáta -0.422 na třech úlohách,
proti Devstralu -0.493 na pěti. Immutable úloha rozlišila Qwen3.8 a Phi4
stabilně 1 versus 0; auditní úloha dala oběma 0.5, tedy nerozlišila.
R2: Devstral vyhrál s marží 0.364 na sedmi rozlišujících úlohách (5:2).
Phi4 má vyšší absolutní skóre, ale párová marže 0.018 nestačí na práh 0.05.
Pilot neměří generalizaci ani zlepšení všech reasoning rolí; širší panel běží.

## Validace a její hranice

Focused: suites 25 PASS, read model + doslovný Studio renderer 19 PASS,
candidate 36, pairwise 37, upgrade 97, artifact 158, nonvisual Studio 19.
První celý gate na `8e3db9f6`: 343 PASS / 1 FAIL / 8 BLOCKED. FAIL byl
stale LOC census, BLOCKED explicitní toolchain prerekvizity. Po opravě
census a použití existujícího PDF runtime + povolení deklarovaných nástrojů
má `414142a6` 352/352 PASS; všech 352 log SHA bylo ověřeno. Následná jediná
změna aplikace `9d5e207a` má vlastní produkční build a Electron důkaz.
Plný gate na tomto posledním manifestu se netvrdí.

První build narazil na chybějící TypeScript a neúplnou offline cache.
Instalace použila zamčený lockfile; finální instalace po změně manifestu
prošla offline. Produkční build prošel včetně consumer/preload guardů.
Pokus přidat vizuální test do původního M1 runneru odmítl jeho výslovně
nonvisual kontrakt. Změna byla vrácena; původní runner zůstal nezměněný.

Samostatný diagnostický harness na skutečném Electron bundlu a řízeném
loopback backendu proklikal Nastavení → LLM → Spravovat role a modely →
Evaluace a provedl refresh. Ověřil score, verzi, chybějící verzi, BLOCKED
s prázdným score a UNVERIFIED_RUNTIME. Před screenshotem ověřil hit-testem,
že buňku nezakrývá startovací overlay. Finální journey má PASS včetně
původní transportní/síťové/shutdown kontroly. Screenshot obsahuje jasně
pojmenované fixtures; není to snímek produkční DB.

Neúspěšné vizuální pokusy zůstaly zachované: časování/selektory, skutečně
prázdný sidebar, následně neúplný HTTP fixture (404 na podpůrných routách).
Finální fixture má explicitní podpůrné GET routy; síťová policy nebyla oslabena.
Diagnostický harness je uchovaný s hashem mimo repozitář, není novým
registrovaným acceptance testem. Původní nonvisual M1 test nemůže sám
sloužit jako důkaz viditelnosti celé aplikace.

## Probíhající panel

Původní pokusy v 18:00 a 18:06 odmítl `GPU_EVALUATION_BUSY`, protože jiný
běh mezitím převzal GPU. Jednotka skončila exit 1; nejde o modelové selhání.
Žádný cizí proces nebyl ukončen. Následná owned jednotka
`intentsmith-hunt-repo-panel-queued-20260912.service` nejprve čekala na
prázdné `/api/ps` a NVIDIA compute seznam; nyní skutečně běží instalovaný
panel D1/D2/R1/R2. Při závodu znovu rozhoduje scheduled GPU autorita.
Čekání má limit 2 h, celá jednotka 6 h; jde o jednu dávku, ne nekonečný loop.

Průběh: `panel-controller.json`; konečný výsledek: `panel.json` v evidence
rootu. Controller FINISHED znamená dokončený proces, nikoli automaticky
kvalitativní PASS všech modelů. Doporučení neaktivuje role; v IDE zatím
nepřibylo ovládání start/cancel huntu. M6 ani nezávislé review se neuzavírá.

Evidence root: `/home/belphareon/Projects/coworker/intentsmith-hunt-repo-scoring-20260912`.
Přesné revize, hashe a checkpoint: [manifest](../execution/runs/gpu-hunt-repo-scoring-20260912.json).
