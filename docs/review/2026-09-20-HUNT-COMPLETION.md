# GPU hunt — normalizace a provozní ověření

Stav: **IN_PROGRESS / REVIEW_PENDING / NOT_DEPLOYED**.
Autonomní hunt: **NO_GO**. Tento průběžný záznam není přejímka.
Autorita: explicitní zadání operátora 20. 9. 2026; handoff §5–§7,
direction §1 a nezměněný evaluační kontrakt.

## Změna měřítka

`content-rubric.5` sjednocuje 53 otevřených rubrik. Odstraňuje bod za
obecné splnění instrukce a překrývající se rozklady stejného tvrzení.
R2 posuzuje lokalizovaný nález a jeho reprodukci společně: nesprávná
příčina nesmí přijít o bod dvakrát pod dvěma názvy. D1/D2 oddělují
diagnózu, varianty či opravu, zachování hranic a ověřovací postup.
R1 odděluje doložený nález s verdiktem a návrh navazujících kontrol.
Hodnotitel musí přiřadit jednu věcnou chybu právě jedné hodnocené položce.

Škála je 0 / 0,25 / 0,5 / 0,75 / 1 podle direction; mezihodnoty vyžadují
konkrétní správné části, nikoli nejistotu hodnotitele. Vadná rubrika či
chybějící kontext zůstává bez známky. Nulové první kritérium už nemaže
ostatní správné části. Formát zůstává oddělený od obsahu. Produkční parser
se neměnil; jeho sdílení a replay popisuje [parser parity](2026-09-20-PARSER-PARITY.md).

Nový kontrakt není přijatý automatický hodnotitel. Existující kvalifikační
brána zůstává zavřená. Změna formálně zavádí nové rubriky; nepřepisuje
historické response archivy ani jejich známky. Veřejné prompty oproti
předchozímu sběru zůstaly bajtově shodné.

## Ruční čtení

Průběžný adresář: `/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260920`.
`manual-grades.json` odkazuje přes SHA odpovědi a původní attempt ID na
anonymní `blind-items.json`. Obsahuje konkrétní důvod každé známky.
Identita kandidátů se při tomto čtení nezobrazuje; autor nástrojů však
není nezávislý na autorství části úloh. Shoda s dříve přečtenými externími
známkami se nesmí používat jako slepá přejímka.

Checkpoint: všech 630 otevřených CHAT pokusů, 330 unikátních textů,
a 30 R2 odpovědí. Zbývající reasoning posouzení pokračuje. Shodný text
ve shodné úloze se čte jednou, všechny původní pokusy zůstávají zachované.
Předchozí mezikroky známek jsou uložené samostatně, včetně sloučení R2
nálezu s jeho reprodukcí a vyjasnění českého vokativu v oslovení.

## Oddělená provozní zkouška CODE

Nový case set `fresh-20260920` obsahuje šest historických oprav:
nekonečný výsledek aritmetiky, gramatiku capabilities, filtrování prose
v konfiguraci, opakovanou VAT migraci, opětovné použití názvu archivovaného
projektu a integritu vzdáleného balíčku. Liší se od sedmi benchmarkových
úloh i osmi již odhalených vývojových případů. Historický kód mohl být
součástí tréninku modelů; netvrdí se opak.

Každý případ obnovuje celé povolené soubory před opravou. Kontroly běží
v bubblewrap bez sítě, mimo produkční DB. Vyhodnocuje se uložený stav,
nikoli text modelu. Vedle reference a alternativy se spouští rozbitý
základ a cílený mutant, dále reference, alternativa, dvojitý fenced patch
a prázdná odpověď přes aktuální produkční fix loop. Předběžný výsledek
na pracovním stromu: **48/48 kontrol**; čisté opakování před měřením je nutné.

Příprava má zachované dva neúspěšné mezikroky. První soubor obsahoval
chybu zápisu template literal. Další odhalil nesouvisející historickou
chybu parsování unárního minus; vstup byl změněn na výraz `0-5 / 0`,
který skutečně testuje deklarovaný výsledek `-Infinity`. Dále se opravilo
chybějící `entity_profiles` ID ve fixture a doplnila dobová legacy tabulka
`custom_experts`, potřebná k inicializaci historické instalace. Tyto
neúspěchy nejsou modelové pokusy ani se nemažou.

Předvolený pár: CODE incumbent Qwen3.8 proti Qwen3.5:27b podle uzavřeného
replay uloženého benchmarku (1,000 vs 0,84127). Gemma4:26b s 0,85714 nemá
doloženou plnou GPU kvalifikaci požadovaného profilu. Artefakty, profily,
runtime, případy a pravidla se zamykají před první inferencí.
Šest skupin je malý vzorek: shodné pořadí nebude důkaz obecné validity a
interval může zůstat nerozhodný. Výsledek neaktivuje binding ani retenci.

## Co zůstává otevřené

- Dočíst zbývající reasoning odpovědi a zveřejnit srovnatelné souhrny.
- Dokončit nové párové provozní měření, uchovat i blokované pokusy.
- Ověřit přenos pořadí ostatních rolí až po jejich uzavřeném hodnocení.
- Nezávislé posouzení sporného a náhodného vzorku a přejímka automatického
  hodnotitele. Počet napsaných známek není důkaz jeho přijetí.

Žádná produkční aktivace, automatické mazání ani zapnutí timeru.
