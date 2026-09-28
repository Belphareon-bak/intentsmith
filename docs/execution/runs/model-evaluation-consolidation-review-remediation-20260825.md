# Model evaluation consolidation — review remediation

**Datum:** 2026-08-25
**WP:** `WP-MODEL-EVALUATION-CONSOLIDATION`
**Stav:** `ACCEPTED`
**Původní odmítnutý candidate:** `31234a6b67dfded03fbd49a00db204f4bbf3f365`
**Otestovaný remediation source head:** `5b7d259b3ecce72d2b02eabc4f83e3a966c0d20a`
**Přijatý review candidate:** `d8a2a1081e48b18f6cc71de0ee851c46407d75b8`

Toto je přijatá remediace po prvním nezávislém verdiktu
`CHANGES_REQUESTED`. Následný nezávislý rereview skončil `PASS`; podrobnosti
jsou níže a původní odmítnutá evidence zůstává historicky zachovaná.

## Rozsah rereview

```bash
git diff --find-renames 31234a6b67dfded03fbd49a00db204f4bbf3f365..HEAD
```

## Uzavření nálezů

| # | Nález review | Remediace | Strážní důkaz |
|---:|---|---|---|
| 1 | contract SHA neviděl skutečný prompt, rubric, language ani VISION bytes | Každá úloha nese explicitní `contractMaterial`; hash pokrývá skutečný prompt, rubric, language, grader/uzavřené vstupy, options, repeats, image digests a CODE `buildPrompt()` | produkční `textTask` tvar mění SHA; rubric/language/grade inputs, VISION bytes a CODE prompt mají regresní test |
| 2 | migrace 082 padala na zápisu vzniklém po 070 | 082 před preflightem doplní chybějící souhrny jako ne-reusable `BLOCKED / LEGACY_EXACT_IDENTITY_UNKNOWN`, pak ověří přesnou shodu a archivuje | čistý upgrade, post-070 write i kolizní/tamper větev mají DB test |
| 3 | governor duplikoval current-evaluation SQL | `health-analyzer` sestaví inventory/bindings a čte výhradně `ModelEvaluationReadModel` | governor focused suite |
| 4 | CODE contract a task supply závisely na `git show`; dirty provenance; deleted task | Fixture schema 3 commitne prompt snapshots; contract se sestaví bez historie. Historický oracle je samostatný pre-pull `CODE_FIXTURE_RUNTIME_UNAVAILABLE`, nikoli model score. Odstraněny tasky nad zrušenými scoring cestami a fixture se generuje z clean source revision | missing-history contract test, pre-provider block test, clean provenance test |
| 5 | usage digest se razítkoval desired bindingem | Gateway používá provider digest nebo exact `/api/tags` inventory pod shared model-use lease; jinak `NULL` | concurrent desired-rebind test zachová digest skutečně servírujícího artefaktu |
| 6 | cleanup byl pro neověřitelné usage fakticky inertní | Served inventory nyní umožní exact usage i mimo binding. Neověřitelný digest nadále záměrně fail-close blokuje destruktivní cleanup; model bez usage používá jen provider `modified_at` grace clock | model-use a model-registry retention testy; omezení je explicitně v decision/docs |
| 7 | změny test registry nebyly zveřejněné | Viz samostatné disclosure níže; deterministic čísla se neprezentují bez změny scope | registry validátor a explicitní diff |
| 8 | speed decision branch byla v runtime mrtvá | Větev i policy field byly odstraněny. Rychlost je pouze provozní metrika; nulový kvalitativní signál je `QUALITY_INCONCLUSIVE` | výrazná speed výhoda nesmí vyrobit kandidátního vítěze |
| 9 | DB outcome větvil na českém prose `basis` | Decision nese stabilní `reasonCode`; store neznámý enum odmítne a outcome mapuje jen z enumu | změna lokalizovaného `basis` nemění `INCONCLUSIVE` outcome |

## Test-registry disclosure

