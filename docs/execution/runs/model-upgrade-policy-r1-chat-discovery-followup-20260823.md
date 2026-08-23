# Model upgrade v136.1 — follow-up 2026-08-23

**Základ:** `3b1d3bbf`  
**Host:** NVIDIA GeForce RTX 3090, 24 GiB VRAM, Ollama 0.32.14  
**Výsledek:** R1 incumbent obhájen; CHAT v3.5 fail-closed; discovery opravené;
retence implementovaná; `qwen3.6` fyzicky ověřen bez změny bindingu

## 1. Potvrzená produktová pravidla

- Pro současný prototyp platí nezávislé dvojice D1–R1, CODE–R1, CODE–R2 a
  D2–R2. Nejsou prohlášené za navždy konečný stav, ale neobcházejí se kvůli
  jednomu vítězi.
- Retence se spouští pouze pod 40 GiB volného místa. Smí odstranit jen nevázaný
  artefakt starší sedmi dnů, který není incumbent ani poslední rollback.
- Přesný digest bez alespoň jednoho `COMPLETE` scoringu je vždy chráněný.
- GPU hunt běží každých 48 hodin, nejvýše pro dva dosud neoscorované kandidáty.
  Automatická aplikace zůstává vypnutá do uzavření notification/B3/B4 řetězce.

## 2. R1 párové přeměření

Artefakt:
[`model-upgrade-r1-current-field-20260823.json`](model-upgrade-r1-current-field-20260823.json)

| Kandidát proti `qwen3.8` | Rozlišující úlohy | Výhry | Marže | Verdikt |
|---|---:|---:|---:|---|
| `qwen3.5:27b` | 0 | 0:0 | 0 | nerozhodně, rychlost 0,99× |
| `qwen3-30b-a3b:latest` | 3 | 0:3 | −0,363 | prohra, vysoká jistota |
| `qwen3:14b` | 2 | 0:2 | −0,444 | prohra, střední jistota |
| `phi4:14b` | 2 | 0:2 | −0,444 | prohra, střední jistota |

`qwen3.8` R1 proti dnešnímu lokálnímu poli obhájil. Tím se neuvolnil pro CODE;
doložené CODE vítězství 4:0 se tedy správně neaplikovalo přes zákaz CODE–R1.

## 3. CHAT v3.4 a opravený kontrakt v3.5

Sada má 40 úloh, 24 EN a 16 CZ, každá se skóre 0..1 z více checklistových
složek. Přibyly tři EN a dvě CZ úlohy souvislého textu. Aktuální přesné prompty
a rubric jsou přiložené níže pod kontraktem v3.5.

Panel pěti modelů:

| Model | Celkem | EN | CZ | tok/s |
|---|---:|---:|---:|---:|
| `qwen3-30b-a3b` | 0,8872 | 0,8903 | 0,8826 | 175,2 |
| `qwen3.5:27b` | 0,9031 | 0,9292 | 0,8639 | 37,6 |
| `qwen3:14b` | 0,8938 | 0,9229 | 0,8500 | 69,0 |
| `phi4:14b` | 0,8574 | 0,8868 | 0,8132 | 72,9 |
| `qwen3.8` | 0,9163 | 0,9317 | 0,8931 | 34,9 |

Absolutní průměr by vybral `qwen3.8`, ale párový důkaz proti CHAT incumbentu
`qwen3.5` má jen 5 stabilně rozlišujících úloh (EN 2, CZ 3), byť v poměru 4:1.
Brána vyžaduje nejméně 7, z toho EN 3 a CZ 4, proto je verdikt pravdivě
`incumbent / insufficient evidence`. Panel jako celek rozlišil 12 úloh
(EN 9, CZ 3). Česká část se zlepšila ze dvou na tři panelově stabilní signály,
ale pořád nestačí; práh se nesnižoval.

Kompletní task-level odpovědi, rozptyl a párové delty:
[`model-upgrade-chat-v3.4-evidence-20260823.json`](model-upgrade-chat-v3.4-evidence-20260823.json).
První v3.3 panel zůstává v append-only DB historii. Ruční kontrola následně našla
tři příliš úzké podmínky graderu: legitimní anglické vyjádření chybějící
dodávky a podmínky termínu a větu `no reliability data available`, plus české
`vaší` před interpunkcí. Oprava vytvořila nový contract hash v3.5; staré skóre
se pod ním znovu nepoužilo.

