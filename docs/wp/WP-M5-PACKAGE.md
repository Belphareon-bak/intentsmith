# WP-M5-PACKAGE — install profil a docker disposition

**Typ:** zapisující Work Package · **Stav: ZÁLOŽNÍ SLOT — needispečovat do fronty**
**Vstupní revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Vlastník:** jediný zapisující vlastník v okamžiku aktivace

---

## 0. TVRDÝ BLOCK — pořadí vůči dávce M1

> **`WP-M5-PACKAGE` smí doběhnout buď celý PŘED `B4`, nebo až PO `B6`.
> Nikdy mezi nimi.**

Důvod je měřicí, ne organizační. Tenhle WP sahá na `scripts/install.sh`. `B4`
i `B6` mají fresh-clone install jako součást journey. Kdyby PACKAGE doskočil
mezi ně, posune se baseline a `B6` naměří něco jiného než `B4` — journey pak
neměří build, ale rozdíl mezi dvěma installery. Výsledek by vypadal jako nález
a byl by artefaktem pořadí.

Před aktivací se proto **explicitně zaznamená**, ve které z obou pozic se WP
spouští, a při akceptaci se ověří, že mezi `B4` a `B6` do `scripts/install.sh`
nezasáhl žádný commit.

## 0b. Proč je to záložní slot

Stejně jako u `WP-M5-DATA`: aktivuje se, až M1 zaparkuje na prerekvizitě
(bezpečné okno pro GPU měření, displej pro soak) a writer slot se uvolní.
Zařazení do fronty by M1 jen oddálilo.

**Aktivační podmínka:** writer slot volný **a zároveň** splněný BLOCK z `§0`.
Druhá podmínka je tvrdší — když neplatí, WP se neaktivuje ani při volném slotu.

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

**Instalace.** `scripts/install.sh` má 534 řádků a šest míst, která inkrementují
`ERRORS` (řádky 100, 107, 118, 122, **153**, 169). Řádek 214 pak při `ERRORS > 0`
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
- **BLOCK z `§0` přestane platit** — tedy `B4` proběhlo a `B6` ještě ne. Pak
  okamžitě zastavit a nechat `scripts/install.sh` v původním stavu.

## 8. Ověřovací příkaz

```bash
bash -n scripts/install.sh
grep -n "ERRORS=\$((ERRORS + 1))" scripts/install.sh   # na vstupní revizi 6 míst
grep -rn "C3_HOST" docker/                              # nesmí zůstat 0.0.0.0
```

WP je hotový, až demonstrace z bodu 5 proběhne **z čerstvého klonu** na
pojmenovaném commitu a docker má buď funkční journey, nebo zapsanou
`unsupported` disposition. Podle `CONTRACT.md §5` se `BLOCKED` ani `NAPSÁNO`
nepočítá jako splnění.
