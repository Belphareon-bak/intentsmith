# WP-M7-MOBILE-RELEASE-ARTIFACT-BINDING

**Typ:** zapisující M7 integrační remediation blok

**Vstupní revision:** `115cae51`

**Zdroj produktu:** `aa8e8440` a `b46062f9`; source evidence HEAD
`ab1940aa`

**Exact product candidate:** `d43e7ada01d6e5de38a06d79021bde8909d2eba3`

**Stav:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PRODUCTION_SIGNING_NOT_AUTHORIZED`

## 1. Důvod

Centrální M7 větev převzala klienta z `7cf1c8b7`, který je předkem novějšího
reviewovaného mobilního headu `ab1940aa`. Chyběl tím release guard dokazující,
že oba distribuční archivy APK i AAB obsahují přesně reviewované webové bytes,
runtime identitu, origin, CSP a Android network-security policy. Záměrné
vynechání starého serverového prototypu bylo správné; vynechání guardu ne.

## 2. Přenášený rozsah

Z `aa8e8440` se přenášejí pouze:

- `scripts/mobile-release-artifact-binding.mjs`;
- Android URL konfigurace a build sync;
- rozšířené release evidence;
- adversariální Android release testy.

Z `b46062f9` se přenáší pouze signing-independent Android lint boundary a její
test. Po aplikaci se každý cílový blob porovnává s přesným blobem zdrojového
commitu.

## 3. Bezpečnostní invarianty

- APK i AAB musí nést všech pět přesných reviewovaných client assets;
- Capacitor config, runtime identity, remote origin a CSP musí odpovídat source;
- Android network-security domény a cleartext nastavení musí odpovídat
  Git-pinned release policy;
- production signer nesmí povýšit development transport;
- clean-checkout release používá `cap sync`, aby Gradle graph nebyl neúplný;
- lint nesmí vyžadovat produkční signing credentials.

## 4. Výslovně mimo rozsah

Blok neimportuje legacy server/gateway, mobilní DB migrace, starší session
prototyp, historické closeout verdikty ani production key. Neprovádí signing,
APK/AAB distribuci, device/TalkBack test, pairing, listener ani aktivaci
`remote-core-v1`.

## 5. Review a stop condition

Před review musí projít Android release boundary, celý mobile gate, harness
meta-test, artifact integrita, module ratchet a souvislý offline+database gate
na novém exact kandidatu. Operátorské rozhodnutí je nutné před produkčním
signingem, distribucí, veřejným listenerem nebo session/pairing aktivací.

Tyto hranice nyní prošly `13/13 + 28/28`, harness chrání `121`
database-reachable rootů, artifact boundary je `158/158`, module ratchet
`13/13` a nesouběžný úplný gate `333/333 PASS`. Stav zůstává
`REVIEW_PENDING`.
