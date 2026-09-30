# WP — skutečné naplnění okna a auto-context v živém chatu

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
