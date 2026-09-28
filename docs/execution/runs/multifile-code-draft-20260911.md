# Multi-file draft: společný běh 2026-09-11

Status: IMPLEMENTATION_GREEN / REVIEW_REQUIRED, nikoli M5/M6 acceptance.
Implementation/test source: `c6c9ee3a4c687729d0f266277dee5b9279c9880d`.
Review rozsah a omezení: [review packet](../../review/2026-09-11-PRODUCTION-FOLLOWUP-REVIEW-PACKET.md).

Dříve Studio vyžadovalo ruční JSON nebo jeden malý modelový soubor. Nyní přijímá
1–3 explicitní cíle, postupně sestaví úplné obsahy a předá jeden exact plán do
přijaté M2 cesty. Současně lze zastavit probíhající approval/test přímo ze Studia.

## Původní neúspěch a oprava

`.intentsmith-artifacts/multifile-service-01.log`: 30 PASS / 2 FAIL.
Nový tří-souborový oracle očekával vstupní pořadí, zatímco přijatý compiler řadí
cesty kanonicky. Opravený oracle vyhodnocuje tento existující kontrakt; runtime
řazení se neměnilo. Následný run02 má 32 PASS, run03 s option-path regresí 33 PASS,
run04 s cancel během final preparation 34 PASS. Původní log zůstává zachovaný.

Source review nalezlo Studio cancel blok, CJS wrapper escape, Node option path
a chybnou klasifikaci pozdního cancel. Všechny tyto nálezy mají implementaci a
odpovídající regresi; engineering source recheck finálního c6c9 nehlásí další
otevřený nález v kontrolovaném rozsahu. Povinné nezávislé review se tím nenahrazuje.

## Společná deterministic evidence

```
LC_ALL=C INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python \
 npm run test:deterministic -- \
 --allow-blocker=toolchain:git --allow-blocker=toolchain:bwrap \
 --allow-blocker=toolchain:bubblewrap --allow-blocker=toolchain:prlimit \
 --allow-blocker=toolchain:python-pdf-runtime \
 --run-id=multifile-draft-20260911-01 --out-dir=.intentsmith-artifacts/audit
```

2026-09-11T20:22:30.586Z až 20:27:39.704Z: **353/353 PASS**, 0 FAIL/TIMEOUT/
BLOCKED/SKIPPED, žádné retry. Profil 279 offline + 74 database; prerekvizity jsou
explicitní lokální toolchain, nikoli přepsaný verdict. Registry 515 programů
(421 ACTIVE, 79 BLOCKED, 15 HISTORICAL), fingerprint `bb85f822…c6`, zůstává stejný.
To, že deterministický profil nemá BLOCKED, neznamená odstranění 79 ostatních
BLOCKED položek registry. Ověřeno všech 353 log hashes/source/uniqueIDs.

Report: `.intentsmith-artifacts/audit/multifile-draft-20260911-01/report.json`,
SHA256 `82b5dfbe00ce88acdb2e82b63b79e28ca2396ad33ec2ff0f4c2f91662767c040`.
Cílené programy v tomto společném běhu zahrnují service 34 cases, Studio 21 cases,
gateway 32, pairwise 37 a upgrade 62; nejde o dodatečné počty programů.
`npm run test:registry` a artifact validation jsou také PASS.

## HTTP a Studio

Skutečný izolovaný server: `IS-T3-TESTS-M2-LIFECYCLE-HTTP-E2E-TEST`, **24/24 kroků
PASS**, source c6c9. Run `.intentsmith-artifacts/run-suites/2026-09-11T20-22-02-381Z/report.json`.
Příkaz:

```
unshare --user --map-root-user --net -- sh -c \
 'ip link set lo up && exec node scripts/run-suites.js --keep-run-root --suite=IS-T3-TESTS-M2-LIFECYCLE-HTTP-E2E-TEST'
```

HTTP důkaz obsahuje skutečné odmítnutí nepovolených multi-file scope před
inference a existing prepare/approve/test/exact Git/durable status. Kladná
modelová generace je samostatný fyzický test, nikoli součást tohoto server runu.

`corepack yarn build` v `c3-ide/`: PASS, 48.46s. Log
`.intentsmith-artifacts/multifile-studio-build-01.log`. Build začal na 9ececb27;
pozdější c6c9 měnil pouze backend service, test a census, Studio source je shodný.
Bundle 12977254 B, SHA256
`c4942771a516a1d7c129f4f96e21fcfde8e13fdd914a7d274001881021fc23a7`.

