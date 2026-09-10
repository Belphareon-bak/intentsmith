# WP-CORE-COMPLETION-20260909 — uzavření technické integrace

Autorita: operátor v tomto běhu přijal postup dokončení core 1.0 před samostatným
M7 releasem a výslovně zadal „souhlasim, pust se do toho“. Tento WP vymezuje
provedení přijatého zadání; nezakládá další produktové požadavky.

## Výsledek a rozsah

Jeden integrační kandidát s uzavřeným review dosavadního mobilního merge,
potřebné M7 follow-up delty a konkrétních nálezů blokujících důvěryhodné
ověření. Zachovat M5/M6/M7 acceptance hranice a odložené živé modelové běhy.

- Vstup: `2f11e91117cfeb08c926cb2d94e4888c06f5426c`, měřený merge `f7f78d5a`.
- Převzatá delta: `f812259d..0b0a4669902dfed2a3573f3090c32644711e07ca`;
  produktové commity `f3a8753e` a `9ae1a516`, samostatné nezávislé review.
- Jediný writer: Codex integrátor v existujícím
  `/home/belphareon/worktrees/is-mobile-completion-20260908`,
  větev `work/mobile-completion-20260908`. Revieweři jsou read-only.

Vlastněné cesty: soubory přesné slučované delty; související
`scripts/mobile-release-artifact-binding.mjs`, `src/security/privacy-scan.js`
a existující focused testy; tento WP, nové run/review důkazy a aktuální stav
v `ROADMAP.md` / `SYSTEM-MAP.md`. Connector zůstává existující M7 runtime
configuration a Android artifact binding; bez nového wire kontraktu.

## Demonstrace a ověření

- Přesný deklarovaný public credential filename nezpůsobuje secret finding;
  skutečné credential literály ve stejném souboru a distribuovaných kořenech
  zůstávají FAIL bez vypsání hodnot.
- Renderer odmítá newline/specifier/zone injection před výstupem; běžný VPN
  unit projde `systemd-analyze --user verify` bez instalace nebo aktivace.
- Android source manifest váže skutečně zabalený M7 index a odhalí jeho změnu.
- Registry a inventář odrážejí sjednocený strom; sealed Gate 0 drift zůstává
  pravdivě pojmenovaným vývojovým FAIL, bez nového release ratchetu.
- Na připnutém čistém commitu focused boundary testy, mobile/browser a
  fresh-clone offline/database profil; podle změněných Android vstupů znovu
  explicitně throwaway build a kontrola skutečných APK/AAB bytes.

Příkazy: `node --test tests/m5-privacy-remediation.test.js`,
`node tests/m7-vpn-runtime-config.test.js`,
`node tests/mobile-android-release.test.js`, `npm run test:mobile`,
`npm run test:mobile:browser`, `npm run test:registry`,
`npm run test:deterministic`, `node scripts/scan-m5-privacy.js`,
`git diff --check`. Full profil používá pouze již deklarované lokální
toolchain autority a samostatný artifact root; žádný živý model/GPU.

## Hranice a stop condition

Bez cizích změn, přepisu historie, produkčních klíčů, rotací externích účtů,
aktivace služeb/VPN/firewallu, telefonu, podpisových receipts nebo publikace.
Nález měnící schválené chování, L0 nebo potřebující dosud neudělenou externí
autoritu zastaví jen závislou práci. Stav a výsledek jsou v existující roadmapě,
mapě systému a run/review evidenci; tento WP se nepoužívá jako další board.

## Výsledek 2026-09-09

Technický rozsah uzavřen na `70eef905b9f779958a5ce908d6ed03fac53602f9`:
`SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL / NOT_RELEASE_READY`.
Nový čistý full běh 351 PASS / 1 sealed-registry FAIL; mobile 47/47, browser
24/24, skutečný throwaway APK/AAB a nezávislé review oprav prošly.
[Run evidence](../execution/runs/core-completion-20260909.md) a
[review výsledek](../review/2026-09-09-CORE-COMPLETION-REVIEW.md) drží přesné
identity, raw neúspěchy a zbývající závislosti. Provider activation návrh je
připravený; technické povolení nezměnilo provozní/živé modelové omezení.

## Navazující autorizovaný krok — 2026-09-09

Operátor následně odpověděl „ano potvrzuji“ na konkrétní návrh nasazení
Ollamy, restartu systémové služby a sériového modelového ověření M6. Tím
pro tento postup končí předchozí odklad živých LLM běhů. Schválené jsou přesné
binary/drop-in identity, backup/rollback a zachování modelů, bindings a
historie podle [provozního návrhu](../execution/runs/m6/core-provider-activation-proposal-20260909.md).
Skutečná autentizace správce se tím nenahrazuje.

Navazující owned rozsah: staged instalační/qualification skripty a jejich
raw evidence; minimální oprava prokázaného zastaralého role-config oraclu v
`tests/e2e-pipeline.test.js`; nutný census a run/review stav. Autoritou modelů
zůstává přijatá sedmirolová konfigurace a její M1 bootstrap test. Živé role
se nesmějí změnit proto, aby vyhověly zastaralému testu. Kvalifikace gateway
použije pouze soukromou kopii DB a typed writer; produkční server startup
s automatickou rehydratací je samostatně vyhodnocený následný krok.

