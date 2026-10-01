# WP — Sázení přes skutečný M1 HTTP chat

**Stav:** izolovaný implementační kandidát, `REVIEW_PENDING`, nenasazený.
Přímý řízený produktový test prošel. Nezávislé review commitu `e42b1507`
vrátilo `CHANGES_REQUIRED` kvůli nedoloženému původu fixture; tato oprava
čeká na opakované review. Sloučený běh a fyzická ověření zůstávají otevřená.

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
zápasy z kurátorsky sestavené fixture s neověřeným původem a deterministickou
syntetickou historii. Testovací most
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

Fixture nese historické tvrzení o zdrojích z 2026-09-12, ale surové soubory
`E0.json` a `markets-batch.json` se při revizi `e42b1507` nenašly. Je to
**curated fixture, origin unverified**: její pole `unverifiedSourceClaims`
uchovává údaje k dohledání, nikoli důkaz zachycené autentické veřejné nabídky.
Čas zápasů je pro test deterministicky posunut. `verifiedObservation=true`
ověřuje pouze pozorování odpovědi testovacího transportu, ne původ fixture
ani aktuální veřejný kurz. Kandidát neověřuje skutečné dnešní kurzy, kalibraci
modelu, přijetí sázky, fyzické UI ani mobilního klienta. Registrovaná sada
`IS-T3-TESTS-CHAT-SAZENI-HTTP-JOURNEY-TEST` a lokální zelené běhy nejsou
release přejímka.

**První čistý commit a registrovaný běh:** `16e361764d0e0c30ea153a336864760453aee185`
prošel přes `scripts/run-suites.js` jako **1/1 PASS**; přesný lokální report je
`.intentsmith-artifacts/run-suites/2026-10-01T00-16-44-338Z/report.json`
se `sourceRevision=16e36176` a `gateEvidence:false`. Dokumentační kontrola
`artifact-validation` prošla **160/160**, specialistický boundary ratchet
**12/12**, registr obsahuje **578** programů a fingerprint
`7e4070d0a62961d25ed159dc1910edd28d37579d19d0c6633f94693fb70ca99d`.
Tento bod není nezávislé přijetí kandidáta.

**Review checkpoint `e42b1507`:** `CHANGES_REQUIRED` pouze pro chybějící
důkaz historického původu fixture; produktová cesta a testové orákulum v této
revizi neměly další blokující nález. Oprava mění jen kvalifikaci a metadata
fixture, nikoli její nabídku, kurzy, produktové chování či testové aserce.
