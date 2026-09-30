# WP — skutečné naplnění okna a auto-context v živém chatu

**Živá přejímka měřeného scénáře, 30. 9. 2026 23:52 UTC:** čistý, pushnutý
`c815ec435f69b4a52b30ab2f96da65136890d3c6` prošel registrovanou
`IS-T3-E2E-85-LONG-SESSION-DEGRADATION` **1/1** se čtyřmi vnitřními kroky.
Přesný report je
`.intentsmith-artifacts/run-suites/2026-09-30T23-43-46-670Z/report.json`,
privátní provider capture obsahuje **60** volání, digest instalovaného
`qwen3.5:27b` je
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Osm hodnotových odpovědí má **8/8** věcně správný holý JSON. V okně 4096
proběhla první kompakce v šestém tahu, souhrn uchoval původní auditní kód
`RIGEL_KAPPA_731`; finální provider prompt neobsahoval surový první vstup,
zatímco model vrátil přesně tento kód. Samostatné opt-in živé sady
překladatele, hodnotové věrnosti (+11/−29/0) a A→B→A na témže SHA také
prošly. Rozsah je měřený vývojový scénář, nikoli Gate 0 nebo obecná garance
všech promptů. Starší níže uvedené `LIVE_NOT_RUN` a `PENDING` jsou historické
checkpointy, nikoli současný stav tohoto WP.

**Integrační checkpoint 30. 9. 2026, 23:32 UTC (1. 10. v Praze):** omezený JSON kandidát
`7234f55b` získal nezávislé `REVIEW_PASS`. Společný čistě pushnutý commit
`d2591bc0` zachovává dříve přijaté přepočítání kontextu při `length` retry;
nezávislé integrační review ověřilo na skutečném provider payloadu souhrn,
novější uživatelskou opravu, celý aktuální dotaz, `format: 'json'` při obou
voláních a pokles výstupního limitu 567 → 508 v okně 4096. Registrovaný M1
kontrakt je **73/73 PASS**; sedm cílených sad společného commitu je **7/7 PASS**
(`.intentsmith-artifacts/run-suites/2026-09-30T23-27-43-697Z/report.json`).
Fyzický modelový běh sady 85 po této integraci je stále **LIVE_NOT_RUN**.
Parser ověřuje tvar JSON objektu a vymezené hranice vloženého textu; věcnou
správnost osmi odpovědí může potvrdit až živé orákulum. Níže uvedené
`PENDING` u starších kandidátů jsou historické checkpointy, ne stav
současného integrovaného zdroje.

