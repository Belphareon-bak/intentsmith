# Ruční evaluace a srozumitelný průběh ve Studiu

Autorita: operátorův neúspěšný test Qwen3.5/CODE a požadavek na přehledný
průběh, počty úloh a odhad času. Implementace `9acf5528..2f150ce7`;
9acf5528 integruje předchozí privacy opravy z cizího checkoutu bez změny
jejich chování. Finální čistý detached snapshot je
`2f150ce7f3f183f9e14c3e2522ce150e1fe1c7a1`; živá inference níže proběhla na
8d1da07e. Jediná následná produktová delta je normalizace procenta v API.
Stav: **INSTALLED / LIVE_MANUAL_EVALUATION_PASS / REVIEW_PENDING**. Výsledek živého měření je níže.

## Příčina a oprava

Ruční CLI větev kontrolovala `local.artifact?.digestSha256`, ale skutečný
výstup `buildCandidates()` má digest přímo v `local.digestSha256`. I platný
model proto končil `MODEL_EVALUATION_ARTIFACT_CHANGED` před inferencí.
Oprava používá skutečné pole inventáře a předává úplnou identitu dál.
Nový test vykonává reálný úsek CLI nad skutečným výstupem buildCandidates:
shodný digest projde, změněný digest a chybějící model jsou odmítnuty.
Následné ověření inventáře před měřením i digest v odpovědi provideru zůstávají.
Skórovací kontrakt, přepínání rolí a retention politika se nemění.

Panel rozlišuje aktuální měření, jeho výsledek a pravidelný plánovač. Zobrazuje
model, roli, fázi, úlohu a opakování. Progress počítá skutečně dokončené úlohy
napříč opakováními; přípravná fáze je neurčitá. ETA je průběžný odhad zbývající
části aktuální sady odvozený z dokončených úloh, nikoli slib trvání celého huntu.
Viditelný je i uplynulý čas a stáří poslední změny. Chyba má stručné vysvětlení,
stack trace zůstává v rozbalitelných technických podrobnostech. Výsledek nabídne
přechod na scoring a terminální pokus vyvolá obnovení dat evaluací.
Staré selhání plánované služby už nepřekryje úspěšný ruční pokus.
Existence JSON reportu sama o sobě nevydává neúspěšnou evaluaci za COMPLETE.

## Ověření

Cílené testy desktop-hunt, pairwise-trial, candidate-trial, current read model,
Studio client, artifact validation a integrované privacy regrese prošly.
Desktop-hunt nyní obsahuje 23 testů, včetně počítání napříč opakováními,
neurčité přípravy, ETA a zobrazení technické chyby. Build Studia prošel.
SHA-256 skutečně používaného Electron bundle
`c3-ide/applications/electron/lib/frontend/bundle.js`:
`c2f04bc4b4d78fd983b45ba6ba1e5ec59b2a03cb13e01d3b781a1ae14a0d3326`.

Úplný offline/database profil na čistém 8d1da07e: **358 PASS / 1 FAIL /
0 BLOCKED / 0 TIMEOUT**, celkový verdikt **FAIL**. Jediný non-PASS je
`tests/nightly-orchestrator-self-test.js`: registry hash se liší od reviewed
Gate 0 policy. Release pečeť nebyla měněna; jde o známé omezení podle CONTRACT §8.
Audit: `2026-09-17T20-46-37-558Z`, všechny kontroly čistoty source tree prošly.

Fyzický Electron journey: **STUDIO_ELECTRON_BOUNDARY_PASS**. Skutečný click
na test role prošel přes potvrzení a HTTP 202; řízený backend následně poskytl
0 → 33 → 66 % a terminální výsledek s 88 % a tlačítkem Zobrazit skóre.
Screenshot průběhu zachycuje 4/6 úloh, opakování 3/3, název úlohy a ETA.
Zachované kontroly kandidátů, neznámé VRAM, řazení a HTTP 503 v řádku modelu
také prošly. Tyto hodnoty jsou fixtura, nikoli skóre Qwenu.
Limity: řízený HTTP backend, NODE_ENV=test, diagnostický --no-sandbox,
privátní user/network namespace, renderer capture po vyjednaném startu.

## Živý běh a evidence

Předchozí problém NVIDIA je po operátorově restartu vyřešen: nvidia-smi nyní
vrací 595.91.07 a 24576 MiB. Backend a plánovač po instalaci běží. Uživatelské
okno ani cizí dlouhý soak nebyly zastaveny. Nové UI vyžaduje znovu otevřít Studio.

