# C.3 - AI Agent System

<p align="center">
  <img src="https://img.shields.io/badge/version-34.3.2-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/status-beta-orange.svg" alt="Status">
</p>

**C.3** je lokální AI copilot pro vývoj software a generování dokumentů. Využívá hierarchický multi-model workflow, sémantický intent classifier a artifact pipeline pro generování PDF, XLSX a dalších souborů.

---

## 🎯 Vize

Vytvořit AI asistenta, který:

1. **Generuje kvalitní kód** - Multi-model workflow s dvojitým review
2. **Vytváří dokumenty** - PDF, XLSX, CSV s validací a metadata
3. **Učí se z projektů** - Memory Bank pro persistentní znalosti
4. **Běží lokálně** - Žádné API klíče, plná kontrola nad daty
5. **Rozšiřitelný** - Agenti, notifikace, scheduler (roadmap)

---

## 🆕 Co je nového ve v34.x

### Artifact Pipeline (v34.2+)
- **Sémantický intent classifier** - Rozpoznává záměr, ne jen klíčová slova
- **Data confidence contract** - Metadata o kvalitě dat (high/medium/low)
- **Graceful degradation** - Nikdy prázdná odpověď
- **Skutečné PDF** - Puppeteer renderer (volitelné)
- **Coverage rules** - Automatické pokrytí všech generací produktů

### UI Vylepšení (v34.3+)
- **Light/Dark theme** - Plně funkční přepínání
- **Pravý sidebar** - Settings, notifikace, lokalizace
- **Locale enforcement** - Měna, jazyk, region v artefaktech

---

## 🏗️ Architektura

### Workflow Engine

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                                  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   INTENT CLASSIFIER     │
                    │   (Hybrid: Pattern+LLM) │
                    └────────────┬────────────┘
                    │                         │
              ARTIFACT                      CHAT
                    │                         │
                    ▼                         ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│    ARTIFACT PIPELINE        │   │    CHAT WORKFLOW            │
│  • Locale context           │   │  • D1 → CODE → R2 → R1     │
│  • LLM data extraction      │   │  • Multi-model review       │
│  • PDF/XLSX generation      │   │  • Memory Bank              │
│  • Confidence metadata      │   │  • TODO tracking            │
└─────────────────────────────┘   └─────────────────────────────┘
```

### Intent Classification (v34.3+)

```
USER MESSAGE
    ↓
1. CACHE CHECK        ← Instant return if cached
    ↓
2. HEURISTIC PATTERNS ← High-confidence (≥90%)
    ↓
3. SEMANTIC ANALYSIS  ← Count indicators
    ↓
4. LLM FALLBACK       ← Only if uncertain
    ↓
FINAL INTENT + CONFIDENCE
```

| Intent | Příklady |
|--------|----------|
| `FILE_REQUEST` | "vygeneruj pdf", "chci stáhnout", "exportuj" |
| `REPORT_REQUEST` | "udělej přehled", "srovnej ceny", "analýzu" |
| `TABLE_REQUEST` | "jako tabulku", "do excelu", "spreadsheet" |
| `CONFIG_REQUEST` | "konfigurační soubor", "json pro..." |
| `CHAT` | "co je to", "vysvětli", "jak funguje" |

### Model Role Assignments

| Role | Model | Účel |
|------|-------|------|
| THINKER | qwen2.5:32b | Analýza, plánování |
| ANALYZER | qwen2.5:32b | Rozklad požadavků |
| D1 | qwen2.5:32b | Chief Architect |
| D2 | qwen2.5-coder:32b | Fix Designer |
| CODE | qwen2.5-coder:32b | Implementace |
| R2A | qwen2.5:32b | Intent review |
| R2B | deepseek-r1:32b | Adversarial review |
| CHAT | qwen2.5:32b | Konverzace |

---

## 📦 Instalace

### Prerekvizity

- **Node.js** >= 20.0.0
- **Ollama** nainstalovaný a běžící
- **GPU** s min 24GB VRAM (doporučeno)

### Krok 1: Nainstalujte Ollama modely

```bash
ollama pull qwen2.5:32b
ollama pull qwen2.5-coder:32b
ollama pull deepseek-r1:32b

# Ověřte
ollama list
```

### Krok 2: Naklonujte a nainstalujte

```bash
git clone https://github.com/your-username/c3-agent.git
cd c3-agent
npm install

# Volitelné: Pro skutečné PDF
npm install puppeteer
```

### Krok 3: Spusťte

```bash
node src/server.js
```

Server naběhne na `http://127.0.0.1:3335`

---

## 🎨 UI Rozhraní

### Hlavní chat (`/architect`)

- Levý sidebar: Projekty, konverzace
- Hlavní panel: Chat s AI
- Pravý sidebar: Settings (⚙️)

### Settings

| Sekce | Možnosti |
|-------|----------|
| **Location** | Město, země, měna, jazyk, časová zóna |
| **Notifications** | Kanály (In-App, Email, Telegram, Webhook), Tichý režim |
| **Appearance** | Light/Dark theme, accent color, font |
| **Models** | Role-model binding, temperature |
| **About** | Verze, diagnostika |

---

## 📄 Artifact Pipeline

### Příklad použití

```
"vygeneruj mi pdf s tabulkou RTX grafik"
```