Čisté přeměření v3.5 mezi `qwen3.6` a `qwen3.5` dalo kandidátovi celkové skóre
0,9251 proti 0,9139 (EN 0,9433 proti 0,9472; CZ 0,8979 proti 0,8639).
Stabilně ale rozlišovalo jen pět úloh: EN 1 a CZ 4, poměr výher 4:1 a marže
0,0933. Brána vyžaduje 7 celkem, EN 3 a CZ 4, proto se CHAT vazba nezměnila.
Přesná v3.5 zadání a checklisty jsou v
[`chat-v3.5-tests-and-rubrics-20260823.json`](chat-v3.5-tests-and-rubrics-20260823.json),
odpovědi a task-level skóre v
[`model-upgrade-chat-v3.5-evidence-20260823.json`](model-upgrade-chat-v3.5-evidence-20260823.json).

## 4. Discovery — příčina a oprava

Původní živý běh sice prošel 235 Ollama rodin, ale:

- míchal embedding, OCR, vision, safety a coding rodiny do textových rolí;
- zahazoval relativní stáří z živého katalogu;
- importoval Hugging Face klienta, ale vůbec ho nepoužil;
- `null` stáří se při rankingu mohlo převést na nulu a falešně znamenat
  „aktualizováno dnes“;
- whatllm kvalitativně pokrývá jen malou část rodin, takže neznámé nové rodiny
  neměly screeningový signál.

Opravený tok:

1. načte všechny živé Ollama rodiny a pro každou největší rozumnou variantu,
   která může projít 24GiB předfiltrem;
2. oddělí kategorie před role rankingem;
3. použije stáří aktualizace pouze jako prioritu ke scoringu, nikdy jako kvalitu;
4. u omezeného sjednocení 16 nejčerstvějších a 8 externě hodnocených kandidátů
   ověří přes Hugging Face datum vydání a modalitu;
5. teprve fyzický role-specific souboj smí model označit za lepší.

Ve frontě mají přednost už nainstalované artefakty s chybějícím aktuálním
suite contractem. Plánovaný běh před každým vzdáleným kandidátem kumulativně
odečte jeho hlášenou velikost a pull nepovolí, pokud by po něm zůstalo méně než
40 GiB. Dva velké kandidáty tak nelze stáhnout jen proto, že rezerva existovala
na začátku ticku.

Konečný snapshot po opravě `null` stáří, HF ověření, vyřazení safety,
embedding, OCR a translation modelů z nesouvisejících rolí:
[`model-upgrade-live-shortlist-v6-20260823.json`](model-upgrade-live-shortlist-v6-20260823.json).

Nejdůležitější nalezené rodiny vedle již změřeného `qwen3.8`:

| Rodina | Velikost | Zamýšlené role | Stav |
|---|---:|---|---|
| `qwen3.6:27b-mtp-q4_k_m` | 18 GB | reasoning, CHAT; CODE/R2 čeká | fyzicky změřen, bez vítězství |
| `north-mini-code-1.0` | 19 GB | CODE, R2 | první specializovaný CODE kandidát |
| `glm-4.7-flash` | 19 GB | reasoning/chat | čeká na scoring |
| `gemma4:31b` | 20 GB | VISION | čerstvý vision kandidát; těsná VRAM |
| `muse-glimmer:30b` | 20 GB | VISION | čerstvý vision kandidát; těsná VRAM |
| `laguna-xs-2.1` | 20 GB | CODE, R2 | příliš čerstvý; nejdřív maturity gate |
| `ornith-1.5:9b` | 6,6 GB | lehké textové role | příliš čerstvý; nejdřív maturity gate |
| `minicpm-v4.6` | 2,6 GB | VISION | levný samostatný vision kandidát |

## 5. GPU a host safety

- Všechny modely se měří jednotlivě po stabilním vyprázdnění Ollama residency;
  nejde o souběh nebo skládání dvou modelů do VRAM.
- `drainResident()` vyžaduje čtyři po sobě jdoucí prázdná pozorování a na
  NVIDIA také prázdný compute-process seznam, protože `/api/ps` může být
  prázdné několik sekund před uvolněním CUDA procesu. Neúspěšný drain už
  měření zastaví; nepokračuje s kontaminovanou VRAM.
- Placement se po loadu krátce polluje; opožděné `/api/ps` už nevyrábí falešný
  „model se nenačetl“ výsledek.
- Cizí procesy ani sessions nebyly ukončeny. Swap byl zaplněný už na vstupu,
  ale během GPU práce nebyl pozorován swap-in ani swap-out; `swapoff` se
  nepoužil.

