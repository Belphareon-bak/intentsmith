# WP — druhá funkční aplikace TaskFlow

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
