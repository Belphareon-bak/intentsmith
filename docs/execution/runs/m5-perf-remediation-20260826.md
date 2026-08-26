# M5 PERF review remediation — 2026-08-26

**Verdikt:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`

## Připnutý produktový kandidát

- product commit: `034e00f58d35971ff390256f8eaf878361d33dde`;
- candidate tree: `882d567980721471516136f98385111fe8b6916c`;
- branch: `codex/m5-integration-20260826`, bez upstreamu a pushu;
- před i po měření: exact stejný HEAD/tree a čistý tracked/untracked source;
- GPU/Ollama: nepoužito, žádný proces ani model nebyl měněn.

## Uzavření PERF review nálezu

Původní `M5PerformanceEvidence@1` ověřoval jen tvar SHA a callerem dodaná čísla.
Nový `M5PerformanceEvidence@2` nese pouze identity autoritativních zdrojů:

- current raw artifact: relativní cesta pod `.intentsmith-artifacts`, SHA-256 a
  byte count;
- candidate: exact Git commit a tree;
- inherited baseline: exact revision, path, Git blob OID a SHA-256.

Evaluátor znovu otevře raw soubor, ověří jeho digest a kontrakt a current
summaries odvodí z raw latency samples. Baseline metriky čte přes `git show`
z připnutého objektu a odvozuje je exact, ambiguity-rejecting parserem. Chybějící
repo/root, candidate mismatch, dirty worktree v runneru, chybějící zdroj,
změněný blob/digest, dvojznačný text nebo poškozený raw artefakt skončí `FAIL`
před budget checks.

Publikace raw i envelope používá `wx`/`O_EXCL`, mód `0600`, fsync souboru i
adresáře. Sonda proti již existujícímu raw path vrátila `EEXIST`; SHA a bajty
zůstaly nezměněné.

## Autoritativní historické zdroje

| Surface | Git source | Blob OID | SHA-256 | Odvozené metriky |
|---|---|---|---|---|
| modelový HTTP chat | `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91:docs/execution/runs/m1-b6-fresh-install-20260823.md` | `598eda44f9f6c3b2e26e95c286ecf204b538ce00` | `0e6c8e3efdaf4e4dbb5b2d3ae42cb9e7862c6fff867fb3da874f071ed74240b7` | cold 51 206 ms; warm p95 55 257 ms; 1,11 turnu/min |
| Studio production journey | stejný M1 B6 blob | stejný | stejný | deterministic 7 ms; model 52 267 ms |
| governed lifecycle | `c14d800ee15084d2b7c25b529a3a3f90102eedc7:docs/execution/runs/wp-m2-execution-v1-20260824.md` | `79d8dbe66c6f1c713f5ef5738ab00fcdc2363c32` | `3445ebdf9c0683bfde8a0563a46974f7739607236fd935ad6e35e7cba874aecd` | 1/1 PASS; 44 204 ms; 0 errors |
| fyzická VRAM | `40ce44ecde9684fa11a0fb8824d49fe45acddd02:docs/execution/runs/wp-m1-model-report.md` | `3092fa7bb1dbef51d7c56570e3d2f3b048336642` | `42b2f7eefd193fc25d11db539347b77b118b3f496ae4d12c81d3827ca0aec13e` | 100% residency; minimum free 5 489 MiB |

Všechny tři zdrojové commity jsou lokální předci kandidáta. Původní pin na
`d518d7ec:...m1-b6...` byl neplatný, protože cesta v tom commitu neexistuje.
Původní lifecycle a VRAM piny mířily na produktový commit před dopsáním hodnot
do reportu. Opravené piny míří na exact dokumentové commity.

Původní Studio `boundedSoakMs=65 800` a `installAndBuildMs=54 000` nebyly v
deklarovaném Git dokumentu. První lokální M1 artefakt ve skutečnosti uvádí
`actualDurationMs=65 869`; druhá hodnota nemá dohledaný autoritativní zdroj.
Obě byly z performance baseline odstraněny. Final-candidate install/build se
prokazuje samostatným PACKAGE fresh-clone gate a ještě je `PENDING`.

## Nový pětiminutový raw důkaz

- envelope:
  `.intentsmith-artifacts/m5-performance-034e00f58d35-20260826195318583-615f816d.evidence.json`;
- raw:
  `.intentsmith-artifacts/m5-performance-034e00f58d35-20260826195318583-615f816d.evidence.raw.json`;
- raw mode/bytes: `0600`, `25 309`;
- raw SHA-256:
  `c26cffa869e8d8434bb1f24f6e69de414a520e9c3cfdf213bf40a31fa3446be5`;
- evaluation: `PASS`, nula failed checks.

| Plocha | Vzorky | p50 | p95 | max | chyby | Trvání | RSS start/peak/end |
|---|---:|---:|---:|---:|---:|---:|---:|
| deterministic HTTP | 40 | 2,635 ms | 6,077 ms | 11,806 ms | 0 | 139 ms | 161,684/165,543/165,543 MiB |
| ProjectContext, 128 files | 40 | 26,404 ms | 34,614 ms | 52,682 ms | 0 | 1 128 ms | 66,648/80,875/80,875 MiB |
| deterministic core soak | 1 498 | 7,191 ms | 15,246 ms | 30,272 ms | 0 | 300 000 ms | 165,566/168,434/151,426 MiB |

## Regrese a širší evidence

- `node tests/m5-performance-budget.test.js`: `14/14 PASS`;
- přesná negativa: forged candidate, wrong tree/revision, missing/truncated/
  digest-mismatched raw, rebound Git SHA, missing Git source, dirty candidate,
  ambiguous parser, malformed contract a non-clobber publication;
- `node --test tests/artifact-validation.test.js`: `154/154 PASS`;
- `node tests/module-boundary-ratchet.test.js`: `13/13 PASS`;
- `node tests/repository-hygiene.test.js`: PASS, `1 849` tracked paths;
- `git diff --check`: PASS.

Plný deterministický gate a final PACKAGE fresh clone budou spuštěny až nad
společným finálním product candidatem. Tento report není nezávislé review ani
M5 acceptance. 24h soak, maximum-throughput a nový fyzický GPU běh zůstávají
pravdivě `NOT RUN`.
