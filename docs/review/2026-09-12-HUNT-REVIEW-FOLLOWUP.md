# Repo scoring: uzavření připomínek a společný core kandidát

**IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING.**
Operátorovo review repo-scoring packetu bylo ověřeno proti skutečné DB,
službám a call graphu. Nová implementace je `20e5a02255fb18e2795ded184c581675aa7135eb`;
rozsah proti předchozímu core předání je `fd653630..20e5a022`. Merge `a67d448d`
přebírá hunt `5e3521ef`, včetně repo úloh, scoring refresh a sidebar fixu
`9d5e207a`. Cizí checkout, DB, služby ani modely tento WP neměnil.

## Výsledek panelu a význam skóre

Původní čtyřrozhodnutový pilot skutečně rozhodl podle kvality. Následný
instalovaný panel skončil **2026-09-12 18:53:06 CEST**, 12 kandidátů,
0 top-level errors, 0 roleErrors, 0 odstranění. Z 38 párových rozhodnutí:

| Výsledek | Počet |
| --- | ---: |
| INCUMBENT_QUALITY | 22 |
| CANDIDATE_QUALITY | 3 |
| INSUFFICIENT_EVIDENCE | 13 |

V provozní DB po pilotu a panelu je 30 reasoning + 12 review COMPLETE,
0 FAILED/BLOCKED pod `*-repo.1`. Všech 42 má stejný kontrakt jako společná
core větev, tři opakování a provider `0.34.0-intentsmith.1`. Čtyři pilotní
a 38 panelových decision rows obsahují 13 INCONCLUSIVE; dřívější tvrzení,
že všechna INCONCLUSIVE jsou historická, už po dokončení panelu neplatí.
Zmizení stropu skóre neznamená, že každá dvojice splní minimum rozlišení.
Offline replay současné rozhodovací policy reprodukoval všech 38 výsledků;
jde o replay uložených comparisons, ne nové inference nebo přehodnocení odpovědí.

Portfolio navrhuje pouze R2: `qwen3:14b` → `devstral-small-2:latest`.
Absolutní rozdíl skóre je 0.255; párová marže na sedmi rozlišujících úlohách
je 0.364 (5:2). Práh se aplikuje na párovou marži. Návrh neaktivuje binding.

## Chybějící incumbent a ranní služba

- Chybějící COMPLETE je cache miss: `runSuiteCached` incumbenta doměří.
  Pokud inference selže, `candidate-trial` zachová ostatní role; journal je
  RETRYABLE. Není důvod předem zablokovat celou noc kvůli nehotovému panelu.
- Buňky zmíněné v review jsou již COMPLETE: Qwen3:14b D2 v 18:43:49,
  R1 v 18:44:27, Qwen3.8 D1 v 18:46:07 CEST. Navíc nejsou incumbentovy
  role tohoto panelu: D1 má Qwen3.5, D2/R1 Qwen3.8 a R2 Qwen3:14b.
  Incumbentovy nové baseline byly dokončené nejpozději v 18:16:21.
- Nová DB regrese v `model-upgrade.test.js` projde změnou reasoning kontraktu,
  ignoruje stará COMPLETE, uloží kandidáta, vyvolá timeout incumbenta,
  zapíše FAILED jen správné identitě/roli a po novém sestavení callbacks
  doměří pouze tři opakování incumbenta. Staré řádky a FAILED zůstanou.
  Test používá řízené odpovědi; fyzickou kvalitu dokládá oddělený panel.
- `intentsmith-model-hunt-bootstrap-20260911.service` skutečně skončila
  09:24:22 CEST s exit 1, invocation `a07d9f3f1bc24b3eb1675c0b8b8e9f67`.
  Poslední FAILED ale vznikly v 09:21:31 a v 09:22:37 pokračoval další duel.
  Není doložené, že poslední vypsaná chyba byla příčinou ukončení služby.
  Již existující validační packet popisuje operátorské zastavení a suspend.
- Všech 32 FAILED odpovídá **pěti** neúplným starým duelům: Devstral 7,
  Qwen3-coder 6, Qwen3.6 7, Qwen3-30b-a3b 6, Phi4 6. Starý writer rozmnožil
  chybu incumbenta do kandidátových rolí; nejde o 32 samostatných měření
  kvality. Osm zachovaných provider log excerptů dokládá přerušený cold load,
  HTTP 499 kolem 30 s. Současný 120s timeout a per-role oprava existují již
  v `ed3d57ff`; tento WP je nepředstírá jako nové opravy.

