# Instalace IntentSmithu

Tento návod popisuje současný vývojový checkout na podporované kombinaci
Linux + C3 Studio/Theia + lokální Ollama. IntentSmith zatím nemá stabilní 1.0
release ani podporovaný Docker image.

## 1. Požadavky

### Software

| Komponenta | Požadavek | Proč |
|---|---|---|
| Node.js | 22.x | backend i Studio build |
| npm | přesně 10.9.4 | frozen backend instalace |
| Yarn | přesně 1.22.22 | frozen Theia workspace |
| Git | 2.x+ | projekty, diffy a lifecycle |
| Ollama | aktuální lokální instalace | modelové cesty |
| CPython | 3.12 s `venv` | izolovaný PDF runtime a native buildy |
| C/C++ toolchain | `make`, `g++`/`c++` | `better-sqlite3`, tree-sitter a Electron moduly |
| DejaVu fonty | standardní Linux balíček | PDF export s českou/slovenskou diakritikou |

Na Ubuntu/Debian typicky potřebujete:

```bash
sudo apt update
sudo apt install -y git python3.12 python3.12-venv build-essential \
  curl fonts-dejavu-core
```

Na Fedoře/RHEL použijte odpovídající balíčky `git`, `python3.12`, kompilátor,
`make`, `curl` a DejaVu fonty. Node.js 22 a Ollamu instalujte podle jejich
oficiálních instrukcí; poté ověřte verze:

```bash
node --version
npm --version
yarn --version
python3.12 --version
ollama --version
```

Installer skončí chybou, pokud Node není 22.x, npm není 10.9.4, Yarn není
1.22.22 nebo chybí povinný PDF runtime. To je současné chování, nikoli příslib
budoucího minimálního instalačního profilu.

### Hardware

- 16 GB RAM je praktické minimum, 32 GB a více je vhodnější;
- disk potřebuje prostor pro backend, velký Theia workspace a modely;
- GPU není nutná pro deterministické funkce, ale velké modely vyžadují
  odpovídající VRAM. 24GB karta je referenční lokální konfigurace projektu.

Velikost a výkon modelu závisejí na konkrétní quantizaci. Nepovažujte údaj v
názvu modelu za přesný VRAM budget.

## 2. Získání správné revize

```bash
git clone <repository-url> intentsmith
cd intentsmith
git status --branch --short
```

Projekt je aktivně vyvíjen a nemá stabilní 1.0 tag. Použijte větev nebo commit
určený operátorem. Neinstalujte náhodnou historickou větev jen proto, že má v
názvu `1.0`.

Před instalací zkontrolujte, že pracovní strom neobsahuje neznámé změny:

```bash
git status --short
node --version
npm --version
```

## 3. Konfigurace

```bash
cp .env.example .env
```

Pro první lokální běh ponechte zejména:

```dotenv
C3_HOST=127.0.0.1
C3_PORT=3335
C3_ENABLE_ONLINE_DISCOVERY=false
OLLAMA_URL=http://127.0.0.1:11434
C3_MODEL_CHAT=qwen3.5:27b
C3_MODEL_CODE=qwen3.5:27b
```

- `C3_HOST` neměňte na `0.0.0.0`; vzdálený listener není součástí core 1.0.
- Bez `C3_PORT` zvolí backend volný port a zapíše jej do `~/.c3/port`.
- Relativní `C3_DB_PATH` a `C3_PROJECTS_DIR` se vztahují k pracovnímu adresáři
  procesu; pro dlouhodobý provoz jsou srozumitelnější absolutní cesty.
- Tajemství necommitujte do `.env`. Současná globální auth a secret management
  nejsou production-ready.

Úplný aktuální seznam proměnných je v [`.env.example`](../.env.example) a
jejich skutečné fallbacky v [`src/config.js`](../src/config.js).

## 4. Instalace

```bash
./scripts/install.sh --minimal
```

Installer provede:

1. kontrolu přesných runtime verzí a systémových prerekvizit;
2. `npm ci` a smoke nativeho `better-sqlite3`;
3. hash-locked Python PDF runtime mimo repozitář;
4. frozen Yarn instalaci Studia;
5. Electron ABI rebuild;
6. product-level Theia build a kontrolu výsledných artefaktů.