## 6. Retence

`ModelRegistry.runAutoCleanup()` teď před inventurou ověří tlak na disk a
fail-closed skončí bez mazání při nečitelném stavu nebo při alespoň 40 GiB
volného místa. Před každým přesným delete navíc vyžaduje `COMPLETE` záznam pro
tentýž digest. Po každém odstranění odhadne obnovené místo a skončí hned po
dosažení 40 GiB. Všechny dosavadní binding, rollback, usage, age, digest a
exclusive-mutation guardy zůstávají v platnosti. Kandidát, který nikdy nebyl
nasazen do gateway, není nesmazatelný navždy: jeho dokončený digest-bound
scoring a stáří artefaktu jsou důkazem pro retenci; nečitelná usage historie
stále znamená bez mazání.

Živá databáze na tomto hostu má přísnější automation-policy storage kontrakt z
paralelní M1 linky (`committed_revision` a `after_*` event fields), zatímco tato
v136.1 větev ještě čte starší event projekci. Reader proto správně vrací
`DB_ERROR/default OFF`. Retence nebyla aktivována přímým SQL; po integraci
autority musí být zapnuta typed writerem na 7 dnů. Samotná cleanup implementace
a její fresh-schema testy jsou hotové.

## 7. Fyzický pilot `qwen3.6`

Artefakty:
[`model-upgrade-qwen36-pilot-20260823.json`](model-upgrade-qwen36-pilot-20260823.json),
[`model-upgrade-chat-v3.5-qwen36-corrected-20260823.json`](model-upgrade-chat-v3.5-qwen36-corrected-20260823.json).

- Přesný artefakt se při 32k kontextu načetl celý na GPU
  (17 425 948 998 B VRAM, 0 B CPU spill) a dosáhl 37,3 tok/s.
- Schopnostní minimum prošlo 3/3.
- Pro D1 prohrál s `qwen3.5` na jediné stabilně rozlišující úloze; pro R1 byl
  proti `qwen3.8` nerozhodný. Žádná reasoning vazba se nezměnila.
- V CHAT v3.5 měl vyšší absolutní skóre a vyhrál 4:1, ale nesplnil počet
  stabilních anglických úloh. Fail-closed verdikt ponechal `qwen3.5`.
- CODE a REVIEW zůstávají jako dva neviděné suite contracty v durable frontě.
  Nebyly spuštěny, protože operátor po CHAT běhu požádal uvolnit GPU.
- Po běhu byly `ollama ps` i seznam compute procesů `nvidia-smi` prázdné.

## 8. Otevřený stav

- První aplikovaný upgrade zůstává `APPLIED_NOTIFICATION_DEGRADED`; durable
  vazba je změněná, ale notification receipt/B3/B4 řetězec není terminálně
  ověřený.
- Plný pěti-modelový panel v3.4 měl jen tři české stabilní signály. Párové
  přeměření v3.5 už mělo čtyři, ale pouze jeden anglický a pět celkem. Další
  kalibrace musí přidat stabilní signál, ne snížit práh ani vyrábět vítěze
  úpravou graderu.
- `model_universe_raw` a `model_universe_derived` zůstávají prázdné; tento
  prototyp drží přesnou historii provedených evaluací a snapshoty discovery,
  ale dosud nezapisuje celý živý katalog do univerza produkčního discovery.
- Live automation-policy read je kvůli výše popsanému cross-line schema driftu
  fail-closed `DB_ERROR`; `autoCleanupEnabled` i `autoFailoverEnabled` proto
  zůstávají efektivně OFF, dokud se nesjednotí M1 authority.

## 9. Závěrečná verifikace

- 13 relevantních sad: **465 passed, 0 failed**.
- `validation-suites.js` a `model-profiles.js` nemají žádný diff; source-pin
  proof policy prošla 9/9.
- Všechny nové JSON artefakty projdou `jq`, změněné JS soubory `node --check`
  a celý strom `git diff --check`.
- `data/c3.db`: `quick_check=ok`, 60 `COMPLETE`, 102 `BLOCKED`, nula duplicit
  pro přesnou trojici digest + suite + contract.
- Živý katalog: 235 rodin; lokálně 13 modelů; pro model storage zbývá
  62 366 314 496 B. Další 19GB pull se proto nespustil naslepo před retencí.
- `intentsmith-model-hunt.timer` je `enabled` a `active`, další běh je
  2026-08-25 09:51 CEST.
