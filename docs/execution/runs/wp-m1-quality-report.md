# WP-M1-QUALITY — průběžný report

- **stav WP:** implementation/offline PASS; fyzické GPU A/B proběhlo a skončilo
  acceptance FAIL (`0` accepted refinementů)
- **produkční source:** `759bcad0f3bdc4be7eb8fd134d429dc572601d3a`
- **measurement source:** `20f61f2ea37a0396a46be88ed88881a181ea2b02`
- **zapisující větev:** `codex/m1-closeout-20260822`
- **push:** neproveden
- **rozhodnutí ponechat/omezit/odstranit:** data jsou dostupná; doporučení je
  `C-REMOVE`, čeká na výslovnou volbu operátora na Gate 2

## Call graph a jediný vlastník

Původní tok mohl spustit modelový rewrite dvakrát:

```text
synthesizeWithLLM -> selfRefine -> TaggedResponse
                                 -> finalizeChatResponse -> improveResponse -> selfRefine
```

Source `759bcad0` ponechává v synthesis levný bounded retry a deterministické
quality gate, ale odstraňuje její model-backed `selfRefine`. Jediným vlastníkem
je nyní `response-finalizer`: vybere final content, zaznamená before/candidate/
accepted/final score, persistuje přesně zvolený text a vrátí tentýž text.

Veřejný connector, gateway, routes, WS ani Studio se nezměnily. Telemetrie je
aditivní `quality` objekt s `refinementOwner=response-finalizer`, outcome,
accepted/attempted, score delta, latency, provider duration, tokeny, similarity
a typovaným error code. Rejected candidate se nikdy nepersistuje ani nevrací.

## Offline acceptance

Fixní corpus `tests/fixtures/m1-quality-corpus.json` má čtyři versioned případy
a SHA-256 `a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f`.
Každý obsahuje explicitní přijatelné chování a minimálně dva povinné semantic
anchors; CODE navíc vyžaduje zachování code fence.

| Důkaz | Výsledek |
|---|---:|
| `node tests/improvement-loops.test.js` | 21/21 PASS |
| `node tests/chat-output-quality.test.js` | 45/45 PASS |
| `node tests/chat-synthesis-hardening.test.js` | 22/22 PASS |
| `node tests/m1-quality-contract.test.js` | 10/10 PASS |
| `node tests/ws-bridge.test.js` | 86/86 PASS |
| `node scripts/module-boundary-ratchet.mjs` | 1062/1062, bez nové hrany a bez růstu cyklů |
| `node tests/artifact-validation.test.js` | 151/151 PASS |
| `node tests/repository-hygiene.test.js` | PASS |
| registry | 396 programů, 9 exclusions, fingerprint `f181e371…2bcea6` |

Nový kontrakt pokrývá skip bez modelu, přesně jedno volání, skutečně přijaté
zlepšení, semantic drift, horší a prázdný candidate, provider error, cancel bez
assistant persistence, non-model intent a validitu corpusu. Telemetrie accepted
fixture zachytila delta `60 -> 79`, 65 tokenů a jedno provider volání.

## Registrovaný GPU A/B preflight — 2026-08-23

Kanonická T3 sada je registrovaná jako
`IS-T3-TESTS-M1-QUALITY-GPU-AB-TEST`. Self-check je bez provider/GPU effectu.
Fyzický běh používá stejný exact `qwen3.5:27b`, digest
`7653528b…ec06e`, `num_ctx=4096`, fixní corpus a produkční refinement owner.
Měří A baseline proti B final output: p50/p95 baseline/refinement/final latency,
score delta, acceptance rate, tokeny, wire shape, GPU residency/headroom a
přirozený restore. Nevolá pull/delete/unload/rebind a neposílá `keep_alive`.
Bezpečnost je vázaná na skutečný Ollama konflikt a dostupnou kapacitu: malý
non-Ollama desktopový workload je zaznamenaný jako baseline, zatímco rezidentní
model, cizí `ollama`/`llama-server`, méně než 20 128 MiB free nebo utilization
nad 60 % běh dál blokují. Restore vyžaduje prázdnou Ollamu, žádný Ollama
compute, žádný nový non-Ollama proces a návrat použité VRAM k baseline v rámci
commitnutého headroomu; nevyžaduje absolutně prázdnou GPU.

První registrovaný preflight:

```bash
node scripts/nightly-audit.js \
  --suite=IS-T3-TESTS-M1-QUALITY-GPU-AB-TEST \
  --allow-blocker=ollama,gpu \
  --concurrency=1 \
  --timeout-minutes=15 \
  --deadline-hours=1 \
  --fail-fast \
  --run-id=m1-b5-quality-preflight-759bcad0-20260823 \
  --out-dir=.intentsmith-artifacts/test-runs
```

