# GPU hunt — posouzení textových kontrol a oprava pokrytí CHAT matice

**AUTHOR_DISPOSITION_REVIEW_PENDING / NOT_DEPLOYED / NO_REPLAY.**
Navazuje na operátorem ověřený audit `83592d53`. Autorita této práce je
požadavek operátora opravit tiché vynechání dvou úloh a posoudit význam
154 inventarizovaných míst včetně pozitivních a negovaných protějšků.
Nezavádí novou rozhodovací politiku ani přijetí orákula.

## Matice už ukazuje celkové pokrytí

[Otevřít opravenou úplnou matici](/mnt/vi7000/intentsmith/evidence/hunt-text-disposition-20260923/full-matrix.html).

CHAT výslovně ukazuje **38/40 úloh v obsahových osách** a **2 úlohy /
60 odpovědí mimo obsahové osy**. `cz_grammar_correction` a
`en_structured_extraction` mají přímá tlačítka pro otevření všech modelů,
odpovědí a původních známek. Důvod je uvedený: požadují JSON, ale jejich
obsah se posuzoval rubrikou, takže nepatří do původní osy prózy ani přesných
polí. Nejsou bez známek ani vyřazené z uložené historie.

Pokrytí se počítá ze sjednocení skutečných množin úloh, nikoli z pevné
konstanty 38. Zobrazuje rozsah celé role i při filtrování modelu. U ostatních
rolí nezůstává staré upozornění CHATu. Strukturovaný export obsahuje
`contentAxisCoverage`, včetně názvů a počtů položek mimo osy.

Porovnání s předchozí maticí ověřilo přesnou rovnost datových polí
`inputs`, `items`, `summaries` a `sources`. **Žádná odpověď ani známka se
nezměnila.** Původní archivovaná HTML a osobní anotace zůstaly zachované.

## Posouzení všech 154 míst

[Úplná tabulka míst](/mnt/vi7000/intentsmith/evidence/hunt-text-disposition-20260923/dispositions.md)
a [podrobné důvody, kontexty a příklady](/mnt/vi7000/intentsmith/evidence/hunt-text-disposition-20260923/dispositions.json).
Čísla míst odpovídají pořadí původního zmrazeného seznamu; JSON nese jeho
SHA a u každého místa historickou revizi, řádek, znění a zdrojový kontext.

| Počet | Druh | Důsledek |
|---:|---|---|
| 102 | Pomocné mechanismy, mock protokoly, databázové hranice, pevné identifikátory a doslovné hodnoty | Zachovat jejich konkrétní kontrolní účel. Není to známkování významu prózy. |
| 40 | Próza produkovaná mimo měnitelný úsek dané úlohy | Kontrola nezměněného okolí, nikoli důkaz správnosti textu vytvořeného kandidátem. Před rozšířením rozsahu úlohy potřebuje sémantickou náhradu. |
| 9 | Próza uvnitř měnitelného úseku | Vyžaduje opravu hodnoticího kritéria; slova nejsou důkazem významu. |
| 2 | Kategorie chyby NEBO klíčová slova | Rozdělit exaktní stav a správnost vysvětlení. Současné OR může zamaskovat chybu. |
| 1 | Podmíněná kontrola zachování tématu | Kontrolovat vztah ke konkrétnímu vstupu/výstupu; samotné slovo Docker nic nedokazuje. |

Nejde o 154 nezávislých vad ani o 12 nezávislých vadných úloh. Některá místa
kontrolují tutéž vlastnost v různých vrstvách. U 40 kontrol okolí může oprava
ovlivnit to, zda se větev vykoná, ale text produkuje jiná nezměněná funkce.
To neopravňuje kontrolu smazat a zároveň ji nelze vydávat za přejímku
modelova slovního vysvětlení.

Podstatné konkrétní rozlišení:

- `confidence` je přesně předepsaný enum. Dodatečná kontrola již používá
  rovnost pro obě strany a počty 1, 2, 3 a 7. Ta má zůstat přísná.
- Databázový kód nebo zpráva pevného triggeru dokládá odmítnutí určitého
  SQL zásahu; není to modelova volná próza. Zachovat související kontrolu stavu.
- `NaN` je výslovně zakázaný zobrazovaný sentinel. Jeho hledání se nesmí
  zaměnit za sporné hledání anglické věty vysvětlující nekonečný výsledek.
- `category === 'import_missing' || message.includes('not found')`
  může projít díky správné kategorii i s vysvětlením, které popírá neexistenci
  importu. Exaktní kategorie je užitečná; složený boolean není významový soud.
- Kontrola Dockeru se při `improved === false` vůbec nevykoná. Není to
  důkaz úspěšného vylepšení odpovědi ani její věcné správnosti.

Zařazení je **autorské posouzení k revizi**. Nejde o nezávislou přejímku
ani o důkaz úplnosti dynamického call graphu. Dvojice příkladů v JSONu,
které nemají execution receipt, jsou výslovně označené jako návrhy sond.
Kontroly nezměněného okolí nebyly plošně mutované.

