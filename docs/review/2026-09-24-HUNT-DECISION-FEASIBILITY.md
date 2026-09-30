# GPU hunt — proveditelnost rozhodnutí a meze náhradních metod

**Datum:** 24. 9. 2026. **Stav:** `DESIGN_REVIEW / METHOD_NOT_ACCEPTED / NO_AUTONOMOUS_GO`.
Podklad: připomínka operátora k proveditelnosti §5.2a, kód `6cfcceb4`,
[workflow](../GPU-HUNT-WORKFLOW.md) a [nově přidaná roadmapa](../GPU-HUNT-ROADMAP.md).
Nejde o další hodnocení kandidátů. Produkční kód, původní známky, bindingy
a evaluační kontrakt z 18. 9. se tímto nemění.

## 1. Oprava předchozího závěru

Praktická námitka je oprávněná. `boundedGroupInterval()` nepoužívá výběrový
rozptyl. Její obecnost pro nezávislé omezené rozdíly je vykoupena šířkou,
která při malých mezích nedává plán v řádu desítek až stovek skupin.
Předchozí příklad „při rozdílu +1 se rozhodnout dá“ tuto námitku neřešil.

| Pozorovaný rozdíl ve všech skupinách | N | Dolní mez 95 % | Podmínka |
|---|---:|---:|---|
| +0,17 | 20 | −0,415479 | > +0,04 nesplněno |
| 0 | 20 | −0,555425 | > −0,02 nesplněno |
| 0 | 18 440 | −0,020000384 | > −0,02 nesplněno |
| 0 | **18 441** | **−0,019999842** | > −0,02 splněno |

Při konstantním pozorovaném průměru +0,17 první podmínka vyjde při 434
skupinách. To ani tabulka nejsou power analýza: drží se **pozorovaný**
průměr, nepředpovídá se jeho výběrové rozdělení. Naopak nulový rozptyl
ve vzorku nedokazuje, že v populaci neexistují vzácná zhoršení.

## 2. Dopad do skutečného rozhodování

[code-pilot-decision.js](../../src/eval/code-pilot-decision.js):
`validatePairedPlan()` přijímá jen metodu `hoeffding-kl-bounded-groups`.
`decidePairedPlan()` přijímá za platný pokus pouze skóre 0/1, agreguje
opakování uvnitř scénáře a scénáře uvnitř původu a volá `boundedGroupInterval()`.
Vyšší kvalita vyžaduje dolní mez nad přínosem, rychlost navíc nezhoršení.

[role-operational-decision.js](../../src/eval/role-operational-decision.js)
přes stejnou cestu posuzuje **všech sedm rolí**. U ne-CODE rolí ověřuje
`completed_role_workflow_without_repair_help` a doklady konečného stavu.
Samostatné spojité známky CHATu nejsou tímto provozním vstupem.

Proto není správná jednorázová náhrada helperu: změnila by i výpočet
existujících binárních kontraktů. Je třeba nová explicitně pojmenovaná
metoda a metrika/verze plánu, jejich validace a zachování původních plánů.
Třetí cesta „odstranění kritické vady“ je stále návrh; v tomto kódu není.

## 3. Provedená simulace

[Skript](evidence/2026-09-24-method-feasibility.py),
[strojový výsledek](evidence/2026-09-24-method-feasibility.json).
21 buněk × 1 000 nezávisle generovaných datových souborů = **21 000 simulací**.
Každý soubor se posoudí všemi třemi metodami, vždy na stejných datech:

- KL z aktuálního kódu; vektorový přepis byl porovnán s JS exportem na
  32 kombinacích včetně hranic −1/+1, maximální rozdíl **0**.
- Párový t-interval nad rozdíly po skupinách, s výběrovou směrodatnou
  odchylkou a N−1 stupni volnosti.
- **Percentilový** bootstrap po celých skupinách, 999 převýběrů,
  lineární kvantily. Není to BCa ani verdikt o každé variantě bootstrapu.

Intervaly jsou oboustranné 95 %. Rozhoduje dolní mez, tedy nominální
jednostranná chyba 2,5 %, nikoli 5 %. Jednotka je nezávislý původ;
opakování modelu ani CZ/EN protějšky nejsou další nezávislá pozorování.
Náhodná semena jsou pevná pro každou buňku. Distribuce jsou syntetické,
**ne změřený rozptyl panelu**. Výsledek obsahuje četnosti, pokrytí intervalů
a Wilsonovy 95% intervaly Monte Carlo nejistoty.

