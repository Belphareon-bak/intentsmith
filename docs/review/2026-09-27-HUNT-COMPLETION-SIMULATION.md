# GPU hunt — dokončený simulační průchod a balíček k revizi

**Stav: SIMULATION_PASS / REVIEW_PENDING / REAL_NO_GO.**
Autorita práce: přímé zadání operátora z 27. 9. dokončit alespoň simulaci
celého huntu a předat ji k revizi, při zachování zákazu mazání modelů;
[HANDOFF §5–7](../wp/WP-GPU-HUNT-HANDOFF-20260919.md).
Nejde o přejímku místních modelů, nasazení ani souhlas operátora se změnou rolí.

## Kde začít

- [Jednotný revizní přehled](</mnt/vi7000/intentsmith/evidence/hunt-completion-review-20260927-v2/REVIEW.html>):
  skutečná matice 10 × 7, zdroje procent, oba nové posudky, pět navržených
  rozsouzení a oddělená simulace.
- [Strojový průchod](</mnt/vi7000/intentsmith/evidence/hunt-completion-simulation-20260927-v2/simulation.json>):
  všechny kroky a kontroly včetně odmítnutých cest.
- [Návrh rozsouzení](</mnt/vi7000/intentsmith/evidence/hunt-completion-review-20260927-v2/adjudication-proposal.json>):
  úplné odpovědi, veřejná kritéria, dvě původní známky, moje navržená známka
  a konkrétní textový důkaz. **Neslepý návrh, původní posudky nepřepisuje.**

## Co skutečně proběhlo

Simulátor používá produkční `ModelEvaluationHistory`, `SemanticEvaluationJudge`,
`gradeAcceptedCollection`, `persistAdjudicatedCollection`, přejímkové úložiště,
`decideRoleOperational`, `ModelEvaluationReadModel` a solver odpovědností.
Každá role má vlastní novou SQLite. Do skutečných dat ani bindingů nezapisuje.
Síťový `fetch` je v simulátoru zakázaný; poskytovatel je výslovně
`0.0.0-simulation-no-inference`. Modely se jmenují `sim-model-*`, hodnotitelé
mají tag `simulation-judge-*`. Jejich odpovědi, známky, kalibrační i provozní
případy jsou vyrobené testovací vstupy, ne měření modelové schopnosti.

| Krok | Ověřený průchod | Co tím prokázáno není |
| --- | --- | --- |
| Pokrytí | 10 fiktivních modelů × 7 rolí, 64 hodnocených buněk + 6 VISION N/A | Kompletní reálná matice všech kandidátů |
| Sběr a identita | Oddělené odpovědi a známky, přesné SHA, neměnný původní sběr | Inference, stažení, umístění ve VRAM |
| Dvojí posudek | Dva oddělené záznamy, jeden hodnotitel nestačí; změna vstupu a vlastní hodnocení blokují cestu | Nezávislost nebo kvalita skutečných hodnotitelů |
| Spor | První dvě známky se zachovají, přesné rozsouzení vytvoří nový výsledek | Skutečný posudek uživatele či Opuse |
| Neplatné hodnocení | Nečitelný výstup znamená chybějící důkaz, nikoli nulu | Úspěšnost reálného soudce |
| Kvalifikace | Neúplná provozní dvojice nerozhodne; přesná syntetická úplná dvojice ano | Predikční platnost sad, přiměřenost velikosti reálného vzorku |
| Sestava | Nepřijaté skóre nepřepne roli; kvalifikované vstupy mají sestavu bez vlastní revize a bez sdílení rolí | Živá změna všech bindingů |
| Přepnutí a rollback | Virtuální transakce odmítne změněný výchozí stav a vrátí původní sestavu po vadném smoke testu | Produkční binding writer a skutečný restart aplikace |
| Trvalost a zrušení | Nové spojení SQLite načte výsledky, odvolaná přejímka uzavře rozhodování a cache | Release nebo provozní GO |
| Zobrazení | Test volá skutečný renderer Studia nad daty produkčního read modelu | Nasazení nové verze Studia nebo import výsledků do živé DB |

**CODE/VISION:** simulátor vkládá označené výsledky náhradního orákula;
nespouští skutečné opravy ani obrazový model. **CHAT:** zkouší aktuální smíšený
produkční plán `chat_semantic_v1`, který má 21 sémantických a 19 mechanických
úloh. Mechanické kontroly skutečně odmítají syntetickou prózu, takže maximum
simulovaného CHAT skóre je 52,5 %. Tato simulace sama neimplementuje nové
vícekolové `gradeConversation` ani nepřijímá konverzační draft jako produkční
sadu. Tato mez je viditelná také v reportu; nesmí se ztratit v tvrzení „všechny role“.

Všechny simulační provozní přejímky jsou po ověření odvolané a u sémantických
rolí je odvolán i druhý hodnotitel. Exportovaná databáze proto není aktivním
podkladem pro rozhodnutí. Návrh sestavy je zachovaný snímek před odvoláním.
Mazací adapter simulátor vůbec nemá.

## Oprava skutečného sběru, nikoli jeho známky

Předchozí [audit kontextu](2026-09-26-HUNT-STEP3-SECOND-REVIEW-CONTEXT.md)
prokázal neúplnou historii v 66 z 80 dialogů. Nová
`src/eval/chat-capture-integrity.js` ověřuje **skutečný požadavek ještě před
odesláním** z produkčního sběrného skriptu. Kontroluje úplné dřívější vstupy
uživatele, jejich pořadí i opakované výskyty. Citace v odpovědi asistenta
nenahradí dřívější uživatelský vstup. Nečitelný formát žádosti rovněž blokuje sběr.

