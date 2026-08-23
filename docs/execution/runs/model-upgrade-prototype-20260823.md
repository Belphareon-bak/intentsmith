# Model upgrade prototype v136.1 — GPU pilot 2026-08-23

## Verdikt

Prototyp pro discovery, přesnou historii, role-specific scoring, segregaci a
bezpečnou aplikaci vazby funguje end-to-end pro `reasoning`, `review`, `chat`
a `vision`. Konečné portfolio používá čtyři různé modelové artefakty, žádný
nejvýše pro dvě role. `qwen3.5:27b` i `qwen3.8:latest` prokazatelně vyhrály
CHAT v3.2, ale CHAT vazbu nepřevzaly, protože každý už zastává dvě role. To je
očekávaný důkaz, že segregace skutečně omezuje výběr. CODE je správně
fail-closed, protože má jen 3 z požadovaných 6 aktivních rozlišujících úloh.

## Aktuální portfolio a širší panel

| Role | Aktuální model | Důvod |
|---|---|---|
| D1 | `qwen3.5:27b` | skóre reasoning 1,000 a oddělení D1 od R1 |
| D2 | `qwen3.8:latest` | dříve prokázaný kvalitativní vítěz |
| CODE | `qwen3.5:27b` | config fallback; rozhodovací sada zatím fail-closed |
| R1 | `qwen3.8:latest` | dříve prokázaný kvalitativní vítěz |
| R2 | `qwen3:14b` | žádný kandidát neměl dost silný stabilní důkaz pro výměnu |
| CHAT | `qwen3:14b` | qwen3.5 i qwen3.8 vyhrály, ale policy blokuje třetí roli |
| VISION | `llava-llama3:8b` | vision incumbent zůstal lepší |

Audit portfolia: `qwen3.5 = D1 + CODE`, `qwen3.8 = D2 + R1`,
`qwen3:14b = R2 + CHAT`, `llava-llama3 = VISION`; maximum 2 role/model a
žádné zakázané sdílení D1–R1, CODE–R1, CODE–R2 ani D2–R2.

Absolutní skóre tří aktuálních textových kontraktů, vždy ze tří opakování:

| Model | reasoning_v2 | review_v2 | chat_v3.2 | CHAT EN | CHAT CZ | tok/s |
|---|---:|---:|---:|---:|---:|---:|
| `qwen3.5:27b` | 1,0000 | 0,7875 | 0,9171 | 0,9429 | 0,8786 | 37,1 |
| `qwen3.8:latest` | 0,9528 | 0,7458 | 0,9100 | 0,9246 | 0,8881 | 35,3 |
| `qwen3:14b` | 0,8250 | 0,7167 | 0,8733 | 0,9079 | 0,8214 | 69,0 |
| `phi4:14b` | 0,8750 | 0,6569 | 0,8681 | 0,8960 | 0,8262 | 72,3 |
| `qwen3-30b-a3b` | 0,8000 | 0,5500 | 0,8925 | 0,9071 | 0,8706 | 167,4 |

`qwen3.5` je nejlepší v absolutním součtu, ale proti `qwen3.8` nemělo na
reasoning jednotlivé stabilně rozlišující úlohy. D1 na něj přešlo jako na
naměřenou ekvivalentní variantu pro opravu segregace, nikoli na základě
nepodloženého tvrzení o obecné převaze. V CHAT v3.2 už `qwen3.5` i `qwen3.8`
prošly plným bilingvním evidence gate; obě změny zablokovalo až maximum dvou
rolí na model.

Další hardwarově prověřené modely:

- `qwen2.5:32b`: 20,69/26,83 GiB na GPU/celkem, CPU spill 6,14 GiB;
- `deepseek-r1-32b`: 20,67/25,83 GiB, CPU spill 5,16 GiB;
- `mistral-small:22b-instruct-2409-q6_k`: 20,67/24,26 GiB, CPU spill
  3,59 GiB.

Všechny tři byly při 32k kontextu označeny `BLOCKED` před kvalitativním
testem; model, který se nevejde celý do RTX 3090, nemůže vyhrát díky CPU
offloadu.

## CHAT v3.2: testy a rozhodnutí

