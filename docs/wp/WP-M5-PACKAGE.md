# WP-M5-PACKAGE — install profil a docker disposition

**Typ:** zapisující Work Package · **Stav: BLOCKED_UNTIL_M3_AND_M4_ACCEPTED_AND_REBASE**
**Source evidence revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Vlastník:** jediný zapisující vlastník v okamžiku aktivace

---

## 0. TVRDÝ BLOCK — M5 nezačíná volným slotem

`ROADMAP.md` otevírá M5 až po přijetí M3 a M4. Historický kontrakt vznikl před
tímto DAG a jeho varianta „před B4“ už není platná. Volný writer během M1, M2,
M3 ani M4 tento WP neodemkne.

Před aktivací integrátor kontrakt rebasuje na přesný post-M3/M4 integration
SHA, znovu ověří installer/package call graph, owned paths, fresh-clone baseline
a všechny §12 příkazy. Do té doby se dokument nesmí dispatchnout.

---

## 1. Uživatelský výsledek

Uživatel nainstaluje IntentSmith na podporovaném Linuxu bez toho, aby ho
instalace zastavila kvůli komponentě, která je deklarovaná jako volitelná.
Dnes to nejde: `scripts/install.sh:151` volá `fail` a inkrementuje `ERRORS`,
když chybí CPython 3.12 s podporou venv — a `scripts/install.sh:214-216`
instalaci při `ERRORS > 0` ukončí. PDF export je přitom deklarovaná
**conditional** prerekvizita.

## 2. Povolené a zakázané cesty

**Povolené k zápisu:**
- `scripts/install.sh`
- `docker/Dockerfile`, `docker/docker-compose.yml`
- `docs/INSTALL.md`
- focused test pro instalační profily

**Zakázané:** `src/**` (kromě případu, kdy se profil musí projevit v runtime
detekci — pak eskalace, ne tichý zápis), `tests/repository-hygiene.test.js`
a `tests/artifact-validation.test.js` bez ověření, proč na `install.sh`
odkazují, `c3-ide/**`.

## 3. Vlastněný connector

**Instalační profil** — hranice mezi „core, bez kterého produkt neběží" a
„optional, jehož absence smí instalaci nechat projít". Je to veřejný kontrakt
vůči uživateli i vůči `docs/INSTALL.md` a jeho tvar potřebuje souhlas podle
`CONTRACT.md §7` dřív, než se napíše první řádek shellu.

## 4. Vstupní stav — co je ověřeno (nepřeměřovat)

**Instalace.** `scripts/install.sh` má 534 řádků a sedm míst, která inkrementují
`ERRORS` (řádky 86, 100, 107, 118, 122, **153**, 169). Řádek 214 pak při `ERRORS > 0`
instalaci ukončí. Řádek 153 patří PDF bloku, který začíná na 146
(`PDF_BOOTSTRAP_PYTHON="${PYTHON3:-python3.12}"`) a pokračuje kontrolou DejaVu
fontů od řádku 157. **Obojí je PDF, obojí dnes tvrdě blokuje instalaci.**

**Docker.** `docker/Dockerfile:48` a `docker/docker-compose.yml:67` nastavují
`C3_HOST=0.0.0.0`, což runtime správně odmítá — docker cesta je dnes rozbitá.
Navíc `docker-compose.yml:16` a `:38` používají `ollama/ollama:latest`
(nepřipnuto) a `Dockerfile:10` má fallback `npm ci … || npm install`, který
v případě selhání `npm ci` tiše opustí lockfile. Reprodukovatelnost buildu tedy
není dána ani po opravě hostu.

**Kdo na `install.sh` odkazuje:** `scripts/run.sh`,
`scripts/gate0-evidence-contract.js`, `tests/repository-hygiene.test.js`,
`tests/artifact-validation.test.js`, `docs/INSTALL.md`, `README.md`,
`docs/convergence/**`. Změna profilu se tedy projeví i mimo shell skript.

### Ta věc, kterou nesmí WP udělat

ROADMAP `§9` to říká přímo: WP *„nesmí pouze přeskočit chybu instalace"*.
Změnit `fail` na `warn` je jednořádková úprava, která vypadá jako oprava a
posune problém na uživatele — ten pak dostane produkt, kde PDF export tiše
nefunguje. Výsledkem musí být **profil**: co je core, co je optional, a jak se
uživatel dozví, co mu chybí a co tím ztrácí.

