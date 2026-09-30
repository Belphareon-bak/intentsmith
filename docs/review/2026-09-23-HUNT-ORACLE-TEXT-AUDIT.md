# GPU hunt — textová orákula a úplná matice uložených odpovědí

**ORACLE_DEFECTS_REPRODUCED / PREFLIGHT_HARDENED / REVIEW_PENDING / NOT_DEPLOYED.**
Autorita: operátor 23. 9. požadoval audit celé třídy textových assertion před
replayem, samostatně měřené osy a doplnění rozhodovacího návrhu. Výchozí
commit je `2599c3dfd6a7120d1dc5c71dfac5b10b24f0e20b`, větev
`work/hunt-model-controls-20260917`. Tento výstup nepřijímá hodnotitele,
nezavádí nové známky a nemění NO-GO autonomního výběru.

## Výsledek auditu

[Seznam textových kontrol](/mnt/vi7000/intentsmith/evidence/hunt-oracle-audit-20260923/text-assertions.md)
je první podklad k revizi. Obsahuje 154 sloučených kandidátních řádků,
včetně konkrétní historické revize a dotčených úloh. Úplný
[strojový inventář](/mnt/vi7000/intentsmith/evidence/hunt-oracle-audit-20260923/inventory.json)
pokrývá 37 fixtures (7 aktivních), 55 historických vstupních souborů a po
zahrnutí dohledaných testových helperů a současných kontrol 83 verzí souborů.
Zachovává 9 287 lexikálních výskytů assertion a operátorů včetně kontextu.

Jde o inventář a cílené ověření nálezů, **nikoli o potvrzení správnosti všech
assertion**. Seznam obsahuje také přesné API, chybové kódy, echo vstupu,
fixture větvení a kontroly nezměněného okolí. Ty se nesmějí plošně odstranit.
Čtyři nedohledané importy v lexikálním skenu jsou importy uvnitř řetězců
generovaných testových fixtures, nikoli chybějící přímé závislosti testu.
Vypočtené kontroly a hlubší dynamické závislosti potřebují ruční review.

Operátor měl pravdu: rozšíření `/jistota nízká/` už bylo v commitu
`01b30ae6` před uloženým hodnoticím během. Prosté opakování původního běhu
s toutéž implementací by tuto vadu neodstranilo.

Následující příklady prošly skutečným `applyAndTest()` v izolovaném worktree,
ne pouze samostatným pokusem s regulárním výrazem. Referenční kód se měnil
pouze popsaným zásahem do formulace:

| Úloha / kontrola | Očekávání podle veřejného požadavku | Pozorovaný výstup orákula |
|---|---:|---:|
| Aktivní jistota — referenční oprava | 1 | 1 |
| Totéž, `jistota: ${confidence}` | 1 | 1 |
| Totéž, `jistota rozhodnutí: ${confidence}` | 1 | 0,667 |
| Totéž, `${confidence} neplatí; skutečná jistota je opačná` | 0 | 1 |
| Rezervní matematika — referenční oprava | 1 | 1 |
| Totéž, `a non-finite number` místo `not a finite number` | 1 | 0 |

Aktivní případ je `patch_90eff80ecb8a`, historický otisk `f63d14d5eb61`.
V historické revizi `f8ac2c31` jde o
`tests/pairwise-trial.test.js:304`; související dodatečná kontrola je
`src/eval/code-contract-check.mjs:43`. Rezervní případ je
`patch_8b7557d1f9f5`, `66ddd5f2:tests/local-math-nonfinite.test.js:58`.

Ani navržené `detail.includes(confidence)` samo nedokazuje soulad významu.
Text `Neplatí nízká (jediná úloha); jistota je vysoká` obsahuje **celou**
přesnou hodnotu `nízká (jediná úloha)`, ale popírá ji. Přesné porovnání
pole `confidence` je správná kontrola API; volná próza má jiný kontrakt.

## Co se změnilo v kódu

