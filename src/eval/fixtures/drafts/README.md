# Příprava sad, ne aktivní evaluace

`role-preparation.json` vznikl na výslovné zadání operátora z 18. 9. 2026:
připravit také ostatní role a odložit testování kvůli nočnímu klidu.
**PREPARED_NOT_VALIDATED.** Produkční runner tento soubor neimportuje.

Obsah:

- osm historických případů s připnutou revizí, zdrojem a podklady reference;
- 32 zadání: D1 analyzuje dopady a plán, D2 příčinu a opravu, R1 celou změnu,
  R2 lokální vady; každá role má osm zadání, nikoli přejmenovanou stejnou sadu;
- revizní karty všech 40 stávajících CHAT úloh (24 EN / 16 CZ);
- inventář 12 stávajících VISION obrázků od základních po složité a kontrola
  bez obrázku;
- hranice quick/full, kvalifikace paměti a pokračování přerušeného CODE běhu.

Zadání jsou přípravné karty s rubrikou, ne hotové spustitelné testy. Před
aktivací je nutné doplnit přesné vstupy, varianty a provést přejímku hodnotitelů.
D1/R1 potřebují relevantní kontext volajících; samotný izolovaný úryvek
nedokládá hlubokou analýzu. U R1 musí být dodaný skutečný hodnocený diff.

Reference a `authorNotes` patří autorovi hodnotitele. Model smí dostat jen
zadání a určené vstupy. Tyto známé historické případy jsou vývojová sada;
nesmějí později být označené za oddělený slepý provozní holdout. Varianty
stejné příčiny sdílejí `independenceGroup`. Osm různých skupin samo o sobě
nedokazuje statistickou nezávislost ani reprezentativní pokrytí role.

Otevřené významové odpovědi CHAT ani D1/R1 nelze poctivě hodnotit přítomností
slov. Pro měřitelné účinky se připraví T1/T2; otevřené vysvětlení vyžaduje
samostatnou ověřenou rubriku a přejímku hodnotitele. Nález mimo referenci
nejprve vyžaduje posouzení, není automaticky chybný.

Dnes se neprováděla nová validace tohoto materiálu, inference ani instalace.
Pokračování: nejprve ověřit měřidlo, potom uzamknout rozsah a limity párového
měření. Noční timer zůstává vypnutý do dalšího pokynu operátora.
