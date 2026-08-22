# Běhový režim — `scripts/run-suites.js`

**Datum:** 2026-08-22 · **Vztah k `CONTRACT.md §8`:** doplňuje vývojovou cestu,
nenahrazuje release certifikaci

## Proč vznikl

`scripts/nightly-audit.js` je **certifikátor Gate 0** — jeho vlastní dokument se
tak i jmenuje. Je zamčený na větev `codex/intentsmith-1.0`, profily
`offline,database` a concurrency 1, systemd instalátor odmítá zápis a
`server`, `external-network` i `state-blocked` jsou v něm **tvrdé blockery**,
které neobejde `--no-block` ani `--allow-blocker`.

Pro certifikaci je to správně: gate nesmí označit za prošlé to, co nespustil.
Důsledek ale je, že **82 registrovaných sad nejde spustit vůbec** — 79 z nich
potřebuje běžící server. Změřeno 2026-08-21: `nightly-audit --dry-run
--profile=model,soak --allow-blocker=ollama,gpu --no-block` hlásí
`{"server":50,"state-blocked":51}`.

`PRODUCT.md §5` bod 7 přitom žádá, aby release gate nezakrýval `BLOCKED` ani
neprovedený test. Chyběl kus, který sady **spustí**.

## Co dělá

1. postaví runner-owned izolaci **stejnou funkcí, jakou používá audit** —
   `makeSuiteEnvironment()` je proto z `nightly-audit.js` exportovaná, aby
   existoval jediný zdroj pravdy o tvaru prostředí;
2. spustí `src/server.js` v té izolaci na efemérním portu;
3. počká na `C3_PORT_FILE` a doplní sadám `C3_URL` na skutečný port;
4. každou sadu spustí s **jejím vlastním stropem z registru**;
5. zapíše `report.json`.

## Co nedělá — a nesmí

**Výstup není Gate 0 evidence.** Report nese `gateEvidence: false`. Skript
neaktualizuje `tests/registry.json`, nezapisuje `lastGreen` a nemění stav žádné
sady. Je to měření, ne certifikace. Sada, která tudy projde, tím **nepřestává
být `BLOCKED`** — přeznačení stavu je samostatné rozhodnutí s vlastním důkazem.

## Použití

```bash
npm run run:suites -- --state=BLOCKED --profile=server --list
npm run run:suites -- --suite=IS-T3-E2E-57-LIFECYCLE-FULL
npm run run:suites -- --profile=model --timeout-scale=2
npm run run:suites -- --suite=... --log-level=info    # rozpad času v serverovém logu
```

`--log-level=info` je tam kvůli konkrétnímu nálezu: audit si vynucuje `warn`
(`nightly-audit.js:835`), takže rozpad času requestu nebyl vidět. Změřeno na
promptu, na kterém padá `78-guard-rules`: klasifikace záměru **26,6 s**,
generování odpovědi **49,6 s**, celkem 76,2 s s teplým modelem — proti
šedesátisekundovému `LLM_TIMEOUT`.

## Známé prostředí

Sady vyžadují kompletní izolaci včetně `HOME` uvnitř `.intentsmith-artifacts`.
Bez `C3_AUDIT_RUN=1` si bootstrap `tests/helpers/isolated-test-db.js` vyrobí
vlastní privátní root a injektované cesty přepíše — test pak kouká jinam než
server. Skript tohle nastavuje sám; ručnímu spouštění to dělá potíže.
