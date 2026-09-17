# IntentSmith na tomto počítači

Desktopová instalace nabízí aplikaci **IntentSmith** v nabídce aplikací.
Ikona spustí backendovou uživatelskou službu nebo se k ní připojí. Opětovné
spuštění nevytváří další backend. Zavření Studia backend ani hunt nezastavuje;
služby lze zastavit explicitně. Chyba spuštění Studia se ukáže v dialogu.

Ve Studiu otevři **Modely → GPU hunt**. Záložka ukáže stav služby, další termín,
důvod přeskočení či chybu, poslední výsledky a čas poslední známé fronty.
Tlačítka spustí nejvýše dva kandidáty, zastaví běh nebo pozastaví/obnoví
plánovač. Každá změna má potvrzení. Zastavení ponechá uloženou historii;
rozpracovaný pokus se neoznačuje za úspěch. Pozastavení plánovače nechá
probíhající měření dokončit. Mobilní principal tuto lokální kontrolu nezíská.

Noční čas je 03:00 s rozptylem; timer používá `Persistent=true`. Zmeškaný
termín může dohnat po přihlášení. Obsazená GPU, nedostatek RAM/disku nebo
jiná evaluace běh bezpečně přeskočí. Přeskočení není dokončené měření.
Výběr lepšího modelu není jeho automatická aktivace.

Instalace a skutečně sdílená DB jsou zapsané v
`~/.config/intentsmith/installation.json`. Backend a hunt používají stejný
`runtime.env`; adaptér odmítne ovládání při rozdílu zdroje nebo DB. Backend je
spuštěný s `NODE_ENV=production`. Instalátor vytvoří soukromý `admin.env`
s náhodným administrátorským údajem (práva 0600), další instalace jej zachová.
Studio používá vlastní privátní lokální capability z port file. Připravenost
vyžaduje úspěch s capability i odmítnutí požadavku bez ní. Zdroj je
samostatný čistý detached checkout konkrétní revize, nezávislý na pracovních
větvích. Data zůstávají na explicitně vybrané původní cestě, nekopírují se
potichu do nové prázdné DB. Starší CODE skóre z jiného kontraktu není baseline.

Instalátor `node scripts/install-desktop.mjs --db=/absolutní/cesta/c3.db`
v připraveném checkoutu nejprve vypíše konfiguraci. Přepínač `--apply` vytvoří
konzistentní SQLite backup, prověří migrace na jeho kopii a uloží původní
konfiguraci pod `~/.local/state/intentsmith/installation-backups/`.
Pak registruje služby a ikonu a ověří autentizovaný backend. Aktivní cizí
hunt ani jinou aktivní instalaci nepřeruší. Opakování stejné aktivní instalace
ji pouze ověří. Při chybě po zastavení timeru nejprve oprav konfiguraci a
ověř backend; automatický hunt se zapíná až po úspěšném ověření.

Diagnostika služby: `journalctl --user -u intentsmith-backend.service -n 50`.
Pro lokální automatizované ověření okna lze launcher spustit s
`INTENTSMITH_STUDIO_INSPECT=1`: pouze tento explicitní režim otevře Chromium
debugger na náhodném loopback portu. Běžná ikona debugger nezapíná.
Úplné vypnutí: `systemctl --user stop intentsmith-model-hunt.timer
intentsmith-model-hunt.service intentsmith-backend.service` (jeden příkaz).
Soubory DB, uložená měření a backupy se tím nemažou.

Rozlišitelnost: poslední panel z 2026-09-12 má 38 rozhodnutí, z nich 13
neprůkazných. U 7 rozdíl překrývá variabilita, u 6 je pozorovaný rozdíl malý.
`node scripts/analyze-hunt-panel.mjs /cesta/panel.json` vytváří opakovatelný
rozbor s hashem vstupu. Diagnostika neoslabuje prahy a nepřepisuje skóre;
změna úloh/opakování vyžaduje nový kontrakt a doměření incumbentů.
