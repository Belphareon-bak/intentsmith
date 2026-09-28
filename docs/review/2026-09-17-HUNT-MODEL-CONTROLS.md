# Studio: výběr kandidátů, test instalovaného modelu a blokace GPU

Následná instalace `08f8d1c5` upravuje vzhled a místní hlášení chyb:
[followup](2026-09-17-HUNT-MODEL-CONTROLS-FOLLOWUP.md). Níže je původní rozsah.

Stav: **IMPLEMENTED / INSTALLED / REVIEW_PENDING / PHYSICAL_SCORING_BLOCKED**.
Autorita je operátorův požadavek a tři snímky Studia z 17. 9. 2026.
Produktový rozsah pro review: `c2989a3e..09cbd0d6`.
Instalovaný a testovaný source: `09cbd0d6f578c89327c9b5eab869b489d813550d`.
Větev: `work/hunt-model-controls-20260917`, pushnuta do originu.
Samostatný dokumentační commit nemění tento source pin.

## Problém a výsledné chování

- **Kandidáti** mají výchozí filtr podle odhadu VRAM a zjištěného rozpočtu,
  vlastní limit v GiB, zobrazení všech nebo instalovaných modelů a řazení
  podle parametrů, odhadované VRAM, kontextu a názvu. Neznámá velikost ani
  neznámá kapacita není potvrzené vejití. Odhad není náhradou za měřený GPU gate.
- **Evaluace** nabízejí `Otestovat` pro konkrétní instalovaný model a roli;
  **Role** mají např. `Otestovat CODE`. Akce načte čerstvou identitu a připne
  modelový SHA-256, roli a kontrakt sady. Nová lokální API cesta vrací 202
  teprve po předání pevného příkazu systemd. Cizí transport, změněná identita,
  obsazený hunt nebo nefunkční GPU se odmítnou před spuštěním.
- Ruční test používá stávající měření placementu, response-bound evaluator,
  opakování a DB historii. Neměří incumbenta jako podmínku výsledku kandidáta,
  nestahuje model, nemaže a nemění role. Platný výsledek stejné identity může
  znovu použít; potvrzovací dialog to uvádí. Nevytváří vítězství v duelu.
- **GPU hunt** ukazuje konkrétní chybu GPU a aktuální stav `BLOCKED`.
  Wrapper zaznamená blokaci před startem sidecaru a zachová stderr při selhání
  podřízeného procesu. Ruční i plánovaný běh sdílejí vlastnictví provideru;
  druhý wrapper nepřepíše stav prvního. Neúplný owner soubor zámku už není
  považován za důkaz mrtvého vlastníka. Instalátor kontroluje i ruční test.

## Proč měl CODE MISSING a proč nyní nelze měřit

Živá instalace má 11 instalovaných artefaktů bez odpovídajícího výsledku CODE
pro aktuální kontrakt
`6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`.
Pro `qwen3.5:27b`, digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
read model vrací `MISSING / SUITE_CHANGED`. Starší skóre z jiné sady zůstává
historickým výsledkem. UI místo samotného MISSING vysvětlí chybějící aktuální test.

Na hostu běží kernel modul NVIDIA **595.84**, knihovna NVML je **595.91**.
Skutečné `nvidia-smi` končí exit 18 s `Driver/library version mismatch`.
Toto není chyba skóre ani důvod smazat model. Je potřeba uložit práci a běžně
restartovat počítač; restart ani odpojování ovladače nebylo provedeno.
Po restartu musí preflight nejprve potvrdit funkční GPU. Do té doby se netvrdí
nové fyzické skóre ani úspěšný scoring celou cestou.

## Ověření