## Nové párové sondy skutečným runnerem

[Běh a úplné výstupy](/mnt/vi7000/intentsmith/evidence/hunt-text-disposition-20260923/paired-probes-complete.json).
Používají původní úplné testové soubory i původní konfiguraci skórování,
izolovaný `applyAndTest()` a referenční opravu. Zásah se omezuje na uvedené
slovní vysvětlení. Nejde o modelové odpovědi ani o replay jejich známek.

| Kontrola | Reference | Ekvivalentní formulace | Rozporná formulace se stejnými slovy |
|---|---:|---:|---:|
| Nedosažený práh, aktivní CODE | 1 | **0** | **1** |
| Poměr rychlosti, aktivní CODE | 1 | **0** | **1** |
| Chybějící měření rychlosti, aktivní CODE | 1 | **0** | **1** |
| Nekonečný výsledek, rezerva | 1 | **0** | **1** |
| Přetečení VRAM, rezerva | 1 | **0** | **1** |
| Prázdný soubor, rezerva | 1 | **0** | **1** |
| Chybějící import, rezerva | 1 | 1 | **1** |

U pozitivního protějšku se očekává zachování reference 1. U negativního
nesmí vzniknout úplná správnost; sonda nepředepisuje novou částečnou známku
modelové odpovědi. **13 ze 14 mutací nesplnilo toto očekávání.** U importu
správná kategorie obejde textovou větev OR, proto projde parafráze i rozpor.

Bylo spuštěno pět úplných referencí. Čtyři prošly. U rezervního
`patch_e4407e5ef59d` runner vrátil `test nebyl dokončen`; oba zamýšlené páry
pro prázdnou a krátkou kreativní odpověď proto **nebyly provedeny**. Surový
výsledek reference 0 je v důkazu zachovaný, ale není to nula modelu ani
důkaz o obou směrech orákula. Zůstává `REFERENCE_NOT_VALID`.

Předchozí dvojice pro jistotu jsou připojené odkazem na původní důkaz,
nepočítají se znovu do čtrnácti mutací. Skript
`scripts/manual/probe-code-oracle-text-pairs.mjs` lze zopakovat s
`--out /absolutní/nový-report.json`; při nálezu vrací exit 1. Při selhání
reference nejprve uloží její výstup a nevydá výsledky závislých mutací.

## Změna přejímky a ověření

Šest nových kontrol pro tři větve aktivního `decideRole` je zapsaných do
fixture přejímky: ekvivalentní a rozporný protějšek pro práh, rychlost
a chybějící měření. Jsou to kontroly stávajícího požadavku na zachování
větví, nikoli další výjimka ve známkování textu. Integrační test nyní
ověřuje, že se všech šest názvů objeví v odmítnutí a provider nebyl zavolán.
Budoucí oprava pouhé věty o jistotě tedy nezakryje nyní doložené vady zbytku.

- CODE suite: **29 PASS / 0 FAIL** na rozšířené přejímce.
- Prohlížeč: **15 PASS**, včetně obou nových odkazů, 60 odpovědí mimo osy,
  přepínání rolí, všech modelů a původních VISION obrázků.
- Porovnání dat matice: PASS, původní vstupy, známky a souhrny shodné.
- Syntaxe skriptů a `git diff --check`: PASS.

Sondy běžely před přidáním šesti přejímacích kontrol do fixture. Jejich
otisky zdrojů jsou v receiptu; samotný runner a pravidla skórování se
nezměnily. Následující integrační test ověřil rozšířenou fixture.
Není to nové tvrzení o finálním modelovém měření. Prohlížečový test pokrývá
samostatné HTML v diagnostickém headless Chromium, nikoli instalované Studio.

Přenosný archiv, otisky a rozsah jsou v
[receiptu](evidence/2026-09-23-hunt-text-disposition.json).
Nasazení, GPU inference, mazání, změny vazeb, timeru ani přepočet modelových
známek neproběhly. Změny jsou připravené k revizi.

## Doporučená oprava podle výsledku

Přesná API a stavy dále ověřovat spuštěním. U původních odpovědí oddělit
takto doložený technický díl od neověřeného významu vysvětlení; neoznačit
jej za úplné splnění. Pro nové CODE úlohy preferovat strukturovaný výstup
a vykreslení vysvětlení aplikační šablonou, aby se nezvětšovala plocha
vyžadující sémantického hodnotitele. To je změna zadání, ne zpětné
přepsání toho, co model původně dostal.

Alternativou pro starou volnou prózu je přijaté samostatné významové
posouzení s oběma směry kontrol. Další substring, normalizace interpunkce
nebo rozšíření slovníku tuto třídu neopraví. Před replayem zůstává nutná
přejímka vybrané opravy; před novým sběrem samostatné GO s rozpočtem.