Tyto tři provozní body už byly přesně pojmenované v `a0b73c47`, tedy před
`5e3521ef`: [retention checkpoint](2026-09-12-GPU-HUNT-RETENTION-REVIEW.md#neúspěšný-bootstrap-a-již-dodaná-oprava).
Zde přibyla nezávislá aktuální kontrola a regresní důkaz po rotaci kontraktu.
Historické packety se nepřepisují.

## Provider a sidebar

Systémový 11434 i evaluační sidecar používají `0.34.0-intentsmith.1`.
Rozdělení zůstává podle účtu/odpovědnosti: systém vlastní mutace skladu,
ephemeral uživatelský sidecar evaluace. Aktuální návod již nevysvětluje
rozdíl starší systémovou verzí. Pozdější snapshot 18:56:46 CEST zastihl
11435 už vypnutý; to odpovídá dokončené dávce. Report a response metadata
uchovávají verzi jejího providera.

Historický `c3-sidebar` zdroj zůstává v workspace. Z aplikace je odstraněný
duplicitní vlastník; nový produkční postbuild guard odmítá jeho znovuzařazení
v manifestu, generovaném frontend entry i známý marker ve starém bundle.
Pozitivní build a negativní testy pokrývají tuto konkrétní regresi. Nejde
o obecný důkaz unikátnosti všech Theia widgetů ani o odstranění legacy zdroje.

## Ověření společného zdroje

Na čistém `20e5a022`, 18:59:46–19:04:19 CEST:

- deterministický offline/database profil **353 PASS**, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED;
  všech 353 log SHA-256 a source/clean metadata samostatně ověřeno;
- registry 516 programů, fingerprint `162b890b97142127fdd4859bc48a02056a837b3fd2773e26d8a130e0e55f4deb`;
- produkční Theia/Electron build po `yarn install --offline --frozen-lockfile`
  prošel consumer, preload i novou sidebar kontrolou. Frontend bundle SHA-256
  `5878a55547fb9961c4ecf1868b8f3cf6ad1af22d686e16f458ca4cd03f75791d`.

Report: `.intentsmith-artifacts/audit/hunt-review-followup-20260912-01/report.json`,
SHA-256 `5cee9c301b63760f4d31167a46053a4ecfb26aed94b7bc4f1f9b5907770c96bb`.
Tím je mezera plného gate pro integrovaný sidebar manifest uzavřená;
netvrdí se dodatečně spuštěný gate na původním samotném `9d5e207a`.

První rozpracovaný focused pokus: Studio PASS, upgrade FAIL kvůli chybějící
závorce v novém testu (bez spuštěných assertions); po opravě 126/126 a
100/100. Oba reporty zůstaly. První Yarn příkaz z kořene odmítl Corepack
kvůli npm packageManager; opakování ze `c3-ide` prošlo. Nejde o síťový failure.

## Předání a hranice

Evidence root: `.intentsmith-artifacts/hunt-review-followup-20260912/` obsahuje
SQL dotazy i 32 přesných FAILED run IDs, 42 aktuálních runů, vybrané journaly,
kopii konečného panelu/controlleru, jejich SHA, contract parity a build log.
Transient panel unit je po dokončení `LoadState=not-found`; výchozí hodnoty
`systemctl show` se nepoužívají jako exit důkaz. Exit 0 dokládá zachovaný
FINISHED controller a jeho větev, která vyžaduje nulový návrat wrapperu.

Export: `.intentsmith-artifacts/hunt-review-followup-review-20260912/`,
`source.bundle`, `manifest.json`, `evidence.tar.gz`, `handoff.json`.
Bundle je určen pro lokální review/integraci do huntu na `5e3521ef`.
Nový fyzický Studio→model journey se zde nespouštěl; předchozí je samostatně
připnutý v [production journey packetu](2026-09-12-PRODUCTION-JOURNEY-REVIEW-PACKET.md).
Z cizího dokumentačního commitu `68f5080c` byl navíc převzat
[review receipt předchozího journey](2026-09-12-PRODUCTION-JOURNEY-REVIEW-RECEIPT.md):
NO_BLOCKING_FINDINGS pro `b5ecf516..dc81a0f0`; fyzický běh recenzent neopakoval.
Receipt výslovně nepřijímá pozdější hunt ani tento integrační rozsah.
CODE kontrakt této core větve zůstává `6ee5ab47…7035`; hunt checkout má
`09d65ca7…6fdb`. Jejich CODE skóre se nesmějí zaměnit. Nové reasoning/R2,
CHAT a VISION kontrakty jsou mezi větvemi shodné.
Nezávislé review, M5/M6 acceptance a autorizovaná aplikace modelu se tím neuzavírají.
