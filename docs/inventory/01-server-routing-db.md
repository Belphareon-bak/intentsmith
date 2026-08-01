# Inventura #1 — Server, routing, DB, migrace

**Schopnost:** #1 podle `CONTRACT.md` §6 · **Datum:** 2026-08-01
**Commit:** `17a8b9a8` · **Stav:** k schválení operátorem

> Podle `CONTRACT.md` §3 krok 1. Tento dokument **popisuje současný stav
> a nerozhoduje**. Rozhoduje se až nad hotovými třemi seznamy.

---

## 1. Rozsah

| Soubor / adresář | Řádků |
|---|---:|
| `src/server.js` | 1 546 |
| `src/routes/` (17 souborů) | 7 451 |
| `src/db/` (4 soubory) | 2 589 |
| `src/db/migrations/` (47 souborů) | — |
| `src/config.js` | 240 |
| `src/server-port-file.js` | 82 |
| `src/security/legacy-listener-policy.js`, `timeout-policy.js`, `runtime-environment.js`, `core/` | ~600 |
| **Celkem** | **~12 500** |

---

## 2. Co jsem naměřil

Čerstvý klon, Node 22, `npm install`, bez Ollamy a bez GPU.

| | Výsledek |
|---|---|
| `npm install` | 233 balíčků, 16 s |
| Start serveru | **napoprvé**, bez zásahu |
| Migrace na prázdné DB | **47 aplikováno, 0 přeskočeno** |
| Výsledné schéma | **95 tabulek, 196 indexů** |
| Počet rout | **~230** (13 v `server.js`, 215 z modulů, plus skills/autonomy/media/setup) |
| Latence — exact match (`/api/health`) | 0,63 ms |
| Latence — pattern match (`/api/conversations/:id`) | 0,87 ms |
| Chování bez Ollamy | čistý `LLM_PROVIDER_UNAVAILABLE`, server běží dál |

**Architektura:** čisté `node:http`, žádný framework. Router je objekt
`{'METODA /cesta': handler}`; nejdřív exact match `O(1)`, pak lineární průchod
s kompilací regexu na požadavek. Routy se skládají z továren
`create*Routes(deps)`.

**Pořadí zpracování požadavku:** legacy local access policy → rate limit →
`matchRoute` → handler. Autorizace v tom řetězu **není**.

---

## 3. Seznam 1 — co je dobré a použije se

| Co | Proč |
|---|---|
| **Migrační systém** | 47 verzovaných migrací se aplikuje na prázdnou DB bez jediné chyby. Toto je nejsilnější část celé schopnosti. |
| **Skládání rout přes továrny** | `create*Routes(deps)` je čistá dependency injection. Každý modul rout jde otestovat samostatně bez serveru — což jsem využil při inventuře. |
| **`legacy-listener-policy.js`** | Vyhodnocení origin/target/capability **před** routováním a před parsováním těla. Výsledek práce S-1 a jediné místo, kde se dnes rozhoduje o přístupu. |
| **Oddělená `timeout-policy.js`** | Politika timeoutů vytažená ze serveru do vlastního modulu s vlastním testem. |
| **Centrální `config.js`** | Konfigurace i feature flags na jednom místě, 240 řádků. |
| **Zacházení s chybami** | `safeError()`, propagace `statusCode`, limit velikosti těla, oddělené 400/413/500. Nic neuniká jako stack trace. |
| **`C3_DB_PATH` guard** | `database-path.js` odmítne import bez explicitní cesty k DB. Fail-closed, žádná tichá výchozí databáze. |
| **Port file** | `/root/.c3/port` — klient najde běžící server bez hádání portu. |
| **Degradace bez modelu** | Server běží, odpovídá, deterministické intenty fungují, LLM cesta vrací typovanou chybu. |

---

## 4. Seznam 2 — co je zbytečné

Uvádím jen to, co jsem si ověřil. Sporné věci patří do seznamu 3.

