# P10 CORE / OPTIONAL map — Phase A review evidence

phaseA.integrationRef: integration/gate1-prod-ready-20260809
phaseA.baseRevision: 35febb5dea194f619c838dda368082d246b8af4d
phaseA.subjectHead: 80a30e0ad09d4f87a804f2fb7a0fcc1cc2c2cc7a
phaseA.reviewA.verdict: PASS

## Rozsah Phase A subjectu

- subject je přímý potomek accepted integration base a mění přesně šest
  kontraktem povolených cest, všechny jako `100644 blob`;
- přidává pouze validator, jeho offline test/fixture, jednu rezervovanou
  registry položku a branch-local generovaný registry ledger;
- `src/**`, graph scanner, oba boundary ratchety/baseline, root `README.md` a
  tento run report zůstaly v subjectu beze změny;
- nejde o file-level klasifikaci, zapnutí directional railu ani Phase B
  measurement evidence.

## Validator contract

- CLI vyžaduje absolute co-located graph/map paths, exact clean Git `HEAD` a
  plný `--source-revision` před i po validaci;
- exact bytes `module-graph.json` jsou svázané SHA-256 a oba artefakty se po
  validaci znovu čtou, aby změna během běhu skončila fail-closed;
- graph musí být protocol 1 z `scripts/module-graph.mjs`; jeho unikátní
  `fanIn[].file` census musí odpovídat `counts.srcFiles`;
- mapa dovoluje pouze `CORE`, `OPTIONAL` a `UNRESOLVED`, právě jeden řádek na
  každý graph file a neprázdný R1 reason pro `OPTIONAL`/`UNRESOLVED`;
- všechny a pouze skutečné `CORE -> OPTIONAL` exact edges se znovu odvodí z
  graphu a rows; `inSameCycle` se znovu odvodí ze SCC místo důvěry mapě;
- duplicitní JSON klíče i neznámá mapová pole jsou odmítnuta předtím, než by
  mohla vytvořit druhou autoritu.

## Nezávislé Review A a reprodukce

- focused validator matrix: 16/16; pokrývá duplicate/missing/foreign row,
  neznámou značku, count, reason, digest, missing/extra edge, SCC, Git state a
  artifact path negativní případy;
- test registry: 380 programů, 8 exclusions, fingerprint
  `50d4b6d9314301214318f738ebe7b4ed810837981a22f280da8b79eb94a81b95`;
- repository hygiene: 1 556 tracked cest;
- module boundary ratchet: 1 024/1 024, added/removed `0/0`, 3 cykly a 28
  souborů v cyklech;
- Node `v22.21.1`, npm `10.9.4`, `npm ci --offline`: 233 balíčků a 0 známých
  zranitelností;
- base ancestry, no-renames allowlist, Git modes, `git diff --check`, immutable
  SHA a clean status prošly; bounded independent verdict je `PASS` bez
  HIGH/MEDIUM nálezu.

Samostatný clean-clone protocol smoke nad skutečným graph protokolem přijal
426 přesně pokrytých files a 1 024 hran; všech 426 dočasně označil
`UNRESOLVED`, proto nejde o Phase B klasifikaci ani evidence claim a jeho
externí artefakty byly po kontrole odstraněny.

## Queue collateral před Review B

Dobrovolně spuštěná širší artifact validation na subjectu skončila pravdivě
150/151: jediný červený bod jsou root README registry počty `379/281`, protože
Phase A subject `README.md` vlastnit nesmí. Podle `CONTRACT.md §6` queue
integrátor před Review B mechanicky synchronizuje právě čtyři odvozené hodnoty
na `380/282` a ponechá `BLOCKED=82`, `KNOWN_DEFECTIVE=0`, `HISTORICAL=16` i
veškerou ostatní prose byte-identickou. Candidate bez této reconciliation
nesmí dostat Review B PASS.
phaseA.candidateHead: f9fac5e3f4c731703e43ba8821a8cd6106fba862
phaseA.reviewB.verdict: PASS
