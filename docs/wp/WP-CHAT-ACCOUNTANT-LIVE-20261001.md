# WP — účetní DPH přes skutečné M1 a ověřený nástroj

**Stav:** izolovaný testový kandidát `80990a60` získal omezené nezávislé
`REVIEW_PASS`; sada je integrovaná od `5d72b4aa`. Tři fyzické modelové běhy
na `84f22982`, `299d8117` a `46ca3dcc` jsou **FAIL**: nejdříve uříznutý
disclaimer, potom nepodložený § 38 a časová spekulace. Oprava orákula na
`46ca3dcc` má omezené nezávislé `REVIEW_PASS`; nová deterministická
prezentace VAT nástroje je `REVIEW_PENDING` / `NOT_DEPLOYED`. Vstupní čistý
integrační commit `8bf1c069ae87007773d1f196c8680b21c56bd083`.
Lokální zelená orákula nejsou modelový ani release důkaz.

Původní požadavek na jeden generativní provider tah v oddílech níže je
historie tří odmítnutých modelových pokusů. Platný nový VAT kontrakt je v
závěrečném oddílu „Opakované sémantické FAIL a změna akceptační cesty“.

**Autorita a rozsah:** operátor žádá fyzické ověření vybraného specialisty
`accountant-cz` přes skutečný M1 HTTP chat a privátní SQLite na jediném vstupu:
základ 10 000 Kč, DPH 21 %, rok 2025, ČR. Uživatelská M1 hranice plyne z
`PRODUCT.md` §2 a `CONTRACT.md` §4. Kandidát navazuje na řízený účetní průchod
v `WP-CHAT-ACCOUNTANT-HTTP-20261001`. Vlastní větev a worktree:
`work/chat-accountant-live-20261001` a `intentsmith-chat-accountant-live-20261001`.
Produkční server, instalovaná DB, daňová pravidla a modelová vazba se nemění.

**Vlastněné cesty:** `tests/chat-accountant-live.test.js`, společný účetní
oracle `tests/helpers/chat-accountant-vat-oracle.js`, jeho negativní sada
`tests/chat-accountant-vat-oracle.test.js`, úzké sdílení s existujícím
`tests/chat-accountant-model-contract.test.js`, registr a odvozené počty.
Nový test používá stávající `scripts/provider-capture.js` a globální
`gpu-evaluation-lock`; nepřidává paralelní modelovou cestu.

## Průchod a orákulum