| Co | Doklad |
|---|---|
| **Mrtvý komentář po v57** | `server.js:1201` — blok `REMOVED: Legacy workflow UI (getUIHTML) — v57.0` popisuje kód, který v repozitáři není. |
| **Trojí alias health endpointu** | `GET /`, `GET /api/health` a `GET /health` volají tentýž handler. Dvě routy navíc v tabulce, kterou prochází každý pattern match. |
| **Rate limiter je v podporované konfiguraci mrtvý kód** | `_rateLimitEnabled` je `false`, kdykoli je host `127.0.0.1`. Protože L0-10 zakazuje opustit loopback, ~45 řádků (buckety, tiery, čistící interval) se v podporovaném provozu nikdy nevykoná. Není to chyba — je to kód pro konfiguraci, která je zakázaná. |

---

## 5. Seznam 3 — co je nejasné a potřebuje rozhodnutí

| # | Zjištění | Otázka na operátora |
|---|---|---|
| **N-1** | **19 z 36 rout v `system.js` obsluhuje modely, upgrady a proposals.** Tedy schopnost #18 (model upgrade), kterou jsi zařadil mimo základ, má víc než polovinu povrchu zapuštěnou přímo v jádrových routách #1. | #18 nejde odložit „nedotýkáním se jí". Buď se její routy z `system.js` vyčlení, nebo je #18 fakticky součástí základu. Co z toho? |
| **N-2** | **Server při každém startu zapisuje 6 ukázkových agentů do DB** (`src/agents/examples/*.json`) a plánuje je ve scheduleru. Viděl jsem to v logu při prvním bootu. | Jsou ukázkoví agenti produktová funkce, demo data, nebo pozůstatek vývoje? Dnes se chovají jako produkční data. |
| **N-3** | **`GET /api/license/status`** vrací `tier`, `valid`, `features`, `expiresAt`, `owner` z `licenseManager`. | Existuje licenční model? Pokud ne, je to mrtvá plocha; pokud ano, patří do roadmapy. |
| **N-4** | **Governor** — 6 rout, modul `src/system/governor/`. `docs/governor-v135-plan.md` ho vede jako **`PLANNED — awaiting approval`** z 2026-03-27, ale routy běží. | Je governor schválený a hotový, nebo běží něco, co čeká na schválení? |
| **N-5** | **Setup wizard** (`src/setup/wizard.js`) přidává routy pro first-run konfiguraci. | Je řízená první instalace součástí produktu 1.0, nebo to zatím zůstane na `.env`? |
| **N-6** | **`system.js` má 1 621 řádků a 36 rout** napříč GPU, úložištěm, modely, upgrady, validací a proposals. | Je „system" jedna schopnost, nebo se má rozdělit podobně jako #6? |
| **N-7** | **Modul `skills.js` a `autonomy.js` nejdou importovat bez `C3_DB_PATH`** — sahají na DB v čase importu. Ostatní moduly rout ne. | Je to záměr, nebo se to má srovnat s ostatními? Ovlivňuje to testovatelnost. |
| **N-8** | **Lineární průchod tabulkou rout s kompilací regexu na požadavek.** Naměřeno 0,87 ms u pattern routy, tedy **dnes to problém není**. Při ~230 routách a jednom uživateli je to jedno. | Zaznamenat jako známou vlastnost a neřešit, nebo to je věc, kterou chceš mít vyřešenou dřív, než poroste počet rout? |

---

## 6. Co inventura nenašla

Aby bylo jasné, co bylo prohledáno a nic se nenašlo:

- **Žádný globální auth guard** — potvrzuje nález z mobilní větve. Je to vědomý stav, ne přehlédnutí; řeší se podle `CONTRACT.md` §9 až po základu.
- **Žádná nepoužitá tabulka rout ani osiřelý modul rout** — všech 17 souborů v `src/routes/` je ze `server.js` importováno a zapojeno.
- **Žádná migrace, která by selhala nebo se přeskakovala.**

---

## 7. Další krok

Podle `CONTRACT.md` §3 se nad těmito třemi seznamy **nerozhoduje agentem**.
Až budou schválené, následuje krok 2 — seznam chování schopnosti #1.

Osm otázek `N-1` až `N-8` čeká na tebe. `N-1` je z nich nejdůležitější,
protože mění rozsah základu.