## Skutečný model na aktuálním stromu závislostí

Test `IS-T3-TESTS-M2-CODE-DRAFT-MODEL-TEST` na c6c9: **PASS**, 35448 ms.
Aktuálních 170 installed package versions odpovídá locku
`bd8087a52d35dbeaa25f024ed79d5bb1a0d279172f33708ee19804aa524f847e`.
Jde o kontrolu verzí proti locku, nikoli hash každého instalovaného souboru.

| Vlastnost | Naměřeno |
|---|---|
| Model | qwen3.5:27b |
| Skutečný digest obou raw odpovědí | `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e` |
| Provider | 0.32.14-intentsmith.1 |
| Kontext / limit výstupu | 4096 /1536 pro každý request |
| První hovor | 225 vstupních /68 výstupních tokenů, stop |
| Druhý hovor | 263 vstupních /59 výstupních tokenů, stop |
| Funkční výsledek | calendar.mjs + month.mjs,12 Gregorian assertions PASS |
| Efekty | původní oba soubory před approval, jeden exact plan, sandboxed test, durable succeeded, rekonstrukce služby bez replay |
| Izolace | source clean; scope `intentsmith-contained-v4-886d098a52294fa0.scope` inactive; pre/post provider a deset modelových manifestů beze změny |

Runner report SHA256:
`7be1635e4e1674d4b35598a33d40634641212fa89461102cbd880b528c52b547`.
Program report SHA256:
`4b4958da845776611d7451e1ab752794613347383da6d9f507f9eb1b12c4abc0`.
Host raw validation SHA256:
`e635c608f6623d0618e910427b7b9cadfe24b05233bad78e3ae4c9ed2fdf28c5`.
Přesné cesty a hashe jsou ve `.intentsmith-artifacts/production-followup-evidence.json`.

Původní launcher byl zkopírován do vlastního externího proposal adresáře.
Delta odděluje přesný instalovaný inventář od povolené inference: nový Devstral
je pouze inventární položka, request smí jít výhradně na připnutý Qwen. Každá
jiná změna inventáře dál failuje. Ostatních 18 funkcí/tříd je AST-identických;
namespace/relay/resource/cleanup implementace se nemění. Root prověřil diff,
driver, validátor, manifest a offline evidence před spuštěním. Návrh má pouze
engineering review, nepřebírá původní nezávislé review launcheru. Nový post-run
validátor rehashuje raw bytes a vyžaduje přesně 2 úspěšné serial calls, skutečný
digest, 4096/1536,stop, program PASS a ukončený scope. Starší single-file PASS se
starými dependencies a inventory-blocked run03 zůstávají historickou evidencí.

Fyzický test vstupuje do produkční application service bez startupu serverové
DURABLE binding authority. Modelové a Studio výsledky nejsou jeden spojený
journey a rekonstrukce služby není restart procesu. Kompletní projektový
builder, konsolidace dalších větví, nezávislé connector review a M5/M6 acceptance
zůstávají otevřené.

## Electron a uzavření evidence

Oba skutečné programy `studio-electron-boundary.e2e.js` a
`studio-m1-electron-journey.e2e.js` na c6c9 prošly: **2/2 PASS**. První používá
produkční backend, druhý kontrolovaný M1 fixture. GPU zařízení byla skrytá;
soukromý Xvfb :230 je ukončen a source po běhu čistý. Důkaz potvrzuje sestavení
a stávající runtime hranice; nové M2 concurrent cancel UI je přímo ověřeno VM
suitou, nikoli vydáváno za nový úplný Electron modelový journey.
Příkaz: `python3 .intentsmith-artifacts/run-multifile-studio.py`.

Workspace cleanup běžel pouze ve dvou vlastních checkoutech. Chrání evidence
a živou větev; žádný nový worktree nevznikl. Přenosný manifest a archiv ověřují
raw modelové páry, reporty i všech 353 auditových logů. Source zůstává c6c9,
navazující commit mění pouze dokumentaci.

Electron result SHA256: `e31a86836cdfcac4302d1426f544b7809e63b97affbaf9b4dc4e7c66c0c13c0c`.
HTTP report SHA256: `148fe87d4ebca2616d1ef54a471069300b7970244f9c9893e5c98c0a2a9f027f`.
