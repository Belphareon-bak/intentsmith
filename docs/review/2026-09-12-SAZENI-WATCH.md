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

Následný skutečný alias `sk24` na čistém `60030f10`, opět z běžného adresáře,
načetl 25 utkání a vrátil tři návrhy READY. Výstup z 12:25:32 Europe/Prague:
`/home/belphareon/.local/state/sazkar/results/2026-09-12T10-25-32.052Z-07b72367/`.
Všech 38 zdrojových hashů (13 Fortuna, 25 historická CSV) odpovídá uchovaným
bytes; každá vybraná cena souhlasí s původní odpovědí Fortuny. Množina zdrojů
souhlasí s hostem doplněným kontextem invokace. SQLite record
`5977b1e2-3a2a-4bc1-8e9c-6b70b534f487`; `alias-live-24h.log` a
`alias-live-evidence.json`. Nejde o trvale platnou nabídku.

`sazkar hlidat jednou` načetl 44 utkání / 132 jednotlivých výběrů, založil
první baseline bez jediného falešného opening upozornění. Skutečný druhý běh
spustila user systemd služba sama: 12:10:24–12:10:34 Europe/Prague,
`Result=success`, `ExecMainStatus=0`; databáze poté měla 264 pozorování.
Příkazy stop → stav → start potvrdily vypnutí konfigurace i timeru a obnovení.
Timer zůstává zapnutý s intervalem 15 minut. Žádná jiná služba se neměnila.
Po restartu timer samostatně provedl třetí úspěšný sběr ve 12:19:19,
opět 132 výběrů / 0 signálů; celkem 396 cenových pozorování.
Závěrečná kontrola ve 12:34 potvrdila další automatický sběr ve 12:34:31,
528 uložených cen, 0 signálů; timer `active / enabled`, služba
`Result=success / ExecMainStatus=0`. E-mail zůstává nenastavený.

E-mail nemá příjemce, účet ani heslo. `sazkar mail test` korektně skončil
chybou „E-mail není nastavený“ bez odeslání. Interaktivní `mail nastav`
umožňuje lokální nastavení se skrytým zadáním hesla; skutečný SMTP transport
a doručení do schránky zůstávají **NOT VERIFIED**. Nastavení je oddělené
od stávajících C3 SMTP proměnných, které se automaticky nepřebírají.
Samotný průvodce `mail nastav` byl navíc ověřen přes skutečný PTY v odděleném
adresáři se syntetickými údaji: heslo se neobjevilo ve výstupu, oba soubory
mají práva 600, příjemce odpovídá zadání. `mail-setup-pty.log`; žádný síťový
přenos ani změna skutečné provozní mail konfigurace při tomto testu.

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
Celý deterministický profil na čistém `60030f10`, run
`2026-09-12T10-25-08-204Z`: **342 PASS / 3 FAIL / 1 TIMEOUT / 8 BLOCKED**,
0 SKIPPED, exit 1. Sázkař 17 + 19 případů PASS i uvnitř tohoto profilu,
module-boundary-ratchet 13/13 PASS. Zdroj zůstal během běhu čistý.
`profile-comparison.json` porovnává všech 354 programů s předchozím runem
`2026-09-12T09-11-34-677Z`; registry otisk zůstal totožný.

Jediný změněný programový stav je `tests/m2-effect-broker-v1.test.js`:
PASS → TIMEOUT po 30 030 ms. Kód této sady, `src/effects`, migrace,
kontrakty M2 i harness jsou proti vstupu tohoto WP beze změny.
Samostatné opakování přes tentýž registry runner a nezměněný limit 30 s,
run `2026-09-12T10-32-50-074Z`, skončilo **56/56 PASS za 27 761 ms**, exit 0.
Příčina časového kolísání není prokázaná. Tento dílčí PASS nepřepisuje
TIMEOUT ani celkový FAIL původního běhu; log `m2-timeout-recheck.log`.

Ostatní non-PASS se nezměnily:

| Program | Stav | Doložený důvod |
|---|---|---|
| `artifact-validation.test.js` | FAIL | 157/158; rezervační seznam stále postrádá existující migraci 112 |
| `mobile-browser-a11y.test.js` | FAIL | interně BLOCKED: chybí Chromium na cestě požadované touto sadou |
| `nightly-orchestrator-self-test.js` | FAIL | registry hash není přijatým otiskem reviewed Gate 0 policy |
| `chat-export-budget.test.js`, `export-pdf-docx.test.js` | BLOCKED | `toolchain:python-pdf-runtime` |
| `m2-execution-git-preservation.test.js`, `workspace-budget.test.js` | BLOCKED | `toolchain:git` |
| `m2-execution-process-supervision.test.js` | BLOCKED | `toolchain:bwrap` |
| `m2-execution-project-change.test.js`, `m2-lifecycle-application-service.test.js` | BLOCKED | `toolchain:bwrap`, `toolchain:git` |
| `m5-process-hardening.test.js` | BLOCKED | `toolchain:bubblewrap`, `toolchain:prlimit` |

