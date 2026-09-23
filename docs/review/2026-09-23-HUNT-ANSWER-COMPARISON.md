# Stejná zadání napříč modely — osobní posouzení a návrh vah

**Stav: OPERATOR_REVIEW_INPUT / NOT_ACCEPTANCE / NO_PRODUCTION_CHANGE.**
Autorita: operátor 23. 9. požádal o odpovědi různých modelů na stejné testy,
se známkami 0, 1 a mezihodnotami, pro všechny role a zejména CHAT.

[Otevřít interaktivní porovnání](/mnt/vi7000/intentsmith/evidence/hunt-answer-comparison-20260923/review/comparison.html).

## Co je připravené

**27 úloh, 4 různé modely u každé, všechna 3 opakování: 324 odpovědí.**
Výběr dohromady zahrnuje všech dvanáct modelů původního panelu, nikoli
všech dvanáct u každé úlohy. CHAT má osm úloh, VISION čtyři, D1/D2/R1/R2/CODE
po třech. Žádné nové generování odpovědí ani hodnocení modelem neběželo.

Podkladem je sběr z **20. září**, přesně uložené vstupy a vyhodnocení
`content-rubric.5` po sjednocení produkčního parseru. Není smíchaný s novou
sérií jednoho Qwenu a CODE Devstralu z 23. září. U každé zahrnuté odpovědi
byla znovu ověřena shoda s původním call logem: text vstupu, obrázky,
inferenční parametry, nastavení think/tools, text odpovědi, model, digest
odpovídajícího artefaktu a verze provideru. Všechny zdrojové otisky jsou
v [receiptu](evidence/2026-09-23-hunt-answer-comparison.json).

Výběr je **cílená ukázka rozpětí**, ne náhodný vzorek ani žebříček.
Algoritmus vybírá různým modelům ukázku nízké, vysoké a prostřední známky;
při shodě vyvažuje zastoupení modelů. Výchozí pokus může být 1, 2 nebo 3.
Vedle něho jsou vždy obě ostatní odpovědi téhož modelu, včetně nehodnoceného
případu, pokud existuje. Písmena A–D označují různé modely pouze uvnitř úlohy.

## Doporučený začátek pro CHAT

| Úloha | Ukázky původních známek | Co posuzovat |
|---|---|---|
| `cz_numeral_cases` — vykázaný čas a účtování | 0 / 0,667 / 1 | Správné minuty, počet bloků a cena; konkrétní částečné splnění |
| `en_state_updates` — poslední platné změny | 0 / 1 | Zda model opravdu zapracoval aktualizace |
| `cz_double_negation_counts` — počty a dvojitý zápor | 0,25 / 0,5 / 0,75 / 1 | Čtyři stejné požadavky s různým počtem správných polí |
| `cz_professional_reply` — profesionální odpověď | 0,85 / 0,9 / 1 | Termín, adresát, čeština a přirozenost formulace |
| `cz_customer_explanation_paragraph` — vysvětlení zákazníkovi | 0,85 / 0,9 / 1 | Jasnost, věcnost, opatrnost slibu |
| `en_missing_context` — chybějící kontext | 0,688 / 1 | Užitečná doplňující otázka bez domýšlení |
| `en_exact_markdown_table` — faktura | 0 / 0,333 | Částečně správná pole; v této úloze nemá nikdo 1 |
| `en_professional_rewrite` — přeformulování | 1 / 1 / 1 / 1 | Stejně obodovaný obsah, ale rozdílný styl a formulace |

Poslední ukázka je záměrná: pokud věcně správné odpovědi rozlišuješ podle
stručnosti nebo stylu, musí se tato preference pojmenovat. Mezihodnoty
nevyrábíme jen proto, aby byla čísla rozmanitá. Historická autorská jednička
zároveň není záruka bezvadného textu — právě tyto známky dostáváš k revizi.

CODE ukazuje například `patch_90eff80ecb8a`: splněné **2/3 kontrol bez
regrese = 0,667**, **3/3 = 1**, ale **2/3 s další regresí = 0**.
Částečné splnění tak nezakrývá rozbití chráněného chování. Ostatní CODE
ukázky pokrývají návrh úklidu a výpis jistoty. VISION nabízí trasu, počítání,
začerněný dokument a vážené podíly včetně skutečných obrázků.

## Jak doplnit svůj názor

