# Dokončení revize integrace a preview V4

Stav: **INTEGRATION_QUALIFIED / INDEPENDENT_REVIEW_REQUIRED / RELEASE_NOT_ACCEPTED**.
Navazuje na publikovaný `230f657f` a nezávislou revizi Claude (Opus),
10. 10. ~01:00, [přesná kopie posudku](opus-ide-integration-230f657f-20261010.md).
Verdikt pro původní kód je **NEEDS_CHANGES**. Opus schválil tři nové importní
hrany resolveru úložiště; toto schválení není přejímkou následných oprav.
Produkční release zůstává `NOT_ACCEPTED`.

Aplikační zdroj: **`387a490fb3fbd6b5c06756629b42e6a44840f15b`**,
větev `work/ide-integration-20261009`. Publikační commit tohoto paketu mění
dokumentaci, důkazy a čekání ruční sondy na načtený řádek CHAT; nemění `src/`,
`tests/` ani `intentsmith-ide/`. Níže uvedené důkazy náleží tomuto aplikačnímu
SHA, nikoli automaticky libovolnému pozdějšímu HEAD. Nativní sonda je navíc
identifikována samostatným SHA-256.

Soubor [důkazů a jejich otisků](evidence/ide-remediation-387a490f-20261010/README.md)
obsahuje původní JSON receipts, snímky nativního IDE a negativní meziběhy.
Produkce ověřená 10. 10. v 02:17 CEST stále běží ze `c84b88cd`; nebyla nasazena
nová verze ani změněny bindingy modelů.

| Nález / požadavek | Změna | Kontrola |
|---|---|---|
| Opus P2 | České názvy a jednořádkový účel všech sedmi rolí; popsaný zkrácený SHA-256 s celým otiskem v tooltipu | Kanonický render a nativní editor |
| Opus P3 | ID SSH profilu pouze pro čtení; limit odpovědi i pro explicitní textový `refine` | SSH renderer a skutečný payload gateway |
| N1, CHAT | Minimum 8192; dlouhý vstup vrací bezpečnou českou 413 bez odpovědi modelu | Skutečný produkt: minimum + 2000 znaků, přetečení bez inference/assistant zprávy |
| N2, ostatní role | Přijímací kontrola textového rozpočtu v gateway i VISION; interní JSON neomezuje délka běžné odpovědi | D2 a VISION: vlastní výstupní rozpočet, malý kontext odmítnut před providerem |
| N3/N8, pull a cesta | Resolver skutečného pull endpointu i v Hunt skriptu; absolutní systemctl | Rozdílné inference/pull porty, UNKNOWN bez pull efektu, lokální service autorita |
| N4, worker | Formulář zdroj/podmínka/plán/oznámení, nepovinný JSON, editace z detailu | Skutečný Studio controller → HTTP → vypnutá instance → edit/readback |
| N5/N6 | Známé SCM/backup chyby jako 4xx; trvalý důvod chybějící instalace Huntu | Chybové API a scheduler scénáře |
| N7, nativní IDE | Rozšířená sonda skutečných kliknutí, zápisů, readbacků a restartu | Sestavený AppImage proti vlastnímu backendu, 27/27 kontrol |
| Preview 1 | Skutečný seznam/dlaždice katalogu Huntu; neúčinné přepínače vypnuté s důvodem | React/VM/render testy, kolekce používají původní theme tokens |
| Preview 2 | Živé filtry, řazení velikosti, reference/provenance; unknown nezastupuje nula | Katalog a import skutečných podkladů; automatický žebříček se netvrdí |
| Preview 3–4 | Přesné barevné hranice 50/70/80/90; oddělené nastavení rolí a HW důkaz | Hraniční testy skóre, role API/wire/HTTP; HW maximum zůstává neověřené |
| Preview 5–7 | Flex checkboxy, závislá pole plánů, odstup fronty 28 px | Kanonický render/fuzz; nativní šířky 1366/1920 jsou v sondě |
| Preview 8–9 | Graf skutečné latence s jednotkami, časy, P50/P95 a součtem; české počty | Graf odmítá neznámé vzorky, omezuje 120 bodů; první token se neměří |
| Retence | Náhled ze stejné rozhodovací funkce jako úklid; potvrzení dopadu pravidel | Archiv/nejnovější chráněny, cancel nic neuloží ani nesmaže |
| Git | Větve z API, řazení, rodiče, diff vedle sebe, velké patche | Skutečný Git s >4 MB změnou, validace OID, selektory/readback |
| Bod f), obecné volby | 4 aktivní přepínače paměti; 31 starších polí bez účinku pouze pro čtení | HTTP/restart + spotřebitel memory policy; UI odmítá i zastaralý draft |

