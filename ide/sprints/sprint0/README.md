# C3 IDE — Sprint 0: Theia Shell + Scaffold (7 dní)

## Stav: Prerekvizita — součást base projektu

Sprint 0 vytváří spustitelnou Theia instanci s C3 brandem. Výstupem je
monorepo root s Electron wrapperem, prázdnými C3 panely, a C3 dark theme.

## Co Sprint 0 dodává

- Spustitelná Electron app "C3 Studio"
- Prázdné panely: Chat, Agent Log (shell — naplní se v Sprint 1)
- Funkční: terminál (xterm.js), file tree, Monaco editor
- Odstraněné moduly: git, debug, SCM, marketplace, extensions panel
- C3 dark theme (accent color, status badge barvy)
- Layout persistence (`c3.layout.json`)
- Branding: název, ikona, about dialog

## Implementace

Sprint 0 je součástí base Theia monorepa:

```
c3-ide/
├── package.json              ← yarn workspaces root
├── tsconfig.json
├── applications/
│   └── electron/             ← Electron wrapper
│       ├── package.json
│       └── electron-main.ts
├── configs/
│   ├── theia.product.json    ← Branding
│   └── default-preferences.json
└── extensions/               ← Prázdné shelly (naplní se Sprint 1+)
```

## Theia packages — co nechat, co vyhodit

**NECHAT:** `@theia/core`, `@theia/editor`, `@theia/filesystem`, `@theia/terminal`,
`@theia/workspace`, `@theia/monaco`, `@theia/navigator`, `@theia/outline-view`,
`@theia/markers`, `@theia/preferences`, `@theia/electron`, `@theia/plugin-ext` (minimal)

**VYHODIT:** `@theia/git`, `@theia/debug`, `@theia/scm`, `@theia/search-in-workspace`,
`@theia/task`, `@theia/vsx-registry`, `@theia/getting-started`, `@theia/plugin-ext-vscode`

## Smoke test checklist

- [ ] App se spustí do 3 sekund
- [ ] File tree zobrazuje project directory
- [ ] Terminal funguje (echo, ls, cd)
- [ ] Chat panel je viditelný vpravo (prázdný)
- [ ] Agent panel je viditelný dole (prázdný)
- [ ] Panely se dají přesouvat drag & drop
- [ ] Theme vypadá konzistentně
- [ ] Keybindings fungují (Ctrl+`, Ctrl+B, Ctrl+J)
