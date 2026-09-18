# IntentSmith — instalacni prirucka

**Rozsah:** vývojový kandidát 1.0, dosud bez publikovaného release
**Aktualizace:** 2026-09-12

---

## Obsah

1. [Pozadavky na system](#1-pozadavky-na-system)
2. [Kanonicka instalace](#2-kanonicka-instalace)
3. [Vyvoj IntentSmith IDE](#3-vyvoj-c3-studio-ide)
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
| GPU VRAM | 12 GB (mensi modely) | 24 GB+ pro vychozi portfolio |
| Disk | 50 GB volneho mista | 100 GB+ |
| CPU | 4 jadra | 8+ jader |

> Vychozi modely vyzaduji GPU s dostatkem VRAM. Produkcni scoring je prisne
> GPU-only: kandidat, ktery se nevejde cely do VRAM, se automaticky vyradi a
> nesmi dostat skore z CPU/RAM offloadu.

### Software

| Prerekvizita | Verze | Ucel |
|-------------|-------|------|
| Node.js | 22.21.1 z `.nvmrc`; minimum 22.12.0, méně než 23 | Backend + IDE build |
| npm | 10.9.4 | Frozen instalace BE zavislosti |
| Yarn | 1.22.22 | Frozen IDE build (Theia workspaces) |
| Ollama | `0.34.0-intentsmith.1`, přesně ověřený build podle Decision 048 | LLM inference a ověřená identita artefaktu |
| Git | 2.x+ | Lifecycle (auto-commit, diff) |
| bubblewrap + util-linux | `/usr/bin/bwrap`, `/usr/bin/prlimit` | Povinné ohraničení procesových efektů |
| Python 3 + psmisc | `/usr/bin/python3` s `pidfd_open`, `/usr/bin/fuser` | Recovery procesů a offline obnova databáze |
| CPython | 3.12 + `venv` | Volitelny full profil: hash-locked PDF runtime |
| DejaVu fonty | `fonts-dejavu-core` | Volitelny full profil: PDF export s diakritikou |
| build-essential | - | Kompilace better-sqlite3 |

### Instalace prerekvizit (Ubuntu/Debian)

```bash
# Node.js 22 pres nvm (doporuceno)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22.21.1
nvm use 22.21.1
npm install -g npm@10.9.4

# Systemove zavislosti
sudo apt update
sudo apt install -y git python3 python3.12 python3.12-venv build-essential curl fonts-dejavu-core psmisc bubblewrap util-linux

# Yarn pro IntentSmith
npm install -g yarn@1.22.22

# Provider: použij ověřený build popsaný níže; běžná upstream instalace
# nedokládá IntentSmith exact-artifact/provider kontrakt.
```

### Instalace prerekvizit (Fedora/RHEL)

```bash
# Node.js 22 pres nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22.21.1
nvm use 22.21.1
npm install -g npm@10.9.4

# Systemove zavislosti
sudo dnf install -y git python3 python3.12 gcc gcc-c++ make curl dejavu-sans-fonts psmisc bubblewrap util-linux

# Yarn pro IntentSmith
npm install -g yarn@1.22.22

# Provider: použij ověřený build popsaný níže; běžná upstream instalace
# nedokládá IntentSmith exact-artifact/provider kontrakt.
```

Gate 0 reprodukovatelnost je overena na Linux x86_64 s glibc 2.27+.
PDF renderer v teto verzi ocekava DejaVu soubory v
`/usr/share/fonts/truetype/dejavu`; `./scripts/install.sh` tuto podminku
kontroluje a na jinem distribucnim layoutu failne s konkretni chybou.

---

Aktuální modelový kontrakt vyžaduje systémový provider
`0.34.0-intentsmith.1`, který vrací důkaz skutečného modelového artefaktu.
[Decision 048](decisions/048-reproducible-evaluation-provider.md) popisuje
reprodukovatelný provider a jeho ověření. [Starší hostový záznam](execution/runs/m6/provider-activation-20260909.md)
patří k předchozí verzi `0.32.14-intentsmith.1`; není aktuálním instalačním pinem.
Na jiném hostu je nutné dodat a ověřit stejný providerový kontrakt. Vývojový
server může bez inference naběhnout, modelová část tím není kvalifikovaná.

## 2. Kanonicka instalace

### 2.1 Stahnuti a podporovane instalacni profily

```bash
cd ~/Projects
git clone https://github.com/Belphareon-bak/intentsmith.git
cd intentsmith
# INTENTSMITH_REVISION musí být úplné SHA konkrétního posuzovaného kandidáta.
# Získej je z jeho run reportu / předání; žádný aktuální release tag zatím není.
: "${INTENTSMITH_REVISION:?nastav SHA posuzovaneho kandidata}"
git checkout --detach "$INTENTSMITH_REVISION"
nvm install
nvm use

# Podporovany core profil: backend, IntentSmith, Electron ABI rebuild a artifact smoke
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

Cache musí zahrnovat i samotný Yarn, pokud jej spouští Corepack, Electron
a hlavičky Node/Electron pro nativní build. Nový privátní HOME tyto cache
automaticky nepřebírá. `ENOTCACHED` znamená chybějící balíček v cache;
samo o sobě nedokazuje chybu lockfile. Připravte cache pro stejné lockfiles
a verze toolchainu před odpojením sítě. Offline instalace dostupnost Ollamy
nekontroluje; závěrečná zpráva to uvádí výslovně.

Installer failne pri
nesouladu locku, neuspesnem Electron rebuild nebo chybejicim/ABI-nekompatibilnim
IDE artefaktu. Pouziva `npm ci`, frozen Yarn 1.22.22 a v profilu `full`
hash-locked PDF wheels,
tracked Theia webpack konfiguraci a integrity-locked ripgrep platform package.
Rucni `npm ci`, PDF installer nebo `yarn build` jsou jen dilci vyvojove kroky.

`--minimal` preskoci pouze stahovani modelu. Interaktivni rezim se na primarni
model zepta; `--full` vyzada chybejici modely vychoziho portfolia roli a pri chybe skonci
nenulove. Ollama tagy jsou promenlive externi artefakty, takze `--full` neni
bitove reprodukovatelny modelovy provisioner. Audit musi zaznamenat digest
skutecne pouziteho modelu.

PDF runtime je ve
`${XDG_DATA_HOME:-$HOME/.local/share}/intentsmith/python/pdf`; kanonicky
absolutni override je `INTENTSMITH_PDF_PYTHON`.

### 2.2 Podporovany upgrade zdrojove instalace

1. Na bezicim puvodnim releasu vytvorte a overte backup podle sekce
   [State backup](STORAGE-ARCHITECTURE.md#state-backup).
2. Ukoncete IntentSmith a IntentSmith.
3. Prejdete na presny podepsany release commit bez lokalnich produktovych zmen.
4. Znovu spustte stejny profil, napriklad
   `./scripts/install.sh --profile=core --minimal --offline` (pokud je release
   dependency cache predem naplnena), jinak stejny prikaz bez `--offline`.
5. Spustte produkt a overte verejny health endpoint prikazem
   `curl --fail http://127.0.0.1:${INTENTSMITH_PORT:-3335}/api/health`, migracni stav a
   otevreni puvodniho projektu. Pri selhani obnovte predchozi release commit a
   overeny backup.

Installer je idempotentni nad jednim release stromem; nikdy nepouziva
`npm install` jako fallback po selhani frozen `npm ci`.

### 2.3 Konfigurace

```bash
# Zkopiruj sablonu
cp .env.example .env

# Uprav podle potreby; sablona nastavuje dokumentovane porty a modelove tagy
# Dulezite promenne:
#   OLLAMA_URL    — adresa Ollama serveru (default: http://127.0.0.1:11434)
#   INTENTSMITH_PORT       — port backendu (default: 3335)
#   INTENTSMITH_DB_PATH    — cesta k SQLite databazi (default: ./data/intentsmith.db)
#   INTENTSMITH_ADMIN_TOKEN — povinna tajna hodnota pro production start; neposilejte ji
#                    do Git, logu ani prikazove historie
```

### 2.4 Stazeni LLM modelu

```bash
# Spust Ollama (pokud nebezi jako systemd service)
ollama serve &

# Stahni vychozi portfolio
ollama pull qwen3.5:27b          # D1 + CODE + CHAT
ollama pull qwen3.8:latest       # D2 + R1
ollama pull qwen3:14b            # R2
ollama pull llava-llama3:8b      # VISION
```

> Stazeni modelu muze trvat desitky minut v zavislosti na rychlosti pripojeni.
> Kazdy 32b model zabira ~18-20 GB na disku.

### 2.5 Spusteni produktu

```bash
cd ~/Projects/intentsmith

# Backend + IntentSmith
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

## 3. Vyvoj IntentSmith IDE

IntentSmith je desktopova IDE postavena na Eclipse Theia 1.74.1 a Electron 42.11.3.
Na cistem checkoutu nejdrive vzdy spustte
`./scripts/install.sh --minimal`; nasledujici prikazy jsou urcene pro iteraci
po jiz uspesne kanonicke instalaci a samy neprovadeji Electron ABI rebuild ani
jeho smoke test.

### 3.1 Instalace IDE zavislosti

```bash
cd ~/Projects/intentsmith/intentsmith-ide

# Uzamcena instalace zavislosti (Theia + extensions)
yarn install --frozen-lockfile --non-interactive
```

`intentsmith-ide/yarn.lock` je soucasti source of truth. Frozen instalace nesmi pri
selhani prejit na novy dependency resolution. Samostatny Yarn krok neni
ekvivalent `install.sh`.

### 3.2 Build IDE

```bash
cd ~/Projects/intentsmith/intentsmith-ide

# Cisty build
yarn build

# Nebo cisteni + build (po zmenach v extensionech)
yarn clean && yarn build
```

> Build trva ~50-60 sekund. Generuje adresar `src-gen/` ktery je nutny pro spusteni.

### 3.3 Spusteni IDE

```bash
cd ~/Projects/intentsmith/intentsmith-ide
yarn start
```

> **DULEZITE:** Backend musi bezet pred spustenim IDE (port 3335).
> IDE se pripojuje pres WebSocket na `ws://localhost:3335/ws`.

### 3.4 UI fonty

Kanonicky source tree neobsahuje lokalne bundlovane Plus Jakarta Sans ani
JetBrains Mono a installer je nestahuje. IntentSmith pouzije systemove fallbacky.
Nestahujte promenlive Google Fonts archivy primo do produkcniho stromu. Budouci
bundling musi byt samostatna reviewovana zmena s pevnou verzi, hashem, licenci a
regresnim build testem. DejaVu fonty overovane installerem patri pouze k PDF
exportu.

### 3.5 Layout cache (po aktualizaci)

Pokud IDE po aktualizaci zobrazuje stary layout nebo nereaguje na nove panely:

```bash
# Nejdrive IntentSmith ukoncete. Stav se nemaze, ale presune do casovane zalohy.
INTENTSMITH_STUDIO_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/IntentSmith"
INTENTSMITH_LAYOUT_BACKUP_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/intentsmith/backups/c3-studio-layout-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$INTENTSMITH_LAYOUT_BACKUP_DIR"

for name in "Local Storage" "IndexedDB" "storage.json"; do
  if [ -e "$INTENTSMITH_STUDIO_CONFIG/$name" ]; then
    mv -- "$INTENTSMITH_STUDIO_CONFIG/$name" "$INTENTSMITH_LAYOUT_BACKUP_DIR/"
  fi
done

printf 'Zaloha IDE stavu: %s\n' "$INTENTSMITH_LAYOUT_BACKUP_DIR"
```

Po restartu se vytvori novy stav. Pro obnovu IntentSmith znovu ukoncete,
presunte pripadne nove vytvorene cesty stejnym postupem do dalsi zalohy a
zkopirujte pozadovane polozky z puvodni zalohy zpet do
`$INTENTSMITH_STUDIO_CONFIG`. Zalozni adresar nema byt soucasti Git repozitare.

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
| `INTENTSMITH_PORT` | 0 | Port HTTP serveru (0 = dynamicky prirazeny OS, bez konfliktu) |
| `INTENTSMITH_HOST` | 127.0.0.1 | Bind adresa |
| `INTENTSMITH_PORT_FILE` | ~/.intentsmith/port | Port file pro IDE discovery (JSON: port, host, pid, started) |
| `INTENTSMITH_TRUST_PROXY` | false | Duveryhodnost X-Forwarded-For hlavicek (pro reverse proxy) |
| `OLLAMA_URL` | http://127.0.0.1:11434 | Adresa Ollama serveru |
| `INTENTSMITH_DB_PATH` | ./data/intentsmith.db | Cesta k SQLite databazi |
| `INTENTSMITH_PROJECTS_DIR` | ./projects | Adresar pro nove projekty |

### Modely

| Promenna | Vestaveny fallback | Role |
|----------|---------|------|
| `INTENTSMITH_MODEL_CHAT` | qwen3.5:27b | Obecna konverzace |
| `INTENTSMITH_MODEL_CODE` | qwen3.5:27b | Generovani kodu |
| `INTENTSMITH_MODEL_D1` | qwen3.5:27b | Hluboka analyza |
| `INTENTSMITH_MODEL_D2` | qwen3.8:latest | Opravy |
| `INTENTSMITH_MODEL_R1` | qwen3.8:latest | Finalni review |
| `INTENTSMITH_MODEL_R2` | qwen3:14b | Rychly review |
| `INTENTSMITH_MODEL_VISION` | llava-llama3:8b | Analyza obrazku |

`.env.example`, setup wizard a vestavene fallbacky pouzivaji stejne portfolio.
Autoritativni runtime binding je navic evidovan jako exact-artifact zaznam v DB;
tag sam o sobe neni dostatecna identita pro audit scoringu.

### Feature flagy

| Promenna | Default | Popis |
|----------|---------|-------|
| `INTENTSMITH_ENABLE_AGENTS` | true | Worker agenty |
| `INTENTSMITH_ENABLE_LIFECYCLE` | true | Project Lifecycle |
| `INTENTSMITH_ENABLE_EXPERTISES` | true | Expertise System |

### Lifecycle

| Promenna | Default | Popis |
|----------|---------|-------|
| `INTENTSMITH_LIFECYCLE_REVIEW_FREQ` | 3 | Review po N milnicich |
| `INTENTSMITH_MAX_MILESTONE_LOC` | 2000 | Max LOC na milnik |
| `INTENTSMITH_MAX_MILESTONE_FILES` | 10 | Max souboru na milnik |
| `INTENTSMITH_MAX_MILESTONE_RETRIES` | 3 | Max opakovani pred BLOCKED |
| `INTENTSMITH_LIFECYCLE_AUTO_COMMIT` | true | Auto-commit pri PASS |

### Notifikace (volitelne)

| Skupina | Promenne | Popis |
|---------|----------|-------|
| Email | `INTENTSMITH_SMTP_HOST`, `INTENTSMITH_SMTP_PORT`, `INTENTSMITH_SMTP_USER`, `INTENTSMITH_SMTP_PASS`, `INTENTSMITH_SMTP_FROM` | SMTP notifikace |
| Telegram | `INTENTSMITH_TELEGRAM_BOT_TOKEN`, `INTENTSMITH_TELEGRAM_CHAT_ID` | Telegram bot |
| ntfy | `INTENTSMITH_NTFY_SERVER`, `INTENTSMITH_NTFY_TOPIC`, `INTENTSMITH_NTFY_TOKEN` | Push notifikace |

### Bezpecnost

| Promenna | Default | Popis |
|----------|---------|-------|
| `INTENTSMITH_ADMIN_TOKEN` | (prazdne) | Produkční admin credential; desktop installer jej spravuje v privátním admin.env |
| `INTENTSMITH_LICENSE_KEY` | (prazdne) | Licencni klic |
| `INTENTSMITH_LOG_LEVEL` | info | Uroven logovani (debug/info/warn/error) |
| `INTENTSMITH_TRACE` | 0 | Execution tracing (1 = zapnuto) |

### Multi-session (v125, pripraveno)

| Promenna | Default | Popis |
|----------|---------|-------|
| `INTENTSMITH_MAX_CONCURRENT_LLM` | 1 | Max soucasnych LLM volani (1 = single GPU) |
| `INTENTSMITH_LLM_QUEUE_TIMEOUT` | 300000 | Timeout fronty pro LLM slot (ms, 5 min) |
| `INTENTSMITH_GPU_AUTO_SCALE` | false | Auto-detekce GPU a nastaveni maxConcurrentLLM |
| `INTENTSMITH_LLM_PROVIDER` | ollama | LLM provider ('ollama' jediny implementovany) |

---

## 6. Overeni instalace

### 6.1 Backend — spusteni testu

```bash
cd ~/Projects/intentsmith

# Integrita kanonickeho registru (aktualni pocet vypise validator)
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
curl --fail -s http://127.0.0.1:3335/api/health | python3 -m json.tool
```

Ocekavany vystup:
```json
{
  "status": "ok",
  "ready": true,
  "health": {
    "database": true,
    "lifecycleRecovery": true
  }
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
2. Over, ze IntentSmith otevreno a backend bezi
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
spustit `cd intentsmith-ide && yarn build`.

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

Ukoncete IntentSmith a pouzijte nedestruktivni zalohovaci postup v
[sekci 3.5](#35-layout-cache-po-aktualizaci). Pak IDE restartujte.

### Port 3335 je obsazeny

```bash
# Najdi proces na portu
lsof -i :3335

# Nebo zmenit port v .env
echo "INTENTSMITH_PORT=3336" >> .env
```

### Frozen Yarn install v intentsmith-ide selhava

```bash
cd ~/Projects/intentsmith/intentsmith-ide
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
echo "INTENTSMITH_MODEL_CHAT=qwen3.5:14b" >> .env
```

### Backend pada pri startu s `SQLITE_CANTOPEN`

Adresar pro databazi neexistuje:
```bash
mkdir -p ~/Projects/intentsmith/data
```

---

*Posledni aktualizace: v135.0.0 (2026-07-30)*


### Historie a automatická paměť

Chat ukládá historii a provozní žurnál lokálně. Režim bez historie zatím není
podporován: nové `memory.saveHistory=false` vrací chybu bez změny nastavení.
Pokud je tato hodnota uložená ze starší verze, nový chat skončí
`CHAT_PRIVACY_UNAVAILABLE` před uložením obsahu. Uživatel může ve Studiu,
v Nastavení → Paměť, výslovně povolit ukládání a pokračovat. Historická data
se touto opravou nemažou ani se nastavení samo nepřepíná.

`memory.saveContext=false` vypne automatickou legacy paměť/učení a použití
uloženého projektového kontextu; historie konverzace se ukládá samostatně.
`c3.memory.ltmEnabled`, `learningEnabled`, `feedbackDetection` a
`patternTracking` omezují odpovídající čtení/učení při každém požadavku.
Automatická paměť má oddělené namespace pro projekty; bez projektu se váže
na konverzaci. Staré nescopované LTM záznamy zůstávají v databázi, ale do
nových chatových kontextů se nepřebírají. Explicitní M4 návrhy a jejich
schvalování mají vlastní kontrakt; tyto přepínače nejsou univerzální mazání.

### Kompatibilita názvů po aktualizaci Studia

Kanonické prostředí používá `INTENTSMITH_*`, adresář `intentsmith-ide` a nové klíče nastavení `intentsmith.*`. Backend přijímá staré proměnné `C3_*` jako fallback; explicitní nová hodnota má přednost. Existující instalace nad `data/c3.db` zůstává na stejné databázi. Migrace 115 zachová původní nastavení; Studio převádí lokální klíče při načtení bez mazání původních. Staré licenční klíče, lokální capability a WebSocket alias zachovávají totožnou kontrolu autority. Historické důkazy a názvy externích repozitářů se nemění.
