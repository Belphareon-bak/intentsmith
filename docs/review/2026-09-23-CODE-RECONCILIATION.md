# CODE — připojení druhého posudku k rozsouzení

**Stav: DRAFT_ATTACHED_FOR_ADJUDICATION / NO_AUTONOMOUS_GO.**
Autorita: nabídnutý a odevzdaný druhý posudek operátora, souhlas s novým
rozsahem CODE jistoty. Výchozí commit `ab113853`. Pouze offline práce nad
uloženými daty; žádný běh modelu, oracle replay, produkční import či nasazení.

## Podklad a výsledek

`second-reviewer-opus-DRAFT.json` byl přečten přímo z předaného adresáře.
SHA-256: `680bbc7d41b7c286c46bede4a59372dc908da298c21afd1b4dbcf95411cf9d65`.
`packetId: 6428ae6e0c871c30f8306f1575db66cf`, původní `status: DRAFT`,
`decisionAuthority: false`. Původní soubor se nezměnil; kopie v rozsouzení
je bajtově shodná. **Samostatné další odůvodnění není potřeba:** JSON má
u všech 60 os důvod i citaci a všechny citované úryvky jsou v pozorovaných
výstupech. Kontrola citace dokládá její přítomnost, ne správnost známky.

| Osa | Druhý posudek | Shoda s autorem |
| --- | --- | --- |
| Význam vysvětlení jistoty | 14× 1, 16× 0 | 30/30 |
| Ostatní vysvětlení | 30× 1 | 30/30 |

Převod náhodných ID proběhl přes samostatný custody klíč; zkontrolované
jsou hashe veřejného balíčku, odpovědí a jejich vazba na původní replay.
Přiřazení jednotlivých os, důvody i citace jsou zachované v
[reconciliation.json](/mnt/vi7000/intentsmith/evidence/hunt-code-prose-second-review-20260923/reconciliation-opus/reconciliation.json).
Nejde o nový souhrnný modelový score ani o přijetí orákula.

## Tři sporné formulace

| Původní ID | Kandidát / pokus | Rozsouzení obou čtení |
| --- | --- | --- |
| `0bb777148c9c` | qwen3-coder:latest / 3 | „jistota rozhodnutí: …“ odpovídá požadavku; vložené slovo význam nemění |
| `75d6bd34f679` | qwen3-coder:latest / 2 | Stejný důvod; textová osa 1 |
| `223256373d26` | qwen3.5:27b / 2 | Stejný důvod; textová osa 1 |

Tři případy jsou fakticky vysvětlené. Staré automatické známky zůstávají
viditelné jako historické, podezřelé; toto připojení je nepřepisuje a
neobchází podmínku přejímky před novým plným oracle replayem.

## Dvě korekce rozsahu tvrzení

O09–O12 mají u všech 30 odpovědí shodný **řetězec `detail`**, nikoli celý
návratový objekt. Rozdíly v API jsou reálné a zůstávají v datech:

| Pozorování | S `confidence: vysoká` | Bez `confidence` |
| --- | ---: | ---: |
| O09: podprahová kvalita | 9 | 21 |
| O10: rychlost 2× | 3 | 27 |
| O11: rychlost 1,1× | 3 | 27 |
| O12: rychlost nezměřena | 3 | 27 |

Přidaná hodnota mimo kvalitativní větve není dodatečná textová srážka:
staré zadání tyto případy pro pole jistoty dostatečně nespecifikovalo.
Má být výslovně vyřešená v doméně nové úlohy. Druhá textová osa v tomto
panelu modely nerozlišila, ale může zůstat regresní kontrolou. Identický
výsledek sám neprokazuje neužitečnost testu; nové vstupy a negativní
kontroly mají ověřit citlivost na skutečnou regresi, ne vynutit rozptyl.

Z O01–O08 je 240 pozorování. Přesné `confidence` je správně přítomné
v **216**, ve **24** chybí. Podle obou textových čtení je požadovaná
jistota ve vysvětlení přítomná ve **112**, ve **128** chybí. Obě složky
jsou současně přítomné v **88** pozorováních. Výrok „všech 240 potvrzuje
shodu všech tří zdrojů“ by proto byl příliš silný: chybějící údaj není
shoda. Číselná kontrola API ani samotná shoda posudků neparsuje význam
prózy automaticky.

## Proč tři zdroje samy neřeší chybný extraktor

Požadované pravidlo je správné: **význam detailu = confidence = stupeň
odvozený z discriminating**. Odmítnout negaci ale umí teprve extraktor,
který ji správně pochopí. Počet porovnávaných zdrojů jeho chybu neopraví:

```text
discriminating = 1
confidence = nízká (jediná úloha)
detail = Neplatí nízká (jediná úloha); skutečná jistota je vysoká.
```

Chybný extraktor vybere první zmíněné „nízká“. Pak se všechny tři
strojově porovnávané hodnoty shodnou a přesto projde opačný význam.
Tento konkrétní protipříklad je uložen i strojově, s výslovným označením
chybného demonstrovaného extraktoru; není připojen do hodnocení modelů.

Přesné API proti počtu úloh zůstává deterministická kontrola. Význam
volného vysvětlení vyžaduje přijatého sémantického hodnotitele s důkazem
v textu a možností označit nejasnost. Jeho přejímka musí obsahovat správné
parafráze, negace, citace cizího tvrzení i rozpory, na nepoužitých
případech. Hodnotitel má nejprve vyložit text bez znalosti očekávaného
stupně a teprve pak se mají výsledky porovnat; to je návrh provedení,
nikoli tvrzení, že takový přijatý hodnotitel už existuje.

## Přijaté vyjasnění a zachované hranice

Souhlas s jistotou ve **všech větvích `basis: kvalita`**, včetně
podprahového ponechání, je zapsaný v direction §7.5. Existující prompty,
reference ani výsledky se touto dokumentační změnou nezměnily. Další
verze potřebuje uzavřenou doménu vstupů, novou identitu a odpovídající
referenci i přejímku; pak lze nově sbírat.

Posuzovatel deklaruje vysokou předchozí expozici a rozpoznání skupiny
u 14 odpovědí, u 16 jednotlivé rozpoznání neudává. Původní údaj
`yes-group` zůstává zachovaný. **Shoda 60/60 není nezávislé potvrzení
ani kalibrační důkaz.** Stav DRAFT se automaticky nepovyšuje a žádný
hodnoticí profil nedostal novou autoritu.

## Ověření

8 cílených testů připojení posudku: vazba na balíček, změněná odpověď,
neúplná/duplicitní mřížka, neplatná známka, pokus přidat autoritu,
zachování neshody a chybějící známky, neproměňování citace v sémantickou
známku a povinné důvody/expozice. Spolu s 5 testy exportu: **13 PASS**.
Kontrola skutečného souboru: **30 položek, 60 os, 60 citací**, žádná
chybějící známka, původní bajty zachované. Neopakoval se release gate,
prohlížeč ani GPU měření — tyto cesty se neměnily.

[Přesné hashe a počty](evidence/2026-09-23-code-reconciliation.json).
