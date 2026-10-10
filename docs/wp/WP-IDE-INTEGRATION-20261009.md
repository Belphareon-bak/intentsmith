# Společná integrace IDE a backendu

Autorita: přímé zadání operátora 9. 10. 2026 „dolad to … at IDE a BE spolu
skvele funguji“, původní a–k/V4 a předaná nezávislá revize backendu i společného
kandidáta. Revize není nová produktová autorita; popisuje vady těchto požadavků.

Výsledek: spojený frontend/backend; nastavení nesmí rozbít další chat ani
zkrátit interní JSON volání; role se rozliší i u stejného modelu; inventura
ukáže skutečné úložiště; odmítnutý formulář zachová data a dovolí opravu;
průvodci a dostupné katalogové podklady použijí reálná API. Ověřit skutečné
IDE připojené k vlastnímu produktu, restart/readback a relevantní negativní
cesty. Nejde o GPU kvalifikaci, deployment ani release přejímku.

Vstupy: čerstvě fetchovaný main `138e958be927df9835c091d3ad41d44b347e85b5`,
BE `0766a0ba73b4f25be3d6ccc507d26ba5e26ba2c6`, FE
`598de50e357350a2014ad49e4df46e288c678579`. Obě větve spojené na nové větvi
`work/ide-integration-20261009` v mém existujícím checkoutu
`intentsmith-ide-backend-20261009`; nová pracovní plocha nevzniká. Konflikty
jsou census v README/SYSTEM-MAP/TEST-REGISTRY, přepočítané na skutečný stav.

Vlastněné: dotčené role/gateway/call sites, správcovské routes, provider storage
resolver/config/upgrade, M3 service, scheduler a UI controllery; kanonická
Studio šablona a její generovaný build; cílené testy, registry/census, CI a toto
předání. Connector: skutečná lokální auth HTTP/WS, původní M1/M3/SCM/outbound.
Zakázané: cizí checkouty a dirt, provozní DB/config/bindingy, váhy, běžící
production/soak, persistentní automation hold, release attestace/Gate 0.

Pozorování: aktuální Ollama unit je active s
`OLLAMA_MODELS=/mnt/vi7000/ollama/models`, BE env tuto informaci nepřebírá.
Produkce je stále `c84b88cd`, cizí soak běží. Hold vyžaduje výslovné uvolnění
operátorem; v tomto WP se neruší. GPU ani skutečné externí zprávy nejsou
potřebné k integračnímu ověření.

Demonstrace: nastavení přes skutečný frontend → API → zavřená/znovu otevřená
DB → další zpráva; dvojice stejného modelu s různými rolemi; invalidní SSH a
cesta opravitelné ve stejném formuláři; worker/specialista vytvoření a úprava;
native IDE nad vlastním port file a řízeným poskytovatelem. Žádné fake quality
scores ani přihlášené účty z pouhé konfigurace.

Ověření: Node 24, nové integrační testy a dotčené M1/CHAT/M3/SCM/storage/Studio
sady, `node scripts/validate-test-registry.js`, build-view `--check`, module
ratchet a `git diff --check`; po stabilizaci spojený offline/database profil a
vlastní server journeys sériově. U nativního IDE doložit skutečné click/readback
a úklid vlastněných procesů. STOP: potřeba oslabit L0, kolize vlastníka nebo
nejasná autorita skutečného efektu; jiná nezávislá práce pokračuje.

Publikovat samostatnou větev a ověřit vzdálené SHA. Zdrojové změny tohoto WP
vyžadují novou nezávislou revizi; review původních dvou větví se na ně nepřenáší.

10. 10. předáno: aplikační kandidát `c47d1883`; kompletní offline/database
415/415, registrované IDE HTTP/BE 2/2 programy, nativní AppImage 9/9 kontrol,
CI 19/19. **REVIEW_PENDING_WITH_OPEN_SETTINGS_FINDINGS**: dodatečná sonda bodu
f) prokázala persistenci 35 obecných polí, ale neúčinnou obecnou teplotu a
globální kontext; další účinky této sondě nepřísluší označit za PASS.
[Předání](../review/ide-integration-handoff-20261009.md) obsahuje důkazy,
reprodukce a limity. Podle doplňujícího zadání operátora se po publikování
čeká na nezávislý verdikt Opuse pro finální úpravy. CHAT styl/vlastní prompt
a související měření patří po releasu; žádný hold ani binding se nemění.

