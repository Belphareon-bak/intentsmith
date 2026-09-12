# Ollama autocheck a pokračování GPU huntu — 2026-09-11

Autorita: explicitní operátorův požadavek na autocheck upgradu Ollamy a
pokračování testování; vlastnictví GPU hunt souborů předané v témže vlákně.
Stav: **AUTOCHECK_RUNNING / PROVIDER_RUNTIME_VERIFIED / HUNT_PILOT_COMPLETE / REVIEW_PENDING**.
M6 acceptance tím není udělena.

## Co je zapojené

`3cb23831` přidal metadata check při startu a v denním cyklu UpgradeManager,
explicitní HTTP check, `ollamaUpdate` v HTTP výstupu a samostatnou CLI.
Kontrola používá pouze loopback `/api/version` a přesný GitHub latest-release
endpoint přes zvláštní capability společné outbound policy. Stejný discovery
opt-out vypne i provider check. Nepovolené URL, query, body, hlavičky a redirect
jsou odmítnuté. Metadata nikdy nepotvrzují runtime kompatibilitu ani instalaci.

Skutečný check našel `0.32.14-intentsmith.1` versus upstream `v0.34.0`, vydaný
2026-09-05. User service `intentsmith-ollama-update-check.service` proběhla
úspěšně; její denní timer je enabled/active. Výsledek a čas jsou v
`~/.local/state/intentsmith/ollama-upgrade/latest.json`, vedle je append-only
outbound audit. GPU hunt timer zůstává disabled/inactive.

`0cbe8e2a` přepojil kandidátní pull na injektovaný UpgradeManager s durable
exclusive claimem a provider intent/outcome. Reálná CLI s injektovaným
transportem doložila existující intent a aktivní exclusive claim **před**
prvním pullem. Po zachycené chybě nedošlo k žádnému chat/cleanup požadavku.
Evaluation, capability a VRAM cesty používají shared artifact claims.
`f4c69aa5` zaznamenal přesně šest potřebných import hran; žádná odebraná,
stejné tři cykly a 28 jejich členů. Ratchet se neoslaboval.

`0e563cc8` brání agregaci provider/authority chyby, timeoutu a neúplné sady
na COMPLETE se skóre nula. Původní kód v kontrolované reprodukci provedl dva
pokusy o COMPLETE zápis, opravený žádný. `CANDIDATE_EVALUATION_RETRYABLE`
zůstává v historii a dovoluje další měření. Timeout transportu se nehodnotí jako nízká kvalita.

## Reprodukovaný provider — skutečná kvalifikace

Binárka z předchozích dvou shodných buildů má SHA-256
`bdd8ca1320a1332b6977a3d7bc4b26d370e4e36c10188b6983998632568b1e20`.
Sidecar běžel pouze na `127.0.0.1:11435`, v bwrap s read-only modelovým
úložištěm a se stávajícím native/CUDA payloadem. Systémový provider se neměnil.

Oba modely `phi4:14b` a `qwen3.5:27b` prošly běžnou odpovědí, streamingem
a skutečným ModelEvaluationRunnerem s očekávaným digestem. Všechna stream
data nesla shodný digest, finální zpráva `done=true`. Placement při kontextu
4096 byl celý v GPU: přibližně 9,07 a 15,20 GiB. Šest chat requestů ověřuje
provider kontrakt, není quality scoring. Po běhu se sidecar ukončil;
systémový inventář a verze zůstaly shodné a `/api/ps` prázdné.

První dva přípravné pokusy jsou zachované: chybný přesný tag `phi4:latest`
a nerozmístěný native payload; pak chybějící M6 claim tabulky ve staré DB.
Samotný cwd `/usr/local` nestačí — knihovny musí být u binárky podle jejího
layoutu. Úspěšný třetí pokus používal konzistentní kopii původní DB s aktuálními
migracemi. Původní databáze ve starém checkoutu se nemigrovala.

## Deterministické ověření

Finální kód `0e563cc8` prošel v čistém klonu všemi **352/352** programy,
bez FAIL/TIMEOUT/BLOCKED/SKIPPED. Všech 352 log hashů bylo znovu ověřeno.
Report SHA-256 je
`a7152097e5b27632f1bec0b1674513145f8bc142bd9a7c5c76bf386827f1e48b`.
Cílené sady zahrnují outbound policy, model upgrade, candidate trial,
evaluation runner, VRAM, pairwise a artifact/boundary kontroly.

První kompletní běh na `3cb23831` měl 351 PASS / 1 FAIL kvůli třem novým
import hranám bez aktualizovaného exact-edge baseline. Související census
kontroly v přípravě také poctivě selhaly, dokud nebyly aktualizované aktuální
počty a očekávané znění. Původní reporty a logy se zachovaly.

## Provozní pilot a důkazy

Pilot `devstral-small-2:latest`, role CODE, limit 1, používá systémový provider
a oddělenou migrovanou `pilot.db`. Spuštěn na `f4c69aa5`; navazující oprava
agregace vznikla po načtení modulů pilotního procesu. Pilot není clean-tree
acceptance a není vydáván za měření novější revize.

Pilot doběhl exit 0. Pull má durable `SUCCEEDED`; model se při 32768 tokenech
vešel celý do GPU (18,30 GiB) a dosáhl 48,5 tok/s. Capability minimum prošlo
3/3. CODE má sedm úloh po třech opakováních, všech 21 odpovědí je neprázdných.
Model digest je
`24277f07f62db8f9cb68e9dfc679ea1818a7fbac47a50eff0a701d3f645b63c8`.
Nový COMPLETE `eval_1a4df92f-da25-4758-bf9e-3f0b1fa5adfe` pokrývá interval
2026-09-11 **18:54:57.771–18:58:38.013 UTC**, skóre 0,36190476.
Incumbent `qwen3.5:27b` má na stejném kontraktu 0,31746032; dvě stabilně
rozlišující úlohy skončily 1:1. Proto se uložil `INCUMBENT`, decision
`decision_08c42983-00c5-46d6-b86f-7eb34e8e8b7e` v **18:58:51.655 UTC**.
Není to doporučení k aktivaci.

Samostatný proces během skutečné inference nedostal exclusive pull claim
(`MODEL_MUTATION_ACTIVE_USE`), bez provider effectu. Po dokončení jsou všechny
claimy uvolněné, DB `quick_check=ok`, `/api/ps` prázdné. Devět původních digestů
zůstalo shodných; jediný nově instalovaný artefakt je explicitní kandidát.
Scoring a decision jsou v pilotní DB, nikoli v původní provozní DB.

Raw root:
`/home/belphareon/Projects/coworker/intentsmith-ollama-check-20260911-jBbRIK/`.
Obsahuje `provider-qualification.json`, přípravné v1/v2 chyby,
`pull-authority-before-effect.json`, `failed-inference-comparison.json`,
`scheduled-check-result.json`, `timer-state.json`, `pilot.db`,
`hunt-pilot.log`, `pilot-decision.json`, `live-claim-probe.json`,
`pilot-provider-journal.log` a `final-test-verification.json`.
Finální test report:
`/home/belphareon/is-hunt11/.intentsmith-artifacts/test-runs/ollama-hunt-failed-inference-fixed/report.json`.

Nezávislé review, sjednocení provozní DB/checkoutu, podporované opakované
měření a rozlišitelnost ostatních rolí zůstávají otevřené. Nová binárka se
neinstalovala, upstream patch se nepublikoval a role bindingy se neměnily.