Přejímka CODE nyní umí dodatečné pozitivní a negativní kontrolní odpovědi
deklarované ve fixture. Aktivní úloha jistoty obsahuje obě nové sondy:
významově stejnou formulaci i výslovný rozpor. Kontroluje se rovněž, že
mutace skutečně změnila referenční kód a že běh neměl neplatné prostředí.
Provedení a vyhodnocení používají existující izolovaný runner.

**Aktuální orákulum tyto kontroly nesplňuje.** Proto přejímka odmítne CODE
sadu před prvním voláním modelu. Integrační test ověřuje přesně tuto cestu
a nulový počet volání provideru. Je to opravená ochrana před vadným
hodnocením, nikoli oprava významového hodnotitele. Prompt ani existující
známky se nezměnily; pravidlo pro text nebylo potřetí rozšířeno regexem.
Změna fixture a implementace je součástí identity hodnoticího kontraktu.

Samostatná sonda volá nízkoúrovňový runner záměrně přímo, aby zdokumentovala
chybu. Její exit **1** a `ORACLE_DEFECTS_REPRODUCED` jsou očekávaný negativní
výsledek auditu, nikoli úspěšná přejímka. Nad uloženými modelovými odpověďmi
**neproběhl replay**. Změna zatím není nasazená do instalovaného runtime.

## Úplné porovnání a samostatné osy

[Otevřít úplnou matici](/mnt/vi7000/intentsmith/evidence/hunt-oracle-audit-20260923/full-matrix-v4.html).
Zahrnuje všech **2 922 odpovědí a 12 různých modelů** původního sběru:

| Role | Úlohy | Modely v roli | Odpovědi včetně nedokončených |
|---|---:|---:|---:|
| CHAT | 40 | 10 | 1 200 |
| CODE | 7 | 10 | 210 |
| D1, D2, R1, R2 | 8 na roli | 10 na roli | 240 na roli |
| VISION | 23 | 8 | 552 |

Kliknutí na buňku otevře přesné zadání a všechny modely se všemi třemi
odpověďmi a původními známkami. Vybraný model je první; ostatní zůstanou
dostupné pro stejné zadání. VISION obsahuje skutečné vstupní obrázky.
Filtry role, modelu a úlohy neprovádějí nový náhodný výběr.

Čtyři osy mají vlastní čísla i rozsah pokrytí:

1. **Konverzační obsah:** pouze původní posudky 19 jednootáčkových CHAT úloh
   s prózou. Není to přijaté měření konverzační kvality ani vícekolového chatu.
2. **Technická správnost:** přesná pole CHAT/VISION, původní spustitelné
   CODE kontroly, původní obsahové posudky D1/D2/R1/R2. Tyto metody nejsou
   navzájem zaměnitelné; porovnává se uvnitř role.
3. **Striktní JSON:** původní kontrola pouze úloh, které JSON výslovně
   požadovaly (u CHAT 21). Není to úplné dodržování instrukcí.
4. **Produkční parsovatelnost:** původní výsledek sdíleného parseru na
   těchto úlohách. Parsovatelnost není obsahová správnost.

Například Phi4 v tomto historickém CHAT panelu má striktní JSON **0/63**,
ale produkční parsovatelnost **63/63**. To je užitečný samostatný údaj,
nikoli důvod násobit obsahovou známku nulou nebo vyhlásit vítěze CHATu.
Opakování se průměrují uvnitř úlohy. Chybějící známky zůstávají viditelné
v počtech; průměr dostupných známek u neúplného pokrytí není výběrové pořadí.

Všech **30 odpovědí** úlohy jistoty je označeno varováním. Podezřelé jsou
i jedničky kvůli doloženému falešnému přijetí. Ostatní historické známky
nebyly tímto přijaty ani nově opraveny. Původní porovnání s osobními poznámkami,
`CHAT-FULL-MATRIX.md`, odpovědi, identity a známky zůstaly beze změny.
Nová matice je čtecí podklad a nemá editor osobních vah původního porovnání.

