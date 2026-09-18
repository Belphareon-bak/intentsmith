# Stahování a uživatelský CODE postup — 2026-09-18

Stav: IMPLEMENTATION / VALIDATION_RUNNING, nezávislé review čeká.
Autorita: explicitní zadání operátora — srozumitelný průběh Gemmy a skutečný
postup výběr, měření a přiřazení vhodného CODE modelu.

Vstup: otevřené Studio 2ca3cca1, backend c52b03ff, zdroj 0534a111; integrováno
v 1ee60d88. Cizí checkout beze změny. Probíhající ornith/CODE čekal na diskovou
rezervu 40 GiB, bez inference. Gemma měla nedokončenou durable PULL operaci,
po restartu obnovovanou v pozadí. Nešlo o doložené dokončení ani selhání modelu.

Oprava: parser přijímá události `pulling <digest>` s bajty, počítá oznámené
vrstvy a rychlost nově přenesených dat (obnovené bajty nezvyšují rychlost).
Dokončení vyžaduje explicitní success receipt; 100 % jedné vrstvy není hotový
model. GET downloads spojuje stávající durable receipts a aktuální stream.
HTTP polling obnoví stav po ztraceném WS, restartu a opětovném otevření GUI.
Chybějící telemetrie je označená, ETA není vymyšlená. Ruční opakování WS
obnoví retry budget; health recovery je může vyvolat bez restartu Studia.
Ruční test instalovaného modelu potřebuje 2 GiB pracovního místa; nový hunt
nadále vyžaduje původní 40 GiB rezervu po stažení. GPU a identity guardy stejné.

Protokol: [Ollama API — Pull a Model](https://github.com/ollama/ollama/blob/main/docs/api.md#pull-a-model).

Dosavadní cílená validace: authority 13, model-upgrade 102, M1 klient 133,
desktop-hunt 31 PASS. Zachované neúspěchy: první nový test měl chybnou injekci
`repository` místo `durableRepository`; první build postrádal v lokálně
přenesených závislostech terser, napraveno offline frozen-lockfile instalací.

Fyzické důkazy, úplný profil a CODE výsledek budou doplněny po běhu do
`coworker/intentsmith-model-download-journey-20260918`. Žádný nový model zatím
nebyl vybrán ani aktivován v rámci tohoto běhu.

První úplný profil: 357 PASS / 3 FAIL. Dvě regrese identifikované: callback
binding provideru očekává původní `success` událost; nový čistý parser přidal
nepřipnutou import hranu. Zachována původní událost (finální `done` až po EOF
s success receipt), parser ponechán uvnitř existujícího upgrade-manager modulu.
Třetí FAIL je zděděná release registry pečeť. Následuje nové ověření.

Druhý úplný profil na `5f364979`: 359 PASS / 1 FAIL / 0 BLOCKED; jediný
FAIL je `tests/nightly-orchestrator-self-test.js`, zděděná release registry
pečeť. Řízený skutečný Electron `controlled-4` ověřil HTTP průběh bez WS
událostí, přerušení backendu, nový port/capability, automatické obnovení a
trvalé dokončení po reloadu. Předchozí tři negativní pokusy harnessu zachované.

Skutečná Gemma dokončena 15:13:26 CEST: durable `RECONCILED_SUCCEEDED`,
operace `mao1:ef3320c8-67ea-4096-abe6-b98c57206ab4`. Délka 65 min 45 s.
Nová instalace `5f364979` tento výsledek skutečně zobrazila v Electronu.

Živý CODE test odhalil další zdržení: background binding verification po
startu backendu načetla modely a poslední ponechala na GPU s výchozím
pětiminutovým keep-alive. Její DB claims prokazují vlastníka
`BINDING_VERIFICATION`; žádný cizí proces nebyl ukončen. Ověřovací chat nyní
požaduje `keep_alive: 0`, response-bound digest kontrola je zachovaná.
109 binding testů a 160 artifact testů PASS. Nová měření běží na `5f364979`;
opravný keep-alive bude instalován až po jejich dokončení.
