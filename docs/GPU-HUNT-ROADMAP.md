# GPU hunt — finální plán a cesta k němu

**Datum:** 24. 9. 2026. **Adresát:** operátor (rozhodnutí v §2) a implementátor (milníky v §4).
**Stav:** návrh k přijetí; **není implementační GO** ani změna přiřazení rolí.
Podrobný cílový návrh je [GPU-HUNT-WORKFLOW](GPU-HUNT-WORKFLOW.md); tento dokument
z něj vybírá cílový stav v kostce a určuje **pořadí práce, výstupy a podmínky dokončení**.

## 1. Cílový stav v kostce

| Oblast | Jak to bude fungovat |
|---|---|
| Sestava | Sedm rolí (D1, D2, CODE, R1, R2, CHAT, VISION). Přednost má jeden model na roli, nejvýše dvě nesouvisející role na model a žádná vlastní revize. Identita se určuje podle digestu a původu, ne podle jména. Kontroluje se i fallback. |
| Měření | Kandidát se měří v **produkčním profilu role** (prompt, thinking, nástroje, limity). Ten je součástí identity kandidáta. Sady jsou verzované a případy mají evidovaný původ a expozici. |
| Případy | Oddělené zásoby pro vývoj, přejímku hodnotitelů, výběrový benchmark, **provozní potvrzení** a dohled. Použitý případ už nikdy není čerstvý. |
| Známka | Nejdřív mechanicky: testy, produkční parser, extrakce čísla s citací a výpočet v kódu, kontrolní signály ve všech tazích. Potom **dva slepí nezávislí hodnotitelé** po kritériích s důkazem a s možností `null`. Při neshodě se nejdřív ověří fakt, potom se přizve třetí hodnotitel a nakonec rozhodne operátor. |
| Hodnotitelé | Přechodně GPT + Opus (ruční předání). Místní hodnotitelé běží nejdřív ve stínovém režimu a přejímkou na oddělených případech a syntetických negativech je nahradí. Dvojice se přijímá i podle společných chyb a má rezervu. |
| Rozhodnutí | Plán se uzamkne **včetně proveditelnosti** (síla testu, počet skupin, rozpočet). Metoda pracuje s rozptylem. Existují **tři cesty**: vyšší kvalita, vyšší rychlost bez zhoršení a odstranění kritické vady bez zhoršení. Platí absolutní brány. Interval se počítá jen z čerstvé potvrzovací sady. NEROZHODNUTO znamená ponechat. |
| Aktivace | Začíná se pod dohledem. Před aplikací se znovu ověří důkazy a baseline, po aplikaci se ověří načtení a běží dohled. Rollback je vyzkoušený. Autonomie se uděluje po rolích. |
| Provoz | Rozpočet zahrnuje sběr, obě hodnocení, spory a ověření. Ochrana GPU rozlišuje nedostatek rezervy od krátkého cizího zatížení. Celou cestu je vidět v UI: zadání → model → odpověď → A → B → důkazy → rozsouzení → rozhodnutí. |

## 2. Rozhodnutí operátora

Už zadáno a zapsáno v DIRECTION, **neptat se znovu**: role podle modelů, max. dvě
nesouvisející role, žádná vlastní revize, nejméně dva nezávislí hodnotitelé.

K rozhodnutí (s doporučením). Bez nich nelze uzavřít milník v posledním sloupci:

| # | Rozhodnutí | Doporučení | Potřeba pro |
|---|---|---|---|
| R1 | Rozhodovací metoda pro spojité rozdíly (CHAT, rubrikové role) | **Párový 95% t-interval nad rozdíly po skupinách původu**. Bootstrap jen jako kontrola citlivosti, nerozhoduje. Stávající `boundedGroupInterval` (KL) v simulaci nerozhodne ani při 250 skupinách (viz §6). Ponechat ji jen pro binární CODE pilot, dokud se nerozhodne zvlášť. | M0 |
| R2 | Meze CHAT | Přínos **0,04** ponechat. Toleranci nezhoršení zvýšit z 0,02 na **0,05**: 0,02 při rozptylu σ ≥ 0,2 nemá ani při 250 skupinách sílu nad 35 %. | M0 |
| R3 | Chyby a síla | Chybné přijetí ≤ 2,5 % (dolní mez 95% intervalu), cílová síla 80 %. | M0 |
| R4 | Třetí cesta výměny (odstranění kritické vady) | Přijmout podle workflow §8. | M0 |
| R5 | Absolutní brány CHAT | (a) převzetí pokynu z citovaného textu CZ/EN, (b) únik chráněného údaje v **kterémkoli** tahu, (c) vydávání neprovedeného úkonu za provedený. Platí na **pevné verzované sadě sond**. Porušení = reprodukovatelné selhání v rámci této sady. | M1 |
| R6 | Externí hodnotitelé | Povolit ruční předání GPT/Opus pro CHAT panel (syntetický obsah). U případů odvozených z projektu povolovat po dávkách. | M2 |
| R7 | Přejímací limity hodnotitelů | Navrhnout v M3 z dat. Operátor je potvrdí před přejímkou, ne podle výsledku. | M3 |
| R8 | Produkční profil CHAT | Skutečný systémový prompt role, výchozí režim thinking off. Varianta s thinking je samostatný kandidát, jen pokud se vejde do latenčního rozpočtu. | M4 |
| R9 | Latenční rozpočet CHAT | Minimálně nehorší než současný model (p50 7,3 s v panelu bez promptu). Přesnou mez určí operátor. | M4 |

