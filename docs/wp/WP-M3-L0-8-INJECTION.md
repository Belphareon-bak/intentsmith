# WP-M3-L0-8-INJECTION — uzavření porušení L0-8 strict injectionem

**Typ:** zapisující WP · **Slot:** paralelní vlastník, **efemérní worktree na disku**
**Vstupní revision:** `0a6bde54e1d2fdf7c284207e9555a0577ce6f6ff`
**Adresát:** nová session, writer 3 · integrátor
**Vychází z:** [`019-l0-8-specialist-boundary`](../decisions/019-l0-8-specialist-boundary.md)
— přijatá varianta **A, strict injection**

Toto je zadání, ne stav. Prototyp obou variant je postavený a spuštěný;
tento WP implementuje přijatou variantu, nezkoumá ji znovu.

---

## 0. Vstupní brána

1. `git status` v hlavním checkoutu je skutečně čistý.
2. Rozhodnutí 019 je commitnuté.
3. Kořen worktree je na disku, ne v `/tmp`.

```bash
git worktree add ~/worktrees/is-l0-8-injection -b wp/l0-8-injection 0a6bde54
```

## 1. Uživatelský výsledek

Balíček `accountant-cz` běží beze změny chování a **neimportuje z `src/**`
nic**. Base class dostává z registračního kontextu. L0-8 přestává být
`OPEN_VIOLATION` a stává se invariantem, který má co vynucovat.

Uživatelsky pozorovatelné: dotaz na daň z příjmu 850 000 Kč vrací vypočtenou
daň; dotaz bez částky vrací vyžádání chybějícího údaje, ne chybu. Obojí musí
zůstat identické s dnešním chováním.

## 2. Vlastněné a zakázané cesty

| | |
|---|---|
| **Vlastněné** | `specialists/accountant-cz/adapters.js` · `specialists/accountant-cz/index.js` · `src/specialists/specialist-loader.js` · `tests/accountant-self-contained.test.js` · `tests/specialist-loader.test.js` · `tests/tool-adapter.test.js` |
| **Podmíněně** | `src/expertises/tool-adapter.js` — **pouze** pokud se ukáže nutná změna; varianta A ji nevyžaduje, base class se nemění |
| **Registry** | žádná změna — všechny tři testy jsou už registrované |
| **Zakázané** | `src/upgrade/**` · `src/db/**` · `src/chat/**` · `src/ws-bridge/**` · `src/routes/**` · `src/llm/**` (vše vlastní M1) · `scripts/**` · `contracts/**` · `CONTRACT.md` · `ROADMAP.md` · `SYSTEM-MAP.md` · `docs/decisions/**` · ostatní čtyři balíčky v `specialists/**` |

Průnik s M1 je nulový: M1 drží `src/upgrade/**`, `src/db/migrations/**` a
chat/WS/studio cesty. `src/specialists/specialist-loader.js` M1 nevlastní.

## 3. Vlastněný connector

**Registrační `ctx`** ze `src/specialists/specialist-loader.js:540-559`.
Tento WP je jeho jediným vlastníkem po dobu běhu a rozšiřuje ho o právě jedno
pole. Je to zúžená předehra `ExtensionManifest/Context` z kroku G — **nezavádí
manifest, capabilities ani verzování**, ty vlastní `WP-M3-BOUNDARY`.

Verze: `ctx` dnes verzovaný není. Tento WP verzování **nezavádí**; pouze
zapíše do zadání kroku G, že `ToolAdapter` musí být v `requiredCapabilities`
podle R8, až manifest vznikne.

## 4. Vstupní revision a závislosti

- vstup: `0a6bde54`
- závisí na: rozhodnutí 019
- **nezávisí na:** M1, `WP-M3-L0-8-ENFORCEMENT`, cestové mapě, R2
- souběh s `WP-M3-L0-8-ENFORCEMENT` je povolený a žádoucí — mají disjunktní
  cesty; enforcement měří, injection opravuje. Integrační pořadí: **enforcement
  první**, aby bylo doložené, že checker porušení vidí, než zmizí.

## 5. Malá demonstrace

Změřený tvar zásahu podle prototypu A z
[`2026-08-07-L0-8-BOUNDARY`](../review/2026-08-07-L0-8-BOUNDARY.md) §3:

- `adapters.js`: odstranit import na řádku 12, obalit soubor
  `export function createAdapters(ToolAdapter) { … return { …5 tříd… }; }`,
  `export class` → `class` na pěti místech;