Tyto tři změny byly už součástí odmítnutého kandidáta a nejsou novým důkazem
remediace:

- `tests/chat-export-budget.test.js`: `offline → manual`, stav zůstává
  `BLOCKED`, protože vyžaduje deklarovaný `python-pdf-runtime` mimo standardní
  deterministic fixture;
- `tests/export-pdf-docx.test.js`: stejné `offline → manual`, stav zůstává
  `BLOCKED` ze stejného důvodu;
- `tests/studio-electron-boundary.e2e.js`: soak `BLOCKED → ACTIVE` s existující
  last-green revizí `c35e47bb48883e2ac88682a393d971e63e72db83`; soak není součástí
  offline+database deterministic počtu.

Proto původní tvrzení `227 PASS / 0 BLOCKED` znamenalo jen registrovaný
`offline,database` scope po této reklasifikaci. Není to důkaz, že dva PDF testy
přestaly být `BLOCKED`, a nesmí se tak interpretovat.

## Finální lokální evidence

Otestovaný source head se skládá z těchto čtyř remediačních checkpointů:

```text
5b7d259b test: accept model evaluation read authority edge
e6cc6ebb refactor: keep evaluation outcome mapping boundary-local
526e0248 test: pin clean code evaluation fixture
d66643da fix: address model evaluation review findings
```

Focused brány nad tímto zdrojem:

| Brána | Výsledek |
|---|---:|
| schema migrations | 38 PASS / 0 FAIL |
| consolidation migration + decision store | 8 PASS / 0 FAIL |
| `ModelEvaluationReadModel` | 8 PASS / 0 FAIL |
| role evaluation suites | 16 PASS / 0 FAIL |
| model upgrade/history/contracts | 60 PASS / 0 FAIL |
| pairwise trial | 33 PASS / 0 FAIL |
| candidate trial | 33 PASS / 0 FAIL |
| CODE patch suite | 22 PASS / 0 FAIL |
| model registry current authority | 11 PASS / 0 FAIL |
| model-use/gateway digest authority | 24 PASS / 0 FAIL |
| governor | 73 PASS / 0 FAIL |
| routes smoke | 109 PASS / 0 FAIL |
| WS bridge | 86 PASS / 0 FAIL |
| tool registry E2E po opravě prostředí | 82 PASS / 0 FAIL |
| module-boundary ratchet self-test | 13 PASS / 0 FAIL |
| repository hygiene | PASS, 1 638 tracked paths |

Boundary baseline přijal přesně jednu novou hranu
`health-analyzer.js → model-evaluation-read-model.js` a současně odstranil
starou hranu `health-analyzer.js → role-evaluation-plan.js`. Výsledný graf je
`1 064/1 064`, `added=0`, `removed=0`, tři existující cykly a žádný růst.

Registry validátor: `valid=true`, 384 runnable programs, 8 explicit support
exclusions, fingerprint
`a2c4d29e6bcc09bea6fc3baca03c339bbb79a662b0b1a2f6dbebce9116948fd3`.

Finální celý scope:

```text
command: C3_LOG_LEVEL=error npm run test:deterministic
run: 2026-08-25T17-00-16-156Z
sourceRevision: 5b7d259b3ecce72d2b02eabc4f83e3a966c0d20a
profiles: database,offline
concurrency: 1
verdict: PASS
PASS=227 FAIL=0 TIMEOUT=0 BLOCKED=0 SKIPPED=0
requiredFailureCount=0 requiredBlockedCount=0
reportSha256=c508b512780d2d28d992fe6ae6ae42cb6b8bc8465bf12f1fc1d5f1b432149eff
```

Evidence dokument je po tomto běhu jediná následná změna; produkční zdroj ani
testy se po source headu `5b7d259b` nemění.

### Zachované mezilehlé non-PASS

- před clean regeneration fixture: CODE `21 PASS / 1 FAIL`, protože provenance
  pravdivě nesla `workingTreeDirty=true`; po commitu čistého zdroje a nové
  fixture `22/0`;