Test před GPU ověřuje přesný čistý source SHA a explicitní
`INTENTSMITH_CHAT_ACCOUNTANT_LIVE=1`; přímý běh navíc vyžaduje
`KEEP_TEST_RUNTIME=1`. Drží globální GPU lease, ověří bez cizího NVIDIA
compute a Ollama rezidenta, dostupné prostředky, `qwen3.5:27b` s přesným
instalovaným digestem
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`
a zprostředkuje model přes soukromou loopback capture proxy. Vlastněný
`src/server.js` má oddělené adresáře a SQLite.

Přes HTTP musí najít a vybrat `accountant-cz`, poslat jediný
`ConversationCommand` a získat právě **jedno dokončené** modelové volání
`/api/chat`: HTTP 200, `done=true`, `done_reason=stop`, kladné prompt tokeny,
`num_ctx <= 4096`, přesný model a povolený digest. Capture zaznamená SHA256
syrových request/response bajtů dřív, než odpověď dojde produktu. Terminální
`message.content` musí být přesně shodný s finálním M1 textem; další provider
volání znamená selhání.

Stejný sdílený oracle jako řízený M1 test požaduje metadata
`executionStatus=SUCCESS`, `accountant.vat_calculator`, přesné parametry
`{amount:10000,year:2025,rate:'21',direction:'add'}` a strukturovaný
výsledek `base=10000, vat=2100, total=12100, rate_percent=21, year=2025`.
Finální provider prompt musí obsahovat tento skutečný tool výsledek, ne jen
uživatelské číslice. Věcný oracle ve finální odpovědi vyžaduje správně
označený základ, DPH a cenu s DPH, sazbu, rok a ČR, oddíly „Předpoklady“ a
„Nezahrnuje“ a povinnou formulaci upozornění na nezávaznou daňovou radu a
konzultaci poradce. HTTP historie i přímý read-only SQLite dotaz musí mít
právě uložený uživatelský vstup a shodný asistenční text.

Negativní offline mutace odmítají chybné tři částky, dvě částky DPH v jedné
větě i prohozené štítky základu a DPH v jednom souvětí, sazbu, rok, jurisdikci,
chybějící oddíly nebo disclaimer, nedokončený/cizí provider, jiný M1 text,
prázdný seznam omezení, pozdní větu za disclaimerem, protichůdnou další
částku DPH, chybějící tool prompt a chybný strukturovaný VAT výsledek. Parser
pro tento scénář svazuje každou měnovou částku s příslušným štítkem a odmítá
nejednoznačné vícenásobné částky v jeho úseku napříč celou finální odpovědí,
včetně „Předpoklady“ a „Nezahrnuje“. Citovaná rozporná částka nemá obecnou
výjimku; oracle ji z opatrnosti odmítne. Jde o ohraničený výpočet, ne obecný
hodnotitel daňových rad.

**Důkazové hranice:** validní provider řádek a přesný HTTP/SQLite výsledek
vzniknou pouze při úspěchu. Soukromý JSON se stavem
`AUTOMATED_CHECKS_PASS_REVIEW_PENDING` vzniká
až po zastavení serveru i proxy a uvolnění lease; váže source SHA, model,
instalovaný digest, verzi providera, capture SHA a VAT orákulum. Pokud
obsloužený model nevrátí vlastní digest, capture váže jeho jméno a preflight
instalovaný digest, nikoli nezávislý digest obsloužené instance. Sada je v
registru `BLOCKED`/GPU opt-in. Jeden fyzický běh by neprokázal obecnou
správnost daňových rad, opakovatelnost ani mobilní klienta.

**Bezpečné přípravné ověření:** pouze offline oracle, řízený M1 účetní test,
validace registru, dokumentační kontrola a `node --check` živé sady.
První negativní oracle s pouhou kontrolou typu odpovědi skončilo podle
očekávání `Missing expected exception: VAT amount`. Po doplnění hodnotových
kontrol offline sada prošla **2/2**, existující řízený M1 účetní test po
sdílení orákula **2/2**, dokumentační validace **160/160**, syntaxe živé sady
a registr **582** programů prošly. Vynucený neopt-in běh skončil ještě před
lease jako `LIVE_NOT_RUN` (záměrná negativní kontrola). Fyzický Ollama běh
zatím **neproběhl**.

Nezávislá revize kandidáta `afb73b05` vrátila **CHANGES_REQUIRED**: starý
oracle falešně přijal dvě různé částky DPH v jedné větě i prohozené štítky
základu a DPH ve stejném souvětí. Přímé opakování obou přesných mutací na
`afb73b05` dalo `FALSE_GREEN` a samostatná negativní regrese na první případ
byla na starém orákulu červená (`Missing expected exception`). Nová
verze ověřuje jedinečnou částku za každým štítkem; oba konkrétní případy
odmítá a přímé offline testy orákula **4/4** i řízeného M1 **2/2** procházejí.
Oprava zůstává `REVIEW_PENDING`, živý model stále `LIVE_NOT_RUN`.

Druhá nezávislá revize `67d229a5` vrátila **CHANGES_REQUIRED**: explicitní
`- DPH je 2 200 Kč.` v oddílu „Předpoklady“ starý rozsah vůbec nečetl.
Red-first regrese měla na `67d229a5` **2 FAIL** pro rozpornou DPH v
„Předpoklady“ a rozpornou celkovou cenu v „Nezahrnuje“. Opravený oracle
prochází celý finální text; přímé offline testy mají **6/6**, řízený M1
**2/2**. Nezávislé re-review této nové opravy stále čeká.

Třetí revize `9a59bc05` našla další **CHANGES_REQUIRED**: prefixové
`Výsledná daň je 2 200 Kč.` či `Zaplatíte 2 200 Kč.` zůstaly před prvním
rozpoznaným štítkem; vedle správné odpovědi prošly i protichůdné `12 %`,
`2024` a `Slovensko` v prefixu nebo oddílu „Předpoklady“. Red-first sada
měla na `9a59bc05` **8 FAIL / 8 PASS**. Nynější úzký kontrakt vyžaduje,
aby každá explicitní `Kč`/`CZK` částka měla odpovídající štítek ve stejném
úseku věty a přesnou hodnotu; každé číselné procento musí být 21 a každý
čtyřciferný rok mimo měnové částky 2025. Odpověď musí jmenovat ČR/Česko;
jiné explicitní jurisdikce z českého ICU seznamu zemí a běžných českých
skloňování odmítá. Pozitivní kontrolovaná odpověď zůstává platná, přímá
sada nyní **22/22**, řízený M1 **2/2**. Volný jazyk mimo tyto explicitní
tvary není obecně rozhodnutelný tímto orákulem; re-review a fyzický modelový
běh jsou stále otevřené.

Čtvrté nezávislé review `e4a9d3b6` vrátilo **CHANGES_REQUIRED** pro šest
nových falešně zelených mutací: `2 200 korun`, `12 procent` a ISO `SK`, vždy
v prefixu i v „Předpoklady“. Dvě další negativní mutace ověřují neznámé
arabské číslo bez jednotky. Red-first sada měla na původní verzi **8 FAIL**.
Nový kontrakt rozpozná také `korun(a/y)` a `procent(a/o/u)`, odmítne cizí
dvoupísmenný ISO kód a po odečtení přesných měnových částek, sazeb a roku
odmítne jakoukoli zbývající arabskou číslici. Přímá syntetická sada nyní
**30/30**, řízený M1 **2/2**. Oracle je záměrně přísný pro jedno DPH zadání;
není úplnou sémantickou validací volného textu. Každá fyzická modelová
odpověď i s nástroji a perzistencí se proto musí navíc ručně přečíst a
vyhodnotit; žádný fyzický běh se dosud nespustil.

Pátá nezávislá revize `39467a51` vrátila **CHANGES_REQUIRED**: záporné
`DPH je -2 100 Kč.` a `DPH -21 %` měly kladnou hodnotu kvůli ignorovanému
znaménku; `DPH není 2 100 Kč.` a `Pro ČR tato sazba neplatí.` prošly kvůli
ignorované negaci. Všechny čtyři konkrétní výroky byly před správnou
odpovědí i v „Předpoklady“ falešně zelené: red-first sada **8 FAIL / 30 PASS**.
Oracle nyní čte znaménko částky i sazby a odmítá explicitní „není“ či
„neplatí“ v téže klauzuli jako DPH nebo českou jurisdikci. Přímá sada má
**38/38**, řízený M1 **2/2**. Tato syntetická oprava ještě vyžaduje nezávislé
re-review a ruční věcnou kontrolu případné fyzické odpovědi. Živý model je
nadále **LIVE_NOT_RUN**.

Historický živý příkaz pro odmítnutou generativní VAT cestu (nyní nepoužívat):

```sh
export PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH
INTENTSMITH_CHAT_ACCOUNTANT_LIVE=1 KEEP_TEST_RUNTIME=1 \
  INTENTSMITH_TEST_SOURCE_REVISION=$(git rev-parse HEAD) \
  node --test tests/chat-accountant-live.test.js
