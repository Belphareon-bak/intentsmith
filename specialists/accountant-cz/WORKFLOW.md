# Účetní: doklady, přiznání a termíny

Stav 2026-09-12: **IMPLEMENTED_SLICE / REVIEW_PENDING**. Autorita je pokračování
[WP-SPECIALISTS](../../docs/wp/WP-SPECIALISTS-20260911.md). Jde o místní CLI;
napojení do chatu IntentSmith a do staré SQL účetní knihy není součástí tohoto řezu.

## Použití

Instalace z kořene tohoto checkoutu: `python3 scripts/install-ucetni.py`.
Vytvoří soukromé Python prostředí a příkazy `ucetni` a `uct` v `~/.local/bin`.
Potřebuje Node 22, Python s venv, Poppler (`pdftotext`, `pdftoppm`), font DejaVu
a síť pouze při instalaci připnutých balíčků a českého/anglického OCR modelu.
Při práci s podklady nevolá LLM ani web. Přehled příkazů: `ucetni --help`.

```bash
ucetni rok 2025 /cesta/k/podkladum/2025
ucetni vzor dan-2025 /cesta/k/vystupum-ucetni.zip
ucetni nahled dan-2025
ucetni pruvodce dan-2025
ucetni stav dan-2025
ucetni srovnej dan-2025
ucetni export dan-2025

ucetni mesic 2026-05 /cesta/k/fakture.pdf /cesta/k/uctenkam.heic
ucetni pruvodce dph-2026-05
ucetni export dph-2026-05
```

`nahled` vypíše cestu k soukromé HTML stránce. Otevři ji v prohlížeči; originál
nebo výřez je vedle vytěžených polí a příkazu k jejich opravě. Částky v datových
polích jsou v haléřích. Průvodce zadává částky v Kč, pamatuje odpovědi a dovoluje
„nevím“. Další doklady lze přidat pomocí `ucetni import ID soubor-nebo-slozka`.
Fotografii lze znovu rozdělit: `ucetni rozdel ID ID_ZDROJE 3x2`; již zkontrolované
doklady se nepřepíšou. OCR používá dva lokální průchody a všechny výsledky jsou
návrhy. Přesný počet účtenek, jejich hranice a čitelnost je třeba zkontrolovat.

Neúplný případ lze exportovat pomocí `ucetni export ID --navrh`. Pracovní ZIP
obsahuje výpočet a konkrétní seznam chybějících údajů, **neobsahuje podací XML**.

## Co dodat pro rok 2025

- Vydané faktury a skutečné úhrady: bankovní výpis/pokladní podklad, datum,
  částka, případné částečné platby. Prověřit také prosinec 2024 zaplacený v roce
  2025 a prosinec 2025 zaplacený až v roce 2026. Dvanáct faktur samo neprokazuje
  dvanáct plateb ani úplnost příjmů. Automatické bankovní párování zatím není.
- Totožnost, daňový režim a sazbu paušálních výdajů podle činnosti. Výdajový
  paušál není paušální daň. Příjmy se počítají podle přijatých peněz bez DPH.
- Manžela/manželku, děti a měsíce nároku. Podmínky slevy na manžela/manželku
  zahrnují společnou domácnost s dítětem do tří let a celoroční vlastní příjem
  nejvýše 68 000 Kč; PPM se zahrnuje, rodičovský příspěvek ne. Potřeba je podepsané
  prohlášení/potvrzení. Samotné zadání nízkého příjmu nestačí.
- Potvrzení pro penzijní produkty, životní pojištění, DIP, dlouhodobou péči,
  dary a úroky na bydlení, pokud se uplatňují. Zadává se daňově uznatelná částka
  z potvrzení. Průvodce se zeptá i na neuplatňované položky a odpověď uchová.
- Přehledy záloh ČSSZ a OZP přiřazených k roku 2025 a zálohy na daň z příjmů.
  I nulové zálohy mají doložený podklad; výpis plateb může sloužit více účelům.

