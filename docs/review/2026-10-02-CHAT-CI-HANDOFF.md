# Chat CI — konkrétní návrh pro vlastníka integrace

Stav: **PROPOSAL / OWNER_UNKNOWN / CI_NOT_RUN**. 2. 10. 2026.
Autorita: operátor požaduje vyřešit zapojení chatové větve do CI s vlastníkem
integrace. Tento dokument je předávací návrh, nikoli přijatá změna workflow.

Ověřený `main`: `838b8cee038db027691072d293eb00153854f81e`.
Jeho `.github/workflows/ci.yml` má PR, push na `main` a
`integration/main-reconcile-*`, také `workflow_dispatch`. Chatová větev
`work/chat-quality-20261001` v push filtrech není. Její vlastní verze navíc
obsahuje cizí `work/real-chat-journeys-20260930`; tuto větev neodstraňovat.
MCP dotaz na `38ca74c3` vrátil nula **PR-triggered** běhů. Tento nástroj filtruje
jen PR a sám neprokazuje nepřítomnost ručního nebo push běhu. Nemáme doložený
CI výsledek tohoto kandidáta. Draft PR dříve nevzniklo kvůli GitHub 403.

Navrhuji zachovat společný vývojový workflow a přidat dvě věci:

1. Do jeho push filtrů konkrétně `work/chat-quality-20261001` (ne všechny
   pracovní větve). Alternativou je vlastníkovo ruční `workflow_dispatch`
   na přesném kandidátním SHA, případně PR vytvořené jeho oprávněním.
2. Vedle současných kontrol spustit sedm registrovaných chatových sad níže.
   Ověřují kontext/archiv, skutečné M1/M2 hranice, doslovný zápis, opakované
   uložení a runner. Nevyžadují živý model. Nezastupují významovou živou
   přejímku, celých 406 offline/DB sad ani release bránu.

Konkrétní krok k začlenění po schválení vlastníkem:

```yaml
- name: Install chat isolation tools
  run: |
    sudo apt-get update
    sudo apt-get install --yes bubblewrap iproute2 util-linux
- name: Verify chat context and approved effects (offline)
  run: >-
    node scripts/nightly-audit.js
    --run-id=ci-chat-${{ github.run_id }}-${{ github.run_attempt }}
    --suite=IS-T1-TESTS-CHAT-CONTEXT-INTERPRETATION-TEST,IS-T3-TESTS-CHAT-LITERAL-WRITE-HTTP-TEST,IS-T3-TESTS-CHAT-REPEAT-SAVE-HTTP-TEST,IS-T1-TESTS-CHAT-RESILIENCE-RUNNER-CONTRACT-TEST,IS-T3-TESTS-CRE-BUILD-ARBITRATION-TEST,IS-T2-TESTS-M1-CHAT-CONTRACT-TEST,IS-T1-TESTS-MODULE-BOUNDARY-RATCHET-TEST
    --concurrency=1
    --allow-blocker=toolchain:bubblewrap,toolchain:bwrap,toolchain:git,toolchain:prlimit
- name: Preserve chat audit reports
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: chat-audit-${{ github.run_id }}-${{ github.run_attempt }}
    path: |
      .intentsmith-artifacts/test-runs/ci-chat-*/report.json
      .intentsmith-artifacts/test-runs/ci-chat-*/checkpoint.json
    if-no-files-found: warn
```

`--allow-blocker` zde autorizuje konkrétní nástroje izolované sady; nepřeznačí
neprovedený test na PASS. Nezapínat `--no-block` ani `--allow-dirty`. Pokud
GitHub runner neumožní požadovanou izolaci, zachovat BLOCKED a řešit prostředí.
Vzdálené stažení závislostí a apt nástrojů patří instalaci CI; samotný audit
má používat své registrované síťové izolace. Node 24 zůstává kvůli SQLite ABI.

Lokální důkaz na `856e07c3`: všech sedm sad PASS, kontext 17/17 a M1 74/74.
Nová runner sada na `97395516` také PASS. GitHub prostředí zatím ověřené není.
Známé čtyři FAIL a tři BLOCKED celého profilu se tímto výběrem nesmějí skrýt.

K dokončení předání chybí jméno/identita a komunikační kanál vlastníka
integrace; otázka operátorovi je otevřená. Potom předat tento konkrétní krok,
nechat vlastníka určit společný workflow/ruční spuštění a zkontrolovat SHA,
job kroky, výsledek a uložený report. Bez tohoto důkazu stav zůstává CI_NOT_RUN.