- `index.js`: `buildToolDefinitions(toolsDir)` → `buildToolDefinitions(toolsDir, ctx.ToolAdapter)`
  na obou volajících místech (`:329`, `:370`);
- `specialist-loader.js`: jeden řádek do `ctx`.

Factory obal je povinný, protože `class X extends Injected` nelze na modulové
úrovni. Je to levné jen proto, že `buildToolDefinitions()` **už je funkce**
volaná uvnitř `register(ctx)`, ne modulová konstanta.

Očekávaný výstup, shodný s baseline:

```
status: ok | net: 735892 | tax: 114108
clarify: clarify ["gross_income"]
```

## 6. Focused pozitivní a negativní test

**Pozitivní**

1. `tests/accountant-self-contained.test.js` prochází beze změny počtu testů
   (dnes 24/0) — registrace přes `ctx` se nerozbila.
2. `tests/tool-adapter.test.js` prochází (dnes 94/0) — pipeline
   `validate → normalize → execute → validateResult` je nedotčená.
3. Nový test: `grep -rn "\.\./\.\./src/" specialists/accountant-cz/` nevrací
   žádný **vykonávaný** import.
4. Pozitivní i negativní produktová cesta vrací hodnoty z §5.

**Negativní — bez nich je to false-green**

1. Registrace bez `ctx.ToolAdapter` selže **deklarovaně**, ne tichým
   `undefined extends` pádem někde uvnitř. Chybová hláška pojmenuje chybějící
   symbol.
2. Adaptér postavený nad injektovanou base class projde `instanceof` proti
   `ToolAdapter` z `ctx` — identita třídy je jediná.
3. **Oprava nálezu `L8-2`:** guard v `specialist-loader.js:521-531` dnes čte
   jen `manifest.entry` a na všech pěti balíčcích vypíše **0 varování**,
   přestože porušení trvá. Test musí doložit, že po opravě balíček s porušením
   mimo entry point varování **vyvolá**. Bez tohoto bodu WP jen přesune
   porušení a nechá slepou kontrolu na místě.
4. Vypnutý/odinstalovaný specialista nezasáhne — regresní kontrola, že se
   registrační cesta nezměnila.

## 7. Stop condition / eskalace

- **BLOCK** — ukáže se, že `ToolAdapter` táhne další symbol přes hranici.
  Měření z 2026-08-07 říká, že `tool-adapter.js` má **0 importů**; kdyby to
  neplatilo, je rozhodnutí 019 postavené na neplatné evidenci a musí se vrátit
  operátorovi.
- **BLOCK** — jakákoli potřeba sáhnout na cesty M1.
- **BLOCK** — nutnost zavést npm workspace nebo balíček; to je varianta B,
  kterou operátor odmítl.
- **FINDING** — duplicita nástrojů `L8-3` nebo core kopie bez konzumenta
  `L8-4`. **Neřeš je.** Rozhodnutí 019 je výslovně ponechává otevřené a patří
  do kroku G. Zapiš, pokud se během práce upřesní jejich rozsah.
- **DECIDE-AND-CONTINUE** — jméno pole v `ctx` (`ToolAdapter` versus
  `toolAdapter`). Šev: jeden identifikátor v `specialist-loader.js` plus jeho
  dvě užití. Default: `ToolAdapter`, protože je to třída a zbytek `ctx` používá
  camelCase jen pro instance.

## 8. Ověřovací příkaz a očekávaný výsledek

```bash
C3_LOG_LEVEL=error node tests/accountant-self-contained.test.js   # 24+/0, exit 0
C3_LOG_LEVEL=error node tests/tool-adapter.test.js                # 94+/0, exit 0
C3_LOG_LEVEL=error node tests/specialist-loader.test.js           # exit 0
grep -rn "\.\./\.\./src/" specialists/                            # jen JSDoc dle 019
node scripts/module-boundary-ratchet.mjs                          # 1016/1016, added=0
node scripts/validate-test-registry.js                            # exit 0
C3_LOG_LEVEL=error node tests/repository-hygiene.test.js          # exit 0
git diff --check
```

Pokud už je integrovaný `WP-M3-L0-8-ENFORCEMENT`, přidej:

```bash
node scripts/specialist-boundary-ratchet.mjs   # 0 porušení, připnutá položka odstraněna
```

**Co tento WP nedokazuje.** Specialista E2E přes běžící produkt zůstává
`NAPSÁNO` — request přes HTTP/WS proti běžícímu serveru patří do
`WP-M3-BOUNDARY` jako regresní síť. Tento WP se nesmí vydávat za splnění
schopnosti #8.
