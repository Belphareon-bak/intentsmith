# Účetní: implementační evidence 2026-09-12

Stav: **IMPLEMENTED_SLICE / REVIEW_PENDING**. Vstup `8654e67a` v
`codex/specialists-engines-20260911`. Autorita: aktuální zadání operátora rozšířit
měsíční kontrolní hlášení o roční přiznání a práci s podklady.

Přibyly čisté doménové výpočty `specialists/accountant-cz/workflow`, lokální host
`src/accounting`, CLI `bin/ucetni.js`, installer a dvě registrované sady.
Změna nezasahuje chatový connector, hlavní checkout, živou DB, GPU ani poštu.
[Uživatelský návod, zdroje pravidel a podporované meze](../../specialists/accountant-cz/WORKFLOW.md).

## Ověření

- Instalační cesta byla skutečně spuštěna. `ucetni` a `uct` míří na tento
  checkout, Python/PDF/OCR runtime je soukromý a oddělený od systémových balíčků.
- Měsíční journey importuje skutečné PDF vytvořené testem, ověří SHA, opakovaný
  import, schválení, dvě XML, XSD, ZIP a zneplatnění po změně podkladu.
- Roční journey importuje složku faktura+potvrzení, zapíše skutečné úhrady,
  vyžaduje podpůrné důkazy, vytvoří tři XML, validuje je a ověří vloženou PDF
  přílohu. Oficiální OZP PDF byl navíc vykreslen a vizuálně zkontrolován.
- Negativní případy: nejistá data, neznámé klíče, cizí DIČ, duplicita,
  chybějící potvrzení, přeplatek bez formulářového vypořádání, haléřové návaznosti,
  symlink, skutečný ZIP s `../`, externí XML entita a změněný hash při exportu.
- Doménové testy používají syntetické identity a syntetické peněžní příklady.
  Soukromé originály, OCR texty, rodná čísla, reference a náhledy nejsou v Git.
- Registry kontrola: PASS, 516 programů, otisk
  `4c0e463e77ff21ae1b537b431ca28efea2f40b00baa4af04a5d9030850270546`.

Finální účetní kontrola: **23/23 doménových + 7/7 host/export kontrol PASS**,
včetně zpětného importu výsledného ZIP jako vzoru bez vzniku fiktivních příjmů.
Lokální report `2026-09-12T19-06-03-337Z/report.json` pod
`.intentsmith-artifacts/test-runs/` obsahuje rovněž artifact-validation:
**157 PASS / 1 FAIL**, pouze původní chybějící rezervace migrace 112.
Souhrnný verdikt tohoto tříprogramového běhu je tedy **FAIL**, nikoli PASS.

Celý `npm run test:deterministic -- --allow-dirty`:
**343 PASS / 4 FAIL / 0 TIMEOUT / 9 BLOCKED**, exit 1, běh
`2026-09-12T18-58-10-790Z`. Tento běh předcházel poslední úpravě importu OZP
a sjednocení pojistného s celokorunovým základem přiznání; následná cílená
kontrola výše ověřila změněný účetní řez a čerstvý LOC/registry census.

| Neúspěšný program | Důvod |
|---|---|
| artifact-validation | Chybějící migrace 112 v existujícím rezervačním manifestu, stejná závada jako na vstupu. |
| mobile-browser-a11y | Chybí připnutý Chromium runtime. Program vypíše BLOCKED, ale runner správně vykazuje jeho exit 1 jako FAIL. |
| module-boundary-ratchet | Čtyři přidané importy popsané níže čekají na přijetí delta. |
| nightly-orchestrator-self-test | Aktuální registry hash se liší od zapečetěného přijatého pinu Gate 0. |

Devět BLOCKED zahrnuje novou účetní integraci bez explicitního toolchain opt-in,
dva stávající PDF/export programy, čtyři M2 execution/lifecycle programy,
M5 process hardening a workspace-budget. Nová účetní integrace byla samostatně
spuštěna s nainstalovaným runtime, `INTENTSMITH_PDF_PYTHON` a povolením přesně
`toolchain:python-pdf-runtime` / `toolchain:accountant-ocr-runtime`: **7/7 PASS**.
Tím se ostatní blokované programy nemění na PASS.

Běhy jsou pracovní kandidáti s explicitním `--allow-dirty` a izolovaným
testovacím prostředím; nejsou nezávislou akceptací na čistém checkoutu.

Soukromé srovnání aritmetiky s ročním XML: **8/8 shoda** příjmů, výdajů, základu,
daně před/po slevách, sociálního pojistného, doplatku a nové zálohy. Test používá
syntetický souhrnný příjem a předpoklad odpovídající rodinné situace; nepotvrzuje
skutečné zdrojové faktury/platby ani oprávněnost nároků. Částky a osobní údaje
se do tohoto reportu ani Git nekopírují. Privátní výsledek zůstává v lokální
`.intentsmith-artifacts/accountant-private-arithmetic-check-corrected.json`.

Připravené místní případy: `dan-2025` a `dph-2026-05`, oba rozpracované.
Pracovní ZIP jsou v Downloads, mají práva 600 a žádná podací XML. Připravená
vstupní složka `~/Ucetni/2025/{faktury,uhrady,potvrzeni}` má práva 700.
`ucetni-watch.timer` byl zapnut, stav ACTIVE, příští kontrola 2026-09-13 09:00 CEST.
Originální XSD a veřejný vzor zůstávají beze změny bajtů; lokální
`schemas/.gitattributes` chrání jejich CRLF/whitespace před normalizací a vyjímá
jen tyto převzaté soubory z whitespace stylistické kontroly. Všech 7 zdrojových
hashů a hash oficiální PDF šablony souhlasí. `git diff --cached --check`: PASS.

## Hranice a otevřené položky

Specialist scanner: PASS, 5 balíčků, 54 souborů, bez violations, scanErrors
a ambient effects. Module ratchet: **FAIL** proti dosavadnímu pinu, čtyři nové
hrany, žádná odebraná, stejné 3 cykly / 28 souborů v cyklech:

```
src/accounting/preview.js -> src/accounting/store.js
src/accounting/preview.js -> src/accounting/worker.js
src/accounting/service.js -> src/accounting/store.js
src/accounting/service.js -> src/accounting/worker.js
```

Tyto hrany drží souborový/OCR host pohromadě a nevedou ze specialisty do core.
Baseline zůstává na přijatých 1 317 hranách; současný graf má 1 321. Přijetí
delta a integrace čeká na nezávislé review. Zapečetěný registry pin Gate 0 se
kvůli těmto novým testům rovněž nemění.

Reálná měsíční faktura je vytěžená včetně rekapitulace DPH. Fotografie vytvořila
šest návrhů, část OCR je chybná nebo neúplná; zůstávají neschválené. Referenční
podání obsahuje jinou přijatou evidenci, kterou předané doklady neprokazují.
Roční ZIP byl načten jako vzor a profilový návrh, ne jako potvrzené příjmy,
nároky na slevy nebo potvrzení podání. Zdrojová složka ročních faktur a úhrad
dosud nebyla dodána. Úplná skutečná parity je **NOT_VERIFIED**.

Všechny exporty jsou místní. Finanční správa, ČSSZ ani OZP zatím žádný generovaný
soubor nepřijaly. PDF DPFO/P1/ČSSZ jsou čitelné opisy, ne oficiální tiskový layout.
Přeplatky/bonus, skutečné výdaje, zahraničí, souběhy a jiné pojišťovny mají
výslovnou stopku před finálním exportem. Bankovní automatické párování,
e-mailové připomínky a celá integrace do IntentSmith nejsou implementované.
