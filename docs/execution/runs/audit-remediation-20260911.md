# IntentSmith — výsledek oprav auditu 2026-09-11

Adresát: operátor a nezávislý reviewer kandidáta. Autorita práce: explicitní
zadání operátora po auditu a schválení jednotlivých webových požadavků v 1.0.
**Stav: IMPLEMENTED_CANDIDATE / INDEPENDENT_REVIEW_REQUIRED. Celý release ani
funkční dokončení modelově generované aplikace nejsou přijaté.**

## Rozsah a předání

Opravy jsou na větvi `work/audit-remediation-20260911` v
`/home/belphareon/Projects/intentsmith-audit-20260911-FNF2jj/snapshot`.
Vstup byl `983121eece58b8522f736d4c8bc7c7e0ea4f657a`; poslední runtime
kandidát před tímto reportem je `7a5f41043338bbcb9055e6d05e6d28517728069d`. Cizí hlavní checkout,
jeho dirty změny, živá DB, modelové bindingy a klíče nebyly upravovány.
Žádný push, nasazení ani podpis akceptace neproběhl.

## Co bylo opraveno

- Analýza projektu používá reasoning adaptér a skutečný string system prompt.
  Výpadek modelu, zrušení, deadline a neúplná odpověď nesmějí vytvořit uložený
  assistant success. Kontext zůstává omezený aktuálním ProjectContext v1.
- Ripgrep respektuje vyloučené cesty i mimo Git checkout a dotaz nemůže být
  interpretovaný jako CLI přepínač. Kontrola patchů rozpozná syntaktickou
  chybu také při Node 22 detekci ESM bez package scope.
- Health a WS testy kontrolují aktuální veřejný kontrakt a korelaci událostí.
  Test zrušení doručuje sousední chat/cancel frames společně; produkční
  cancel guard ani původní assertion nebyly oslabeny.
- Backend a Studio mají bezpečnostní aktualizace se zamčenými závislostmi.
  Theia 1.74.1 / Electron 42.11.3 zachovávají podporovaný webpack build;
  preload se vybírá podle targetu, nikoli nestabilní pozice v poli.
  Node je připnutý na 22.21.1, podporovaný rozsah 22.12 až před 23.
- Web bez projektu má samostatné `ConversationWebRequest@1`: jeden přesný
  HTTPS GET, samostatný uložený souhlas, veřejný připnutý IP cíl, validované
  TLS, bez redirectu/retry/cookies, 15s deadline a 1MiB limit. URL a dotaz
  jsou viditelné před souhlasem. Výsledek, hash a outbound audit jsou durable.
  Vlastní web deadline hlásí TIMEOUT, nikoli zrušení uživatelem.
  Restart nespotřebuje souhlas znovu; odvolání odstraní response bytes z
  webového repository. Už zobrazené zprávy mají běžnou retenci historie.
- Nová migrace 111 je zapojená také do znovu otevřených M2 DB spojení.
  Registry, schéma, M6 execution plan a přesný module baseline odpovídají
  skutečnému kandidátu. Nejde o nezávislé přijetí nového release seal.
- Úplný SPEC má samostatný pevný 240s timeout při zachování přijatého stropu
  6000. Ostatní role a provozní context profil se nemění. Sdílená CODE cesta
  nově odmítá `finishReason:length` před předáním implementace; schválené
  workflow končí FAILED, neúplná oprava nemůže propadnout do review jako success.

## Dokumentace požadovaných rozšíření

[Post-release kontrakty](../../post-release/README.md) obsahují sedm návrhů:
skutečné zlepšování modelových vah/adaptérů, porozumění rozsáhlému projektu,
úplné agenty, externí notifikace, marketplace, média a aktualizace produktu.
Každý má pozorovatelný výsledek, hranice, failure/recovery a akceptační
scénáře. Jsou **NÁVRH K REVIEW / NEIMPLEMENTOVÁNO**. Neaktivují trénink,
externí komunikaci ani odložené funkce. README a INSTALL byly sjednocené
s podporovaným rozsahem a skutečně ověřenou instalační cestou.

## Ověření a jeho meze

