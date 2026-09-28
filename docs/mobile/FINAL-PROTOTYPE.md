# IntentSmith Mobile — kanonický stav a cesta k produkci

> **Rozsah tohoto dokumentu:** jde o zachovaný handoff přesného zdrojového
> kandidáta `7cf1c8b7`, nikoli o aktuální stav integrační větve. Čísla `43/43`,
> registry `420` a operátorský stav M5/M6 níže jsou historická evidence tohoto
> kandidáta. Aktuální stav drží `ROADMAP.md` §11 a `SYSTEM-MAP.md`; přenos
> klientských bajtů na dnešní linii vymezuje
> `docs/wp/WP-M7-MOBILE-CLIENT-INTEGRATION.md`.

**Aktualizováno:** 2026-08-27

**Kandidátní větev:** `codex/mobile-prod-client-20260826`

**Vstupní revision:** `ccea2d32c0ab4d9b05eae30aeedfe305a44413ef`

**Verdikt:** `CLIENT_P1_IMPLEMENTATION_GREEN / REMOTE_CORE_CONSUMER_PINNED /
RELEASE_TRANSPORT_BLOCKED / REVIEW_PENDING`.

Mobilní klient a Android shell mají implementované lokálně řešitelné P0/P1
hardening položky. M2 `RemoteCorePort@1` a review-passed M5 in-process adaptér
jsou nově přesně připnuté na straně klienta. Celý produkt ale **není
production-ready**: M5 adaptér poskytuje jen 2/7 capability a nepokrývá mobilní
list/history operace, zatímco M7 listener, autentizace, pairing, wire transport,
serverová revokace/audit, fyzická device matice, produkční podpis, distribuce a
nezávislé security/release review zůstávají otevřené.

Chybějící operation/payload hranice už není jen obecný blocker: exact
mobile-owned kandidát je v
[REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md](REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md),
requirements digest `sha256:e076d2…a0654`. Navazující
[CORE-M7-CAPABILITY-HANDOFF.md](CORE-M7-CAPABILITY-HANDOFF.md) už obsahuje
executable nested schémata, per-capability digesty, 18 golden success/error párů,
negativní drift fixtures a in-process provider gate. Zůstává však
`CANDIDATE_NOT_ACCEPTED / NO_BACKEND_AUTHORITY`; žádný provider ani M7 transport
tím nevznikl.

Operátorská zpráva platná pro tento zdrojový snapshot z 2026-08-27 byla
**M5 `8/9`, M6 `1/8`**. Starší M6
closeout dokumenty v jiném worktree ani lokálně zelené technické bloky toto
operátorské počítadlo nepřepisují.

Jediný vstup do mobilního vývoje a hierarchie dokumentů jsou v
[README.md](README.md). Tento soubor zůstává stavovým ledgerem zdrojového
kandidáta; současný milestone stav drží nadřazené `ROADMAP.md` a
`SYSTEM-MAP.md`.
Praktické příkazy jsou v [TRYING-IT.md](TRYING-IT.md), kritéria hotovosti v
[PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md) a dobová evidence původního
prototypu v [archive/PROTOTYPE-485c3497.md](archive/PROTOTYPE-485c3497.md).
Nadřazené autority `PRODUCT.md`, `CONTRACT.md`, `DIRECTION.md`, `ROADMAP.md` a
`SYSTEM-MAP.md` tímto dokumentem nejsou měněné.

## 1. Co je dnes skutečně hotové na klientovi