Při porušení je pokus `BLOCKED`, ne známka 0; další pokusy stejné role se
neprovádějí. Každá kontrola uchová otisk requestu. Nový zdroj kontroly vstupuje
do pečeti sběrného plánu, starý plán nelze tiše dokončit novým skriptem.

Offline reprodukce nad 232 uloženými požadavky:

- původní požadavky: **84 odmítnutých** (18 druhých + 66 třetích tahů);
- rekonstrukce opraveným `buildAnswerContext`: **0 odmítnutých**, 0 porušení
  kontextového rozpočtu, všech 80 dialogů;
- u 26 požadavků se proti starému běhu změnil výstupní limit.

To je důkaz vstupní kontroly, **ne nový sběr odpovědí**. Staré známky CHAT
v přehledu zůstávají označené jako nepoužitelné pro pořadí.

## Jak vznikla skutečná matice a rozsouzení

Index zachovává přesné kampaně a původní snímek pokrytí z 25. 9. Neprezentuje
jej jako úplný aktuální inventář disku. Obsahuje 38 jednotlivě označených
pozorování: Opusův validovaný posudek 312 D/R odpovědí v osmiúlohových sadách,
technickou komponentu CODE dvou modelů, VISION tří modelů a oba posudky nových
balíčků D/R 24 a CHAT 80. Novější jediná úloha `model_cleanup` nenahrazuje
osmiúlohovou známku role; různé profily a verze poskytovatele se neslévají.

Každé procento je popis konkrétních posouzených odpovědí, nikoli schválená
kompetence. Pro D/R jde o průměr kritérií uvnitř odpovědi a poté průměr odpovědí;
počty opakování jsou v těchto skupinách vyvážené. CODE uvádí jen technickou
komponentu. VISION je deterministické měření 23 různých odpovědí na model,
nikoli 69 nezávislých pozorování. Nikde nevzniká doplněná známka pro chybějící buňku.

Pět sporných D/R kritérií má nový návrh **50 %, 75 %, 50 %, 50 %, 50 %**.
V R1 opravuji vlastní původní chybu: odpověď skutečně popisuje závod mezi
návrhem a smazáním; tvrzení, že reprodukce není přítomná, není podložené.
U čtyř dalších kritérií ponechávám střední jistotu — záleží na rozsahu
veřejného požadavku, ne na jiném skrytém referenčním patchi.

Tyto návrhy nenahrazují uživatelovu ani Opusovu známku a netvoří nezávislou
přejímku. Původních 37 CHAT neshod se nepřeklápí na konsenzus: všechny leží
v dialozích zasažených vadou kontextu, která ale nemusí vysvětlovat každou chybu.

## Co zůstává před reálným GO

1. **Nový dvoumodelový produkční CHAT sběr** s opravenou historií a zapnutou
   vstupní kontrolou; oba celé posudky nad novými odpověďmi. To je nyní první
   krok, ne stahování dalších modelů.
2. **Doplnění a přijetí skutečné matice.** Rozsoudit předložené návrhy, uzavřít
   úplná D/R a CODE kritéria, provést chybějící srovnatelné buňky. Přejímka
   sémantických hodnotitelů musí mít nezávislé dosud nepoužité podklady.
3. **Provozní kvalifikace a reálná integrace.** Přijaté dvojice na nových
   nezávislých případech, vícekolový CHAT v produkční hodnoticí cestě,
   kontrolovaný skutečný průchod přes UI, změnu rolí a obnovu po selhání.
   Automatické mazání zůstává zakázané.

Simulace tyto kroky umožňuje nacvičit a testuje jejich mechanické brány.
Nemůže jejich chybějící skutečné důkazy nahradit.

## Reprodukce

Finální průchod prošel **312/312 simulačních kontrol**. Nová regresní sada
prošla 2/2 (včetně skutečného rendereru Studia), přejímka hodnocení 23/23,
kontrakt M1 CHAT 34/34, `artifact-validation` 160/160 a revizní přehled
8/8 kontrol v prohlížeči. Registr je validní s 542 programy.
Jde o cílené ověření této změny, nikoli kompletní release audit.
Souhrn je také uložený v
[verzované evidenci](evidence/2026-09-27-hunt-completion-verification.json).

```bash
node scripts/manual/simulate-hunt-lifecycle.mjs --out /NOVY/absolutni/adresar
node --test tests/hunt-completion-simulation.test.mjs
python3 scripts/manual/build-hunt-completion-review.py --out /NOVY/review --simulation /NOVY/absolutni/adresar
node scripts/manual/replay-hunt-chat-context.mjs /mnt/vi7000/intentsmith/evidence/hunt-chat-prod-sameday-20260926/run
```

První příkaz odmítá existující adresář. Výstupní SQLite ani simulační
přejímky se nikdy neimportují do produkce. Nová testová sada je zapsaná
v registru; README, registr a census SYSTEM-MAP jsou součástí změny.
Ověření a hashe finálního balíčku doplňuje `verification.json` a `manifest.json`
v adresáři revize. Dřívější neúspěšné vývojové zkoušky zůstávají pod původními
jmény; odkazované `v2` je finální kandidát.
