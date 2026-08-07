# IntentSmith

IntentSmith je local-first AI pracovní prostředí pro technického power usera.
Spojuje konverzaci, porozumění projektům a řízené provádění práce nad vlastními
repozitáři. Běží na Linuxu, používá C3 Studio postavené na Theia/Electron,
lokální Ollamu a SQLite.

> **Stav: aktivní vývoj před 1.0.** Repozitář není production-ready release.
> Aktuálně je přijatá pouze schopnost CRE; ostatní části mají různě silnou
> runtime evidenci nebo otevřené vady. Přesný, neskrývaný stav je v
> [SYSTEM-MAP.md](SYSTEM-MAP.md). Historický C3 základ je zachováván evolučně,
> ne přepisován od nuly.

## Proč IntentSmith existuje

- **Autorita uživatele:** významný efekt má mít původ, omezený rozsah,
  odpovídající schválení a auditní stopu.
- **Local-first:** běžný chat a práce s projektem nemají vyžadovat cloudový
  účet. Modelové role může obsluhovat lokální Ollama.
- **Žádný tichý outbound:** background online discovery je výchozím stavem
  vypnuté. Explicitní síťové funkce jsou samostatné schopnosti.
- **Modularita:** expertizy, skills, specialisté, agenti a nástroje se mají
  připojovat přes verzované hranice, nikoli přes skryté pravomoci.
- **Pravdivé výsledky:** `FAIL`, `BLOCKED` a neprovedený test nejsou PASS.

Plný produktový kontrakt a hranice 1.0 popisuje [PRODUCT.md](PRODUCT.md).

## Co dnes v repozitáři je

- C3 Studio IDE s chatem, projekty, expertizami, specialisty a provozními
  panely;
- backend s REST a WebSocket rozhraním, CRE routingem a lokální LLM gateway;
- persistentní konverzace a projektový lifecycle nad SQLite;
- Code Intelligence, patch/execution engine a governance kontroly;
- platformy pro skills, nástroje, specialisty, agenty, paměť a notifikace.

Existence modulu neznamená, že je jeho celá user journey přijata. Současný
stav 22 schopností a známé limity jsou v [SYSTEM-MAP.md](SYSTEM-MAP.md).

## Jak to pracuje

```text
uživatel v C3 Studiu
        │  HTTP + WebSocket
        ▼
chat / CRE ──► deterministický handler nebo lokální Ollama
        │
        ├──► konverzace + projektový kontext + paměť
        ├──► quality pipeline
        └──► plán / nástroj / patch / lifecycle
                    │
                    ▼
          approval, evidence a SQLite stav
```

Hlavní runtime cesta je `C3 Studio → /c3/ws nebo /api/* → chat controller →
CRE → handler → LLM/effect → persistence → Studio`. Cílové jednotné effect a
approval connectory jsou součástí M2 a ještě nejsou dokončeným produkčním
claimem.

## Rychlý start

Podporovaným vývojovým prostředím je Linux x86_64, Node.js 22, npm 10.9.4,
Yarn 1.22.22 a Ollama. Installer dnes vyžaduje také CPython 3.12 s `venv`, C++
build nástroje a DejaVu fonty pro PDF runtime.

```bash
git clone <repository-url> intentsmith
cd intentsmith

# Projekt zatím nemá stabilní 1.0 tag. Použijte větev nebo commit určený
# operátorem a před instalací ověřte, co skutečně instalujete.
git status --branch --short

cp .env.example .env
./scripts/install.sh --minimal

# Minimální model pro běžný chat/code/review
ollama pull qwen3.5:27b

# Backend + C3 Studio; ukončení přes Ctrl+C
./scripts/run.sh
```

`--minimal` znamená pouze „nestahovat modely“; stále instaluje backend, PDF
runtime, Studio dependencies, Electron native moduly a sestaví Studio. Úplný
seznam prerekvizit a řešení chyb je v [docs/INSTALL.md](docs/INSTALL.md).

## První použití

1. Spusťte `./scripts/run.sh` a počkejte na otevření C3 Studia.
2. V levém panelu otevřete **Konverzace** a založte nový chat.
3. Dotaz `17 * 23` ověří deterministickou cestu bez modelu.
4. Běžný textový dotaz ověří lokální Ollamu; při chybě nejprve zkontrolujte
   `ollama list` a `.c3-backend.log`.
5. V sekci **Projekty** otevřete existující Git projekt. Pro první pokusy
   použijte čistý testovací repozitář a po každém efektu kontrolujte `git diff`.

Praktické workflow, API příklad, umístění dat a současná omezení popisuje
[docs/USAGE.md](docs/USAGE.md).

## Data a síť

- SQLite databáze je standardně `data/c3.db`; změnit ji lze přes
  `C3_DB_PATH`.
- Nové projekty míří standardně do `projects/`; cestu řídí
  `C3_PROJECTS_DIR`.
- Backend binduje na `127.0.0.1`. Bez explicitního bezpečnostního návrhu jej
  nevystavujte na LAN ani internet.
- `C3_ENABLE_ONLINE_DISCOVERY=false` je bezpečný výchozí stav. Marketplace,
  externí notifikace, webové nástroje a jiné explicitní outbound funkce mohou
  síť použít, když je uživatel zapne nebo vyvolá.
- Backup/restore, globální auth a sjednocená effect authority jsou předmětem
  M2/M5. Důležitá data proto zálohujte nezávisle a současný checkout
  nepovažujte za bezpečnostně hotový produkt.

## Ověření změn

```bash
# Běžný deterministický profil; může pravdivě skončit FAIL/BLOCKED
npm test

# Konzistence kanonického registru testů
node scripts/validate-test-registry.js

# Focused Studio source contract a product build
cd c3-ide
corepack yarn workspace @c3/chat-panel build
corepack yarn build
```

Gate 0 se nespouští jako běžný vývojový krok. Patří až k M6 release kandidátu.
Přesné pravidlo je v [CONTRACT.md](CONTRACT.md).

## Dokumentace

| Potřeba | Dokument |
|---|---|
| Nainstalovat a spustit | [docs/INSTALL.md](docs/INSTALL.md) |
| Používat Studio, projekty a API | [docs/USAGE.md](docs/USAGE.md) |
| Najít správný dokument | [docs/README.md](docs/README.md) |
| Pochopit produkt a scope 1.0 | [PRODUCT.md](PRODUCT.md) |
| Pochopit evoluci z C3 | [DIRECTION.md](DIRECTION.md) |
| Přispívat bez porušení pravidel | [CONTRACT.md](CONTRACT.md) |
| Vidět pořadí práce | [ROADMAP.md](ROADMAP.md) |
| Vidět naměřený aktuální stav | [SYSTEM-MAP.md](SYSTEM-MAP.md) |

Starší dokumenty pod `docs/archive/` a `docs/convergence/` jsou historická
reference nebo release evidence. Nejsou aktuálním návodem k vývoji.

## Orientace v repozitáři

```text
src/                 backend, chat, LLM, projekty, efekty a persistence
c3-ide/              Theia/Electron Studio a jeho rozšíření
specialists/         balíčky specialistů
skills/              verzované skill definice
tests/               testovací programy; registry je tests/registry.json
docs/inventory/      měřené detailní inventury schopností
docs/review/         cílené technické review a rozhodovací podklady
scripts/             instalace, běh, validace a release evidence
```

Pro agenta nebo přispěvatele je povinné pořadí četby v [AGENTS.md](AGENTS.md).
