# Studio 2.0 — motivy a nastavení vzhledu

Stav: podklad k etapě S2-3 [WP-STUDIO-2](../wp/WP-STUDIO-2-20260925.md).
Zdroj barev: [`design/build-theme-css.py`](design/build-theme-css.py), výstup
[`design/tokens.css`](design/tokens.css).

## 1. Styly

Palety jsou převzaté z `chat-panel-module.js` (`_C_DEFAULT`, `_C_STUDIO`,
`_C_CLEAN`, `_brandLightC`, `_studioLightC`, `_cleanLightC`,
`_C_THEMES.matrix/japanese/midnight`, `_PRO_GLASS`, `_accentPalettes`,
`_bgPresets`). Změna je jen tam, kde by pomocný text vyšel pod kontrast 4,5:1
— tam `--faint` přechází na čitelnější odstín téže palety.

| Styl | Téma | Zvláštnosti |
|---|---|---|
| IntentSmith | tmavé, světlé | výchozí; zlatá a antracit |
| Studio | tmavé, světlé | fialový akcent; **barevné ikony sekcí** (konverzace jantar, projekty růžová, specialisté fialová, expertýzy tyrkys, workeři máta, obchod modrá, média fialová) |
| Clean | tmavé, světlé | vlastní akcent (8 předvoleb + vlastní) a pozadí (3 předvolby + vlastní, jen tmavé) |
| Matrix | jen tmavé | tapeta, sklo, řádkový overlay, písmo Share Tech Mono |
| Japanese | jen tmavé | tapeta, sklo, písmo Zen Kaku Gothic Antique, nadpisy Yuji Boku |
| Midnight | jen tmavé | tapeta, sklo, Inter |
| Nocturne | tmavé, světlé | navíc: paleta rodiny ShellSmith/SystemSmith |

Ikony sekcí jsou obrysové (SVG, `stroke`), žádné emoji. Barevné tóny nastavení
(`_settingsDesign` / `_designTone`) zůstávají u ikon kategorií ve všech stylech.

## 2. Tokeny

Každý styl definuje: `--s0…--s5` (plochy bg0–bg5), `--tx`, `--dm`, `--faint`,
`--bd1`, `--bd2`, `--accF`, `--acct`, `--accD`, `--accR`, `--acc-fg`, `--asa`,
`--ok`, `--warn`, `--bad`, `--info`, `--violet`, `--cyan`; styly s tapetou
navíc `--g0…--g3` (skleněné plochy) a `--gdim`. Kořen z nich skládá:

- `--text`, `--dim` — míchání podle **výraznosti textu** (třída `ti-0…ti-100`);
- `--acc`, `--acc-soft` — míchání podle **zvýraznění aktivních prvků** (`ai-10…ai-100`);
- skleněné plochy podle **průhlednosti** dlaždic, panelů a **ztlumení pozadí**
  (`ta-*`, `pa-*`, `bd-*`);
- hustota `den-*`, oddělení `sep-ramecky|sep-linky`, velikost písma `fs-10…fs-18`.

Komponenty nepoužívají žádnou pevnou barvu; jen tyto proměnné.

## 3. Převod uložených nastavení

Dnešní UI ukládá do `localStorage`. Nové UI starý klíč **přečte, převede a
ponechá** během souběhu voleb (návrat na Klasické Studio musí dál fungovat).
Po S2-7 zůstane převod dat, ale klasické UI se už nenačítá ani nenabízí.

| Dnes | Studio 2 |
|---|---|
| `intentsmith-theme-mode` (`intentsmith`, `studio`, `clean`, `matrix`, `japanese`, `midnight`) | styl |
| `intentsmith-settings.theme` (`dark`, `light`, `system`) | téma |
| `textIntensity` (0–100, výchozí 70) | výraznost veškerého textu |
| `activeInt` (10–100) | zvýraznění aktivních prvků |
| `fontSizeVal` (10–18) | velikost písma |
| `fontIdx` (IntentSmith Sans, Inter, Systémové) | rodina písma |
| `accentIdx`, `custom1`, `custom2` | akcent stylu Clean |
| `bgIdx`, `bgCustom1`, `bgCustom2` | pozadí stylu Clean |
| `tileOpacity`, `bgDim`, `sidebarOpacity` | průhlednost dlaždic, ztlumení pozadí, panely |
| `visualMode` (`borders`, `lines`) | oddělení prvků |
| `autoCollapse` | sbalovat panely |
| `customCSS` | vlastní CSS; kořen nového UI nese i třídu `intentsmith-root`, takže dosavadní selektory platí |
| `intentsmith.appearance.density`, `intentsmith.appearance.uiScale` | hustota, měřítko rozhraní |
| `intentsmith-detail-width` | šířka detailu |
| `restoreSession`, `lastView` | obnova relací, poslední sekce |

## 4. Písma a obrázky — bez sítě

- Písma Inter, JetBrains Mono, Plus Jakarta Sans, Share Tech Mono, Zen Kaku
  Gothic Antique a Yuji Boku se přibalí do rozšíření (licence OFL) a načítají
  se přes `@font-face` z balíku. Žádné `fonts.googleapis.com` (L0-12; WP-M0-E
  zachytil pokus rendereru o tento požadavek).
- Tapety z `intentsmith-ide/themes/bg-*.jpg` (6144 × 4096, ~3 MB) se pro UI
  zmenší na 2400 × 1600 (≈150–250 kB); originály zůstanou.
