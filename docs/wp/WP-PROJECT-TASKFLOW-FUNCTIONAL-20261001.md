# WP — druhá funkční aplikace TaskFlow

**Root převzetí 1. 10. 2026, 10:35 UTC:** čistý autorský
`bc82434cd068c8c2e4f360e2be191b4e55e91b58` má nezávislé **REVIEW_PASS**;
reviewer zopakoval **28/28** a původní protipříklady s referencí **4/4**.
Tři mutanty skončily `PROJECT_CHANGE_TEST_FAILED`, pěti rollbacky, bez
commitu a se shodným durable failed terminálem po novém procesu.
Reference commitne a další run začíná prázdnou tabulí. Historických 23
důkazů chybného `c194` přijetí zůstalo přesných. Nový devítisouborový
review manifest má SHA-256
`daf688567917cfb62774fdc9b0fef9c89a6e79b2b69e7b4b357054ef3e1870dc`.

Root integroval WP/implementaci/opravu jako `08b74b78 / 67680929 /
ae9732a4`. Jediný konflikt v PROJECT-BUILD zachoval předchozí přijatou
ledger PASS pasáž a nový TaskFlow kontrakt. Doplněn pouze importovaný
helper exclusion; **593 descriptors a původních 32 exclusions zachované**,
celkem 33 exclusions. Autoritativní writer obnovil projekci, fingerprint
`cf640660cad1b0673ccd2c57fe6f6f72c9f156f755044e8cb7c841d3eefd0127`.
Census source **681 / 234 011**, tests **599 / 265 207**. Společný
registrovaný gate a root integrační review zatím **PENDING_RUN**;
fyzický TaskFlow s modelem **LIVE_NOT_RUN**. Níže zůstává historie autora.

**Autorita:** požadavek operátora ověřit, že model vytvoří skutečně fungující různé projekty, nikoli jen text, přenos návrhu nebo Git commit. Tento balík navazuje na přijatou šestisouborovou ledger cestu, ale dokládá samostatnou doménu stavů úloh. **Výchozí čistý zdroj:** `92f7b51c2423bdd2cc5633903a579b611d01f7f3`, větev `work/project-app-acceptance-20261001`. **Stav tohoto prvního commitu:** `WP_ONLY / IMPLEMENTATION_NOT_RUN / REVIEW_PENDING`.

## Přijatá hranice a soukromý návrh

Privátní, ignorovaný návrh v integračním checkoutu má manifest SHA-256 `466706f669fefb069c952dc3ef538d7a2f559bee0c6b454a835f6137244e29d7`. Root ověřil skutečný `compileCodeDraftInput`: pět souborů, celková instrukce 449 B, každá dílčí do 512 B, pořadí generování `query → validate → store → cli → app`. Dvě starší neúspěšné revize návrhu zůstávají archivované; změny v tomto WP nesmějí prezentovat plán jako fyzicky ověřený modelový výsledek.

TaskFlow je nový, dependency-free Node ESM projekt s přesnými tuple příkazy `add`, `update`, `transition`, `remove`, `list`; přechody pouze `todo → doing → done`, filtr a stabilní řazení podle priority/ID, samostatné kopie výsledků a chybové ID/patch/options hranice. Model navrhuje jen `src/{validate,query,store,cli,app}.js`. Veřejná instrukce určuje jediný povolený importní graf a standardní ECMAScript globály; žádné Node/Web host globály. Operátor před inferencí ukládá a Git commitem zmrazuje vlastní test, probe, CLI adapter a úzkou policy. Jejich hash i cesty musí zůstat mimo M2 plán.

## Vlastněné změny

- nový TaskFlow descriptor, veřejné `compileCodeDraftInput` zadání a skutečné nezávislé orákulum; nový soukromý referenční helper pro CPU testy;
- jediný existující `scripts/run-project-app-journey.js` dostane pevnou volbu `ledger|taskflow`, default ledger. HTTP M2 lifecycle, provider relay/lease, kanonický kompilátor, effect executor, sandbox a rollback se neduplikují;
- existující dvě app testovací vstupní sady se rozšíří o pozitivní a úmyslně vadné TaskFlow moduly. Reálné M2 negativy musí selhat ve focused testu, rollbackovat všech pět cílů a mít stejný failed terminál po novém SQLite procesu;
- `docs/PROJECT-BUILD.md` dostane stejné veřejné zadání a tento WP evidenci.

