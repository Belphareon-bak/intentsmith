# WP-M3-REAL-PROJECT-CONTEXT-20261001

**Stav:** `AUTHORIZED / IMPLEMENTATION_PENDING / REVIEW_PENDING`
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

```sh
node tests/m3-code-review-specialist.test.js
node tests/harness-exit-code.test.js
node scripts/nightly-audit.js --suite=IS-T1-TESTS-M3-CODE-REVIEW-SPECIALIST-TEST,IS-T1-TESTS-HARNESS-EXIT-CODE-TEST --run-id=m3-real-context-candidate
```

Třetí příkaz bude před spuštěním ověřen vůči skutečným registry ID.
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
