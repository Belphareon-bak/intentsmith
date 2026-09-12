# Sázkař — CLI, průběžný sběr a upozornění

Autorita: explicitní požadavek operátora na aliasy/CLI, výzkum načasování
kurzů a samostatná upozornění. Vstup čistý `a054b753`, vlastní worktree
`is-specialists-engines-20260911`, větev `codex/specialists-engines-20260911`.
**IMPLEMENTED_SLICE / REVIEW_PENDING; MAIL_CONFIGURATION_REQUIRED.**
Nejde o nezávislé přijetí ani důkaz predikční výhody.

## Uživatelská cesta

Nainstalován `~/.local/bin/sazkar`; nové vlastní aliasy v `~/.bash_aliases`:
`sk`, `sk24`, `sk72`, `skstav`, `skhlidej`, `skstop`, `skposledni`.
Cizí `.bashrc` nebyl upraven. Launcher volá konkrétní Node a tuto větev.
Ověřeno spuštění aliasu v čistém Bash bez čtení cizích startup skriptů.
Interaktivní PTY menu bylo spuštěno a volba 5 skutečně zobrazila stav.

Příkaz `sazkar hledej --profil 72h` z `/home/belphareon/Projects` skončil READY,
tři tikety; výstup
`/home/belphareon/.local/state/sazkar/results/2026-09-12T10-06-02.026Z-cb885926/`.
Zkontrolována historie. Jde o datovaný snímek, nikoli trvale platné ceny.
Nová provozní evidence je v `~/.local/state/sazkar/analysis.sqlite`.
Původní výzkumná DB nebyla přesunuta nebo smazána.

`sazkar hlidat jednou` načetl 44 utkání / 132 jednotlivých výběrů, založil
první baseline bez jediného falešného opening upozornění. Skutečný druhý běh
spustila user systemd služba sama: 12:10:24–12:10:34 Europe/Prague,
`Result=success`, `ExecMainStatus=0`; databáze poté měla 264 pozorování.
Příkazy stop → stav → start potvrdily vypnutí konfigurace i timeru a obnovení.
Timer zůstává zapnutý s intervalem 15 minut. Žádná jiná služba se neměnila.

E-mail nemá příjemce, účet ani heslo. `sazkar mail test` korektně skončil
chybou „E-mail není nastavený“ bez odeslání. Interaktivní `mail nastav`
umožňuje lokální nastavení se skrytým zadáním hesla; skutečný SMTP transport
a doručení do schránky zůstávají **NOT VERIFIED**. Nastavení je oddělené
od stávajících C3 SMTP proměnných, které se automaticky nepřebírají.

## Logika a výzkum

Čistý modul rozlišuje nově pozorovanou nabídku a doložené zlepšení ceny.
Nefalšuje openingAt ani +EV. Potlačuje první snímek, výpadky, vstup do
posunutého okna, změnu termínu, nečerstvé/suspendované ceny a opakování tipů.
Core přidává časovou historii, lease, transakční frontu, denní limit a
nejisté doručení bez automatického opakování. Vazba doručení obsahuje
aktuální SMTP, příjemce i preference; jejich změna starý signál neuvolní.

[Výzkumný dokument](../research/SAZKAR-MARKET-TIMING.md) vychází z primárních
zdrojů a vlastního párového měření 7 228 zápasů. Log loss dřívějších/závěrečných
Bet365 cen 0,96972/0,96755; dřívější cena vyšší v 41,73 %, závěrečná v 38,96 %.
První CSV odečet není skutečný opening. Žádný nový model nebyl aktivován na
základě těchto deskriptivních statistik. Sestavy, zranění a xG se tímto WP
nepřidávají do predikce; plán zdrojů a ověření je konkrétně rozepsaný ve výzkumu.

Reprodukce: `scripts/research-betting-timing.py`, raw výsledek
`.intentsmith-artifacts/betting-watch-20260912/timing.json`, SHA-256 a časy
každého skutečně použitého zdroje uvnitř. Bez síťových a GPU efektů experimentu.

## Kontroly

- Engine: **17/17 PASS**, `engine.log`.
- Integrace: **19/19 PASS**, `integration-verified.log`; skutečný handler
  dosavadního enginu, public host, restart, historická identita, cenový pohyb,
  TLS, jediný příjemce, zákaz příloh/URL, expirace, claim, nejisté odeslání,
  denní limit a změna preferencí. SMTP testy mají řízený transport, neposílají
  skutečné e-maily.
- Přímé CLI/PTY/aliasy a skutečný user timer byly spuštěné; stav je výše.
- Dva neúspěšné vývojové integrační běhy jsou zachované. Generátor cenového
  pohybu nejprve vytvořil nepovolený dlouhý desetinný string, poté podmaržový
  trh mimo deklarovaný filtr. Upraven pouze syntetický pohyb na zaokrouhlených
  +6 %, stále nad nezměněným 5% limitem. Produktový filtr se neoslaboval.

Logy jsou pod `.intentsmith-artifacts/betting-watch-20260912/`.
Registry má stále 514 programů a nezměněný normalizovaný fingerprint
`2322ef86b7eabbf1b3a2b0bd513d2fba08d19320fd8290a47798e79823117993`.
Celý deterministický profil tohoto kandidátu ještě čeká na čistou revizi.
Dosavadní 343 PASS / 3 FAIL / 8 BLOCKED se nepovažují za green.

Jediný nový core import `src/betting/watch-mail.js -> src/network/outbound-audit-repository.js`
zapojuje přesný existující M5 audit writer pro explicitně konfigurovaný SMTP
efekt. Zaznamenán autoritativním nástrojem nad čistým `847e2009` s jediným
přesným `--accept-edge`, v samostatném baseline commitu; graf měří 1317 hran,
3 cykly / 28 členů, žádná odebraná hrana. Nové přímé efekty z balíčku specialisty
nevznikly. Žádný push, merge, aktivace sdílené aplikace nebo podání sázky.
