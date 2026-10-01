# WP-M3-REAL-PROJECT-CONTEXT-20261001

**Stav:** `IMPLEMENTATION_GREEN / REGISTERED_PENDING_RUN / REVIEW_PENDING`
**Vlastník:** `/root/full405_diagnosis`; integrace a registry metadata: root.
**Vstup:** publikovaný `0625ee6077c32386d3de34b81f837d19647ada6f`.
**Větev:** `work/m3-real-project-context-20261001`, existující owned checkout
`intentsmith-full405-baseline-oracles-20261001`; žádný nový worktree.

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
| Registrované dvě sady na čistém kandidátu | `PENDING_RUN` |
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
