# Přestavba evaluace modelů — přijatý podklad

**Stav:** superseded current implementací · **Aktualizováno:** 2026-08-25

Tento dokument zachovává zdůvodnění a původní návrh. Současný normativní stav,
odlišné role suites, DB autoritu a aktivační hranici popisuje
[MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md); v123 sady, o nichž
se níže mluví v přítomném čase, byly odstraněny.

---

## 1. Proč

Současné validační sady měří **tvar odpovědi, ne schopnost**. Doloženo:

| úloha | co stačí ke 100 % | proč projde vždy |
|---|---|---|
| `code_review` | 3 slova z `eval, injection, SQL…` | `eval` i `SQL` jsou **v zadání** |
| `test_gen` | slovo „test" a slovo „add" | obojí je v zadání |
| `refactor` | dva výskyty `=>` | zadání má dvě funkce k převodu |
| `bug_detect` | výskyt `setTimeout` | `setTimeout` je v zadané ukázce |
| `regex_gen` | `/`, `@`, `\.` | řetězec `/@\./` dostane plné skóre |
| `function_gen` | název, `return`, cyklus | **nefunkční `isPrime` dostane 1.0** |

Žádný hodnotitel v sadě `code` kód nespustí. Důsledek: 8 z 36 úloh dává všem
modelům 100 % a souboj kvalitních modelů končí „nerozhodně" — což zablokovalo
běh na roli CODE 2026-08-19.

`reasoning` je jediná sada s objektivním hodnocením (parsuje JSON, kontroluje
skutečný součin s náhodnými operandy) — a jako jediná v souboji rozhodla.

`vision` je invalidní jinak: testovací obrázky jsou 1×1 až 32×32 px generované
programově. Měří pipeline, ne model.

## 2. Naměřená realita projektu

Telemetrie je prázdná (`llm_execution_log` 0 řádků), takže zdrojem pravdy je
repo a historie:

| veličina | hodnota |
|---|---|
| úpravy : nové soubory | **1463 : 229** (86 % / 14 %) |
| jazyky | 961 `.js`, 115 `.ts`, 29 `.tsx`, **0 Pythonu** |
| typický soubor | medián 280 ř., 90. p. 698 ř. |
| commity | fix 64 + test 58 : feat 27 = **4,5 : 1** |
| commity měnící `src/` i `tests/` | **248** |
| z toho diff ≤ 40 řádků | 35 % (~85 případů) |
| doba běhu testu | **34–87 ms** |

Úlohy proto musí být: **úprava existujícího JS souboru**, ne syntéza izolované
funkce. HumanEval a MBPP by měřily to, co projekt nedělá.

## 3. Princip: odvozovat, ne vymýšlet

Ground truth už v repu je:

| sada | zdroj pravdy |
|---|---|
| CODE | `fix` commity — soubor před, gold patch, **test jako orákulum** |
| REVIEW | `AUDIT-v123.md` (47 vad se souborem a řádkem), `RISK-REGISTER.md` (33) |
| CHAT | 192 `.md` souborů dokumentace |

Ověřeno sondou: **3 ze 3** kandidátů se reprodukuje — test napsaný s opravou
selže na kódu před opravou.

## 4. Architektura

Jedna pipeline, trojí obsah. Po zprovoznění CODE jsou REVIEW a CHAT jen data.

```
L1  schopnostní minimum   (existuje) — odpoví, JSON, čeština
L2  role-specific eval    (staví se) — CODE/REVIEW/CHAT
L3  canary                (později)  — omezený provoz před přepnutím
```

### Anti-cheat (závazné)

1. Hodnoticí logika **nesmí obsahovat termíny z promptu**, ani částečně.
2. Náhodné varianty tam, kde to jde (vzor: `math_basic`).
3. Skryté testy — model nevidí, čím se ověřuje.

### Skórování

- `pass_rate = passed / total`, ne klíčová slova
- 3 opakování, práh rozlišení = `max(epsilon, vlastní nestabilita úlohy)`
- robustnost: variance, latence, podíl timeoutů a pádů
- rozhodnutí na minimální smysluplné deltě, ne na jakémkoli rozdílu

## 5. Plán po dnech

| den | výstup | samostatně použitelné |
|---|---|---|
| 1 | CODE od promptu po skóre + **doklad, že rozlišuje** | ano — odblokuje současný stav |
| 2 | REVIEW z auditu a rizikového registru | ano |
| 3 | CHAT z dokumentace, česky | ano |
| 4 | prahy, rulebook, canary, uzavření | — |

VISION se odkládá; role je okrajová a obrázky se musí postavit znovu.

### Akceptační kritérium dne 1

Rozptyl mezi nejlepším a nejhorším modelem **větší než vlastní šum metriky**.
Když všechny modely dají stejně, metrika nerozlišuje a den selhal — což je
pořád lepší zjištění než současný stav.

## 6. Co se přebírá odjinud

| odkud | co | proč ne celé |
|---|---|---|
| [lm-eval-harness](https://github.com/EleutherAI/lm-evaluation-harness/) | orchestrace, externí kotva pro REASONING | mluví s Ollamou přes `local-chat-completions`, ale **neumí loglikelihood** → odpadají multiple-choice úlohy |
| [bigcode-harness](https://github.com/bigcode-project/bigcode-evaluation-harness) | metoda spouštění kódu v izolaci, `pass@k` | datasety jsou Python syntéza — měřily by, co projekt nedělá |
| [SWE-bench](https://www.vals.ai/benchmarks/swebench) | princip issue → patch → test | dataset je Python; **stejný princip na vlastní historii je lepší** |

Ani jeden neměří češtinu ani doménu projektu — to musí vzniknout tady.

## 7. Riziko, které rozhodne o dni 1

**Aplikace patche.** Modely vracejí celý soubor, jen funkci, unified diff nebo
kód v markdown bloku. Proto je ve 2.–3. hodině kontrolní bod: když se odpovědi
nedají spolehlivě aplikovat, přepne se zadání na „vrať celou upravenou funkci"
místo psaní parseru diffů.