Stop condition: drift připnutých souborů, cizí GPU/Ollama práce nebo chybějící
skutečná admin autentizace zastaví závislou operaci. M5 rotace/custody/history,
M7 síť/klíče/zařízení a release podpisy zůstávají mimo tuto autoritu.

Při přípravě se reprodukovala podporovaná upgrade regrese modelové politiky:
uznané M1/061 schéma zůstává po aktuálních migracích pro typed reader/writer
nepoužitelné. Přijatý opt-in kontrakt Decision 020 tím není naplněný. Tento
technický follow-up proto zahrnuje `src/db/model-policy.js`, existující policy
suite a přesnou historickou 061 fixture. Oprava musí zachovat obě uznaná
schémata, jejich vlastní pořadí zápisu, optimistic revision, auditní historii
a odmítnutí neznámého/neplatného stavu. Ověření: původní kód se stejnými
regresemi FAIL; opravený typed zápis/reset a rollback na fixture i soukromé
kopii skutečné DB PASS; settings/coordinator regresní sady a nezávislé review.
Živé policy hodnoty ani historické události se v tomto kroku nemění.

## Výsledek navazujícího kroku

Produktový kandidát `a71e5b98a319416c5b74e0be65b0a5f6f74586eb` obsahuje
nezávisle přijatou kompatibilitu model-policy 061/066 a opravu role-config
testu. Fresh-clone deterministic: 351 PASS / 1 sealed-registry FAIL, exit 1.
Jde o `SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL`; M6 acceptance
zůstává otevřená. [Run](../execution/runs/m6/provider-activation-20260909.md)
a [review](../review/2026-09-09-PROVIDER-AND-POLICY-COMPATIBILITY-REVIEW.md)
uchovávají přesné identity, pozitivní i negativní důkazy.

Před terminálovým pokusem byl stav provider aktivace: `OPERATOR_AUTHORIZED / ADMIN_AUTHENTICATION_BLOCKED /
NOT_INSTALLED`. Autorizovaný `pkexec` skončil `Not authorized`, exit 127;
instalační root bootstrap nezačal. Původní service/binárka/modely/DB zůstaly
zachované. Závislé živé modelové běhy jsou `NOT_RUN`; user-owned terminálový
launcher je připraven pro skutečné ověření správce bez dalšího souhlasu.

**Navazující skutečný pokus 12:20 UTC:** terminálová autentizace prošla,
ale v1 chybně očekávala `0.32.14.1` místo naměřené
`0.32.14-intentsmith.1`; proběhl ověřený rollback. Retained candidate je
neaktivní, původní service 0.32.14 běží. Opravená v2 a její bezpečné reuse
prošly nezávislým review a 19 cílenými kontrolami. Grafický retry čekající na
autentizaci byl ukončen před bootstrapem; reviewed terminálový launcher v2
je připraven. Aktuálně `RETRY_REVIEW_PASSED / ORIGINAL_SERVICE_RESTORED /
SYSTEM_PROVIDER_BLOCKED`; inference stále `NOT_RUN`. [Přesná navazující
evidence](../execution/runs/m6/provider-activation-20260909.md).

**Dokončený provozní checkpoint 12:38–12:42 UTC:** druhý terminálový pokus
úspěšně aktivoval přesný systémový provider bez změny target inode/bytes
nebo devítimodelového inventáře. Nezávislé health review prošlo. Dvě následné
řízené chat operace na clean `ceb8de93` prokázaly exact response digest a
usage/durable claims v soukromé DB; nezávislé evidence review prošlo. Aktuálně
`ACTIVATION_HEALTH_REVIEW_PASSED / CONTROLLED_GATEWAY_REVIEW_PASSED`.
Historické auth/version/Node ABI neúspěchy zůstávají v run evidenci; nejsou
aktuálním blokátorem této kvalifikace. Celá M6 matice/acceptance zůstává otevřená.

Navazující registrované běhy na clean `ceb8de93` prošly nezávislým review:
GPU pilot PASS (4 requests, plná GPU residency, cancel, přirozená obnova)
a pipeline program 17/17 PASS (2 skutečné provider inference, zbývající
workflow/role kroky jsou stavové fixture). Přesné hashe a hranice obsahuje
stejný run/review záznam; celý M6 release gate tím není uzavřený.

## Pokračování M6 po provozním checkpointu

Operátor znovu požaduje pokračovat autonomně. Již povolené sériové lokální
modelové ověření pokračuje samostatnými existujícími fázemi M6; známý sealed
registry FAIL nezastavuje vývoj podle `CONTRACT.md §8`. Jediný writer zůstává
stejný. Stabilitní měření používá samostatný připnutý klon na disku, soukromou
DB a izolovanou loopback síť. Jeho původní SHA se nikdy nepřeznačuje za nový.

