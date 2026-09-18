# CODE pilot — oprava měřidla a výsledkových tříd

Autorita: [schválený kontrakt](../wp/WP-GPU-HUNT-EVALUATION-CONTRACT-20260918.md),
zejména §3–5 a §8 kroky 1–3. **IMPLEMENTATION_PARTIAL / REVIEW_PENDING /
PILOT_INCOMPLETE / NOT_DEPLOYED.** Tento checkpoint není přijetí pilotu.

## Reprodukované vady a chování opravy

- Nedostupný historický commit v `applyAndTest` dostával skóre 0. Nyní je
  `ENVIRONMENT_INVALID`, `valid=false`, `score=null`. Totéž platí pro chybějící
  test a doložené selhání spuštění izolovaného prostředí.
- Vypsané cílové `PASS` před pozdějším pádem procesu dovolovaly plný bod.
  Plný bod nyní vyžaduje úspěšný testovací proces; wrapper ověřuje dokončení
  importu testovacího modulu. Modelové `process.exit(0)` před kontrolami je
  platný neúspěch, nikoli oprava.
- Timeout spuštěné opravy je `OPERATIONAL_FAILURE`, platná nula. Vstupuje do
  průměru a počtu pokusů. Timeout/neověřená odpověď providera zůstává neplatná:
  bez odpovědi nelze doložit obsloužený artefakt. Klasifikace všech příčin
  vyčerpání generačního rozpočtu tím není dokončená.
- Neúplná sada nevytvoří `COMPLETE` ani cache. Zachovává dokončené pokusy
  předchozích opakování, neplatné pokusy, důvody a počty nezahájených pokusů.
  Writer odmítá chybějící skóre i jeho převod na číselnou nulu.
- CODE odpovědi se ukládají celé, aby šly znovu ověřit. Starší 500znakové
  výřezy nelze zpětně doplnit. GUI v detailu neúplného měření zobrazuje počty
  a pomlčku pro chybějící skóre; nula nadále znamená platný neúspěch.

## Ověření referenční pravdy

Každá ze sedmi aktivních úloh obsahuje odlišnou správnou implementaci
`oracleAcceptance.alternativeTexts` a její vysvětlení. Před inferencí runner
spustí referenční opravu (1), alternativu (nejméně 0,9) a rozbitý základ (0).
Neověřená sada se k provideru nedostane.

Skutečné skryté testy přijaly všech sedm referencí i všech sedm alternativ
za 1 a odmítly všech sedm rozbitých základů za 0. Samostatný průchod parserem
a hodnotitelem má **49/49 PASS**: pro každou úlohu gold, alternativa, prázdná
odpověď, ozvěna promptu, klíčová kaše, sebejistý omyl a odmítnutí opravy.

Reprodukce bez GPU a produkční DB:

```sh
node scripts/manual/verify-code-oracles.mjs --out /absolute/report.json
```

Sada obsahuje **pět skupin**: čištění modelů; dvě varianty modelových lease;
jistota porovnání; ukládání chatu; dvě varianty časovače síťového volání.
Více kontrol ani více opakování netvoří další nezávislé scénáře. Jde stále
o úzké opravy JavaScriptových funkcí; samotné skóre není pravděpodobnost
úspěchu na projektu ani dostatečný podklad pro změnu modelu.

## Validace a zachované neúspěchy

Pracovní baseline `922791a0`; implementace `d2ce71b7`. Integrovaný zdroj
`d7079d1d` zachovává i nasazené úpravy vzhledu `0ef67a56`. Evidence mimo repo:
`/home/belphareon/Projects/coworker/intentsmith-code-pilot-20260918`.
Reprodukce původních vad: `before.json`. Finální odpovědní sondy:
`oracle-committed.json` (čistý `d2ce71b7`), dřívější
`oracle-adversarial.json` je zachovaný pracovní průchod. Cílené programy dohromady **303 kontrol PASS**:
runner 62, suite 25, pairwise 40, DB consolidation 18, upgrade 103,
read-model/Studio detail 22, desktop hunt 33.

Neúspěšné vývojové mezikroky zůstávají v evidenci: počáteční stricter kontrola
narušila kompatibilitu tichého testovacího výstupu (`runner-development.log`);
první importní wrapper dědil `--input-type=module` do CommonJS podprocesů a
dvě gold kontroly selhaly (`oracle-controls.json`). Opraven wrapper souborem
`.mjs`; všechny gold/broken/alternative i odpovědní kontroly potom prošly.
První artifact validace také zachytila vlastní chybu formátu census řádku
(chybějící čárka); původní neúspěšný log zůstává zachovaný. Úplný
profil offline/database na `d2ce71b7`: **359 PASS / 1 FAIL / 0 TIMEOUT /
0 BLOCKED**, run `2026-09-18T20-18-21-931Z`. Jediný FAIL je
`nightly-orchestrator-self-test`: registry hash differs from the reviewed
Gate 0 policy. Pečeť se neměnila. Předchozí vlastní chybné spuštění s
výstupním kořenem mimo `.intentsmith-artifacts` je zachované v
`deterministic.log`; odmítnutí TMPDIR není produktová regrese.

První build nové kopie selhal kvůli chybějícímu vnořenému `node_modules`
(`terser-webpack-plugin`); log zůstává. Po doplnění kompletního stromu
závislostí build prošel. Integrace `d7079d1d` také dokončila produkční
webpack a consumer verification; log `studio-build-integrated.log`.
Nebylo nasazeno a skutečné GUI tohoto nového buildu nebylo ověřeno. Další
široká validace po poslední integraci je na pokyn operátora odložená.

