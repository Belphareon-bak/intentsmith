# WP — Sázení přes skutečný M1 HTTP chat

**Stav:** izolovaný implementační kandidát, `REVIEW_PENDING`, nenasazený.
Přímý řízený produktový test prošel; nezávislé review, sloučený běh a fyzická
ověření zůstávají otevřená.

**Autorita a vstup:** operátor 2026-10-01 výslovně požádal o skutečný M1
HTTP/SQLite průchod specialisty Sázení. `PRODUCT.md` §2 požaduje specialistu
ověřeného přes uživatelskou hranici a `CONTRACT.md` §4 pozorované chování.
Veřejná nabídka je podle `WP-SAZENI-PUBLIC-20260912` pozorování s časem
načtení, nikoli potvrzený živý kurz ani přijetí sázky. Vstupní čistý commit
je `033afd47363936e2549e24e25f2af938e28de7cc`; vlastní větev je
`work/chat-sazeni-http-20261001`.

**Vlastněné cesty:** produktové testovací rozhraní v
`src/betting/default-host.js`, úzká oprava session cache v
`src/expertises/specialist-runtime.js`, vlastněný M1 launcher a fixture preload
v `tests/helpers/`, `tests/chat-sazeni-http-journey.test.js`, jeho záznam
v `tests/registry.json`, generovaný registr a mechanické počty v README a
SYSTEM-MAP. Instalovaná DB, GPU, běžící služba ani externí sázkové účty
nejsou součástí kandidáta.

## Konkrétní průchod a orákulum

Test spouští vlastní `src/server.js` nad privátní SQLite. Přes HTTP ověří
seznam, výběr `sazeni`, konverzace v oddělených projektech, `POST /api/chat`,
session a trvale uložené zprávy. Testovací child má přes `--import` explicitní
hostem vlastněný transport; přesměruje jen deklarované veřejné URL na dva
zachycené zápasy a deterministickou syntetickou historii. Testovací most
vyžaduje soukromý test runtime, v produkčním režimu je odmítnutý. Nečekaná
externí adresa selže.

První platné zadání vyžaduje E0, 24 hodin, tiketový kurz 2–4, dvě položky,
minimální p 0,2, nejvýše dva tikety a rozpočet 100 Kč po 50 Kč. M1 metadata,
prezentace i privátní evidence musí dát `sazeni.ticket_builder`, přesné
události `1vy-0cg` + `1vy-0ch`, tipy domácích 1,51 × 1,87 a kurz **2.8237**.
Výstup musí uvádět `verifiedObservation=true`, `verifiedLive=false`, neznámý
čas poslední změny kurzu, dvouminutovou platnost od pozorování a nepodanou
sázku. Záznam v betting SQLite váže výsledek na conversation ID, user message
ID, zdroj, omezení a osm zdrojových observation ID. Chybné „dnes“ vrací
`NEEDS_INPUT` před fetch; následující přesné doplnění drží preference pouze
ve své session a druhá session je nezdědí. Řízený modelový endpoint zůstává
bez volání.

## Red → green a hranice důkazu

Po bezpečném zapojení fixture odkryl nový HTTP test skutečnou chybu:
jednoznačný první výpočet uspěl, nejednoznačné „dnes“ se sice správně zastavilo,
ale runtime uložil `inputError` do session cache. Další jednoznačné „do 3 dnů,
rozestup max 48 h“ pak chybně vracelo `NEEDS_INPUT`. Oprava neukládá
chybné parametry Sázení a zachovává poslední platné preference. Přímý test
poté prošel **2/2**; sousední přímé programy `sazeni-engine`,
`sazeni-integration`, `specialist-runtime` a specialistický M1 followup
prošly **4/4** (vnitřní aserce 17/17, 20/20 a 24/24 u prvních tří).

První návrh testu před přidáním `--import` podpory do sdíleného launcheru
option tiše ignoroval a soukromý child provedl nechtěný veřejný Fortuna read.
Tento běh je **neplatný jako fixture důkaz**. Launcher nyní vyžaduje explicitní
preload, backend bez testovacího mostu při požadavku na fixture selže a
produkční režim most odmítá. Pozdější zelený test kontroluje přesné dva
zdrojové identifikátory a ceny v privátní DB; fyzický externí read se v něm
neprovádí.

Zachycená nabídka pochází z 2026-09-12 a její čas zápasů je pro test
deterministicky posunut. Kandidát neověřuje skutečné dnešní kurzy, kalibraci
modelu, přijetí sázky, fyzické UI ani mobilního klienta. Registrovaná sada
`IS-T3-TESTS-CHAT-SAZENI-HTTP-JOURNEY-TEST` a lokální zelené běhy nejsou
release přejímka.
