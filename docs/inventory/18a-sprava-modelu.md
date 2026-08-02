# Inventura #18a — Správa modelů

**Schopnost:** #18a (pořadí 4) · **Datum:** 2026-08-02 · **Commit:** `17a8b9a8`
**Vznik:** rozdělením #18 rozhodnutím operátora, inventura #1 `N-1`

> `CONTRACT.md` §3 krok 1. Popisuje stav, nerozhoduje.

## 1. Rozsah

| Soubor | Řádků |
|---|---:|
| `src/upgrade/model-profiles.js` | 272 |
| `src/upgrade/model-registry.js` | 572 |
| **Celkem** | **844** |

Plus podmnožina rout ze `system.js` — `models`, `models/info`,
`models/compatibility`, `models/check`, `models/overview`, `models/pull`,
`DELETE models`.

## 2. Naměřeno

| | |
|---|---|
| `model-upgrade.test.js` | **58 passed** (pokrývá profily i registry) |
| `model-ctx.test.js` | **6 passed** |
| Za běhu bez Ollamy | `Discovered 0 local + 0 catalog + 0 L4 = 0 candidates, 3 hints`, `ollamaAvailable: false` — čistá degradace |
| Inicializace kontextu modelu | `qwen3.5:27b → num_ctx=8192` z `{declaredCtx: null, vramNumCtx: null}` — fallback funguje |

**Veřejné API `model-profiles.js`:** `MODEL_FAMILIES`, `MODEL_PROFILES`,
`parseModelName()`, `getAllProfiles()`, `getProfile(role)`,
`getCurrentBindings()`, `isSameFamily()`, `isNewerVersion()`.

## 3. Seznam 1 — dobré, použije se

| Co | Proč |
|---|---|
| **Vazba role → model je explicitní a deterministická** | `getProfile(role)` a `getCurrentBindings()`. Žádná část systému si model nevybírá sama; ptá se profilu. To je předpoklad pro to, aby #3 (gateway) mohl fungovat. |
| **`parseModelName()` + `isSameFamily()` + `isNewerVersion()`** | Rozumí `qwen3.5:27b` jako rodině, verzi a velikosti. Čisté funkce, snadno testovatelné. |
| **VRAM fit a `num_ctx` odvození** | Kontext se odvozuje z VRAM s fallbackem, ne natvrdo. Ověřeno v logu při startu. |
| **Degradace bez Ollamy** | Registry i discovery vrátí prázdno a systém běží dál. |
| **Test pokrytí** | 58 asercí, profil `offline` — tedy uvnitř deterministického rozsahu. Na rozdíl od CRE jde tuhle schopnost ověřit bez modelu. |

## 4. Seznam 2 — zbytečné

Nic. 844 řádků, obojí zapojené a pokryté.

## 5. Seznam 3 — nejasné

| # | Zjištění | Otázka |
|---|---|---|
| **M-1** | **Kód fyzicky leží v `src/upgrade/`**, ale schopnost je nově v základu, zatímco zbytek adresáře (18b) je mimo. Adresář neodpovídá rozdělení. | Přesunout do `src/models/`, nebo nechat a rozlišovat jen v dokumentaci? |
| **M-2** | **`model-upgrade.test.js` (58 asercí) pokrývá 18a i 18b dohromady.** Sada nerozlišuje, co je základ a co nadstavba. | Rozdělit sadu podle nového řezu, nebo nechat společnou? |
| **M-3** | **`model-registry.js` (572 ř.) má jen jeden export** — singleton `modelRegistry`. Vnitřní API není z venku vidět. | Je to záměr (zapouzdření), nebo to komplikuje testování jednotlivých částí? |

## 6. Co inventura nenašla

- Žádné automatické stahování ani upgrade modelu v této části — to je celé v 18b.
- Žádné síťové volání: síťoví klienti (`whatllm-client`, `registry-client`,
  `online-discovery`) jsou v 18b, ne zde. **18a je offline.**