## 3. Hned teď (nezávislé na milnících)

1. **Ověřit současný CHAT na branách v produkčním profilu.**
   - V panelu česky převzal pokyn z citovaného textu qwen3.5 (3/3), ale panel běžel bez systémového promptu aplikace.
   - Nejdřív zjistit skutečný živý binding (`src/config.js` ho nedokládá).
   - Potom pustit sondy injekce, úniku a vydávání neprovedeného úkonu za provedený na živý model se skutečným promptem. Je to krátký běh.
   - Pokud selže, operátor rozhodne o ručním zásahu podle workflow §8. Jde o označený zásah, ne statisticky prokázanou výměnu.
   - Kandidáta pro takový zásah (qwen3.8 v panelu 6/6) je nutné nejdřív ověřit stejnými sondami v produkčním profilu.
2. **Zapsat rozhodnutí R1–R4 do DIRECTION**, jakmile je operátor přijme. Bez nich M0 nekončí.
3. **Během sběrů vypnout v RustDesku test hardwarových kodeků.** Jeho zhruba hodinová ~1 s zátěž NVENC zastavila čtyři okna. Je to provozní opatření, dokud neexistuje politika z workflow §5.3; ochrana se neoslabuje.

## 4. Milníky

Odhady jsou hrubé. Dominuje příprava případů a průchodnost hodnocení.

### M0 — Rozhodovací metoda a proveditelnost (1–2 dny)

**Cíl:** pravidlo, které při reálném rozpočtu umí rozhodnout, a nástroj, který to
spočítá **před** sběrem.

- M0a (hned):
  - rozhodovací funkce pro spojité rozdíly (párový t) s testy, KL zůstává pro CODE pilot;
  - plánovač proveditelnosti, který přes **skutečnou** rozhodovací funkci simuluje chybné přijetí a sílu pro všechny tři cesty a vrátí `PROVEDITELNÉ` / `JEN PRŮZKUM` / `NEPROVEDITELNÉ` s potřebným počtem skupin a rozpočtem;
  - zapsat R1–R4.
- M0b (po M2b): nahradit předpoklad σ = 0,1–0,3 odhadem z párových dvojích známek panelu. Zjistit, jestli se σ zmenší průměrováním CZ/EN a opakování uvnitř skupiny.

**Hotovo když:** plánovač má testy (včetně toho, že KL pro spojité rozdíly vrací
NEPROVEDITELNÉ). Metoda a meze jsou přijaté v DIRECTION a kontraktu. σ z pilotu je
zapsané s nejistotou.

### M1 — Zásoba případů a brány (start hned, 1–2 týdny pro CHAT; kritická cesta)

**Cíl:** dost čerstvých nezávislých skupin pro jedno potvrzení CHAT a verzované sondy bran.

- Registr případů: zdroj, oprávnění, hash, rodina/původ, reference, oddíl, deník expozice.
- Stávajících 20 skupin panelu zařadit jako **vývoj/kalibrace** (exponované).
  - Smějí sloužit i jako výběrový benchmark, protože rozhodnutí se počítá jen z potvrzení.
- Nové CHAT skupiny pro **provozní potvrzení**: počet z plánovače.
  - Plánovací rozsah je **60–150** podle σ (§6).
  - Český primár a anglický protějšek patří do téže skupiny.
  - Zdroje: skutečné komunikační potřeby, dokumenty a incidenty (princip „odvozovat, nevymýšlet“).
- Oddíl pro přejímku hodnotitelů (~40 skupin) a generátor syntetických negativů.
  - Každá mutace nese důkaz porušeného kritéria a je seskupená pod původní případ.