Sada byla rozšířena z 10 na 35 úloh: 21 EN a 14 CZ, tedy explicitně 60/40.
Každý prompt má veřejný checklist. Skóre úlohy je vážený podíl splněných
bodů v rozsahu 0..1 po odečtení explicitních penalizací; tři opakování dávají
mean a spread. Úloha je rozhodovací jen tehdy, když rozdíl modelů překročí
jak minimální task marži, tak naměřený spread. CHAT výměna navíc vyžaduje
nejméně 7 takových úloh, z toho 3 EN a 4 CZ.

Panel pěti modelů rozlišil 11 úloh, 7 EN + 4 CZ. Párově proti
`qwen3:14b`:

| Kandidát | Stabilní celkem | EN | CZ | Výhry | Prohry | Verdikt |
|---|---:|---:|---:|---:|---:|---|
| `qwen3.5:27b` | 12 | 6 | 6 | 7 | 5 | kvalitativní vítěz, marže 0,100 |
| `qwen3-30b-a3b` | 7 | 3 | 4 | 3 | 4 | prohra: stabilní většina pro incumbent |
| `phi4:14b` | 6 | 4 | 2 | 2 | 4 | blokováno: CZ 2/4 |
| `qwen3.8:latest` | 10 | 5 | 5 | 6 | 4 | kvalitativní vítěz, marže 0,127 |

Napříč celým panelem stabilně rozlišovaly čtyři české úlohy:
`cz_exact_bullets`, `cz_professional_reply`, `cz_numeral_cases` a
`cz_relative_pronoun`. Párově proti incumbentu rozlišovalo šest českých úloh
pro `qwen3.5` a pět pro `qwen3.8`. CHAT binding přesto zůstal beze změny,
protože přidání třetí role kterémukoli vítězi by porušilo segregaci.

Přesné prompty a rubriky jsou v
[chat-v3.2-tests-20260823.json](./chat-v3.2-tests-20260823.json). Všech 525
odpovědí (35 úloh × 5 modelů × 3 opakování), dílčí checklisty, task score,
spread i párové výsledky jsou v
[chat-v3.2-panel-results-20260823.json](./chat-v3.2-panel-results-20260823.json).

Následující části zachovávají původní pilot jako historickou stopu. Jeho
CHAT v2 ani původní trojice vazeb nejsou aktuální stav.

## Hardware a discovery

- GPU: NVIDIA GeForce RTX 3090, 24 576 MB VRAM.
- Katalog: 235 rodin Ollama, 179 hardwarově/rolově vhodných kandidátů ve
  sloučené frontě.
- Nejvýše vyšel `qwen3.8:latest` pro textové role; stažen byl pouze tento
  jeden nový kandidát. Pro VISION byl použit už instalovaný `llava:13b`.
- `qwen3.8`: 16,20/16,20 GiB v GPU při 32 768 tokenech, 36,2–40,1 tok/s.
- Incumbenti: `qwen3-30b-a3b` 19,20/19,20 GiB a 158,9 tok/s;
  `qwen3:14b` 13,55/13,55 GiB a 69,4–69,5 tok/s.
- Po běhu: přibližně 18 GiB dostupné RAM, GPU bez rezidentního modelu,
  109 GiB volného disku. Swap zůstal z dřívějška obsazený; nebyl
  proveden `swapoff` ani ukončení cizí relace/procesu.

Discovery artefakt: [model-shortlist-20260822.json](./model-shortlist-20260822.json)

## Skóre a rozhodnutí

| Role | Sada | Kandidát vs incumbent | Důkaz rozhodnutí | Výsledek |
|---|---|---|---|---|
| D1 | reasoning_v2 | 0,9528 vs 0,8000 | marže 0,363, 3:0 úloh, vysoká jistota | `qwen3.8` aplikován |
| D2 | reasoning_v2 | 0,9528 vs 0,8250 | marže 0,444, 2:0, střední jistota | `qwen3.8` aplikován |
| R1 | reasoning_v2 | stejný kontrakt jako D1 | reused bez druhé inference | `qwen3.8` aplikován |
| R2 | review_v2 | 0,7458 vs 0,7167 | marže 0,035 < práh 0,05 | `qwen3:14b` zůstává |
| CHAT | chat_v2 | 0,9017 vs 0,8633 | 2 stabilní úlohy, poměr 1:1 | `qwen3:14b` zůstává |
| VISION | vision_v2 | 0,2000 vs 0,5333 | kandidát ztrácí 0,556 na 3 úlohách | `llava-llama3:8b` zůstává |
| CODE | code_patch | panel pěti modelů | jen 3/6 požadovaných aktivních úloh | rozhodování zablokováno |

