# 024 — disposition model-backed refinementu podle fixního A/B corpusu

- **typ:** přijaté Gate 2 produktové rozhodnutí
- **stav rozhodnutí:** **PŘIJATO OPERÁTOREM 2026-08-23 — C-REMOVE**
- **WP:** WP-M1-QUALITY / B5
- **rail:** R2 LOCAL_FIRST, R3 OBSERVABLE_BEHAVIOR, R4 MEASURED_QUALITY, R6 REVERSIBILITY
- **source měřidla:** `20f61f2ea37a0396a46be88ed88881a181ea2b02`

## Proč bylo rozhodnutí potřeba

Odstranění double-refine a jednoznačná telemetrie jsou bezpečnostní oprava a
nevyžadují produktovou volbu. Zda má model-backed refinement zůstat zapnutý,
ale nelze určit podle zelených fake testů: přidává modelové tokeny a latenci a
může být deterministickým scorerem odmítnut. Gate 2 proto rozhodoval až nad
jedním exact modelem, jedním commitnutým corpusem a skutečnými A/B čísly.

## Varianty

| Varianta | Chování | Přínos | Cena a riziko |
|---|---|---|---|
| **A — ponechat** | Jeden finalizer-owned refine pro každý eligible score `<75`. | Zachová veškerý naměřený accepted quality gain. | Platí se latence a tokeny i za odmítnuté candidates; drift guard zůstává kritický. |
| **B — omezit** | Zachovat ownera, ale povolit refinement jen pro intents/corpus třídy s kladným delta a přijatelnou cenou. | Soustředí cenu na prokázaný přínos a drží snadný rollback. | Vyžaduje explicitní allowlist/threshold a další měření při jeho změně. |
| **C — odstranit** | Odstranit model-backed rewrite; ponechat synthesis retry, deterministické gate a scoring telemetry. | Nulová refinement latence/tokeny a nejmenší drift surface. | Přijde se o každý prokázaný accepted quality gain. |

## Povinná tabulka před volbou

| Metrika | Hodnota |
|---|---:|
| exact source | `20f61f2ea37a0396a46be88ed88881a181ea2b02` |
| model/digest/context | `qwen3.5:27b` / `7653528b…ec06e` / 4096 |
| corpus SHA-256 | `a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f` |
| corpus cases | 4 |
| attempted / accepted / rejected | 2 / 0 / 2 |
| acceptance rate | 0 % |
| mean applied score delta | 0 |
| A latency p50 / p95 | 3 670 / 26 548 ms |
| refinement latency p50 / p95 | 933 / 13 358 ms |
| B final latency p50 / p95 | 3 670 / 26 548 ms |
| A prompt/output tokens | 399 / 377 |
| refinement prompt/output tokens | 565 / 462 |
| konkrétní accepted případ a cena | žádný — to je acceptance FAIL, ne chybějící údaj |
| konkrétní rejected případ a cena | `dns-steps`: candidate 72 → 82, lexikální Jaccard `0,316 < 0,35`, 13 358 ms, 808 tokenů; `prague-factual`: 59 → 59, totožný text, 933 ms, 219 tokenů |

## Fyzický důkaz

Offline kontrakt má konkrétní accepted fixture `60 -> 79`, jedno volání a 65
tokenů, ale fake model nebyl podklad pro variantu A/B/C. Registrovaný fyzický
run `m1-b5-quality-ab-20f61f2e-20260823` na clean source provedl šest exact
`qwen3.5:27b` requestů, zachoval všechna čtyři finální corpus chování, neměl
provider error a přirozeně obnovil GPU proti zaznamenanému RustDesk baseline.
Verdikt je přesto FAIL: dva eligible refinementy byly oba odmítnuté, applied
delta je 0 a cena je 1 027 tokenů plus 14 291 ms. Tento součet sám o sobě
nedokazuje, že model neumí odpověď zlepšit; ukazuje selhání současné acceptance
mašinerie, které je rozebrané níže.

## Interpretace fyzických odmítnutí

`dns-steps` nebyl odmítnut sémantickou metrikou. `tokenSimilarity()` v
`improvement-loops.js` počítá Jaccardův překryv množin lower-case slovních
tvarů delších než dva znaky. Hodnota `0,316` proto znamená jen malý lexikální
překryv. Prompt současně žádá odpověď „přepsat“ a zlepšit její strukturu,
zatímco guard vyžaduje nejméně 35 % překryvu původních slov. Kandidát se
formálním scorerem zlepšil `72 → 82`, ale jeho obsahová správnost už zpětně
nejde ověřit: measurement artifact neukládá candidate text, jen score,
podobnost, cenu a hash finální — původní — odpovědi.

