# C3 Agent — Instalacni prirucka

**Verze:** v131.0.0
**Datum:** 2026-03-22

---

## Obsah

1. [Pozadavky na system](#1-pozadavky-na-system)
2. [Instalace backendu (BE)](#2-instalace-backendu)
3. [Instalace C3 Studio IDE](#3-instalace-c3-studio-ide)
4. [Docker (alternativa)](#4-docker-alternativa)
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
| npm | 10+ | Instalace BE zavislosti |
| yarn | 1.22+ | IDE build (Theia workspaces) |
| Ollama | latest | LLM inference server |
| Git | 2.x+ | Lifecycle (auto-commit, diff) |
| Python | 3.x | Native moduly (node-gyp, better-sqlite3) |
| build-essential | - | Kompilace better-sqlite3 |

### Instalace prerekvizit (Ubuntu/Debian)

```bash
# Node.js 22 pres nvm (doporuceno)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22

# Systemove zavislosti
sudo apt update
sudo apt install -y git python3 build-essential curl

# Yarn
npm install -g yarn

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

# Systemove zavislosti
sudo dnf install -y git python3 gcc gcc-c++ make curl

# Yarn
npm install -g yarn

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
```

---

## 2. Instalace backendu

### 2.1 Stahnuti a instalace zavislosti

```bash
cd ~/Projects
git clone <repo-url> c3-agent-wip
cd c3-agent-wip

# Instalace Node.js zavislosti
npm install
```

> `npm install` zkompiluje nativni modul `better-sqlite3`. Pokud selze, zkontroluj ze mas `python3`, `make` a `gcc` (viz prerekvizity).

### 2.2 Konfigurace

```bash
# Zkopiruj sablonu
cp .env.example .env

# Uprav podle potreby (volitelne — defaulty funguji out-of-the-box)
# Dulezite promenne:
#   OLLAMA_URL    — adresa Ollama serveru (default: http://127.0.0.1:11434)
#   C3_PORT       — port backendu (default: 3335)
#   C3_DB_PATH    — cesta k SQLite databazi (default: ./data/c3.db)
```

### 2.3 Stazeni LLM modelu

```bash
# Spust Ollama (pokud nebezi jako systemd service)
ollama serve &

# Stahni modely (celkem ~50 GB)
ollama pull qwen3.5:27b          # CHAT + R2 (hlavni konverzacni model)
ollama pull qwen3.5:27b    # CODE (generovani kodu)
ollama pull deepseek-r1:32b      # D1 + R1 (hluboka analyza a review)

# Volitelne:
ollama pull qwen3-30b-a3b        # D2 (opravy — lehci model)
ollama pull llava:13b             # VISION (analyza obrazku)
```

> Stazeni modelu muze trvat desitky minut v zavislosti na rychlosti pripojeni.
> Kazdy 32b model zabira ~18-20 GB na disku.

### 2.4 Spusteni backendu

```bash
cd ~/Projects/c3-agent-wip

# Produkcni rezim
node src/server.js

# Vyvojovy rezim (auto-restart pri zmenach)
node --watch src/server.js
```

Po spusteni:
- Backend: `http://127.0.0.1:3335`
- Chat UI: `http://127.0.0.1:3335/architect`
- API status: `http://127.0.0.1:3335/api/status`
- WebSocket: `ws://127.0.0.1:3335/ws`

### 2.5 Overeni backendu

```bash
# Health check
curl http://127.0.0.1:3335/api/status

# Test odeslani zpravy (HTTP)
curl -X POST http://127.0.0.1:3335/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "ahoj", "sessionId": "test-1"}'
```

---

## 3. Instalace C3 Studio IDE

C3 Studio je desktopova IDE postavena na Eclipse Theia 1.65.2 (Electron).

### 3.1 Instalace IDE zavislosti

```bash
cd ~/Projects/c3-agent-wip/c3-ide

# Instalace zavislosti (Theia + extensions)
yarn install
```

> `yarn install` muze trvat 2-5 minut (Theia stahuje velke mnozstvi zavislosti).

### 3.2 Build IDE

```bash
cd ~/Projects/c3-agent-wip/c3-ide

# Cisty build
yarn build

# Nebo cisteni + build (po zmenach v extensionech)
yarn clean && yarn build
```

> Build trva ~50-60 sekund. Generuje adresar `src-gen/` ktery je nutny pro spusteni.

### 3.3 Spusteni IDE

```bash
cd ~/Projects/c3-agent-wip/c3-ide
yarn start
```

> **DULEZITE:** Backend musi bezet pred spustenim IDE (port 3335).
> IDE se pripojuje pres WebSocket na `ws://localhost:3335/ws`.

### 3.4 Fonty (volitelne)

IDE pouziva fonty Plus Jakarta Sans a JetBrains Mono. Electron nema pristup ke Google Fonts, proto je nutne je bundlovat lokalne.

```bash
FONT_DIR=~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/styles/fonts
mkdir -p "$FONT_DIR"

# Plus Jakarta Sans
cd /tmp
wget "https://fonts.google.com/download?family=Plus+Jakarta+Sans" -O pjs.zip
unzip -o pjs.zip -d pjs
cp pjs/static/*.ttf "$FONT_DIR/"

# JetBrains Mono
wget "https://fonts.google.com/download?family=JetBrains+Mono" -O jbm.zip
unzip -o jbm.zip -d jbm
cp jbm/static/*.ttf "$FONT_DIR/"
```

Po pridani fontu je nutny rebuild: `cd ~/Projects/c3-agent-wip/c3-ide && yarn build`

### 3.5 Layout cache (po aktualizaci)

Pokud IDE po aktualizaci zobrazuje stary layout nebo nereaguje na nove panely:

```bash
# Smaz layout cache
rm -rf ~/.config/"C3 Studio"/Local\ Storage
rm -rf ~/.config/"C3 Studio"/IndexedDB
rm -f ~/.config/"C3 Studio"/storage.json
```

---

## 4. Docker (alternativa)

Pro rychle nasazeni bez manualni instalace Ollama a Node.js.

### 4.1 Spusteni

```bash
cd ~/Projects/c3-agent-wip/docker

# Start vsech sluzeb (Ollama + model pull + C3 backend)
docker compose up -d

# Sledovani logu
docker compose logs -f c3

# Zastaveni
docker compose down
```

### 4.2 Co Docker stack obsahuje

| Sluzba | Kontejner | Popis |
|--------|-----------|-------|
| `ollama` | c3-ollama | Ollama LLM server s GPU podporou |
| `ollama-init` | c3-ollama-init | Init kontejner — stahne modely (qwen3.5:27b, qwen3.5:27b, deepseek-r1:32b) |
| `c3` | c3-agent | C3 Agent backend (Node.js 22-alpine) |

### 4.3 GPU podpora

Docker compose vyzaduje NVIDIA Container Toolkit pro GPU pristup:

```bash
# Instalace NVIDIA Container Toolkit (Ubuntu)
distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 4.4 Volumes

| Volume | Cesta v kontejneru | Ucel |
|--------|-------------------|------|
| c3-ollama-data | /root/.ollama | Stazene LLM modely |
| c3-agent-data | /data | SQLite databaze |
| c3-projects | /projects | Projektove soubory |

> Data preziji `docker compose down`. Pro uplny reset: `docker compose down -v`

### 4.5 Vlastni build

```bash
cd ~/Projects/c3-agent-wip/docker

# Bez obfuskace
docker build -t c3-agent .

# S obfuskaci zdrojoveho kodu
docker build --build-arg BUILD_OBFUSCATE=1 -t c3-agent .
```

> **Pozn.:** Docker stack neobsahuje IDE. IDE je desktopova aplikace a spousti se lokalne (viz sekce 3).

---

## 5. Konfigurace

Vsechny promenne se nacitaji z `.env` souboru v koreni projektu.

### Zakladni

| Promenna | Default | Popis |
|----------|---------|-------|
| `C3_PORT` | 0 | Port HTTP serveru (0 = dynamicky prirazeny OS, bez konfliktu) |
| `C3_HOST` | 127.0.0.1 | Bind adresa |
| `C3_PORT_FILE` | ~/.c3/port | Port file pro IDE discovery (JSON: port, host, pid, started) |
| `C3_TRUST_PROXY` | false | Duveryhodnost X-Forwarded-For hlavicek (pro reverse proxy) |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Adresa Ollama serveru |
| `C3_DB_PATH` | ./data/c3.db | Cesta k SQLite databazi |
| `C3_PROJECTS_DIR` | ./projects | Adresar pro nove projekty |

### Modely

| Promenna | Default | Role |
|----------|---------|------|
| `C3_MODEL_CHAT` | qwen3.5:27b | Obecna konverzace |
| `C3_MODEL_CODE` | qwen3.5:27b | Generovani kodu |
| `C3_MODEL_D1` | deepseek-r1:32b | Hluboka analyza |
| `C3_MODEL_D2` | qwen3-30b-a3b | Opravy (lehci model) |
| `C3_MODEL_R1` | deepseek-r1:32b | Finalni review |
| `C3_MODEL_R2` | qwen3.5:27b | Rychly review |
| `C3_MODEL_VISION` | llava:13b | Analyza obrazku |

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
cd ~/Projects/c3-agent-wip

# Zakladni testy (nevyzaduji Ollama)
node tests/cre-comprehensive.test.js      # 401 testu — CRE klasifikace
node tests/cre-gatekeeper.test.js          # 43 testu — CRE Gatekeeper
node tests/schema-migrations.test.js       # 26 testu — DB migrace

# Expertise system (nevyzaduje Ollama)
node tests/merge-engine.test.js            # 40 testu
node tests/capability-enforcer.test.js     # 38 testu
node tests/expertise-system.test.js         # 40 testu

# Lifecycle (nevyzaduje Ollama)
node tests/lifecycle-unit.test.js          # 103 testu
node tests/lifecycle-e2e.test.js           # 138 testu
node tests/milestone-size.test.js          # 40 testu

# Celkem ~900+ testu bez nutnosti Ollama
```

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

# Melo by obsahovat: qwen3.5:27b, qwen3.5:27b, deepseek-r1:32b
```

### 6.4 IDE — overeni

1. Spust backend: `node src/server.js`
2. Spust IDE: `cd c3-ide && yarn start`
3. Zkontroluj status bar — zeleny indikator = backend pripojeny
4. Otevri chat panel — napsat zpravu → mela by prijit odpoved

---

## 7. Reseni problemu

### `Cannot find module 'src-gen/backend/main.js'`

IDE nebyla zbuildovana. Spust:
```bash
cd ~/Projects/c3-agent-wip/c3-ide
yarn build
```

### `better-sqlite3` kompilace selhava

Chybi build nastroje:
```bash
sudo apt install -y python3 build-essential
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

Smaz layout cache:
```bash
rm -rf ~/.config/"C3 Studio"/Local\ Storage
rm -rf ~/.config/"C3 Studio"/IndexedDB
rm -f ~/.config/"C3 Studio"/storage.json
```

Pak restart IDE.

### Port 3335 je obsazeny

```bash
# Najdi proces na portu
lsof -i :3335

# Nebo zmenit port v .env
echo "C3_PORT=3336" >> .env
```

### `yarn install` v c3-ide selhava

```bash
# Smaz cache a zkus znovu
cd ~/Projects/c3-agent-wip/c3-ide
rm -rf node_modules
yarn cache clean
yarn install
```

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
mkdir -p ~/Projects/c3-agent-wip/data
```

---

*Posledni aktualizace: v131.0.0 (2026-03-22)*
