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

Náhradní kapacita a viditelný katalog jsou instalované na `d4dea0bb`; živé API
vrací 24103 MiB a 49/71 kandidátů v 80% limitu. GPU scoring je stále BLOCKED.
[Review, oba plné profily a následná oprava dokumentačního počtu](../review/2026-09-17-VRAM-CAPACITY-FALLBACK.md).

Navazující zadání operátora 17. 9. večer: opravit odmítnutí platného digestu
při ruční evaluaci, zobrazit konkrétní fázi, model/roli/úlohu, skutečný počet
hotových testů, čas a podložený odhad zbývajícího času. Chyby shrnout lidsky,
raw detail ponechat rozbalitelný; oddělit běžící pokus od historického selhání.
Autorita digestu ani skórovací kontrakt se nemění. Ověřit pozitivní i negativní
identitu, opakování a průběh v reálném rendereru, poté jeden živý CODE běh
na vybraném Qwen3.5:27b přes instalovanou HTTP cestu. Zachovat cizí soak.

Oprava ruční evaluace a průběh jsou instalované na `2f150ce7`. Živý
Qwen3.5:27b/CODE na předchozím 8d1da07e dokončil 7 × 3 úloh, skóre 2/7;
aktuální API potvrzuje COMPLETE pro přesný kontrakt. Zachována všechna
starší měření, rozhodnutí a přiřazení. Dva úplné profily shodně 358 PASS /
1 FAIL (release registry pečeť), fyzický řízený Electron PASS.
Stav LIVE_MANUAL_EVALUATION_PASS / REVIEW_PENDING.
[Review packet a rozsah důkazů](../review/2026-09-17-EVALUATION-PROGRESS.md).

Navazující zadání 2026-09-18 (vstup 03597d1d): trvalá denní inventura GPU,
nová ruční evaluace bez reuse, pravdivé čekání na GPU, detaily úloh a srovnání
po rolích, tabulky rolí/kandidátů, historie měření a posledních pěti hunt akcí,
priorita slabých rolí a srozumitelné výsledky Správce. Vlastněné cesty navíc:
gpu-detector, governor read/actions, evaluation read model a jejich testy.
Schválení doporučení nezískává nový executor; UI vysvětlí skutečný manuální
účinek. Uložená kapacita nikdy nenahradí aktuální kontrolu GPU před inferencí.
Prokázat fixture HTTP/Electron a živé nové CODE měření bez změny bindingů.

Dodáno a instalováno na `9298ef46`. Úplný profil 358 PASS / 1 FAIL
(zděděná release registry pečeť), fyzický renderer a běžný launcher ověřené.
Tři skutečné CODE sady přes GUI dokončené, 63 vyhodnocení a tři nové
COMPLETE řádky: Qwen3.8 71,4 %, Qwen3.5 33,3 %, Qwen Coder 11,4 %.
Celá předchozí historie a přiřazení jsou zachovaná. LIVE_GUI_CODE_MEASUREMENT_PASS;
nezávislé review zůstává otevřené. [Review a živý checkpoint](../review/2026-09-18-MODEL-WORKSPACE.md).

Znovu otevřeno operátorem 2026-09-18 podle pěti snímků: po živé aktualizaci
backendu se otevřené Studio připojí přes WS k novému portu, ale HTTP panel
ponechá starou adresu. Role pak zůstanou načítat a Správce maskuje síťovou
chybu jako chybějící data. Rozsah nápravy: aktuální endpoint pro HTTP,
obnova všech modelových záložek, viditelný výpadek/ruční retry bez opakování
mutací, odmítnutí opožděných odpovědí. Ověřit skutečné otevřené Electron okno,
rotaci portu i capability, všech sedm záložek před/po a výpadek při prvním
načtení. Integrovat již instalované project-flow změny 5e46fca7; zachovat
uživatelův otevřený projekt, rozepsané vstupy i cizí soak.