## Rozhodovací návrh

Do [směrového dokumentu, §7](../wp/WP-GPU-HUNT-DIRECTION-20260919.md)
přibylo konkrétní vymezení kritické chyby, co znamená „nová“, zachování
dílčích známek bez dvojí penalizace a vlastník opakovaného `NEROZHODNUTO`.
Po vyčerpání rozpočtu se dvojice automaticky neopakuje do vítězství;
další rozpočet a nové případy rozhoduje operátor na základě podkladu workera.
CHAT přínos 0,04 a navržená tolerance 0,02 jsou popsané s požadavkem na
uzamčení celého profilu. **Nové definice a tolerance jsou návrh k revizi,
nikoli nasazená nebo samostatně přijatá rozhodovací politika.**

## Ověření a reprodukce

- `code-patch-suite.test.js`: **29 PASS**, včetně skutečného odmítnutí před inferencí.
- `code-patch-runner.test.js`: **68 PASS**.
- `evaluation-repair.test.js`: **14 PASS**.
- `model-evaluation-acceptance.test.js`: **17 PASS**.
- Prohlížeč: **13 PASS**, všechny role, počty, otevření odpovědí, filtry,
  načtený obrázek, 30 CODE varování a žádná chyba JavaScriptu.
- Sondy: **3 z 6 nesouhlasí s veřejným požadavkem** — doložené vady orákula.

Celkem **128 úspěšných cílených regresních testů**. Neproběhlo plné release
ověření ani fyzický test instalovaného Studia. Prohlížečový test je pouze
samostatné HTML v headless Chromium se software renderingem a diagnostickým
`--no-sandbox`. GPU inference, produkční import, přepnutí rolí, mazání modelů
a změna timeru nebyly součástí této práce.

Z kořene repozitáře, vždy do nového absolutního výstupu:

```sh
python3 scripts/manual/audit-code-oracle-text.py --out /absolute/new-inventory.json
node scripts/manual/probe-code-oracle-text.mjs --out /absolute/new-probes.json
node tests/code-patch-suite.test.js
```

První příkaz jen inventarizuje zdroje. Druhý spouští izolované testy bez
provideru a při reprodukci vady vrací 1. Potřebuje dostupnou historickou
git historii a nainstalované závislosti stejně jako CODE runner.
`render-hunt-review-matrix.py --help` uvádí vstupy pro opětovné sestavení
matice. Otisky zdrojů, výstupů a přenosný archiv jsou v
[receiptu](evidence/2026-09-23-hunt-oracle-text-audit.json).

## Co zbývá před replayem a novým GO

1. Rozsoudit zbývající kandidátní textové kontroly podle skutečného veřejného
   požadavku a měněného rozsahu. Dva reprodukované případy nejsou certifikace
   zbytku historických testů.
2. Oddělit exaktní API kontrolu od souladnosti volného textu. Pro starý
   prompt nelze dodatečně předepsat přesnou formulaci. Možnosti jsou přijaté
   sémantické posouzení sporného textu, nebo nová úloha s výslovným
   strukturovaným kontraktem; samotná shoda podřetězce nestačí. Technický
   dílčí výsledek smí zůstat samostatný, ale nevydávat se za celé splnění.
3. Teprve po přejímce opraveného měřítka udělat verzovaný replay, zachovat
   původní známku a pro každou změnu doložit důvod. Žádný nezměněný běh
   neoznačit za opravu této třídy chyb.
4. Uzamknout role, přínos, ochranné podmínky, rozpočet a rozhodovací pravidlo.
   Nový vícekolový CHAT, skutečné CZ/EN páry a sběr přes panel mají samostatné
   **GO s rozpočtem**. Stará data tyto schopnosti neobsahují.

Toto kolo tedy dodává audit, ochranu před známou vadou, měřené oddělené osy
a podklady k revizi. **Neuzavírá opravu sémantického orákula ani celý hunt.**