## Dokončení podle doplňujícího zadání 10. 10.

Autorita: přímé zadání operátora zapracovat důležité změny doladěného preview,
projít nezávislou revizi a dokončit nedodělky bránící releasu. Dostupný
nezávislý posudek je nyní doložen od Claude (Opus) pro `230f657f`, verdikt
`NEEDS_CHANGES`; přesná kopie je
[uložena v repozitáři](../review/opus-ide-integration-230f657f-20261010.md).
Tři importní hrany resolveru jsou schválené. Nejde o přejímku následných oprav.

Rozsah dokončení: bezpečné rozpočty CHAT a strukturovaných rolí (N1/N2),
skutečný pull endpoint a disková inventura Huntu (N3/N8), formulářový průvodce
a editace workerů (N4), známé klientské chyby a důvody neprovedení (N5/N6),
nativní zápis/readback (N7). Srovnat důležité body 1–9 V4 a původní a–k:
retence s náhledem/potvrzením, Git výběr větví a detail, telemetrie a označení
nepodložených funkcí. U obecných nastavení ověřit skutečného spotřebitele;
hodnoty bez účinku nesmějí vystupovat jako funkční ovladače.

Demo: nejmenší CHAT okno + 2000 znaků; nadlimitní zpráva s opravitelnou chybou;
strukturované role bez zkrácení JSON; sidecar inference/pull na různých portech;
worker vytvořený formulářem a upravený z detailu; nativní uložení/restart;
retence, Git a další ovladače podle výsledného rozsahu. Aktualizovat runtime
kontrakty, census, registry a souhrn hotových funkcí/zbývajících release podmínek.
Publikovat a ověřit vzdálené SHA i CI. Produkce, cizí soak, klíče/podpisy,
automation hold, bindingy a odložená CHAT personalizace zůstávají chráněné.


Implementační dokončení N1–N8 a V4 je v novém
[paketu](../review/ide-integration-remediation-20261010.md). Následuje čistý
aplikační commit, celý profil, skutečný HTTP/restart, nový AppImage/nativní
zápis a CI. Původní výsledky z c47d1883 nejsou přeneseny na nový kód.

Skutečné nativní ověření navíc otevřelo asynchronní editaci instance workera
a neplatný generovaný balíček specialisty. Opravy zahrnují skutečný loader,
ExtensionContext a readback. Fresh-clone Gate 0 odkryl zastaralou allowlist
Theia build výstupů; konkrétní nové výstupy mají kontrolu vlastnictví a
negativní testy symlinků/práv. Další release brány se tím neoznačují PASS.

Závěrečné nativní ověření odkrylo i prázdný filtr pozastavených workerů.
Filtry a stav nyní používají skutečné enabled/schedule z list API; sonda
ověřuje čítač i filtrovaný seznam. M6 deterministický plán doplňuje čtyři
pojmenované lokální toolchainy požadované aktuálním registrem (python3, tar,
iproute2, nftables). Každý stále prochází původním preflightem; nevzniká
autorita pro GPU, server ani externí síť. Starý Gate 0 v1 běh je pouze
diagnostika, podle Decision 036 není release řetězem M6.

Ověření další zprávy odhalilo také nulový účinek vytvořeného specialisty:
prázdné rozpoznávací vzory nabízely gap namísto doménové odpovědi. Příprava
kontextu nyní používá existující M3 dispatcher a wrapper. Povinný důkaz je
prompt/pravidla/omezení ve skutečném provider payloadu, krátký další vstup a
readback po restartu. Kvalifikace `0efdf04a` zůstává historická.