- první boundary kontrola: `1 065` proti baseline `1 064`; po odstranění
  zbytečného decision-store importu stále explicitní výměna `1 added / 1
  removed`; teprve jmenovitý integrátorský zápis vytvořil `1 064/1 064` PASS;
- první pokus o deterministic: `NOT RUN`, clean-worktree guard odmítl
  necommitnutý root symlink `node_modules`; `--allow-dirty` nebylo použito;
- první dokončený deterministic run `2026-08-25T16-57-38-026Z`:
  `226 PASS / 1 FAIL`, required failure
  `IS-T1-TESTS-TOOL-REGISTRY-E2E-TEST`. Pomocný symlinkový dependency strom
  neposkytl skutečné package adresáře pro `deps.licenses` a `deps.size`.
  Report SHA-256:
  `0e51f6d98dde6fe959f6d7efeefb55bc46529eea9a897de9c9ae1600187afa4d`;
- po standardním `npm ci --offline` selhaný program prošel `82/0` a následující
  celý run prošel `227/0`. Původní FAIL se tím nemaže ani nepřepisuje.

## Host/GPU pravda

- nový ostrý hunt, pull, inference panel a VRAM measurement: `NOT RUN`;
- remediace ani její lokální brány GPU/Ollama nepotřebují a nemění binding;
- žádný stav z předchozího panelu se nepovyšuje na current-contract PASS,
  protože opravená suite identity vytváří nový contract SHA.

## Nezávislý rereview a přijetí

Operátor 2026-08-25 potvrdil verdikt `PASS` nad nezměněným kandidátem
`d8a2a108` a samostatně doložil:

- mutace textového promptu, rubric, language, grading oracle a VISION pixelu
  mění SHA právě dotčených sad; COMPLETE run pod starým SHA čte read model jako
  `MISSING`. Kontrolní SHA začínají CHAT prompt `282a6ca5`, R2 rubric
  `021622d4`, CHAT language `510fe22b`, D1 oracle `f0a93845` a VISION pixel
  `3dff3485`;
- pět scénářů migrace 082: konzistentní A–D zachovají runy i import evidence,
  v úplném panelu `legacyRuns=5`, `importEvidence=5`; nekonzistentní kolize E
  nadále fail-close končí `THROWS`;
- CODE contract je stejný s dostupnou i nedostupnou historií, chybějící oracle
  vrací `CODE_FIXTURE_RUNTIME_UNAVAILABLE` a všech sedm úloh se při dostupné
  historii hydratuje přes `CodePatchEvaluationRunner.prepare()`;
- governor, observed usage digest pod shared lease, odstraněná speed větev a
  stabilní decision reason codes odpovídají deklarovanému kontraktu;
- nezávislý deterministic run `2026-08-25T17-15-48-322Z` skončil
  `verdict: PASS`, `227/227`.

Tím je review gate uzavřený a WP přechází na `ACCEPTED`. Nový ostrý GPU/Ollama
panel nebyl součástí tohoto acceptance a zůstává pravdivě `NOT RUN`.

## Neblokující follow-upy

Rereview ponechal šest drobných nálezů, které nemění verdikt ani autoritativní
kontrakt a nesmějí být vydávány za součást hotové remediace:

1. zpřesnit komentář v `gateway.js` u observed usage digestu;
2. odstranit opt-in povahu `gradeMaterial` nebo ji silněji typově vynutit;
3. zjednodušit negovaný `workingTreeDirty` zápis v `build-code-suite`;
4. transakčně obalit smyčku zápisu decisions v `model-upgrade-hunt.js`;
5. nere-konstruovat read model pro každé `analyzeUpgrades`;
6. sjednotit tvar `bindingAuthority`.

Následný whole-repo audit dalších zastaralých implementací je tímto odemčený;
není skrytě započítán do acceptance tohoto WP.
