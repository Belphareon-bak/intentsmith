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

Pracovní baseline `922791a0`. Evidence mimo repo:
`/home/belphareon/Projects/coworker/intentsmith-code-pilot-20260918`.
Reprodukce původních vad: `before.json`. Finální odpovědní sondy:
`oracle-adversarial.json`. Cílené programy dohromady **303 kontrol PASS**:
runner 62, suite 25, pairwise 40, DB consolidation 18, upgrade 103,
read-model/Studio detail 22, desktop hunt 33.

Neúspěšné vývojové mezikroky zůstávají v evidenci: počáteční stricter kontrola
narušila kompatibilitu tichého testovacího výstupu (`runner-development.log`);
první importní wrapper dědil `--input-type=module` do CommonJS podprocesů a
dvě gold kontroly selhaly (`oracle-controls.json`). Opraven wrapper souborem
`.mjs`; všechny gold/broken/alternative i odpovědní kontroly potom prošly.
První artifact validace také zachytila vlastní chybu formátu census řádku
(chybějící čárka); původní neúspěšný log zůstává zachovaný. Úplný
deterministický profil bude doložen odděleně; cílené testy jej nenahrazují.

## Co není splněno

1. Nové GPU měření současného CODE modelu a dvou kandidátů. Při kontrole
   držel GPU proces LM Studia 1883515; nebyl ukončen ani obejit readiness gate.
2. Uzamčené intervalové rozhodování §6 a nezávislý provozní holdout §8. Staré
   pravidlo diskriminujících úloh zůstává stávající implementací, ne novou
   přejímkou. Žádný binding ani model nebyl změněn nebo odstraněn.
3. Reprezentativní špička paměti §7. CODE-only hunt nyní kvalifikuje stejný
   kontext 16 384 jako inference; původní krátký VRAM probe však není zkouška
   dlouhého vstupu a generování. Multi-role profil tím sjednocený není.
4. Izolace provozního holdoutu: současný CODE benchmark izoluje síť a DB,
   ale worktree zpřístupňuje historii Git a testy nemají úplnou izolaci FS.
   Dokončovací receipt není ochrana před aktivním falšováním testovacího
   procesu. Tyto vlastnosti nelze vydávat za čisté prostředí C3 podle §8.
5. Rychlý a kompletní provozní profil; dle kontraktu rychlý profil přijde až
   po ověření pilotu. Délka běhu se uměle neprodlužuje na 20–30 minut.

Instalovaný produkt má mezitím změny vzhledu z jiné větve (`9ab808f1`). Tento
checkpoint je nepřepisuje a zatím ho nenahrazuje. Před nasazením je nutná
integrace a ověření nového společného zdroje.