Finální aplikační source: `387a490fb3fbd6b5c06756629b42e6a44840f15b`,
publikovaný na integrační větvi. 415/415 offline/database, 3/3 registrované
HTTP programy, 27/27 kontrol AppImage proti vlastnímu backendu, čerstvá
instalace/opakování a CI 19/19 PASS. Nativní sonda má samostatný otisk;
její oprava čekání na načtené řádky rolí nemění src/, tests/ ani IDE.
Předání je integrační kvalifikace, nikoli M6 acceptance. Nový 24h HTTP soak
běží v loopback namespace nad zmrazeným zdrojem, bez inference a outboundu.
Zdrojové změny po jeho startu by vyžadovaly nový běh.
Dokončený skutečný 5min HTTP throughput a upgrade/restore přesné předchozí
136.0.0 na 136.1.0 jsou PASS; nezakládají M6 acceptance ani GPU autoritu.

## Spuštění kandidáta po hlášení starého vzhledu 10. 10.

Autorita: operátorův snímek běžného spuštění IDE 2.0. Pozorování: desktop
stále používá backend `c84b88cd` a AppImage `fddfe996` z 29. 9.; nový AppImage
`387a490f` při skutečném nativním spuštění správně skrývá opakované sloupce
nastavení a přepíná seznam/dlaždice. Výsledek tohoto dodatku je dostupný
samostatný spouštěč kandidáta s vlastní DB, backendem a profilem, bez modelové
inference. Výchozí instalace ani její data se tím nepovyšují na přijatý release.

Příprava balíku odkryla skutečnou regresi packageru: totožná sada všech 346
vstupů sestavení byla odmítnuta kvůli odlišnému pořadí `git ls-files` a
`localeCompare`. Oprava porovnává stejnou úplnou sadu cest; stále odmítá
chybějící/duplicitní soubory, změněné bajty i neshodný AppImage. Vlastněné jsou
packager, samostatný review spouštěč, jeho místní balík/profil/menu a důkazy.
Zmrazený zdroj probíhajícího 24h soaku a cizí procesy se nemění.

## Oprava skutečně spouštěného IDE podle zadání 10. 10.

Operátor odmítl další spouštěč a označení dokončeného V4. Samostatná položka
`intentsmith-candidate.desktop` byla odstraněna; její historický důkaz není
ověření běžné instalace. Tento dodatek nahrazuje zákaz lokálního deploymentu
výše: výsledné UI/BE se mají ověřit a nasadit do stávajícího IDE 2.0, se
zachováním původní druhé aplikace, DB/historie, profilu, modelových vazeb a
persistentního Hunt hold. Lokální aktualizace není formální M6 přejímka.

Vlastněné: kanonická šablona a její generátor, stávající správci nastavení a
modelů, odpovídající API a pozitivní/negativní user journeys, balík a instalace
stávajícího IDE 2.0. Nejprve skutečně porovnat obrazovky proti V4 (včetně
Huntu), přenést důležité funkce bez nové palety/alternativní aplikace, odstranit
modrý rámeček po kliknutí a zachovat viditelný focus při práci klávesnicí.
Doložit živé údaje Ollamy, všechny dotčené obrazovky na 1366/1920, zápis,
readback/restart a skutečné běžné spuštění. Preview čísla nejsou měření.
Konečný stav čeká na novou nezávislou revizi přesného publikovaného SHA.

### Rozhodnutí a provedení aktualizace hlavní instalace 10. 10.

Operátor následně výslovně doplnil „klidne at role prepne“. Tím povolil
obnovu sestavy uložené v provozní DB, včetně čtyř rozdílů proti RAM starého
backendu. Toto doplnění nahrazuje požadavek zachovat RAM sestavu v předchozím
odstavci; DB, profil, Legacy a Hunt hold se zachovávají dál. Nejde o přijetí
navržených kvalitativních modelových dvojic ani o uvolnění automatického hold.

