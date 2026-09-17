# Modely ve Studiu: filtry, měření a příčina blokace

Autorita: operátorův požadavek a tři snímky z 2026-09-17. Vstup 023af4dd;
větev work/hunt-model-controls-20260917 v existujícím vlastním checkoutu.
Výsledek: filtrovat kandidáty podle odhadu VRAM, řadit parametry, spustit
měření konkrétního instalovaného artefaktu/role a vysvětlit chybějící skóre
i nefunkční GPU. Neznámá VRAM není průkaz vhodnosti. Testování používá
stávající response-bound evaluator a GPU autoritu, nemění bindingy ani nemaže.

Vlastněné cesty: hunt control/diagnostics, system routes, wrapper/CLI,
candidate/pairwise evaluace, current read model, chat-panel runtime a jejich
existující testy. Zachovat cizí checkout a aktivní procesy. Žádný restart PC.
Ověření: focused testy vstupů a transportu, GPU failure před inference,
připnutí digestu a sady, reálný build a UI; fyzické skórování jen po funkčním
GPU preflightu. Commit/push podle trvajícího zadání operátora.

Dodáno a instalováno na `09cbd0d6`; `REVIEW_PENDING`, fyzický scoring je
`BLOCKED` kvůli NVIDIA 595.84 / NVML 595.91. Offline/database 358 PASS / 1 FAIL
(nezměněná release registry pečeť), řízený fyzický Electron PASS, živé odmítnutí
měření při nefunkčním GPU ověřeno. [Review packet a meze](../review/2026-09-17-HUNT-MODEL-CONTROLS.md).

Následné zadání operátora: sjednotit vzhled tlačítek a vysvětlit neúspěšný
test Qwenu přímo u modelu. Dodáno a instalováno na `08f8d1c5`; backend
a GPU policy beze změny. [Ověření a pokračující blokace GPU](../review/2026-09-17-HUNT-MODEL-CONTROLS-FOLLOWUP.md).

Následná oprava podle snímku a námitky operátora: zjistit dedikovanou VRAM
i při selhání NVML přes živé NV-CONTROL (`nvidia-settings`) pouze pro katalog.
Zachovat GPU preflight pro scoring; při neznámé kapacitě neschovávat katalog.
Ověřit náhradní zdroj, nedostupný zdroj, ruční limit a skutečný renderer.
