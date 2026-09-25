# Decision 049 — Studio 2.0: nové UI nad stávajícím hostitelem a správa zdrojů

Datum: 2026-09-25. Stav: **ZADÁNO OPERÁTOREM / ČEKÁ NA PŘIJETÍ BODŮ D1–D5**.
Prováděcí kontrakt: [`WP-STUDIO-2-20260925`](../wp/WP-STUDIO-2-20260925.md).
Dokumentace: [`docs/studio2/`](../studio2/README.md).

## Kontext

Operátor 24.–25. 9. 2026 zadal přestavbu Studia: současné UI „působí dětským,
amatérským dojmem"; nové má vizuálně patřit do rodiny ShellSmith/SystemSmith,
zachovat nápady a volby vzhledu původního IDE a **především fungovat s BE**.
Ze tří návrhů vybral kombinaci A (kostra ShellSmith) a C (konverzace uprostřed)
a po dvou kolech zpětné vazby potvrdil klikací prototyp slovy „takhle to můžeš
udělat". Prototyp a jeho zdroj: [`docs/studio2/README.md`](../studio2/README.md).

`DIRECTION.md` 2026-08-07 říká, že současné UI **není** finální vizuální ani UX
baseline; M0/M1 testy připínají transport, bezpečnostní hranici, protokol,
stabilitu a lifecycle. Tento zápis tu hranici nemění: vyměňuje se vzhled a
uspořádání, ne připnuté chování.

## Zadáno operátorem (platí)

1. Horní lišta nese **jen otevřené konverzace** (projektová, se specialistou,
   volná), očíslované. Detaily projektů, specialistů, expertýz, workerů, obchodu,
   médií a nastavení se otevírají uprostřed okna jako **katalog s detailem po
   straně**, ne jako samostatná karta.
2. **Každá relace má vlastní sloupec**: chat nahoře, pod ním terminál a výstup
   agenta (log). Sloupců je 1–3, výchozí stejně široké, mezi nimi posuvník.
   V každém sloupci jde vybrat, kterou otevřenou relaci zobrazuje.
3. Katalog je **jednotný pro všechny sekce** včetně konverzací a nastavení
   (dlaždice/seznam, velikost, filtr). Nic se nezobrazuje dvakrát.
4. Přepínače panelů, dlaždice/seznam a velikost dlaždic jsou **jen v horní
   liště**, ne v každém panelu.
5. Vzhled zachovává **názvy a volby původního IDE**: styly IntentSmith, Studio
   (barevné ikony sekcí), Clean (vlastní akcent a pozadí), Matrix, Japanese,
   Midnight; téma tmavé/světlé/systém, výraznost textu, zvýraznění aktivních
   prvků, velikost a rodina písma, průhlednost u stylů s tapetou, rámečky/linky,
   sbalování panelů, vlastní CSS. Sekce se jmenuje **Workeři**.
6. Upravené a otevřené soubory relace jsou v **pravém panelu**, ne v druhé horní
   liště.
7. Projekty mají **automaticky git repozitář**, pokud to nastavení projektu
   výslovně nezakáže. Pravý panel má **správu zdrojů podobnou VS Code**:
   přepínání a zakládání větví, potvrzení commitu, pull (ideálně automaticky),
   push, historie.

## K přijetí operátorem

**D1 — Hostitel zůstává Theia 1.65, vyměňuje se vrstva UI.** Doporučeno.
V souladu s `DIRECTION.md` 2026-08-02/03 (Linux + Theia + Ollama). Aktivní
Studio z Theie používá jen kontejner widgetů, DI a sdílené knihovny
([REUSE-MAP](../studio2/REUSE-MAP.md)); balení, launcher, desktop runtime,
capability transport a jejich testy zůstávají beze změny. Vlastní Electron shell
v duchu ShellSmith by ušetřil paměť, ale znamenal přepis balení a bezpečnostní
hranice — je to samostatné L4 rozhodnutí, ne součást Studia 2.0.

**D2 — Postupná výměna.** Nové UI vzniká jako nové rozšíření vedle
autoritativního `intentsmith-chat-panel/lib` (Decision `DIRECTION.md`
2026-08-07). Do parity se přepíná volbou „Studio 2 / Klasické Studio"; výchozí
se stane až po splnění parity a přesměrování testů se stejnými tvrzeními.
Odstranění starého UI je samostatný krok s vlastním potvrzením.

**D3 — Zápisové operace gitu jsou efekty (L0-11).** Commit, stage, založení a
přepnutí větve, init: prepare → plán s digestem → potvrzení → provedení →
audit, stejný vzor jako `/api/development/*` (migrace 117). Politika per projekt
`ask` / `automatic` / `disabled`, výchozí `ask`; `automatic` se nedá zapnout
obecným nastavením.

**D4 — Síťové operace gitu jsou odchozí komunikace (L0-12).** `fetch`, `pull`
a `push` jen do výslovně povolených vzdálených hostitelů, mediované a
auditované. Automatický pull je opt-in per projekt a hostitel, pouze
`--ff-only`, nikdy merge/rebase/force; push nikdy automaticky. IntentSmith
neukládá git credentials; používá jen to, co uživatel má v systému, a před
schválením ukáže přesný remote a hostitele.

**D5 — Terminál relace nerozšiřuje autoritu.** Sloupec zobrazuje příkazy a
výstup své relace (agentovy i uživatelovy) přes stávající kanály. Nový přístup
k shellu nevzniká; `terminal → exec` zůstává pod `validateCommand()` a L0-10
(inventura #21, W-1).

## Důsledky

- Backend se mění jen o konektor správy zdrojů ([SCM](../studio2/SCM.md)) a
  případný read model souborů relace; vše ostatní používá stávající API
  ([CONNECTORS](../studio2/CONNECTORS.md)).
- Písma se přibalují lokálně; renderer nesmí načítat `fonts.googleapis.com`
  (L0-12, WP-M0-E to zachytil jako pokus o tichou odchozí komunikaci).
- Omezení na tři relace je jen v UI (`_sessionCount`); backend konverzace
  zpracovává souběžně a tutéž konverzaci serializuje (`docs/WS-PROTOCOL.md`).
- Návrh balíčků nástrojů v obchodě (git, bash, Python, Docker) je mimo tento
  rozsah: [MARKETPLACE-TOOLCHAINS](../studio2/MARKETPLACE-TOOLCHAINS.md).
