# Phase F: Balíčkování + Ochrana

**Testy:** 100/100 ✅

## Struktura

```
docker/
├── docker-compose.yml     # F1: C3 + Ollama + GPU + auto model pull
└── Dockerfile             # F1: Multi-stage build, non-root, healthcheck
src/
├── setup/wizard.js        # F2: Interactive CLI + HTTP API setup wizard
├── licensing/license.js   # F5: Offline HMAC license keys, hw fingerprint
└── packaging/auto-updater.js  # F3: GitHub release checker, download, backup, rollback
scripts/
└── obfuscate.js           # F4: javascript-obfuscator + bytenode pipeline
tests/
└── phase-f.test.cjs       # 100 testů
```

## Moduly

### F1: Docker deployment
- `docker compose up -d` → spustí C3 + Ollama + auto-pull modelů
- GPU passthrough (NVIDIA), persistent volumes, health checks
- Multi-stage Dockerfile: deps → build → production (non-root)

### F2: Setup wizard
- CLI: `node src/setup/wizard.js` — interaktivní průvodce
- API: `GET/POST /api/setup/*` — pro GUI nastavení
- Konfigurace: Ollama URL, jazyk, notifikace, licence
- Výstup: `c3-setup.json` + `.env` soubor

### F3: Auto-updater
- `checkForUpdates()` — GitHub Releases API
- `downloadUpdate()` + `applyUpdate()` s backup/rollback
- Background checker s konfigurovatelným intervalem
- Semver comparison (parseVersion, compareVersions)

### F4: Obfuskace
- `javascript-obfuscator` — AST transformace (control flow flattening, string encoding)
- `bytenode` — V8 bytecode kompilace
- Exclude: testy, wizard (pro troubleshooting)
- Build manifest s metadaty

### F5: Licenční systém
- **Offline-first** — žádný license server
- Hardware fingerprint: SHA256(hostname + platform + arch + CPU + RAM + MAC)
- Klíč: `C3-XXXXXXXX-XXXXXXXX-...` (hex-encoded payload + HMAC-SHA256)
- Tiers: FREE (1 projekt, bez agentů) / PRO (vše) / ENTERPRISE (multi-user)
- LicenseManager singleton s cache

### F6: Rate limiting
- Již implementováno v server.js (120 req/min/IP)
- Testy potvrzují správnou konfiguraci

## Kumulativní testy

| Fáze | Testy |
|------|-------|
| Q + A + D-int + B | 630 |
| C (projects) | 80 |
| **F (packaging)** | **100** |
| **Celkem** | **810** |