Stávající hlavní instalace nyní používá aplikační snapshot a AppImage
`37ee6177`, stejně jako spravovaný backend. Migrace/záloha, integrity/FK,
nezměněné doménové počty, autentizovaná API, readback všech sedmi vazeb,
jediná hlavní desktop položka a skutečný běžný start s původním profilem
prošly. [Aktuální report a provozní důkazy](../review/ide-preview-completion-20261010.md)
rozlišují dokončené lokální nasazení od nezávislé revize a formální přejímky.

### Dokončení Opusovy rozpracované implementace V4

Autorita: následné přímé zadání operátora „tak to dotahni co nejlepe dovedes“
po porovnání účtů, repozitářů a modelů/Huntu s V4. Předchozí nasazení
37ee6177 **nesplnilo úplnou kompozici V4**. Opusova nezávislá revize téhož
nasazení přijímá technické opravy, nikoli bod f), viz
`Projects/docs/reviewer-tools/ide-redesign-20261009/review-deployed-37ee6177.md`.
Operátor povoluje dokončit jeho 12 necommitnutých souborů settings-v4 v tomto
checkoutu. Zdrojem vzhledu zůstává preview-v4-claude/src, nikoli náš report.

Výsledek: skutečně zapojené stránky V4 ve stávajícím Studiu 2, všechny modelové
záložky a Hunt podzáložky, skutečné API, opravitelné formuláře a jasná provenance
skóre/připojení. Vlastněné cesty doplňují docs/studio2/settings-v4 a lib/browser/
settings-v4, jejich build a testy. Ověření: DOM události a negativní zápisy,
všechny stránky nativního AppImage s backendem na 1366/1920, restart/readback,
required offline/database a strukturální kontroly, následně aktualizace stejné
hlavní instalace a push. Nová paleta, aplikace ani desktopová položka nevzniká.
Hunt hold, Legacy, původní DB/profil, cizí checkouty a GPU kvalifikace zachovány.
Formální release a nová nezávislá revize nejsou nahrazeny lokálním nasazením.

## Dokončení skutečného preview po předání Opusových rozpracovaných změn

Autorita: operátor 10. 10. „tak to dotahni co nejlepe dovedes“. Převzaté
rozpracované soubory byly nejprve evidované otisky ve vlastním checkoutu;
pět designových CSS je přesný zdroj doladěného V4. Opusův později doručený
posudek `37ee6177` je technická přijatelnost pro místní provoz, bod f)
nesplněný, release nepřijatý. Původní tvrzení úplného V4 se opravuje.

Nový source `3c804a8a859a9f44efd200585795f5373e85fc3c` připojuje kompozici do
stávajícího widgetu, motivu a HTTP/M1 klientů. Účty, repozitáře, sedm modelových
záložek a čtyři části Huntu používají skutečné služby; katalog, varianty,
matice, plánování a nejisté formulářové zápisy mají samostatné negativní
ověření. Neúčinné obecné formuláře byly odstraněné. Nepodporované identity,
OAuth, fallback seznam a libovolné benchmarkové parametry nejsou předstírané
hotové funkce; úplná produktová přejímka bodu f) zůstává otevřená.

416/416 offline/database, 3/3 skutečné HTTP programy, artifact/census 161,
registr 603, hranice 1557 beze změny, nový build, 53 nativních snímků a 10
zápis/readback/restart kontrol, CI 19/19 PASS na přesném source. HTTP fixture
byl opraven pro existující klasifikátor před plánovačem; nedošlo k oslabení
oracle ani backendové autority. První audit s nepovolenými toolchainy a
přerušený meziběh zůstávají neúspěšné diagnostiky, nikoli finální PASS.

Hlavní `intentsmith.desktop` a backend jsou aktualizované na tentýž source.
Běžné nové okno má původní profil a fialový motiv, DB/doménové počty/role,
Legacy i hold zachované; cizí 24h soak se nepřerušil. Nejde o třetí aplikaci
ani nový kandidátní launcher. [Aktuální předání a důkazy](../review/settings-v4-completion-20261010.md)
rozlišují implementaci, lokální provoz, nepodporované funkce a release.
Nový nezávislý verdikt Opuse není k dispozici; čeká se na něj pro další opravy.
