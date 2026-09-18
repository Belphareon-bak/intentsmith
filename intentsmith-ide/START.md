# 🚀 Jak začít s vývojem IntentSmith IDE

## Krok 1: Otevřít projekt ve VS Code

### Možnost A - Workspace (doporučeno)
```bash
cd C:\Users\geofe\git\projects\IntentSmith-agent\intentsmith-ide
code intentsmith-ide.code-workspace
```

### Možnost B - Přímo složku
```bash
code C:\Users\geofe\git\projects\IntentSmith-agent\intentsmith-ide
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
intentsmith-ide/
├── applications/electron/     # Electron app
├── extensions/               # Theia extensions (zde je UI)
│   ├── intentsmith-chat-panel/       # Chat panel (pravý panel)
│   ├── intentsmith-agent-panel/      # Agent log (spodní panel)
│   ├── intentsmith-center-views/     # Střední oblast (experts, projects)
│   ├── intentsmith-detail-panel/     # Detail panel
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

Výjimka: `extensions/intentsmith-chat-panel/lib/` je současný ručně udržovaný
autoritativní runtime. Jeho starý TypeScript prototyp je pouze v
`../docs/archive/intentsmith-studio/intentsmith-chat-panel-ts-prototype/` a nesmí se kompilovat
zpět do produktu. Současné UI navíc není finální vizuální baseline.

Po změně:
1. Ctrl+C (ukončit running app)
2. `yarn build`
3. `yarn start`

Nebo použijte `yarn watch` pro auto-rebuild ostatních aktivních extension
sources; package-level watch `@intentsmith/chat-panel` je záměrně blokovaný.
