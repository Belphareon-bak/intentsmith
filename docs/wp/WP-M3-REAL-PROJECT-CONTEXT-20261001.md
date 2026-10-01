# WP-M3-REAL-PROJECT-CONTEXT-20261001

**Stav:** `REVIEW_PASS / REGISTERED_GREEN / NO_MODEL_QUALIFICATION`
**Vlastník:** `/root/full405_diagnosis`; integrace a registry metadata: root.
**Vstup:** publikovaný `0625ee6077c32386d3de34b81f837d19647ada6f`.
**Větev:** `work/m3-real-project-context-20261001`, existující owned checkout
`intentsmith-full405-baseline-oracles-20261001`; žádný nový worktree.

## Root přijetí a publikace

Původní řada `082851f7 → 9d9d44cf → a3d6e61d` je přímo v root historii.
Nezávislý reviewer zopakoval 8/8, ověřil skutečný retrieval call graph,
12 author důkazů a aktivní import deny guard. Review SHA-256
`cc79741fad757b3f1a3ea0e4f8af5fc25500c73a815c93916eae589a66e7d897`,
manifest `6e371789a303665c4b75b06026ae2b5a5e9d1fb7eaeed665c65b913a5d261ed9`.
Root clean `a3d6e61d` má vlastní registrovanou bránu 2/2, report SHA-256
`64ce4752302a908e723e16f479c3e7cfb5ebe8d9fed054b99642d94fbf2352c1`.
Společný publikovaný clean `936e9a33` má 9/9 PASS, report SHA-256
`2076f55c902d807b307e4821f0c88fb13e3c447d40342bbda31512345801517a`
a CI SUCCESS. Přesný test blob je nezměněný od `9d9d44cf`.
Tato přejímka dokládá deterministického specialistu nad skutečným
ProjectContext, modelovou sémantickou kvalifikaci nechává otevřenou.

## Autorita a výsledek

Explicitní zadání root v rámci operátorského dokončení specialistů:
ověřit přímý skutečný ProjectContext → M3 code-review specialist CPU průchod,
bez přirozeného CHATu a bez modelu. Navazuje na `PRODUCT.md` §3
rozšiřitelnost, `ROADMAP.md` §7 `WP-M3-SPECIALIST`, přijatý
`ProjectContextQuery/Snapshot@1` a `CONTRACT.md` §2 L0-8 / §5–§7.
Tento WP tyto požadavky pouze ověřuje; nezakládá novou produktovou autoritu.

Uživatelova projektová data musí dát konkrétní nález na skutečném řádku
svého souboru. Jiný soukromý projekt nesmí převzít zdroj ani nález prvního;
změněná revision a chybně svázaný kořen musí skončit chybou.

Dosavadní `fakeProvider` v `tests/m3-code-review-specialist.test.js` je provider
**projektového kontextu, nikoli LLM**. Nový důkaz proto kvalifikuje skutečné
čtení souborů, provenance a deterministická pravidla specialisty. Není
modelovým review, přejímkou expert-vs-general kvality, CHAT routingu ani releasu.

## Vlastněné cesty a connector

- `tests/m3-code-review-specialist.test.js`
- tento WP

Connector zůstává existující `createSpecialistProjectContextBridge`,
`ExtensionManifest/Context@1`, `SpecialistRuntime` a shipped `code-reviewer`.
`observeWorkspaceRevision` a `queryProjectContext` dostanou explicitní
izolovaný registry `projects.findById`; výstupy retrievalu se nemockují.
Soukromé fixture soubory vzniknou pouze pod dočasným prostorem test harnessu.
Provider nikdy nepotřebuje default import nebo otevření produkční DB.

Produktové `src/**`, contracts, scripts, další testy, registry/projekce,
CHAT, modelové role, provider/GPU, root checkout a cleanup nejsou write scope.

## Demonstrace a ověření

Zachovat všechny dosavadní fake capability/error testy. Doplnit:

1. skutečný soubor s `eval(input)`; přesný nález/path/řádek, skutečně přečtené
   bajty a odpovídající workspace/content/snapshot digests; opakování je stabilní;
2. druhý projekt se stejnou relativní cestou a bezpečným obsahem; správná
   provenance a žádný převzatý `eval` nález;
3. změnu owned souboru mezi skutečnou observation a query; chybu STALE;
4. project ID prvního projektu s kořenem druhého; chybu INVALID_SCOPE před
   čtením cizího souboru.

Přesné bounded příkazy:

Node je přesně `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node`;
jeho bin adresář je také první v `PATH` pro child procesy. Příkazy:

```sh
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/m3-code-review-specialist.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/harness-exit-code.test.js
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node scripts/nightly-audit.js --suite=IS-T1-TESTS-M3-CODE-REVIEW-SPECIALIST-TEST,IS-T1-TESTS-HARNESS-EXIT-CODE-TEST --run-id=m3-real-context-candidate
```