| Oblast | Stav | Důkaz / hranice |
|---|---|---|
| Android baseline | `IMPLEMENTATION_GREEN` | Capacitor `8.5.0`, minSdk 24, compile/target API 36, AGP 8.13, Gradle 8.14.3, JDK 21 |
| Obsah APK | `IMPLEMENTATION_GREEN` | `webDir: ../src/mobile/client`; žádný `server.url`; klientský kód je zabalený v APK/AAB |
| Native secrets | `IMPLEMENTATION_GREEN` | přímý AndroidKeyStore AES-GCM; klíč je neexportovatelný, v preferences je jen IV a ciphertext |
| Doménová data | `IMPLEMENTATION_GREEN` | cache, journal a drafty v Android shellu používají tentýž šifrovaný native store; při chybě vaultu se nepřechází tiše na WebView storage |
| Lock/lifecycle | `IMPLEMENTATION_GREEN` | `FLAG_SECURE`, systémový `BiometricPrompt`/device credential, nulová background grace, abort requestů, session epoch a wipe JS credentialu; pairing bez zámku telefonu se odmítne |
| Identita a cache | `IMPLEMENTATION_GREEN` | oddělení podle gateway originu + protocol version + device id; změna identity maže předchozí cache/journal/drafty |
| Retence | `IMPLEMENTATION_GREEN` | cache 15 min; dokončené journal položky 24 h; otevřené `PENDING/UNKNOWN` se nemažou; drafty 30 dní |
| Scope/revoke/logout | `IMPLEMENTATION_GREEN` | ztráta scope maže odpovídající S2 data; 401/403 revokace a logout mažou credential i doménový store fail-closed |
| Vývojový síťový klient | `IMPLEMENTATION_GREEN / DEVELOPMENT_ONLY` | přesný prototypový protokol `m1.2026-07-30`, striktní success envelope, `no-store`, bez cookies, redirect fail-closed, absolutní native gateway origin |
| RemoteCore consumer pin | `IMPLEMENTATION_GREEN` | descriptor `sha256:245abe…6c52`, M5 adapter manifest `sha256:34f3c2…98e52`, exact hello/negotiation validace; drift, overclaim a unknown fields fail-closed |
| Remote capability handoff | `SCHEMA_COMPLETE_CANDIDATE / CANDIDATE_NOT_ACCEPTED` | 7 capability / 14 operací + 4 samostatné M7 control-plane operace; exact nested schema/digest/fixtures/conformance gate; `conversations@2`, rootless `projects@2`; bez runtime importu a bez BE změny |
| Produkční transport | `BLOCKED` | režim `remote-core-v1` nesmí spadnout zpět na `/m1`; M7 wire adapter zatím není implementovaný a globální CapacitorHttp fetch patch musí být nahrazen origin-pinned bridge nebo vypnut |
| Stránkování | `IMPLEMENTATION_GREEN` | konverzace mají opaque cursor/load-more; notifications projdou všechny stránky s limitem a detekcí zaseknutého cursoru |
| Mutace | `IMPLEMENTATION_GREEN` | idempotency journal/draft je durably flushnutý před requestem; nejasný výsledek zůstává `UNKNOWN` |
| Accessibility automatizace | `IMPLEMENTATION_GREEN` | Chromium sada 22/22 a je v registru `ACTIVE`; TalkBack a fyzická matice zůstávají `NOT RUN` |
| Android release build | `CURRENT_HOST_GREEN` | unit test, `lintRelease`, R8/shrink, APK a AAB; build bez signing key failne |
| Supply chain klienta | `PARTIAL_GREEN` | mobile runtime audit 0; CycloneDX SBOM a licence generuje evidence skript; 3 moderate dev-only nálezy z Capacitor CLI zůstávají upstream riziko |

Browser/PWA režim je nadále vývojová plocha: bez AndroidKeyStore používá
browser storage a není produkčním security boundary. Produkčním cílem tohoto
WP je Android shell.

## 2. Reprodukovatelná evidence

Aktuální focused průchod v izolovaném worktree:

- `npm run test:mobile`: **43/43 mobilních programů PASS**, žádný mobilní test
  withheld;
- `npm run test:registry`: **PASS**, 420 runnable programů, registry SHA-256
  `54c8559095d4fe3e65af71ae58088f0e674c9367fc29cb317105f54fce7bcc8b`;
- `tests/mobile-remote-capability-contract.test.js`: **11 PASS**; exact
  capability/operation inventory, version breaky, authority boundary, cursor,
  mutation a M7 control-plane prerequisites;
- `tests/mobile-remote-capability-provider-contract.test.js`: **14 PASS**;
  reprodukovatelné schema/manifest/fixture digesty, všech 18 golden párů,
  negativní drift, result binding a provider harness 14 + 4;
- `tests/mobile-remote-core-v1.test.js`: **7 PASS** nad exact M5 negotiation
  fixture; výsledek je pravdivě `REMOTE_CAPABILITY_SET_INCOMPLETE`;
- `tests/mobile-secure-credential.test.js`: **31 PASS**;
- `tests/mobile-browser-a11y.test.js`: **22 PASS**;
- `tests/mobile-android-release.test.js`: **11 PASS**, včetně ratchetu proti
  návratu druhého klienta;
- Android `testDebugUnitTest lintRelease assembleRelease bundleRelease`:
  **PASS** s explicitním `-PallowDebugSigning=true`;