Potvrzení se importují a schvalují jako podpůrný podklad. Průvodce propojí
odpověď s jeho ID. Generované čestné prohlášení je **návrh k podpisu**, nikoli
důkaz podpisu nebo automaticky schválený nárok. Další příklady lze přidávat;
opravy mají původ a historii revizí, nejsou automatickým trénováním modelu.

## Výstupy a podporované meze

Měsíční řez: běžná tuzemská plnění fyzické osoby, měsíční DPH v letech 2025–2026,
sazby 21/12 %, plný odpočet nebo zdůvodněné neuplatnění. Hranice KH 10 000 Kč
se posuzuje za celý doklad včetně DPH, i u smíšených sazeb. Výstupem jsou
`DPHKH-YYYY-MM.xml`, `DPHDP-YYYY-MM.xml`, souhrn, kalendář a kontrolní manifest.
Zahraničí, reverse charge, opravy, zvláštní režimy a krácené odpočty vyžadují
rozšíření; export je v těchto případech zastaven.

Roční řez: **rok 2025, český rezident, jedna tuzemská činnost §7, CZK,
hlavní OSVČ celý rok, výdaje procentem, OZP 207, pokračování stejného režimu**.
Řeší slevu na poplatníka, nezletilé děti bez ZTP/P, běžnou slevu na manžela/manželku,
společný odpočet produktů na stáří/péči, dary a úroky včetně měsíčního limitu.
Vytváří:

- DPFO XML (`DPFDP7`) s použitými potvrzeními v přílohách;
- ČSSZ XML (`OSVC2025`), OZP XML a vyplněný oficiální OZP PDF;
- čitelné **opisy výpočtu** DPFO, přílohy č. 1 a ČSSZ v PDF; tyto tři PDF
  nemají grafický layout úředního tiskopisu. Pro elektronický import jsou XML;
- návrh prohlášení, přehled termínů/plateb, ICS, zdrojové podklady a manifest.

Jiné roky, jiné zdravotní pojišťovny, účetnictví místo peněžní evidence, skutečné
výdaje, zaměstnání, zahraničí, ztráty, zletilé děti, invalidita/ZTP/P, změny
činnosti a žádosti o vrácení/použití přeplatku zatím vyžadují další formulářový
řez. Výpočet může ukázat bonus/přeplatek, ale export se zastaví před nevyplněnou
žádostí. Haléřová evidence zůstává přesná; při rozporu návazností celokorunových
řádků vyžaduje odsouhlasení zaokrouhlení. Tyto stavy se netváří jako hotové podání.

Všech pět XML formátů se před zveřejněním ZIP validuje lokálně podle připnutého
XSD. **XSD_VALIDATED_REVIEW_REQUIRED není přijetí úřadem ani kompletní věcná
kontrola EPO/ePortálu.** Import a kontrola na příslušném portálu jsou dalším krokem.
Program nic na úřad neodesílá. Zdrojové podklady v dodaném vzoru se nikdy
nedopočítávají zpět z konečné daňové povinnosti.

## Termíny a lokální připomínání

```bash
ucetni terminy
ucetni hlidat start
ucetni hlidat jednou
ucetni podano dan-2025 dpfo 2026-03-29 ID_POTVRZENI
ucetni hlidat stop
```

Hlídání používá uživatelský systemd časovač `ucetni-watch.timer`, denně v 9:00,
a desktopová oznámení. Nezávisí na spuštěném IntentSmith. Při vypnutém PC neběží;
persistentní timer dožene kontrolu při příštím běhu uživatelského správce služeb.
Připomíná podklady a termíny bez evidovaného splnění. Stav OVERDUE znamená
chybějící záznam v tomto nástroji, ne prokázané nepodání. Odesílání e-mailů není
v tomto řezu zapojené. `alerts.json` drží místní seznam i bez desktopových oznámení.

