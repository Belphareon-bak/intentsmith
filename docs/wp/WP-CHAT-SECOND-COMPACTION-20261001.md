# WP — druhé zkrácení kontextu po restartu a hranice projektů

**Stav:** vývojový kandidát založený na čistém integračním commitu
`63dc55fb897b1bf18ac9f0332bbdc63e41a487d9`. Deterministická cesta
M1 HTTP, soukromé SQLite a vlastněného loopback providera prošla v přímém
běhu. Po commitu a integraci je třeba zopakovat registrovanou sadu na
čistém přesném SHA; tento WP sám není Gate 0 ani živá kvalita modelu.

**Autorita a výsledek:** operátor výslovně žádá skutečné chatové testy
naplnění kontextu, automatického čištění, různých projektů a expertiz.
`PRODUCT.md` vyžaduje obnovit konverzaci a nepřenášet projektová data mezi
projekty. Tento WP ověřuje druhou automatickou kompakci, restart a
oddělení projektů tam, kde už první kompakci ověřuje sada 85.

**Vlastnictví:** `tests/chat-second-compaction-http.test.js`, jeho řádek
v `tests/registry.json`, odvozený `docs/convergence/TEST-REGISTRY.md`,
aktuální počty v `README.md` a `SYSTEM-MAP.md` a tento WP. Produkční kód,
modelové vazby, běžící služba a její databáze zůstávají mimo rozsah.

**Průchod:** test spustí vlastní M1 server, vlastní SQLite a provider na
`127.0.0.1`. Připojí dvě různé soukromé složky jako projekty A/B a vybere
expertizy `developer`/`writer`. První tah projektu A uvede unikátní
uživatelský kód; několik dalších rozdílných tahů vyvolá první souhrn.
Test načte přesná HTTP a SQLite data, uloží první hranici
`summary_up_to_msg_id`, korektně zastaví proces a spustí nový nad stejnou
soukromou DB. Po restartu vznikne druhý uživatelský kód a další tahy
vyvolají druhý souhrn. Druhá hranice musí být vyšší a musí pokrýt nový tah;
všechny původní zprávy musí v SQLite zůstat. Projekt B se navštíví před
restartem, po něm i po druhém souhrnu.

**Oracle:** fake provider tvoří souhrn pouze z kódů, které skutečně dostal
v požadavku. Test ověřuje, že první provider source obsahuje původní
uživatelský vstup, druhý obsahuje předchozí souhrn a nové rozhodnutí, ale
nerecykluje původní raw vstup. Finální provider prompt projektu A obsahuje
právě jeden trvalý souhrn s oběma kódy, přesné bajty vlastního souboru a
aktuální pravidlo vlastní expertizy. Původní raw tahy už v promptu nejsou;
po odstranění souhrnu zkopírovaný prompt neobsahuje první kód. Žádný prompt
ani odpověď projektu A neobsahuje cizí soubor, pravidlo či kód projektu B;
prompty B neobsahují kódy A. HTTP odpověď se musí shodovat s terminální
řízenou provider odpovědí a HTTP historie s read-only SQLite. Negativní
mutace stejného oracle odmítají chybějící souhrn, ztracený původní kód a
vpašovaný kód projektu B.

**Provozní hranice:** test používá deklarovaný `num_ctx=4096` a po prvním
souhrnu zkracuje další aktuální zadání; druhou kompakci vynutí také tlak
desetizprávové dosud neshrnuté historie. Při stavbě testu velmi dlouhý
aktuální projektový dotaz po prvním souhrnu skončil výslovným terminálem
`PROJECT_PLANNING_UNAVAILABLE`: nevešel se do rozpočtu projektového promptu.
To není úspěch druhé kompakce; kapacitní odpověď se hodnotí odděleně.
Případ pro extrémní vstup zůstává samostatnou kapacitní hranicí. Tato
deterministická sada neprokazuje správnost odpovědí fyzického modelu ani
release přijatelnost.

**Spuštění a stop condition:**

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) KEEP_TEST_RUNTIME=1 \
  node scripts/run-suites.js --suite=IS-T3-TESTS-CHAT-SECOND-COMPACTION-HTTP-TEST
```

Sada končí `FAIL`, pokud chybí druhý uložený souhrn, jeho hranice neroste,
vypadne původní či nové uživatelské rozhodnutí, unikne cizí projekt, liší
se HTTP a SQLite, není zachován vlastní soubor/expertiza, nebo se vlastní
server či provider nepodaří korektně ukončit. Soukromý verdikt nese přesné
source SHA jen při čistém checkoutu; bez něj je `direct-run-unattested`.
