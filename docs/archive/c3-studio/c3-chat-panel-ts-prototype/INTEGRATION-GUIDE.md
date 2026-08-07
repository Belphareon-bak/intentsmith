# 🎨 Tailwind + Aceternity UI Integration Guide

## ✅ Co bylo vytvořeno:

### 1. Konfigurace
- ✅ `tailwind.config.js` - Tailwind konfigurace s C3 barvami
- ✅ `postcss.config.js` - PostCSS config
- ✅ `tailwind-plugins/glassmorphism.js` - Custom glassmorphism plugin
- ✅ `extensions/c3-chat-panel/src/browser/styles/tailwind-base.css` - Base styles

### 2. Utility komponenty
- ✅ `Button` - 5 variants (default, ghost, outline, glass, glow)
- ✅ `Card` - 3 variants (default, glass, gradient)
- ✅ `Badge` - 6 variants (default, secondary, outline, success, warning, glass)
- ✅ `GlassCard` - Aceternity-style card s hover efekty
- ✅ `Input` - 2 variants (default, glass)

### 3. Theme System
- ✅ `ThemeSwitcher` - Přepínač mezi Clean/Pro režimem
- ✅ `useThemeMode` - React hook pro theme management

### 4. Pro Mode karty
- ✅ `ExpertCardPro` - Expert karta s glassmorphism
- ✅ `ProjectCardPro` - Project karta s animacemi
- ✅ `ConversationCardPro` - Conversation karta

### 5. VSCode Setup
- ✅ `.vscode/settings.json` - Editor konfigurace
- ✅ `.vscode/extensions.json` - Doporučená rozšíření
- ✅ `.vscode/launch.json` - Debug konfigurace
- ✅ `.vscode/tasks.json` - Build tasks
- ✅ `c3-ide.code-workspace` - Multi-root workspace

---

## 📦 KROK 1: Instalace dependencies

Otevřete VS Code terminál (`` Ctrl+` ``) v root složce projektu:

```bash
npm install -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge

# Nebo s yarn:
yarn add -D tailwindcss postcss autoprefixer @tailwindcss/typography clsx tailwind-merge
```

---

## 🔧 KROK 2: Import Tailwind CSS

### V hlavním CSS souboru:

Přidejte do `applications/electron/src/frontend/index.html` nebo hlavního CSS:

```html
<!-- V <head> -->
<link rel="stylesheet" href="../../extensions/c3-chat-panel/src/browser/styles/tailwind-base.css">
```

**NEBO** importujte v TypeScript entry pointu:

```typescript
// applications/electron/src/frontend/main.ts
import '../../extensions/c3-chat-panel/src/browser/styles/tailwind-base.css';
```

---

## 🎯 KROK 3: Použití ThemeSwitcher

### Přidejte do Settings nebo Sidebaru:

```tsx
import { ThemeSwitcher, useThemeMode } from '@c3/chat-panel/components/ThemeSwitcher';

function SettingsPanel() {
  const [themeMode, setThemeMode] = useThemeMode('clean');

  return (
    <div>
      <h3>Vzhled</h3>
      <ThemeSwitcher mode={themeMode} onChange={setThemeMode} />
    </div>
  );
}
```

---

## 🎨 KROK 4: Aktualizace Center Views

### Podmíněné renderování podle režimu:

```tsx
import { useThemeMode } from '@c3/chat-panel/components/ThemeSwitcher';
import { ExpertCardPro } from './components/ExpertCardPro';
import { ExpertCard } from './components/ExpertCard'; // současná verze

function CenterView() {
  const [themeMode] = useThemeMode();

  return (
    <div className="grid">
      {experts.map(expert =>
        themeMode === 'pro' ? (
          <ExpertCardPro key={expert.id} expert={expert} />
        ) : (
          <ExpertCard key={expert.id} expert={expert} />
        )
      )}
    </div>
  );
}
```

---

## 🚀 KROK 5: Build a spuštění

```bash
# Build
yarn build
# nebo Ctrl+Shift+B ve VS Code

# Spuštění
yarn start
# nebo F5 ve VS Code
```

---

## 💡 Příklady použití komponent

### Button

```tsx
import { Button } from '@c3/chat-panel/components/ui';

<Button variant="glass">Click me</Button>
<Button variant="glow" size="lg">Glowing button</Button>
```

### GlassCard

```tsx
import { GlassCard } from '@c3/chat-panel/components/ui';

<GlassCard hover shine glow>
  <h3>Title</h3>
  <p>Content with glass effect</p>
</GlassCard>
```

### Badge

```tsx
import { Badge } from '@c3/chat-panel/components/ui';

<Badge variant="glass">New</Badge>
<Badge variant="success">Active</Badge>
```

---

## 🎨 Glassmorphism utility classes

Použijte přímo v className:

```tsx
<div className="glass p-4 rounded-lg">Glass effect</div>
<div className="glass-card">Glass card with hover</div>
<div className="glass-strong">Stronger glass</div>
<div className="gradient-border">Gradient border</div>
```

---

## 🔍 Troubleshooting

### Tailwind classes nefungují
1. Zkontrolujte, že je `tailwind-base.css` importován
2. Spusťte rebuild: `yarn clean && yarn build`
3. Zkontrolujte, že `content` paths v `tailwind.config.js` jsou správné

### TypeScript errors
1. Restartujte TypeScript server: Ctrl+Shift+P → "TypeScript: Restart TS Server"
2. Zkontrolujte, že `lib/utils/cn.ts` existuje

### Pro mode se nezobrazuje
1. Zkontrolujte localStorage: `localStorage.getItem('c3-theme-mode')`
2. Ověřte, že `body` má class `theme-pro`

---

## 📚 Další kroky

Po dokončení integrace můžete:
1. Přidat další Aceternity komponenty (z [ui.aceternity.com](https://ui.aceternity.com))
2. Customizovat barvy v `tailwind.config.js`
3. Přidat vlastní glassmorphism varianty
4. Vytvořit animované backgrounds

---

**Máte problém?** Přečtěte si [TAILWIND-SETUP.md](./TAILWIND-SETUP.md)
