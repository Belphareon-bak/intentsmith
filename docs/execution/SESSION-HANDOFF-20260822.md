# Handoff 2026-08-22

**Větev:** `claude/gate1-mobile-app-progress-5sywlt`, tip `fbbe1e74`
**Nepushnuto.** Strom čistý.

## Co se dnes stalo, v pořadí

1. **M0 uzavřeno a M1 má všech sedm povinných scénářů** (`5cceed64`, 12:07).
   `studio-electron-boundary` vrací `STUDIO_ELECTRON_BOUNDARY_PASS`.
2. **Gate 1 fronta, položky 1–5** — 023, 022, rezervace migrací, 020 a 015.

## Nález, který stojí za zapamatování

`electron-exited-before-cdp` **nebyl D-Bus ani network namespace**. Chromium si
v `TMPDIR` zakládá unix domain sockety a `sun_path` má tvrdý limit 108 bajtů;
runtime root pod `.intentsmith-artifacts` má na téhle stanici 95 znaků, takže na
jméno socketu zbylo 13 z potřebných ~30. `TMPDIR=/tmp` běží, 95 znaků padá,
16 znaků (mode 0700) běží. **Délka závisí na tom, kde repozitář leží** — proto to
jinde mohlo projít. D-Bus hláška v logu byla falešná stopa: objeví se jen uvnitř
namespace a bez něj sada padá bez ní.

## Stav Gate 1 fronty

| # | Položka | Stav | Commit |
|---|---|---|---|
| 1 | 023 VRAM delete race | hotovo | `51936ee1` |
| 2 | 022 operation-bound recovery | hotovo | `05b6c44b`, `c0a0340f` |
| 3 | rezervace migrací | hotovo | `2013e522` |
| 4 | 020 policy storage | hotovo | `b9731302` |
| 5 | 015 proof ↔ artefakty | hotovo | `6368bd2f` |
| 6 | 021 built journey | **další v pořadí** | — |
| 7 | autorizovaný GPU pilot | jen na akci operátora | — |

## Čísla, ne dojmy

Deterministický gate na `fbbe1e74`: `{"PASS":229,"FAIL":3,"BLOCKED":2}`, 234 sad.
Tři selhání jsou předchozí a prostředím podmíněná — `nightly-audit-runner-self-test`
(čeká blocker `toolchain:x11-display`), `nightly-orchestrator-self-test`
(`BLOCKED` řádky s `required:true`) a `vram-coordination` (GPU/prostředí).
Shodné s baseline před sérií.

## Co je vědomě nedodělané

- **015 je rozdělené.** Vazba proofu na artefakty a striktní expiry hrana jsou
  hotové. Vlastní issuance, prahy a terminal activation zůstávají blokované, tedy
  B3 a B4 jsou dál pravdivě `BLOCKED`.
- **Behaviorální test aktivace přesně v milisekundě expiry nevznikl.** Potřebuje
  úplný episode fixture a několik dřívějších guardů by se ozvalo dřív než
  porovnání expiry, takže by test tvrdil něco jiného, než by se zdálo. Hrana je
  připnutá na SQL úrovni, kde je jednoznačná. Patří k WP proof issueru.
- **L3 čísla M1**: p95 deterministiky drží (40–49 ms). Chybí p95 modelového
  chatu, throughput a refinement delta.
- **B5 `WP-M1-QUALITY`** nezačato — běží až po přijetí CHAT, MODEL a STUDIO.

## Kandidát na finding, který jsem nezaložil

`scripts/run-model-failover-candidate-measurement.js` drží `CANDIDATE_SOURCE_PATHS`
jako ručně udržovaný jmenovitý seznam blobů pro child export. Když modul v tom
grafu získá nový import, child padne na `Cannot find module` a projeví se to jako
šest nesouvisejících selhání. **Stalo se to dnes podruhé** — 21. 8. u
`src/db/user-settings.js`, dnes u `src/db/model-policy.js`. Odvodit ten seznam
z tranzitivní uzávěry místo ruční údržby by tuhle past zavřelo. Bylo to mimo
rozsah 015 i 020, tak jsem to neopravoval.

## Pasti, na které jsem narazil

- **Gate ukáže to, co focused běhy neukážou.** Dnes šest sad, všechny důsledek
  přesunu autority. Nespoléhej na focused zelenou.
- **Ratchet writer vyžaduje čistý strom.** `--write-baseline` musí jít až po
  commitu zdrojů; pořadí je commit → writer → commit baseline.
- **Tři census se srovnávají ručně a vědomě**: README (počet a `ACTIVE`),
  `module-boundary-ratchet` (`--accept-edge` jmenovitě) a
  `harness-exit-code` (database-reachable inventář).
- Po background úloze se `cwd` vrátí na `Projects` — relativní cesty pak míří
  mimo repo.
