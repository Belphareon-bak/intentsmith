# Dokončení revize integrace a preview V4

Stav: **IMPLEMENTED / FULL_VALIDATION_PENDING / INDEPENDENT_REVIEW_REQUIRED**.
Navazuje na publikovaný `230f657f` a nezávislou revizi `c47d1883` od Claude
v `~/Projects/docs/reviewer-tools/ide-redesign-20261009/review-integration-c47d1883.md`.
Posudek neuvádí model; jeho obsah nepřejímáme jako nezávislé schválení těchto
nových oprav. Produkční release zůstává `NOT_ACCEPTED`.

| Nález / požadavek | Změna | Kontrola |
|---|---|---|
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

Dosavadní průchody jsou dílčí; celý nový čistý offline/database profil,
registrované HTTP programy, AppImage, nativní zápis/restart a přesné CI se
doplní po commitu. Původních 415/415 a 9/9 na `c47d1883` není důkazem nové
aplikační revize. Neúspěšné meziběhy se nepřepisují na PASS.

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