```

Privátní capture a evidence zůstávají ignorované v `.intentsmith-artifacts/`.
Na finálním izolovaném `80990a60` nezávislý reviewer zopakoval negativní
orákula a uzavřel omezené `REVIEW_PASS`; přímá offline sada měla **38/38**
a řízený M1 účetní průchod **2/2**. Integrace `5d72b4aa` prošla celým
offline/database profilem **402/402 PASS, 0 BLOCKED**
(`.intentsmith-artifacts/test-runs/2026-10-01T01-41-43-923Z/report.json`),
registr má **583** programů. Tento výsledek předchází pozdější produktové
opravě specialisty `1303535f` a neprokazuje fyzickou kvalitu DPH odpovědi.
Nový živý běh po opravě musí vzniknout z čistého integrovaného source SHA;
jeho finální text navíc vyžaduje ruční věcnou kontrolu.

## První fyzický FAIL a úzká oprava 1. 10. 2026

Na čistém a pushnutém `84f22982` použil účetní jediný skutečný provider
`/api/chat`: `qwen3.5:27b`, připnutý digest, `num_ctx=4096`,
`prompt_eval_count=1118`, `num_predict=256`, `eval_count=256`,
`done_reason=length`. Odpověď skončila uprostřed povinného disclaimeru.
M1 správně vrátil HTTP **502 `MODEL_RESPONSE_TRUNCATED`**; privátní SQLite
obsahuje jen jednu uživatelskou zprávu a žádnou asistenční. Test je **FAIL**,
nikoli `LIVE_NOT_RUN` ani účetní PASS. Původní soukromá capture je
`.intentsmith-artifacts/direct-tests/chat-accountant-live.test-waYVes/artifacts/chat-accountant-live-provider.jsonl`.

Red-first řízený M1 provider, který vrací `length` při nedostatečném výstupním
rozpočtu, dal před opravou **1 FAIL / 1 PASS**. Produktový wrapper nyní žádá
512 tokenů pouze pro `accountant.vat_calculator`; ostatní expertizy mají
svůj původní limit a `done_reason=length` zůstává terminální chybou.
Řízený M1 test po opravě prošel **2/2**.

Samostatná sémantická kontrola před opravou falešně odmítala číslo zákona
`235/2004` přenesené ze skutečného výsledku VAT nástroje jako údajný rok a
Markdown nadpisy `**Předpoklady:**` / `**Nezahrnuje:**`. Úzká oprava
povoluje jen přesnou citaci v tomto kontextu a maskuje ji před kontrolou
roku i negace; jiná neznámá čísla a negované tvrzení za citací zůstávají
FAIL. Red-first nová pozitivní kontrola měla **1 FAIL / 38 PASS** a
negativní kontrola negace za citací znovu **1 FAIL / 39 PASS**. Synteticky
dokončená skutečná tabulka z capture i negativní mutace částek, sazby,
období, zákona a disclaimeru nyní procházejí **40/40**. Šest sousedních
direct sad účetního, překladatele, projektové expertizy, veřejné hranice a
hodnotové věrnosti prošlo **49/49**. Oprava je připnutá na `a6ea1c85`;
požadováno je nezávislé review delty a fyzický běh. Z offline oprav se nový modelový
výsledek neodvozuje.

## Opakované sémantické FAIL a změna akceptační cesty

Na čistém `299d8117` dokončená odpověď správně počítala DPH, ale přidala
`§ 38` bez opory v nástroji; na čistém `46ca3dcc` po omezení právních citací
model přidal časově zavádějící výrok o legislativě po roce 2026 pro období
2025. V obou případech byl M1 transport HTTP 200, ale věcný oracle **FAIL**.
Soukromé capture jsou v
`.intentsmith-artifacts/direct-tests/chat-accountant-live.test-YNhG4e/`
a `.intentsmith-artifacts/direct-tests/chat-accountant-live.test-eA6qoK/`.
Oprava false-red citace mezi štítkem a částkou na `46ca3dcc` dostala
nezávislé omezené `REVIEW_PASS`; oba modelové výsledky zůstávají odmítnuté.

Kalkulačka DPH nyní dostává `renderResult` jako existující deterministický
daňový nástroj. Renderer ověří strukturované částky, haléře, sazbu, rok,
směr, assumptions a soulad se vstupními parametry; výstup má jen potvrzené
částky, fixní omezení rozsahu a disclaimer. Explicitní nepodporovaný rok musí
selhat uzavřeně. Veřejná M1 metadata zveřejní jen povolené číselné výsledky
a scalar parametry. Nový `tests/chat-accountant-deterministic-http.test.js`
nahradí původní live modelovou sadu: musí projít skutečným M1 a vlastní
SQLite, ověřit přesně **0 generativních provider `/api/chat` volání**,
`deterministicPresentation`,
vazbu na nástroj, finální text a chyby bez generativního fallbacku. Historický
požadavek na jediný terminální modelový tah pro VAT už není platný. Skutečné
modelové chatové scénáře projektů, expertiz a kontextu se měří samostatně.
Tato náhrada není přijatá, dokud neprojde čistým registrovaným během a
nezávislou revizí.

Řízený M1/SQLite průchod deterministické cesty, restart a persistence, přímá
expertiza po CRE, negativní extrakce a orákulum na pracovním kandidátu
1. 10. 2026, 02:45 UTC prošly **69/69**. Samostatný účetní balíček má
**27/27**. První souběžný běh restartového testu byl **FAIL** kvůli chybné
testové aserci, která považovala opožděné startup `POST /api/show` a
`GET /api/tags` za generativní tah. Aserce teď povoluje pouze tyto dva
inventory endpointy a dál odmítá jakékoli `/api/chat` či jiné inference
volání; opakovaný běh je **69/69 PASS**. Zdroj ještě není čistý commit,
nezávisle revidovaný ani nasazený.

Nezávislé review prvního čistého `2cff545a` vrátilo `CHANGES_REQUIRED`:
negované přidání a odečtení DPH skončilo `SUCCESS` a uloženou chybnou
odpovědí; úplný profil našel chybný směr „cena bez DPH z 12100“. Po
red-first M1 regresích opravený pracovní kandidát zastaví negaci cíleným
dotazem a rozpozná cenu bez DPH *z* celkové částky jako `remove`.
Cílené sady nyní **73/73**, specialist runtime **24/24** a harness meta-test
PASS. Opakovaný čistý plný profil a nezávislé review ještě čekají.

Druhé review čistého `365ed339` vrátilo `CHANGES_REQUIRED`: ještě
„Neprováděj výpočet DPH“ a „Nespočítej DPH“ se změnily v uložený výpočet.
Nová červená M1 regrese doložila obě chyby. Širší konzervativní detekce
negace, pozitivní testy neutrálních slov a sazby mezi `DPH` a `z` nyní
procházejí **79/79** v pracovním stromu. Celý profil a nezávislé re-review
této nové opravy ještě chybí.

Třetí review `0ddc9773` našlo další skutečný negovaný účinek: „Bez
výpočtu DPH z 10 000 Kč mi pouze vysvětli sazbu“ přesto vrátilo a uložilo
DPH 2 100 Kč. Dvě red-first M1 regrese byly FAIL. Opravený pracovní
kandidát se cíleně ptá, zda má počítat, nebo vysvětlovat; nevydá VAT
výsledek ani modelový fallback. Cílené M1/SQLite/oracle testy **82/82**.
Čistý commit, úplný profil a nezávislé review zůstávají otevřené.

Čtvrté review `a41d6885` odmítlo nechtěný výpočet u „Jen mi řekni,
jak funguje DPH …“. Po red-first M1 regresi se výpočet spouští pouze
pro kladný pokyn nebo přesný zkrácený kalkulační tvar začínající `DPH …`
či `cena bez DPH z …`; vysvětlení se ptá bez výpočtu. Cílené
M1/SQLite/oracle sady **85/85**, starší loader **294/294** a session
context **66/66**. Čistý commit, plný profil a re-review čekají.
