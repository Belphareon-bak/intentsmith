# IntentSmith — instalacni prirucka

**Verze:** v135.0.0
**Datum:** 2026-07-30

---

## Obsah

1. [Pozadavky na system](#1-pozadavky-na-system)
2. [Kanonicka instalace](#2-kanonicka-instalace)
3. [Vyvoj C3 Studio IDE](#3-vyvoj-c3-studio-ide)
4. [Docker (unsupported legacy cesta)](#4-docker-unsupported-legacy-cesta)
5. [Konfigurace (.env)](#5-konfigurace)
6. [Overeni instalace](#6-overeni-instalace)
7. [Reseni problemu](#7-reseni-problemu)

---

## 1. Pozadavky na system

### Hardware

| Komponenta | Minimum | Doporuceno |
|-----------|---------|-----------|
| RAM | 16 GB | 32 GB+ |
| GPU VRAM | 12 GB (pro 32b modely) | 24 GB+ |
| Disk | 50 GB volneho mista | 100 GB+ |
| CPU | 4 jadra | 8+ jader |

> Modely qwen3.5:27b a deepseek-r1:32b vyzaduji GPU s dostatkem VRAM.
> Bez GPU lze pouzit mensi modely (7b/14b), ale kvalita odpovedi bude nizsi.

### Software

| Prerekvizita | Verze | Ucel |
|-------------|-------|------|
| Node.js | 22.x (povinne) | Backend + IDE build |
| npm | 10.9.4 | Frozen instalace BE zavislosti |
| Yarn | 1.22.22 | Frozen IDE build (Theia workspaces) |
| Ollama | latest | LLM inference server |
| Git | 2.x+ | Lifecycle (auto-commit, diff) |
| CPython | 3.12 + `venv` | Volitelny full profil: hash-locked PDF runtime |
| DejaVu fonty | `fonts-dejavu-core` | Volitelny full profil: PDF export s diakritikou |
| build-essential | - | Kompilace better-sqlite3 |

### Instalace prerekvizit (Ubuntu/Debian)

```bash
# Node.js 22 pres nvm (doporuceno)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
npm install -g npm@10.9.4

# Systemove zavislosti
sudo apt update
sudo apt install -y git python3.12 python3.12-venv build-essential curl fonts-dejavu-core

# Yarn pro C3 Studio
npm install -g yarn@1.22.22

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

### Instalace prerekvizit (Fedora/RHEL)

```bash
# Node.js 22 pres nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
npm install -g npm@10.9.4

# Systemove zavislosti
sudo dnf install -y git python3.12 gcc gcc-c++ make curl dejavu-sans-fonts

# Yarn pro C3 Studio
npm install -g yarn@1.22.22

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

Gate 0 reprodukovatelnost je overena na Linux x86_64 s glibc 2.27+.
PDF renderer v teto verzi ocekava DejaVu soubory v
`/usr/share/fonts/truetype/dejavu`; `./scripts/install.sh` tuto podminku
kontroluje a na jinem distribucnim layoutu failne s konkretni chybou.

---

## 2. Kanonicka instalace

### 2.1 Stahnuti a podporovane instalacni profily

```bash
cd ~/Projects
git clone --branch codex/intentsmith-1.0 --single-branch \
  https://github.com/Belphareon-bak/intentsmith.git
cd intentsmith

# Podporovany core profil: backend, C3 Studio, Electron ABI rebuild a artifact smoke
./scripts/install.sh --minimal
```

`core` je vychozi podporovany profil. Nevyzaduje CPython 3.12 ani DejaVu fonty;
jejich absence je hlasena jako chybejici volitelna PDF schopnost a nezastavi
instalaci. Pokus o PDF export bez runtime skonci typovanou zpravu o chybejici
prerekvizite, ne tichym uspechem.

Plny profil PDF explicitne vyzadejte:

```bash
./scripts/install.sh --profile=full --minimal
```

`full` zachovava fail-closed chovani: chybejici CPython 3.12 `venv`, DejaVu
font nebo hash-locked wheel instalaci zastavi. Staticky preflight bez zmeny
stromu, stahovani, buildu a runtime sondy:

```bash
./scripts/install.sh --profile=core --verify-only
./scripts/install.sh --profile=full --verify-only
```

Pro cache-only instalaci bez sondy Ollamy nebo modelovych operaci pouzijte
`./scripts/install.sh --profile=core --minimal --offline`. Chybejici npm nebo
Yarn artefakt v tomto rezimu instalaci zastavi; installer nikdy neprejde na
sitovy fallback.

Installer failne pri
nesouladu locku, neuspesnem Electron rebuild nebo chybejicim/ABI-nekompatibilnim
IDE artefaktu. Pouziva `npm ci`, frozen Yarn 1.22.22 a v profilu `full`
hash-locked PDF wheels,
tracked Theia webpack konfiguraci a integrity-locked ripgrep platform package.
Rucni `npm ci`, PDF installer nebo `yarn build` jsou jen dilci vyvojove kroky.

`--minimal` preskoci pouze stahovani modelu. Interaktivni rezim se na primarni
model zepta; `--full` vyzada oba dokumentovane modely a pri chybe skonci
nenulove. Ollama tagy jsou promenlive externi artefakty, takze `--full` neni
bitove reprodukovatelny modelovy provisioner. Audit musi zaznamenat digest
skutecne pouziteho modelu.

PDF runtime je ve
`${XDG_DATA_HOME:-$HOME/.local/share}/intentsmith/python/pdf`; kanonicky
absolutni override je `INTENTSMITH_PDF_PYTHON`.

### 2.2 Podporovany upgrade zdrojove instalace

1. Ukoncete IntentSmith a C3 Studio.
2. Vytvorte a overte backup podle `docs/STORAGE.md`.
3. Prejdete na presny podepsany release commit bez lokalnich produktovych zmen.
4. Znovu spustte stejny profil, napriklad
   `./scripts/install.sh --profile=core --minimal --offline` (pokud je release
   dependency cache predem naplnena), jinak stejny prikaz bez `--offline`.
5. Spustte produkt a overte `/api/status`, migracni stav a otevreni puvodniho
   projektu. Pri selhani obnovte predchozi release commit a overeny backup.

Installer je idempotentni nad jednim release stromem; nikdy nepouziva
`npm install` jako fallback po selhani frozen `npm ci`.

### 2.3 Konfigurace

```bash
# Zkopiruj sablonu
cp .env.example .env

# Uprav podle potreby; sablona nastavuje dokumentovane porty a modelove tagy
# Dulezite promenne:
#   OLLAMA_URL    — adresa Ollama serveru (default: http://127.0.0.1:11434)
#   C3_PORT       — port backendu (default: 3335)
#   C3_DB_PATH    — cesta k SQLite databazi (default: ./data/c3.db)
#   C3_ADMIN_TOKEN — povinna tajna hodnota pro production start; neposilejte ji
#                    do Git, logu ani prikazove historie
```

### 2.4 Stazeni LLM modelu

```bash
# Spust Ollama (pokud nebezi jako systemd service)
ollama serve &

# Stahni modely (celkem ~50 GB)
ollama pull qwen3.5:27b          # CHAT + CODE + R2
ollama pull deepseek-r1:32b      # D1 + R1 (hluboka analyza a review)

# Volitelne:
ollama pull qwen3-30b-a3b        # D2 (opravy — lehci model)
ollama pull llava:13b             # VISION (analyza obrazku)
```

> Stazeni modelu muze trvat desitky minut v zavislosti na rychlosti pripojeni.
> Kazdy 32b model zabira ~18-20 GB na disku.

### 2.5 Spusteni produktu

```bash
cd ~/Projects/intentsmith

# Backend + C3 Studio
./scripts/run.sh

# Pouze backend
npm start

# Pouze backend, vyvojovy rezim
npm run dev
```

Po spusteni:
- Backend: `http://127.0.0.1:3335`
- Chat UI: `http://127.0.0.1:3335/architect`
- API health: `http://127.0.0.1:3335/api/health`
- WebSocket: `ws://127.0.0.1:3335/ws`

### 2.6 Overeni backendu

```bash
# Health check
curl http://127.0.0.1:3335/api/health

# Test odeslani zpravy (HTTP)
curl -X POST http://127.0.0.1:3335/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "ahoj", "sessionId": "test-1"}'
```

---

## 3. Vyvoj C3 Studio IDE

C3 Studio je desktopova IDE postavena na Eclipse Theia 1.65.2 (Electron).
Na cistem checkoutu nejdrive vzdy spustte
`./scripts/install.sh --minimal`; nasledujici prikazy jsou urcene pro iteraci
po jiz uspesne kanonicke instalaci a samy neprovadeji Electron ABI rebuild ani
jeho smoke test.

### 3.1 Instalace IDE zavislosti

```bash
cd ~/Projects/intentsmith/c3-ide

# Uzamcena instalace zavislosti (Theia + extensions)
yarn install --frozen-lockfile --non-interactive
```

`c3-ide/yarn.lock` je soucasti source of truth. Frozen instalace nesmi pri
selhani prejit na novy dependency resolution. Samostatny Yarn krok neni
ekvivalent `install.sh`.

### 3.2 Build IDE

```bash
cd ~/Projects/intentsmith/c3-ide

# Cisty build
yarn build

# Nebo cisteni + build (po zmenach v extensionech)
yarn clean && yarn build
```

> Build trva ~50-60 sekund. Generuje adresar `src-gen/` ktery je nutny pro spusteni.

### 3.3 Spusteni IDE

```bash
cd ~/Projects/intentsmith/c3-ide
yarn start
```

> **DULEZITE:** Backend musi bezet pred spustenim IDE (port 3335).
> IDE se pripojuje pres WebSocket na `ws://localhost:3335/ws`.

### 3.4 UI fonty

Kanonicky source tree neobsahuje lokalne bundlovane Plus Jakarta Sans ani
JetBrains Mono a installer je nestahuje. C3 Studio pouzije systemove fallbacky.
Nestahujte promenlive Google Fonts archivy primo do produkcniho stromu. Budouci
bundling musi byt samostatna reviewovana zmena s pevnou verzi, hashem, licenci a
regresnim build testem. DejaVu fonty overovane installerem patri pouze k PDF
exportu.

### 3.5 Layout cache (po aktualizaci)

Pokud IDE po aktualizaci zobrazuje stary layout nebo nereaguje na nove panely:

```bash
# Nejdrive C3 Studio ukoncete. Stav se nemaze, ale presune do casovane zalohy.
C3_STUDIO_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/C3 Studio"
INTENTSMITH_LAYOUT_BACKUP_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/intentsmith/backups/c3-studio-layout-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$INTENTSMITH_LAYOUT_BACKUP_DIR"

for name in "Local Storage" "IndexedDB" "storage.json"; do
  if [ -e "$C3_STUDIO_CONFIG/$name" ]; then
    mv -- "$C3_STUDIO_CONFIG/$name" "$INTENTSMITH_LAYOUT_BACKUP_DIR/"
  fi
done

printf 'Zaloha IDE stavu: %s\n' "$INTENTSMITH_LAYOUT_BACKUP_DIR"
```

Po restartu se vytvori novy stav. Pro obnovu C3 Studio znovu ukoncete,
presunte pripadne nove vytvorene cesty stejnym postupem do dalsi zalohy a
zkopirujte pozadovane polozky z puvodni zalohy zpet do
`$C3_STUDIO_CONFIG`. Zalozni adresar nema byt soucasti Git repozitare.

---

## 4. Docker (unsupported legacy cesta)

Adresar `docker/` je zachovany kvuli funkcni parite C3, ale neni soucasti
reprodukovatelneho Gate 0 installu. Aktualni image je zalozena na Alpine/musl,
zatimco uzamceny PDF runtime vyzaduje glibc 2.27+, CPython 3.12 a systemove
DejaVu fonty. Compose build context navic dosud neni pokryt kanonickym testem.

Docker cesta je pro IntentSmith 1.0 explicitne `UNSUPPORTED`. Vsechny Compose
services jsou za profilem pojmenovanym `unsupported`, takze obycejne
`docker compose up` nic nespusti. Nepouzivejte ani explicitni legacy profil
pro produkci: backend uvnitr kontejneru zachovava `127.0.0.1` a nema
autentizovanou ingress proxy. Tato dispozice zabranuje tomu, aby neovereny
`0.0.0.0` listener nebo promenlivy `latest` image vypadal jako podporovany
instalacni kontrakt.

---

## 5. Konfigurace

Vsechny promenne se nacitaji z `.env` souboru v koreni projektu.

### Zakladni

| Promenna | Vestaveny fallback | Popis |
|----------|---------|-------|
| `C3_PORT` | 0 | Port HTTP serveru (0 = dynamicky prirazeny OS, bez konfliktu) |
| `C3_HOST` | 127.0.0.1 | Bind adresa |
| `C3_PORT_FILE` | ~/.c3/port | Port file pro IDE discovery (JSON: port, host, pid, started) |
| `C3_TRUST_PROXY` | false | Duveryhodnost X-Forwarded-For hlavicek (pro reverse proxy) |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Adresa Ollama serveru |
| `C3_DB_PATH` | ./data/c3.db | Cesta k SQLite databazi |
| `C3_PROJECTS_DIR` | ./projects | Adresar pro nove projekty |

### Modely

| Promenna | Vestaveny fallback | Role |
|----------|---------|------|
| `C3_MODEL_CHAT` | qwen3.5:27b | Obecna konverzace |
| `C3_MODEL_CODE` | qwen3.5:27b | Generovani kodu |
| `C3_MODEL_D1` | deepseek-r1-32b | Hluboka analyza |
| `C3_MODEL_D2` | qwen3-30b-a3b | Opravy (lehci model) |
| `C3_MODEL_R1` | deepseek-r1-32b | Finalni review |
| `C3_MODEL_R2` | qwen3.5:27b | Rychly review |
| `C3_MODEL_VISION` | llava:13b | Analyza obrazku |

`.env.example` zamerne mapuje D1/R1 na skutecny Ollama tag
`deepseek-r1:32b`; proto je jeho zkopirovani soucasti kanonickeho Quick Startu.

### Feature flagy

| Promenna | Default | Popis |
|----------|---------|-------|
| `C3_ENABLE_AGENTS` | true | Worker agenty |
| `C3_ENABLE_LIFECYCLE` | true | Project Lifecycle |
| `C3_ENABLE_EXPERTISES` | true | Expertise System |

### Lifecycle

| Promenna | Default | Popis |
|----------|---------|-------|
| `C3_LIFECYCLE_REVIEW_FREQ` | 3 | Review po N milnicich |
| `C3_MAX_MILESTONE_LOC` | 2000 | Max LOC na milnik |
| `C3_MAX_MILESTONE_FILES` | 10 | Max souboru na milnik |
| `C3_MAX_MILESTONE_RETRIES` | 3 | Max opakovani pred BLOCKED |
| `C3_LIFECYCLE_AUTO_COMMIT` | true | Auto-commit pri PASS |

### Notifikace (volitelne)

| Skupina | Promenne | Popis |
|---------|----------|-------|
| Email | `C3_SMTP_HOST`, `C3_SMTP_PORT`, `C3_SMTP_USER`, `C3_SMTP_PASS`, `C3_SMTP_FROM` | SMTP notifikace |
| Telegram | `C3_TELEGRAM_BOT_TOKEN`, `C3_TELEGRAM_CHAT_ID` | Telegram bot |
| ntfy | `C3_NTFY_SERVER`, `C3_NTFY_TOPIC`, `C3_NTFY_TOKEN` | Push notifikace |

### Bezpecnost

| Promenna | Default | Popis |
|----------|---------|-------|
| `C3_ADMIN_TOKEN` | (prazdne) | Token pro /api/agents endpointy |
| `C3_LICENSE_KEY` | (prazdne) | Licencni klic |
| `C3_LOG_LEVEL` | info | Uroven logovani (debug/info/warn/error) |
| `C3_TRACE` | 0 | Execution tracing (1 = zapnuto) |

### Multi-session (v125, pripraveno)

| Promenna | Default | Popis |
|----------|---------|-------|
| `C3_MAX_CONCURRENT_LLM` | 1 | Max soucasnych LLM volani (1 = single GPU) |
| `C3_LLM_QUEUE_TIMEOUT` | 300000 | Timeout fronty pro LLM slot (ms, 5 min) |
| `C3_GPU_AUTO_SCALE` | false | Auto-detekce GPU a nastaveni maxConcurrentLLM |
| `C3_LLM_PROVIDER` | ollama | LLM provider ('ollama' jediny implementovany) |

---

## 6. Overeni instalace

### 6.1 Backend — spusteni testu

```bash
cd ~/Projects/intentsmith

# Integrita kanonickeho registru (263 programu)
npm run test:registry

# Povinne deterministicke profily offline + database
npm test

# Kuratorovany agregator je pouze compatibility signal, ne release dukaz
npm run test:all
```

Presne registry profily, prerequisites a timeouty jsou v
[`convergence/TEST-REGISTRY.md`](convergence/TEST-REGISTRY.md). Vysledek testu
je platny pouze s prikazem, reportem a skutecnym navratovym kodem procesu.

### 6.2 Backend — health check

```bash
# Server musi bezet
curl -s http://127.0.0.1:3335/api/status | python3 -m json.tool
```

Ocekavany vystup:
```json
{
  "status": "ok",
  "version": "...",
  "uptime": "..."
}
```

### 6.3 Ollama — overeni modelu

```bash
# Overeni ze Ollama bezi
curl -s http://127.0.0.1:11434/api/tags | python3 -m json.tool

# Melo by obsahovat alespon: qwen3.5:27b
```

### 6.4 IDE — overeni

1. Spust produkt: `./scripts/run.sh`
2. Over, ze C3 Studio otevreno a backend bezi
3. Zkontroluj status bar — zeleny indikator = backend pripojeny
4. Otevri chat panel — napsat zpravu → mela by prijit odpoved

---

## 7. Reseni problemu

### `Cannot find module 'src-gen/backend/main.js'`

Na cistem checkoutu spust kanonicky installer:
```bash
cd ~/Projects/intentsmith
./scripts/install.sh --minimal
```

Po predchozi uspesne kanonicke instalaci lze pro pouhou vyvojovou iteraci
spustit `cd c3-ide && yarn build`.

### `better-sqlite3` kompilace selhava

Chybi build nastroje:
```bash
sudo apt install -y python3.12 build-essential
npm rebuild better-sqlite3
```

Nebo nesedi verze Node.js (native modul zkompilovan pro jinou verzi):
```bash
# Zkontroluj verzi
node -v  # Melo by byt v22.x

# Rekompilace
npm rebuild better-sqlite3
```

### `Error: connect ECONNREFUSED 127.0.0.1:11434`

Ollama nebezi:
```bash
# Jako proces
ollama serve

# Nebo jako systemd service
sudo systemctl start ollama
sudo systemctl enable ollama  # autostart po restartu
```

### IDE neukazuje nove panely po aktualizaci

Ukoncete C3 Studio a pouzijte nedestruktivni zalohovaci postup v
[sekci 3.5](#35-layout-cache-po-aktualizaci). Pak IDE restartujte.

### Port 3335 je obsazeny

```bash
# Najdi proces na portu
lsof -i :3335

# Nebo zmenit port v .env
echo "C3_PORT=3336" >> .env
```

### Frozen Yarn install v c3-ide selhava

```bash
cd ~/Projects/intentsmith/c3-ide
yarn --version  # musi byt 1.22.22
yarn install --frozen-lockfile --non-interactive
```

Pri nesouladu manifestu a locku instalaci neopakujte bez `--frozen-lockfile`.
Zmenu `yarn.lock` je nutne samostatne reviewovat.

### Ollama: model neodpovida / timeout

```bash
# Zkontroluj VRAM
nvidia-smi

# Pokud neni dostatek VRAM, pouzij mensi model
echo "C3_MODEL_CHAT=qwen3.5:14b" >> .env
```

### Backend pada pri startu s `SQLITE_CANTOPEN`

Adresar pro databazi neexistuje:
```bash
mkdir -p ~/Projects/intentsmith/data
```

---

*Posledni aktualizace: v135.0.0 (2026-07-30)*
