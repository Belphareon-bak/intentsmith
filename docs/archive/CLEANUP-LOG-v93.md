# Documentation Cleanup Log — v93.0.0

**Datum:** 2026-03-04
**Duvod:** Kompletni audit dokumentace — odstraneni zastaralych, nefunkcnich a redundantnich souboru.

Vsechny smazane soubory jsou recoverable z git historie (`git log --diff-filter=D -- docs/soubor.md`).

---

## 1. Smazane soubory (stale, nefunkcni)

| Soubor | Duvod smazani |
|--------|---------------|
| `docs/openapi.yaml` | Popisoval 8 endpointu "Agent Daemon" API z v47 — zadny neexistuje. Skutecne API ma ~200 endpointu ve 14 route modulech. Kompletne nerelevantni. |
| `docs/golden-path.md` | Odkazoval na `src/golden/`, `src/contracts/` — adresare neexistuji od ~v55. Architektura Golden Path nahrazena CRE → ChatController → handlers. |
| `docs/architecture-simple.md` | Odkazoval na `src/unification/`, `src/chat/cre-v2.js`, `src/tools/registry.js` — neexistujici soubory. Redundantni s ARCHITECTURE.md. |

## 2. Smazane soubory z archive/ (nahrazeno aktualni dokumentaci)

| Soubor | Velikost | Nahrazeno |
|--------|----------|-----------|
| `docs/archive/C3-Agent-Roadmapa-v57.md` | 13 KB | ROADMAP.md v16 |
| `docs/archive/C3-Agent-Finalni-Roadmapa.md` | 11 KB | ROADMAP.md v16 |
| `docs/archive/C3-Agent-Roadmapa-v2.md` | 30 KB | ROADMAP.md v16 |
| `docs/archive/C3-Agent-Roadmapa-v3.md` | 22 KB | ROADMAP.md v16 |
| `docs/archive/C3-Agent-Roadmapa-v4.md` | 14 KB | ROADMAP.md v16 |
| `docs/archive/AGENT-DESIGN-v57.md` | 9 KB | WORKERS.md |
| `docs/archive/C3-Merge-Engine-v2-deltapatch.md` | 12 KB | C3-Merge-Engine-v2-FINAL.md |
| `docs/archive/EXPERTS, SPECIALISTS & WORKERS.md` | 83 KB | EXPERTISES.md + SPECIALISTS.md + WORKERS.md |
| `docs/archive/CHAT-QUALITY-ROADMAP.md` | 19 KB | Quality Gate v2 implementovan, chat-quality-definition.md |
| `docs/archive/CHAT-QUALITY-v62.md` | 10 KB | Historicke test vysledky z v62, aktualne 2600+ testu |

**Ponechano v archive/:**
- `ROADMAP-HISTORICAL.md` — kompletni faze 1-8, architekturni evoluce projektu
- `c_3_versions_45_to_55_summary.md` — prechod z prompt-driven na deterministicky system

## 3. Prepsane soubory

| Soubor | Zmena |
|--------|-------|
| `docs/dev-checklist.md` | Kompletni prepis — puvodni odkazoval na neexistujici `src/contracts/`, `src/golden/`, `src/tools/registry.js`. Novy odkazuje na aktualni architekturu. |
| `docs/README.md` | Prepsan z v86 na v93 — nova struktura projektu, kompletni test reference, API tabulka, rozsireny doc index (27 odkazu). |

## 4. Aktualizovane version reference

| Soubor | Stara verze | Nova verze |
|--------|-------------|------------|
| `docs/INSTALL.md` (header) | v86.0.0 | v93.0.0 |
| `docs/INSTALL.md` (footer) | v78.0.0 | v93.0.0 |
| `docs/WORKERS.md` | v78.0.0 | v93.0.0 |
| `docs/ARCHITECTURE.md` | v90.0.0 | v93.0.0 |
| `docs/ROADMAP.md` | "dnes (v86)" | "dnes (v93)" |

## 5. Minor fixy

| Soubor | Zmena |
|--------|-------|
| `docs/SPECIALISTS.md` | Opravena nekonzistence: D5 tabulka rikala "CHYBI" ale text nize "D5 ✅ (v91)" |
| `docs/OPERABILITY.md` | Header "v40.x+" → "v40+" (stale OK — zakladni kontrakty se nezmenily) |
| `docs/AUTHORITY.md` | Header "v40-v64" → "v40+" |

## 6. Ponechane beze zmeny (rozhodnuti)

| Soubor | Duvod ponechani |
|--------|-----------------|
| `docs/conversations/01-devops-sre.md` | D6 strategy priklad — muze slouzit jako reference |
| `docs/conversations/02-legal.md` | D6 strategy priklad |
| `docs/conversations/03-business-strategy.md` | D6 strategy priklad |
| `docs/Phase-F-README.md` | Packaging dokumentace — castecne zastarala ale stale relevantni koncepcne |

---

## Recovery

```bash
# Obnoveni smazaneho souboru z git historie:
git show HEAD~1:docs/openapi.yaml > docs/openapi.yaml

# Zobrazeni smazanych souboru v poslednim commitu:
git diff --name-only --diff-filter=D HEAD~1 HEAD

# Obnoveni vsech smazanych souboru:
git checkout HEAD~1 -- docs/openapi.yaml docs/golden-path.md docs/architecture-simple.md
```
