# GPU hunt M0 — rozhodovací metoda, plánovač a σ z reálných dat

24. 9. 2026 · větev `work/hunt-decision-m0` · **PLANNING_EVIDENCE / NO_BINDING_CHANGE**.

**Revize 1 a 2 zapracované** (větev `work/hunt-m0-review-20260924`, na `acd3992b`).
- Revize 1 ([review M0](/mnt/vi7000/intentsmith/evidence/hunt-m0-parallel-review-20260924/REVIEW.md)):
  orientace párů, ořez posunuté distribuce, binární plány zpět na KL
  a samostatný plán pro spojité skóre ([§ Revize 1](#revize-1-24-9-večer)).
- Revize 2 ([posudek CHAT pilotu](/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/REVIEW-2-acd3992b.md)):
  přesné identity sad, oddělené výsledky sad, tolerance nezhoršení zamknutá
  na 0,02 a opravy faktů pilotu ([§ Revize 2](#revize-2-24-9-noc)).
- **Závěr „ZMĚNIT CHAT na qwen3.8“ se nepřijímá.** Pilot je průzkumná evidence.
- Čísla v dokumentu jsou přepočtená opraveným kódem na zmrazeném snímku DB.

## Co je hotové

| Část | Soubor | Co dělá |
|---|---|---|
| Metoda | `src/eval/decision-methods.js` | Přesná Studentova kvantilová funkce (shoda se scipy na 1e-6) a párový t-interval nad nezávislými skupinami. Pod 10 skupin vrací nerozhodný rozsah [−1, 1]. |
| Binární plány | `src/eval/code-pilot-decision.js` | Schema 1 (CODE pilot a workflow role, skóre 0/1) má dál jen KL. Párový t tu po revizi 1 neprojde validací; dřív by prošel i do produkční přejímky `ModelEvaluationAcceptanceStore`. |
| Spojité skóre | `src/eval/continuous-paired-decision.js` | Samostatný plán schema 2 pro rubrikové skóre v [0, 1]. Pečetí metriku, kontrakt rubriky s přijetím hodnotitele a přijatý doklad plánovače pro přesně tuto metodu, α, meze a počet skupin. Bez dokladu `FEASIBLE` od operátora plán neprojde. |
| Plánovač | `src/eval/decision-feasibility.js` | Přes skutečný rozhodovací interval simuluje sílu, chybné přijetí na obou hranicích, potřebný počet skupin, nejmenší zjistitelný rozdíl (MDE) a podíl **škodlivých výměn** (kandidát není lepší). Rozdíly převzorkuje z reálných párů modelů. **Kalibruje α** na datech role a ověří ji na nezávislých simulacích. Simulovaná populace má přesně uvedený průměr, ověřený před simulací (revize 1). Verdikt: `FEASIBLE` / `EXPLORATORY_ONLY` / `METHOD_UNSAFE`. |
| Měření σ | `scripts/hunt-decision-feasibility.mjs` | Z evaluační DB (jen čtení) vezme poslední ohodnocený běh každého modelu na nejširší sadě role, spočítá rozdíly po skupinách pro všechny páry i páry se současným bindingem a pustí plánovač. Páry se současným modelem jsou vždy kandidát − současný model. |

Testy: `tests/decision-methods.test.mjs` 13/13. Stávající `pairwise-trial` 49/49,
`evaluation-grading-acceptance` 17/17, `model-evaluation-acceptance` 17/17
a `artifact-validation` 160/160.

```bash
node scripts/hunt-decision-feasibility.mjs --also-groups=20,60,100 --out=feasibility.json
```

Evidence po revizi 2: `/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/r2-full.json`
(2 000 simulací na buňku, seed 20260924, deterministické; zmrazený snímek DB
`c3-snapshot.db`, SHA-256 `2766c7a1…`). Po revizi 1: `after-full.json`. Původní běh:
`/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/feasibility.json`.

## Výsledek na reálných datech (páry se současným bindingem)

MDE je nejmenší skutečné zlepšení, které plán zachytí s 80% silou.
„Škodlivá výměna“ = jak často by plán vyměnil model, který ve skutečnosti není lepší.
Rozdíly jsou vždy kandidát − současný model.
- **Tolerance nezhoršení je 0,02**, hodnota kontraktu do přijetí R2. α ani MDE
  se proti 0,05 nezměnily.
- **Síla prokázat nezhoršení je ale při 0,02 nízká.** U CHAT je 0,12, 0,18
  a 0,23 při 40, 60 a 100 skupinách; při 0,05 by byla 0,42, 0,56 a 0,71.
- **Všechny hlavní sady mají skupiny odvozené ze jmen úloh**
  (`ASSUMED_NAME_GROUPS`), žádná nemá doložený původ.

| Role | Sada | Skupin | σ | Škodlivá výměna | Dnes | 60 skupin | 100 skupin |
|---|---|---|---|---|---|---|---|
| CHAT | chat_v3 | 40 | 0,17 | 0 % | α 0,01 · MDE 0,14 · průzkum | α 0,02 · MDE 0,12 · průzkum | α 0,02 · MDE 0,10 · **rozhodne** |
| D1 | reasoning_v2 | 12 | 0,25 | 1,8 % | bezpečná α neexistuje | α 0,02 · MDE 0,16 · průzkum | α 0,03 · MDE 0,13 · průzkum |
| D2 | reasoning_v2 | 12 | 0,32 | 6,0 % | bezpečná α neexistuje | **nebezpečná**: α 0,03 neobstála při ověření | α 0,02 · MDE 0,16 · průzkum |
| R1 | reasoning_v2 | 12 | 0,33 | 6,7 % | bezpečná α neexistuje | α 0,02 · MDE 0,20 · průzkum | α 0,02 · MDE 0,16 · průzkum |
| R2 | review_v2 | 10 | 0,36 | 0,8 % | α 0,02 · MDE 0,43 · průzkum | α 0,04 · MDE 0,17 · průzkum | α 0,05 · MDE 0,14 · průzkum |
| CODE | code_patch | 7 | 0,50 | – | pod minimem 10 skupin | α 0,05 · MDE 0,21 · průzkum¹ | α 0,05 · MDE 0,17 · průzkum¹ |
| VISION | vision_v2 | 5 | 0,05 | – | pod minimem 10 skupin | α 0,03 · MDE 0,17 · průzkum | α 0,04 · MDE 0,14 · průzkum |

¹ U CODE leží ve 3 párech až 14 % hmoty na mezi ±1 a směrodatná odchylka
populace klesne na 0,68–0,77 pozorované. Čísla CODE proto nejvíc závisí na
zvolené konstrukci populace ([§ Revize 1](#revize-1-24-9-večer)).

**Stávající KL mez má ve všech rolích a velikostech sílu 0.** S ní hunt nikdy nic
nevymění. Ukázka proti živým bindingům (`demo` v JSON, α z kalibrace, tady 0,01):
- KL nerozhodne ani u zjevně nevhodných modelů.
- Kalibrovaný t na CHAT (40 skupin) vrátí PONECHAT pro llava:13b (−0,14, interval [−0,229; −0,051]). llava-llama3:8b (−0,13) zůstane nerozhodnutý, horní mez −0,030 nepřekročí toleranci −0,05.
- qwen3.8 i qwen3.6 jsou proti qwen3.5 v intervalu přibližně ±0,03, tedy na `chat_v3` rovnocenné. Tato sada rozdíly mezi nejlepšími modely nerozliší.

## Co z toho plyne

1. **Implementace a numerické testy procházejí; přejímka metody pro rozhodnutí role to není.** Kalibrace je nutná, protože nominální t na reálných, převážně nulových rozdílech s občasnými propady pouští ~5 % chybných přijetí místo 2,5 %. Po kalibraci je u CHAT škodlivá výměna 0 % (0,1 % před revizí). Verdikty na hranici tolerance jsou citlivé na šum Monte Carlo (viz D2 u 60 skupin).
2. **CHAT lze na `chat_v3` jen zkoumat, ne rozhodovat.** Hodnotitel `chat_v3` je pro aktuální runner zakázaný (`EVALUATOR_T5_FORBIDDEN`) a skupiny jsou odvozené ze jmen úloh. Plánovač podle ní odhadne velikost potvrzení: velké rozdíly (≥ 0,14) při 40 skupinách, rozdíly kolem 0,10 při ~100–110 skupinách.
3. **Ostatní role brzdí velikost sad, ne metoda.** Pro D1/D2/R1 (12 skupin) neexistuje bezpečná α, CODE a VISION jsou pod minimem. Plánovač to hlásí dřív, než se cokoli sbírá.
4. σ pochází ze starších sad (`chat_v3` je hodnocená regexovým checklistem). Nová konverzační CHAT sada (20 skupin) může mít jiné σ. Po ohodnocení se změří stejným skriptem.

## Nejmenší další krok

- **CHAT** (pořadí podle [posudku 2](/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/REVIEW-2-acd3992b.md)):
  1. Oddělené výsledky 40 historických a 20 nových skupin (hotovo, revize 2).
  2. Druhé nezávislé hodnocení sporných odpovědí.
  3. Krátká zkouška se skutečným systémovým promptem.
  4. Rozhodnutí o CHAT v celé sestavě rolí (M5).
  - Potvrzení potřebuje přijatou metriku a čerstvé skupiny s doloženým původem.
    Sjednocení sad ani `chat_v3` to nenahradí.
- **Ostatní role:** plánovač určí, kolik rozlišujících úloh je potřeba. Dokud je nemají, zůstanou v průzkumu.

## Pilot CHAT (24. 9. večer): skóre konverzační sady v DB a rozhodnutí na 60 skupinách

**Hodnocení.**
- Opakování 1 konverzačního panelu: 400 rozhovorů, 10 modelů × 40 úloh, 1 600 známek po kritériích.
- Hodnotil přechodný externí hodnotitel (Opus) podle rubriky `chat-conversation.2-draft`, váhy 0,4/0,3/0,2/0,1.
  Známky dával bez identit modelů. Tentýž panel ale předtím v relaci
  analyzoval s identitami (`exposure` v metadatech importu). Nejde tedy
  o nezávislé slepé hodnocení.
- Cizí práce na GPU přerušila v panelu dva rozhovory (`TRANSPORT_ERROR`).
  Hodnotí se opakování 1, takže náhradu z opakování 2 potřeboval jen jeden:
  phi4 `en_duplicate_events`. Druhý (qwen3.6, opakování 2) se nehodnotil.
  V DB je 399 rozhovorů z opakování 1 a jeden z opakování 2.
- Striktní JSON má formát hodnocený mechanicky zvlášť (`formatStrict`).
  Čtyři selhání formátu (phi4 a devstral, obě jazykové verze) mají obsahové
  skóre 1,0. Vážené konverzační skóre formát nezahrnuje.
- Známky: `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/grades.jsonl`.
- **Shoda s nezávislými ručními známkami GPT** na 59 společných dialozích: 88 % kritérií ±0,25, korelace 0,72.
- Systematický rozdíl: doslovná citace podvrženého pokynu (přísnější Opus) a diagnostika (přísnější GPT). Jsou to kandidáti na rozsouzení.

**Zápis.**
- `scripts/manual/import-chat-conversation-grades.mjs` přes `ModelEvaluationHistory.recordComplete` zapsal sadu `chat_conversation_pilot`, kontrakt `bf780068…`.
- Postup: záloha DB → zkušební zápis do kopie → ověření čtecím modelem živé release (`72247a49`) → zápis do živé DB → znovu ověřeno.
- Metadata `externalGrading.status = EXTERNAL_INTERIM_NOT_ACCEPTED`, `decisionAuthority:false`. Název sady se neshoduje s plánem role, takže běžící hunt z řádků autoritu nebere.
- Záloha: `/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/db-backups/`.

| Model | Konverzační skóre (obsah, bez formátu) | Rozdíl proti qwen3.5 (20 skupin) |
|---|---|---|
| qwen3.8 | 0,953 | +0,069 |
| gemma4:26b | 0,921 | +0,036 |
| qwen3.6:27b | 0,909 | +0,024 |
| qwen3.5:27b (současný) | 0,884 | 0 |
| ornith-1.5:9b | 0,863 | −0,021 |
| qwen3-30b-a3b | 0,802 | −0,082 |
| qwen3:14b | 0,764 | −0,121 |
| qwen3-coder | 0,745 | −0,139 |
| devstral-small-2 | 0,666 | −0,218 |
| phi4:14b | 0,649 | −0,235 |

**Výsledek (průzkumný).** Kalibrovaný párový t, tolerance nezhoršení 0,02,
jen shodné digesty. Každá sada má vlastní kalibraci.

| Podklad | Kontrakt | Skupiny | α | qwen3.8 − qwen3.5 | Interval | MDE | Síla nezhoršení 0,02 |
|---|---|---|---|---|---|---|---|
| `chat_v3` | `da287deb…` | 40, ze jmen úloh | 0,01 | +0,002 | [−0,027; +0,032] | 0,142 | 0,12 |
| `chat_conversation_pilot` | `bf780068…` | 20, výslovné | 0,03 | +0,069 | [−0,012; +0,149] | 0,172 | 0,06 |
| Sjednocení, jen průzkum | obě | 60 | 0,03 | +0,024 | [−0,006; +0,055] | 0,111 | 0,14 |

- **Sady se neshodují.** Nová konverzační sada dává +0,069, historická +0,002.
  Sjednocení průměruje dvě různá měřítka, jednou přijatou sadou není
  (`EXPLORATORY_UNION_NOT_AN_ACCEPTED_SUITE`).
- **Přínos 0,04 není prokázaný** v žádném z podkladů.
- **Nezhoršení o 0,02 doložené není.** Dolní mez leží nad −0,02 u nové sady
  (−0,012) a u sjednocení (−0,006), u `chat_v3` ne (−0,027). Plán ale má sílu
  jen 0,06–0,14. Jde o prosté porovnání, ne o doklad přijatou metodou.
- **Zrychlení 1,62×** je poměr součtů času na 348 shodných voláních
  (40 úloh × 3 opakování, všechna kola), stejně jako `speedup` v rozhodovacím
  pravidle. Mediány volání jsou 4,1 s a 7,3 s, jejich poměr je 1,79×. Známky
  jsou z opakování 1, časy ze všech tří.
- **Verdikt: ZMĚNIT se nepřijímá.** Důvody:
  - hodnotitel není přijatý a nebyl nezávisle slepý;
  - `chat_v3` je pro aktuální runner zakázaný;
  - plánovač vrací `EXPLORATORY_ONLY`;
  - plán schema 2 by pilot jako rozhodnutí odmítl.
- qwen3.8 zároveň splňuje navržené CHAT brány: citovaný pokyn 6/6 odmítnut, žádný únik. qwen3.5 česky pokyn převzal (3/3).
- gemma4 a qwen3.6 mají na stejném digestu jen 20 skupin, takže rozhodnutí je nerozhodné. qwen3.6 navíc česky převzal podvržený pokyn.

**Konflikt sestavy.**
- Živé bindingy už dávají qwen3.8 role D2, CODE a R1.
- CODE+R1 je podle dnešní `independentRolePairs` zakázaná dvojice, takže dnešní stav pravidlo porušuje.
- Přidání CHAT by znamenalo čtyři role.
- Výměnu CHAT je proto nutné řešit spolu se sestavou (M5).

**Omezení.**
- Hodnotitel není přijatý (jeden externí hodnotitel, ne dvojice).
- Panel běžel bez produkčního systémového promptu a s `think:false`.
- Rychlost je měřená v podmínkách panelu.

## Revize 1 (24. 9. večer)

Zdroj: [review M0](/mnt/vi7000/intentsmith/evidence/hunt-m0-parallel-review-20260924/REVIEW.md),
obě P1 a tři poznámky k integraci. Bez inference a bez zápisu do produkční DB.
Bindingy beze změny.

### P1 — orientace párů

- **Vada:** znaménko rozdílu určovalo pořadí běhů podle `completed_at`. Vzácná
  prohra kandidáta se tak v kalibraci mohla stát vzácnou výhrou. Fixture z review
  při prohození časů přepnula `FEASIBLE` na `METHOD_UNSAFE`.
- **Oprava:** `orientedPairPools()` v `decision-feasibility.js`.
  - Páry se současným modelem jsou vždy kandidát − současný model.
  - Současný model je přesný digest nejnovějšího běhu pod jménem z bindingu.
  - Modely i skupiny jsou seřazené podle digestu a klíče. Pořadí řádků nemění
    znaménko ani sekvenci převzorkování.
  - Souhrn přes všechny páry obsahuje každý pár v obou pojmenovaných směrech. Je
    označený `ALL_ORDERED_PAIRS_MIXTURE` a `perCandidateGuarantee:false`.
- **Ověření:**
  - Obě fixture review dávají teď shodný výstup celé role, obě `METHOD_UNSAFE`.
  - Test: tři pořadí vstupu dávají shodné pooly i shodný výsledek plánovače.
  - Obrácený tvar by prošel s α 0,05, správně orientovaný bezpečnou α nemá.

### P1 — ořez posunuté distribuce

- **Vada:** posun a následný ořez do [−1, 1] měnil průměr. U příkladu z review
  bylo požadováno +0,04, simulovalo se −0,056. Chybná populace se týkala
  `falseAcceptAtBoundary`, síly, MDE, potřebného N i škodlivé výměny.
- **Oprava (modelové rozhodnutí, ke schválení):**
  - Pozorovaný tvar se posune. Hmota, která by přesáhla ±1, zůstane na mezi.
  - Posun se dopočítá tak, aby omezená populace měla přesně požadovaný průměr.
  - Pro normální model totéž analyticky: cenzorovaná normální, přesná Φ.
  - Před každou simulací se průměr ověří s tolerancí 1e-12, jinak
    `FEASIBILITY_POPULATION_MEAN_MISMATCH`. Průměr mimo (−1, 1) se odmítne.
- **Co se ukládá:** každý výsledek plánovače nese `population` s verzí
  `bounded-location-shift-v2`. U hranic kvality a nezhoršení, u rovnosti
  a u plánovaného efektu uvádí:
  - největší chybu průměru;
  - počet párů s hmotou na mezi a její největší podíl;
  - nejmenší poměr σ proti pozorovanému tvaru.
- **Příklad z review:** z [−1, −1, −1, 1, 1] je při +0,04 populace
  [−0,6 ×3, 1, 1] s průměrem 0,04. Na mezi leží 40 % hmoty, σ je 0,8× pozorované.
- **Alternativa:** odmítnout pooly, které by mez přesáhly. U CODE by pak
  plánovač neměl čím simulovat větší efekty.

### Integrace

1. **Schema 1 (binární) má jen KL.** `validatePairedPlan` platí pro CODE pilot,
   workflow role a tím i pro `ModelEvaluationAcceptanceStore`. Tabulka
   `model_evaluation_acceptances` v živé DB je prázdná (ověřeno jen čtením),
   takže se žádný uložený plán nezneplatní. Reprodukce nulového rozptylu z review,
   tedy CODE plán s t a rychlostní cestou, už validací neprojde.
2. **Schema 2 pro spojité skóre** v `continuous-paired-decision.js`:
   `validateContinuousPairedPlan(plan, role, metric)` a `decideContinuousPairedPlan`.
   - Plán pečetí `scoreScale: continuous-0-1` a `rubric` (kontrakt a přijetí
     hodnotitele).
   - `methodEvidence` musí nést:
     - verzi modelu plánovače;
     - verdikt `FEASIBLE` a orientaci;
     - přesnou metodu, α, meze a počet skupin;
     - hash reportu;
     - přijetí operátorem před `lockedAt`.
   - Pokus `GRADED` nese hash kontraktu rubriky a známky. `OPERATIONAL_FAILURE`
     je viditelná nula za plný rozpočet.
   - Pravidlo a výstup jsou stejné jako u schema 1: doporučení, žádná aktivace.
3. **Dostupný helper není přijatá metoda.** Schema 2 odmítne `METHOD_UNSAFE`
   i `EXPLORATORY_ONLY`. Zatím ho nikdo nevolá.

### Před a po na stejném snímku DB

Páry se současným modelem. „Nebezpečná“ = bez bezpečné α (`METHOD_UNSAFE`).

| Role | Dnes před → po | 60 skupin před → po | 100 skupin před → po |
|---|---|---|---|
| CHAT (`chat_v3`, 40) | α 0,02 · MDE 0,132 → α 0,01 · MDE 0,142 | α 0,015 · 0,114 → α 0,02 · 0,117 | rozhodne: α 0,02 · 0,097 → α 0,02 · 0,098 |
| CHAT pilot (60) | α 0,02 · MDE 0,114 · N 94 → α 0,03 · MDE 0,111 · N 82 | stejné jako „dnes“ | rozhodne: α 0,03 · 0,094 → α 0,05 · 0,091 |
| D1 | nebezpečná → nebezpečná | α 0,03 · 0,153 → α 0,02 · 0,157 | α 0,04 · 0,129 → α 0,03 · 0,131 |
| D2 | nebezpečná → nebezpečná | α 0,015 · 0,192 → **nebezpečná** | α 0,03 · 0,152 → α 0,02 · 0,157 |
| R1 | nebezpečná → nebezpečná | α 0,015 · 0,200 → α 0,02 · 0,196 | α 0,02 · 0,165 → α 0,02 · 0,163 |
| R2 | α 0,03 · 0,411 → α 0,02 · 0,432 | α 0,05 · 0,168 → α 0,04 · 0,172 | α 0,04 · 0,143 → α 0,05 · 0,140 |
| CODE | pod minimem | α 0,005 · 0,283 → α 0,05 · 0,206 | nebezpečná → α 0,05 · 0,171 |
| VISION | pod minimem | α 0,03 · 0,177 → α 0,03 · 0,170 | α 0,04 · 0,149 → α 0,04 · 0,135 |

- **CHAT:** posun α způsobila orientace. U CHAT na jmenovaných bodech na mez
  dosáhne nejvýš jeden pár s 2,5 % hmoty.
- **CODE:** posun způsobila hlavně nová konstrukce populace. Ve 3 párech je až
  14 % hmoty na mezi.
- **D2 u 60 skupin:** kalibrace vybrala α 0,03 s chybným přijetím 0,0225,
  ověření na čerstvých simulacích naměřilo 0,040. Ověření fungovalo, ale
  2 000 simulací nerozliší 0,025 od 0,03.
- **Škodlivá výměna bez bezpečné α** (nominální 0,05) vzrostla: D1 z 1,5 na
  1,8 %, D2 ze 4,0 na 6,0 %, R1 z 5,1 na 6,7 %.

### Ověření

- **Testy:**
  - `tests/decision-methods.test.mjs` 13/13. Nové: přesný průměr populace
    (včetně deterministického průchodu 60 poolů × 7 průměrů), CDF
    a cenzorovaný průměr proti Simpsonově integraci, invariance orientace,
    KL v schema 1, schema 2.
  - `pairwise-trial` 49/49, `evaluation-grading-acceptance` 17/17,
    `model-evaluation-acceptance` 17/17, `artifact-validation` 160/160.
  - Dalších 15 sad, které importují dotčené moduly, prošlo bez selhání, mimo
    jiné `model-upgrade` 104, `governor` 74, `desktop-hunt` 40
    a `candidate-trial` 38.
  - Úplný offline/database audit spuštěný nebyl.
- **SYSTEM-MAP:** census `src/**/*.js` je 229 289 ř. v 657 souborech.
- **Registr testů:** validní, 539 programů. Přegenerovaný `docs/convergence/TEST-REGISTRY.md`
  byl zastaralý od `5b128633`, kde přibyla sada bez přegenerování.
- **Evidence** v `/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/`:
  - `run.sh`: stejný snímek, stejné argumenty, kód `acd3992b` proti opravenému;
  - `before-*.json`, `after-*.json`, logy;
  - `comparison.json` a `compare.py`;
  - `c3-snapshot.db` s `.sha256`.

### Otevřené

Stav po revizi 1; aktuální seznam je v [§ Revize 2](#revize-2-24-9-noc).

1. **Výběr sady (addendum 1).** `roleData` bere jediný kontrakt podle pokrytí.
   `--extra-suite` slučuje podle jména sady, ne podle přijatého kontraktu.
2. **Skupiny (addendum 2).** Jsou odvozené ze jmen úloh a doložený původ
   nemají. Platí jako předpoklad plánovače.
3. **Zdroj rozhodnutí (addendum 3).** `chat_v3` je pro aktuální runner
   `EVALUATOR_T5_FORBIDDEN` a konverzační sada je vývojová. Body 2–3 v „Co z toho
   plyne“ a „Nejmenší další krok“ tomu zatím neodpovídají.
4. **Záruka pro jednotlivého kandidáta.** Kalibrace nad páry se současným
   modelem je směs tvarů kandidátů (`INCUMBENT_PAIRS_MIXTURE`). Nejhorší
   jednotlivý kandidát může být nad tolerancí.
5. **Šum kalibrace.** Viz D2 u 60 skupin. Výběr největší α z mřížky nad šumem
   je optimistický.
6. **Hotové z addenda 4:** demo bere kalibrovanou α (`acd3992b`). Bez kalibrace
   je v JSON označené `alphaSource: NOMINAL_UNCALIBRATED`.

## Revize 2 (24. 9. noc)

Zdroj: [posudek CHAT pilotu `acd3992b`](/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/REVIEW-2-acd3992b.md).
Obě jeho P1, tedy orientaci a simulátor, řešila už revize 1. Zbytek je tady.
Bez inference a bez zápisu do produkční DB.

### P1 — 60 skupin není jedna sada

- **Oddělené výsledky:** `scripts/hunt-decision-feasibility.mjs` při přidané
  sadě počítá každou sadu zvlášť, na jejích skupinách a s vlastní kalibrací
  (`components[i].incumbentPairs`, `components[i].demo`).
- **Označení sjednocení:** je vedené jako `EXPLORATORY_UNION_NOT_AN_ACCEPTED_SUITE`.
- **Zdroj skupin:** každá sada ho uvádí jako `groupSource` (`EXPLICIT`,
  `ASSUMED_NAME_GROUPS` nebo `MIXED`) spolu s počty řádků.
  - `chat_v3`: všech 480 řádků má skupiny ze jmen.
  - Konverzační sada: všech 400 řádků má skupiny zapsané výslovně.
- Výsledky jsou v tabulce pilotu výše.

### Tolerance nezhoršení

- **Jedna tolerance všude:** `--ni-margin`, výchozí 0,02. Platí pro kalibraci,
  verdikty plánovače i demo a report ji uvádí u každé role.
- **0,05 jen jako diagnostika:** zůstává v `pairedTMargin005` pro návrh R2.
- **Kontrolní běh:** s `--ni-margin=0,05` vyšel sjednocený CHAT výsledek
  bit po bitu stejně jako po revizi 1 (`r2-chat-pilot-margin005.json`
  proti `after-chat-pilot.json`).
- **Dopad 0,02:** α a MDE se v žádné roli nezměnily, síla nezhoršení klesla
  (viz poznámka pod tabulkou rolí).

### P2 — identita výsledku

- **Přesný kontrakt u přidané sady:** `--extra-suite=ROLE:název@sha256`.
  Bez kontraktu skript skončí `EXTRA_SUITE_CONTRACT_REQUIRED`. Běhy se vybírají
  podle názvu i kontraktu, takže nová verze se stejným názvem se do výsledku
  nedostane.
- **Připnutí hlavní sady:** `--suite=ROLE:název@sha256`. Bez něj se dál bere
  sada s nejširším pokrytím, výsledek to ale uvádí (`selection: WIDEST_COVERAGE`).
- **Identity v reportu:** `components[]` nese u každé sady název, kontrakt,
  způsob výběru, počet modelů a skupin.

### Opravy faktů pilotu (ověřeno ze snímku DB a `review-full-05`)

- **Náhrada rozhovorů:** v DB je 399 rozhovorů z opakování 1 a jeden
  z opakování 2. Cizí práce na GPU přerušila dva rozhovory, jeden z nich ale
  byl v nehodnoceném opakování 2.
- **Striktní JSON:** čtyři selhání formátu mají obsahové skóre 1,0 a vážené
  skóre je nevidí. Tabulka to teď uvádí.
- **Zrychlení:** 1,62× je poměr součtů času (definice `speedup`), 1,79× poměr
  mediánů. Obě čísla i jejich definice jsou v textu.
- **„Naslepo“:** označení bylo odstraněné. Hodnotitel viděl panel dřív
  s identitami.
- **Zápis do živé DB:** snímek je kopie živé DB a obsahuje 10 běhů
  `chat_conversation_pilot` s kontraktem `bf780068…`. Tím je zápis ověřený
  i mimo importní log.

### Ověření

- **Nová sada** `tests/hunt-decision-feasibility.test.mjs` 4/4 (profil
  `database`, izolovaná SQLite) spouští celý skript nad syntetickou DB:
  - návnada se stejným názvem sady a novějším kontraktem se nepoužije;
  - obě sady mají vlastní výsledek;
  - tolerance je všude stejná;
  - prohození časů a pořadí řádků nemění žádný výsledek role.
- **Test zachytí původní chybu:** proti skriptu z `acd3992b` selžou všechny
  čtyři testy. Samotné prohození časů tam změní verdikt z `METHOD_UNSAFE`
  na `EXPLORATORY_ONLY`.
- **Registr** má 540 programů; README, SYSTEM-MAP a `TEST-REGISTRY.md` jsou
  srovnané.
- **Evidence:** `run-r2.sh`, `r2-full.json`, `r2-chat-pilot.json`
  a `r2-chat-pilot-margin005.json` ve stejném adresáři.

### Otevřené

1. **Hodnocení a prompt.** Druhé nezávislé hodnocení sporných odpovědí
   a krátká zkouška se skutečným systémovým promptem potřebují inferenci
   a hodnotitele. Neproběhly.
2. **CHAT v sestavě rolí (M5).** Rozhodnutí je až po bodu 1. qwen3.8 už drží
   D2, CODE a R1 a CODE+R1 je zakázaná dvojice.
3. **Přijatá metrika a čerstvé skupiny pro CHAT.** `chat_v3` je jen diagnostika.
4. **Výběr hlavní sady** bez `--suite` zůstává podle pokrytí.
5. **Záruka pro jednotlivého kandidáta a šum kalibrace:** trvá z revize 1.
6. **Konstrukce populace u mezí:** modelové rozhodnutí z revize 1 čeká na
   schválení.