`--minimal` pouze přeskočí stahování modelů. Interaktivní režim se na modely
zeptá a `--full` je stáhne automaticky. Ollama tagy jsou proměnlivé externí
artefakty; pro reprodukovatelné měření zaznamenejte i skutečný digest.

### Důležité pravidlo Studia

Commitnutý `c3-ide/extensions/c3-chat-panel/lib/` je současný autoritativní
runtime. Archivní TypeScript jej nesmí přegenerovat. Pro ověření použijte:

```bash
cd c3-ide
corepack yarn workspace @c3/chat-panel build  # ověří kontrakt lib
corepack yarn build                           # sestaví produkt
```

Package `watch` je záměrně zakázaný. Package `clean` je no-op, který musí `lib`
zachovat. Neobnovujte staré návody s `tsc -b` nad chat panelem.

## 5. Modely

Spusťte Ollamu podle konfigurace systému a nainstalujte alespoň chat model:

```bash
ollama pull qwen3.5:27b
ollama list
```

Dodaná `.env.example` mapuje další role také na `deepseek-r1:32b`,
`qwen3-30b-a3b` a `llava:13b`. Nejsou nutné pro deterministický test, ale
schopnost, která danou roli používá, bez svého modelu pravdivě degraduje nebo
selže.

## 6. Start a kontrola

```bash
# Backend + C3 Studio v jednom procesním wrapperu
./scripts/run.sh

# Alternativně pouze backend
./scripts/run.sh --backend
```

Wrapper čeká na privátní port file, provede health check a zapisuje backend log
do `.c3-backend.log`. Při `Ctrl+C` ukončí backend i Studio.

V druhém terminálu lze zjistit skutečný port a ověřit health:

```bash
INTENTSMITH_PORT=$(node -p \
  "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.c3/port','utf8')).port")
curl --fail "http://127.0.0.1:${INTENTSMITH_PORT}/api/health"
```

WebSocket endpoint je `/c3/ws`. `/architect` je legacy web UI a není cílovým
rozhraním 1.0.

## 7. Aktualizace checkoutu

Před přepnutím revize zachovejte vlastní práci a runtime data. Poté opakujte
installer; je navržen jako idempotentní:

```bash
git status --short
git pull --ff-only
./scripts/install.sh --minimal
```

Neprovádějte slepé mazání `node_modules`, databáze nebo Studio profilu. Native
ABI problém nejprve potvrďte z logu a opravte opakováním kanonického installeru.

## 8. Řešení problémů

### Backend nenastartuje

```bash
tail -n 100 .c3-backend.log
node --version
npm --version
```

Pokud chybí native binding, nespouštějte náhodné globální rebuildy; zopakujte
`./scripts/install.sh --minimal` s dostupným kompilátorem a Pythonem 3.12.

### Model neodpovídá

```bash
curl --fail http://127.0.0.1:11434/api/tags
ollama list
rg '^OLLAMA_URL|^C3_MODEL_' .env
```

Zkontrolujte přesný tag. `deepseek-r1-32b` a `deepseek-r1:32b` nejsou stejný
identifikátor.

### Studio se neotevře nebo používá starý layout

Nejprve ukončete `run.sh`, zkontrolujte konec logu a spusťte installer znovu.
Studio profil leží typicky v `${XDG_CONFIG_HOME:-$HOME/.config}/C3 Studio`.
Pokud jej potřebujete diagnosticky obnovit, nejdříve jej přesuňte do datované
zálohy; nemažte jej bez možnosti návratu.

### Port 3335 je obsazený

Buď ukončete vlastníka portu, nebo odstraňte `C3_PORT` z `.env` a použijte port
z `~/.c3/port`. `./scripts/stop.sh` zastavuje proces spuštěný projektovým
wrapperem.

### Docker

`docker/` je zděděná, neověřená cesta. Současný obraz používá konfiguraci,
kterou runtime bezpečnostní hranice odmítá, a není podporovanou instalací.

## 9. Další krok

Pokračujte [průvodcem používáním](USAGE.md). Naměřené vady instalační a Studio
cesty jsou v [SYSTEM-MAP.md](../SYSTEM-MAP.md), nikoli skryté v tomto návodu.