Obě registry ID byly ověřeny před spuštěním.
Registrovaný běh patří čistému pojmenovanému kandidátu; reporty a exits
se zachovají v ignored `.intentsmith-artifacts`, bez převydání starých výsledků.
Aktuální suite je offline / database:false / network:none; změnu dosažitelnosti
DB nebo potřebných fixture metadat předat rootovi, nikoli metadata potichu přepsat.

## Stop condition a předání

Zastavit závislou cestu, pokud důkaz vyžaduje CHAT/model/provider, default DB
nebo změnu connectoru, cizí source či registry. Každý FAIL zachovat a opravit
jen vlastní test fixture nebo předat konkrétní produktový nález rootovi.
Focused green není acceptance: finální candidate zůstane `REVIEW_PENDING`
do nezávislého review. Commit pouze dvě vlastněné cesty; bez push, který
provede root po přijaté integraci. Původní provider-guards větev i exact remote
tag `evidence/project-app-provider-guards-20261001` na `15337cde` zůstávají.

## Implementační důkaz 2026-10-01

WP-first commit `082851f7262ba9363a79373ffc1a0cbc17634fd3` předchází
změně testu. Původní čtyři capability/package/error testy z `0625ee60`
zůstaly bajtově stejné; přidány jsou čtyři skutečné filesystem případy.

| Kontrola | Skutečný výsledek |
| --- | --- |
| Node 24 syntax | exit 0 |
| Přímá M3 suite s aktivním zákazem importu default DB/SQLite | 8 PASS / 0 FAIL / 0 SKIP; exit 0 |
| Přímý `harness-exit-code` | exit 0; 129 temp roots, 142 chráněných DB-reachable roots; odstranění bootstrapu je odmítnuto |
| Registrované dvě sady na čistém `9d9d44cf` | 2 PASS / 0 FAIL / 0 BLOCKED / 0 SKIP; exit 0 |
| Nezávislé review | `REVIEW_PENDING` |

Soukromý receipt je
`.intentsmith-artifacts/m3-real-project-context-20261001T132050Z/receipt.json`.
Obsahuje přesné argv, UTC časy, exits a SHA256 logů; focused source SHA256
je `f1e3187a74d964fd4640fc401f3db8b52e2895e4194e69e96e8cf434bb4319ed`.
První focused běh patří pracovnímu testu nad WP-first SHA, nikoli tehdy
čistému kandidátu; receipt tento vztah uchovává.

Ignored preload `no-default-db-guard.mjs` odmítá načtení
`src/db/database.js`, `better-sqlite3` i `node:sqlite`. Skutečný výstup:
`rejected:0`, `privateDbConfigured:true`, `privateDbCreated:false`.
Registry zůstává beze změn: offline / database:false / network:none.
Statická dosažitelnost lazy DB importu již existovala před touto změnou;
nové přímé případy ji nevyužijí, protože injectují vlastní projektový registry.

Tyto výsledky kvalifikují přímý deterministický M3 connector a skutečné
ProjectContext čtení. Nevztahují se na modelové posouzení, aktivaci rolí,
přirozený CHAT, přejímku mobilu nebo releasu; staré neprovedené či neúspěšné
živé výsledky se tím nepřeznačují.

## Registrovaný kandidát

Skutečný běh `m3-real-context-9d9d44cf` proběhl v UTC
`2026-10-01T13:23:43.189Z`–`13:23:45.255Z` na čistém
`9d9d44cf258c14069568c8efd08f8517a7ee91df`, Node `v24.21.0`.
Obě sady mají skutečný exit 0, sourceTree.clean=true a cleanup
leakDetected=false. M3 log obsahuje všech osm PASS; harness log znovu
potvrzuje 142 chráněných DB-reachable roots a odmítnutí bootstrap mutace.

Report:
`.intentsmith-artifacts/test-runs/m3-real-context-9d9d44cf/report.json`
SHA256 `357609a4441c10e2b66534e89811694824d1890258b48b000097b796cd343515`.
M3 log SHA256
`cc6af7cdae8b9d31771f4cd13ec75c40c695f8054a09b16d72ca936e6c51345d`;
harness log SHA256
`53db7da7191346e11dd11754459c33ec394757d8afb239d4300b927fb29c7066`.

Následný commit tohoto výsledku mění pouze WP; testové bajty zůstávají
identické s registrovaným `9d9d44cf`. Výsledek se nevydává za běh na
budoucím integrovaném SHA. Registry, produktové zdroje, contracts a scripts
zůstaly beze změn. Kandidát čeká nezávislé review a root integraci/publikaci.
