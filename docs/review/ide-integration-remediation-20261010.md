# Dokončení revize integrace a preview V4

Stav: **IMPLEMENTED / FULL_VALIDATION_PENDING / INDEPENDENT_REVIEW_REQUIRED**.
Navazuje na publikovaný `230f657f` a nezávislou revizi Claude (Opus),
10. 10. ~01:00, [přesná kopie posudku](opus-ide-integration-230f657f-20261010.md).
Verdikt pro původní kód je **NEEDS_CHANGES**. Opus schválil tři nové importní
hrany resolveru úložiště; toto schválení není přejímkou následných oprav.
Produkční release zůstává `NOT_ACCEPTED`.

| Nález / požadavek | Změna | Kontrola |
|---|---|---|
| Opus P2 | České názvy a jednořádkový účel všech sedmi rolí; popsaný zkrácený SHA-256 s celým otiskem v tooltipu | Kanonický render a nativní editor |
| Opus P3 | ID SSH profilu pouze pro čtení; limit odpovědi i pro explicitní textový `refine` | SSH renderer a skutečný payload gateway |
| N1, CHAT | Minimum 8192; dlouhý vstup vrací bezpečnou českou 413 bez odpovědi modelu | Skutečný produkt: minimum + 2000 znaků, přetečení bez inference/assistant zprávy |
| N2, ostatní role | Přijímací kontrola textového rozpočtu v gateway i VISION; interní JSON neomezuje délka běžné odpovědi | D2 a VISION: vlastní výstupní rozpočet, malý kontext odmítnut před providerem |
| N3/N8, pull a cesta | Resolver skutečného pull endpointu i v Hunt skriptu; absolutní systemctl | Rozdílné inference/pull porty, UNKNOWN bez pull efektu, lokální service autorita |
| N4, worker | Formulář zdroj/podmínka/plán/oznámení, nepovinný JSON, editace z detailu | Skutečný Studio controller → HTTP → vypnutá instance → edit/readback |
| N5/N6 | Známé SCM/backup chyby jako 4xx; trvalý důvod chybějící instalace Huntu | Chybové API a scheduler scénáře |
| N7, nativní IDE | Rozšířená sonda skutečných kliknutí, zápisů, readbacků a restartu | Nový AppImage a nativní běh jsou součástí následující kvalifikace |
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

Dosavadní průchody jsou dílčí; celý nový čistý offline/database profil,
registrované HTTP programy, AppImage, nativní zápis/restart a přesné CI se
doplní po commitu. Původních 415/415 a 9/9 na `c47d1883` není důkazem nové
aplikační revize. Neúspěšné meziběhy se nepřepisují na PASS.

Čistý `7962d250`: celý profil **415/415 PASS**, HTTP 3/3, CI 38003377261
19/19 a AppImage sestaven. Nativní diagnostika odhalila výše uvedené skutečné
chyby; její částečné průchody nejsou PASS celé cesty. Poslední opravy mají
samostatný následný commit a novou kvalifikaci.

Čistý `fc22a2e1`: HTTP 3/3, CI 38002233484 19/19, AppImage sestaven;
celý profil **414/415 FAIL**. Jediná chyba je zastaralý generovaný mobilní
inventář po přidání retention-preview API. Inventář byl znovu vygenerován
ze zdrojů; následující kvalifikace ověří tuto opravu i zbývající body Opuse.

Refiner je od rozhodnutí 024 v chat finalizeru vypnutý. Tato oprava jej
neobnovuje; i případné explicitní textové volání `purpose:refine` používá
stejný limit uživatelského výstupu. Strukturovaný JSON má nadále vlastní
interní rozpočet.

Externí release podmínky: nová nezávislá revize; aktuální release soak a
propustnost/restore na finálním kandidátu; M5 úschova a 13 podepsaných záznamů;
Gate 0 a přejímka operátora; skutečné Discord/Telegram doručení při explicitní
autorizaci cíle; GPU Hunt podle trvajícího automation hold a role evidence.
Výchozí styl/custom CHAT prompt a srovnání Gemma 64/96/128k patří podle zadání
po releasu. Žádné nové vazby modelů ani automatické uvolnění hold nevznikají.

Další omezení: automatický sběr veřejných žebříčků, vlastní plán záloh,
trvalý stav poslední testovací zprávy a úklid starých Hunt úkolů zůstávají
označené jako nepodporované / dosud neimplementované; konfigurace se
nevydává za ověřené doručení, kvalitu nebo aktivaci. Lokální přednostní
složka projektů je dosavadní funkční override; není odstraněna bez migrace
uloženého uživatelského nastavení.
