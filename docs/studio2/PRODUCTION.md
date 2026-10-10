# IDE 2.0 — výchozí desktop a Legacy

Autorita: operátor 28. 9. 2026 a
[WP-STUDIO-2-PRODUCTION](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).

## Chronologie místní instalace

Každý report dokládá vlastní zdroj a tehdy instalovaný AppImage; jeho zkoušky
nejsou automaticky výsledkem pozdějšího frontendu.

| Datum a krok | Frontend | Důkaz |
|---|---|---|
| 28. 9. — původní nasazení IDE 2.0 a Legacy | `c84b88cd` | [Produkční report](../review/2026-09-28-STUDIO2-PRODUCTION.md): backend i frontend `c84b88cd`, AppImage, chat, M2 a SCM nad kopií DB; celý offline/database profil 385 PASS / 1 FAIL Gate 0. |
| 28. 9. — oprava startu se starým profilem a přílohami | `16318bf8` | [Report opravy startu](../review/2026-09-28-STUDIO2-STARTUP-FIX.md): vlastní rám a použitelné okno bez dialogu Restart, přílohy zachovány; celý profil 385 PASS / 1 FAIL Gate 0. |
| 28. 9. — poslední relace 1–5, kategorie a časy | `79c19096` | [Report relací a kategorií](../review/2026-09-28-STUDIO2-RECENCY-CATEGORIES.md): původní datové konektory a AppImage; celý profil 385 PASS / 1 FAIL Gate 0. |
| 28. 9. — neutrální konverzace a projektové časy | `32361710` | [Report vzhledu a časů](../review/2026-09-28-STUDIO2-PALETTE-PROJECT-DATES.md): AppImage, tři Electron scénáře a 11 motivů PASS; celý profil 385 PASS / 1 FAIL Gate 0 běžel na předchozím integračně shodném `b5fda0f1`. |
| 29. 9. — operátorem vybraná paleta nastavení B + 20 % | `fddfe996` | [Report palety B](../review/2026-09-29-STUDIO2-SETTINGS-PALETTE-B.md): AppImage, reálný Electron, běžný start a 11 motivů PASS; nový celý profil na `fddfe996` report nedokládá. |
| 10. 10. — dílčí V4 a společná aktualizace backendu | `37ee6177` | [Historický report](../review/ide-preview-completion-20261010.md): původní DB/profil/Legacy/hold, obnova uložených rolí a běžný start PASS; následný Opus verdict je místní technická přijatelnost, bod f) nesplněný. |
| 10. 10. — kompozice doladěného V4, katalog a plánování v původním Studiu 2 | `3c804a8a` | [Aktuální report](../review/settings-v4-completion-20261010.md): 416/416 offline/database, 3/3 HTTP, 53 nativních snímků s readbackem/restartem, CI 19/19 a běžný hlavní launcher PASS. Nová nezávislá revize pending. |

Poslední doložená instalace z 10. 10. používá frontend i backend `3c804a8a`,
původní DB a profil IDE; cíl Legacy je zachovaný. **LOCAL_PRIMARY_DEPLOYED /
NORMAL_LAUNCH_VERIFIED / REVIEW_PENDING**. Nezávislé přijetí a Gate 0 PASS
z těchto místních zkoušek neplynou.

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
nepřidává shellová oprávnění ani nezapíná držený hunt. Instalátor nepřepisuje
modelové vazby v DB; nový backend je při startu obnovuje. Dne 10. 10.
operátor výslovně povolil obnovit uloženou sestavu, která se ve čtyřech rolích
lišila od RAM starého backendu. Skutečné vazby jsou v aktuálním reportu.
Původní backendový snapshot se uchovává pro návrat. Přesné SHA, backup a
výsledky živých kontrol jsou v reportu nasazení; L1, místní nasazení a
nezávislé přijetí zůstávají odlišné výsledky.

## Doplnění preview z 10. 10. 2026

Další samostatný spouštěč kandidáta byl na pokyn operátora odstraněn.
Dokončení se provádí v existujícím IDE 2.0; Legacy a provozní data zůstávají
zachována. [Aktuální práce, ověření a meze](../review/settings-v4-completion-20261010.md)
rozlišují zdroj, skutečný AppImage, místní instalaci a formální přejímku.

Aktualizace z 10. 10. má ověřený AppImage `3c804a8a`, 53 nativních snímků,
416/416 offline/database a 3/3 HTTP programy na přesném SHA. **Je lokálně
nasazená** ve stávající hlavní instalaci; nabídka `intentsmith.desktop` i
backend nyní používají `3c804a8a`. Běžné spuštění s původním profilem a motivem
prošlo a má vlastní
[receipt a snímky](../review/evidence/settings-v4-completion-20261010/primary-installation.json).
Jedna položka IDE 2.0 a samostatný Legacy zůstávají. Nasazení neuděluje
formální přejímku; nový nezávislý verdikt, GPU, doručení a release důkazy
stále potřebují vlastní ověření.
