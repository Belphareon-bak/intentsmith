# IDE a GPU hunt — opravy podle operátora 2026-09-18

Autorita: aktuální zadání operátora, body 1a–d, 2a–f, 3 a přiložené reprodukce.
Vstup `ce4a5fc7`; vlastník Codex ve větvi `work/ide-workspace-20260918`,
checkout `intentsmith-audit-20260911-FNF2jj/snapshot`. Cizí checkouty zachovat.

Rozsah: řazení kandidátů hlavičkou; kompletní vyhodnocení instalovaného modelu
napříč použitelnými rolemi se zachováním identity a contract pinů; základní
číselná matice a zachovaný detail; ověření a oprava pokrytí discovery. Dále
omezené a čitelné záložky, odstranění duplicitního plus v chatu, kontextový
tooltip, korektní projektový kořen, skutečné zavření sloupce, šipky souborových
záložek a zarovnané seznamy. Srozumitelná cesta pro nepodporovaný dotaz na
polohu/počasí ze screenshotu bez obejití schvalování síťových požadavků.

Vlastněné cesty: ruční browser moduly Studia, hunt-control a jeho CLI request
consumer, discovery/read model, projektový onboarding/config/desktop instalace,
navazující testy a důkazy. Neměnit evaluační úlohy, skórovací kontrakty,
modelová přiřazení, bezpečnostní authority ani běžící cizí GPU úlohy.

Důkaz: cílené pozitivní i negativní regresní testy, produkční build, skutečné
Electron scénáře pro každý bod; nasazení se zálohou a kontrolou dat. Při nové
produktové/bezpečnostní hranici mimo zadání zastavit pouze závislou část.
Základní ověření: `node --test tests/ide-workspace.test.js tests/desktop-hunt.test.js
 tests/model-evaluation-read-model.test.js tests/model-sweep.test.js`;
existující registry a úplný offline,database profil zůstávají zachované.

Integrační hrany: `src/routes/system.js → src/upgrade/model-hunt-state.js`
čte uložené discovery nálezy přes vlastníka dat; `src/routes/system.js →
src/upgrade/model-sweep.js` používá stejnou konstantu odhadu paměti, nikoli
kopii skórování. Obě jsou v autorizovaném sjednocení Kandidátů s huntem.
Cykly se nemění. Aktualizace strukturálního baseline připne skutečný čistý
commit; release Gate 0 policy se nemění.
