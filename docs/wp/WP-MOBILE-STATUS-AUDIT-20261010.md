# Mobilní aplikace — ověření aktuálního stavu 2026-10-10

Autorita: explicitní zadání operátora „ještě prověř stav mobilní aplikace pro
IntentSmith“, přijatá PRODUCT/DIRECTION, Decision 042 a stávající M7 kontrakty.
Jde o audit, ne o zavedení nové capability, aktivaci listeneru či release.

- Základ: živě ověřený GitHub main `138e958be927df9835c091d3ad41d44b347e85b5`
  a fast-forward na ověřenou IDE baseline
  `46337ee66f8788f9ca2f041c165d4e35b3f242cf`. Pokračování používá tentýž vlastní
  checkout; předchozí worker/specialist větev i evidence zůstávají zachovány.
- Vlastněné zapisované cesty: tento WP, výsledný report
  `docs/review/2026-10-10-MOBILE-STATUS-AUDIT.md` a kompaktní receipt v
  `docs/review/evidence/mobile-status-audit-20261010/`. Build používá pouze
  vlastní ignorované dependencies, assety, Gradle výstupy a testové sandboxy.
  Případné generované tracked soubory se ověří vůči zaznamenanému source;
  žádná produktová oprava ani změna kontraktu není součástí tohoto auditu.
- Kontroly: všech 47 ACTIVE C3-031/C3-032 registry programů na přesném čistém
  HEAD přes izolovaný runner, standardní `npm run test:mobile`, registry,
  source call graph nového chatu a dostupný JDK21/API36 Android test/lint/debug
  build. Fyzická device/VPN přejímka se spustí jen pokud existují její skutečné
  vstupy; žádný emulator/browser/mock se nepovýší na fyzický PASS.
- Demonstrace mezery: aktuální UI newChat → lokální ID → M7 execute pro
  neexistující DB konverzaci; odlišit od úspěchu existující konverzace a doložit
  konkrétní odmítací kontrakt. Stávající testy a release kritéria se neoslabují.
- Host inventura je read-only: rozpoznaná VPN, listener 7443, existence
  credential directory bez čtení secrets, signer metadata bez key bytes,
  ADB dostupnost/device count a přesné toolchain verze.
- Stop: chybějící fyzický telefon, VPN, produkční credentials, signer nebo
  capability create znamenají NOT_RUN/BLOCKED, nikoli jejich vymyšlení.
  Neprovádí se nasazení, instalace do telefonu, podpis release, změna sítě,
  restart hostu ani zásah do živého release/IDE či cizího dlouhého soaku.
- Handoff: poctivý verdict, konkrétní zbývající kroky, exact SHA a hash evidence;
  commit/push samostatné audit větve s živou verifikací vzdáleného HEAD.

Workspace budget navazuje na čerstvý report předchozího auditu: 89 chráněných
checkoutů, 0 bezpečně retirable. Tento audit nevytváří další worktree ani
neodstraňuje cizí data. Předchozí sedm důkazních runtime kořenů zůstává chráněno.
