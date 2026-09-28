# WP-M3-L0-8-ENFORCEMENT — vynucení hranice specialistů

**Typ:** zapisující WP · **Slot:** paralelní vlastník, **efemérní worktree na disku**
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** nová session, writer 2 · integrátor
**Souběžný WP:** `WP-M1-BINDING-FINALIZE-RECOVERY` v hlavním checkoutu
**Vychází z:** [`019-l0-8-specialist-boundary`](../decisions/019-l0-8-specialist-boundary.md) ·
[`2026-08-07-L0-8-BOUNDARY`](../review/2026-08-07-L0-8-BOUNDARY.md) nález `L8-2`

Toto je zadání, ne stav. Stav je podle `CONTRACT.md §6` v `ROADMAP.md`.
Procesní rámec: [`2026-08-08-PARALLEL-PILOT`](../review/2026-08-08-PARALLEL-PILOT.md).

---

## 0. Vstupní brána

1. `git status` v hlavním checkoutu je **skutečně čistý**, ne jen čisté tracked
   cesty — jinak by worktree větvil ze stromu, který rozpracovanou práci
   neobsahuje.
2. Rozhodnutí 019 je commitnuté.
3. Operátor potvrdil odpověď na JSDoc podotázku z 019 (§ „Otevřená podotázka").
   Bez ní checker neví, co je porušení. **Toto je jediná tvrdá závislost.**
4. Kořen worktree je **na disku**, ne v `/tmp` — ten je zde tmpfs.

```bash
git worktree add ~/worktrees/is-l0-8-enforcement -b wp/l0-8-enforcement 0a6bde54
```

## 1. Uživatelský výsledek

Import ze specialistova balíčku do interního `src/**` přestane být neviditelný.
Po tomto WP existuje spustitelný checker, který na libovolném SHA řekne, jestli
některý balíček v `specialists/**` porušuje L0-8, a vypíše přesné
`from → to` dvojice.

WP **neopravuje** dnešní porušení — to vlastní
[`WP-M3-L0-8-INJECTION`](WP-M3-L0-8-INJECTION.md). Zde se porušení jen změří,
připne jako přesná expirující položka a zamkne se proti růstu.

## 2. Vlastněné a zakázané cesty

| | |
|---|---|
| **Vlastněné** | `scripts/specialist-boundary-ratchet.mjs` (nový) · `tests/specialist-boundary-ratchet.test.js` (nový) · `tests/fixtures/specialist-boundary/**` (nový) |
| **Registry** | pouze **přidání** jednoho záznamu do `tests/registry.json` |
| **Generovaný** | branch-local `docs/convergence/TEST-REGISTRY.md`; integrátor jej na merge SHA zahodí a regeneruje |
| **Zakázané** | `src/**` · `specialists/**` · `scripts/module-boundary-ratchet.mjs` · `scripts/module-graph.mjs` · existující záznamy, `schemaVersion` a `exclusions` v registry · `CONTRACT.md` · `ROADMAP.md` · `SYSTEM-MAP.md` · `README.md` · `docs/execution/**` · `docs/decisions/**` |

**Proč samostatný checker, a ne rozšíření existujícího.**
`scripts/module-graph.mjs:49` řadí `specialists` mezi `EXTERNAL_DIRS` a
`scripts/module-boundary-ratchet.mjs:34` přijímá jen cesty `^src/**`. Hrana
L0-8 v jejich grafu **není a být nemá** — ten graf měří vnitřek `src/**`.
Samostatný checker nad pěti balíčky proto neduplikuje scanner, měří jinou
množinu, a hlavně nesahá na soubory dokončeného `WP-M1-BOUNDARY-RATCHET`.
Výsledkem je nulový průnik s jiným vlastníkem kromě jediné povolené registry
adice.

**Rezervace registry záznamu** — zapiš současně s testem, ne dřív; validátor
odmítá registrovanou cestu bez existujícího runnable programu
(`scripts/test-registry.js:297`):

```
id:          IS-T1-TESTS-SPECIALIST-BOUNDARY-RATCHET-TEST
path:        tests/specialist-boundary-ratchet.test.js
argv:        ["node", "tests/specialist-boundary-ratchet.test.js"]
capabilityId: C3-027        (precedent: stejný catch-all jako module ratchet)
tier:        T1
fixture:     isolated-home
profile:     offline
timeoutMs:   120000
expectedDurationMs: 15000
requirements: network=none, database=false, server=false, ollama=false, gpu=false
owner:       WP-M3-L0-8-ENFORCEMENT
```

## 3. Vlastněný connector

**Žádný.** WP nemění `ConversationCommand/Result`, `ModelRequest/Result`,
`CoreEvent` ani registrační `ctx`. Nedotýká se `contracts/**`.

## 4. Vstupní revision a závislosti

- vstup: `0a6bde54`
- závisí na: rozhodnutí 019 + potvrzená JSDoc podotázka
- **nezávisí na:** M1, cestové mapě `core / optional`, kroku C, R2
- neblokuje: nic; `WP-M3-L0-8-INJECTION` může běžet souběžně i před ním

Směrové pravidlo `core → optional` v tomto WP **není** — přijatá cestová mapa
neexistuje a checker si ji vymýšlet nesmí. Toto pravidlo plyne přímo z L0-8,
ne z mapy.

## 5. Malá demonstrace

```bash
node scripts/specialist-boundary-ratchet.mjs
```

Vypíše počet skenovaných balíčků, počet zakázaných hran a jejich přesné
`from → to` dvojice. Na vstupní revizi musí vypsat právě jednu vykonávanou
hranu:

```
specialists/accountant-cz/adapters.js -> src/expertises/tool-adapter.js
```

## 6. Focused pozitivní a negativní test

**Pozitivní**

1. Checker projde všech pět balíčků (`accountant-cz`, `code-reviewer`,
   `dummy-logger`, `sazeni`, `translator`), ne jen `manifest.entry` — to je
   přesně nález `L8-2`.
2. Vidí porušení v souboru, který entry pointem není (`adapters.js`); test to
   ověří fixture balíčkem s porušením mimo entry.
3. Baseline s jedinou připnutou položkou projde exit `0`.

**Negativní — bez nich je test false-green**

1. Nová hrana `specialists/** → src/**` shodí test, exit nenulový.
2. Fixture balíček s porušením v tranzitivně importovaném souboru je nalezen
   (rekurzivní průchod, ne jen přímé sousedství entry pointu).
3. **Široká adresářová výjimka je odmítnutá** — allowlist přijímá jen přesné
   `from → to` dvojice, stejná pojistka jako u module ratchetu.
4. Odstranění připnuté položky z baseline při trvajícím porušení test shodí.
5. Podle potvrzené JSDoc odpovědi: buď JSDoc tvar
   `@param {import('../../src/...')}` test **neshodí** (navržený výklad), nebo
   shodí — jedna z obou variant musí být pokrytá explicitním testem, ne
   ponechána nespecifikovaná.

Připnutá položka nese **vlastníka a expiraci**: `WP-M3-L0-8-INJECTION`. Po
implementaci varianty A se odstraní a checker musí zčervenat, kdyby se vrátila.

## 7. Stop condition / eskalace

- **BLOCK** — kterýkoli balíček by ke splnění potřeboval změnu `src/**` nebo
  `ctx`; to je scope `WP-M3-L0-8-INJECTION`, ne tohoto WP.
- **BLOCK** — porušení se ukáže být širší než jedna hrana, tedy měření z
  2026-08-07 už neplatí. Zapiš finding, nerozšiřuj scope.
- **FINDING** — nalezená vada mimo hranici L0-8 (např. další balíček obchází
  `ctx` jinou cestou). Neopravuj.
- **PARK** — JSDoc výklad nedorazí. Checker se dodá s vykonávanými importy,
  JSDoc zůstane měřený a vypsaný jako `INFO`, nikoli jako selhání; do
  `docs/decisions/` jde záznam `typ: PARK` s větou, co tím zůstává neověřené.

## 8. Ověřovací příkaz a očekávaný výsledek

```bash
C3_LOG_LEVEL=error node tests/specialist-boundary-ratchet.test.js   # exit 0
node scripts/specialist-boundary-ratchet.mjs                        # exit 0, 1 připnutá hrana
node scripts/validate-test-registry.js                              # 377 programů, exit 0
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js            # exit 0
node scripts/module-boundary-ratchet.mjs                            # 1016/1016, added=0
git diff --check
```

Poslední příkaz je povinný: dokazuje, že WP **nezměnil** graf `src/**`, tedy
nesáhl na cizí vlastněné cesty.

**Mutační kontrola před předáním.** Doplň dočasně zakázaný import do fixture
balíčku a ověř, že test spadne; potom vrať. Bez toho není doloženo, že checker
není false-green.
