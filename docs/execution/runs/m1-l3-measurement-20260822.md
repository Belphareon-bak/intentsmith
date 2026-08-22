# M1 L3 — změřená čísla, 2026-08-22

**Commit:** `8310b821` · **Nástroj:** [`scripts/measure-m1-l3.js`](../../../scripts/measure-m1-l3.js)
· **Provider:** lokální Ollama, `qwen3.5:27b` · **Běh:** sériový, jeden turn v jeden
okamžik

Referenční stroj: 24 GiB VRAM, před měřením 1 733 MiB obsazeno. Před během byly
ukončené osiřelé Electron procesy z dřívějších sond, aby GPU nebylo v kontenci.

## Deterministická odpověď

| Metrika | Hodnota |
|---|---|
| vzorků | 12 |
| min | 1,98 ms |
| p50 | 2,77 ms |
| **p95** | **31,6 ms** |
| max | 31,6 ms |
| klasifikováno `LOCAL` | 12 / 12 |

**Cíl p95 < 100 ms je splněný s rezervou.** Že šlo skutečně o deterministickou
cestu, nedokládá jen `metadata.decision.type = LOCAL` u všech vzorků, ale i sama
data: nejpomalejší vzorek má 31,6 ms, zatímco modelový turn na téhle stanici
trvá desítky sekund. Model se tedy nemohl skrytě zapojit.

## Modelový chat

| Metrika | Hodnota |
|---|---|
| cold (první turn po startu) | 64,1 s |
| warm vzorků | 11 |
| warm min | 29,6 s |
| warm p50 | 30,1 s |
| **warm p95** | **35,9 s** |
| warm max | 35,9 s |
| provider errors | 0 |
| **throughput** | **1,96 turnu / min** |

Cold a warm jsou měřené odděleně, jak roadmapa žádá. Cold je 2,1× pomalejší než
warm p50 — rozdíl je nahrání modelu, ne kvalita odpovědi.

## Refinement delta — nezměřeno, a proč

`observedTurns: 0`. Není to selhání běhu: refinement se v
`response-finalizer.js` spouští jen pro **syntetizované** odpovědi pod prahem
kvality. Konverzační turny použité v tomhle měření syntézou neprocházejí, takže
refinement legitimně neběžel ani jednou.

Delta proto patří do `WP-M1-QUALITY` (B5), které má v zadání fixní corpus a A/B
report se stejným modelem — ne do latenčního skriptu. Vydávat nulu za „změřeno"
by bylo nepravdivé.

## Co tím je a není doložené

Splněné z L3 seznamu:

- p95 deterministické odpovědi pod 100 ms na referenčním stroji;
- warm/cold whole-response latence změřené odděleně;
- p95 modelového chatu a throughput **změřené, ne odhadnuté**.

Zbývá:

- **refinement delta** — B5, fixní corpus;
- time-to-first-token se neměří, protože streaming není v scope M1;
- tohle je latenční měření, ne kvalitativní: neříká nic o správnosti odpovědí.

## Jak to zopakovat

```bash
node src/server.js &                       # port je v ~/.c3/port
C3_URL=http://127.0.0.1:<port> node scripts/measure-m1-l3.js --samples 12
```

Skript končí nenulově, pokud nenasbírá ani jeden použitelný vzorek — měření,
které nic nezměřilo, se nesmí tvářit jako zelené.
