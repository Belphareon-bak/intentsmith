# IntentSmith Mobile — vývojový rozcestník

Toto je jediný vstupní bod pro vývoj mobilní aplikace. Aktuální integrační
základ `de0e8127` už obsahuje M7 VPN runtime a server wiring; samotný bundled
klient však stále používá development režim a není produkční M7 consumer.
Nejnovější lokální změny, přesné SHA a ověření jsou v
[completion evidence 2026-09-08](../execution/runs/mobile/mobile-completion-20260908.md).
Postup je v [TRYING-IT](TRYING-IT.md). Globální stav a přijetí M5/M6/M7 nadále
vlastní `ROADMAP.md` a `SYSTEM-MAP.md`; tento rozcestník je nenahrazuje.

## Jedna implementační cesta

| Vrstva | Autoritativní cesta | Poznámka |
|---|---|---|
| Webový klient | `src/mobile/client/` | Jediný zdroj HTML, CSS, JS, runtime configu a service workeru |
| Android shell | `mobile-app/android/` | Capacitor shell, lifecycle, zámek a AndroidKeyStore vault |
| Capacitor konfigurace | `mobile-app/capacitor.config.json` | `webDir` ukazuje přímo na `../src/mobile/client`; `server.url` není povolený |
| Build a release evidence | `scripts/mobile-android.sh`, `scripts/mobile-release-evidence.mjs` | APK/AAB, signing guard, source revision, SBOM a audit |
| Mobilní test gate | `npm run test:mobile` | Programy jsou jednotlivě vedené v `tests/registry.json` |

Starý adresář `mobile-app/www` byl odstraněný: nebyl načítaný Capacitor
konfigurací a představoval druhou, zastaralou implementaci stejné obrazovky.
Nesmí se obnovovat. Offline, outage a retry stavy patří do
`src/mobile/client/`, aby Android i browser testy ověřovaly stejný kód.

## Dokumentační autorita

Čti dokumenty v tomto pořadí:

Nejdřív současnou completion evidence a TRYING-IT uvedené výše. Následující
materiály obsahují i historické snapshoty; datum a exact SHA jsou součástí tvrzení.

1. [FINAL-PROTOTYPE.md](FINAL-PROTOTYPE.md) — zachovaný stav a důkazy přesného
   zdrojového kandidáta `7cf1c8b7`; jeho čísla nejsou stavem současné integrace.
2. [REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md](REMOTE-CAPABILITY-CONTRACT-V1-CANDIDATE.md)
   — exact mobile-owned operation/payload požadavek pro budoucí core/M7 review;
   je `CANDIDATE_NOT_ACCEPTED`, nikoli dnešní backendová autorita.
3. [CORE-M7-CAPABILITY-HANDOFF.md](CORE-M7-CAPABILITY-HANDOFF.md) — executable
   schema, digesty, fixtures, provider acceptance matrix a stop conditions pro
   navazující connector WP.
4. [PROD-READY-HANDBOOK.md](PROD-READY-HANDBOOK.md) — acceptance kritéria a
   pořadí cesty do produkce; není to samostatný stavový ledger.
5. [TRYING-IT.md](TRYING-IT.md) — lokální web/Android runbook.
6. [DEVICE-MATRIX-RUN.md](DEVICE-MATRIX-RUN.md) — fyzický testovací protokol;
   dokud není vyplněný na zařízení, zůstává `NOT RUN`.
7. Návrhové reference: [PLAN.md](PLAN.md), [DATA-MODEL.md](DATA-MODEL.md),
   [SCREENS.md](SCREENS.md), [UI-DESIGN.md](UI-DESIGN.md),
   [TEST-STRATEGY.md](TEST-STRATEGY.md), [GATEWAY.md](GATEWAY.md),
   [COVERAGE.md](COVERAGE.md) a [MULTI-DEVICE.md](MULTI-DEVICE.md).

Stavové hlavičky datované 2026-08-01 v návrhových referencích jsou historický
baseline, nikoli dnešní verdict. `CONTRACT-V2-PROPOSAL.md` je návrh s
`CHANGES_REQUIRED`, ne přijatý wire kontrakt. Soubory `WP-*`, datované UI review
a obsah v `archive/` jsou implementační nebo review historie; žádný z těchto
mobilních dokumentů nesmí přepisovat aktuální stav z `ROADMAP.md` a
`SYSTEM-MAP.md`.

## Pravidlo pro další vývoj

- Mobile-client změny pokračují na jednom kandidátovi a neslučují se mechanicky
  s backendovými worktrees.
- M2 `RemoteCorePort@1` a M5 adapter identity smí klient spotřebovávat pouze
  přes exact digest pin a negativní compatibility test.
- Decision 042 je přijatá autorita pro M7 VPN implementaci, nikoli důkaz
  provozní aktivace. Mobilní práce bez BE vlastnictví nemění server, DB,
  migrace ani wire surface a nesmí vydat `/m1` za produkční fallback.
- M7 connector WP doplní transport nad existujícím fail-closed seamem;
  klientská state machine a Android security boundary se neduplikují.
- Nový alternativní klient, shell nebo stavový dokument potřebuje předem
  výslovné rozhodnutí, vlastníka a plán odstranění nahrazované cesty.

Povinné lokální minimum před handoffem:

```bash
npm run test:mobile
npm run test:registry
npm run test:deterministic
git diff --check
```

Focused mobilní PASS není celkový release PASS. Aktuální verdict vždy převezmi
doslova z `ROADMAP.md` §11 a `SYSTEM-MAP.md`.
