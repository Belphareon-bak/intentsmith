# IntentSmith — víceúrovňová roadmapa k production-ready produktu

**Navazující M5 review, 2026-09-17:** čtyři closeout opravy nezávisle ověřené,
nový nález je neúplný historický inventář. Doplnění 13 → 15 zachovává původní
containment a vyřazuje zveřejněný TLS pár. Podpisy a acceptance zůstávají
otevřené; nový scan musí vázat doplněný manifest. [Remediace a review scope](docs/review/2026-09-17-M5-TLS-HISTORY-REMEDIATION.md).
Další re-review potvrdilo opravu a identifikovalo 8 zbytkových instalovaných
kopií páru, ponechaných beze změn. Aktivní `d4dea0bb` je bez páru. Původní
soak přerušen restartem 21:20 (FAIL/SIGTERM); nový 24h běh na `d4dea0bb`
spuštěn 21:26 CEST. Podepsané vypořádání a výsledek soaku zůstávají otevřené.

**Předchozí production closeout, 2026-09-17:** instalovaný kandidát `c2989a3e`
zachovává všechny níže uvedené opravy i aktuální Studio design. Opravené
OCR prostředí, retained-heap měření, dlouhé Unix socket cesty a generování
privátních TLS fixtur: **358 PASS / 1 FAIL / 0 BLOCKED** v celém
offline/database profilu. Zbývá release pečeť. Šest HTTP programů / 134 kontrol,
čistý Studio build, nulové aktuální privacy nálezy a 5min health throughput
PASS. Skutečný 24h soak od 18:29 CEST běží; GPU/NVML a zdroj historie Sázkaře
zůstávají BLOCKED. M5 custody/podpisy, M6 kompletní evidence a nezávislé
přijetí se tím neuzavírají. [Packet](docs/review/2026-09-17-PRODUCTION-CLOSEOUT.md),
[WP](docs/wp/WP-PRODUCTION-CLOSEOUT-20260917.md).

**Předchozí checkpoint specialistů ve Studiu, 2026-09-17:** dostupný seznam balíčků, potvrzená
aktivace a skutečný PDF/HEIC import v konverzaci. Integrovaný module graph má 1 358 hran,