- `npm --prefix mobile-app audit --omit=dev`: **0 runtime vulnerabilities**.
- `npm run test:deterministic` na committed source `dccd3dbc`, run
  `2026-08-27T19-50-44-940Z`: **celkově FAIL**, přesně 258 PASS / 4 FAIL /
  2 BLOCKED / 0 TIMEOUT. Nový capability contract i mobilní browser/a11y sada
  včetně provider conformance gate jsou v tomto oficiálním běhu PASS. Čtyři
  FAIL jsou mimo mobile-only hranici (`m1-model-failover-schema`,
  `nightly-audit-runner-self-test`, `nightly-orchestrator-self-test`,
  `vram-coordination`); BLOCKED jsou `chat-export-budget` a `export-pdf-docx`.
  Mechanický drift root README po rozšíření registru byl opraven; focused
  `artifact-validation` je 151/151 PASS a v tomto čistém auditu také PASS.

Čistý detached checkout revision `d0ffa27b7a1c2f9dc657252ebfd7da47d5bea9a1`
prošel `npm ci` v rootu i `mobile-app`, mobile gate 40/40, registry gate,
`cap sync`, Android unit testy, `lintRelease`, R8 APK/AAB build a evidence
generátor bez dirty výjimky. Vzniklé artefakty jsou pouze důkaz sestavitelnosti:

| Artefakt | SHA-256 | Klasifikace |
|---|---|---|
| `app-release.apk` | `fb780da88525d89baf0674a7aa77b04b898e11339e3f4d97954d0cb23472985b` | `THROWAWAY_DEBUG_SIGNED` |
| `app-release.aab` | `02af50982a43beaa0ad38ed51fe8211625570fa2a83bd5855aa75b82baac075f` | `THROWAWAY_DEBUG_SIGNED` |

Package je `cz.intentsmith.companion`, `versionCode=1`,
`versionName=1.0`, minSdk 24 a targetSdk 36. Podpis je Android Debug a **není
release kandidát**. `scripts/mobile-release-evidence.mjs` debug signer bez
explicitního `--allow-debug-signer` odmítne a ukládá manifest, podpis, badging,
Gradle dependencies, audit, SBOM a licence pod ignorovaný
`.intentsmith-artifacts/mobile-release/<commit>/`. Nedebugový signer bez
očekávaného fingerprintu označí `NON_DEBUG_SIGNED_UNVERIFIED`; candidate vznikne
jen s přesnou shodou `--expected-signer-sha256`.

Root `npm audit` má 15 nálezů (2 moderate, 12 high, 1 critical) ve sdíleném/
backendovém stromu. Tento mobile-only WP je neopravuje, protože backend se
souběžně dokončuje. Pro celkový release jsou **otevřenou projektovou supply-chain
branou**, nikoli klientským PASS.

## 3. Stav proti P0/P1/P2

### P0 — pravdivý interní prototyp

- [x] Native lifecycle, lock a fail-closed secure storage jsou implementované a
  automatizovaně testované.
- [x] Klientský protokol, cache, stránkování, mutation recovery a scope wipe
  mají pozitivní i negativní testy.
- [x] Android build bez signing identity nespadne tiše na debug key.
- [ ] Fyzický telefon neprošel pairing, approve/reject/expire, process death,
  reboot, offline/outage, biometrickou a TalkBack maticí.
- [ ] Skutečný backendový effect/approval seam a jeho autoritativní review jsou
  mimo tento mobile-only WP; historická base tvrzení nebyla znovu akceptována.

### P1 — interní pilot

- [x] Podporovaný Android/Capacitor baseline, zabalené UI, R8 a AAB.
- [x] Klientská datová hranice, retention, logout/revoke wipe a runtime SBOM.
- [x] Automatická accessibility gate.
- [x] Fresh-checkout build a attestace s explicitně throwaway debug signerem.
- [ ] Produkční signing key, jeho vlastník, backup/rotace a interní distribuce.
- [ ] Fresh-checkout attestace se skutečným candidate signerem a připnutým
  fingerprintem.
- [ ] Fyzická device/OS/AT matice a dlouhý běh.
- [ ] Push policy, nebo explicitní produktové přijetí pull-only režimu.
- [ ] Root/shared dependency nálezy musí mít opravu nebo přijaté riziko.
- [ ] Nezávislé code, security a release review.

### P2 — Remote Companion release

`CONSUMER_PINNED / BLOCKED_ON_M7_TRANSPORT_AND_CAPABILITIES`. Bez níže
uvedených autorit není bezpečné vystavit aplikaci mimo USB/loopback. Lokální
klientský build tento stav změnit nemůže.

## 4. Přesný handoff na dokončovaný backend

Stabilní základ, který už klient spotřebovává:

- M2 `RemoteCorePort@1` descriptor digest
  `sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52`;
- M5 in-process adapter manifest digest
  `sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52`,
  product revision `122b5df5303e08a38cdd62a35e6577b118795c30`, samostatně
  `REVIEW_PASSED`;
- dostupné capability jsou jen `conversations@1` s `conversation.execute` a
  `projects@1` s `project-context.query`.