- Sady sond bran CHAT v1 (R5), CZ/EN, 10–20 sond na bránu.

**Hotovo když:** oddíly jsou zmrazené s hashi, počet v potvrzovacím oddílu je ≥ požadavek
plánovače a sondy v1 přijal operátor.

### M2 — Dvojí hodnocení (4–6 dní)

**Cíl:** jedna cesta pro dva verzované posudky od balíčku po rozhodovací čtení.

- M2a, implementace:
  - zmrazený slepý balíček;
  - import exportu A a B po ID a kritériích;
  - mechanické důkazy (parser, extrakce + výpočet, kontrolní signály přes všechny tahy);
  - tok sporů (ověřit fakt → třetí posudek → operátor);
  - cache podle úplné identity vstupu;
  - `graders[0]` nahradit dvojicí s propagací do přejímky i rozhodovacích cest;
  - UI s A a B vedle sebe.
- M2b, ověření:
  - nejdřív kontrolní záznamy;
  - potom GPT + Opus nad **opakováním 1 panelu (400 dialogů)**. Opakování spolu silně korelují, takže tohle stačí pro referenci i pilot σ.
- Negativní cesty v testech:
  - model nehodnotí sebe (digest, alias ani rodinné pravidlo);
  - chybějící druhý posudek ≠ GO;
  - odvolaná přejímka zavře závislá rozhodnutí;
  - restart neztratí data.

**Hotovo když:** 400 dialogů má dva posudky a rozsouzené spory, negativní cesty jsou
zelené a M0b má data.

### M3 — Místní hodnotitelé (3–5 dní + výpočet; souběžně po M2a)

**Cíl:** nahradit externí dvojici lokální, kde to data dovolí.

- Kandidáti z různých rodin hodnotí stínově, bez autority, na oddílu přejímky a syntetických negativech.
- Měří se:
  - chybná přijetí a odmítnutí podle typu kritéria a jazyka;
  - stabilita při změně pořadí a délky;
  - schopnost dát `null`;
  - chybovost parsování;
  - společné chyby dvojice.
- Limity (R7) se uzamknou před přejímkou.

**Hotovo když:** jsou ≥ 2 přijatí lokální hodnotitelé pro rozsah CHAT a rezerva, **nebo**
je doložená nedostupnost. Pak M4 běží s externí dvojicí (R6), nebo čeká.

### M4 — CHAT kampaň v produkčním profilu (2–4 dny)

**Cíl:** první řádné rozhodnutí role.

1. Uzamknout produkční profil CHAT (R8, R9) a ověřit živý binding.
2. **Výběr:** současný model + kandidáti (dnes qwen3.8, qwen3.6, gemma4 a nové z discovery) na benchmarku a sondách bran, s dvojím hodnocením. Kdo neprojde bránou, vypadá. Vybere se jeden kandidát, nebo předem ošetřené vícenásobné porovnání.
3. **Potvrzení:** plánovač musí vrátit PROVEDITELNÉ. Potom sběr na čerstvém oddílu, dvojí hodnocení a rozhodnutí uzamčenou metodou po třech cestách.

**Hotovo když:** existuje ZMĚNIT / PONECHAT / NEROZHODNUTO s úplnou stopou. Nic se
neaplikuje automaticky.

### M5 — Sestava a konflikty v kódu (2–3 dny; souběžně s M2–M4)

- Upravit `maxRolesPerModel` na 2.
- Matice konfliktů podle skutečného toku práce. Sdílení rolí jen podle seznamu povolených dvojic.
- Identita podle digestu a původu (aliasy = jeden model).
- Kontrola fallbacků a náhrad hodnotitele.
- Sladit `maxQualityDrop` s politikou, aby se kvalita role nemohla tiše zhoršit.

**Hotovo když:** testy odmítnou fallback CODE na model R1, vlastní revizi přes alias
a třetí roli jednomu modelu.

### M6 — Řízená aktivace a rollback (1–2 dny)

- Po schválení operátorem aplikace přes `model-binding-application`.
- Před aplikací znovu ověřit důkazy, baseline a konflikty.
- Po aplikaci ověřit skutečné načtení a pustit malou ověřovací sadu.
- Zkušební provoz s metrikami.
- **Skutečně provést rollback a návrat** v dohlíženém okně.

**Hotovo když:** fyzicky proběhne discovery/pull → sběr → A/B → spor → doporučení →
schválená aktivace → kontrola → rollback.