`prague-factual` měl similarity `1`, stejný počet output tokenů jako baseline a
stejný finální SHA; model vrátil původní větu beze změny. Score `59` nevzniklo
pozorovanou chybnou odpovědí. Scorer pro `FACTUAL` používá ideal délku 200 znaků
a coherence zvýhodňuje více vět/odstavců, zatímco corpus výslovně žádal jednu
větu. Správná 40znaková odpověď proto spustila false-positive refinement.
Kalibrace scoreru zůstává po odstranění refinementu samostatným
[findingem 011](../findings/011-response-scorer-short-factual-calibration.md).

Výsledek tedy není „refinement neumí zlepšovat“. Jeden pokus odmítl lexikální
guard, jehož acceptance okno si protiřečí s rewrite promptem, a druhý se kvůli
false-positive scoreru vůbec neměl spustit. Současná kombinace triggeru,
scoreru, guardu a neúplné evidence nemůže podat důvěryhodný produkční důkaz.

## Přijatá varianta C — REMOVE

Operátor 2026-08-23 přijal C. Produkční `response-finalizer.js` po prvním
výsledku už nesmí volat `improveResponse()` ani jinou modelovou rewrite cestu.
Zůstává:

- hlavní modelová odpověď a její existující synthesis retry;
- `fastRetryGate`, který pouze mění prompt uvnitř již existujícího bounded
  synthesis retry a sám nepřidává modelové volání;
- deterministický scorer a quality telemetry;
- provider error/cancel/persistence hranice.

Quality telemetry pravdivě zapisuje `refinementDisposition=removed`, nulového
ownera, `attempted=false`, nulovou latenci/tokeny a outcome
`removed_by_decision_024`. Scorer tím není prohlášený za dobře zkalibrovaný;
zůstává diagnostickou metrikou s findingem 011.

Fyzická A/B sada je po této volbě historický rozhodovací experiment, ne test
produkčního refinement ownera. Její source a FAIL artifact se zachovávají; na
novém HEAD se už nesmí vydávat za aktivní M1 acceptance.

## Podmínky případného návratu

Model-backed refinement se nesmí vrátit pouhým obnovením starého calleru nebo
snížením hranice pod `0,316`. Nový samostatný experiment musí před produkčním
zapojením současně:

1. používat skutečně sémantický guard (např. připnutý embedding model a
   verzi/metriku), ne lexikální Jaccard vydávaný za významovou podobnost;
2. ukládat sanitizovaný candidate text nebo obsahově ekvivalentní
   reviewovatelný artefakt spolu s přesným modelem, digestem, promptem, score,
   guard verdict, tokeny a latencí;
3. oddělit scorer false-positive od skutečně nekvalitní odpovědi a respektovat
   explicitní formát/stručnost požadovanou uživatelem;
4. na předem přijatém širším corpusu prokázat obsahově zkontrolovaný accepted
   gain proti baseline a negativní drift případ;
5. dostat nové operátorské rozhodnutí před produkční aktivací.

## Rollback

Implementace C je jediný malý produkční commit
`4b20a5dd32b68cb3d231a8ec8348e8b5b63d0fa7`. Návrat současného chování je
technicky `git revert 4b20a5dd`, ale takový
revert je povolen jen jako výslovný nový produktový krok; sám neřeší výše
uvedené podmínky návratu.

## Přesná otázka pro Gate 2

```text
024-refinement-disposition: C-REMOVE (ACCEPTED 2026-08-23)
024-evidence-run: m1-b5-quality-ab-20f61f2e-20260823 (acceptance FAIL)
024-source: 20f61f2ea37a0396a46be88ed88881a181ea2b02
024-implementation: 4b20a5dd32b68cb3d231a8ec8348e8b5b63d0fa7
024-corpus: a2b1ab9175407cd144306532bf87859aaa6fef196a3c5ed9787b1f6df128790f
024-accepted-case: NONE
024-rejected-case: dns-steps (+10 candidate, lexical Jaccard reject, 13358 ms, 808 tokens)
024-threshold-or-allowlist: removed
024-rollback: git revert 4b20a5dd
```

Operátorská volba odstranila rozhodovací BLOCK. B5 se uzavírá až implementací
C a jejími focused důkazy; M1 až samostatnou B6 fresh-install exit demonstrací.