Kalendář zohledňuje způsob a skutečné datum podání, pracovní dny, doplatky
pojištění do osmi dnů, následné zálohy a pravidla roku 2026. Bez doloženého
podání je částka/začátek následných záloh podmíněný plán. Bez dat roku 2024
nezná dřívější zálohy. Výjimky a individuální rozhodnutí je nutné doložit;
pro rok 2027 je nutné aktualizovat pravidla a minima.

## Soukromí a obnovitelnost

Stav: `~/.local/state/ucetni`; runtime: `~/.local/share/ucetni`.
Lze změnit `UCETNI_STATE_DIR`, `UCETNI_RUNTIME_DIR`. Adresáře mají práva 700,
soubory 600. Import ukládá kopii s SHA-256, originály nemění. Revize jsou
append-only, souběžný zápis zamčený; změna dokladu ruší potvrzení úplnosti.
ZIP odmítá traversal, symlinky, vnořené archivy a nadlimitní rozbalení; XML
zakazuje externí entity. Každý export kontroluje i nezměněnost zdrojů.
Po tvrdém pádu může zůstat `write.lock`; před jeho odstraněním ověř PID v něm
a běžící import. Soukromé případy, náhledy a výstupy nepatří do Git.

## Pravidla a původ formulářů

Ověřeno 2026-09-12. SHA-256 a přesné URL formulářů jsou v
[`src/accounting/schemas/sources.json`](../../src/accounting/schemas/sources.json)
a [`templates/sources.json`](../../src/accounting/templates/sources.json).

- [FS: OSVČ, paušály, zvýhodnění a zálohy](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/fyzicke-osoby/podnikatel-osvc).
- [FS: pokyny k přiznání za 2025](https://financnisprava.gov.cz/assets/tiskopisy/5405-1_33.pdf), včetně úroků a zaokrouhlení.
- [FS: podmínky slev, manžel/ka a vlastní příjmy](https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/zamestnanci-zamestnavatele/dotazy-a-odpovedi/2026/aktualni-dotazy-a-odpovedi-k-dani-z).
- [FS: lhůty přiznání za 2025](https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr/tiskove-zpravy-2026/vyplnujete-danove-priznani-za-rok-2025).
- [ČSSZ: přehled 2025 a pokyny](https://eportal.cssz.cz/web/portal/-/tiskopisy/osvc-2025).
- [ČSSZ: zálohy, změna minima od července 2026 a maximum](https://www.cssz.gov.cz/zalohy-na-pojistne-na-duchodove-pojisteni).
- [OZP: přehled a formuláře](https://www.ozp.cz/formulare/prehled-osvc), [splatnosti](https://www.ozp.cz/pro-platce/samoplatce).

Pravidla jsou verzovaná součást programu; nejde o automatické přepisování
daňových pravidel z libovolné webové stránky.

## Studio (doplnění 2026-09-17)

Ve Specialisté vyber **Účetní**. Přilož PDF/HEIC a napiš například
„Připrav kontrolní hlášení za květen 2026“. Limity: 5 příloh, PDF/HEIC do
10 MiB na soubor, dokumentová dávka do 20 MiB; inline přenos bez serverové cesty.
Import běží lokálně. Stejné zdrojové bajty se neduplikují a OCR zůstává návrhem.
„pruvodce“ se postupně ptá na chybějící textové údaje a potvrzení; „podklady“
vypíše celý seznam, „doklady“ detaily, „nápověda“ formát oprav.
„export navrh“ vytvoří pracovní ZIP, „export“ až po doplnění a schválení dokladů.
Přesná cesta k ZIP je ve zprávě; automatické podání neprobíhá.
Evidence Studia je oddělená podle projektu a konverzace pod
`~/.local/state/ucetni/studio/`; neslévá se potichu s dřívější CLI evidencí.
Živé podání DPH/KH stále vyžaduje úplné, zkontrolované podklady.