### M7 — Další role a autonomie (průběžně)

- Pořadí: CODE (testy jako orákulum, hodnotitelé méně kritičtí) → R2/R1 → D2/D1 → VISION.
- Každá role potřebuje sady, sondy bran, hodnotitele kvalifikované pro danou roli a verdikt plánovače PROVEDITELNÉ.
- Omezená autonomie se uděluje až po M6 pro danou roli a podle delegační politiky operátora.
- Průběžný dohled nad hodnotiteli: kontrolní případy, audit shod i neshod, sledování společných chyb.

## 5. Kritická cesta

```
M0a ──► M1 (případy, nejdelší) ─────────────────────────┐
M2a ──► M2b (400 dialogů) ──► M0b (σ) ──► plánovač ──────┼──► M4 potvrzení ──► M6
            └──────► M3 (místní hodnotitelé, volitelně) ─┘
M5 (kód sestavy) běží souběžně a musí být hotový před M6.
```

První dohlížené rozhodnutí CHAT je odhadem **3–4 týdny** od přijetí R1–R6. Nejvíc
urychlí povolení externí dvojice (R6) a včasný start M1.

## 6. Podklad pro R1/R2: simulace rozhodovacích metod

[Skript](review/evidence/2026-09-24-decision-method-simulation.mjs) (deterministický,
bez inference) a [výsledek](review/evidence/2026-09-24-decision-method-simulation.json)
používají skutečnou `boundedGroupInterval` z kódu.

**Předpoklad:** rozdíly po skupinách ~ Normal(μ, σ) ořezané na [−1, 1], nezávislé skupiny,
2 000 simulací. **σ není změřené.** Nahradí ho M0b.

Pravděpodobnost rozhodnutí (KL / párový t):

| Situace | σ | n=20 | n=40 | n=60 | n=100 | n=150 | n=250 |
|---|---|---|---|---|---|---|---|
| Přínos, skutečně +0,10 | 0,1 | 0 / 0,73 | 0 / 0,96 | 0 / 0,99 | 0 / 1,00 | 0 / 1,00 | 0 / 1,00 |
| | 0,2 | 0 / 0,24 | 0 / 0,46 | 0 / 0,61 | 0 / 0,85 | 0 / 0,96 | 0 / 1,00 |
| | 0,3 | 0 / 0,14 | 0 / 0,23 | 0 / 0,35 | 0 / 0,49 | 0 / 0,69 | 0 / 0,88 |
| Přínos, skutečně +0,15 | 0,2 | 0 / 0,64 | 0 / 0,92 | 0 / 0,98 | 0 / 1,00 | 0 / 1,00 | 0 / 1,00 |
| | 0,3 | 0 / 0,34 | 0 / 0,63 | 0 / 0,79 | 0 / 0,95 | 0 / 0,99 | 0 / 1,00 |
| Nezhoršení 0,02, skutečně 0 | 0,2 | 0 / 0,05 | 0 / 0,09 | 0 / 0,12 | 0 / 0,19 | 0 / 0,23 | 0 / 0,34 |
| Nezhoršení 0,05, skutečně 0 | 0,1 | 0 / 0,58 | 0 / 0,87 | 0 / 0,96 | 0 / 1,00 | 0 / 1,00 | 0 / 1,00 |
| | 0,2 | 0 / 0,19 | 0 / 0,34 | 0 / 0,47 | 0 / 0,70 | 0 / 0,84 | 0 / 0,97 |

Chybné přijetí na hranici drží t kolem 0,02–0,03 ve všech buňkách, KL 0.

**Závěry:**
- KL mez u spojitých rozdílů nikdy nerozhodne.
- Tolerance 0,02 je prakticky nedosažitelná.
- Počet potvrzovacích skupin určuje σ: při σ ≈ 0,2 je to ~100 skupin pro přínos +0,10 a ~150 pro nezhoršení 0,05. Proto M0b a M1 stojí na kritické cestě.

## 7. Co se nedělá

- Neměnit roli jen podle panelu nebo benchmarku, rozhoduje čerstvé potvrzení.
- Neměnit metodu, meze ani brány po zhlédnutí výsledků.
- Neznámkovat prózu regexem. Kontrolní signál jen směruje případ k posouzení.
- Nevydávat jeden posudek za dvojí ani souhlas dvou modelů za příkaz k aktivaci.
- Neměřit tak dlouho, až někdo vyhraje. NEROZHODNUTO znamená ponechat s důvodem.
- Neoslabovat ochranu GPU a neudělovat výjimky konkrétním aplikacím.
