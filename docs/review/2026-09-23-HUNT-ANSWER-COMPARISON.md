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
v [receiptu původního výběru](evidence/2026-09-23-hunt-answer-comparison.json).
[Aktuální rozložení v2 a jeho ověření](evidence/2026-09-23-hunt-answer-comparison-layout-v2.json)
mění pouze prezentaci; datový soubor se všemi odpověďmi a známkami zůstává
bajtově shodný.

Výběr je **cílená ukázka rozpětí**, ne náhodný vzorek ani žebříček.
Algoritmus vybírá různým modelům ukázku nízké, vysoké a prostřední známky;
při shodě vyvažuje zastoupení modelů. V rozložení v2 jsou modely vždy
pojmenované a všechny tři odpovědi zobrazené pod sebou v pořadí 1, 2, 3,
včetně nehodnoceného případu. Výběr odpovědí se změnou rozložení nezměnil.
Původní výběrový pokus a označení A–D zůstávají pouze v podkladových datech
a kompatibilním exportu, nikoli jako ovládání pro čtenáře.

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

1. Vyber roli a test. Nahoře je **přesné zadání**, u VISION i obrázek.
2. Pod zadáním je tabulka **názvů modelů a tří původních známek**.
   Kliknutím na model nebo známku přejdeš přímo k odpovědi.
3. Každý model má všechny tři odpovědi pevně pod sebou. Jde o tři samostatná
   opakování stejného testu, nikoli tři odlišná zadání. Nic se nepřepíná.
   Vedle každé odpovědi je **známka 0–1, způsob hodnocení a konkrétní důvody**;
   na užším okně je známka hned pod odpovědí. Přesné znění kritérií lze rozbalit.
4. Pod odpovědí rozbal **Můj názor na tuto odpověď**. Obsahovou známku,
   osobní použitelnost/styl a poznámku zapisuješ zvlášť od původního hodnocení.
   V **Moje váha testu a preference** nastav důležitost úlohy (1 běžná,
   2 dvojnásobná, 0 vynechat), preferovaný pojmenovaný model a preference role.
5. **Exportovat moje hodnocení** stáhne `moje-hodnoceni-gpu-hunt-20260923.json`.
   Starší export v1 lze načíst i do v2. Zachován je stejný soubor HTML, klíč
   místního úložiště, ID odpovědí a vazba na původní zdroje; dřívější poznámky,
   známky, váhy a preference se nemění. Nečitelný místní návrh se nepřepisuje.

Jména i původní známky jsou nyní vidět od začátku podle výslovného požadavku
operátora. Toto osobní posouzení proto není slepé; export zaznamenává jejich
zpřístupnění. Původní JSON zůstal zmrazený včetně starých prezentačních příznaků;
aktuální rozložení je nepoužívá a je samostatně označené jako v2.

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

V headless Chromium 145 bylo ve v2 ověřeno **27 testů, 108 modelových
sekcí a všech 324 odpovědí i jejich známek**, přímo proti datovému souboru.
Kontrola pokrývá také 958 dílčích kritérií (včetně důvodů, jsou-li v záznamu),
čtyři obrázky a jednu odpověď bez známky. Modely i známky jsou viditelné
bez přepínačů; odkazy vedou ke správným odpovědím. Ověřen je import v1/v2,
známky a poznámky po reloadu, zachování váhy a preference, odmítnutí cizího
zdroje či známky mimo rozsah a ochrana nečitelného místního návrhu.

Nulové renderer chyby a síťové požadavky, bez vodorovného přetečení při
šířkách 800 a 390 px. Snímky zadání, konkrétních odpovědí a reasoning
hodnocení byly také vizuálně zkontrolovány. Diagnostický browser používá
`--no-sandbox --disable-gpu`; toto je ověření samostatného HTML, ne Studia.
Testovací exporty jsou syntetické a oddělené od skutečného hodnocení.

Původní v1 archiv a jeho receipt zůstávají zachované včetně tehdejších
neúspěšných kroků harnessu (chybějící cache Chrome 152, chybný výběr pokusu
v testu po reloadu). V2 má vlastní obsahově adresovaný archiv, manifest,
receipt a `ui-verification-layout-v2.json`. Při rozšíření testu importu
harness nejprve čekal na stále zobrazenou hlášku předchozího importu a četl
starou známku. Zachovaný neúspěšný pokus vedl k opravě čekání na skutečně
obnovenou hodnotu; finální průchod prošel.

Reprodukce stejného rozložení z neměnných dat v evidence rootu:

```sh
python3 render-comparison-layout-v2.py --output /absolutni/novy/comparison.html
node check-comparison-layout-v2.cjs
```

Renderer ověřuje SHA vstupního datového souboru a bez výslovného parametru
nepřepíše výstup. Pro samotné prohlížení a hodnocení stačí samostatný
`review/comparison.html`; obsahuje všechny texty i obrázky.

K odhadu šumu: změna Devstralu 11/21 → 10/21 znamená pozorovaný rozdíl
4,76 procentního bodu. Dva běhy samy nestanovují spolehlivou hranici šumu
±5 bodů ani jedenáctinásobnou statistickou průkaznost. Tato sada tento
odhad nepotřebuje a vývojové případy nepřejmenovává na holdout.