Backend/M7 musí ještě dodat a autoritativně přijmout:

1. Provider kontrakty podle exact mobile-owned kandidáta
   [REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md](REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md):
   14 capability operací, `conversations@2`, rootless `projects@2` a pět nových
   capability v1. Kandidát nejprve potřebuje core/M7 review a operátorské
   přijetí; nesmí být implementován jako přímý DB/route bridge.
2. Oddělený production listener s TLS a ověřenou identitou protistrany;
   žádný legacy `/api/*` ani `/c3/ws` bypass. Pozitivní i negativní boundary
   test je release gate.
   Klientská část stejné boundary musí vypnout globální CapacitorHttp fetch
   patch, nebo jej nahradit M7 bridge, který sám vynutí exact origin a operaci;
   samotná WebView CSP native patch neomezuje.
3. Autentizované endpoint discovery a pairing, issuance device identity a
   tokenu, scope/expiry, okamžitou revokaci a audit. Dnešní custom scheme
   `intentsmith://pair` je vhodný jen pro interní pilot, ne jako důkaz vlastnictví
   domény nebo bezpečné discovery.
4. Produkční zdroj pravdy pro projekty, konverzace, settings/stored information,
   approvals, notifications a typed run events včetně pagination cursors.
5. Push transport, nebo výslovně přijatý pull-only produktový model. Push nesmí
   nést S2/S3 obsah a potřebuje consent, outbound policy, retry a audit.
6. Revocation odpověď, kterou klient rozpozná jako 401/403 a po ní lokálně
   smaže credential i doménová data; recovery a multi-device semantics.
7. M7 wire fixtures/compatibility suite. M2/M5 negotiation fixture už klient
   má; chybějící transport se doplní bez přepisování UI state machine.

Do přijetí tohoto handoffu se production origin nemá zapékat do release
artefaktu a žádný remote listener nemá být otevřen jen kvůli mobilnímu testu.

## 5. Jak pokračovat bez chaosu ve větvích

1. Nechat tuto větev jako jediný mobile-client kandidát a backendové worktrees
   nedotýkat.
2. Tuto větev **nemergovat wholesale do M6**. Její merge-base s dnešní M6 linií
   je `b863190a` a ani jedna dnešní špička není předkem druhé. Po stabilizaci M6
   se mobilní změny přenesou do čisté M7 integrační větve pouze z vlastněných
   cest `src/mobile/client/**`, `mobile-app/**`, `scripts/mobile-*`, mobilních
   testů/registru a `docs/mobile/**`.
3. M7 connector WP doplní transport za dnešní fail-closed seam, M7 fixtures a
   negativní boundary testy bez redesignu obrazovek.
4. S candidate signing identitou provést čistý build a zapsat evidence manifest.
5. Projít [DEVICE-MATRIX-RUN.md](DEVICE-MATRIX-RUN.md), security review,
   recovery/long-run a operátorskou demonstraci.
6. Neobnovovat odstraněný `mobile-app/www` ani jinou alternativní klientskou
   cestu. Historické dokumenty zůstávají označené jako evidence, ne jako druhý
   aktuální stav.

## 6. Release checklist

- [x] Production konfigurace nenačítá vzdálený web/server URL.
- [x] Supported Capacitor/API baseline a fail-closed release signing.
- [x] Android credential i doménová data jsou chráněná Keystorem.
- [x] Mobile gate, registry, lint, APK/AAB, runtime audit a evidence generator.
- [x] Čistý checkout reprodukuje throwaway debug-signed APK/AAB a váže je na
  source revision.
- [x] Připnutý M2 `RemoteCorePort@1` a review-passed M5 adapter identity.
- [x] Exact mobile-owned capability/operation kandidát a negativní contract test;
  status zůstává `CANDIDATE_NOT_ACCEPTED`.
- [ ] M5/M6 přijetí podle operátorského stavu `8/9` a `1/8`.
- [ ] Plný RemoteCore capability/operation set, M7 listener, pairing, revokace a audit.
- [ ] Production signing key a distribuční účty.
- [ ] Fresh checkout s candidate signerem a exact fingerprintem.
- [ ] Fyzický telefon/OS/TalkBack matice.
- [ ] Root/shared supply-chain gate.
- [ ] Nezávislé security/release review a operátorské přijetí.

Dokud nejsou všechny nezaškrtnuté položky uzavřené důkazem, správné označení je
`CLIENT_P1_IMPLEMENTATION_GREEN / REMOTE_CORE_CONSUMER_PINNED /
RELEASE_TRANSPORT_BLOCKED / REVIEW_PENDING`, nikoli `PROD_READY`.
