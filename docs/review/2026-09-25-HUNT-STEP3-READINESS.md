# GPU hunt: podklad pro krok 3

25. 9. 2026 · **bez rozhodovací autority a bez vydaných sémantických známek**

Tento přehled váže stav každé buňky na přesný digest a zdroj. `SEBRÁNO` znamená pouze úplný syrový sběr v dané sadě, nikoli přijaté skóre. `ČÁSTEČNÉ` u CHAT znamená vývojový panel; pouze dva modely mají navíc čtyři dialogy ve skutečném produkčním profilu. `BLOKOVÁNO` u CODE je selhání orákula před inferencí, ne nula modelu. `N/A` u VISION je doložené nepřítomností capability `vision` na přesném lokálním artefaktu.

Kanonický [formulář](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/review.html) má 312 celých odpovědí a 840 kritérií; packet SHA256 `b3a2f33445ed7537fca65d2dd25645e68ba90250c1c0718c57396f8371aefc0f`. Starší oddělené packety po 120 jsou stažené ze srovnávacího hodnocení. Níže předvolený náhodný vzorek vznikl z tohoto SHA **před otevřením nových známek**.

| Model (digest prefix) | D1 | D2 | CODE | R1 | R2 | CHAT | VISION |
|---|---|---|---|---|---|---|---|
| devstral-small-2:latest (`24277f07f62d`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | SEBRÁNO | SEBRÁNO | ČÁSTEČNÉ | CHYBÍ |
| gemma4:26b (`08ae7ec1744b`) | CHYBÍ | SEBRÁNO | BLOKOVÁNO | SEBRÁNO | CHYBÍ | ČÁSTEČNÉ | SEBRÁNO |
| ornith-1.5:9b (`e5df7dcdd8a2`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | SEBRÁNO |
| qwen3-30b-a3b:latest (`dc0b52b99d0e`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | N/A |
| qwen3-coder:latest (`06c1097efce0`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | N/A |
| qwen3.5:27b (`7653528ba5cb`) | SEBRÁNO | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | CHYBÍ |
| qwen3.6:27b (`9d5803d493a9`) | SEBRÁNO | SEBRÁNO | BLOKOVÁNO | SEBRÁNO | SEBRÁNO | ČÁSTEČNÉ | CHYBÍ |
| qwen3:14b (`bdbd181c33f2`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | N/A |
| phi4:14b (`ac896e5b8b34`) | CHYBÍ | CHYBÍ | BLOKOVÁNO | CHYBÍ | CHYBÍ | ČÁSTEČNÉ | N/A |
| qwen3.8:latest (`22130167c4c2`) | SEBRÁNO | SEBRÁNO | BLOKOVÁNO | SEBRÁNO | SEBRÁNO | ČÁSTEČNÉ | SEBRÁNO |

Podrobné [přejímací brány všech sedmi sad](2026-09-25-HUNT-SUITE-ACCEPTANCE-GATES.md) odlišují dvoumodelový pilot od přijaté sady.

## Podklad a omezení sad

- D1/D2/R1/R2: 8 historických skupin na roli, všech 312 odpovědí přesně odpovídá aktuálnímu veřejnému zadání a rubrice. 32 úloh má autora gold, alternativu a negativní sondy; 8 476 předaných řádků bylo ověřeno proti historickým souborům, ale **nezávislá přejímka dostatku kontextu a významového hodnocení chybí**. Zadání jsou aktuálně jen anglicky. Počet opakování nepřidává nezávislé případy. Přesné SHA, původ a počet kritérií každé úlohy jsou ve [strojovém podkladu](evidence/2026-09-25-hunt-step3-readiness.json).
- CODE: aktivní historické orákulum stále přijme věcný rozpor a odmítne správnou parafrázi. Připravená v2 není přijata nezávisle. Plné modelové známky zůstávají `null`.
- CHAT: pečetěný plán má 10 modelů × 40 dialogů × 3 pokusy. Všech 1 200 pokusů skončilo, 1 196 bylo zachyceno; čtyři skončily výstupním limitem nebo transportní chybou. Strojová matice uvádí pro každý model skutečně zachycených 119 či 120 z plánovaných 120, ne fiktivní úplnost. Samostatný [produkční canary](2026-09-25-HUNT-CHAT-PRODUCTION-CANARY.md) zachytil 4 ze 40 úloh pro qwen3.8 a qwen3.5 se skutečným promptem a shodným kontextem; ostatní modely ani celá sada takto pokryté nejsou. Druhý nezávislý posudek chybí.
- VISION: 3 × 23 úloh bylo sebráno, ale tři opakování při `temperature: 0` jsou vždy stejná. U dalšího měření stačí jedna deterministická odpověď; chybějící vision-capable modely jsou v tabulce `CHYBÍ`, ne `N/A`.

## Předem vybraný vzorek pro operátora

Pro každou D/R roli jsou vybrány dvě celé historické úlohy a jedna náhodně určená odpověď každého anonymního modelu na **tutéž** úlohu. Jde o 26 odpovědí; výběr nečetl známky. K tomu po příchodu obou posudků přibudou všechny neshody od 0,15 po kritériích, nízká jistota nahlášená hodnotitelem a kritická selhání. [Generátor fronty pro operátora](../../scripts/manual/build-hunt-operator-queue.mjs) zachová celé zadání, odpověď i oba konkrétní důvody; pokud hodnotitelé nedodají explicitní příznaky jistoty a kritických selhání, výsledek to označí jako neúplné.

| Role | Úloha | Odpověď | ID |
|---|---|---|---|
| D1 | `d1_audit_error_envelope` | A/3 | `2c74106c-3c6c-45b4-8950-c64158a203e0` |
| D1 | `d1_audit_error_envelope` | B/2 | `94dd166a-1da8-48f2-9710-c0e47d05757f` |
| D1 | `d1_audit_error_envelope` | C/2 | `971a8a56-d6f0-4219-b77a-01427f7895fb` |
| D1 | `d1_model_cleanup` | A/1 | `0c555f98-bf4b-461c-8e5f-042870b113c9` |
| D1 | `d1_model_cleanup` | B/2 | `32211165-3d62-4612-8aa6-90f50cd45e44` |
| D1 | `d1_model_cleanup` | C/2 | `285faf78-aabe-40a2-b980-c87a56277c0b` |
| D2 | `d2_history_late_guard` | A/2 | `d56e5490-7a02-4d0e-849c-5ea3f8744530` |
| D2 | `d2_history_late_guard` | B/1 | `444646c2-6e9c-4ae5-9e84-1e29044756a7` |
| D2 | `d2_history_late_guard` | C/2 | `19ac408d-dcef-4232-a64c-a61270895302` |
| D2 | `d2_audit_error_envelope` | A/2 | `32f6ca35-e47d-44e5-9895-c715c7b6912f` |
| D2 | `d2_audit_error_envelope` | B/2 | `401f9d8d-1063-4ccb-a216-4ee2ebf83abc` |
| D2 | `d2_audit_error_envelope` | C/2 | `a799456e-7c5b-42ed-ab79-ab20b64bef09` |
| R1 | `r1_model_lease` | A/3 | `c9f47993-888b-4e89-b145-e7a429fe3832` |
| R1 | `r1_model_lease` | B/2 | `e938c7ea-0774-41ad-a997-2b9ddcc3f78e` |
| R1 | `r1_model_lease` | C/1 | `8ea30b1d-71c4-4b0d-b73b-53eb09ec9855` |
| R1 | `r1_model_lease` | D/3 | `e9cea0c8-debe-4515-b557-5a03912ad5db` |
| R1 | `r1_immutable_refinement` | A/1 | `91fd8e98-449e-4235-9d44-8cd8c47609fb` |
| R1 | `r1_immutable_refinement` | B/2 | `96625fb6-bdd4-4824-b600-cad569ca2377` |
| R1 | `r1_immutable_refinement` | C/1 | `00c7f334-174a-4564-adde-ee515a251da7` |
| R1 | `r1_immutable_refinement` | D/1 | `f152850f-7040-4d6c-8095-2dd7b5307e8e` |
| R2 | `r2_pairwise_confidence` | A/2 | `1ca6dd70-c232-477e-a0a5-c9aec644caaa` |
| R2 | `r2_pairwise_confidence` | B/2 | `42b606d1-3d47-4505-9667-1b99de12e92f` |
| R2 | `r2_pairwise_confidence` | C/1 | `d6e025da-a955-4a0b-b1f4-452c39b33e36` |
| R2 | `r2_model_lease` | A/1 | `26e89a00-c690-4257-9299-00f578711a98` |
| R2 | `r2_model_lease` | B/3 | `0abf6f12-2486-4310-b61b-ee4d4b8ea372` |
| R2 | `r2_model_lease` | C/1 | `627e30ee-cb6a-46b5-86a3-28af09e3b82b` |

## Krok 3 – přejímací postup

1. Codex a Opus hodnotí **stejný úplný packet** odděleně, po kritériích s konkrétním důvodem a citací místa v odpovědi. Jakoukoli předchozí expozici identit nebo známek oba výslovně uvedou. Nevyplněná známka není nula.
2. Každý posudek se zmrazí jako samostatný soubor navázaný na SHA packetu. [Validátor](../../scripts/verify-hunt-blind-review.mjs) kontroluje úplnost 312 řádků / 840 kritérií a porovnává celé setiny. Původní známky nepřepisuje.
3. Operátor dostane tento předvolený vzorek, všechny spory od 0,15 po kritériích, kritická selhání a explicitně označenou nízkou jistotu. Rozsudek bude samostatná vrstva s vlastním původem; nikdy nezmění syrové odpovědi nebo posudky.
4. Prozatímní procentní matice vznikne **až z rozsouzených skutečně hodnocených buněk** a nese původ každého skóre. Kde je CODE zablokovaný nebo CHAT neporovnatelný s produkcí, nesmí být procento vykládáno jako výběr modelu.

Před GO stále zbývá nezávisle přijmout hodnotitele/orákula a ověřit pořadí na čerstvých provozních případech. Tato příprava neaktivuje model, timer ani mazání.