První instalovaný HTTP pokus `run-vfGzaZ`, 17. 9. 22:51 CEST, byl přijat
pro přesný Qwen3.5:27b/CODE a prošel opravenou kontrolou identity. Před měřením
skončil SCHEDULED_SKIPPED, protože systémovou GPU používal jiný llama-server
PID 123257. Žádné skóre nevzniklo; tento neúspěšný pokus je zachován.

Privátní evidence root:
`/home/belphareon/Projects/coworker/intentsmith-evaluation-progress-20260917`.
Obsahuje původní pokusy, focused/build/audit logy, fyzický journey a snímky
instalovaného API. Produkční DB, autentizační capability a instalační
konfigurační zálohy do archivu nepatří. Nezávislé přijetí není tvrzeno.

Následná úzká oprava `2f150ce7` sjednocuje také pole `percent` v API přes
všechna opakování. Původní surová událost obsahovala procento jednoho opakování;
UI už od 8d1da07e správně používá celkové completedTests / totalTests. Nová
assertion potvrzuje monotónní 0 → 100 % napříč opakováními. Cílené regrese
prošly; frontend, skórování a jeho kontrakt mají proti 8d1da07e prázdný diff.


Druhý pokus `run-wLnFFn` byl spuštěn až po prázdném systémovém `/api/ps`
a prázdném seznamu NVIDIA compute procesů. Celý běh 22:58:01–23:04:37 CEST
skončil COMPLETE, exit 0. Měření placementu: 16,98/16,98 GiB na GPU při
32768 tokenech, 39,3 tok/s; prošly tři základní kontroly. CODE inference měla
vlastní pinnuté nastavení 16384 tokenů, 4096 výstupních tokenů a 300s limit.
Sedm repozitářových úloh × tři opakování doběhlo bez transportní chyby.
Dvě úlohy prošly ve všech opakováních, pět neprošlo; skóre **2/7 = 0,285714**.
To je výsledek této sady, nikoli obecná úspěšnost programování.

Nový DB řádek `eval_df121870-4b50-45ba-a97e-91accdcf34ed`:
- model `qwen3.5:27b`, role CODE, status COMPLETE;
- digest `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`;
- kontrakt `6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`;
- provider `0.34.0-intentsmith.1`, proof RESPONSE_BOUND;
- interval sady `2026-09-17T20:59:08.582Z` až `2026-09-17T21:04:34.359Z`.

Instalované API po dokončení vrací pro tentýž model/roli/kontrakt COMPLETE
a shodné skóre místo MISSING; stav huntu je WAITING a poslední pokus COMPLETE,
i když stará plánovaná systemd služba stále eviduje historické selhání.
Předchozích 510 evaluací zůstalo obsahově shodných, přibyl přesně jeden řádek.
Všech 222 rozhodnutí, 7 desired bindings a 11 binding operations zůstalo
obsahově i početně shodných. SQLite quick_check OK, žádná FK chyba.


Po instalaci finálního 2f150ce7 API znovu potvrdilo stejné COMPLETE skóre
pro shodný kontrakt, a opakované čtení DB potvrdilo totožné zachování historie,
přiřazení i rozhodnutí. Finální snapshot má shodné bajty Electron bundle jako
fyzicky ověřený 8d1da07e. Cizí soak PID 15110 pokračoval; staré uživatelské
okno PID 92057 stále spouštělo frontend 365a4f1d a nebylo ukončeno.


Závěrečný úplný profil na čistém 2f150ce7, run
`2026-09-17T21-04-51-966Z`: znovu **358 PASS / 1 FAIL / 0 BLOCKED /
0 TIMEOUT**, stejná release registry pečeť jako jediný non-PASS. Verdikt FAIL
zůstává zachován. Launcher --check PASS; backend active, timer enabled/active,
ruční eval služba po dokončení inactive. Nezávislé review je stále pending.

Po doplnění dokumentace artifact-validation: **160/160 PASS**. Manifest
připíná 4235 souborů a obsahuje ověřený source.bundle s úplnou historií na
2f150ce7. Obsah archivu byl znovu porovnán s hashi manifestu; privátní archiv
v nadřazeném coworker adresáři má 112469671 bajtů:
`intentsmith-evaluation-progress-sha256-791b972b14b1e17982c4d3f0c1cb90ac5e0220d3eb56f96af220494d61b1dca2.tar.gz`.
SHA-256: `791b972b14b1e17982c4d3f0c1cb90ac5e0220d3eb56f96af220494d61b1dca2`.
