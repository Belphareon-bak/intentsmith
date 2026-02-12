# C3 Studio v7 — Instalace V2

## 1. Zkopíruj soubory

```bash
# JS modul (všechno v jednom — sidebar, center views, detail panel, chat, agent log, status)
cp chat-panel-module-V2.js ~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js

# CSS theme (Theia chrome overrides — menubar, activity bar, tabs, status bar, right sidebar hide)
cp c3-theme.css ~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/styles/c3-theme.css
```

## 2. Smaž layout cache (POVINNÉ)

```bash
rm -rf ~/.config/"C3 Studio"/Local\ Storage
rm -rf ~/.config/"C3 Studio"/IndexedDB
rm -f ~/.config/"C3 Studio"/storage.json
```

## 3. Build & Run

```bash
cd ~/Projects/c3-agent-wip/c3-ide
yarn clean && yarn build && yarn start
```

---

## 4. Fonty (Plus Jakarta Sans + JetBrains Mono)

Electron nemá přístup ke Google Fonts CDN. Je potřeba bundlovat lokálně.

### Stažení fontů:

```bash
mkdir -p ~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/styles/fonts

# Plus Jakarta Sans
cd /tmp
wget "https://fonts.google.com/download?family=Plus+Jakarta+Sans" -O pjs.zip
unzip pjs.zip -d pjs
cp pjs/static/*.ttf ~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/styles/fonts/

# JetBrains Mono
wget "https://fonts.google.com/download?family=JetBrains+Mono" -O jbm.zip
unzip jbm.zip -d jbm
cp jbm/static/*.ttf ~/Projects/c3-agent-wip/c3-ide/extensions/c3-chat-panel/lib/browser/styles/fonts/
```

### Alternativně (rychlejší):

```bash
# Plus Jakarta Sans - Google Fonts direct
curl -L "https://github.com/nicokempe/plus-jakarta-sans/raw/main/fonts/ttf/PlusJakartaSans-Regular.ttf" -o fonts/PlusJakartaSans-Regular.ttf
curl -L "https://github.com/nicokempe/plus-jakarta-sans/raw/main/fonts/ttf/PlusJakartaSans-SemiBold.ttf" -o fonts/PlusJakartaSans-SemiBold.ttf
curl -L "https://github.com/nicokempe/plus-jakarta-sans/raw/main/fonts/ttf/PlusJakartaSans-Bold.ttf" -o fonts/PlusJakartaSans-Bold.ttf
curl -L "https://github.com/nicokempe/plus-jakarta-sans/raw/main/fonts/ttf/PlusJakartaSans-ExtraBold.ttf" -o fonts/PlusJakartaSans-ExtraBold.ttf

# JetBrains Mono
curl -L "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf" -o fonts/JetBrainsMono-Regular.ttf
curl -L "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Medium.ttf" -o fonts/JetBrainsMono-Medium.ttf
```

### Přidej do c3-theme.css (na začátek souboru):

```css
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-SemiBold.ttf') format('truetype');
  font-weight: 600;
  font-style: normal;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('./fonts/PlusJakartaSans-ExtraBold.ttf') format('truetype');
  font-weight: 800;
  font-style: normal;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./fonts/JetBrainsMono-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./fonts/JetBrainsMono-Medium.ttf') format('truetype');
  font-weight: 500;
  font-style: normal;
}
```

**Poznámka:** Webpack by měl .ttf soubory automaticky bundlovat (Theia používá css-loader + file-loader). Pokud ne, zkus přejmenovat na .woff2 a změnit `format('truetype')` na `format('woff2')`.

---

## 5. Terminál

Theia má built-in terminál. Otevření:

- **Klávesová zkratka:** `Ctrl+`` (backtick)
- **Menu:** Terminal → New Terminal
- **Command Palette:** `Ctrl+Shift+P` → "Terminal: Create New Terminal"

Terminál se otevře ve spodním panelu vedle Agent Logu.

Pro automatické otevření terminálu při startu přidej do chat-panel-module.js:

```javascript
// V C3StatusContrib.onStart() přidej:
const { TerminalService } = require("@theia/terminal/lib/browser/base/terminal-service");
// ... a v DI modulu:
// bind(TerminalService) a volej newTerminal()
```

Ale Theia terminál funguje i bez toho — stačí ho ručně otevřít přes menu.

---

## 6. Backend (C3 Agent)

Chat panel se připojuje na `localhost:3335`. Spusť backend:

```bash
cd ~/Projects/c3-agent-wip/c3-agent
node src/server.js
```

Po spuštění:
- Chat: zprávy se posílají přes WebSocket (`ws://localhost:3335/ws`) nebo HTTP POST (`/chat`)
- Status bar: zelený dot + "c3-backend-online" class na body
- Agent Log: bude se plnit živými logy z backendu (po napojení)

Pokud backend neběží, chat zobrazí "Backend nedostupný" — to je OK pro vývoj UI.

---

## Co je nové v V2

| Oblast | V1 | V2 |
|--------|-----|-----|
| Sidebar | ✅ funguje | ✅ stejné + window events pro center view |
| Center views | ❌ neexistovaly | ✅ Experti, Projekty, Konverzace, Specialisté, Workeri, Nastavení |
| Detail panel | ❌ neexistoval | ✅ 280px, tagy, akce, klíč-hodnota řádky |
| Chat | ✅ funguje | ✅ stejné |
| Agent Log | ✅ funguje | ✅ stejné |
| Activity bar | default Theia | ✅ CSS: blenduje se sidebarem, zelený accent |
| Right sidebar | default Theia | ✅ CSS: skrytý |
| Menubar | default Theia | ✅ CSS: tmavý, stylizovaný |
| Editor tabs | default Theia | ✅ CSS: zelený accent na aktivním tabu |
| Status bar | default Theia | ✅ CSS: C3 branding |
| Fonty | system fallback | 📋 instrukce pro lokální bundling |
| Terminál | neotvíral se | 📋 instrukce (Ctrl+`) |