| Důkaz | Výsledek a hranice |
|---|---|
| Celý offline/database profil na `09cbd0d6` | **358 PASS / 1 FAIL / 0 BLOCKED / 0 TIMEOUT** z 359 programů. Celkový verdict **FAIL**. Jediný non-PASS je `nightly-orchestrator-self-test`: registry hash differs from the reviewed Gate 0 policy; stejný nález je zaznamenaný už na základně `c2989a3e`. Release pečeť nebyla měněna. |
| Zaměřené kontroly | desktop-hunt **17/17**, candidate-trial **37**, model-evaluation-read-model **19**, model-upgrade **100** a artifact-validation **158** PASS. Zahrnují odmítnutí změněné identity, nefunkční GPU, transport, souběh wrapperů a měření pouze vybrané role. |
| Studio build | Offline locked dependency install, produkční build a consumer guard PASS. Bundle SHA-256 `8087e8c4501dcabb9f66a048817a1ba5c885a04ce8dd2ebf60477c1c28cdb849`. |
| Fyzický Electron, pokus 5 | **PASS**, deset behaviorálních kontrol scoring UI včetně filtru, řazení a odeslání testu; síťová kontrola PASS. Řízený backend, privátní user/network namespace, `NODE_ENV=test`, diagnostický `--no-sandbox`; capture začíná po startup negotiation. Nedokládá nové modelové skóre. |
| Skutečný instalovaný backend | `GET models/hunt` vrací `BLOCKED / GPU_DRIVER_LIBRARY_MISMATCH`; skutečný lokální `POST models/evaluate` pro Qwen CODE vrací **503** se stejným důvodem. Ruční systemd unit zůstala inactive. |
| Data po instalaci | Shodné hashe všech **503 evaluací, 220 rozhodnutí, 7 desired bindings a 11 binding operations** proti záloze před instalací. `quick_check=ok`, 0 FK chyb. Startup legitimně přidal rehydrate/verification attempts a finalize receipts; celá DB se proto netvrdí jako byte-identická. |
| Instalace a provoz | Čistý detached snapshot `09cbd0d6`; backend a běžná desktop ikona používají nový pin. Launcher `--check` PASS. Timer zůstal active/enabled. Cizí výkonnostní/soak procesy 870665 a 883246 nebyly zastaveny. |

Počty v produkční historii zůstaly **262 COMPLETE / 209 BLOCKED / 32 FAILED**.
Tato práce nepřidala žádný inference run, nesmazala model a nezměnila přiřazení.
Nainstalovaná aplikace přebírá i souběžný produkční closeout `c2989a3e`; jeho
změny nebyly přepsány. Před instalací vznikla DB/config záloha pod
`~/.local/state/intentsmith/installation-backups/2026-09-17T16-45-23-007Z`.
Běžné spuštění zachovává již existující uživatelský souhlas `allow-no-sandbox`;
nový souhlas se nevytvářel ani se neupravoval systémový AppArmor.

## Zachované neúspěšné pokusy

První širší profil: **354 PASS / 3 FAIL / 2 BLOCKED**. Chyběl root dependency
`ipaddr.js`, nebyl obnoven generovaný inventář API a nebyly předané deklarované
toolchainy systemd/OCR. `npm ci --offline`, regenerace inventáře a explicitní
toolchain prostředí vedly k výše uvedenému finálnímu profilu. Zbývající release
seal FAIL zůstal beze změny. Dílčí rané fixture/census chyby i jejich logy jsou
zachované v archivu, neoznačují se dodatečně za PASS.

Electron pokus 1 byl blokovaný chybějícím kořenem evidence; pokus 2 neodstartoval
kvůli ne-async handleru řízeného backendu. Pokusy 3 a 4 prošly UI asercemi,
ale skončily **FAIL** na čtyřech GET 404: řízený backend neobsahoval novou
startup cestu `/api/specialists`. Pokus 4 ji pojmenoval v logu; doplněna byla
konkrétní fixture odpověď. Síťová policy nebyla oslabena, pokus 5 prošel celý.

## Evidence a použití

Lokální evidence root:
`/home/belphareon/Projects/coworker/intentsmith-model-controls-20260917`.
`manifest.json` připíná 796 souborů (raw výsledky, negativní pokusy, screenshot,
řízený harness, instalaci a data-preservation). Produkční DB, runtime credentials,
instalační config backup ani Electron profily nejsou součástí archivu.
Source bundle je samostatný, `git bundle verify` PASS:
`d3203694fcb11801c49a02e201401b0a5278db60ada63c660430734e26ab0e0b`.
Git bundle zachovává existující historii včetně dříve deklarovaných historických
privacy nálezů; není to vyčištěná historie ani publikovaný release balíček.

Archiv v nadřazeném `coworker/`:
`intentsmith-model-controls-evidence-sha256-d9ec6f7f84da7beb59e1a387141eb7245e1745f0dd6006a88b50fe17e83e9c69.tar.gz`.
SHA-256: `d9ec6f7f84da7beb59e1a387141eb7245e1745f0dd6006a88b50fe17e83e9c69`.
Nezávislé review tohoto rozsahu dosud neproběhlo.

Prakticky: po uložení práce restartovat PC, otevřít IntentSmith běžnou ikonou,
v **Nastavení → Modely LLM → Role → CODE** zvolit **Otestovat CODE**.
Ostatní stažené modely: **Evaluace → Otestovat**. Průběh: **GPU hunt**,
výsledek po dokončení: **Evaluace → Obnovit scoring**. Pro nové modely použít
**Kandidáti**; při neověřené kapacitě GPU lze pro prohlížení zvolit **Všechny**
nebo zadat vlastní odhadovaný limit. Automatický hunt dál měří skutečné vejití
a dodržuje stávající diskovou rezervu a retention autoritu.