Konkrétní follow-up rozsah: zpřístupnění existující fresh-clone fáze, capture
a cleanup funkcí v `scripts/run-m6-candidate-evidence.js` bez změny jejich
těl nebo release validátorů; oprava prokázaných zápisů lifecycle testů mimo
runner-owned projekty/artefakty v pěti dotčených testech, jejich společném
harnessu a `tests/helpers/isolated-test-db.js`, ověřená existující isolation
suite. Obě opravné větve `src/planner/code-cleaner.js` dostanou volitelný
caller-owned writer, aby stejná kontrola platila přímo při opravě souboru;
výchozí writer, algoritmus a kritéria opravy se nemění. Tato oprava sama
nenahrazuje izolaci vykonávání generovaného kódu.

Skutečný serverový běh na `193e2351` dále reprodukoval HTTP 502
`MODEL_RESPONSE_TRUNCATED` při doporučeních k projektu. Diagnostika a případná
minimální oprava patří do existujícího výběru answer token budgetu a jeho
M1 chat testů; finální odmítnutí neúplné odpovědi, cancellation a persistence
hranice se nesmějí oslabit. Kód se mění až po ověření příčiny. Původní FAIL
se uchová, opravu prověří nezávislý reviewer a skutečný stejný uživatelský
scénář. M5 externí custody/rotace/history ani release podpisy tím nejsou
autorizované; nezávislá technická práce na ně nečeká.

Navazující testová oprava zachovává požadavek C-12 z
`docs/behaviours/02-cre.md`: dokládá původní SEARCH, skutečný GUARD6 override
a výsledný CREATIVE na témže modelovém rozhodnutí. Samostatný bare author
lookup používá současný knowledge fast-path a není důkazem původního intentu
jiného volání. Nezávislé source review a inertní pozitivní/negativní kontroly
prošly; živý původní FAIL zůstává uchovaný do nového měření. E2E framework
dále zapisuje svůj pevně pojmenovaný JSON report do existujícího soukromého
artifact rootu; chyba zápisu se již nezamlčí. Produktové klasifikační větve
ani testové acceptance podmínky se kvůli zelenému výsledku neuvolňují.

Další reprodukované M6 regresní případy: čistý aritmetický řetězec
`10 * 9 * 8` musí využít existující deterministický kalkulátor podle C-01/C-02,
se zachováním následné M2 effect authority; oprava rozšiřuje pouze ukotvený
vzor celočíselného výrazu a ověřuje vyloučení názvů/prozaických vstupů.
Dva zastaralé shell source-grep testy se nahrazují skutečným ověřením přijaté
uzavřené legacy shell hranice M3. A/B quality test před modelovými voláními
načte dodávané specialisty původním loaderem do své soukromé DB a ověří všech
pět požadovaných expertů. Výběr domén, počet porovnání a scoring se nemění.
Neúspěch opinion testu nově uchová omezený text odpovědi; jeho predikát zůstává.

Stejná doložená chybějící inicializace se opravuje také v comparison group B:
všichni tři experti musí být přítomní před prvním modelovým voláním, žádné
účetní dialogy se tiše nevynechají. Nečekaný authority terminal nově připojí
omezený klasifikační trace do chybové evidence; seznam očekávaných terminalů
ani acceptance predikáty se nerozšiřují.

Navazující kompatibilní M5 oprava řeší nemožnost pravdivě zaznamenat původně
podmíněnou neaplikovatelnost credentials (`PRIVACY-INCIDENT.json`,
`2026-08-07-SECRET-TYPES.md §2`), nikoli novou výjimku z privacy požadavku.
Rozsah: nový striktní category-resolution validator, privacy repository,
celý signed-bundle verifier, M5 acceptance payload a jejich tři existující
regresní sady; příslušné API/Decision 035/WP dokumenty a census. Zachovává se
původní completed-v1 validátor, osm kategorií, history receipt, klíče, domény,
append-only ukládání a povinné nezávislé review. Podpisy, skutečná revokace,
custody, history akce ani deklarace konkrétní kategorie jako N/A se neprovádějí.

Doložený CODE případ požadující inline middleware doplňuje jedinou chybějící
alternativu ve společném CRE klasifikátoru. Expertiza rozhodnutí nepřepisuje;
aktivní projekt a explicitní file/shell požadavky zachovávají effect authority.
Čtyři nové kontroly a celá stávající C02 sada prošly (19/19); ostatní nalezené
expertizní chyby zůstávají otevřené. Nezávislé review opravilo i původní vadný
testový stub; původní neúspěšný probe zůstává uchovaný.

Raw diagnostika přesného provideru na původním `193e2351` zachytila skutečné
`done_reason=length` u e-mailu (256 tokenů), `Python` a `?` (64 tokenů), bez
thinking tokenů a bez uložené assistant odpovědi. Minimální oprava zarovnává
standardní 45slovný answer scope s rezervou 256 tokenů; 64 tokenů zůstává jen
u skutečných krátkých pozdravů/potvrzení. E-mail využije existující standardní
creative rozpočet 768 a jeho 150slovný scope, haiku zůstává 256. Ostatní code,
creative a expertise limity, role authority, retry, cancellation a odmítnutí
neúplné odpovědi se nemění. Původní projektový FAIL se v rekonstruovaném
kontextu neopakoval; obě seedované varianty 128/256 skončily shodně na 102
tokenech. Toto není přeznačení historického neúspěchu ani release acceptance.