Zdroj vzhledu zůstává `docs/studio2/prototype/src/main.js` a
`main.template.html`; generovaný renderer se tvoří pouze build-view skriptem.
Přenesené úpravy zachovávají design IDE a jeho barvy, podle README preview V4.

Další skutečné funkční nálezy a jejich opravy:

- Pozastavení workeři: skutečné enabled a schedule z list API určují stav,
  filtry a počty. Ověření zahrnuje autentizovaný HTTP controller a nativní
  kliknutí na filtr. Neznámý stav se nevydává za vypnutý worker.
- M6 deterministický plán: přesně doplněné lokální python3, tar, iproute2 a
  nftables, které již aktuální registr vyžaduje. Původní preflight zůstává
  povinný; sonda kontroly pokrytí nedovolí otevřít GPU ani externí síť.
  Starý Gate 0 v1 není podle Decision 036 release řetězem M6; diagnostický
  běh se nepředkládá jako jeho PASS.
- Nativní editor workera: ID instance se předává přímo při asynchronním
  otevření a po readbacku; test odkládá React state a stále načte správnou
  existující instanci. Původní synchronní mock tento problém zakrýval.
- Účinek specialisty: prázdné rozpoznávací vzory posílaly vytvořený balíček
  do gap otázky, takže uložená doménová konfigurace vůbec nedošla k modelu.
  Lokální nástroj pro přípravu kontextu nyní rozpozná i krátký vstup; aktuální
  požadavek, prompt, pravidla a omezení přecházejí přes existující M3 wrapper.
  Skutečný HTTP payload před restartem i po něm a nativní průvodce ověřují
  účinek, ne pouze zapsané soubory. Nástroj neprovádí externí akce.
- Generovaný specialista: platný deklarovaný nástroj pro přípravu doménového
  kontextu, registrace přes ExtensionContext V1, zachovaný prompt/pravidla/
  omezení. Nástroj pouze připravuje kontext, neprovádí inference ani efekty.
  Backend nepotvrdí úspěch bez instalace, manifestu a registrace runtime.
  Skutečný loader a runtime ověřují vytvoření i bezpečné citování polí.
- Gate 0: přesně pojmenované Theia esbuild skripty a protocol lib/tsbuildinfo
  jsou kontrolované build výstupy. Cizí výstupy, symlinky a zapisovatelné
  soubory zůstávají odmítnuté. Původní čerstvý clone úspěšně instaloval IDE,
  ale stará kontrola odmítla těchto pět skutečných nových build cest.

## Kvalifikace finálního aplikačního SHA

Všechny dokončené průchody v tabulce identifikují čistý `387a490f`.

