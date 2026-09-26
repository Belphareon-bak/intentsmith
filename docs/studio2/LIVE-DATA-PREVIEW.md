# Studio 2 nad běžícími daty

Tento postup otevírá aktuálně sestavené Studio 2 proti již běžícímu backendu
IntentSmithu. Nový backend ani druhou databázi nespouští. Okno má vlastní
profil, ale konverzace, projekty, specialisty a expertýzy čte a mění přes
stejné API a databázi jako klasické Studio.

1. Zavři dřívější testovací AppImage (používá tentýž profil okna).
2. Pokud používáš nový AppImage, nastav jeho cestu a otevři ho bez sestavování
   zdroje:

   ```sh
   cd /home/belphareon/Projects/intentsmith-studio2-integration-20260925
   export INTENTSMITH_STUDIO2_APPIMAGE=/cesta/k/novemu/IntentSmith-0.1.0.AppImage
   ./scripts/studio2-live-data-preview.sh --check
   ./scripts/studio2-live-data-preview.sh
   ```

   Pro běh přímo ze zdroje místo AppImage sestav aktuální zdroj s Node 24:

   ```sh
   cd /home/belphareon/Projects/intentsmith-studio2-integration-20260925
   (cd intentsmith-ide && PATH="/tmp/is-studio2-node24/node_modules/node/bin:$PATH" corepack yarn build)
   ```

   Pak ověř a spusť:

   ```sh
   ./scripts/studio2-live-data-preview.sh --check
   ./scripts/studio2-live-data-preview.sh
   ```

Pokud je Node 24 jinde, nastav `INTENTSMITH_NODE24_BIN` na jeho spustitelný
soubor. Pokud má nasazený backend jinou soukromou portovou cestu, nastav
`INTENTSMITH_LIVE_PORT_FILE`. Skript žádný token nevypisuje a odmítne
nedostupný backend. Volba Studio 2 a místní rozložení zůstávají ve zkušebním
profilu; uložené konverzace se otevřou z katalogu Konverzace.

**Rozsah kompatibility:** nasazený backend `72247a49` měl 2026-09-26 při
ověření 35 aktivních konverzací, 6 aktivních projektů, 5 specialistů a
18 expertýz; příslušné GET endpointy vracely 200. Jeho `/api/scm/*` vracelo
404. Správa zdrojů a nové projektové souborové operace proto potřebují
ověřený přechod backendu na tuto větev. Do té doby je toto živý náhled
dosavadních dat a kompatibilních funkcí, nikoli plná parita Studia 2.

Zkušební okno má přístup k produkčním datům. Akce jako zpráva, uložení souboru
nebo změna nastavení se projeví i v klasickém Studiu. Skript nesahá na
systemd službu, databázi přímo, GPU ani Ollamu. Před přechodem backendu se
samostatně ověří migrace na konzistentní kopii živé SQLite databáze a možnost
návratu.