Další doložená regrese výpisu projektu: Guard12 zahazoval existujícím parserem
rozpoznaný adresář `.` i známé názvy bez přípony. Oprava zachovává Guard9 pro
shrnutí, vyžaduje aktivní projekt u directory listingu a nepřijímá libovolný
neprázdný výsledek parseru. Existující file-reference suite a skutečná CRE
matice ověřují rozpoznání i negativní větve; M2 consumer hranice se nemění.
Workflow test nově sleduje skutečný veřejný `sessionId` a registrovanou
session, včetně shody stavu. Povolené stavy zůstávají CLARIFYING nebo
AWAITING_APPROVAL; FAILED se stále odmítá. Samotný test neprokazuje celý
build/review workflow. Původní živé neúspěchy se uchovávají do přeměření.

Přímé běhy dále prokázaly zastaralý vnořený M1 počet a příliš obecný CODE
pattern. M1 journey nově vyžaduje přesných 29 PASS / 0 FAIL / 0 SKIP místo
původních 21; všech původních 21 případů zůstává zahrnuto. Výraz pro příčiny
vyžaduje výslovný code kontext, včetně Unicode hranice před českým slovem
kód, aby také „příčiny škod“ zůstaly běžným dotazem. Skutečně klasifikovaný
SEARCH, file/shell autorita i code dotazy se zachovávají. Původní vadný návrh
a neúspěšné běhy jsou uchované, finální C02 sada prošla 23/23.

Navazující diagnostika zachovává všechny skutečné modelové požadavky a zbývající
negativní výsledky. Expertise routing nově uchová serializované rozhodnutí ze
stejného volání před asercí; Guard6 musí prokázat počáteční SEARCH, zásah guardu
a konečný CREATIVE. Statické vysvětlení zůstává CONVERSATIONAL podle existující
produkční větve, skutečné SEARCH negativní případy se dál ověřují. Lifecycle
asert zprávy připojí stejný klasifikační trace bez změny očekávaných intentů.
Dva testy vysvětlujících anglických odpovědí používají existující kladný language
detector s confidence nejméně 0,7 a kontrolu kontaminace místo pěti slov.
Nejde o úplný jazykový analyzátor; nejasný text neprojde automaticky. Obsahové
predikáty zůstávají a existující harness self-test ověří pozitivní i negativní
jazykové případy. Neúspěch uchová až 8 192 znaků a hash celé odpovědi. Původní
100znakový výřez neprokazuje jazyk celé odpovědi, původní FAIL proto zůstává.

Nové stejno-volání trace na `69b52278` prokázalo, že tři české výpisy projektu
převádí už primární model na CONVERSATIONAL; Guard9 ani Guard12 nezasáhly.
Úzké deterministické rozpoznání nyní vyžaduje aktivní projekt, explicitní
výpis, existující FILE_READ pattern a parserový adresář `.`. Zahrnuje pouze
přesný suffix existujícího `buildProjectHint(context)` na skutečné produkční
cestě; negace, shrnutí, cizí suffix a file/shell hranice se nemění. Nová hrana
vede na čistý existující formatter a je předmětem review. Párová sada stejných
9 kontrol: původně 8/1, opraveně 9/0, bez modelu. Jde o správné směrování;
M2 file.list zůstává UNAVAILABLE a funkční výpis adresáře tím prokázán není.
Doplněný původní chat-persistence běh prošel 35 kontrolami, ale odhalil jeden
nevyčkaný async callback. Oprava přidává pouze async/await před existující
singleton kontrolu a zachovává všech 36 testů; negativní probe nově skutečně
propadne s exit 1. Historický 35/0 výsledek zůstává uchovaný s tímto omezením.

Guard6 oracle se nyní řídí doloženou podmínkou `docs/EXPERTISES.md`, „GUARD 6 — Creative Override“: pouze
počáteční SEARCH/AMBIGUOUS s kreativní expertizou přechází na CREATIVE.
Počáteční CONVERSATIONAL/CREATIVE zůstává beze změny a obě ANSWER větve
používají expertizní generátor. Všech 43 kontrol a 39 původních rozhodnutí
zůstává, včetně skutečného pozitivního SEARCH svědka a přísného C11.
Aserce vyžadují stejno-volání trace, přesný zásah guardu a nulové effect tools;
bare-title baseline bez expertizy ověřuje absenci zásahu, nikoli jednoznačnost
titulu. Nezávislé review zopakovalo 46 inertních kontrol; produktový Guard6
se nemění a historický výsledek 35/43 se tím nepřeznačuje na PASS.