## 5. Malá demonstrace

Fresh clone → `./scripts/install.sh` na stroji **bez** CPython 3.12 a **bez**
DejaVu fontů → instalace doběhne, produkt nastartuje, chat funguje, a pokus
o PDF export skončí pravdivou hláškou o chybějící volitelné komponentě.

## 6. Pozitivní a negativní test

**Pozitivní:** install core profilu bez optional komponent uspěje a produkt běží.

**Negativní** — ROADMAP `§9` první negativní test už jmenuje: *„install bez
optional PDF musí uspět nebo pravdivě `BLOCKED` podle zvoleného profilu."*
K tomu minimálně:
- chybějící **core** komponenta (Node 22) instalaci nadále zastaví — profil
  nesmí oslabit skutečné prerekvizity;
- PDF export bez nainstalované optional komponenty selže srozumitelně, ne
  výjimkou;
- docker cesta buď projde end-to-end, nebo je v `docs/INSTALL.md` pravdivě
  označená jako `unsupported` — třetí možnost neexistuje.
- hidden nebo ignorovaný vstup, například `docker/.env`, se stejným wildcard
  literalem musí selhat stejně jako viditelný Dockerfile; source gate nesmí
  zdědit ignore pravidla pracovního checkoutu;
- NUL/binary fixture s týmž souvislým literalem musí selhat stejně jako text;
  scan používá text mode záměrně a nesmí binary detekcí přeskočit obsah;
- symlink kdekoli v `docker/**` musí selhat před scanem, aby výsledek nezávisel
  na obsahu mimo commitnutý strom.

## 7. Stop condition a eskalace

Zastavit a vyžádat souhlas, pokud:
- rozdělení core/optional vyžaduje změnu v `src/**` (runtime detekce
  schopnosti) — to je jiný connector;
- oprava dockeru vyžaduje změnu runtime kontroly hostu — `C3_HOST=0.0.0.0`
  runtime odmítá **správně** a je to invariant L0-10; docker se musí přizpůsobit
  jemu, nikdy naopak;
- se ukáže, že `repository-hygiene` nebo `artifact-validation` test na dnešní
  tvar `install.sh` spoléhá — pak je to sdílená cesta a je potřeba rozhodnout
  pořadí;
- chybí exact přijatý post-M3/M4 integration SHA nebo revalidace tohoto
  kontraktu proti němu. Dokončený B4/B6 ani volný writer slot tuto dependency
  nenahrazují; `scripts/install.sh` musí zůstat v původním stavu.

## 8. Ověřovací příkaz

Docker scope používá záměrně konzervativní source invariant: literal
`0.0.0.0` nesmí zůstat nikde v `docker/**`, ani v `ARG`, aliasu, interpolaci,
folded scalaru, komentáři nebo příkladu. Tím gate nezávisí na ambientním
`.env`, Compose verzi ani pořadí vyhodnocení proměnných. Tento adresář dnes
nemá legitimní potřebu wildcard literal uchovávat; pokud by vznikla, je to
nové rozhodnutí, ne důvod gate obejít.

```bash
set -euo pipefail

bash -n scripts/install.sh
grep -n "ERRORS=\$((ERRORS + 1))" scripts/install.sh   # na vstupní revizi 7 míst
IS_M5_PACKAGE_SYMLINKS=$(find docker -type l -print) || exit 1
test -z "$IS_M5_PACKAGE_SYMLINKS"
if rg --text --hidden --no-ignore -n -F '0.0.0.0' docker/; then
  printf '%s\n' 'forbidden wildcard literal remains in docker/**' >&2
  exit 1
else
  IS_M5_PACKAGE_WILDCARD_STATUS=$?
  test "$IS_M5_PACKAGE_WILDCARD_STATUS" -eq 1
fi
```

WP je hotový, až demonstrace z bodu 5 proběhne **z čerstvého klonu** na
pojmenovaném commitu a docker má buď funkční journey, nebo zapsanou
`unsupported` disposition. Podle `CONTRACT.md §5` se `BLOCKED` ani `NAPSÁNO`
nepočítá jako splnění.
