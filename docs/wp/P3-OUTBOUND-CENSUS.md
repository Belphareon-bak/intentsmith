# P3 — census odchozích call sites

> **Point-in-time census na uvedené vstupní revizi.** Řádek s v123 validation
> runtime není současná source mapa; current modelová cesta je v rozhodnutí
> [030](../decisions/030-model-evaluation-authority-consolidation.md).

**Typ:** read-only sonda · **Slot:** nesoutěží o zapisujícího vlastníka
**Vstupní revision:** `1fc8f03e649dd561fb279ce68e5c119d35faad55`
**Adresát:** agent, který povede `WP-M5-AUTH` (krok 3 „OUTBOUND v rámci AUTH/conditional policy")
**Důvod:** M5 exit vyžaduje *„všechny outbound call sites mají policy, scope a audit"*
a *„default install neprovádí tichou odchozí komunikaci"*. Bez úplného seznamu je
to nedokazatelné tvrzení.

---

## 1. Otázka, na kterou sonda odpovídá

Kolik odchozích call sites produkt skutečně má, které z nich jsou dosažitelné
při **default instalaci**, a které se dnes provedou **bez explicitní uživatelské
akce**. Tohle je podklad pro invariant L0-12 (*„žádná tichá odchozí komunikace:
background síť je opt-in"*) a částečně pro L0-11.

Sonda **neopravuje** a nezavádí policy. Jen zjišťuje, co existuje.

## 2. Co je už ověřeno (nepřeměřovat)

Na vstupní revizi:

- `fetch(` v `src/**`: **77 výskytů ve 34 souborech**;
- raw `http`/`https`/`net`/`dgram` modul: jediný soubor — `src/server.js`
  (a to jako listener, ne jako klient);
- žádný `axios`, `undici`, `node-fetch`.

Klastry podle adresáře (výchozí mapa, ne závěr):

| Klastr | Soubory | První otázka |
|---|---|---|
| `src/llm/**` | `gateway.js`, `cre-bridge.js`, `model-ctx.js`, `web-search.js` | Ollama loopback vs. skutečný egress; `web-search.js` je podezřelý |
| `src/upgrade/**` | `registry-client.js`, `model-registry.js`, `model-discovery.js`, `online-discovery.js`, `whatllm-client.js`, `validation-suites.js`, `upgrade-manager.js` | 18b — background síť má být vypnutá, ověřit empiricky |
| `src/notifications/**` | `channels/{ntfy,push,telegram,webhook}.js`, `feedback.js`, `e2e-verify.js` | Explicitní funkce s credentials — má scope a audit? |
| `src/agents/**` | `runner.js`, `sources/{rss,inspector}.js` | Agent běží na pozadí → nejvyšší riziko tichého egressu |
| `src/media/**` | `comfyui-connector.js`, `model-discovery.js`, `vram-manager.js` | Conditional plocha, lokální vs. vzdálený endpoint |
| `src/marketplace/**` | `marketplace-client.js` | Instalace třetí strany |
| `src/tools/**` | `http-client.js`, `registry.js` | Nástroj, který je *určený* k odchozím voláním — musí mít approval |
| ostatní | `setup/wizard.js`, `packaging/auto-updater.js`, `code-intel/semantic-index.js`, `system/gpu-detector.js`, `chat/handlers/pre-handler.js`, `routes/system.js`, `domains/scaffolds/fullstack.js`, `ui/architect/architect.js` | Různé; `pre-handler.js` a `semantic-index.js` jsou v horké cestě chatu |

**Tohle je ta věc, kterou census musí rozhodnout a grep neumí:** ne každý `fetch(`
je egress. Volání na `OLLAMA_URL` na loopbacku je jiná kategorie než
`whatllm-client.js`. Census, který obojí smíchá, je pro `WP-M5-AUTH` nepoužitelný.

## 3. Postup

1. **Vyjmenovat všech 77 call sites** s `file:line` a cílovou URL nebo výrazem,
   ze kterého URL vzniká. Kde je URL složená z konfigurace, uvést zdroj hodnoty
   (env proměnná, DB, uživatelský vstup).
2. **Klasifikovat každý call site** ve třech nezávislých osách:
   - **cíl:** `loopback` / `LAN` / `internet` / `uživatelem zadaný`;
   - **spouštěč:** `uživatelská akce` / `background timer nebo scheduler` /
     `startup` / `reakce na příchozí data`;
   - **default stav:** provede se při default instalaci, nebo je za feature
     flagem / chybějícím credential / conditional plochou?
3. **Vyznačit background cesty.** Pro každý call site se spouštěčem `background`
   nebo `startup` dohledat, co ho plánuje (interval, cron, watcher) a jestli
   existuje vypínač. Tohle je jádro L0-12.
4. **Empirická kontrola, ne jen čtení.** Podle `CONTRACT.md §5` je u efektových
   claimů potřeba negativní kontrola. Spustit produkt v default konfiguraci
   s blokovaným outboundem a zachytit pokusy o spojení. Existující artefakty
   `.intentsmith-artifacts/egress-scan/` a `postfix-evidence/` prověřit dřív,
   než se scan pouští znovu — část práce už může být hotová.
5. **Porovnat statický census s empirickým během.** Rozdíl je nález: call site
   v kódu, který se nikdy nespustil, i spojení, které census nepředpověděl.
   Druhý případ je vážný a patří do stop condition.
6. **Označit call sites bez audit stopy.** Pro `WP-M5-AUTH` je klíčové, které
   volání dnes neprojde žádným logem — ty se v M5 nedají zpětně doložit.

## 4. Výstup

Jediný soubor: **`docs/review/2026-08-07-OUTBOUND-CENSUS.md`**

Povinné sekce:

1. **Tabulka všech call sites** — `file:line`, cíl, spouštěč, default stav,
   audit ano/ne. Úplná, ne vzorek.
2. **Background a startup cesty** — podmnožina z bodu 1 s plánovačem a vypínačem.
3. **Empirický běh** — konfigurace, způsob blokace, zachycená spojení, verdikt
   `PASS`/`FAIL`/`BLOCKED` podle `CONTRACT.md §5`.
4. **Rozdíly statika vs. běh** — obě strany.
5. **Call sites bez audit stopy** — seznam.
6. **Kandidáti na policy třídy** — návrh, jak by se dalo 77 míst pokrýt malým
   počtem tříd. Návrh, ne rozhodnutí.

## 5. Hranice

- žádný zápis mimo výstupní soubor a nově vzniklé artefakty pod
  `.intentsmith-artifacts/` (untracked);
- **nezavádět** policy, guard ani wrapper — to je práce `WP-M5-AUTH`;
- neposílat nic ven kvůli ověření cíle; census se dělá ze čtení a z blokovaného
  běhu, ne aktivním voláním vzdálených endpointů;
- žádné hodnoty credentials v reportu, ani zkrácené.

## 6. Stop condition

Zastavit a eskalovat okamžitě, pokud:

- empirický běh zachytí odchozí spojení v **default** konfiguraci, které census
  nepředpověděl — to je aktivní porušení L0-12, ne položka do tabulky;
- se najde call site odesílající obsah projektu nebo konverzace mimo loopback
  bez explicitního opt-inu — to je L0-13 a má přednost před dokončením censu;
- se počet call sites po tranzitivním rozpadu (wrappery, `tools/registry.js`)
  vymkne tak, že tabulka přestane být uzavíratelná v jednom průchodu — pak
  rozdělit podle klastru a doručit po částech, ne mlčky zkrátit.

## 7. Ověření, že sonda doběhla pravdivě

```bash
grep -rn "fetch(" src/ --include="*.js" | wc -l    # počet musí sedět s tabulkou
```

Report, jehož tabulka má méně řádků než výstup tohoto příkazu, musí rozdíl
vysvětlit řádek po řádku (komentář, mrtvý kód, testovací fixture). Nevysvětlený
rozdíl znamená neúplný census.