Původní LLM integration 1/2 používaly in-memory ConversationStore bez
ověřené identity, takže LOCAL nástroje správně končily M2 deny. Testovací
transport nyní předává explicitní test subject a sdílí soukromou durable DB
s brokerem. Původní případy a aserce zůstávají; LOCAL success navíc musí mít
přesný immutable request/result, PURE riziko, nulovou effect autoritu a shodu
zobrazené hodnoty s DB. To odmítne dvě falešně zelené kalendářové odpovědi,
kde stará regex aserce přijala číslici „2“ nebo část slova v odmítací zprávě.
Nezávislé review ověřilo 20 skutečných offline LOCAL kontrol a 15 inertních
kontrol diagnostiky. Modelové přeměření obou původních sad ještě zbývá.

SPEC clarification oprava nyní uchová uspořádané odpovědi v původním draftu
před D1 voláním. Opakovaný identický poslední vstup se neduplikuje; změny
A→B→A zůstanou. Compare-and-set zápis připíná ID, přesné předchozí spec bytes
a fázi SPEC, takže staré dokončení nepřepíše novější odpověď. Neplatný modelový
výsledek nezahodí původní otázky, technická rozhodnutí, implicitní předpoklady
ani learning conformance. Nový limit 8 KiB se týká pouze přidávaného prefixu
předchozích odpovědí; první samostatný vstup se nemění. Přetečení skončí
výslovnou chybou před modelem a zachová draft, bez ořezání obsahu. Nejde o
odhad tokenů nebo povolení většího modelového kontextu. Párová původní sada
106 PASS / 14 FAIL proti opraveným 120 PASS a nezávislé review jsou uchované.
Workflow wrapper dále předává skutečné gateway finishReason, včetně null při
chybějícím důkazu; nemění authority, počet volání ani chyby. Celá sada má 45
PASS. Dokončení dlouhé specifikace tím vyřešeno není: obě skutečné omezené
varianty kompaktního/plánovacího požadavku zůstávají FAIL a nebyly nasazeny.

Přeměření na čistém `2be9f521` uzavřelo původní routing sady 43/43 a 27/27
a LLM integration 2 se všemi 17 případy. LOCAL výsledky mají odpovídající
immutable request/result a test subject v soukromé DB; to neprokazuje obecnou
jazykovou kvalitu ani funkční file.list. LLM integration 1 skončila 15 PASS
/ 1 FAIL: direct 2.3 uchovalo správnou historii, ale raw provider odpověď měla
prázdný content, 1913 znaků thinking a finishReason=length při evalCount=512.
Původní FAIL je uchovaný. Úzká následná oprava direct helperu pouze přidává
`think: false`, shodně s existující produkční answer cestou. Výstupní budget,
kontext a všech 16 původních predikátů zůstávají. Nezávislé review patch
`c84474d5` a osm inertních kontrol prošly; nový modelový běh této opravy ještě
neproběhl. Přesné reporty a review jsou v lokálním provider-proposal adresáři.

Původní cookbook na privátním `875c041a` při 8192 tokenech vytvořil úplnou
první SPEC s 11 úspěšnými kontrolami; celý běh přesto skončil 26 PASS / 16 FAIL.
První revize vrátila neplatný JSON i při finishReason=stop. Tři existující
SPEC konzumenty proto nyní výslovně žádají již podporované `format: json`.
Prompty, validace, role, model, kontext i výstupní limit 4000 zůstávají stejné.
Nezávisle revidovaný patch `862479b4` má párovou lifecycle evidenci 124/1 →
125/0 a 30 M1 kontrol skutečného gateway body s inertním providerem; root
zopakoval obě sady bez sítě a GPU se stejným výsledkem. JSON režim nezaručuje
úplnost ani věcnou kvalitu a nový živý běh ještě chybí. Samostatně se řeší
prokázaná ztráta zadání neúspěšné revize; tato změna ji nezakrývá.

Sdílený runtime profil měl druhého zastaralého konzumenta ve VRAMManageru:
reload bez options ukládal nejvýše 8192 a startup audit větší kontext označil
za chybný i pro přesný profil modelu. Revidovaná oprava používá existující
čistý getter profilu pouze pro přesnou identitu; neprofilované modely drží
8192, nižší caller/hardware limity a konzervativní fallback zůstávají.
Nová hrana `src/media/vram-manager.js -> src/llm/model-runtime-profile.js`
má samostatné review: 1274 → 1275 hran, žádná odstraněná, stále 3 cykly / 28
souborů. Připnutí následuje nad čistým commitem přes existující ratchet.
Inertní párová sada při privátním profilu 16384 doložila 44/3 → 47/0;
kompatibilita 8192 má 47/0. Root při hlavním profilu 4096 zachoval původní
46/1 selhání zastaralé within-limit fixture a po její úzké revidované opravě
ověřil 47/0. Fyzické 100% GPU měření zůstává samostatný T3 požadavek;
existující 95% mediální audit není vydáván za jeho splnění. Profil hlavní
větve se touto opravou nezvyšuje a mediální plocha se neaktivuje.

