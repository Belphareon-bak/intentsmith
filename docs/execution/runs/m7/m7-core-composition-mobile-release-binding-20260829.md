# M7 core composition + mobile release binding — 2026-08-29

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT / PRODUCTION_SIGNING_NOT_AUTHORIZED`

## Vazba

- vstupní evidence HEAD: `1d04bd42bbaa79e9da1fe2b6b59b6589ce8efad5`;
- exact product candidate:
  `d43e7ada01d6e5de38a06d79021bde8909d2eba3`;
- product tree: `7a188be5b2accf29d0ffed322103b5114c7ee85a`;
- composition implementace: `5c283151`;
- composition edge ratchet: `115cae51`;
- mobile release-binding remediation: `d43e7ada`;
- branch: `codex/m7-mobile-contract-integration-20260829`, bez upstreamu;
- registry: 493 runnable, 399 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `a316db7caa97b966c557d2f6f4c2934048b0b7351eb1eac22c144e5479f96479`.

## Core composition

Jeden transport-free root skládá skutečné project, conversation, settings a
stored-information adaptéry nad společným durable journalem. Operation recovery
a remote health jsou dostupné jen jako neinzerovaná control plane. Composition
nemá vlastní authority defaults: vyžaduje injektovaný provider resolver,
project/conversation autorizaci, mutation mediator, cursor key, DB, M1 executor
a health probes.

Provider pravdivě inzeruje přesně čtyři ze sedmi capability. `approvals`,
`events` a `notifications` zůstávají `unavailable`; session, listener,
pairing, síť a activation nejsou importované ani vytvářené.

## Mobile release-binding remediation

Původní mobile import z `7cf1c8b7` chybně předcházel pozdějšímu reviewovanému
headu `ab1940aa`. Bounded remediation přenesla jen product/test řezy
`aa8e8440` a `b46062f9`. Legacy server prototype, starší DB/migrace a
historické closeout dokumenty se nevrátily.

Šest přenesených výsledných blobů je přesně shodných se zdrojem:

| Cílový soubor | Zdroj | Git blob |
|---|---|---|
| `scripts/mobile-android-configure-url.py` | `aa8e8440` | `18bc8437976a67ba33f546e63772d79c6602edaf` |
| `scripts/mobile-android.sh` | `aa8e8440` | `f096a6fef358d57069c0e5f757bf7ad23d7afc39` |
| `scripts/mobile-release-artifact-binding.mjs` | `aa8e8440` | `1d42d11da903e74e4d399248f01a2a6359a03782` |
| `scripts/mobile-release-evidence.mjs` | `aa8e8440` | `7f011324eb19415df44d025a18082d97503275dc` |
| `mobile-app/android/app/build.gradle` | `b46062f9` | `fa502a3d1e2b2e3d866f9b3b73a74caef30ae3f8` |
| `tests/mobile-android-release.test.js` | `b46062f9` | `d8d5d2d58a16cc267b6e8c10155bfcae69046eb8` |

APK i AAB evidence nyní váže přesných pět client assets, Capacitor config,
runtime identitu, origin, CSP a Android network-security policy k reviewovanému
source. Production signer nemůže povýšit development transport. Build používá
`cap sync` pro úplný clean-checkout Gradle graph a lint nevyžaduje production
signing credentials.

## Focused evidence

| Hranice | Výsledek |
|---|---|
| Android production release boundary | `13/13 PASS` |
| celý mobile gate | `28/28 PASS` |
| M7 core composition | `5/5 PASS` |
| in-process provider | `11/11 PASS` |
| harness meta-test | PASS; 99 temp rootů / 121 database rootů |
| module ratchet | `13/13 PASS`; 1 230 hran / 3 cykly / 28 souborů |
| artifact boundary | `158/158 PASS` |
| registry | valid; 493 runnable; exact fingerprint výše |

## Souvislý gate

Jediný nesouběžný rozhodující běh nad exact candidatem začal
`2026-08-29T05:01:54.889Z`, skončil `2026-08-29T05:05:49.944Z` a vrátil:

```text
333 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict = PASS
exitCode = 0
```

Raw evidence:

- report:
  `.intentsmith-artifacts/m7-mobile-release-binding-isolated-20260829/m7-mobile-release-binding-d43e7ada-isolated/report.json`;
- report SHA-256:
  `aaa0b98eb2065f8dc85e73756de5e5930eec4855ae9c0ea1161a478c4a441b81`;
- inventory SHA-256:
  `374bd660ae722ea0a3bfd99a3903610180ae4922879288804a38f0dee0449189`;
- inventory fingerprint:
  `840682a9949883150ae224138aa92d13f64de38ee22614a0ff4078cf902c9305`;
- options fingerprint:
  `9b0f5493445525ad6af6160e8903e9fb9a7cc39d9424cab67ddba788405ae59b`.

Běh použil existující přesně pojmenovaný lokální PDF runtime. Nepoužil live
LLM/chat quality, Ollamu, GPU, listener, mobilní device ani síť.

## Zachovaná červená mezievidence

První dva full běhy nad stejným produktem proběhly souběžně ve stejném
worktree. Testovací sady vytvářejí krátkodobé untracked adresáře v repository
rootu a druhý runner je proto zachytil jako cizí source-tree drift.

- lokální běh: `332 PASS / 1 FAIL`; jediný fail nesl
  `?? .m2-process-test-wraymd/tree.cjs`, zatímco samotná sada měla `51/51`;
  report SHA-256
  `65341db73669cd15aae68a07dede933b27e599c5b5b2f62a21db057d0635c628`;
- souběžný review běh: `318 PASS / 15 FAIL`; všech 15 výsledků nese untracked
  adresář právě běžící sady druhého runneru; report SHA-256
  `f9dac4aa3d0632d128dc03b808f77cf9815ec1bb36339ad876d5e36e1a1aa9eb`.

Oba výsledky zůstávají pravdivě `FAIL`; nebyly přebarveny. Report `332/1`
zůstává na původní cestě pod
`.intentsmith-artifacts/m7-mobile-release-binding-offline-database-20260829/`.
Report `318/15` už na původní evidence cestě není. Nezávislý reviewer ověřil
jeho přesný SHA i červený obsah v uživatelském Koši a označil jej jako
obnovitelný; tento ledger jej proto eviduje jako
`SUPERSEDED_RED / ORIGINAL_PATH_MISSING / RECOVERABLE_IN_TRASH`, nikoli jako
přítomný artifact nebo PASS. Koš nebyl během remediation měněn. Následný
nesouběžný úplný běh je nový report nad nezměněným SHA.

## Limity

Tento blok není M7 acceptance. Produkční signing, APK/AAB distribuce,
device/TalkBack evidence, session, pairing, listener, transport activation a
skutečné production cursor/session klíče neproběhly. Live LLM/GPU práce zůstává
odložena podle operátorského pokynu. M6 24h soak běží nad starším exact
kandidátem a na tento SHA není přenositelný.
