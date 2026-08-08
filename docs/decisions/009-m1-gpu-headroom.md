# 009 — referenční model nesplnil minimální post-load GPU headroom

- **typ:** BLOCK
- **WP:** WP-M1-MODEL
- **rail:** R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R7 OPERABILITY
- **vzniklo při:** registrovaný T3 běh `IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST`

## Evidence na stole

Audit runner spustil jedinou povinnou sadu z čistého SHA
`1f2993a4c76f0550eb0de6b47ae2adf1a8bbca05`, se souběžností jedna a
15minutovým limitem. Před efektem bylo 23 160 MiB volné VRAM, žádný NVIDIA
compute proces a prázdné `ollama ps`. Připnutý `qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
byl už lokálně nainstalovaný; suite neprovedla pull, delete, unload ani rebind.

Běh skončil po 330 451 ms jako `FAIL`, exit `1`, ve fázi
`post-run-observation`. Sanitizovaný diagnostic SHA-256
`3b2a1d4f08b56ccf5eb5e21c46cc2050e91f3aad082afa400136b1307a8eb6e7`
je přesně SHA-256 commitnuté chybové věty `post-call GPU headroom is unsafe`.
To dokazuje, že po provider efektu zůstalo méně než požadovaných 1 024 MiB
volné VRAM; první verze artefaktu bohužel neuchovala přesnou hodnotu.

Cleanup uspěl bez administrativního zásahu: po 302 759 ms a 61 kontrolách bylo
`/api/ps` prázdné, compute procesů bylo nula a GPU měla 23 165 MiB volné VRAM.
Bezprostřední následná host kontrola ukázala 23 160 MiB volné VRAM a nadále
žádný rezidentní model ani compute proces. Sdílený stav je tedy obnovený, ale
GPU acceptance pro tuto konfiguraci je červená.

## Varianty

| Varianta | Chování | Dopad na rails | Cena zavedení |
|---|---|---|---|
| A — snížit kontext při zachování modelu | Najít nejvyšší `num_ctx`, který po loadu ponechá alespoň 1 024 MiB | Zachová model, ale mění jeho runtime kapacitu a vyžaduje nové měření | `tests/m1-model-gpu-pilot.test.js`, autoritativní model profil a opakovaný T3 běh; nejméně 2 soubory + evidence |
| B — zvolit menší lokální model/kvantizaci | Zachovat kontext i headroom jinou modelovou vazbou | Mění produktový model binding; může změnit kvalitu | model registry/profile, approval cesta L0-9, modelové a quality testy; nejméně 4 soubory + nový modelový artefakt |
| C — snížit nebo odstranit headroom guard | Současná konfigurace by mohla projít | Oslabuje bezpečnostní guard a maskuje reálnou rezervu | Technicky 1 test file, ale autonomně zakázáno |
| D — povolit CPU spill / neúplnou GPU rezidenci | Sníží VRAM tlak za cenu latence | Mění acceptance kontrakt i výkonovou charakteristiku | pilot, runtime model policy a performance evidence; nejméně 3 soubory |

## Vzatý default a proč

Žádný. Jde o předepsaný `BLOCK`: aktuální konfigurace nesplnila bezpečnostní
headroom a varianty A, B a D mění produktovou modelovou konfiguraci. Varianta C
je zakázané oslabení guardu. GPU část WP se znovu nespustí bez operátorského
výběru; ostatní nezávislé M1 briefy mohou pokračovat.

## Šev

Měření je v `tests/m1-model-gpu-pilot.test.js`; produkční model a kontext
vlastní model registry/profiles. Šev nelze poctivě zúžit na jednu funkci bez
volby mezi kapacitou kontextu, kvalitou modelu a provozním headroomem, proto
není tento záznam `DECIDE-AND-CONTINUE`.

## Cena přepnutí, když operátor rozhodne jinak

Varianta A potřebuje bezpečnou vyhledávací matici kontextů a alespoň cold,
warm, classify, cancel a post-load headroom pro zvolenou hodnotu. Varianta B
navíc potřebuje schválenou změnu bindingu a quality porovnání. Varianta D
potřebuje latency/throughput baseline a explicitně změněný residency kontrakt.
Žádná varianta neopravňuje pull, delete, rebind ani oslabení aserce v tomto
běhu.
