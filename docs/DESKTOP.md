# IntentSmith na tomto počítači

Desktopová instalace nabízí aplikaci **IntentSmith** v nabídce aplikací.
Ikona spustí backendovou uživatelskou službu nebo se k ní připojí. Opětovné
spuštění nevytváří další backend. Zavření Studia backend ani hunt nezastavuje;
služby lze zastavit explicitně. Chyba spuštění Studia se ukáže v dialogu.
Instalátor zapisuje launcher jako spustitelný soubor a obnoví jak obecnou
desktopovou databázi, tak KDE cache; po aktualizaci proto není nutné se
odhlašovat ani cache obnovovat ručně.

Na Kubuntu/Ubuntu s `kernel.apparmor_restrict_unprivileged_userns=1` může
Chromium skončit ještě před otevřením okna, pokud instalace nemá použitelný
setuid helper ani AppArmor profil. Launcher tento konkrétní stav ověří před
spuštěním. Ukáže postup instalace vygenerovaného profilu
`~/.config/intentsmith/intentsmith.apparmor`, nebo po výslovném potvrzení
uloží soukromý marker `~/.config/intentsmith/allow-no-sandbox` a přidá
`--no-sandbox`. Druhá varianta ubírá jednu vrstvu izolace Chromia; bez souhlasu
se nezapne. Marker lze smazat a vrátit se k sandboxovanému startu. Pro jediný
diagnostický start lze použít `INTENTSMITH_NO_SANDBOX=1`.

Trvalá AppArmor oprava pro právě instalovanou revizi:

```bash
sudo install -m 644 ~/.config/intentsmith/intentsmith.apparmor /etc/apparmor.d/intentsmith
sudo apparmor_parser -r /etc/apparmor.d/intentsmith
rm -f ~/.config/intentsmith/allow-no-sandbox
```

Profil obsahuje přesnou cestu k Electronu dané instalované revize. Po instalaci
nové revize se proto musí znovu nainstalovat i nově vygenerovaný profil.

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

## Paměť a agentí ovládání

V **Nastavení → Memory** přepínače řídí automatickou paměť a učení.
Konverzační historie se ukládá lokálně; režim bez historie zatím není
podporovaný. Pokud jej starší verze uložila jako vypnutý, nový chat zůstane
zablokovaný, dokud uživatel výslovně nepovolí ukládání. Vypnutí automatického
učení nemaže dříve uložené záznamy.

V **Workeri** lze native agenta spustit, pozastavit či povolit. Pozastavení
zastaví další plánování, nikoli právě běžící úlohu. Neúspěšný, přeskočený
nebo částečný běh se nehlásí jako úspěch. Starší legacy záznamy jsou pouze
ke čtení. [Rozsah opravy a ověření](review/2026-09-17-PRIVACY-AGENT-REMEDIATION.md).

## Sandbox projektových testů (Ubuntu/Kubuntu)

Úspěšný test z terminálu IDE nemusí prokázat funkčnost systémové služby.
Dne 18. 9. 2026 tatáž M2 zkouška prošla pod `vscode (unconfined)`, ale pod
uživatelskou službou (`unconfined`) skončila `bwrap: loopback: Failed
RTM_NEWADDR: Operation not permitted`. Produkční změna byla vrácena;
není to úspěšný projektový test. Omezení user namespaces zůstává zapnuté.

Připravený [profil bubblewrap](../systemd/intentsmith-bwrap.apparmor) povoluje
user namespaces pro rootem vlastněný `/usr/bin/bwrap`, podle
[mechanismu Ubuntu](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).
M2 dále vynucuje oddělenou síť, zákaz dalších user namespaces, odebrání
capabilities, soubory pouze ke čtení a limity zdrojů. Profil není náhradou
za tyto hranice. Nenahrávejte duplicitní profil, pokud správce již pro bwrap
spravuje jiný profil. Na kontrolovaném počítači takový soubor nalezen nebyl.

Instalátor připravuje soubor v `~/.config/intentsmith/intentsmith-bwrap.apparmor`.
Nahrání vyžaduje práva správce; samotná aplikace je nezískává:

```bash
sudo install -m 644 ~/.config/intentsmith/intentsmith-bwrap.apparmor /etc/apparmor.d/intentsmith-bwrap
sudo apparmor_parser -r /etc/apparmor.d/intentsmith-bwrap
```

Potom z kořene aktuálního zdrojového checkoutu spusťte skutečnou zkoušku v
kontextu uživatelské služby (ne pouze `node` v IDE):

```bash
systemd-run --user --wait --pipe --collect \
  "$(command -v node)" "$PWD/scripts/check-project-sandbox.mjs"
```

Výstup musí být `PASS`, exit 0. Zkouška používá skutečný M2 process provider,
limity, Node HTTP parser i WebAssembly, pouze dočasný vlastní adresář; nedotýká
se projektů, databáze ani GPU. Poté je nutný nový přesný plán a úspěšné provedení
ve Studiu. Starý neúspěšný plán se nesmí zpětně vydávat za úspěšný.
Profil byl parsován bez nahrání do kernelu; na kontrolovaném hostu dosud není
aktivovaný, protože `sudo -n` požaduje heslo správce.
