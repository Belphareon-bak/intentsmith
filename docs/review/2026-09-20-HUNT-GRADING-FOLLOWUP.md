# GPU hunt — ověření vzorku a replay orákul

**Stav: POST_COLLECTION_ASSESSMENT_PARTIAL / REVIEW_PENDING / NOT_DEPLOYED.**
Autonomní hunt zůstává **NO-GO**. Adresát: operátor a nezávislý reviewer.
Navazuje na [nezměněný sběr](2026-09-20-HUNT-ALL-INSTALLED.md) a operátorem
dodaný `claude-sample-grades-20260920c.json`. Autorita: HANDOFF §5/§7,
DIRECTION §1 a EVALUATION-CONTRACT §3–§5. Žádná nová inference.

## Výsledek tohoto kroku

- Všech **210 CODE odpovědí** má výsledek spustitelných kontrol: **133 plných,
  3 částečné, 74 neúspěšných**. Skutečně provedeno 67 unikátních kombinací
  úlohy a přesného hashe odpovědi; totožná opakování mají explicitní odkaz na
  původní spuštění. Nejsou to další nezávislá pozorování.
- Všech **16 externích CHAT/VISION známek** jsem obsahově ověřil, včetně pěti
  původních obrázků a aritmetiky: shoda 16/16, průměr správnosti **0,775**.
  Jde o ověření **po přečtení známek**, nikoli nezávislou slepou shodu.
- Zbývajících **14 reasoning položek vzorku** má ruční posudek s důvodem u
  **88 obsahových kritérií**. Před jeho zápisem nebyl otevřen klíč identit;
  znalost panelu, starších scénářů a autorství nástrojů přiznaná. Autor není
  nezávislý adjudikátor. Celý sběr 2 922 položek ručně dohodnocený není.

**Dva nové nálezy brání tomu, abychom hodnocení označili za dokončené:**

1. `vision_weighted_rates`, položka `8cc71f462c9d`: automatické orákulum
   `src/eval/role-quality-suites.js:868–874` vrací **0** za prozu kolem JSON,
   přestože **2/5 obsahových polí jsou správně**. Produkční
   `src/llm/client.js:50` umí JSON blok z takového výstupu vyjmout.
   Oprava čistého Markdown fence je doložená; obecné oddělení formátu od
   obsahu zatím úplné není. Změna runtime se v tomto posudkovém kroku nedělala.
   V navazujícím reportu je u celé třídy parserových odmítnutí
   `contentAccuracy: null`, původní orákulové číslo zůstává jako diagnostika.
   **95 odpovědí** (23 CHAT, 72 VISION) vyžaduje toto oddělené posouzení;
   není prokázáno, že všech 95 nul bylo chybných.
2. Reasoning rubriky mají překryvy: obecná instrukce pro hodnotitele není
   dalším obsahovým bodem; široké kritérium opravy často opakuje dílčí
   invarianty. Například neplatný přepis `const result` dopadá současně na
   opravu, vytvoření nové hodnoty a finální obsah. Dle zákazu dvojí penalizace
   se tyto dílčí body **nesčítají do výsledné známky**. Čtrnáct souhrnů je
   proto `null`; k adjudikaci zůstává celý rozpad a konkrétní příčina.

## Co v reasoning odpovědích skutečně selhalo

- Všechny tři vybrané R1 odpovědi přijímají guard **až po** `addToHistory`.
  Jedna dodá správnou alternativu, ale finální verdikt původní patch stále
  schvaluje. Throw po appendu již paměťovou historii nevrátí zpět; lokální
  catch jej navíc převádí na error result.
- D2 refinement: jedna odpověď navrhne `result = improvedResult`, ale nechá
  `result` jako `const`. Druhá správně propojí `finalContent` se scorerem,
  persistencí a návratem, přesto nesprávně vysvětluje chování getterů/spreadu.
- D2 metrics: slovně správná diagnóza, ale navržený kód ponechá původní
  `splice(0)` před transakcí. Retry tak dál ztrácí dávku.
- D1 lease: výlučný target blokuje čtenáře, jejichž souběh veřejné zadání
  vyžaduje. D1 cleanup správně deduplikuje, ale rollback ochranu u mazání
  označí za volitelnou a nechá přímý provider delete bez přejímací hranice.

Šest malých offline reprodukcí nad dodaným historickým kódem potvrzuje
pořadí historie/catch, strict assignment, ztrátu getterů při spreadu,
výhru z jediného scénáře či rychlosti a ztrátu bufferu. Nejde o nový průchod
instalovaným produktem; přesné rozsahy a stubs jsou v `source-probes.json`.

## CODE — pouze krátký benchmark

Abecedně; každý model 7 úloh × 3 opakování, pět deklarovaných skupin.
Poslední sloupec je průměr podílů splněných kontrol, **nikoli přijatá
produkční známka**. Žádné confidence intervaly z 21 údajně nezávislých případů.

