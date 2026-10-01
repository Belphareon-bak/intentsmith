# Studio 2 nad běžícími daty

Tento postup otevírá **nainstalovaný frontend** proti již běžícímu backendu
IntentSmithu. Nový backend ani druhou databázi nespouští. Okno má vlastní
profil, ale konverzace, projekty, specialisty a expertýzy čte a mění přes
stejné API a databázi jako klasické Studio.

**Snímek instalace 1. 10. 2026:** backend a čistý zdrojový snapshot jsou
`c84b88cd0c0b76639823c82c022d2feab96dfc15`; nainstalovaný AppImage
je z `fddfe9966e7cea648bff3bb4d2bdcfdd0900f3d2` se SHA-256
`705ea03a353af6549e8ff483599875b577782fe0469df322f7f178862693d006`.
Stav je `LOCAL_PRODUCTION_DEPLOYED / IMPLEMENTATION_VERIFIED /
REVIEW_PENDING`, viz [chronologie instalace](PRODUCTION.md). Novější
vývojový checkout v `/home/belphareon/Projects/intentsmith-real-chat-journeys-20260930`
není tímto nainstalovaným backendem ani AppImage; tento náhled neověřuje jeho
funkce.

1. Zavři dřívější testovací okno se stejným profilem.
2. Pro ověření nainstalované dvojice použij její připnutý snapshot a AppImage:

   ```sh
   cd /mnt/vi7000/intentsmith/releases/c84b88cd0c0b76639823c82c022d2feab96dfc15
   export INTENTSMITH_STUDIO2_APPIMAGE=/mnt/vi7000/intentsmith/releases/studio2-frontend-fddfe9966e7cea648bff3bb4d2bdcfdd0900f3d2/IntentSmith-Studio2.AppImage
   ./scripts/studio2-live-data-preview.sh --check
   ```

   `--check` ověřuje dostupnost aplikace a soukromého portu backendu; není
   zkouškou chatu, SCM ani slučitelnosti nového vývojového zdroje. Chceš-li
   pak otevřít vlastní živé okno, spusť:

   ```sh
   ./scripts/studio2-live-data-preview.sh
   ```

Pokud má nasazený backend jinou soukromou portovou cestu, nastav
`INTENTSMITH_LIVE_PORT_FILE`. Skript žádný token nevypisuje a odmítne
nedostupný backend. Volba Studio 2 a místní rozložení zůstávají ve zkušebním
profilu; uložené konverzace se otevřou z katalogu Konverzace.

**Historický snímek 26. 9.:** tehdy nasazený backend `72247a49` měl při
ověření 35 aktivních konverzací, 6 aktivních projektů, 5 specialistů a
18 expertýz; příslušné GET endpointy vracely 200 a `/api/scm/*` vracelo
404. To nepopisuje dnes nainstalovaný backend `c84b88cd`. Jeho SCM bylo
28. 9. ve skutečném AppImage nad kopií DB ověřeno pro stage, commit, větev
a odmítnutí nepovoleného push, viz [produkční report](../review/2026-09-28-STUDIO2-PRODUCTION.md).
Novější frontend `fddfe996` má vlastní cílené Electron a AppImage zkoušky,
nikoli opakovanou úplnou SCM přejímku. Výsledek zůstává `REVIEW_PENDING`.

Zkušební živé okno má přístup k produkčním datům. Akce jako zpráva, uložení
souboru nebo změna nastavení se projeví i v klasickém Studiu. Skript nemění
systemd službu ani přímo nespravuje DB, GPU nebo Ollamu; uživatelské akce v
okně ale mohou vyvolat backendové efekty.

Pro zkoušky nového backendu použij soukromý balík a `run-with-data.sh`:
vytvoří konzistentní kopii SQLite do zkušebního profilu. **Záznamy projektů
v kopii však stále obsahují původní absolutní cesty.** M2 schválení, zápis
souboru nebo SCM operace nad importovaným projektem mohou změnit skutečný
projekt. Efektové testy proto prováděj jen na nově založených izolovaných
projektech ve zkušebním adresáři; importované projekty při těchto zkouškách
pouze čti. Pro úplně prázdné izolované prostředí použij `run-trial.sh`.
Migrace a zachování historie se ověřují samostatně na koherentní kopii DB;
závěr o nové verzi vyžaduje její vlastní build, Electron testy a živou
přejímku podle [produkčního WP](../wp/WP-STUDIO-2-PRODUCTION-20260928.md).