Samostatná revizní oprava `f8251f9b` uchovává původní zadání i uspořádané
připomínky před voláním modelu. Přesný compare-and-set ve fázi SPEC_REVIEW
chrání přijetí i dokončení; stará odpověď nepřepíše novější návrh. Nevyřešené
připomínky blokují schválení staré SPEC. Předchozí veřejná specifikace,
technická rozhodnutí a předpoklady se předají znovu bez rekurzivní historie;
první vstup se neořezává a překročení 8KiB prefixu se výslovně odmítne.
Historická SPEC bez původního zadání zůstává použitelná s dostupným obsahem,
chybějící text se nevymýšlí. Nezávislé review a párových 127/27 → 154/0 jsou
uchované; root zopakoval 154 lifecycle a 45 workflow kontrol bez sítě/GPU.
Zděděný limit čtvrté revize v non-M1 routeru je samostatně otevřený finding;
tato oprava neprokazuje zachování každého vstupu na všech vstupních cestách.

Cookbook test měl navíc falešné finální SPEC-F PASS: slovo „přiřazené“ uvnitř
staré `_previousSpec` prošlo jako řazení a připomínka v interních metadatech
jako hotová výživa. Revidovaný test `cd7489c0` nyní kontroluje aktuální veřejnou
SPEC a Unicode hranice slov pro řazení. Obě místa kontrol jsou opravená;
revizní T3-R větev v historickém 8k běhu neproběhla, její vada je doložená
inertně. Všech 84 původních míst kontrol, prompty, scénáře a ostatní obsahové
predikáty zůstaly. Nezávislé review a 43 inertních kontrol včetně skutečného
historického draftu prošly; root zopakoval 43/43. Jde stále o zmínku požadavku,
nikoli důkaz implementovaného řazení. Nový celý modelový cookbook ještě chybí.


Navazující oprava non-M1 routeru odstraňuje automatické schválení při čtvrté
připomínce i výstrahu, která je slibovala. Každý explicitní nesouhlas nyní
vyvolá jednu stávající revizi; počet starších připomínek nenahrazuje souhlas.
Limity modelu, JSON režim, CAS, retence a ochrana M1 zůstávají zachované.
Stejných 119 kontrol skutečného routeru a soukromé DB doložilo baseline
100 PASS / 19 FAIL a opravených 119 PASS / 0 FAIL; lifecycle 154/154 a M1
quarantine 8/8 rovněž prošly bez sítě/GPU. Selhání čtvrté revize uchová
připomínku před modelem a odmítne schválení starého dokumentu; explicitní
schválení platné SPEC dál přechází do plánování. Důkazy a nezávislé review
jsou v `.intentsmith-artifacts/core-completion-20260909/provider-proposal/spec-fourth-revision-fix-3c004e70/`.
Tato úzká oprava neřeší výstupní limit 4000 v naměřeném cookbook běhu.


Projektové čtení souboru nyní vede přes descriptor `file.read@2`, přesný
EffectRequest a jednorázové schválení. Provider načte nejvýše 1 MiB s kontrolou
identity souboru; bajty a úspěšný EffectResult se uloží atomicky. ToolResult
obsahuje ověřený odkaz a digest. Chat zobrazí přesný cíl před schválením a potom
výhradně uložené bajty ověřené proti současnému projektu, konverzaci a aktérovi.
Replay po odstranění zdrojového souboru znovu nečte disk ani nevytváří grant.
Neplatné UTF-8 se nevydává za text; názvy i obsah mají oddělené literální
zobrazení. Historické `file.read@1` výsledky tím nezískávají nový obsah.

Migrace 109 přidává immutable output metadata, soukromý BLOB a tombstones.
Soft-delete/restore zachovává stávající význam; trvalé odstranění projektu či
konverzace a existující retention hard-delete atomicky vymažou uložené bajty.
Historický úspěch zůstává pravdivý. Skutečná plná migrace prošla 13/13 kontrol:
96 migrací na nové DB, upgrade naplněné předchozí DB s 95 migracemi, replay
historických výsledků, produkční ProjectContext/read provider a rollback celé
DDL transakce při chybě zápisu migration stamp. Čerstvá DB má 171 tabulek.

Authority patch `05d43d40` má nezávislé source/privacy review a 133 focused
kontrol; consumer `536fb1ec` nezávislé root review, párových 8/14 → 22/0 a
11 skutečných private DB/provider/handler kontrol. Root po sloučení zopakoval
22 consumer, 45 broker a 17 runtime kontrol. První direct runtime bootstrap
FAIL je zachován; návrat existujícího isolated helper importu na první místo
opravil jeho pořadí bez změny predikátů. Původní schema FAIL kvůli seznamu 95
migrací je zachován; doplněny pouze exact109 a dvě tabulky do původních oracles.
Census a 158 artifact kontrol prošly. Sedm nových src import hran má samostatné
review (1275 → 1282, stále stejné 3 cykly / 28 souborů); jejich připnutí následuje
nad čistým commitem. Důkazy jsou v provider-proposal adresářích
`m2-file-read-output-proposal-6405992`, `m2-file-read-consumer-proposal-6405992e/v3`
a `m2-file-read-integration-20260909`.

