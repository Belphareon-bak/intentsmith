# GPU hunt — paralelní oprava výběru sestavy M5

Stav: PARTIAL_M5_IMPLEMENTED / INTEGRATION_REVIEW_PENDING / NOT_DEPLOYED.
Vstup: `c367d675`.
Autorita: přímé zadání operátora pomoci paralelně druhému workerovi;
DIRECTION §8 z 24. 9.: nejvýše dvě nesouvisející role a žádná vlastní revize.

Výsledek: hunt nesmí označit sestavu za vyhovující podle různých jmen
téhož artefaktu ani dosadit nekvalifikovanou alternativu při opravě konfliktu.

Vlastněné cesty: `src/upgrade/model-upgrade-prototype.js`, jeho volající
`scripts/model-upgrade-hunt.js` a `src/upgrade/model-hunt-retention.js`,
`tests/model-upgrade.test.js`, tento WP a samostatný review dokument.
Větev `work/hunt-model-controls-20260917`, stávající checkout
`is-mobile-completion-20260908`. Žádné změny v `hunt-decision-m0`, jeho metodě,
kalibraci, registru testů ani běžícím procesu. M0 a M5 se předají samostatně.

Rozsah: kontrola přesného digestu a dodaného původu, maximum dvě role,
sdílení pouze pro výslovně povolenou dvojici; výchozí seznam je prázdný,
dokud není doložena nezávislost dvojice. Kritické author/reviewer dvojice
nelze povolením sdílení přebít. Chybějící identita nesmí být zelený audit.
Výběr zachová role mimo právě měřený rozsah a připustí změnu pouze při
kladné jednotlivé rozhodovací způsobilosti, také při opravě staré kolize.

Demonstrace: audit skutečného bindingu a inventáře pouze čtením; deterministické
sondy aliasů, neznámé identity, role mimo filtr, nekvalifikované opravy a
existujícího konfliktu. Ověření: `node tests/model-upgrade.test.js`, související
testy pairwise/current-authority a integrační kontroly dle změněných cest.

Stop condition: konflikt zapisovaných cest s M0; požadavek na změnu jeho
metody nebo produkční aktivaci. Integrace do ruční aplikace, failoveru a
ochrana konkrétního kontrolovaného výstupu jsou další hranice M5/M6;
samotný solver se za jejich end-to-end přejímku nevydává.

Předání: [změny, reprodukce, review a otevřené integrační hranice](../review/2026-09-24-HUNT-PARALLEL-RESPONSIBILITY.md).
118 + 49 + 22 cílených kontrol PASS, samostatné read-only review 12/12 PASS.
Úplné offline/database profily a doplnění ověřených systémových nástrojů:
368 PASS / 2 FAIL / 3 BLOCKED. Nejde o zelenou L1: přepočet společného
SYSTEM-MAP patří integrátorovi, dále trvá zděděný rozpor Gate 0 registru a
blokace tří PDF/OCR testů. Žádná změna produkčních vazeb.
