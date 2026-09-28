# Nezávislé review technické integrace — 2026-09-09

Stav: **SCOPED_REVIEW_PASSED / DETERMINISTIC_BASELINE_FAIL / NOT_RELEASE_READY**.
Kandidát: `70eef905b9f779958a5ce908d6ed03fac53602f9`.
Tree: `8776f4d335fffdb948a82660a993226572af8a3c`.
Tento zápis shrnuje samostatné review agentů `/root/verify_convergence`,
`/root/verify_mobile` a `/root/verify_release`; integrátor opravy implementoval
a zapracoval jejich výsledky. Není to Opus review ani operátorský podpis.

Scope: [WP](../wp/WP-CORE-COMPLETION-20260909.md).
Přesné běhy, příkazy, hashe a hranice:
[run evidence](../execution/runs/core-completion-20260909.md).

## Převzaté řezy a nalezené vady

| Rozsah | Původní nezávislý výsledek | Výsledek na současném kandidátu |
|---|---|---|
| MC1, složení release pojistek `f7f78d5a` | REVIEW_PASSED, 256 paměťových kombinací obou modes | REVIEW_PASSED, policy ani evidence generator se nezměnily |
| MC2, locale inventory `f7f78d5a` | REVIEW_PASSED, 242 exact route entries a 17 operation identities/scopes | REVIEW_PASSED, locale implementace beze změny |
| MC3, Android source/artifact binding `f7f78d5a` | **P2 CHANGES_REQUIRED** — declared index hash byl legacy-mode hash | **REVIEW_PASSED**, oprava i nové skutečné APK/AAB nezávisle ověřeny |
| B `036ba6bd..9ae1a516`, canonical JSON corpus/recovery a B registry scope | REVIEW_PASSED v tomto přesném rozsahu | REVIEW_PASSED; zdrojová delta a Java fixture převzaty beze změny |
| B systemd renderer | **P1 CHANGES_REQUIRED** — procentní bind suffix dovolil systemd/environment injection | **REVIEW_PASSED**, renderer a runtime vstup odmítají neplatné IP |
| Privacy scanner `2f11e911..70eef905` | Potvrzený false-positive veřejného credential filename | **REVIEW_PASSED**, úzká byte-pinned výjimka a zachované secret negativy |

Původní neúspěšné review a staré artefakty se neoznačují zpětně PASS. Úplná B
větev končící `0b0a4669` je druhým rodičem produktového merge; nezůstala pouze
ručně překopírovaná část bez ancestry.

## Nezávislé ověření oprav

**Renderer:** reviewer odmítl 10 škodlivých bind hodnot přímým rendererem i
runtime normalizátorem; všech 9 reprezentovatelných CLI variant skončilo
exit 2 s prázdným stdout. NUL nelze předat v argv a byl ověřen přímým API.
Tři validní IPv4/IPv6 případy prošly. Žádné další scope-blocking vady nenalezeny.
Skutečná produkční konfigurace a aktivace se netestovaly.

**Android:** reviewer otevřel nová APK i AAB v retained bundle
`70eef905b9f7-KWGSVY`, znovu spočítal jejich hashe, ověřil source identity,
všech osm client assetů proti připnutému Git stromu, samostatně transformovaný
HTML index a runtime config digest. Oba nested source manifesty nyní hashují
skutečný index `6935b796…96e13`. Review tím uzavírá konkrétní P2 vadu;
`runtimeEvidence:null` a `releaseTransportReady:false` zůstávají pravdivé.

**Privacy:** původní `NAMED_LITERAL` pravidlo zůstalo beze změny. Výjimka
vyžaduje přesnou cestu, jedinou deklaraci, SHA-256 jejích bajtů a jediný match
offset 114. Všech 12 nezávislých paměťových kontrol dopadlo očekávaně:
změněná hodnota/název, další přiřazení, duplicate declaration, jiný soubor,
Unicode prefix, CRLF změna a fallback. Výstup neprozradil canary.
Reviewer nezávisle spustil skutečný scanner na čistém kandidátu: current tree
PASS / 0 findings, ale všech 13/13 incidentních objektů dál reachable.

## Plné běhy

Reviewer zkontroloval všech 352 log hashů v každém ze dvou reportů a na každém
řádku exact čistý source `70eef905`, provedený cleanup, `leakDetected:false`
a `terminated:true`. Oba reporty mají stejné source, registry, inventory a
options fingerprints. Pro opravu prostředí se nezměnil žádný test/oracle.

- Původní běh 349 PASS / 3 FAIL zůstává raw FAIL.
- Krátký klon: 351 PASS / 1 FAIL; report SHA-256
  `6e7a6453f086b6b253a443745660d5bf012c8e5c6f6ad73aa570c5afed825e10`.
- Jediný zbývající FAIL je sealed Gate 0 registry fingerprint drift.

Celý deterministic gate tedy **není PASS**. Review potvrzuje opravený
integrační scope a příčinu výsledků; nepřijímá nový release ratchet.

## Provider preparation — oddělený výsledek

Reviewer provedl statické review čisté Ollama
`0cb3844557c2cbf0beac555da0147279eebd9488` proti rodiči `d67ad834…` a ověřil
všech 54 staged binary/unit/native-library identit. Nebyla nalezena vada
v předání `Model.Digest` stejného scheduler-selected modelu do odpovědi.

Po prvním pravdivém `GO_TOOLCHAIN_ABSENT` byl pouze do privátního artifact
kořene stažen oficiální compiler Go 1.26.7, odpovídající embedded build
metadatům kandidátní binárky. Archiv byl ověřen proti oficiální velikosti a
SHA-256. Čistý zdroj se zkompiloval exit 0. V síťově/PID/device izolovaném
bwrap prošly `TestChatHandlerChatTemplateRoute` a `TestGenerateChat` včetně
všech 15 subtestů, exit 0. Mock runner a stub GPU nepoužily živý model/store.
Source zůstal read-only a čistý; zápisy měly vlastní HOME/models/cache/tmp.

Raw příkazy, identity a logy jsou v
`.intentsmith-artifacts/core-completion-20260909/provider-proposal/toolchain/evidence/`.
Výsledek: `STATIC_AND_SELECTED_REGRESSION_REVIEW_PASSED`, nikoli runtime
provider acceptance. [Provozní návrh a rollback](../execution/runs/m6/core-provider-activation-proposal-20260909.md)
čekají na vyhrazené oprávnění a skutečnou administrátorskou autentizaci.

M5 custody/rotace/history, celý M6 release gate, live modely, soak, operátorské
demo/podpisy a M7 fyzická/runtime/distribuční evidence zůstávají otevřené.

Dokumentační closeout následně dostal samostatné `DOCS_REVIEW_PASSED` od
`/root/verify_convergence`: aktuální stavy, odkazy, historical FAIL a oba
hashově nezměněné přesunuté reporty souhlasí. Následující commit mění pouze
dokumentaci a nevydává svůj HEAD za nově měřený produktový kandidát.
