# IDE 2.0 — výchozí desktop a Legacy

Autorita: operátor 28. 9. 2026 a
[WP-STUDIO-2-PRODUCTION](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).

Nasazeno 28. 9. 2026: backend `c84b88cd`, frontend `32361710`, ověřený AppImage,
původní DB a zachované vazby modelů. **LOCAL_PRODUCTION_DEPLOYED /
IMPLEMENTATION_VERIFIED / REVIEW_PENDING**. Přesné součty, živé zkoušky,
backupy a omezení jsou v [reportu](../review/2026-09-28-STUDIO2-PRODUCTION.md).
Start s původním profilem a přílohami, vlastní rám a soukromou evidenci
řeší [následná oprava](../review/2026-09-28-STUDIO2-STARTUP-FIX.md).

Aktuální relace 1–5, barevné kategorie a časy, původní datové konektory
a ověřený frontend bez výměny backendu popisuje
[předchozí report](../review/2026-09-28-STUDIO2-RECENCY-CATEGORIES.md).

Neutrální konverzační ikony, skutečné projektové časy, upravenou navigaci
a dřívější plné symboly nastavení ve frontendu `32361710` popisuje
[následné ověření a náhledy před/po](../review/2026-09-28-STUDIO2-PALETTE-PROJECT-DATES.md).
Finální AppImage, tři Electron scénáře a 11 motivů PASS; celý integračně
shodný profil na `b5fda0f1` má 385 PASS / 1 zděděný FAIL Gate 0.

**Aktuálně instalovaný frontend `fddfe996`, 29. 9. 2026:** nastavení má
operátorem vybranou tlumenou paletu B, stejné obrysové symboly a podklady
s o 20 % sytější kresbou. AppImage, 11 motivů, reálný Electron a běžný
start PASS. Backend `c84b88cd`, původní DB a Legacy zachovány.
[Aktuální náhledy, identita a testy](../review/2026-09-29-STUDIO2-SETTINGS-PALETTE-B.md).

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
- Z terminálu: `gtk-launch intentsmith`, případně `gtk-launch intentsmith-legacy`.
  Dříve otevřená stará okna zavřete; zkušební archiv `b0603b24` se nepřepisoval.
- Nové UI používá `~/.config/intentsmith-studio2`. Při prvním přechodu se do
  něj přenesou původní místní preference, relace a IndexedDB. Původní profil
  zůstává pro Legacy. Zámky procesů ani síťové cache se nekopírují.
- Zavření obou UI nezastaví backend spravovaný uživatelskou službou.
- Obyčejné spuštění neotevírá diagnostický CDP listener. Explicitní
  `INTENTSMITH_STUDIO_INSPECT=1` slouží k místnímu ověření aplikace.

Existující politika Chromium sandboxu platí pro obě varianty. Instalace
nepřidává shellová oprávnění, nemění vazby modelů ani nezapíná držený hunt.
Původní backendový snapshot se uchovává pro návrat. Přesné SHA, backup a
výsledky živých kontrol jsou v reportu nasazení; L1, místní nasazení a
nezávislé přijetí zůstávají odlišné výsledky.