| Důkaz | Výsledek a rozsah |
|---|---|
| Celá deterministická sada a následná cílená kontrola | 353/353 PASS na `5d7aab48`; následný web deadline fix má 2/2 focused programy a skutečný HTTP PASS na `7a5f4104` |
| Původních 22 serverových programů + nový web | 23/23 PASS na `2ee19e08`, soukromý server a síťový namespace |
| Přirozené vyhledání webu → přesný návrh → zrušení; přímý GET → SSRF denial → replay | PASS na `7a5f4104`, skutečné HTTP API |
| Webový repository/transport, nový proces a odvolání scope | 12/12 PASS; původních 34 webových modelových scénářů tím není přijatých |
| Studio build + Electron ABI rebuild | PASS; dvě runtime cesty na `3d088733`: reálný backend boundary a samostatný M1 fixture journey |
| Přístupnost v reálném Chrome 152 | 24/24 PASS, součást deterministické sady |
| Root npm audit / Studio yarn audit | Oba 0 známých nálezů při měření 2026-09-11; nejde o záruku neexistence zranitelností |
| Kompatibilita závislostí | XLSX roundtrip, lokální MIME serializace a skutečný headless DOM/PDF PASS; žádné SMTP doručení se netvrdí |
| Externí artifact root pro search/patch testy | 2/2 PASS na `2ee19e08` |
| Schéma / registry / module graph | 174 tabulek, 98 migrací; 514 programů (420 ACTIVE / 79 BLOCKED / 15 HISTORICAL); 1315 hran, stejné 3 cykly / 28 členů |

Staré výsledky zůstávají zachované. Mezikandidát `3d088733` měl
336 PASS / 9 FAIL / 8 BLOCKED. Devět regresí bylo opraveno; osm blokací
vyřešilo deklarované poskytnutí konkrétních lokálních toolchainů a privátního
PDF runtime. Blokující podmínky ani assertions nebyly vypnuty.

## Skutečný modelový cookbook

Model byl `qwen3.5:27b`, exact digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
provider `0.32.14-intentsmith.1`. Všechny tyto diagnostiky měly privátní DB,
projekt a 16384 context kalibraci shodnou bajty s dřívějším fyzickým pilotem.
**Produkční profil zůstal 4096.** Nejde o schválení většího provozního profilu.

1. Původní SPEC-6000 source s privátní kalibrací skončil runner TIMEOUT po
   900 s. Registr byl chybně kratší než dokumentovaných 20–40 minut.
2. Po změně pouze runner limitu na hodinu: FAIL, 24 assertions PASS / 18 FAIL,
   794,4 s. Úplná revize SPEC opakovaně vyčerpala 120s modelový timeout.
3. Po 240s complete-SPEC opravě na `15426214`: dokončený SPEC, obě revize,
   plán čtyř milníků a přechod do BUILD. Nutriční SPEC měl 4417 výstupních
   tokenů, 6744 vstupních a terminál `stop`. Následovaly tři CODE odpovědi
   s `length` na 4096 tokenech; všechny tři uložené Python soubory měly
   syntax error. Běh byl explicitně zastaven po reprodukci. **Není to PASS
   ani dokončený cookbook.** Scope byl ukončen a zdroj zůstal čistý.

Původní cookbook má vlastní executor, který zapisoval odpověď bez kontroly
truncation; není totožný s celým produkčním execution/M2 materialization
journey. Nový shared CODE guard tuto chybu odstranil i pro tento consumer.
Jeho regression test prokazuje jeden modelový pokus, FAILED terminál a
žádnou implementaci/review, i když neúplné bytes vypadají syntakticky validně.
Kvalita generování hotové funkční aplikace tím zatím není vyřešená.

## Co zbývá před vydáním

- P0 v [SYSTEM-MAP](../../../SYSTEM-MAP.md): použitelný generovaný kód a celý
  produkční build/verification journey. Doporučený další bounded zásah je
  menší jednotlivý generační krok a ověřené uložení/test, potom přesná
  reprodukce. Alternativou je samostatně změřená a schválená změna modelu nebo
  CODE/context rozpočtu; tento audit žádnou takovou aktivaci neprovedl.
- M5: operátor doložil nepoužití skutečných externích přístupů a fixture hesel
  mimo testy. [Historická fakta](m5/operator-history-facts-20260911.md) jsou
  podklad pro odpovídající N/A posouzení, ne podpis ani vymyšlená rotace.
  Dokončený podpisový řetězec a druhé odpojitelné médium nejsou doložené.
- Nezávislé review celé nové runtime změny, přijetí důkazů M5/M6 a teprve
  potom integrace/release. Review původního cizího SPEC delta `3291b5d4`
  nepokrývá pozdější vlastní opravy tohoto auditu.

Lokální manifest důkazů s SHA256 a přesnými cestami:
`.intentsmith-artifacts/audit-remediation-evidence-final.json`. Součástí modelového
stop podkladu jsou raw response hashes, souborové hashes a syntax chyby;
původní TIMEOUT, FAIL a neúspěšné diagnostické příkazy zůstaly zachované.

SHA256 finálního lokálního manifestu: `7280e91b62359017feb2f86eb9e21c98d9067fdbdf403b7ad6ded903a90b9132`.
