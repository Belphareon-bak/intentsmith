# WP — druhé zkrácení kontextu po restartu a hranice projektů

**Stav:** řízená HTTP/SQLite sada je v integrační základně `77a96d2b` a
znovu prošla přímo `1/1` v izolovaném checkoutu. Historický první kandidát
`95590541` měl `CHANGES_REQUIRED`, protože raw citace mohla zakrýt ztrátu
prose; opravené orákulum je v integrované sadě. Fyzická modelová přejímka
níže je nově připravený kandidát `LIVE_NOT_RUN / REVIEW_PENDING`. Tento WP
sám není Gate 0 ani důkaz živé kvality modelu.

**Autorita a výsledek:** operátor výslovně žádá skutečné chatové testy
naplnění kontextu, automatického čištění, různých projektů a expertiz.
`PRODUCT.md` vyžaduje obnovit konverzaci a nepřenášet projektová data mezi
projekty. Tento WP ověřuje druhou automatickou kompakci, restart a
oddělení projektů tam, kde už první kompakci ověřuje sada 85.

**Vlastnictví:** `tests/chat-second-compaction-http.test.js`, nové
`tests/chat-second-window-live.test.js`, offline atestační test a jeho
`scripts/chat-second-window-{values,evidence}.js`, příslušné řádky v
`tests/registry.json`, odvozený `docs/convergence/TEST-REGISTRY.md`,
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

**Oracle:** fake provider tvoří souhrn pouze z faktů, které skutečně dostal
v požadavku. První uživatelský vstup obsahuje starý identifikátor a oddělený
větný fakt, který se nevejde do automatických citací identifikátorů. První
provider source musí obsahovat původní vstup. Druhý musí obsahovat přesnou
prose předchozího dokončeného provider souhrnu v segmentu
`[Předchozí souhrn]`, nový kód v nových tazích a nesmí znovu přehrát celý
původní raw vstup. Řízený provider smí obnovit starý větný fakt při druhé
kompakci pouze z tohoto segmentu. Negativní mutace odstraní předchozí prose,
ponechá starý kód v raw citaci a musí selhat. Finální provider prompt projektu
A obsahuje právě jeden trvalý souhrn s oběma kódy a starým větným faktem,
přesné bajty vlastního souboru a aktuální pravidlo vlastní expertizy. Původní
raw tahy už v promptu nejsou; po odstranění souhrnu zkopírovaný prompt
neobsahuje první kód. Každý zachycený A summary provider request a finální
provider prompt A nesmí obsahovat cizí soubor, pravidlo či kód projektu B;
negativní mutace B dat ve summary requestu musí selhat. Prompty B neobsahují
kódy A. HTTP odpověď se musí shodovat s terminální řízenou provider odpovědí
a HTTP historie s read-only SQLite. Další negativní mutace odmítají
chybějící souhrn, ztracený původní kód a vpašovaný kód projektu B.

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

## Fyzická přejímka druhého okna — připraveno, LIVE_NOT_RUN

Samostatná opt-in sada `tests/chat-second-window-live.test.js` běží nad vlastním
M1 serverem a SQLite, proxy `scripts/provider-capture.js` a přesným lokálním
modelem/digestem. V projektu A pošle různorodé dlouhé hodnotové tahy, až
uložená syrová historie přesáhne skutečné `num_ctx=4096` a vznikne první
souhrn. Navštíví projekt B, korektně zastaví server a spustí nový proces nad
stejnou DB. Druhý kód vzniká teprve po restartu; další dlouhé tahy musí znovu
přesáhnout 4096 odhadovaných syrových tokenů a uložit souhrn s rostoucí
`summary_up_to_msg_id`. Finální skutečný provider prompt musí číst rekurzivní
souhrn, nesmí znovu obsahovat celý původní raw tah ani cizí projekt B. Model
má v odpovědi vybavit oba kódy a původní ruční revizi. `mechanismStatus`
hodnotí přenos, persistenci a kompakci; `semanticQuality` odděleně kontroluje
všechny hodnotové odpovědi a závěrečné vybavení. Souhrnný `PASS` vyžaduje
obojí. Každá odpověď a oba souhrny mají unikátní vazbu na terminální provider
request/response SHA; nezávislý atestor kontroluje celý privátní JSONL a
negativní mutace odmítají ztracenou prose, starý/stojící cutoff, cizí projekt
i neúplný druhý window-fill.

Registrované programy:

- `IS-T1-TESTS-CHAT-SECOND-WINDOW-EVIDENCE-TEST` — offline test orákula;
- `IS-T3-TESTS-CHAT-SECOND-WINDOW-LIVE-TEST` — fyzický model, stav `BLOCKED`
  do řízeného GPU slotu a nového běhu na finálním čistém SHA.

Po nezávislém review, integraci a uvolnění GPU se spouští **sériově**:

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
INTENTSMITH_CHAT_SECOND_WINDOW_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node tests/chat-second-window-live.test.js
```

Privátní artefakty vzniknou v `.intentsmith-artifacts/direct-tests/.../artifacts/`:
`chat-second-window-provider.jsonl` a `chat-second-window-live-evidence.json`.
Při chybě zůstane fail evidence; bez fyzického běhu se tato sada **nepočítá jako
PASS**. Registru `lastGreen` se lokální běh nedotkne. Řízený provider test
`chat-second-compaction-http.test.js` dál samostatně prokazuje restarty a
projektové hranice bez nároku na fyzickou kvalitu modelu.

Předběžné offline ověření kandidáta: atestační orákulum **2/2 PASS** včetně
negativních mutací, řízený HTTP/SQLite scénář **1/1 PASS**, registr **585**
validních programů a module-boundary ratchet **1464/1464** bez nových hran.
`node tests/chat-second-window-live.test.js` bez opt-in skončil očekávaně
`LIVE_NOT_RUN`; tento fail-closed vstup nic neposlal provideru. Tyto výsledky
nejsou fyzickým přijetím druhého okna.
