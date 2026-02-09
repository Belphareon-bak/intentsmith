# C3 IDE — Changelog (Unified Package)

## v3.1 — Revize a konsolidace (2026-02-09)

### Opravy roadmapu

1. **SQLite FTS5 → In-memory index (Sprint 6)**
   - Roadmap aktualizován: FTS5 je budoucí migrace, MVP používá in-memory inverted index
   - Protokol je identický — swap je čistý

2. **curl handling přesunut ze Sprint 2 do Sprint 7**
   - Sprint 2 roadmap odkazuje na Sprint 7 (kde je curl implementován s per-command arg blacklistem)
   - Sprint 2 ALLOWED_COMMANDS neobsahuje curl/wget

3. **Agent Terminal delegace (Sprint 2 → Sprint 3)**
   - Přidána implementační poznámka v roadmap Sprint 2
   - Dedicated agent terminal se vytváří v Sprint 3 (s Command Palette a notifikacemi)

4. **Sprint 0/0.5 dokumentace**
   - Přidány stub README pro Sprint 0 a Sprint 0.5
   - Přidána poznámka v roadmapu, že jsou prerekvizity součástí base projektu

5. **Sprint 6 keybinding fix**
   - `Ctrl+Shift+P → Přepnout projekt` opraveno na `Ctrl+Shift+W` (kolize s Command Palette)

6. **Sprint 2 ALLOWED_COMMANDS rozšíření**
   - Přidány: `sort`, `uniq`, `tr`, `sed` (odpovídá implementaci)

7. **Sprint 6 Token Dashboard rozšíření**
   - Přidány: cost estimation, model breakdown, daily sparkline (odpovídá implementaci)

### Strukturální opravy

8. **Sprint 1: Odstraněna duplicitní flat struktura**
   - Ponechána pouze `packages/` verze (konzistentní s ostatními sprinty)
   - `ws-server.test.js` přesunut do `packages/c3-backend/`
   - README sjednocen do jednoho souboru

### Beze změny

- Všechny implementační soubory (TypeScript, CSS, TSX) — beze změny
- Všechny test soubory — beze změny
- Architektonické kontrakty — beze změny (všechny ověřeny jako dodržené)
