# 🎨 Visual Preview - Clean vs Pro Mode

## 🔄 Theme Modes

### Clean Mode (současný)
- ✅ Minimalistický design
- ✅ Jednoduché barvy (bg0-bg5)
- ✅ Bez efektů, rychlý rendering
- ✅ Profesionální a čistý

### Pro Mode (nový) ✨
- ✨ **Glassmorphism** - průhledné karty s blur efektem
- ✨ **Gradient borders** - animované ohraničení
- ✨ **Hover efekty** - glow, shine, shadow
- ✨ **Smooth animations** - plynulé přechody
- ✨ **Modern colors** - accent highlights

---

## 📦 Components Preview

### Expert Card

#### Clean Mode
```
┌─────────────────────────┐
│ 🤖  Expert Name         │
│ Description text here   │
│                         │
│ #tag1  #tag2           │
│ ─────────────────────  │
│ Expert      Jan 15     │
└─────────────────────────┘
```

#### Pro Mode ✨
```
╔═════════════════════════╗ ← Gradient border
║ 🤖  Expert Name         ║ ← Glass backdrop
║ ░ Description text      ║ ← Blur effect
║                         ║
║ [tag1] [tag2]          ║ ← Glass badges
║ ═════════════════════  ║ ← Animated line
║ Expert      Jan 15     ║
╚═════════════════════════╝
    ↑ Glow on hover
```

---

## 🎯 Glassmorphism Variants

### `.glass`
- Background: `rgba(255,255,255,0.05)`
- Blur: 10px
- Border: subtle white

### `.glass-strong`
- Background: `rgba(255,255,255,0.1)`
- Blur: 16px
- Border: stronger white

### `.glass-card`
- Background: `rgba(255,255,255,0.03)`
- Blur: 12px
- Hover: transform + shadow
- Animated gradient line

---

## 🌈 Color System

### C3 Colors (zachované)
```css
--c3-bg0: #0c0c0f  /* Nejtmavší */
--c3-bg1: #111114
--c3-bg2: #18181c
--c3-bg3: #1f2025
--c3-bg4: #27282e
--c3-bg5: #2f3038  /* Nejsvětlejší */

--c3-accent: #22c55e  /* Zelená */
--c3-accent-text: #4ade80
```

### Pro Mode Enhancements
```css
/* Glow efekt */
box-shadow: 0 0 20px rgba(34,197,94,0.5);

/* Gradient border */
background: linear-gradient(135deg,
  rgba(34,197,94,0.5),
  rgba(34,197,94,0.1)
);

/* Glass blur */
backdrop-filter: blur(12px);
```

---

## 🎬 Animations

### Hover Animations
- **Card lift**: `translateY(-2px)` + shadow increase
- **Shine effect**: sliding gradient overlay
- **Glow pulse**: animated shadow expansion
- **Border gradient**: animated gradient position

### Loading States
- **Shimmer**: horizontal moving gradient
- **Pulse**: opacity fade in/out
- **Gradient flow**: rotating gradient background

---

## 📱 Responsive Design

Všechny komponenty jsou responsive:
- Min width: `280px`
- Max width: `320px`
- Grid: `auto-fill` s gap `12px`
- Mobile: stack vertically

---

## 🎨 Design Tokens

### Border Radius
- `sm`: 4px
- `md`: 6px
- `lg`: 8px
- Cards: 12px (Pro mode: 16px)

### Spacing
- Base unit: 4px
- Card padding: 24px
- Gap between items: 12px

### Typography
- Font: Plus Jakarta Sans (fallback: system)
- Mono: JetBrains Mono, Fira Code
- Sizes: 10px - 18px

---

## 🔧 Performance

### Clean Mode
- ✅ Žádné efekty = rychlý
- ✅ Jednoduchý CSS
- ✅ Menší bundle

### Pro Mode
- ⚠️ `backdrop-filter` (může být náročný)
- ✅ CSS animations (GPU accelerated)
- ✅ Optimalizované shadows
- ✅ Lazy loading komponent

**Tip**: Pro starší HW použijte Clean mode!

---

## 🎯 Use Cases

### Clean Mode vhodný pro:
- Pomalý hardware
- Jednoduchý workflow
- Konzervativní prostředí
- Minimální distrakce

### Pro Mode vhodný pro:
- Moderní prezentace
- Marketing/Demo
- Premium experience
- Kreativní práce

---

## 📸 Ukázka v kódu

### Před (Clean)
```tsx
<div className="c3-card">
  <h3>{expert.name}</h3>
  <p>{expert.description}</p>
</div>
```

### Po (Pro Mode)
```tsx
<GlassCard hover shine glow>
  <div className="flex items-center gap-3">
    <span className="text-3xl">{expert.emoji}</span>
    <h3 className="text-gradient">{expert.name}</h3>
  </div>
  <p className="text-c3-tx3">{expert.description}</p>
</GlassCard>
```

---

**Výsledek**: Profesionální, moderní UI s minimálními změnami v kódu! 🚀