**Nevlastněné:** `src/**`, `contracts/**`, DB migrace, backend, CHAT, mobil, registr a generovaná registry projekce, produkční služba/DB, GPU/modelové volání, push. Root po nezávislém review integruje případný jediný additive exclusion pro nový importovaný helper; tento autorský checkout nemá registrované existující dvě app sady, proto zde nelze tvrdit společný registrovaný gate. Sdílený `WP-PROJECT-APP-FUNCTIONAL-20261001.md` vlastní root a tento autor jej nemění.

## Zachování ledger přejímky

Ledger frozen byte SHA-256 jsou před změnou: oracle `1593a906dbdc69b46b3e8a445887dd6ca9e77571a75f7415a565dac407884933`, subject probe `838f3c8d41abbdbf1185fe8c2885dde79eb895f3d3b766d342dd5c836d7da9ec`, validator probe `baf09f9295d18aad4c55850d1b6d8205ed9120a49f22efc503097022f2f2aafe`, CLI entry `58a792dce6f33cf5c6d9d92bc2beee920bb4ab566952bd799918916bef538a3f`. Default runner/preflight a přesná provider→canonical buildStep path attestace musí zůstat stejné. Fyzický ledger FAIL na `62e1309f` i pozdější accepted PASS na `92f7b51c` zůstávají historicky oddělené; tento balík je nepřepisuje.

## Testovací hranice a gate

1. Red-first reference plus targeted defects v opravdovém `linux-bwrap-ro-v2` sandboxu; pozorovat přesné JSON výsledky CLI, čerstvý proces, neplatné hodnoty, `doing`/`done` filtry, patch jednoho pole, řazení shuffled priority ties a id 0/negative/fraction/string/unsafe/NaN/Infinity.
2. Trusted parent načte jen `store/query/validate` v `vm.SourceTextModule`, bez host funkcí/objektů, dynamic imports a Node/Web host globals. Patch/options a dotazované řádky se vytvoří uvnitř stejného VM realm. Rodič pozoruje skutečnou identitu a mutaci snapshotů, nikoli childem deklarované booleany.
3. Reálná M2 pozitivní fixture commitne přesné preview bytes; negativy (sort/filter/transition/snapshot alias/remove/update/CLI tvar) skončí `PROJECT_CHANGE_TEST_FAILED`, pět rollbacků, bez commitu; vlastní nový proces ověří durable terminál a původní Git HEAD.
4. Syntaxe, no-inference preflight obou pevně vyjmenovaných scénářů, znovu ledger CPU sady, diff a hash invarianty. Nový čistý SHA bude `IMPLEMENTATION_GREEN / REVIEW_PENDING`, nikoli fyzický modelový PASS. Fyzické CODE volání až po nezávislém review a samostatném serialized GPU slotu.

Tento scénář prokáže druhou skutečnou paměťovou aplikaci. Samostatné HTTP API, SQLite aplikace, DOM, jiné jazyky a instalovaný IDE renderer zůstávají dalšími kvalifikačními hranicemi.

## Implementační kandidát a CPU důkazy

První implementační kandidát `c19432bee9b505e1bbd08a28007969b0001ec338` skončil po nezávislé revizi `CHANGES_REQUIRED / TASKFLOW_LIVE_NOT_RUN`. Přesný public blueprint odpovídal předem revidovanému soukromému návrhu: `compileCodeDraftInput` určil pořadí `query, validate, store, cli, app`, celková instrukce má 449 B a dílčí mají 137/456/471/288/486 B. Frozen TaskFlow SHA-256 v `c194`: oracle `5ebf525f8eaf245d70c223c9b7f4efd4e72c49a87e332dbae22cc58b43f3c8ec`, probe `211909c9a49f3cd86603b01e38407cb9b58088a283f91b9e12c95fbc250b6d24`, validator probe `38daed3c08a9fe88e73c9b2284ec401de1f8311832219d293bba78b452f07bc9`, sdílený entry `58a792dce6f33cf5c6d9d92bc2beee920bb4ab566952bd799918916bef538a3f`. Ledger čtyři hashe výše zůstaly přesně stejné.