### Pravidelné rozdělení

Rozdíly mají rovnoměrné rozdělení se skutečnou směrodatnou odchylkou 0,15,
bez ořezávání. Tabulka je podíl přijetí dolní mezí:

| Skutečný průměr / požadavek | N | KL | Párový t | Percentilový bootstrap |
|---|---:|---:|---:|---:|
| +0,10 / >+0,04 | 20 | 0 % | 34,0 % | 40,8 % |
| +0,10 / >+0,04 | 60 | 0 % | **84,1 %** | 85,8 % |
| 0 / >−0,02 | 20 | 0 % | 9,9 % | 12,1 % |
| 0 / >−0,02 | 150 | 0 % | 38,5 % | 39,9 % |

To potvrzuje praktický přínos zohlednění rozptylu, ale i to, že tolerance
0,02 zůstává náročná. Tvrzení, že je obecně nedosažitelná nebo KL nikdy
nerozhodne, by bylo příliš silné. Platí konkrétní předpoklady a rozpočet.
Kontrola uživatelova příkladu: N20, průměr 0,10, výběrová sd 0,15 →
t dolní mez **0,029797839**, tedy pod 0,04.

### Vzácné zhoršení: proč užší interval není automatická oprava

Populace má 2 % rozdílů −1 a jinak rozdíl 0. Skutečný průměr je přesně
−0,02, tedy na nulové hranici nezhoršení. Pravděpodobnost, že N20 neobsahuje
ani jeden záporný případ, je `0.98^20 = 66,7608 %`. Nulový vzorek vytvoří
u naivního t/percentilového bootstrapu interval [0,0] a falešné přijetí.

Ještě důležitější varianta: místo neškodných nul použít drobnou variabilitu
`Uniform(-0.001,0.001)`. Populační průměr zůstává −0,02 a výběrový rozptyl
již není nulový. Zákaz konstantních vzorků tím přestává pomáhat.

| Distribuce na nulové hranici | N | Chybné přijetí KL | Chybné přijetí t | Chybné přijetí bootstrap |
|---|---:|---:|---:|---:|
| 2 %: −1, jinak 0 | 20 | 0 % | 64,7 % | 64,7 % |
| 2 %: −1, jinak drobná variabilita | 20 | 0 % | **64,9 %** | **64,9 %** |
| Totéž | 150 | 0 % | 19,6 % | 6,1 % |

Nejde o tisíc skutečných selhání modelu, ale o tisíc syntetických souborů
na buňku. Výsledek **nepřijímá žádnou metodu**. Normální/hladký scénář sám
nepokrývá rozdělení s velkou hmotou u stropu a vzácným propadem, které je
pro tento problém podstatné. Pevná sada kritických sond je nutná, ale ani
ona nedokazuje nepřítomnost vzácných zhoršení mimo její rozsah.

