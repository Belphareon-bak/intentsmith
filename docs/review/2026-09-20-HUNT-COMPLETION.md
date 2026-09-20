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

Uzavřeno všech 2 922 pokusů. Přímé čtení pokrývá 1 577 dokončených
pokusů (1 277 unikátních textů); 13 nedokončených otevřených odpovědí
zůstává samostatně jako vyčerpaný limit. Celkem je 3 984 odůvodněných
kritérií. Shodná odpověď ve shodné úloze sdílí čtení, všechny pokusy
zůstávají započtené. `grading-freeze.json` vznikl před otevřením identity key;
SHA ručních známek `be00f4621197ac03e0c03b9fe3a18fbe0e78ea7d678a7977b6d955849553e49d`.

Dalších 210 CODE pokusů prošlo spustitelnými orákuly. Přesná pole CHAT/VISION
pokrývají 1 074 obsahových známek. U 37 neparsovatelných odpovědí je obsah
neznámý, provozní využitelnost nulová; 24 vyčerpaných limitů rovněž zůstává
v počtu pokusů s nulovou provozní využitelností. Žádné čekající čtení.
Hodnocení autora nástrojů není nezávislá lidská přejímka.

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
a prázdná odpověď přes aktuální produkční fix loop. Čisté opakování na `5831dfaf`: **48/48 kontrol**.

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

## Provozní výsledek CODE

Čistý `5831dfaf`, plán `374f4ff4ce70a70617e621bc963448175c5168df41bcfbb92e8c21f48fa3eafa`:
Qwen3.8 dokončil 4/6 a Qwen3.5 3/6. Všech 12 pokusů je platných,
7 SUCCESS a 5 INCORRECT. Oba kandidáti absolvovali paměťovou kvalifikaci
16k kontextu / 4 096 výstupních tokenů; maximální pozorovaná paměť celého
GPU byla 21,34 GB. Artefakt je potvrzen odpovědí, provider
`0.34.2-intentsmith.1`. Verdikt **NEROZHODNUTO**, rozdíl kandidát−incumbent
−16,67 p. b., interval [−90,40; +76,18] p. b. Šest předpokládaných
nezávislých skupin nestačí k obecné validaci pořadí. Směr bodového výsledku
souhlasí s benchmarkem, výhru ani přenosovou platnost tím netvrdíme.

## Další zjištěná produkční vada

`WorkflowOrchestrator._finalReview` přijímal neparsovatelný výsledek jako
COMPLETED. `_reviewLoop` propouštěl neznámý verdikt do dalšího kroku.
Obě větve nově končí FAILED s `R1_REVIEW_INVALID` / `R2_REVIEW_INVALID`.
Platné PASS/FAIL/REDESIGN zachovávají svůj význam. 14/14 cílených kontrol
zahrnuje nečitelný text, null, objekt bez verdiktu, pole, UNKNOWN i malé
`pass`, a všechny platné větve. Transport je metodou orchestrátoru,
v běžné aplikaci nadále volá autorizovanou bránu; manuální harness ji
v izolovaném procesu nahrazuje transportem s potvrzeným digestem.

## Co zůstává otevřené

- Nové omezené provozní zkoušky ostatních rolí a jejich obsahové posouzení.
- Nezávislé posouzení sporného a náhodného vzorku a přejímka automatického
  hodnotitele. Počet napsaných známek není důkaz jeho přijetí.
- Skutečný celý průchod Studiem, přijaté rozhodovací profily a přenosová
  platnost na dostatečném počtu nezávislých případů.

Žádná produkční aktivace, automatické mazání ani zapnutí timeru.

## Příprava navazujících provozních zkoušek

První sběr rolí na `a7bdf9a8` zachovává všech 48 odpovědí. Před jejich
obsahovým posouzením byla zjištěna chyba harnessu: název plánu v R1/R2
obsahoval řídicí sufix before/after. Těchto 32 revizí se nepoužije pro
pořadí; nová série používá neutrální název případu. Šestnáct D1/D2
vstupů název nepoužívalo. Opakování revizí je přiznaný replay po opravě
protokolu, nikoli netknutý první holdout.

Pevný manuální vstup `conversation-operational-handoff.mjs` připravuje
CHAT přes skutečný answer handler a VISION přes skutečný image bridge.
Zachycuje požadavky a odpovědi bez náhrady produkčního parseru. Chybějící
digest nebo CPU přetečení ukončí kvalifikaci role; zbývající plánované
pokusy zůstávají explicitně nezahájené. Běh používá oddělenou DB a
procesovou konfiguraci, žádné produkční přiřazení.
