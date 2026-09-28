# IDE 2.0 — výchozí desktop a Legacy

Autorita: operátor 28. 9. 2026 a
[WP-STUDIO-2-PRODUCTION](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).

## Instalace

Použije se čistý oddělený instalovaný snapshot, sestavený AppImage a trvalý
Node 24. Stávající `scripts/install-desktop.mjs` přijímá navíc
`--appimage=/absolutní/cesta` a `--appimage-sha256=<ověřený součet>`.
Bez `--apply` pouze ověří jednotky a připraví plán. Aplikace musí mít součet
shodný s předaným artefaktem; spouštěč ho kontroluje také při otevření.

Instalátor zachová původní DB a přístupové prostředí. Před migrací udělá
konzistentní backup a ověřenou migrační kopii. Backend se mění pouze po
úmyslném zastavení, s neaktivním huntem a evaluací. Při selhání následného
startu obnoví předchozí konfiguraci a službu; nová data nepřepisuje starším DB
backupem. Hold a stav plánování GPU se zachovají.

## Každodenní použití

- **IntentSmith IDE 2.0** je výchozí položka `intentsmith.desktop`.
- **IntentSmith Legacy** je samostatná položka `intentsmith-legacy.desktop`.
  Spouští původní uložený frontend proti témuž spravovanému backendu a DB.
- Nové UI používá `~/.config/intentsmith-studio2`. Při prvním přechodu se do
  něj přenesou původní místní preference, relace a IndexedDB. Původní profil
  zůstává pro Legacy. Zámky procesů ani síťové cache se nekopírují.
- Zavření obou UI nezastaví backend spravovaný uživatelskou službou.
- Obyčejné spuštění neotevírá diagnostický CDP listener. Explicitní
  `INTENTSMITH_STUDIO_INSPECT=1` slouží k místnímu ověření aplikace.

Existující politika Chromium sandboxu platí pro obě varianty. Instalace
nepřidává shellová oprávnění, nemění vazby modelů ani nezapíná držený hunt.
Původní backendový snapshot se uchová pro návrat. Přesné SHA, backup a
výsledky živých kontrol budou v reportu nasazení; L1, místní nasazení a
nezávislé přijetí zůstávají odlišné výsledky.