Příkaz `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/project-app-acceptance.test.js tests/project-app-m2-functional.test.js` na `c194` dokončil 25/25: osm původních ledger M2 případů, devět TaskFlow M2 případů a osm sandbox/kontraktových případů. TaskFlow měl jeden skutečný M2 commit referenční pětimodulové aplikace a osm vadných implementací s `PROJECT_CHANGE_TEST_FAILED`, bez commitu, úplným rollbackem a ověřením trvalého stavu po novém SQLite procesu. Oddělený sandbox spustil CLI s přesnými výsledky; trusted VM pozoroval identitu a mutaci objektů. Provider syntetická kontrola přijala pět správně vázaných výstupů a zamítla záměnu hashů mezi `cli.js` a `app.js`. **Těchto 25/25 nezachytilo dva další porušené veřejné kontrakty.**

Gate0 následně v opravdovém M2 přehrál dva mutanty, které `c194` chybně přijalo s focused exit 0, pěti soubory a Git commitem a trvalým `succeeded` po novém SQLite procesu: `shared-board` držel tabuli v module scope a porušil fresh board na další `run`; `accept-nonplain` odstranil kontrolu prototypu a dovolil neobyčejné VM objekty jako `Date` pro options a class instance pro patch. Evidence zůstává v soukromých `gate0-review-taskflow-{shared-board,accept-nonplain}-c19432b.json` a odpovídajících durable souborech. Tyto falešné commity jsou důvod `CHANGES_REQUIRED`, nikoli přijaté výsledky modelu.

## Navazující oprava k nezávislé revizi

Opravený frozen oracle načte deklarovaný `cli → store → query/validate` graf do jediného omezeného `vm.SourceTextModule` kontextu. Trusted rodič v témže realm volá `run` třikrát: druhé i třetí volání musí začínat prázdnou tabulí a druhé musí znovu vydat ID 1. Nejsou předávány host funkce ani objekty; dynamické importy zůstávají zakázané. Patch/options instance `Date`, VM class a objekt s vlastním prototypem vznikají v tomto realm a musí vyvolat `TypeError` bez změny stavu. Zvláštní negativní fixture pro options dokládá `Date` i tehdy, když původní kombinovaný mutant skončí dříve na class patchi. Veřejný blueprint, policy, runner, produkční source a frozen ledger bytes se nezměnily.

Nový TaskFlow oracle má SHA-256 `150fc79d2443a85a6cd90382c23c80ff56f721172a36c8323bd3410171a5dd79`; ostatní tři TaskFlow frozen hashe zůstaly výše uvedené. Přímý Node 24 běh obou existujících app suite dokončil **28/28**: osm acceptance/sandbox/attestation kontrol, osm ledger M2 a dvanáct TaskFlow M2 (jedna funkční pozitivní fixture, jedenáct vadných). Všechny tři nové M2 negativy `shared-board`, `accept-nonplain` a `accept-nonplain-options` končí `PROJECT_CHANGE_TEST_FAILED`, bez commitu, s pěti odstraněnými cílovými soubory a stejným failed terminálem po samostatném SQLite procesu. Stav navazujícího čistého commitu je `IMPLEMENTATION_GREEN / REVIEW_PENDING / TASKFLOW_LIVE_NOT_RUN`; tato CPU evidence sama nenahrazuje nové nezávislé přezkoumání ani fyzický modelový pokus.

První rozpracovaný M2 běh nových případů měl 9/9 `M2_LIFECYCLE_GOVERNANCE_DENIED`: vlastní zamčený oracle obsahoval slova `import`/`require` v testovacím textu, která konzervativní import scanner vyhodnotil jako nepodporovanou syntaxi. Text byl opraven bez oslabení požadavku nebo rozšíření policy; následující úplný běh prošel. Tento přechodný neúspěch není vydáván za produktový modelový test.

Bez inference lze z čistého checkoutu ověřit preflight příkazy `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/run-project-app-journey.js --preflight` a `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/run-project-app-journey.js --scenario taskflow --preflight`. Pro fyzický TaskFlow pokus je vyžadován přesný čistý source SHA, nové soukromé výstupní umístění, přítomný model s přesným digestem a samostatný serialized GPU slot; runner ho přijme jen přes `--scenario taskflow --live --out … --source-sha … --model … --digest …`. Před povolením modelového běhu musí nezávislá revize přijmout tento kandidát a root doplnit aditivní helper exclusion do společného registru.