1. Vyber roli a úlohu. Nejprve přečti zadání a odpovědi A–D. Jména modelů
   a původní body jsou ve výchozím stavu skryté; můžeš je kdykoli odkrýt.
2. Zadej **obsahovou známku 0–1** a konkrétní důvod. Tlačítka 0 / 0,25 /
   0,5 / 0,75 / 1 jsou pomůcka; číslo lze napsat ručně. Nehodnocená položka
   zůstane prázdná, nikoli nula.
3. **Osobní použitelnost / styl** je samostatná známka. Zvol také odpověď,
   kterou bys preferoval. To nezmění výsledek spustitelných kontrol.
4. Nastav **důležitost úlohy**: 1 běžná, 2 dvojnásobná, 0 vynechat z
   budoucího návrhu. Volný komentář zachytí váhy jednotlivých kritérií;
   rozbalovací poznámka pro roli zachytí obecné preference.
5. **Exportovat hodnocení** stáhne `moje-hodnoceni-gpu-hunt-20260923.json`.
   Soubor lze znovu načíst. Obsahuje ID a SHA odpovědí, známky, váhy,
   důvody a záznam, zda byla odkryta identita či původní známka.

Stránka se průběžně ukládá v prohlížeči, ale export je přenosný pracovní
výsledek. Nikam neposílá data, nemění DB, role, retenci ani timer. Váhy jsou
**návrh k následnému sjednocení měřítka**, nikoli automatické přepsání skóre.
Z tohoto záměrně vybraného vzorku nepočítá pořadí modelů.

## Co v podkladech skutečně je a není

| Role | Nejnižší–nejvyšší obsahová známka v celém původním sběru |
|---|---|
| CHAT | 0–1 |
| D1 | 0,0625–1; žádná čistá nula |
| D2 | 0,0625–1; žádná čistá nula |
| R1 | 0–0,875; žádná jednička |
| R2 | 0,25–1; žádná čistá nula |
| CODE | 0–1; mezihodnotu mají tři odpovědi |
| VISION | 0–1 |

Rozsahy jsou popis existujících **obsahových** známek. Neparsovatelný nebo
nedokončený pokus se pro tento účel nezaměňuje za obsahovou nulu.
V historii zůstává započítaný. CODE má spustitelné kontroly, strukturovaný
CHAT/VISION kontrolu polí, ostatní známky jsou autorské posouzení k review.

Pozdější autorské korekce z 21. září jsou u dotčených odpovědí samostatnou
poznámkou; nepřepisují zmrazenou známku. Nový
[arbitrážní dokument](2026-09-23-GRADING-DISPUTES-ARBITRATION.md) byl přečten,
ale tato sada není automatické rozsouzení jeho otevřených bodů. Stažení
námitek druhým posuzovatelem nezaměňujeme za nový slepý posudek.

## Ověření a reprodukce

V headless Chromium 145 prošlo všech 27 úloh, přepínání opakování a shoda
zobrazených textů, všechny čtyři obrazy, skrytí/odkrytí známek a identit,
uložení známky i váhy po reloadu, export/import a odmítnutí cizího zdroje
či známky mimo rozsah. Nulové renderer chyby, nulové síťové požadavky,
bez vodorovného přetečení při šířce 800 px. Diagnostický browser používá
`--no-sandbox --disable-gpu`; nejedná se o nový fyzický průchod Studiem.

Zachované neúspěšné kroky harnessu: chyběla očekávaná Chrome 152 cache,
proto byl explicitně použit existující Chromium 145. Další kontrola
hledala po reloadu jiný než právě zobrazený pokus; po zvolení stejného
opakování ověřila zachovanou známku. Testovací exporty jsou oddělené a
výslovně syntetické, žádné z nich nejsou skutečné hodnocení modelů.

`build-comparison.py` a `comparison-template.html` v evidence rootu
znovu sestaví stránku z původních zdrojů s kontrolou otisků a call logů:
`python3 build-comparison.py --output /absolutni/novy/adresar`.
Existující data builder nepřepisuje. Pro samotné prohlížení a hodnocení
stačí samostatný `comparison.html`; obsahuje všechny texty a obrázky.

K odhadu šumu: změna Devstralu 11/21 → 10/21 znamená pozorovaný rozdíl
4,76 procentního bodu. Dva běhy samy nestanovují spolehlivou hranici šumu
±5 bodů ani jedenáctinásobnou statistickou průkaznost. Tato sada tento
odhad nepotřebuje a vývojové případy nepřejmenovává na holdout.
