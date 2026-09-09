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