| Model | Plné splnění / 21 | Částečné | Nesplněné | Průměr kontrol |
|---|---:|---:|---:|---:|
| devstral-small-2:latest | 12 | 0 | 9 | 0,5714 |
| gemma4:26b | 18 | 0 | 3 | 0,8571 |
| ornith-1.5:9b | 10 | 0 | 11 | 0,4762 |
| phi4:14b | 10 | 0 | 11 | 0,4762 |
| qwen3-30b-a3b:latest | 6 | 0 | 15 | 0,2857 |
| qwen3-coder:latest | 12 | 2 | 7 | 0,6349 |
| qwen3.5:27b | 17 | 1 | 3 | 0,8413 |
| qwen3.6:27b | 15 | 0 | 6 | 0,7143 |
| qwen3.8:latest | 21 | 0 | 0 | 1,0000 |
| qwen3:14b | 12 | 0 | 9 | 0,5714 |

Qwen3.8 zde splnil všechny kontroly. To znovu **není důkaz výkonu v opravné
smyčce**; dřívější provozní protipříklad zůstává platný. Změnil se také
rozsah opravených benchmarkových zadání, stará procenta nejsou přímý baseline.
Známý nesoulad účtování VRAM Gemmy tím nezískává paměťovou kvalifikaci.

## Stupnice a úplnost

Externí 0 znamená v uvedených položkách nulový podíl správných polí.
DIRECTION §1.3 ale dává věcnému pokusu s kritickou chybou **0,25**. Na stejných
16 položkách vychází tato oddělená rubriková interpretace **0,83125**:
tři úplně chybné odpovědi 0 → 0,25, částečná VISION 0,4 → 0,55.
Nezvyšuje se počet správných odpovědí, nemění se původní cizí známky ani
úspěch úloh. Tyto dvě veličiny se nesmějí míchat do jednoho žebříčku.

Automatický offline průchod zachoval všech 2 922 ID a jejich response hash:
1 321 orákulových pozorování, z nich 1 226 bez parserové nejasnosti;
95 potřebuje oddělit obsah od formátu. Před ručním vzorkem dále 1 577
otevřených odpovědí bez sémantického posudku a 24 tokenových limitů.
Limity jsou provozní nedokončení, nikoli vyloučené poruchy prostředí.
Nezveřejňuje se pořadí modelů z neúplných denominatorů CHAT/VISION/reasoning.

## Ověření a důkazy

Sběr na čistém `775434ff`, replay na čistém `dcadc9c3`; diff runtime
`src/`, `scripts/`, `package.json`, `package-lock.json` je prázdný.
CODE sondy **62/62**, VISION **276/276**. Sondy nezachytily výše uvedenou prozu
kolem JSON; jejich PASS není přejímka celé sady. Široké L1 znovu neběželo:
produktový runtime se neměnil; dřívější **363 PASS / 1 FAIL** zůstává historicky
přiznaný. Standalone review HTML prošlo sedmi kontrolami skutečného Electron
rendereru (diagnostický `--no-sandbox`, software rendering; není to Studio).

Původní formatter zbytečně přepisoval 77 MB po každém řádku. Po uložení všech
210 CODE výsledků byl ukončen pouze vlastní offline proces a dokončení
navázalo na checkpoint. Žádný CODE výsledek nezmizel ani nezměnil body.
První neúspěšné čtení právě přepisovaného reportu a první start Electronu
se zděděným `ELECTRON_RUN_AS_NODE` jsou zachované v událostech/logu.

[Strojové shrnutí](evidence/2026-09-20-hunt-grading-summary.json) obsahuje
přesné digests modelů, poskytovatele, počty a hash archivu. Plné podklady:
`/home/belphareon/Projects/coworker/intentsmith-hunt-grading-20260920c/`.

- `review.html`: přehled a rozklikávací posudky všech 30 položek vzorku;
- `worker-reasoning-grades.json`, `external-comparison.json`: důvody a stupnice;
- `deterministic-assessment-final.json`, `test-logs/`: všechna pozorování;
- `parser-counterexample.json`, `source-probes.json`: potvrzené meze/nálezy;
- `assessment-evidence-138c3f3827d534f8.tar.gz`: 104 ověřených souborů,
  SHA256 `138c3f3827d534f874dbd1696063c0be4fe82ed838e9ba3e567c7502495f98f2`.

Všech 247 souborů původního zapečetěného sběru zůstalo beze změny.
Produkční DB, bindingy, retence ani timer se neměnily; závěrečný snapshot
potvrzuje timer disabled/inactive a žádný NVIDIA compute proces.

## Další konkrétní krok

Adjudikovat rozpad 14 položek a sjednotit překrývající se kritéria; dokončit
obsahové posouzení parserových odmítnutí a zbytku otevřených odpovědí.
Opravit automatickou interpretaci formátu tak, aby ani nevyráběla obsahovou
nulu, ani nekriticky nepřijala JSON odporující okolnímu textu. Potom vybrat
páry a uzamknout dosud nepoužité provozní případy. Tento krok nedodal
přejímku hodnotitele, přijatý rozhodovací profil ani funkční autonomní hunt.