Tento výsledek neuzavírá `file.list`, skutečné vysvětlení FILE_EXPLAIN,
projektově neomezený web, celý M2 review/acceptance ani společný release gate.
Živá provozní DB nebyla migrována a hlavní modelový profil zůstává 4096.

Související M1 failover schema test zůstává kontrolou úplného migračního
řetězce: jeho původní 17 PASS / 3 FAIL očekávaly aktuální verzi108 a95 migrací.
Opraveny pouze aktuální verze109, počet96 a přidán přesný název109 do seznamu;
původní kontrola nulových nových migrací a identického schématu zůstává.


Úplný původní offline/database běh na čistém `b21de040` skončil skutečně
350 PASS / 2 FAIL / 0 BLOCKED; žádný výsledek se nepřeznačuje. Produkční
consumer test ještě vyžadoval dva UNAVAILABLE terminály. Nyní ověřuje read@2
čekající na přesné schválení, druhý symlink odmítnutý a nula grantů, execution
claims i output bytes před schválením; obsah se nevrací. Všech 22 původních
případů projde, před opravou 21/1. Druhý finding byl skutečný starý release
contract pin: aktuální počet migrací95 odmítal správný upgrade96. Revidovaná
oprava mění jen aktuální počet na96; původní56, verze, SHA a všechny ostatní
validation guards zůstávají. Stejných8 testů doložilo7/1 →8/0 a10 úzkých
negativních kontrol zachovalo exact count/failure-cut pravidla. Oba původní
FAIL a opravené důkazy zůstávají v provider-proposal integration/remaining-fixes
a m6-runtime-migration-pin-b21de040. Nový celý běh musí mít vlastní clean SHA.


Aktualizace 2026-09-09 21:39 UTC: sedm hran je připnuto v `b21de040`
a opravy integračních chyb v `7fa6f985`. Jeho původní celý offline/database
běh má **352/352 PASS**, exit 0. Stejný čistý source prošel také původní
fresh-clone fází **4/4 PASS**, včetně buildu, upgradu/obnovy a obou Studio
scénářů. Předchozí 350/2 deterministic FAIL, neúplná cache i fresh-clone
3 PASS / 1 FAIL po dalších vstupech mimo scénář zůstávají zachované.
Opakování na soukromém Xvfb ponechalo stejné testy a produkt; sedm build
souborů bylo zachyceno a úklid klonu/procesů potvrzen.
[Aktuální důkazy a zbývající práce](../execution/runs/m6/core-completion-followup-20260909.md).
Soak má jen sedmihodinový průběžný výsledek 25203/0 na starším source.
To neuzavírá modelovou kuchařku, `file.list`, skutečné FILE_EXPLAIN,
M5 externí podmínky, M2 konečné přijetí ani release. Hlavní profil4096
ani výstup 4000 se tím nemění; dva již předložené autoritní návrhy zůstávají
bez odpovědi. M7 zůstává oddělené.

### Navazující sada milníků k společnému review — zadání 2026-09-09 21:50 UTC

Operátor výslovně požádal dokončit co nejvíce autonomně a předat více milníků
společně. Vstup je čistý `7dacd466`, produktový source shodný s měřeným
`7fa6f985`. Rozsah nadále vychází z PRODUCT §3 a přijatého D030; nevzniká
nová produktová ani schvalovací autorita. Root vlastní integraci a GPU běhy.
Pracovní rozpočet: 29 chráněných worktree, žádný bezpečně odstranitelný;
soukromé testovací overlay mají oddělené kořeny a uchovají dosavadní důkazy.

- **Výpis projektu:** schválit přesný kořen a dostat úplný omezený výpis jmen
  a typů přímých potomků; trvalý výsledek, replay, současné vlastnictví a
  mazání. Vlastník backendového řezu `verify_convergence`: nové list@2/
  EffectRequest@2 kontrakty, broker, runtime, typed repository a migrace110.
  Migrace110 nemá kolizi v 452 lokálních refech a 29 worktree HEADs.
  Root doplní UI nad připnutým snapshotem po integraci FILE_EXPLAIN.
- **Vysvětlení souboru:** po schváleném file.read@2 vytvořit skutečné
  vysvětlení z ověřených uložených bajtů. `verify_mobile` vlastní soukromý
  consumer řez `src/chat/handlers/file.js`, příslušnou větev pre-handleru
  a cílené testy. Stávající read@2 autorita a modelové limity se nemění.
- **Úplný stručnější SPEC:** `verify_release` vlastní soukromý planner prompt/
  schema-consumer řez. Zůstává limit4000, úplné přijaté schéma, všechny
  požadavky, cancellation a výslovné schválení; nevzniká automatické zkracování
  požadavků ani další retries. Root změří původní kuchařku se skutečným modelem.

