# Produktová funkčnost — pokračování 8. října 2026

Vstup: `b19d5f194d423ecc37288257f76692e7e1d93ff2`. Vlastník a jediný zapisující
worker v ROOT checkoutu: `/root`. Operátor výslovně zadal autonomně ověřit
produktové funkce, opravovat skutečné vady a pokračovat podle pravidelných
nezávislých revizí. Návrhy opravy obnovy skillu, malého model0 M2 průchodu,
úplného omezeného GPU Hunt sběru a offline HTML hodnocení byly předloženy před
implementací. Nízká confidence vyžaduje cílený dotaz, nikoli domýšlení autority.

HTTP14 je CLOSED. Fan, kvalitativní ladění/skórování chatu a H1/H2 jsou DEFERRED
do porelease testování. Historické FAIL/NO_GO, chráněné oracle a spotřebované
rozpočty zůstávají. Tento WP aktualizuje pořadí práce ve starších projektových
a M6 WP; nemění jejich akceptační pravidla, kontrakty ani historické důkazy.

## Vlastněný rozsah

- Ověření skutečného Studio save/readback, A → B → A a restartu; exportní
  diagnostika ukončená při doloženém správném downloadu a zachovaném CDP FAIL.
- Malý explicitní model0 projektový plán → diff → přesné schválení → změna,
  skutečný Node test, Git commit a restart. Bez nové kvalitativní kampaně.
- Konkrétní oprava nepravdivého same-version úspěchu lokálního installeru:
  `src/marketplace/package-installer.js`, sdílená čistá validace v
  `src/skills/registry.js` a smysluplné regrese v `tests/marketplace.test.js`.
  Produkční marketplace zůstává OFF. Oprava in-process lokálního installeru
  neopravňuje k zapnutí REST marketplace, vzdálenému stažení nebo aktivaci
  archivního kódu bez explicitního instalačního kroku.
- Izolované podporované vyzvednutí V2 config/skill archivu a explicitní
  reinstalace; vlastní externí projektové bytes se obnovují samostatně.
  Automatický V2 restore nadále vlastní pouze databázi.
- Existující produktové webové, skill a worker cesty, aktuální build,
  soak/throughput a příprava release důkazů. Přijaté výsledky se neopakují
  bez nové změny nebo konkrétní pochybnosti.
- GPU Hunt: vlastní nový DB/report a stávající standardní D2 sběr
  `--evaluate-installed --only=qwen3.5:27b --role=D2 --limit=1` na přesném
  artefaktu a připnutém provideru. Rozpočet nejvýše26 generací (placement1,
  throughput1, role8×3), bez judge, pull/delete/binding změn a bez retry.
  Globální wall limit45min; přerušení je PARTIAL/FAIL, nikoli sběr PASS.
  Následný přímý reuse/refusal nad vlastní DB je bez generování.
- Offline HTML pro uživatelské hodnocení s poznámkami a JSON exportem.
  Hodnocení je zpětná vazba, nikoli podepsaná přejímka nebo automatický PASS.

Dokumentace: tento WP, aktuální stav v WORK-PROGRESS/ROADMAP/SYSTEM-MAP,
versionované evidence metadata a review packet. Další změna produktového
kódu mimo výše uvedené tři soubory vyžaduje konkrétní reprodukci, návrh a
samostatnou revizi; autorizované ověřování může mezitím pokračovat.

Sdílený decoder přidává jediný přímý edge
`src/marketplace/package-installer.js -> src/skills/registry.js`. Po nezávislé
revizi se generovaný `tests/fixtures/module-boundary/baseline.json` aktualizuje
výhradně standardním writerem s tímto jediným exact `--accept-edge` nad čistým
lokálním commitem opravy. Limity3cykly/28členů se nezvyšují. Předchozí ratchet
FAIL zůstane uložený; mezikrok s neaktualizovanou baseline se nepublikuje.

## Ověření a hranice

Před každým skutečným během připnout přesný čistý source, runner, oracle,
runtime/build, příkazy, počty efektů/generací a nový vlastní output; nezávislý
reviewer vydává READY a poté samostatně posuzuje skutečné důkazy. CPU a
source review nejsou živým výsledkem. Bez samovolného retry po failure.

Host source/model store/skutečný home/produkční DB jsou read-only. Zapisuje
se pouze do vlastních fixture/output/clone a existující globální GPU lease
v host `/tmp`; GPU koordinace se neizoluje změnou globálního TMPDIR.
Zastavují a uklízejí se jen procesy, soubory a zámky s prokázaným vlastnictvím.
Při neprokázaném vlastnictví zachovat data a přesný omezený stav.

Installer: zdravý opakovaný install nezapisuje soubor; chybějící skill se
obnovuje jen z explicitního validního lokálního zdroje, publikace je exclusive,
registry readback skutečný, konfliktní soubor se nepřepisuje a DB receipt
se nemění. Po publikaci a neúspěšném readback se veřejný target nemaže:
publikovaný či souběžně nahrazený soubor zůstane a operace vrátí chybu.
Uklízí se pouze vlastní privátní staging. To brání nepravdivému úspěchu i
smazání cizího souboru při souběžném zápisu.

Exit implementační dávky: meaningful focused checks, relevantní stávající
offline/database gate na novém source, diff/check, nezávislé source i actual
review, commit/push a ověření remote SHA/CI. Integrace do main je vývojová.
Produkční restart/deploy, release tag/publish, podpisy a model activation
nevznikají z agregovaného skóre ani z vlastního fixture PASS.

M5 skutečné custody/rotace/podpisy, M6 nezávislá authority, operátorské demo
a finální schválení zůstávají tvrdými vnějšími podmínkami. Release zůstává
NOT_ACCEPTED, dokud nejsou splněné. Technická práce může pokračovat přes
zavřenou akceptační bránu v rozsahu již uděleného operátorského povolení.