Reasoning vysvětluje výměnu: `qwen3.8` bylo lepší např. v critical path,
setech a logice, zatímco všechny modely měly plné body v jednoduchém budgetu,
pořadí, rate a transformaci. REVIEW kandidát zachytil pět vadových příkladů
dobře, ale chybně označil clean case; jeho malý celkový náskok proto nestačil.

## Aplikované durable vazby

| Role | Před | Po | Durable revision |
|---|---|---|---|
| D1 | qwen3-30b-a3b:latest | qwen3.8:latest | 3 |
| D2 | qwen3:14b | qwen3.8:latest | 3 |
| R1 | qwen3-30b-a3b:latest | qwen3.8:latest | 3 |

Všechny tři runtime apply attempt byly `SUCCEEDED`, ale navazující
notification receipt nebyl vydán; CLI proto pravdivě vrátilo
`APPLIED_NOTIFICATION_DEGRADED`. Durable desired bindings jsou uložené a hunt
je při dalším startu znovu načetl. Původní modely zůstaly na disku.

## Historický CHAT v2: co se testovalo a jak

Sada obsahuje 6 stejně vážených EN a 4 stejně vážené CZ úlohy. Každá
vrací `0..1` jako podíl splněných checklist bodů; rozpory a známé jazykové
chyby mají explicitní penalizaci. Tři opakování určují mean a spread.

| Úloha | Jazyk | qwen3.8 | qwen3:14b | Co se boduje |
|---|---:|---:|---:|---|
| en_grounded_summary | EN | 1,000 | 1,000 | 4 fakta, délka, bez rozporu |
| en_action_email | EN | 0,867 | 0,800 | pozdrav, vlastník, deadline, důsledek, délka |
| en_context_correction | EN | 1,000 | 1,000 | nové hodnoty, odstranění starých, jedna věta |
| en_missing_context | EN | 0,750 | 0,833 | projekt, prostředí, časové okno, nepředstírá spuštění |
| en_structured_extraction | EN | 0,800 | 0,800 | validní JSON, přesné klíče a tři fakta |
| en_translation_from_czech | EN | 1,000 | 1,000 | čtyři přesně přeložené informace |
| cz_grounded_summary | CZ | 1,000 | 1,000 | místo, datum, lidé, rozpočet, vedoucí, délka |
| cz_exact_bullets | CZ | 1,000 | 0,200 | přesně tři odrážky v pořadí, bez okolního textu |
| cz_context_correction | CZ | 1,000 | 1,000 | Olomouc, 11, datum, bez starých hodnot, jedna věta |
| cz_professional_reply | CZ | 0,600 | 1,000 | přijetí, pátek, kontakt, délka, diakritika, shoda rodu |

EN subscores: 0,9028 (`qwen3.8`) vs 0,9056 (`qwen3:14b`). CZ subscores:
0,9000 vs 0,8000. Stabilně rozlišující byly jen dvě CZ úlohy:
`qwen3.8` vyhrálo exact bullets o 0,8, incumbent professional reply o 0,4.
Poměr 1:1 nepotvrdil většinu kandidáta, proto CHAT zůstal beze změny.

Pozorované odpovědi dobře vysvětlují verdikt:

- `qwen3.8` vrátilo správně jen tři odrážky: `záloha databáze`,
  `ověření obnovy`, `zápis výsledku do auditu`.
- `qwen3:14b` instrukci porušilo a vrátilo tři dlouhé odstavce bez odrážek.
- `qwen3.8` v profesionální odpovědi třikrát napsalo chybně
  `Vaši požadavek`; explicitní penalizace snížila skóre na 0,6.
- `qwen3:14b` v této úloze splnilo všechny body.

Plné prompty a rubriky: [chat-v2-tests-20260823.json](./chat-v2-tests-20260823.json).
Všechna tři opakování, odpovědi a task-level grading:
[chat-v2-results-20260823.json](./chat-v2-results-20260823.json).

## CODE kalibrace

Multi-source historie nejprve odhalila kolizi runtime identit: různé zdrojové
soubory stejného commitu měly shodné `patch_<hash8>`. Tento první report je
diagnostický a nebyl použit. Identita byla změněna na task fingerprint,
doplněn regresní test a 32 fixture úloh nyní má 32 unikátních jmen.

Platné dávky:

