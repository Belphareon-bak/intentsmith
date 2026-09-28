# Návrh — nástroje v obchodě (git, bash, Python, Docker…)

Stav: **NÁVRH K DISKUSI**, mimo rozsah WP-STUDIO-2. Nezakládá požadavek
(CLAUDE.md „Co vznikne během běhu, není autorita").

## Problém

Agenti a specialisté potřebují programy, které IntentSmith nemá a mít nemá:
git, bash, Python, Docker, Node, SDK. Dnes:

- `src/setup/development-environment.js` zjišťuje, co je na stroji;
- `/api/development/*` (migrace 117) umí řízeně instalovat **npm závislosti
  projektu** a **.NET SDK** — přesný plán, digest, `ask`/`automatic`/`disabled`,
  ověřený SHA-512, bez sudo, bez změny PATH, audit;
- shell nástroje hlídá `validateCommand()` s pevným whitelistem binárek
  (`src/executor/shell-security.js`);
- obchod zná jen `skill`, `expertise`, `specialist`.

Chybí jednotný způsob, jak říct „tenhle specialista potřebuje Python 3.11" a
jak takový program bezpečně zpřístupnit.

## Návrh: čtvrtý typ balíčku `toolchain`

Deklarativní manifest, **žádný vlastní kód** v balíčku. IntentSmith podle něj
zjistí přítomnost, případně nainstaluje stávající řízenou cestou a zpřístupní
nástroje pod stávající autoritou.

```json
{
  "type": "toolchain",
  "id": "python",
  "version": "1.0.0",
  "provides": {
    "binaries": ["python3"],
    "tools": ["python.run", "python.venv"],
    "capabilities": ["runtime.python"]
  },
  "detect": {
    "argv": ["python3", "--version"],
    "pattern": "Python (\\d+\\.\\d+\\.\\d+)",
    "min": "3.10"
  },
  "install": {
    "linux-x64": {
      "strategy": "verified-archive",
      "url": "https://github.com/astral-sh/python-build-standalone/releases/download/…",
      "sha512": "…",
      "target": "toolchains/python/3.12.7"
    },
    "fallback": { "strategy": "system-package", "apt": ["python3", "python3-venv"], "dnf": ["python3"] }
  },
  "effects": { "network": [], "filesystem": ["project"] },
  "shell": { "allow": ["python3"], "denyArgs": ["-c"] },
  "defaults": { "install": "ask", "use": "ask" }
}
```

### Tři instalační strategie

| Strategie | Kdy | Co IntentSmith dělá |
|---|---|---|
| `detect-only` | git, bash, coreutils — na Linuxu prakticky vždy | jen zjistí verzi a ukáže stav; nic neinstaluje |
| `verified-archive` | přenosné runtime: Python standalone, Node, .NET (už existuje), Go | stáhne z pevné oficiální URL, ověří SHA-512, rozbalí do `~/.local/share/intentsmith/toolchains/<id>/<verze>`; volá se absolutní cestou, PATH ani profil shellu se nemění |
| `system-package` | Docker, systémové knihovny, cokoli s démonem nebo sudo | **nikdy sám**; ukáže přesný příkaz pro uživatele (`sudo apt install …`) a po instalaci znovu zjistí stav |

Docker je vždy `system-package` + `detect-only`: démon, skupina `docker` a
práva roota nejsou věc, kterou má aplikace řešit. Použití `docker` příkazů
pak jde přes schválení po třídách (build, run, pull = síť).

### Jak se balíček zapojí

1. **Obchod › Nástroje** ukazuje stav každého toolchainu (nalezeno, verze,
   chybí, instalovatelné) z `/api/development/environment`.
2. Specialista, skill nebo worker deklaruje `requires: ["toolchain:python>=3.10"]`.
   Instalace balíčku ověří požadavky existujícím dependency managementem obchodu
   a chybějící nabídne k instalaci.
3. Nainstalovaný toolchain **rozšíří whitelist** `validateCommand()` o své
   binárky (jen absolutní cesty, jen povolené argumenty) a zpřístupní své nástroje
   v registru — pod stávající effect autoritou (L0-11) a M5 pro síť (L0-12).
4. Politika per toolchain: `install` a `use` s hodnotami `ask` / `automatic` /
   `disabled`, výchozí `ask`; `automatic` jen přes vlastní endpoint s CAS revizí.

### Pořadí zavedení

1. **Detekce a zobrazení:** `detect-only` balíčky git, bash, python3, docker,
   node v Obchodě; žádná instalace, žádná změna oprávnění.
2. **`requires` u specialistů:** blokující kontrola při instalaci a spuštění,
   s návodem, co chybí.
3. **`verified-archive`:** Python standalone a Node rozšířením stávajícího
   instalátoru (.NET už funguje stejně).
4. **Whitelist a nástroje:** vazba nainstalovaného toolchainu na shell a registr.

### Otevřené otázky pro operátora

- Smí katalog toolchainů přicházet z online katalogu C3studio, nebo jen
  z lokálně přibaleného seznamu (menší riziko podvržené URL a hashe)?
- Má `automatic` u instalace toolchainu vůbec existovat, nebo vždy `ask`?
- Git v 1.0: stačí `detect-only` (je vždy), a správa zdrojů Studia 2 ho
  jen použije?
