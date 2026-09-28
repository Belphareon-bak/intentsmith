# Kontrakt: multimediální práce po 1.0

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11.

Uživatel připojí obraz, audio nebo video; aplikace ověří formát, zobrazí
náhled/metadatový rozsah, provede podporovanou analýzu, přepis, generování
či úpravu a umožní export skutečného souboru. Matice funkcí musí před
implementací oddělit obraz (analýza/generování/úpravy), audio
(přepis/syntéza/úpravy) a video (analýza/úpravy/generování). Každá buňka má
konkrétní provider/model/toolchain, formáty a velikostní/délkové limity.
Chybějící provider se nevydává za funkční tlačítko ani za úspěšný placeholder.

`MediaAsset@1` nese MIME odvozené z obsahu, digest, provenance, rozměry/délku,
scope a retenci. `MediaJob@1` nese vstupy/výstupy, přesné modelové a codec
identity, rozpočet, průběh a terminál. Výstup se zveřejní atomicky až po
ověření formátu a dekódovatelnosti. Síťový provider má explicitní consent
pro odeslaná data; lokální provider není automaticky povolený proces.

Vlastněné oblasti: stávající media/attachment adaptéry, izolovaný job runner,
model/execution porty a Studio views. Dekodéry a kodeky běží s omezením
CPU/RAM/GPU/disku/času a bezpečným filesystem scope. Nepřebírat příkazy z
metadat, důvěřovat příponě nebo ukládat neomezené EXIF/soukromé přílohy.

Akceptace pro každou podporovanou buňku: reálný vstup→job→náhled→export→
znovu otevřít mimo aplikaci; pozastavení/zrušení, restart a mazání dat.
Negativní fixture: decompression bomb, poškozený kontejner, MIME mismatch,
nadlimitní délka, chybějící codec/model, vyčerpaný disk a provider error.
Kvalita přepisu/obrazu/videa se měří odlišnými předem zvolenými metrikami
a lidským referenčním hodnocením; úspěšný transport není kvalita obsahu.
