# Soukromý IDE 2.0 CODE composer probe

Stav: **CANDIDATE / REVIEW_PENDING / LIVE_NOT_RUN**. Tento adresář je ignorovaný Gitem a není nový release. Předchozí balíky `ide2-code-dom-physical-candidate-20261001` a `ide2-code-dom-physical-successor-20261001` mají nezávislé verdikty **CHANGES_REQUIRED** a zůstávají beze změny. Druhý balík neukončoval klientské spojení po useknuté upstream odpovědi; skutečné callbacky obou vrstev a surové výsledky jsou v `gate0-review-ide-successor-4a61/actual-relay-error-*`. Dřívější CPU průchod `ide2-m2-success-cf67-20261001-1006` s předem známými výstupy a historické neúspěchy `0951`, `0958`, `1002` zůstávají oddělené.

## Skutečný průchod

`host.mjs` při `--preflight` pouze ověří čistý stage HEAD `483fb2d957ed20d48dbf508c82837b7d1824176f`, AppImage ze zdroje `45caf5b54b78def257221ac2ab33a64031800813`, byte shodu 1178 GUI/backend souborů s `cf67e83f2e7cf654bc8900f7b4dde434411cc0b2`, Node/native SQLite, zmrazený ledger oracle a veřejný blueprint. Před spuštěním zabaleného Node ověří připnutý `SHA256SUMS` a skutečné bajty všech 16 313 deklarovaných členů balíku; chybějící, změněné, cizí nebo symlink členy zamítne. Z instalovaného `m2-composer` ověří `normalizeProposal → createForm → composerDraft` včetně `gitCommit`, testu a explicitních `contextFiles: []`. Kanonický compiler generuje v pořadí `totals, validate, storage, service, cli, app`; lokální kontrola per-path provider proof zamítá prohozené preview, chybějící generaci, chybný digest, chybějící či prázdnou verzi poskytovatele i chybu relay. `--preflight` se nepřipojuje k Ollamě, GPU ani GUI.

Živá varianta po nezávislém přijetí tohoto balíku a kontrole aktuálního GPU/provider stavu požaduje všech devět pinů: `--out NEW_ABS` (dosud neexistující přímý podadresář `.intentsmith-artifacts`), `--stage-sha`, `--package-sha`, `--appimage-sha`, `--host-sha`, `--probe-sha`, `--config-sha`, `--model`, `--digest`. Uživatelská autorizace dokončit a testovat projekt platí; nejde o žádost o další souhlas. Konkrétní hashe přečti z aktuálního `PREFLIGHT.json`; model a jeho digest musí být čerstvě ověřené v provider inventory. Použij Node 24 a X11 proměnné `DISPLAY` a `XAUTHORITY` nebo `INTENTSMITH_STUDIO_XAUTHORITY`.

Přesný příkaz pro serializovaný běh po přijetí balíku; `CODE_MODEL`, `CODE_DIGEST` a nový název výstupu doplní operátor podle čerstvého provider stavu:

```bash
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node \
  /home/belphareon/Projects/intentsmith-ide2-staging-20261001/.intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/host.mjs \
  --live \
  --out /home/belphareon/Projects/intentsmith-ide2-staging-20261001/.intentsmith-artifacts/ide2-code-dom-physical-NEW-UTC \
  --stage-sha 483fb2d957ed20d48dbf508c82837b7d1824176f \
  --package-sha 45caf5b54b78def257221ac2ab33a64031800813 \
  --appimage-sha 40b016d0316d12aabcb55270d561de89a8058dbd7f21d597718907eee58aed57 \
  --host-sha 63039d91a7dfba8d85e86cd8fdab1ceee2e8acc0c3e86c4a22e9f74c6fc88d29 \
  --probe-sha 671ded498b53a327b380ebff951711c27d79c4c8c4977e8225fa3fd7f182f346 \
  --config-sha 8396d27ce916c26ab21a104f79985204f83480d27a550c3937893045a8f6b2b2 \
  --model "$CODE_MODEL" --digest "$CODE_DIGEST"
```

Host získá sdílenou GPU lease, požaduje prázdné `ollama ps` a žádný NVIDIA compute proces, ověří instalovaný přesný digest i neprázdnou platnou verzi poskytovatele a uloží surovou odpověď `/api/version`. Spustí privátní UDS proxy dovolující pouze daný model a potřebné metadata endpointy. Každý vlastní upstream HTTP požadavek je navázaný na downstream abort/close; upstream `error`, `aborted` či neúplné `close` v obou vrstvách ukončí downstream a zapíše chybu relay. Host po drain znovu vyhodnotí provider attestation včetně pozdní chyby. Při cleanup se ruší a čeká se na close požadavku i odpovědi před uvolněním lease. Pokud se spojení neusadí, běh selže a lease se v tomto procesu neuvolní. Soukromé `unshare`/`bwrap` prostředí má loopback, nový projekt a SQLite. Host kopíruje X11 cookie do dočasného souboru pod vlastním výstupem a po běhu jej maže. Automaticky nevypíná rezidentní model, protože souběžného cizího uživatele stejného digestu nelze bezpečně odlišit.

V AppImage se založí projekt a konverzace. Operátorův oracle, probe, CLI entry a policy se zapíšou a commitnou **před prvním modelem**; `BEFORE-MODEL.json` fixuje jejich hashe a původní projekt. Výslovný fixture seed vloží do aktivní IDE relace `_projectWorkProposal={origin,proposal:{kind:'ProjectWorkProposal@1',projectId,draft:ledgerBlueprint}}`. Viditelné tlačítko otevře skutečný composer, druhé jej odešle; očekává se právě jeden `POST /api/m2/lifecycle/draft` a šest CODE generací. Host porovná přesný provider `afterContent` s preview podle compiler target path, modelu, digestu, provider verze a úplného terminálu.

Následuje přesný DOM diff a kontrola nulových změn na disku před kliknutím na `Schválit`, jediný approval s celým `planDigest` a `origin`, běh operator-owned funkčního oracle ve standardním M2 sandboxu, přesný obsah šesti souborů v Git commitu, reálný restart privátního backendu a nový read-only SQLite proces s totožným terminálem, CODE bindingem a nulou chatových tahů. Výstupy jsou v novém soukromém adresáři. Modelová či aplikační chyba zůstane `FAIL`; i pak host uchová provider attestation odděleně od funkčního verdiktu.

## Ověření bez inference

```bash
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --check .intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/host.mjs
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --check .intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/probe.mjs
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node .intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/selftest.mjs
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node .intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/relay-integration.mjs
/home/belphareon/.nvm/versions/node/v24.21.0/bin/node .intentsmith-artifacts/ide2-code-dom-physical-response-guard-20261001/host.mjs --preflight
```

Při úspěchu fyzického průchodu jde pouze o **omezený důkaz packaged IDE + CODE + M2 ledger**. Neprokazuje nové zabalení ze současného zdroje, kvalitu jiných modelů/projektů, CHAT ani produkční nasazení.
