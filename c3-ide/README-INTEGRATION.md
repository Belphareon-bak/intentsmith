# 🎨 C3 IDE - Tailwind + Aceternity UI Integration

## 📋 Přehled

Byl integrován **Tailwind CSS** + **Aceternity UI** styl do C3 IDE s **dual-mode systémem**:

- **Clean Mode** - Současný minimalistický design
- **Pro Mode** - Moderní glassmorphism s animacemi

---

## 🎯 Co je hotové

### ✅ Konfigurace (5 souborů)
1. `tailwind.config.js` - Tailwind konfigurace
2. `postcss.config.js` - PostCSS setup
3. `tailwind-plugins/glassmorphism.js` - Custom plugin
4. `extensions/c3-chat-panel/src/browser/styles/tailwind-base.css` - Base styles
5. `lib/utils/cn.ts` - Class name utility

### ✅ UI Komponenty (5 komponent)
1. `Button` - 5 variants
2. `Card` - 3 variants
3. `Badge` - 6 variants
4. `GlassCard` - Aceternity-style
5. `Input` - 2 variants

### ✅ Theme System (2 komponenty)
1. `ThemeSwitcher` - Přepínač Clean/Pro
2. `useThemeMode` - React hook

### ✅ Pro Mode Cards (3 karty)
1. `ExpertCardPro` - Expert card s glass efekty
2. `ProjectCardPro` - Project card s animacemi
3. `ConversationCardPro` - Conversation card

### ✅ VSCode Setup (5 souborů)
1. `.vscode/settings.json`
2. `.vscode/extensions.json`
3. `.vscode/launch.json`
4. `.vscode/tasks.json`
5. `c3-ide.code-workspace`

---

## 🚀 Jak začít

### 1. Otevřete projekt ve VS Code

```bash
cd C:\Users\geofe\git\projects\C3-agent\c3-ide
code c3-ide.code-workspace
```

### 2. Nainstalujte dependencies

Ve VS Code terminálu (Ctrl+`):

```bash
npm install -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
```

nebo

```bash
yarn add -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
```

### 3. Build projekt

```bash
yarn build
# nebo stiskněte Ctrl+Shift+B
```

### 4. Spusťte C3 IDE

```bash
yarn start
# nebo stiskněte F5 pro debug mode
```

---

## 📚 Dokumentace

### Detailní návody:
- **[INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md)** - Kompletní integrace do existujícího kódu
- **[VISUAL-PREVIEW.md](./VISUAL-PREVIEW.md)** - Vizuální ukázka Clean vs Pro mode
- **[TAILWIND-SETUP.md](./TAILWIND-SETUP.md)** - Základní setup instrukce
- **[START.md](./START.md)** - Jak začít s vývojem

### Pro rychlý start:
1. Přečtěte si [START.md](./START.md) - základy
2. Nainstalujte dependencies (viz výše)
3. Přečtěte si [INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md) - integrace

---

## 🎨 Ukázky použití

### Theme Switcher
```tsx
import { ThemeSwitcher, useThemeMode } from '@c3/chat-panel/components/ThemeSwitcher';

function Settings() {
  const [mode, setMode] = useThemeMode('clean');
  return <ThemeSwitcher mode={mode} onChange={setMode} />;
}
```

### Glassmorphism Card
```tsx
import { GlassCard } from '@c3/chat-panel/components/ui';

<GlassCard hover shine glow>
  <h3>Modern Card</h3>
  <p>With glass effect!</p>
</GlassCard>
```

### Pro Mode Expert Card
```tsx
import { ExpertCardPro } from './components/ExpertCardPro';

<ExpertCardPro
  expert={{
    name: "Code Expert",
    emoji: "🤖",
    description: "AI coding assistant"
  }}
  onClick={() => selectExpert()}
/>
```

---

## 🎯 Struktura projektu

```
c3-ide/
├── tailwind.config.js              # Tailwind konfigurace
├── postcss.config.js               # PostCSS konfigurace
├── tailwind-plugins/
│   └── glassmorphism.js           # Custom plugin
├── lib/utils/
│   └── cn.ts                      # Utility funkce
├── extensions/
│   ├── c3-chat-panel/
│   │   └── src/browser/
│   │       ├── components/
│   │       │   ├── ui/            # UI komponenty
│   │       │   │   ├── Button.tsx
│   │       │   │   ├── Card.tsx
│   │       │   │   ├── Badge.tsx
│   │       │   │   ├── GlassCard.tsx
│   │       │   │   └── Input.tsx
│   │       │   └── ThemeSwitcher.tsx
│   │       └── styles/
│   │           └── tailwind-base.css
│   └── c3-center-views/
│       └── src/browser/components/
│           ├── ExpertCardPro.tsx
│           ├── ProjectCardPro.tsx
│           └── ConversationCardPro.tsx
└── .vscode/                       # VSCode konfigurace
```

---

## 🔧 Další kroky

Po dokončení instalace můžete:

1. **Integrovat do existujícího kódu**
   - Přidejte ThemeSwitcher do Settings
   - Použijte Pro Mode karty v Center Views
   - Nahraďte tlačítka za nové Button komponenty

2. **Customizovat design**
   - Upravte barvy v `tailwind.config.js`
   - Přidejte vlastní glassmorphism varianty
   - Vytvořte nové animace

3. **Přidat další komponenty**
   - Inspirace: [ui.aceternity.com](https://ui.aceternity.com)
   - Shadcn/ui komponenty
   - Custom komponenty

---

## ❓ Troubleshooting

### Problem: "yarn: command not found"
**Solution**: Použijte `npm` místo `yarn` nebo nainstalujte yarn globálně

### Problem: Tailwind classes nefungují
**Solution**:
1. Zkontrolujte import `tailwind-base.css`
2. Spusťte rebuild: `yarn clean && yarn build`

### Problem: TypeScript chyby
**Solution**: Restartujte TS server: `Ctrl+Shift+P` → "TypeScript: Restart TS Server"

---

## 📞 Další pomoc

Máte problém s integrací? Přečtěte si:
- [INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md) - detailní postup
- [VISUAL-PREVIEW.md](./VISUAL-PREVIEW.md) - vizuální ukázky

---

**Status**: ✅ Připraveno k použití po instalaci dependencies!