**Výstup:**
```
✅ Soubor vygenerován

📄 Tabulka RTX grafických karet

| GPU | VRAM | Cena |
|-----|------|------|
| RTX 5090 | 32 GB | 70 000 - 85 000 Kč |
| RTX 4090 | 24 GB | 50 000 - 60 000 Kč |
| ... | ... | ... |

📊 Celkem řádků: 10
🎯 Kvalita dat: ⚡ Odhadovaná data

⬇️ [Stáhnout PDF: Tabulka RTX grafických karet]

📝 Poznámky:
- RTX 50xx - ceny jsou předběžné odhady
```

### Data Confidence

| Level | Význam | Badge |
|-------|--------|-------|
| `high` | Ověřená data | ✅ Ověřená data |
| `medium` | Odhad na základě trhu | ⚡ Odhadovaná data |
| `low` | Orientační/placeholder | ⚠️ Orientační data |

### Coverage Rules

Pipeline automaticky pokrývá:
1. **LATEST GENERATION** - Nejnovější produkty (i s nízkou jistotou)
2. **CURRENT MAINSTREAM** - Aktivně prodávané
3. **PREVIOUS GENERATION** - Used/bazaar

---

## 🔌 API Reference

### Hlavní Endpoints

| Method | Path | Popis |
|--------|------|-------|
| `GET` | `/architect` | Web UI |
| `POST` | `/api/chat` | Chat/Artifact request |
| `GET` | `/api/projects` | Seznam projektů |
| `GET` | `/api/conversations/:id` | Konverzace |
| `GET` | `/api/artifacts/:filename` | Download artifact |
| `GET` | `/api/settings` | User settings |
| `POST` | `/api/settings` | Update settings |
| `GET` | `/health` | Health check |

### POST /api/chat

**Request:**
```json
{
  "conversation_id": 1,
  "message": "vygeneruj pdf s cenami GPU",
  "project_id": null
}
```

**Response (Artifact):**
```json
{
  "response": "✅ Soubor vygenerován...",
  "artifact": {
    "type": "pdf",
    "title": "Přehled GPU",
    "downloadUrl": "/api/artifacts/prehled-gpu-123.pdf",
    "confidence": "medium",
    "htmlFallback": false
  }
}
```

---

## 🛠️ Konfigurace

### Locale Settings

```javascript
// V pravém sidebaru nebo přes API
{
  "location": {
    "city": "Praha",
    "country": "CZ",
    "timezone": "Europe/Prague",
    "currency": "CZK",
    "language": "cs"
  }
}
```

### Model Binding

```javascript
// src/config/role-model-binding.json
{
  "THINKER": "qwen2.5:32b",
  "CODE": "qwen2.5-coder:32b",
  "R2B": "deepseek-r1:32b"
}
```

---

## 📁 Struktura projektu

```
c3-agent/
├── src/
│   ├── server.js              # Unified HTTP server
│   ├── database.js            # SQLite database
│   ├── artifact-pipeline.js   # Artifact generation
│   ├── agents/
│   │   ├── api.js             # Agent API
│   │   ├── runner.js          # Agent runner
│   │   └── scheduler.js       # Cron scheduler
│   ├── ui/
│   │   └── architect/
│   │       ├── architect.html
│   │       ├── architect.css
│   │       └── architect.js
│   ├── llm/
│   │   └── client.js          # Ollama client
│   └── db/
│       └── init.js            # DB initialization
├── data/
│   ├── c3.db                  # SQLite database
│   └── artifacts/             # Generated files
├── package.json
└── README.md
```

---

## 🗺️ Roadmap

### ✅ Implementováno (v34.3.2)

- [x] Multi-model workflow (D1, D2, R1, R2, CODE)
- [x] Sémantický intent classifier
- [x] Artifact pipeline (PDF, CSV, XLSX)
- [x] Data confidence contract
- [x] Coverage rules
- [x] Graceful degradation
- [x] Puppeteer PDF renderer
- [x] Light/Dark theme
- [x] Locale enforcement
- [x] Memory Bank
- [x] 53 vestavěných nástrojů
- [x] SQLite persistence

### 🚧 V plánu

**v35.x: Agents System**
- [ ] Agent DSL schema
- [ ] Condition monitoring
- [ ] Triggers with edge detection
- [ ] Notification channels

**v36.x: Data Layer**
- [ ] Locale-aware data sourcing
- [ ] Price API integrations
- [ ] Real-time data feeds

---

## ⚠️ Známé limitace

1. **GPU požadavky** - Min 24GB VRAM pro plynulý běh
2. **PDF bez puppeteer** - Fallback na HTML
3. **Data accuracy** - LLM generuje odhady, ne real-time data
4. **Beta stav** - Očekávejte bugy

---

## 🤝 Přispívání

1. Fork repozitáře
2. Vytvořte feature branch (`git checkout -b feature/amazing`)
3. Commit změny (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing`)
5. Otevřete Pull Request

---

## 📄 Licence

MIT License - viz [LICENSE](LICENSE)

---

## 🙏 Poděkování

- [Ollama](https://ollama.ai) - Lokální běh LLM
- [Qwen](https://qwenlm.github.io) - qwen2.5 modely
- [DeepSeek](https://deepseek.com) - deepseek-r1 model
- [Puppeteer](https://pptr.dev) - PDF generování

---

<p align="center">
  <b>C.3 v34.3.2</b> - Your Local AI Copilot 🤖
</p>
