# WP-WORKSPACE-BUDGET-INTEGRATION — bezpečný rozpočet pracovní plochy

**Typ:** zapisující provozní hardening · **Stav:** `IN_PROGRESS`
**Vstupní revision:** `5ed1247a` · **Větev:** `codex/workspace-budget-integration-20260829`

## 1. Uživatelský výsledek

Decision 031 je součástí současné produktové linie a jediný CLI nástroj umí
pravdivě rozlišit bezpečně odstranitelný worktree od dirty, používaného,
detached nebo evidence-bearing checkoutu. Úklid smí odstranit jen starší
jednorázové sandboxy bez důkazů.

## 2. Povolené a zakázané cesty

Vlastněné jsou `CONTRACT.md`, agent entrypointy/protokol, Decision 031,
`scripts/workspace-budget.sh`, jeho focused test, registry/census dokumenty a
closeout/review evidence. Zakázané je odstranit dirty nebo aktivní checkout,
smazat report/checkpoint/inventory/logs, měnit cizí branch, použít plošné mazání
artifact rootu nebo zasáhnout GPU/Ollama.

## 3. Connector a vstup

Connector je lokální CLI `workspace-budget.sh` s režimy `report` a
`clean [--yes]`; nemění produktové HTTP/WS/API. Vstup je current Git common
repository a jeho registrované worktree.

## 4. Malá demonstrace

Temp-Git fixture obsahuje hlavní checkout, čistou absorbovanou větev, dirty
absorbovanou větev a detached checkout. Report musí zobrazit všechny čtyři a
jen čistý, process-free, evidence-free checkout označit `RETIRABLE`. Clean
dry-run nic nezmění; `--yes` odstraní starý sandbox, zachová nejnovější a každý
evidence-bearing adresář.

## 5. Negativní test

Chybějící/non-Git repo, neznámý argument, dirty worktree, detached checkout,
evidence uvnitř sandboxu, cesta mimo `.intentsmith-artifacts`, newline v cestě a
selhání bezpečnostní kontroly musí skončit bez destruktivního efektu.

## 6. Stop condition

Zastavit, pokud by úklid vyžadoval odstranění cizího dirtu, živého procesu nebo
nepřenesené evidence. Tyto případy se evidují jako chráněná výjimka, ne jako
úspěšný úklid.

## 7. Ověření

```bash
node tests/workspace-budget.test.js
node scripts/validate-test-registry.js --json
node tests/artifact-validation.test.js
git diff --check
```

## 8. Handoff

Closeout připne exact candidate, skutečný workspace census před/po, odstraněné
jednorázové sandboxy, zachované důkazy a všechny nevyřešené chráněné výjimky.