Runner na čistém source `759bcad0f3bdc4be7eb8fd134d429dc572601d3a`
vrátil `0 PASS / 1 FAIL`, protože suite před prvním provider requestem skončila
vlastním exit `2` a stavem `M1_QUALITY_PREREQUISITE_BLOCKED`. Byl rezidentní
cizí `qwen3.5:27b`, compute procesů `1`, volno 4 775 MiB proti minimu
20 128 MiB a utilization 93 %. `measurements` zůstalo `null`; runner cleanup
ověřil čistý source a nulový leak.

| Artefakt | SHA-256 |
|---|---|
| runner report | `ce78675848d8fefba6cec8d324b4f6d1c8009992c726ee8d00d142b9a9a86da5` |
| suite log | `3c80856a764cad6e96680506adbc39d50d51df1369faf58d2b7a03fd9bac5e2a` |
| privátní suite artifact | `13543b2630515aedeb34caf59b4d36b5a85b0921cd9334055e54b12b569cf266` |

Předcházející pětiminutový read-only monitor viděl stejný cizí proces souvisle
držet přibližně 4,7 GiB free a typicky 93–97 % utilization. Proces nebyl
ukončen ani jinak ovlivněn.

## Fyzické A/B — skutečný quality výsledek

Operátor odmítl absolutní požadavek na nulový compute seznam: množství volné
VRAM není konstantní a malý desktopový workload není Ollama konflikt. Commit
`92790a39` proto měří non-Ollama baseline relativně, ale dál fail-closed blokuje
rezidentní model, jakýkoli cizí Ollama/`llama-server`, méně než 20 128 MiB free
a utilization nad 60 %. První fyzický běh na tomto commitu odhalil nulový počet
accepted refinementů a zároveň vadu evidence — acceptance FAIL zahodil již
naměřené cases. Commit `20f61f2e` opravil pouze persistenci fail-path metrik.

Kanonický běh `m1-b5-quality-ab-20f61f2e-20260823` na clean
`20f61f2ea37a0396a46be88ed88881a181ea2b02` skončil po 352 536 ms jako
**FAIL v acceptance**, nikoli prostředím. RustDesk byl explicitně zachycený
baseline (294 MiB); start měl 22 255 MiB free a 12 % utilization. Model byl
100% GPU residentní, minimum za běhu bylo 5 333 MiB free a přirozený restore
vrátil prázdnou Ollamu i nulový Ollama compute po 302 251 ms bez
administrativního efektu. Strom zůstal čistý a cleanup neměl leak.

| Metrika | Výsledek |
|---|---:|
| corpus / attempted / accepted / rejected | 4 / 2 / 0 / 2 |
| acceptance rate / mean applied delta | 0 % / 0 |
| A latency p50 / p95 | 3 670 / 26 548 ms |
| refinement latency p50 / p95 | 933 / 13 358 ms |
| B final latency p50 / p95 | 3 670 / 26 548 ms |
| A prompt / output tokeny | 399 / 377 |
| refinement prompt / output tokeny | 565 / 462 |
| DNS candidate | 72 → 82, ale drift `0,316 < 0,35`; odmítnut, 13 358 ms, 808 tokenů |
| Praha candidate | 59 → 59; odmítnut jako nezlepšený, 933 ms, 219 tokenů |

Všechny čtyři finální baseline odpovědi zachovaly corpus chování a nebyla žádná
provider chyba. Refinement však nepřinesl jediný aplikovaný bod a spotřeboval
1 027 tokenů a 14 291 ms. Oslabení semantic drift guardu jen proto, že DNS
candidate minul hranici o `0,034`, není podložené bezpečné řešení.

| Artefakt | SHA-256 |
|---|---|
| runner report | `188a1d3395d3a563129da192fcf344101c6f2490b401c5158d37b6c4fdf6979a` |
| suite log | `9575e77a6a679415666814721cc54890780952182f1ded837ff9d9d73a4848ff` |
| privátní suite artifact | `04594ec5af498630069869decc0c93d70ac0dcc5be51ea964c1b101e464fbd1b` |

WP tím narazil na deklarovaný `BLOCK`: fixní corpus nemá accepted refinement.
B6 se nesmí otevřít, dokud operátor na
[Gate 2 rozhodnutí 024](../../decisions/024-m1-refinement-disposition.md)
výslovně nezvolí `A-KEEP`, `B-LIMIT` nebo doporučené `C-REMOVE`.