Integrace bude sériová: nezávisle revidované consumer a planner řezy, potom
list backend a jeho skutečné UI. Demonstrace musí obsahovat schválení →
výsledek → restart/replay a relevantní odmítnutí špatného scope, smazaných dat,
poškozených bajtů a zrušené/modelově selhané operace. Ověřovací vstupy:
`node tests/m2-effect-file-consumer.test.js`,
`node tests/m2-effect-file-runtime.test.js`,
`node tests/m2-effect-authority-repository.test.js`,
`node tests/m2-tool-authority-repository.test.js`,
`node tests/m2-tool-production-consumer.test.js` a
`node tests/lifecycle-handoff.test.js` v izolovaných prostředích; dále
původní relevantní modelové scénáře sériově a společný deterministic profil
nad dokončeným source. Selhání musí zachovat předchozí stav a nesmí být
prezentované jako hotová schopnost. Stop podmínkou je skutečná potřeba změnit
přijatou autoritní hranici či nevyřešená regrese, nikoli samotná nutnost
nového interního verzovaného typu. Konečné operátorské přijetí je samostatné.

Closeout zadán operátorem 2026-09-10: další oblasti se neotevírají.
FILE_EXPLAIN integrován17ed11f1, nezávislý skutečný soukromý DB průchod36/36.
Backend list má233 cílených a11 plných migračních kontrol; root integrace
s oběma chat větvemi38/38, následná přesná úprava dvou migračních očekávání
96→97. Přesun byte-identických list formatterů do existujícího file handleru
zachovává3cykly/28členů; neotevírá se nová výjimka ratchetu. Společná sada
bude připnuta po clean commitu. SPEC experimentea309 byl po skutečném
Cookbook14PASS17FAIL vrácen v 4410c360; původní prompt a4000 zůstávají.
FILE_EXPLAIN modelový demo běh NOT_RUN. Finální přijetí M2 a release čeká.

Aktuální uzavření na žádost operátora: [dva milníky k review a vrácený SPEC experiment](../execution/runs/m6/core-completion-review-20260910.md). Společný `2ceaf152`: 351 PASS / 1 FAIL v dokumentaci, který má samostatné ověření po opravě census/manifestu; nevzniká tvrzení nového společného výsledku 352 PASS ani release.

Operátor 2026-09-10 následně výslovně obnovil autonomní dokončování projektu.
První navazující test-trust milník `c108da86` opravuje dva ruční chat harnessy,
které nečekaly na všechny asynchronní případy. Síťově izolovaný pipeline běh má
po opravě 52/52 a output-quality 46/46 PASS; commit čeká na review. Současně
pokračuje oddělený soak `193e2351` s posledním přečteným patnáctihodinovým
heartbeatem 54007 požadavků / 0 chyb. FILE_EXPLAIN modelový demo běh zůstává
do dokončení soaku `NOT_RUN`, aby se nesdílela jedna GPU autorita.

Navazující M5 preflight nad read-only živou DB odhalil, že kandidátní restore
odmítal tři historicky vydané migration identity, které současný manifest už
neobsahuje. Produktový commit `65bcbc4b` je přijímá přesným uzavřeným seznamem
a libovolnou další neznámou migraci dál odmítá. Prošlo 19 restore, 1 pre-082
upgrade, 55 schema a 13 boundary kontrol i čistý previous-version
upgrade/rollback E2E. Privátní projekce živé DB ověřila 88→100 migration stampů
a bajtově shodný backup→poškození→restore round-trip; živá DB nebyla změněna.
Stav je `BACKUP_COMPAT_IMPLEMENTATION_GREEN / REVIEW_REQUIRED`, nikoli M5
acceptance. Soak mezitím dosáhl posledního přečteného stavu 15 hodin / 54007
požadavků / 0 chyb a pokračuje; FILE_EXPLAIN proto zůstává `NOT_RUN`.

Nezávislé review následně přijalo `c108da86` i restore základ `65bcbc4b`.
Potvrdilo, že předchozích 47 pipeline výsledků bylo podhodnocení 52 deklarovaných
případů, a kontrolou dalších čtyř ručních async harnessů omezilo blast radius na
dvě opravené suity. Jediný drobný restore nález uzavírá `b4136a43`: source
migration se stejnou identitou jako historický allowlist už neskončí tichým Set
sloučením, ale `BACKUP_SUPPORTED_SCHEMA_DUPLICATE`. Prošlo 20/20 restore, 1/1
pre-082, 55/55 schema a 13/13 boundary; nezávislé úzké review follow-up přijalo.
Poslední
přečtený soak heartbeat je 16 hodin / 57608 požadavků / 0 chyb.

Přesný restore follow-up verdikt:
[`2026-09-10-M5-BACKUP-COMPAT-FOLLOWUP-REVIEW-RESULT`](../review/2026-09-10-M5-BACKUP-COMPAT-FOLLOWUP-REVIEW-RESULT.md).

Operátor současně zvolil `retain_and_rotate` a budoucí celý LUKS2 disk pro
offline custody. Výběr není 8/8 remediation, podpis ani přesun klíčů; reviewer
key stále potřebuje oddělenou fyzickou custody.