| Ověření | Výsledek a přesný rozsah | Důkaz |
|---|---|---|
| Celý offline/database profil, sériově | **415/415 PASS**: 327 offline + 88 database, 0 FAIL/BLOCKED/TIMEOUT | [Audit](evidence/ide-remediation-387a490f-20261010/full-audit.json) |
| Registrované BE/HTTP programy | **3/3 PASS**: BE, skutečný autentizovaný produkt + restart, ochrana paměti na HTTP hranici | [Audit](evidence/ide-remediation-387a490f-20261010/http-audit.json) |
| Production AppImage build | **BUILD_PASS**, Node 24.21.0, zdroj čistý před/po sestavení | [Receipt a otisky vstupů](evidence/ide-remediation-387a490f-20261010/appimage-build.json) |
| Skutečný nativní AppImage + vlastní backend | **27/27 PASS**, šířky 1366/1920, zápis + nový renderer + restart; specialistův kontext skutečně ve dvou provider payloadech | [Receipt](evidence/ide-remediation-387a490f-20261010/native.json), [snímky](evidence/ide-remediation-387a490f-20261010/screenshots/) |
| Všech 35 obecných polí | **4 funkční / 31 nepodporovaných**: skutečný HTTP a restart pro paměť, neúčinné ovladače odmítá Studio controller | [Receipt](evidence/ide-remediation-387a490f-20261010/preferences.json) |
| Čerstvý samostatný clone | **PASS**: `install.sh --profile=full --minimal` a opakování, vlastní závislosti/cache/runtime, bez vypůjčeného node_modules | [Receipt](evidence/ide-remediation-387a490f-20261010/fresh-install.json) |
| Upgrade + poškození + obnova DB | **PASS**: přesná předchozí aplikace `d3d2ec88` (136.0.0), záloha, neúspěšný upgrade, obnova přesných DB bajtů a aktuální 136.1.0; projekt a metadata zachované | [Runtime receipt a příkazy](evidence/ide-remediation-387a490f-20261010/upgrade-restore.json) |
| Přesné CI | **19/19 success**, run `38007051740`, head SHA přesně `387a490f` | [GitHub](https://github.com/Belphareon-bak/intentsmith/actions/runs/38007051740), [API snapshot](evidence/ide-remediation-387a490f-20261010/ci.json) |
| Skutečná 5min zátěž | **PASS**, 300096 ms; sustained 43340.09 req/s, 1024 souběžných požadavků, P95 26 ms, P99 37 ms, peak RSS 299.391 MiB, 0 chyb/outbound rozhodnutí | [Audit](evidence/ide-remediation-387a490f-20261010/throughput-audit.json), [runtime receipt](evidence/ide-remediation-387a490f-20261010/throughput-runtime.json) |
| Nový 24h HTTP soak | **RUNNING, není PASS**; start 10. 10. 02:05 CEST, nejdříve konec 11. 10. 02:05 CEST | [Start receipt](evidence/ide-remediation-387a490f-20261010/long-soak-start.json) |
| Formální M6 validátor | **BLOCKED**, `M6_RELEASE_EVIDENCE_NOT_FOUND`; aktuální index přejímky chybí | [Výsledek](evidence/ide-remediation-387a490f-20261010/release-validation.json) |

AppImage SHA-256:
`247ea9552231a5cd6946cde4842b41c7695c9f72380bb97ec821be67401a0969`,
195182241 bajtů. Binární soubor není uložen do Gitu.
Nativní sonda SHA-256:
`c786a7c5ef85ed4bf75106093f34f42477b4938831efa46562f9973bf076301e`.
První nativní běh čekal pouze na nadpis, nikoli na asynchronně načtené role,
a skončil po dvou kontrolách; [původní FAIL](evidence/ide-remediation-387a490f-20261010/native-failed-v1.json)
zůstává zachovaný. Opravená sonda čeká na skutečný řádek CHAT s editorem;
aplikace, backend a AppImage se mezi těmito dvěma běhy nezměnily.

5min zátěž měří production HTTP health endpoint v odděleném loopback network
namespace, nikoli propustnost modelu/chatu. 24h soak střídá health a čtení
projektů ve vlastním produkčním backendu/DB, bez inference a odchozí sítě.
Nativní běh používá řízeného poskytovatele; neprokazuje kvalitu modelů,
GPU Hunt, externí doručení ani M6 acceptance.

Historie: `fc22a2e1` skončil 414/415 kvůli zastaralému mobilnímu inventáři;
po jeho regeneraci `7962d250` prošel 415/415. Paralelní `08f4ed7b` skončil
400 PASS / 14 FAIL / 1 TIMEOUT, mimo jiné kvůli kolizi testů, které dočasně
mění zdrojový strom; [negativní souhrn](evidence/ide-remediation-387a490f-20261010/failed-08f-full-summary.json)
obsahuje otisk zachovaného původního reportu. Finální profil běžel sériově.
Starší vlastní `0efdf04a` soak byl ukončen po opravě backendu a není PASS;
cizí `138e958b` soak zůstal nedotčený. Historické výsledky se nepřenášejí
na aktuální kód.

Refiner je od rozhodnutí 024 v chat finalizeru vypnutý. Tato oprava jej
neobnovuje; i případné explicitní textové volání `purpose:refine` používá
stejný limit uživatelského výstupu. Strukturovaný JSON má nadále vlastní
interní rozpočet.

## Co ještě brání vydání / přejímce

1. Nový nezávislý verdikt Opuse nad opravami. Jeho původní NEEDS_CHANGES
   byl zapracován; neexistuje doložené schválení finálního kandidáta.
2. Dokončení nového 24h běhu na neměnném aplikačním zdroji a úplný M6
   řetěz důkazů C → E → R → A. Aktuální index chybí. Starý Gate 0 v1 není
   podle Decision 036 tímto release řetězem; jeho diagnostické běhy se
   nevydávají za přejímku.
3. M5 custody a podpisy: evidovaný stav KEY_CUSTODY_PARTIAL /
   ACCEPTANCE_BLOCKED; chybí potvrzení retain_and_rotate a osmi kategorií,
   druhá ověřená operátorská kopie a recovery ověření s oddělenou dešifrovací
   autoritou, celkem 13 podepsaných autorizačních záznamů. Operátorské klíče
   ani podpisy pracovník nevytváří jako náhradu tvého rozhodnutí.
4. Skutečné Discord/Telegram doručení. Čeká se na konkrétní testovací cíle
   a názvy env proměnných s tokeny; tokeny nepatří do zpráv ani repozitáře.
   Produkční M5 manifest kanály stále odmítá, jeho accepted authority
   nemůže nahradit pouhý uložený účet. Zadání je zahrnuje před vydáním.
5. GPU/provozní kvalifikace Huntu a rolí a operátorské demo/přejímka.
   `code-pilot-automation-hold.json` stále brání automatice. Uvolnění hold,
   aktivace modelů a přijetí navržených sdílených dvojic nejsou důsledkem
   integrace IDE. Kontrakt W1–W4 je návrh kvalifikační práce, ne její PASS.

Výchozí styl, volby stručně/vyváženě/podrobně, vlastní high-level CHAT prompt
a srovnání Gemma 64/96/128k patří podle zadání po releasu. Neaktivuje se nová
sestava modelů a nepředstírá se hardware maximum kontextu.

Další omezení: automatický sběr veřejných žebříčků, vlastní plán záloh,
trvalý stav poslední testovací zprávy a úklid starých Hunt úkolů zůstávají
označené jako nepodporované / dosud neimplementované; konfigurace se
nevydává za ověřené doručení, kvalitu nebo aktivaci. Lokální přednostní
složka projektů je dosavadní funkční override; není odstraněna bez migrace
uloženého uživatelského nastavení.

31 obecných polí nyní není 31 implementovaných funkcí. Zůstávají pouze pro
čtení se srozumitelným důvodem; některá jsou duplicitou parametrů rolí.
Staré `/api/settings` zůstává kompatibilní pro jiné klienty a může pole
persistovat, což se nevydává za runtime účinek. Stejně tak specialistův
ověřený nástroj připravuje doménový kontext; neznamená obecnou delegaci
libovolných nástrojů nebo úplný průvodce znalostními zdroji.
