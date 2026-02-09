# C3 IDE — Sprint 0.5: LSP Validation Buffer (2 dny)

## Stav: Prerekvizita — risk mitigation sprint

Sprint 0.5 ověřuje, že LSP funguje s minimálním `plugin-ext` (bez `plugin-ext-vscode`).
Pokud LSP nefunguje, řeší se TEĎKA — ne v Sprint 3.

## Co Sprint 0.5 dodává

- LSP funguje pro Dart a TypeScript (hover, go-to-def, diagnostics)
- Dokumentovaný postup instalace LSP
- Rozhodnutí: `plugin-ext` (Varianta A) vs. vlastní LSP launcher (Varianta B)

## LSP Smoke Test

Pro každý jazyk ověřit:

```
Dart LSP:
  - [ ] Otevřít .dart soubor → syntax highlighting ✅
  - [ ] Hover na symbol → typ + dokumentace
  - [ ] Go to Definition (Ctrl+Click)
  - [ ] Diagnostics (červené podtržení chyb)
  - [ ] Autocomplete

TypeScript LSP:
  - [ ] Stejné checky jako Dart

Python LSP (nižší priorita):
  - [ ] Základní hover + diagnostics
```

## Varianty

**Varianta A (preferovaná):** `@theia/plugin-ext` s .vsix soubory
- Stáhnout Dart/TS extension .vsix
- Nainstalovat lokálně: `theia plugin install <ext>.vsix`

**Varianta B (fallback):** Vlastní LSP launcher
- `LanguageServerContribution` per jazyk
- Přímé spuštění: `dart language-server --protocol=lsp`

## Prerekvizity

- Sprint 0 hotový (Theia shell se spouští)
