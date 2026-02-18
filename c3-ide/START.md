# 🚀 Jak začít s vývojem C3 IDE

## Krok 1: Otevřít projekt ve VS Code

### Možnost A - Workspace (doporučeno)
```bash
cd C:\Users\geofe\git\projects\C3-agent\c3-ide
code c3-ide.code-workspace
```

### Možnost B - Přímo složku
```bash
code C:\Users\geofe\git\projects\C3-agent\c3-ide
```

## Krok 2: Instalace závislostí (první spuštění)
```bash
yarn install
```

## Krok 3: Build
```bash
yarn build
# nebo stiskněte Ctrl+Shift+B ve VS Code
```

## Krok 4: Spuštění
```bash
yarn start
# nebo stiskněte F5 ve VS Code (debug mode)
```

## Krok 5: Development (watch mode)
```bash
yarn watch
# automaticky rebuildu při změnách
```

---

## 📁 Struktura projektu

```
c3-ide/
├── applications/electron/     # Electron app
├── extensions/               # Theia extensions (zde je UI)
│   ├── c3-chat-panel/       # Chat panel (pravý panel)
│   ├── c3-agent-panel/      # Agent log (spodní panel)
│   ├── c3-center-views/     # Střední oblast (experts, projects)
│   ├── c3-detail-panel/     # Detail panel
│   └── ...
├── configs/                  # Konfigurace
│   ├── default-preferences.json
│   └── theia.product.json
└── docs/                     # Dokumentace
```

---

## 🎨 Editace UI/Design

Pro změny vizuálu editujte:
- **Extensions** - `extensions/*/src/browser/*.tsx` (React komponenty)
- **Styly** - CSS soubory v `extensions/*/src/browser/styles/`
- **Témata** - `configs/default-preferences.json`

Po změně:
1. Ctrl+C (ukončit running app)
2. `yarn build`
3. `yarn start`

Nebo použijte `yarn watch` pro auto-rebuild.
