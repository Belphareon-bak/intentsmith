# Spuštění `BLOCKED` E2E sad, 2026-08-21/22

**Revize:** `99a8a889` · **Model na CHAT/CODE/R2:** `qwen3.5:27b` · GPU RTX 3090

Sady registrované jako `BLOCKED` se pustily **přímo proti živému serveru**, mimo
`nightly-audit` — `server` je tam hard blocker, který `--no-block` ani
`--allow-blocker` neobejdou, takže tam tyhle sady nikdy neběžely.

## Výsledek

| Skupina | Sad | PASS |
|---|---|---|
| `server` profil | 26 | **21** |
| `model`/`soak`, vlna 1 (≤10 min) | 24 | **11 → 12 po opravě prostředí** |

## Klasifikace 13 selhání vlny 1

Ani jedno nebylo „rozbitá funkce". Rozpadají se na čtyři kořeny:

### 1. Rozpočet vs. navázaný model — 7 sad

`53-long-conversation`, `58-code-generation`, `59-cross-feature`,
`70-cre-intent-semantic`, `71-language-enforcement`, `72-followup-coherence`,
`78-guard-rules`.

Kořen je **sdílená konstanta `LLM_TIMEOUT = 60_000`** v `tests/e2e/_helpers.js:714`.
Používá ji **20 z 24** sad vlny 1, **14 z 25** sad vlny 2 a **35** sad v celém
`tests/e2e/`. **Nejde přebít env proměnnou** — je to `const`, na rozdíl od
sousedního `E2E_GPU_COOLDOWN`.

Změřeno: `qwen3.5:27b` vrátí prostou chatovou odpověď za **53 s**. Rezerva proti
rozpočtu je tedy ~7 s a cokoli delšího spadne. Sady, které prošly, prošly těsně.

Dvě sady (`53`, `72`) padly na 15minutovém stropu registru, ne na `LLM_TIMEOUT` —
obě testují dlouhý kontext, kde každý další tah bobtná.

### 2. Neúplná izolace běhu — 3 sady

`56-chat-with-project`, `57-lifecycle-full`, `77-project-context-injection`.

Nebyla to vada produktu. Sady vyžadují **kompletní runner-owned izolaci**, kterou
jinak staví `makeSuiteEnvironment()` v auditu: `C3_AUDIT_RUN=1`, shodné
`C3_PROJECTS_DIR` a `INTENTSMITH_TEST_PROJECTS_DIR`, `INTENTSMITH_TEST_ARTIFACT_DIR`,
čtyři `XDG_*`, `TMPDIR`/`TMP`/`TEMP`, `npm_config_cache`, `C3_DB_PATH`,
`C3_PORT_FILE` — a **`HOME` uvnitř `.intentsmith-artifacts`**.

Bez `C3_AUDIT_RUN=1` si bootstrap `isolated-test-db.js` vyrobí **vlastní** privátní
root a přepíše injektované cesty, takže test kouká jinam než server.

Po doplnění celé izolace: `56` **PASS** (7 s), `57` **PASS** (57 s). `77` se
posunulo za zakládání projektu a padá až na obsahové aserci.

### 3. Kvalita výstupu modelu — 1 sada

`79-response-semantics` — *„step-by-step response must contain ordered list"*.
Není to timeout ani pád; je to očekávání o **formátu odpovědi**, závislé na
navázaném modelu.

### 4. Potvrzená vada — 1 sada

`76-specialist-domain`: `GET` seznam specialistů vrátí položku s
`id: 'accountant-cz'`, ale `POST /api/chat/specialist` s tímtéž id skončí
`404 Specialist not found`, protože `loader.getManifest('accountant-cz')` vrátí
`null`. **Dva zdroje identity specialisty si odporují.**

Ověřeno i v korektní izolaci (`C3_AUDIT_RUN=1`, vlastní `HOME`) — selhává dál,
takže to není prostředím. `accountant-cz` je fyzicky v `specialists/` a server
při startu hlásí „5 specialist(s) enabled".

### Nedokončené ověření

`74-session-isolation` (následná otázka zaklasifikována jako „vypiš projekty";
6 ze 7 kroků prošlo, izolace konverzací **není** porušená) a
`75-expertise-behavioral` (`Expected "CREATIVE", got "null"`) se v korektní
izolaci **nestihly doběhnout**. Zůstávají nediagnostikované a nesmí se vydávat
za vady ani za zastaralá očekávání.

## Co z toho plyne pro `PRODUCT.md §5` bod 7

Bod 7 zní „release gate nezakrývá `FAIL`, `BLOCKED` ani neprovedený test".
Těch 82 `BLOCKED` sad nejsou rozbité testy — je to **82 testů, které gate neumí
spustit**. Aby je uměl, potřebuje režim, který postaví server a runner-owned
izolaci. Dokud ho nemá, `BLOCKED` je pravdivý popis harnessu, ne produktu.