Toolchain řádky označují nedoložené prerekvizity registry runneru, nikoli
tvrzení, že na hostu obecně neexistuje Git. Existující policy, migrace,
limity a blokace se kvůli sázkaři neměnily. Následné doplnění těchto reportů
je pouze dokumentační; nezávislé review zůstává neprovedené.
Kontrola artefaktů po doplnění reportu má znovu přesně 157 PASS / 1 FAIL
(tatáž rezerva migrace 112); census souborů/řádků a soupis hran prošly.
`artifact-closeout.log`; závěrečný `git diff --check` PASS.

Jediný nový core import `src/betting/watch-mail.js -> src/network/outbound-audit-repository.js`
zapojuje přesný existující M5 audit writer pro explicitně konfigurovaný SMTP
efekt. Zaznamenán autoritativním nástrojem nad čistým `847e2009` s jediným
přesným `--accept-edge`, v samostatném baseline commitu; graf měří 1317 hran,
3 cykly / 28 členů, žádná odebraná hrana. Nové přímé efekty z balíčku specialisty
nevznikly. Žádný push, merge, aktivace sdílené aplikace nebo podání sázky.

## Navazující změna: top 5–10 bez minimální úspěšnosti

Autorita je navazující explicitní pokyn operátora, vstup `e5e8e537`.
Autonomní hledání má výchozí `minProbability=0`, `ticketCount=5`, řadí podle
pravděpodobnosti a připouští sdílené zápasy mezi alternativami. `--top 10`
vyžádá deset výsledků; neplatné počty se odmítnou před stažením dat.
72h předvolba i aliasy používají stejné chování. Report má přehled pořadí
a sdílené zápasy označí. Uvnitř tiketu, v časových/kurzových limitech,
v modelu a v limitech hledání se nic nezměnilo; hlídač/mail nejsou upravené.

Skutečné 24h CLI / kurz 2–4 vrátilo pět i deset návrhů READY s dokončeným
hledáním a sestupným pořadím. Kontrola serializovaných výstupů ověřila počet,
nulový práh i všechny časové/kurzové podmínky. Evidence:
`.intentsmith-artifacts/betting-ranking-20260912/live-evidence.json`,
record IDs `17bdad03-0ca1-4154-b221-868c0e2f6d5e` a
`be7c804e-319e-41e5-a308-ebd183f53a82` v provozní DB.
Jde o datované ceny z 12:42–12:43 Europe/Prague, ne trvale platné nabídky.

Na čistém `465c2345` prošel také skutečný alias `sk72 --top 10`: deset
návrhů READY, úplně prohledáno 3 502 uzlů, nulový práh, 2–3 položky,
kurz 2–4 a rozestup nejvýše 12 h ověřeny v serializovaném výsledku.
Record `e7aeb4a9-c38c-436c-af63-bd0dac716b63`, výstup
`~/.local/state/sazkar/results/2026-09-12T10-45-09.683Z-e5c66879/`;
`alias72-evidence.json` a `alias72-top10.log`.

Engine 17/17, integrace 19/19 a registry 514 programů PASS. Tři neplatné
hodnoty `--top` odmítnuty před sběrem. První artifact kontrola odhalila
chybějící čárku v aktualizovaném census; opraven pouze zápis dokumentace.
Opakování má přesně 157 PASS / 1 dosavadní FAIL migrace 112. Logy jsou
v `betting-ranking-20260912`.

Celý profil na čistém `465c2345`, run `2026-09-12T10-44-34-943Z`, má
**342 PASS / 3 FAIL / 1 TIMEOUT / 8 BLOCKED**, exit 1. Engine 17/17,
integrace 19/19 a module ratchet 13/13 PASS. Registry otisk nezměněn.
Tři FAIL a osm BLOCKED mají stejné příčiny jako výše, artifact validation
157/158. Předchozí `m2-effect-broker-v1` tentokrát prošel 56/56 za 18 699 ms;
nový timeout po 30 029 ms má `m2-lifecycle-authority-repository.test.js`.
Celé `src`, kontrakty M2, tato sada a harness jsou proti vstupu beze změny.
Samostatné opakování stejným registry runnerem bez změny 30s limitu,
run `2026-09-12T10-50-35-138Z`, prošlo **13/13 za 7 771 ms** na stejné
čisté revizi. Příčina kolísání není prokázaná; původní timeout a celý FAIL
zůstávají zachované. Přesné změny programových stavů jsou uložené
v `profile-comparison.json`, opakování v `m2-timeout-recheck.log`.
Následný closeout mění pouze dokumentaci. `git diff --check` PASS.
Stav zůstává IMPLEMENTED_SLICE / REVIEW_PENDING.