- [code-patch-panel-multisource-small-v2-20260823.json](./code-patch-panel-multisource-small-v2-20260823.json):
  2/12 rozlišujících, 10 podlahových, bez šumu;
- [code-patch-panel-multisource-medium-20260823.json](./code-patch-panel-multisource-medium-20260823.json):
  1/6 rozlišující, 4 podlahové, 1 nestabilní.

Konečná fixture: 3 active, 17 reserve-floor, 1 reserve-unstable a 11
pending delších úloh. Hunt vyžaduje pro CODE `minimumTaskCount=6`; reálný
`--role=CODE --run` skončil `3/6` ještě před downloadem a GPU měřením.
Pět panelových modelů má své třúlohové exact-contract výsledky uložené.
Při rozšíření aktivní sady vznikne nový kontrakt; platné panelové JSON
reporty dovolí bez nového inference znovu sestavit baseline jen tehdy, když
pokrývají všechny nově aktivní task IDs.

## Historie a provozní pojistky

- `model_evaluation_runs` je append-only; COMPLETE je unikátní pro digest
  modelu + název sady + hash celého kontraktu.
- 73 legacy score řádků byla zachována jako nereusable BLOCKED evidence,
  protože historicky neukládala digest ani kontrakt.
- Dočasné selhání loadu kvůli resource contention zůstává v historii,
  ale nesmí trvale vyřadit model; prokázaný CPU spill na stejné GPU ano.
- Hunt a CODE panel sdílejí mezi-procesový GPU evaluation lock. Živý druhý
  proces skončí fail-fast; lease mrtvého PID lze bezpečně převzít.
- Pinned `validation-suites.js` a failover proof policy nebyly změněny.

## Ověření

- Osm relevantních sad: validation 82, model-upgrade 69, pairwise 32,
  candidate 32, schema 38, code-patch 15, runner 55, function-span 25 a
  extractor 13; celkem 361 testů, 0 selhání.
- Syntax check hlavních CLI a GPU locku, `git diff --check`, failover proof
  policy a SQLite `quick_check` prošly.
- Koncový host snapshot: přibližně 18 GiB dostupné RAM, žádný rezidentní
  Ollama model ani GPU compute proces a bez zbylého eval locku či dočasné
  code-patch jednotky.

## Známé hranice

1. CODE není rozhodovací sada, dokud nevzniknou alespoň tři další
   stabilně rozlišující úlohy. Metriku ani práh nesnižovat.
2. Binding application provedla runtime mutation, ale notification receipt je
   degraded. Produkční B3/B4 terminal activation zůstává mimo prototyp.
3. User timer je aktivní s kadencí 48 hodin a limitem dvou kandidátů. Běh se
   při obsazené GPU/Ollamě, méně než 8 GiB dostupné RAM nebo méně než 40 GiB
   volného disku bezpečně přeskočí. Automatická aplikace a mazání jsou vypnuté.
4. `model_universe` a stáří externího katalogu nejsou tímto pilotem
   vyřešeny; live Ollama discovery ale prošla všech 235 rodin.

## Konečné ověření po rozšíření

- Devět relevantních sad: validation 85, model-upgrade 75, pairwise 34,
  candidate 32, schema 38, code-patch 15, runner 55, function-span 25,
  extractor 13; dohromady 372 testů, 0 selhání. Pinned failover proof policy
  přidává 9/9, celkově tedy 381/381.
- Syntax check změněných CLI/modulů, `git diff --check`, systemd unit verify a
  SQLite `quick_check` prošly.
- Append-only historie obsahuje 36 COMPLETE přesných kombinací
  digest+sada+kontrakt a 94 zachovaných BLOCKED záznamů; duplicitní COMPLETE
  klíče: 0.
- `--json` po discovery vydává jediný validní JSON dokument; importované
  progress logy jej už nekazí.
- User timer byl instalován a aktivován. První automatický běh skončil s
  `ExecMainStatus=0`; Mistral 22B a Qwen 2.5 32B znovu potvrdily CPU spill,
  neproběhla kvalitativní inference, aplikace ani mazání. Další běh je
  2026-08-25 09:51 CEST.
- Koncový host: přibližně 18 GiB dostupné RAM, nulová okamžitá swap aktivita,
  83 GiB volného disku, žádný rezidentní Ollama model, žádný GPU compute
  proces, žádný eval lock a žádný zbylý hunt/calibrační proces.
