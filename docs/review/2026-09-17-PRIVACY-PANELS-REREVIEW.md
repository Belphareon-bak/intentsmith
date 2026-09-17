# Re-review R1–R3: soukromí a viditelnost panelů

Stav: **IMPLEMENTED / VALIDATION_IN_PROGRESS / REVIEW_REQUIRED**.
Původní nezávislé `CHANGES_REQUIRED` je zachované. Výchozí source `ba7c72d6`,
větev `work/privacy-panels-rereview-20260917`. Autorita je operátorovo předané
re-review, rozsah v [WP](../wp/WP-PRIVACY-PANELS-REREVIEW-20260917.md).
Oprava obecného časového kontextu zůstává součástí kandidáta.

## R1 — odmítnutý vstup v logu

`src/routes/chat.js` již nevypisuje preview těla před kontrolou soukromí.
Test `chat-privacy-http` spouští skutečný server s `C3_LOG_LEVEL=info`,
kontroluje pozitivní přítomnost INFO logování a posílá odlišné canary přes
kanonické M1 `/api/chat`, kompatibilní `/api/chat` i `/chat`. Všechny vrátí
409, bez nové konverzace, zprávy či canary v zachyceném stdout/stderr po
ukončení procesu. Původní zdroj selhal právě na kompatibilním preview;
negativní důkaz se nemaže.

## R2 — pracovní paměť projektu

`SessionState` uplatňuje současnou policy při získání živého stavu i obnově
uložené relace. Změna přepínače odstraní cache cíle/souboru/artefaktu před
dalším tahem; při vypnutí se nečte projektová `working_memory`. Obnova je
čisté čtení, již nepoužívá write-through settery. Zápis hodnot ověřuje
současnou DB policy a serializace při vypnutí neobsahuje pracovní paměť.

Nejde o skrytou výjimku pro uloženou provozní paměť: dřívější hodnoty se
nepoužijí. Výslovný nový cíl v živé relaci může sloužit jejímu řízení a
kontrole odchylek; při vypnutí se neobnoví po restartu a neukládá se do
projektové pracovní paměti. Přepnutí zpět na true dovolí opětovně načíst
dříve uložené hodnoty. Přepínač nemaže historii ani již uložená data.
Obsah dřívějších zpráv podléhá samostatnému nastavení historie, nikoli tomuto
přepínači; nepodporovaný režim bez historie stále blokuje nový chat.

Test používá skutečný `projectHandler`, privátní SQLite a všechny tři
hodnoty: kladné načtení při true, čerstvou/teplou/serializovanou relaci při
false, explicitní pomíjivý cíl, zachování drift kontroly, zákaz zápisu a
opětovné true. Celé projektové řádky zůstávají shodné. HTTP test navíc ověřuje
nastavení a projektovou odpověď přes skutečný procesový restart nad stejnou
DB. Nové programy se nepřidávají; rozšířeny jsou dva již registrované testy.

## R3 — boční panely

Převzat přesný commit `4fca7e67c0b853fb85fc6ea9ba702e5a9d00f815`
jako `da0c912047caa28b20b3f7520f527b4c2a19262f`, bez konfliktu.
Activity bar se dál skrývá, celý rodič navigace/chatu už nedostane nulové
maximum šířky. Profil ani nastavení se nemažou. Převzatý lifecycle test
pokrývá startovací šířky 0/32/240/420 px na obou stranách.

## Dosavadní ověření

- Privacy + související settings: **36/36 PASS**, včetně skutečného HTTP.
- Produkční Studio build a consumer/protocol/preload kontrola: **PASS**.
- Registr: **519**, nezměněný hash
  `04252cb29ea270886c049b01034c2bfec034a77d22ec4675decf593ae052ecb6`.
- Module boundary: **1 339 hran**, žádná přidaná/odebraná, 3 cykly / 28 členů.
- Úplný profil, fyzický integrovaný Electron a instalace: pending.

Lokální důkazy jsou v `.intentsmith-artifacts/privacy-panels-rereview-20260917/`.
`http-before.log` a `memory-before.log` jsou očekávané FAIL na původním
zdroji. Release seal je oddělená práce podle CONTRACT §8; nepřipíná se jen
kvůli zelenému výsledku vývojové větve. Tento packet nedává M5/M6 acceptance.
