# Co ukázalo skutečné spuštění

**2026-08-02** · `c01a96aa` · adresát: operátor
**Důvod vzniku:** zadání operátora — *„možná by stálo za to si jej otestovat,
abys vůbec věděl, z čeho vycházíš."* Bylo to správné zadání.

---

## Co funguje

Server nabootoval napoprvé z čerstvého stavu, `/api/health` vrací `llm: true`.
Registrovalo se 5 specialistů, 13 skills, 6 agentů, Ollama dostupná se 13 modely,
`num_ctx` se odvodil z VRAM (`262144 → 21504`). Konverzace se založí, zpráva
projde, odpověď je věcně správná a uloží se.

**Základ běží.** To je důležité říct, protože zbytek dokumentu je o vadě.

---

## Nález — `📊 Aktuální čas: 22:02:56` trvá 25 sekund

Dvě zprávy, obě `LOCAL`, obě terminální, obě deterministické:

| Zpráva | Odpověď | Délka | Rozhodnutí | **Odpověď uživateli** |
|---|---|---:|---:|---:|
| `kolik je 17 * 23?` | `📊 **17*23 = 391**` | 17 zn. | 9 ms | **65 ms** |
| `kolik je hodin?` | `📊 **Aktuální čas: 22:02:56**` | 28 zn. | 2 ms | **25 466 ms** |

**Rozdíl je 390×. Dělá ho délka řetězce, nic jiného.**

### Příčina

`response-finalizer.js:65-69`:

```js
const needsRefinement = Boolean(
  finalContent
    && finalContent.length > 20
    && (synthesisScore === null || synthesisScore < 75),
);
```

Podmínka **nezná intent.** U `LOCAL` je `synthesisScore` vždy `null`, protože
syntéza neproběhla — takže o volání modelu rozhoduje jediné: jestli je odpověď
delší než 20 znaků.

Co se pak stane, doslova z logu:

```
20:02:56.596  HandleLocal   Executing LOCAL decision (TERMINAL)
20:03:22.017  ImprovementLoop  Refinement rejected: semantic drift
                               {"similarity":"0.05","threshold":0.35}
20:03:22.018  QualityTelemetry Chat response score: 54
```

Model 25 sekund „vylepšoval" deterministicky spočítaný čas a **výsledek pak
zahodil** — správně, protože vylepšovat `22:02:56` nejde. Uživatel za tu úvahu
zaplatil čekáním.

### Proč to testy nechytily

Chování `C-02` zní: *„Rozhodnutí `LOCAL` je terminální — nenásleduje žádné
volání gateway."* Test `capability-02-cre-behaviours` ho ověřuje **na úrovni
CRE** a prochází — `decide()` skutečně žádnou gateway nevolá.

Jenže model se zavolá **až za rozhodnutím**, v finalizeru. Chování tedy platí
o rozhodnutí a **neplatí o požadavku**.

> **To je ten nejdůležitější poznatek z celého spuštění.** Zelená schopnost
> neznamená funkční produkt, když se chování ověřuje na jiné úrovni, než na
> které ho uživatel zažívá. Přesně ta past, na kterou operátor upozorňoval:
> *„aby se toho nedohanělo spousta nakonec a nedivili jsme se, proč to
> nefunguje dle očekávání."*

### Rozsah dopadu

Netýká se to jen hodin. Zasažená je **každá odpověď delší než 20 znaků, která
neprošla syntézou** — tedy i `SHELL`, `FILE_WRITE`, `FILE_READ` a další
terminální intenty. Deterministická cesta, která je z definice hotová, platí
plnou cenu volání modelu.

### Opraveno — změřeno na běžícím produktu

| | Před | Po |
|---|---:|---:|
| `kolik je hodin?` | 25 466 ms | **46 ms** |
| `kolik je 17 * 23?` | 65 ms | 36 ms |

**554× rychleji, odpověď znak po znaku identická.**

Kvalitní cesta zůstala netknutá — ověřeno týmž během:

```
LOCAL          refined: false, žádný ImprovementLoop záznam        46 ms
CONVERSATIONAL ImprovementLoop běžel: scoreBefore 73, scoreAfter 73
```

Oprava zná intent, ne délku řetězce: refinement se přeskočí u `LOCAL`, `SHELL`,
`FILE_READ` a `FILE_WRITE`, jejichž odpověď model nepsal. **`FILE_EXPLAIN` v tom
seznamu vědomě není** — jeho odpověď syntéza *je*, takže se u něj refinement
dál spouští.

Regrese: `tests/deterministic-answer-latency.test.js`, 3/3.

### Původně navrhovaná oprava

Terminální deterministické intenty refinement přeskočí. `LOCAL` odpověď se
nedá vylepšit — je to spočítaná hodnota, ne text.

Patří to jako **regresní chování** k #4 (`response-finalizer.js` je v její
inventuře), formulované na úrovni požadavku, ne rozhodnutí:

> „Na deterministický dotaz přijde odpověď do 100 ms — včetně cesty přes HTTP,
> ne jen z `decide()`."

---

## Co z toho plyne pro roadmapu

1. **Chování se musí formulovat na úrovni, kde je uživatel zažívá.** `C-02`
   bylo napsané o `decide()`, a proto minulo 25 sekund.
2. **Před psaním chování schopnosti se má produkt spustit** a změřit skutečná
   cesta. Inventura ze čtení kódu tohle nenajde.
3. **Latence patří do L3 od začátku**, ne až „až bude čas". Kdyby p95 chatu
   někdo měřil, tohle by bylo vidět první den.
