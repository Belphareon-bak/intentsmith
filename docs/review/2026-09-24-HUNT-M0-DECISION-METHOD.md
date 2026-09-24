# GPU hunt M0 — rozhodovací metoda, plánovač a σ z reálných dat

24. 9. 2026 · větev `work/hunt-decision-m0` · **PLANNING_EVIDENCE / NO_BINDING_CHANGE**.

**Revize 1 zapracována** (větev `work/hunt-m0-review-20260924`, na `acd3992b`).
Opravené dvě P1 z [review M0](/mnt/vi7000/intentsmith/evidence/hunt-m0-parallel-review-20260924/REVIEW.md):
orientace párů a ořez posunuté distribuce. Binární plány se vrátily ke KL,
spojité skóre má samostatný plán. Čísla v tomto dokumentu jsou přepočtená
opraveným kódem; staré hodnoty a rozdíly jsou v [§ Revize 1](#revize-1-24-9-večer).
Body z addenda review zůstávají otevřené.

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

Evidence po revizi 1: `/mnt/vi7000/intentsmith/evidence/hunt-m0-review-fixes-20260924/after-full.json`
(2 000 simulací na buňku, seed 20260924, deterministické; zmrazený snímek DB
`c3-snapshot.db`, SHA-256 `2766c7a1…`). Původní běh:
`/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/feasibility.json`.

## Výsledek na reálných datech (páry se současným bindingem)

MDE je nejmenší skutečné zlepšení, které plán zachytí s 80% silou.
„Škodlivá výměna“ = jak často by plán vyměnil model, který ve skutečnosti není lepší.
Rozdíly jsou vždy kandidát − současný model.

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
2. **CHAT jde pilotovat hned.** Se 40 skupinami rozhodne velké rozdíly (≥ 0,14) a odmítne nevhodné kandidáty. Na rozdíly kolem 0,10 je potřeba ~100–110 skupin.
3. **Ostatní role brzdí velikost sad, ne metoda.** Pro D1/D2/R1 (12 skupin) neexistuje bezpečná α, CODE a VISION jsou pod minimem. Plánovač to hlásí dřív, než se cokoli sbírá.
4. σ pochází ze starších sad (`chat_v3` je hodnocená regexovým checklistem). Nová konverzační CHAT sada (20 skupin) může mít jiné σ. Po ohodnocení se změří stejným skriptem.

## Nejmenší další krok

- **CHAT:** rozhodovat nad `chat_v3` (40) + konverzační sadou (20) = 60 skupin, s kalibrovanou α.
  - Chybí jen hodnocení konverzační sady. Stačí jednorázově dodat skóre po úlohách do stejné DB.
  - Pak jeden pilotní paired run qwen3.8 proti qwen3.5.
- **Ostatní role:** plánovač určí, kolik rozlišujících úloh je potřeba. Dokud je nemají, zůstanou v průzkumu.

## Pilot CHAT (24. 9. večer): skóre konverzační sady v DB a rozhodnutí na 60 skupinách

**Hodnocení.**
- Opakování 1 konverzačního panelu: 400 rozhovorů, 10 modelů × 40 úloh, 1 600 známek po kritériích.
- Hodnotil přechodný externí hodnotitel (Opus) naslepo podle rubriky `chat-conversation.2-draft`, váhy 0,4/0,3/0,2/0,1.
- Dva rozhovory přerušené infrastrukturou nahradilo opakování 2.
- Striktní JSON je ohodnocený mechanicky.
- Známky: `/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/opus-grading-20260924/grades.jsonl`.
- **Shoda s nezávislými ručními známkami GPT** na 59 společných dialozích: 88 % kritérií ±0,25, korelace 0,72.
- Systematický rozdíl: doslovná citace podvrženého pokynu (přísnější Opus) a diagnostika (přísnější GPT). Jsou to kandidáti na rozsouzení.

**Zápis.**
- `scripts/manual/import-chat-conversation-grades.mjs` přes `ModelEvaluationHistory.recordComplete` zapsal sadu `chat_conversation_pilot`, kontrakt `bf780068…`.
- Postup: záloha DB → zkušební zápis do kopie → ověření čtecím modelem živé release (`72247a49`) → zápis do živé DB → znovu ověřeno.
- Metadata `externalGrading.status = EXTERNAL_INTERIM_NOT_ACCEPTED`, `decisionAuthority:false`. Název sady se neshoduje s plánem role, takže běžící hunt z řádků autoritu nebere.
- Záloha: `/mnt/vi7000/intentsmith/evidence/hunt-decision-m0-20260924/db-backups/`.

| Model | Konverzační skóre | Rozdíl proti qwen3.5 (20 skupin) |
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

**Rozhodnutí (kalibrovaný párový t, α = 0,03 po revizi 1, dříve 0,02; `chat_v3` + konverzace = 60 skupin, jen shodné digesty).**
- σ proti současnému modelu je 0,166. Na 60 skupinách: MDE 0,111, škodlivá výměna 0,1 %.
- Pro rozhodnutí o zlepšení +0,10 je potřeba ~82 skupin.
- qwen3.8 proti qwen3.5: +0,024, interval [−0,006; +0,055].
  - Přínos 0,04 **neprokázán**.
  - **Nezhoršení prokázáno** i při toleranci 0,02.
  - Zrychlení na shodných voláních panelu **1,62×** (p50 4,1 s proti 7,3 s).
  - Podle druhé cesty kontraktu (`SPEED_WITH_NONINFERIOR_QUALITY`) tedy **ZMĚNIT**, jako pilotní doklad bez autority.
  - Plán schema 2 by tento pilot jako rozhodnutí nepřijal: plánovač pro 60 skupin vrací `EXPLORATORY_ONLY`, ne `FEASIBLE`, a hodnotitel ani doklad metody nejsou přijaté.
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