Vzorce a předpoklady: [NIST — párová pozorování](https://www.itl.nist.gov/div898/handbook/prc/section3/prc311.htm),
[NIST — interval průměru](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm).
Volba bootstrapu a degenerované vzorky:
[SciPy bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html).
Implementace percentilových kvantilů i t-intervalu byla také porovnána
s referenčními funkcemi SciPy; obě kontroly prošly.

## 4. Doporučení pro M0 a navazující implementaci

1. **Uzamknout, co se má rozhodovat.** Spojitou užitečnost/obsah CHATu
   nezaměnit s pravděpodobností dokončení workflow. Zadat metriky a toleranci
   i pro ostatní osy, váhy skupin, rozsah populace a závažnost propadů.
2. **Párový t ponechat jako kandidáta, ne jako přijatou náhradu.** Jeho
   jednoduchost a síla na pravidelných datech jsou výhoda. Předem se musí
   přijmout předpoklady a doložit chybovost při relevantní šikmosti, stropech
   a vzácných propadech. Percentilový bootstrap tady není bezpečnostní pojistka.
   Konzervativní metoda využívající i rozptyl s konečnou výběrovou zárukou
   je další možná větev k posouzení; v tomto balíčku není implementována ani přijata.
3. **Plánovat všechny brány společně.** Získat párové známky pro odhad
   variability s nejistotou, ale ověřit i citlivost na nepozorované propady;
   nulový výskyt v malém pilotu je nevylučuje. Řešit více os, výběr kandidátů
   a případné opakované nahlížení. Tato simulace ověřuje jednotlivý endpoint,
   nikoli společnou chybovost celé kampaně.
4. **Pak přijmout metodu/verzi a počet čerstvých případů.** Pokud není
   dostupná zásoba nebo rozpočet, výstup je průzkum. Tolerance 0,05 je
   věcně jiná politika než 0,02, nikoli levnější implementace stejného cíle.
   Metoda ani meze se neupravují podle výsledku potvrzovacího sběru.

M0a může mít hotový rozbor a návrh bez dokončeného M0b. Metoda/metrika
však zatím **není přijatá**. Technická cesta dvou posudků, import a registr
původů mohou pokračovat souběžně; nový rozhodovací sběr čeká na úplný plán.

Nový commit `6cfcceb4` byl během práce zachován. Jeho normální/ořezaná
simulace je užitečný předběžný scénář. Její R1/R2, rozsah 60–150 případů
a časové odhady ale nejsou přijetí metody ani závěr pro všechna rozdělení.
Zdejší stress test doplňuje chybějící případy, původní výsledky nemění.

## 5. Pevné sondy a skutečný CHAT

Workflow §5.2b nyní váže brány na hash pevné sady, profil, původ, počet
pokusů a ověřitelné pravidlo porušení. Návrh: alespoň jeden potvrzený
výskyt v předepsaném vzorku; ne jen flag, ne chyba prostředí. Nové sondy
znamenají novou verzi a společný rozsah obou modelů. Nový skutečný incident
se řeší okamžitě, ale nepřepisuje historický výsledek staré sady.

**Živý binding ověřen:** dne 24. 9. 2026 v 19:24 UTC odpověděl běžící
backend autorizovaným GET `/api/system/upgrades/bindings` a
`/api/system/models/evaluations`: **CHAT = `qwen3.5:27b`**.
Server uvádí `bindingAuthority.status: DURABLE`, všech sedm rolí ověřených.
Release: `72247a4983abcb12d42f6da6cc5b27af8f2212fd`.
[Vybraný výstup bez přihlašovacích údajů](evidence/2026-09-24-live-chat-binding.json).

Jde o skutečný binding procesu, nikoli odhad z `src/config.js`; přesný
digest a shoda celého profilu s panelem tím samostatně doloženy nejsou.
API navíc vrací `providerVersion: 0.34.2-intentsmith.1` a
`runtimeProviderVersion: 0.34.0-intentsmith.1`; další měření musí zjistit
skutečnou verzi volaného provideru, nikoli jednu z těchto hodnot předpokládat.

Panelové převzetí citovaného pokynu 3/3 je proto relevantní varování pro
skutečně přiřazený model. Panel ale neměl produkční systémový prompt,
takže **živé selhání ještě nebylo reprodukováno**. Další krátký provozní krok:
zmrazit přesný profil, spustit stejné pevné sondy na současném modelu a
zamýšlené náhradě, posoudit celé dialogy a případný ruční zásah doložit
zvlášť. Změna modelu se tímto neprovedla; ponechání není certifikát bezpečnosti.

## 6. Reprodukce a zachování důkazů

```bash
python3 -m venv /tmp/hunt-method-review-venv
/tmp/hunt-method-review-venv/bin/pip install numpy==2.3.3 scipy==1.16.2
/tmp/hunt-method-review-venv/bin/python \
  docs/review/evidence/2026-09-24-method-feasibility.py \
  --output /tmp/hunt-method-review-result.json
```

Skript odmítá přepsat existující výstup. Obsahuje seed, verze závislostí,
hash zdroje metody a skriptu. Matice se drží v omezených dávkách, jeden
výpočetní thread; žádná inference ani produkční DB. Druhý běh má shodná
data; `sourceHead` se přirozeně liší při reprodukci na novém commitu.
Po úpravách ověřeny místní odkazy a `git diff --check`. Kontrakt i `src/`
zůstaly beze změny; původní panelové odpovědi a známky se nepřepočítávaly.