## Nové CODE měření a noční zastavení

Před startem byl uložen `benchmark-plan.json`: stejné úlohy, 3 opakování,
stejný kontext 16 384, runtime `0.34.0-intentsmith.1`, přesné digesty,
7 úloh / 5 skupin, nejvýše 45 minut na model. **EXPLORATORY_ONLY**: nebylo
předem uzamčené intervalové rozhodování ani oddělený provozní holdout.

| Model | Skutečný výsledek | Pokusy | Délka |
| --- | --- | --- | --- |
| qwen3.8:latest | COMPLETE, 76,19 % | 21/21 | scoring 4 min 46 s; celý proces 6 min 30 s |
| devstral-small-2:latest | CANCELLED na pokyn operátora | progress hlásil 20/21; bez konečného skóre | přerušeno po 6 min 22 s |
| qwen3-coder:latest | NOT_STARTED | 0/21 | — |

Qwen: pět úloh za 1, rozhodovací jistota za 1/3, chatový error kontrakt za 0;
všechna tři opakování měla shodná skóre. V nulové odpovědi model rozděluje
modul do několika bloků. Parser pro jediný rozsah bere jen nejdelší blok,
takže zahazuje další části; výstup testu nedokládá dokončení harnessu.
To je další otevřená otázka férovosti parsování. Samotný údaj 0 proto
neopravňuje přisoudit celou chybu uvažování modelu. Správná alternativa
rozdělená do několika bloků nebyla mezi 49 sondami; její kontrola a oddělení
formátové chyby jsou odložené. Naměřené skóre nereinterpretujeme zpětně.
Konkrétní body zůstávají v `benchmark-1.json` a v produkční DB pod
`eval_c18f7102-d33b-4b92-9b96-dd6a7ce14bb4`. Contract
`51cf160b2dde294e9292d0d752b4130d20e926ce64bc00ea75b4c399db74ced7`, artefakt
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`.
Probe Qwen ukázal 16,13/16,13 GiB na GPU při kontextu 16 384.
Nejde o širší funkčnost CODE ani průkazné zlepšení proti jinému kontraktu.
Během části běhu probíhala CPU validace; latence není čistý výkonnostní duel.

Operátor povolil ukončení LM Studia. Jeho GPU worker byl korektně ukončen;
nebyla obejita readiness kontrola. Pozdější výslovný pokyn ztišit počítač
vedl v 20:33:28 UTC k zastavení měření a zrušení navazujícího codera.
Wrapper uložil `CANCELLED` a ukončil vlastní sidecar i GPU runner.
V 20:36:33 UTC nebyl evidovaný žádný compute proces, GPU utilization 0 %,
příkon 28,82 W. Hunt timer je **inactive / disabled**, i po přihlášení.
Důkaz: `night-pause.json`, `cancelled-devstral-summary.json`.

**Nově odhalená mez přerušení:** SIGTERM wrapperu uchovává souhrn a počitadlo
progressu, ale ne checkpoint všech dílčích odpovědí v DB. Devstral proto nemá
nový řádek hodnocení a nesmí dostat dopočtené skóre. Oprava běžných neúplných
běhů nepokrývá násilné přerušení procesu. Před dalším dlouhým měřením je
potřeba doplnit průběžné ukládání nebo řízené dokončení aktuálního pokusu.

## Co není splněno

1. Dokončené porovnání současného modelu se dvěma kandidáty. Z plánovaných
   tří modelů je kompletní pouze Qwen; kandidáti čekají na denní pokračování.
2. Uzamčené intervalové rozhodování §6 a nezávislý provozní holdout §8. Staré
   pravidlo diskriminujících úloh zůstává stávající implementací. Žádný binding
   nebyl změněn, žádný model odstraněn; nejsou podklady pro výměnu.
3. Reprezentativní špička paměti §7. CODE-only hunt kvalifikuje stejný
   kontext 16 384 jako inference, krátký probe však není zkouška dlouhého
   vstupu a generování. Multi-role profil tím sjednocený není.
4. Izolace provozního holdoutu: benchmark izoluje síť a DB, ale worktree
   zpřístupňuje historii Git a nemá úplnou izolaci FS. Dokončovací receipt
   není ochrana před aktivním falšováním testovacího procesu.
5. Rychlý a kompletní provozní profil; rychlý přijde až po ověření pilotu.
   Délka se uměle neprodlužuje na 20–30 minut.
6. Validace a nasazení integrovaného GUI a přejímka nově připravených rolí.
   Tyto testy jsou **odložené na přímý pokyn operátora**, nikoli PASS.

## Příprava ostatních rolí bez dalšího testování

Na poslední přímý pokyn jsou připravené
[zdrojové podklady](../../src/eval/fixtures/drafts/README.md): osm historických
případů s připnutými revizemi a samostatnými zadáními D1, D2, R1, R2 (32
přípravných karet). U CHAT je inventář potřebných oprav všech 40 úloh,
VISION má inventář 12 existujících obrázků a negativní kontrolu.
**PREPARED_NOT_VALIDATED**: žádný nový grader ani role mapping nebyl
aktivovaný. Příprava není hotová spustitelná sada a neslouží jako holdout.
