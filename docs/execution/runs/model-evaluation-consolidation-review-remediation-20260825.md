# Model evaluation consolidation — review remediation

**Datum:** 2026-08-25
**WP:** `WP-MODEL-EVALUATION-CONSOLIDATION`
**Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING (rereview)`
**Původní odmítnutý candidate:** `31234a6b67dfded03fbd49a00db204f4bbf3f365`
**Remediation head:** doplní finální evidence commit

Toto je nový review candidate po nezávislém verdiktu `CHANGES_REQUESTED`.
Neznamená `ACCEPTED` a nenahrazuje nový nezávislý rereview.

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

Tato sekce se vyplní po clean fixture regeneration a finálních branách. Každý
non-PASS zůstane uvedený a nový GPU/Ollama panel zůstává pravdivě `NOT RUN`.

## Host/GPU pravda

- nový ostrý hunt, pull, inference panel a VRAM measurement: `NOT RUN`;
- remediace ani její lokální brány GPU/Ollama nepotřebují a nemění binding;
- žádný stav z předchozího panelu se nepovyšuje na current-contract PASS,
  protože opravená suite identity vytváří nový contract SHA.

## Zbývající gate

Pouze nezávislý rereview může tento candidate změnit z `REVIEW_PENDING` na
`ACCEPTED`. Následný whole-repo audit dalších zastaralých implementací začne až
po přijetí tohoto WP a není skrytě započítán do tohoto výsledku.