**Páté review a CRLF hranice (1. 10. 2026):** nezávislé review commitu
`ce94f429` vrátilo **CHANGES_REQUIRED**. Skutečný provider-body test se
zdrojovým nadpisem `Dokument:\r\n`, mezilehlým řádkem a citovaným závěrečným
JSON příkazem i test s otevřeným `` ```text `` blokem při CRLF chybně
aktivovaly `format: 'json'`. Před opravou: **70 PASS / 2 FAIL**. Nový
kandidát normalizuje CRLF a samostatné CR na LF pouze v lokální kopii pro
detekci formátu; původní uživatelský text včetně CRLF zůstává v provider promptu.
Negativní testy a pozitivní test uzavřeného CRLF dokumentu ověřují skutečné
provider body a zachování celého `User: ${input}`. M1 kontrakt po opravě:
**72/72 PASS**. Nezávislé opakované review, integrace a živý modelový běh
jsou **PENDING**. Parser nadále rozpoznává jen vymezenou textovou syntaxi;
obecně spolehlivý formát požaduje strukturovanou autoritu aktuálního tahu.

**Čtvrté review a omezený parser hranic (1. 10. 2026):** review
`c8ea0597` vrátilo **CHANGES_REQUIRED**: čtyřmi mezerami odsazený Markdown
kód se mohl stát JSON pokynem; řádek `Konec citace je jen nadpis v dokumentu.`
neprávem zavřel vložený dokument; naopak `Porovnej hodnoty:` zablokovalo
skutečný následný JSON požadavek. Všechny tři provider-body regrese byly
nejprve červené (`64 PASS / 3 FAIL`). Kandidát `ce94f429` rozlišuje explicitní
nadpis zdroje, úzce vymezený imperativní nadpis číselného úkolu a nejednoznačný
nadpis, který fail-closed ponechá daty; kontroluje otevřené i odsazené Markdown
bloky a uzavírá jen celý odpovídající marker nebo celou výslovnou větu o
vlastním dalším požadavku. S dvěma doplňkovými negativními případy je M1
kontrakt **69/69 PASS**; první i osmý skutečný window-fill tah stále posílají
`format: 'json'`. Interpretace libovolné přirozené řeči tím prokázána není.
Pro spolehlivou obecnou autoritu formátu je vhodný budoucí explicitní údaj
aktuálního tahu v API/UI (např. `responseFormat: json`), validovaný v M1
kontraktu a předaný CRE; jde o návrh, nikoli přijatý požadavek. Samostatná
oprava opakování `done_reason=length` na integrační větvi se musí při sloučení
zachovat. Nové nezávislé review, integrace a fyzický modelový běh jsou
**PENDING**; tento kandidát sám neprokazuje odstranění živého HTTP 502.

**Třetí review a obecná hranice vložených dat (1. 10. 2026):** review
`41193afe` vrátilo **CHANGES_REQUIRED**: nadpisy `Dokument:` a
`Text k analýze:` i otevřený Markdown code fence mohly dát citovanému poslednímu
řádku autoritu JSON formátu. Čtyři požadované provider-body případy včetně
výslovně ukončené citace byly nejprve červené (`58 PASS / 4 FAIL`). Aktuální
kandidát považuje libovolný samostatný nadpis zakončený dvojtečkou a otevřený
Markdown blok za hranici vložených dat; pro zřetelné ukončení citace dovolí
následující vlastní JSON požadavek. Nejednoznačné `Požadavek:` jako nadpis
vloženého textu bylo samostatně červené a také se neaktivuje. Zavřený code
fence dovolí následný vlastní JSON požadavek. M1 kontrakt je **64/64 PASS**;
skutečné `windowFillMessage(1)` i `(8)` dál posílají
`format: 'json'`. Toto je konzervativní textová heuristika, nikoli obecný
sémantický parser všech citací. Nové nezávislé review, integrace a živý modelový
běh jsou **PENDING**.

**Druhé review a oprava citovaného bloku (1. 10. 2026):** review
`0785ac1c` vrátilo **CHANGES_REQUIRED** kvůli třem skutečným vstupům,
v nichž byl poslední řádek stále součástí citace. Nové provider-body testy
na předchozím kandidátu skončily `53 PASS / 3 FAIL`; po kontrole hranice
citace v celém aktuálním USER vstupu dává M1 kontrakt `58/58 PASS`.
Výslovně jsou zelené obě skutečné syntaxe window-fill `windowFillMessage(1)`
a `windowFillMessage(8)`: posílají `format: 'json'` a celý aktuální požadavek.
Původní fixture ani starší živý důkaz se nemění. Opakované nezávislé review,
integrace a živý modelový běh jsou **PENDING**; offline výsledek nepotvrzuje
věcnou kvalitu fyzického modelu.

**Navazující review checkpoint (1. 10. 2026):** první nezávislé review
`f0a8a539` vrátilo **CHANGES_REQUIRED**: běžný kreativní požadavek na krátké
názvy ztratil instrukci v skutečném provider promptu a samostatná citovaná
poslední věta mohla omylem zapnout JSON režim. Oprava ve stejné izolované
větvi obnovuje původní kreativní instrukci a citovaný konec ponechává daty;
obě regrese nejprve selhaly v provider-body testech (`51 PASS / 2 FAIL`) a po
opravě dává M1 chat `53/53 PASS`. Opakované nezávislé review, integrace a
nový fyzický modelový běh jsou **PENDING**.

**Izolovaný kandidát na základně `901babb4` (1. 10. 2026):** živý důkaz
`9c9fdd34` níže ukázal `8/8` správných čísel, ale jen `3/8` odpovědí v
požadovaném syrovém JSON formátu. V aktuální implementaci vybírá výslovný
závěrečný pokyn aktuální USER zprávy režim `format: 'json'` a systémový prompt
bez výkladových odstavců. Handler vrací původní bajty odpovědi pouze tehdy,
jsou-li jediným JSON objektem; chybně zabalený nebo neplatný výstup opakuje
nejvýše dvakrát a poté vrací typovaný terminál `ANSWER_JSON_FORMAT_INVALID`.
Historie, souhrn ani citovaný starší pokyn režim neaktivují. Registrovaný
offline M1 kontrakt původního kandidáta prošel `51/51`, modelová hranice `34/34`,
skutečný M1 HTTP a SQLite fixture test `1/1` s byte shodou provider výstupu;
nový fyzický modelový běh a integrace do společného checkoutu jsou **PENDING**. Tento
test prokazuje formátovací hranici, nikoli věcnou správnost libovolného JSON;
tu nadále hodnotí živé osmikolové orákulum a samostatná fidelity sada.

**Nový živý checkpoint 22:18 UTC na `9c9fdd34`:** přísné orákulum osmi
odpovědí, ochrana uživatelské citace i rozpočtování promptu jsou již
integrované. Celá registrovaná sada má **FAIL 1/1**: její třetí dílčí
scénář dostal HTTP 502 po třech `done_reason=length` při běžném dotazu.
Samotný window-fill scénář dokončil **8/8** dlouhých tahů, překročil
`num_ctx=4096` syrovou historií **5282** tokenů a ušetřil při prvním
souhrnu **316** tokenů. Finální odpověď vrátila přesně auditní kód z
uloženého souhrnu (`mechanismStatus=PASS`). Numerické hodnoty byly **8/8**
správné, předepsaný čistý JSON však splnily jen **3/8** odpovědí, takže
`arithmeticQuality=FAIL`. Soukromý důkaz je
`.intentsmith-artifacts/run-suites/2026-09-30T22-10-04-822Z/`.
Následující historické checkpointy proto nejsou aktuálním verdiktem sady.

**Stav k 30. 9. 2026:** první živý běh na `4a789bb1` ověřil podscénář
naplnění okna `PASS`, celá sada však skončila `FAIL` (3/4) po HTTP 502 u
neúplné CODE odpovědi. Po opravě v `WP-CHAT-ANSWER-TRUNCATION-20260930`
opakovaný běh na `0b0cabdba153b0bebfda8fc06a8a34da11766a30` dokončil
celou sadu `PASS` (4/4), provider capture `PASS` a uvolnil GPU lease. Lokální
reporty jsou `.intentsmith-artifacts/run-suites/2026-09-30T17-31-23-783Z/report.json`
a `.intentsmith-artifacts/run-suites/2026-09-30T17-58-43-582Z/report.json`.
Na navazujícím čistém `09247504143ac0a37d75d7d52867768447790ad2`
prošla sada také `4/4`, provider capture `PASS` a GPU lease se uvolnil;
report je `.intentsmith-artifacts/run-suites/2026-09-30T18-51-43-442Z/report.json`.
Registr nadále nemá `lastGreen`; běhový režim není release Gate 0.

**Aktuální checkpoint po živém běhu `c25174a4` (30. 9. 2026):** celá sada
skončila **3/4 PASS, 1 FAIL**, provider capture **FAIL** a její window-fill
podscénář **FAIL**. Syrová historie dosáhla 4579 odhadovaných tokenů při
`num_ctx=4096`; první souhrn v tahu 6 snížil stejný snapshot o 446 tokenů.
Souhrn i poslední provider prompt obsahovaly `RIGEL_KAPPA_731`, ale model
odpověděl dlouhým odmítnutím a nesplnil požadavek „pouze kódem“.
Cyklus skončil po sedmi aritmetických odpovědích; ve čtvrté uvedl hodnoty
66 a 55, přesto označil 55 za vyšší a neuvedl správný rozdíl 11.
Jde o **mechanismus doložený jen po dílčích kontrolách, věcnou kvalitu FAIL**,
nikoli o přejímku chatu. Důkaz je v soukromém
`.intentsmith-artifacts/run-suites/2026-09-30T20-42-23-470Z/`.
Izolovaný kandidát na této větvi vyžaduje osm dokončených kol, přesný
aritmetický výsledek každého z nich a oddělené technické a věcné verdikty;
jeho nový živý běh je **LIVE_NOT_RUN / REVIEW_PENDING**. Ověření souhrnu v
kandidátovi očekává také deterministickou citaci původního USER údaje podle
navazující opravy auto-contextu `b9be61ad`; společný živý běh vyžaduje
integraci a nezávislou přejímku obou změn.

**Autorita:** explicitní zadání operátora z 2026-09-30 ověřit chat po
naplnění kontextového okna a automatické zkrácení kontextu. Produktové chování
plyne z existujícího auto-contextu; tento WP nepřidává novou politiku uchování.

**Vstup a integrace:** větev `work/real-chat-journeys-20260930` vznikla z
`origin/main` `838b8cee038db027691072d293eb00153854f81e`. Opravy promítání
summary a počítání krátké historie z větve `work/intent-resilience-20260928`
jsou integrovány do kandidáta `4a789bb1`. Tehdy otevřenou mezeru asynchronní
sumarizace krátkých zpráv řeší navazující
`WP-CHAT-CONTEXT-RETENTION-20260930`; integrovaná oprava `88a7f91a` +
`222793c6` má omezené nezávislé review a živý běh na `09247504`.

**Výsledek pro uživatele:** při konverzaci, jejíž původní historie přesáhne
skutečně odeslané `num_ctx` a jejíž efektivní historie s režijní rezervou
překročí práh auto-contextu, zůstane počáteční důležitý fakt dostupný po
zkrácení kontextu.
Starší historie musí být shrnuta a efektivní počet tokenů klesnout. Celý
původní dialog zůstane persistovaný.

**Rozsah a vlastnictví:** původní scénář vlastnil
`tests/e2e/85-long-session-degradation.e2e.js` a tento WP. Navazující
orákulum přidává testovou faktovou sadu v `scripts/chat85-window-values.js`,
kontrolu attestace v `scripts/provider-capture.js` a její offline test v
`tests/provider-capture-proxy.test.js`. Neměnit modelový profil, produkční
data, bindings ani cizí GPU práci.

**Demonstrace a test:** existující registrovaná modelová sada
`IS-T3-E2E-85-LONG-SESSION-DEGRADATION` pošle přes skutečné HTTP přesně osm
obsahově různých delších tahů a případně devátý po cooldownu. Předem známý
auditní kód je pouze v prvním tahu. Opt-in runner zachytí skutečné požadavky
a terminální odpovědi `/api/chat` v soukromém JSONL artefaktu. Test porovná
identitu CHAT modelu, skutečné `num_ctx` a `prompt_eval_count` s historií API;
vyžaduje překročení `num_ctx` v úplné uložené historii a překročení spouštěcího
prahu z nejvýše 10 tehdy dostupných zpráv plus stejné 1500tokenové rezervy,
kterou používá `maybeCompact`. `prompt_eval_count` zaznamená skutečné využití
provideru, ale není totožné se spouštěcím odhadem: `buildAnswerContext` záměrně
rezervuje místo pro odpověď a omezuje historii. Test ověří, že background
compaction uložila summary pokrývající první zprávu, zachovala kód a při
prvním dokončení snížila efektivní historii vůči témuž snapshotu bez summary.
Zachycená ANSWER odpověď providera se musí přesně rovnat HTTP odpovědi a
metadata musí potvrdit stejný model, `num_ctx` i skutečný výstupní limit
`num_predict`. Závěrečný zachycený provider
prompt musí obsahovat summary i kód, avšak původní první zpráva a její
nesouhrnný prostřední řádek už v něm nesmějí být. Závěrečná otázka kód nesmí
opakovat; model musí odpovědět přesně samotným kódem, jak uživatel požádal.
Osm aritmetických otázek nově žádá jediný JSON objekt se skutečnými
kalibracemi `a`, `b`, podepsaným rozdílem `delta=a−b` a směrem `higher`.
Pevné očekávané dvojice jsou 73/62, 33/22, 106/95, 66/55, 26/15, 99/88,
59/48 a 19/8; pro všechny platí rozdíl +11 a vyšší první položka.
Test kontroluje přesné hodnoty a formát každého tahu včetně případného
devátého retry, pokračuje i po jednotlivé špatné odpovědi a do artefaktu
ukládá `mechanismStatus` odděleně
od `arithmeticQuality`. Celkový `PASS` vyžaduje obojí. Attestace ověřuje
všech osm odpovědí proti zachyceným provider voláním. Osm kladných případů
neprokazuje správnost záporného nebo nulového rozdílu; ty mají samostatnou
opt-in sadu `tests/chat-value-fidelity-live.test.js`. Volný text souhrnu
zůstává věcně nehodnocený mimo kritický kód; test ověřuje dokončený provider
výstup, přesně uložený modelový text s doslovnou citací z původní USER
zprávy a jejím `messageId`, pokrytí první zprávy a dostupnost kódu po
kompakci. Runner znovu ověřuje oba SHA zachyceného sumarizačního volání,
`done_reason=stop`, marker souhrnového promptu a přesnou výslednou kompozici.
Průběh, odpovědi, snapshot DB a délka se SHA256 úplného JSONL prefixu se uloží před
odstraněním izolované konverzace do privátního artefaktu s právy `0600` i při
selhání. Pozdější řádky background sumarizace zůstanou v surovém záznamu a
runner musí ověřit beze změny právě uložený prefix. Použitý příkaz:

```sh
node scripts/run-suites.js --suite=IS-T3-E2E-85-LONG-SESSION-DEGRADATION --capture-provider --timeout-scale=2 --keep-run-root
```

Před GPU během musí skončit cizí hodnocení a projít kontrola zámku, Ollamy,
NVIDIA procesů a přesného modelového digestu. Capture runner je popsán v
`WP-CHAT-PROVIDER-CAPTURE-20260930`; jeho izolovaný fake-upstream self-check
nenahrazuje modelový běh. Po každé produktové opravě se živá sada opakuje na
novém přesném SHA; offline kontroly nejsou modelový `PASS`.
Všechny tahy sady nyní propagují časový limit testu do HTTP a čekání; interní
deadline nastane 15 sekund před záložním limitem harnessu, aby po timeoutu
nepokračoval předchozí modelový request souběžně s dalším testem. Zdvojený
limit celé sady pokrývá i pomalé modelové odpovědi.

**Stop condition:** `FAIL` při ztrátě kódu, chybějícím summary, neúspoře
tokenů, neshodě skutečného provider requestu nebo chybě modelové odpovědi;
`BLOCKED` jen při doložené chybě
prerekvizity. Tento scénář neprokazuje paměť přes více než 50 starších tahů,
restart ani kvalitu shrnutí u jiných témat; to jsou samostatné acceptance
scénáře. Nezměnit registr `lastGreen` z lokálního běhu.

**Naměřený rozsah druhého běhu:** syrová uložená historie měla 4602 odhadovaných
tokenů při skutečném `num_ctx=4096`; efektivní historie před souhrnem měla
3315 tokenů a s režijní rezervou 1500 překročila 75% práh. První dokončený
souhrn při šestém tahu snížil stejný snapshot o 303 tokenů (3267 → 2964).
Finální provider prompt neměl syrovou první zprávu, ale obsahoval souhrn a
počáteční auditní kód; model vrátil přesný kód, `prompt_eval_count=1638`.
Zachycené sumarizační requesty však opakovaně skončily `done_reason=length`
na tehdejším 500tokenovém limitu a tehdejší kód přijal jejich neprázdný obsah.
Navazující oprava v `WP-CHAT-CONTEXT-RETENTION-20260930` takové souhrny
odmítá a dovoluje v rámci existujícího limitu 1 000 výstupních tokenů.
Tento starší PASS potvrzuje jen uvedený kontrolní kód na SHA `0b0cabdb`.

**Třetí běh na `09247504`:** syrová historie měla 4628 odhadovaných tokenů
nad `num_ctx=4096`; efektivní historie před souhrnem dosáhla 3314 tokenů
plus 1500 rezervy. První dokončený souhrn při šestém tahu snížil stejný
snapshot z 3283 na 2854 tokenů, tedy o 429. Finální provider prompt
obsahoval uložený souhrn a kód, ale ne původní první zprávu ani její
nesouhrnný prostřední řádek; `prompt_eval_count=1653`. Finálně uložený
souhrn se přesně shodoval s terminální odpovědí zachyceného provider volání
`done_reason=stop`. Model však vrátil `Auditní kód RIGEL_KAPPA_731.` místo
požadovaného samotného `RIGEL_KAPPA_731`. Dřívější orákulum kontrolovalo
jen výskyt kódu, proto tehdejší `4/4 PASS` dokládá dostupnost faktu po
kompakci, nikoli dodržení přesného formátu. Nové orákulum kontroluje rovnost
odpovědi po odstranění okolních mezer a zachycuje skutečné `num_predict`;
běh s tímto přísnějším orákulem je
`LIVE_NOT_RUN`. Soukromý důkaz z třetího běhu zůstává mimo Git na uvedené
cestě pod `artifacts/85-window-fill-evidence.json`.
