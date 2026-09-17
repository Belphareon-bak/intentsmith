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
