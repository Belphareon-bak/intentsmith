# GPU hunt — skutečný druhý posudek CHAT a uzavření revize simulace

**27. 9. 2026 · TWO_REAL_EXTERNAL_DRAFTS / ADJUDICATION_PROPOSED / REVIEW_PENDING / NOT_DEPLOYED / REAL_NO_GO.**

Navazuje na posudek `hunt-authorized-completion-20260927-check/REVIEW.md` a zmrazené hodnocení Opusu. Autoritou změny je přímé zadání operátora a tato revize. Nové inference, import do živé DB, výměna ani mazání modelů neproběhly.

## Výsledek, který lze nyní prohlédnout

[Dotaz → celý dialog modelu → obě známky a důvody](</mnt/vi7000/intentsmith/evidence/hunt-chat-real-two-reviews-20260927/comparison.html>).
[Rozbor všech 19 větších sporů](</mnt/vi7000/intentsmith/evidence/hunt-chat-real-two-reviews-20260927/adjudication-proposals.md>).

Oba skutečné externí LLM posudky pokrývají shodných **80 dialogů / 320 kritérií** ze stejného nového sběru CHAT. Nejsou to simulované známky ani lidská přejímka. Původní soubory a simulace zůstávají oddělené.

| CHAT, 40 dialogů na model | Codex, vážené | Skutečný Opus, vážené | Opus, bez vah |
| --- | ---: | ---: | ---: |
| qwen3.8:latest | 86,2625 % | 85,6750 % | 86,9375 % |
| qwen3.5:27b | 84,2000 % | 79,0750 % | 79,9375 % |
| Rozdíl qwen3.8 − qwen3.5 | +2,0625 p. b. | +6,6000 p. b. | +7,0000 p. b. |

Váhy jsou původní 40/30/20/10 % pro factual/usefulness/conversation/communication. Nejprve se váží čtyři kritéria jednoho dialogu, potom se počítá průměr 40 dialogů. Opusových přibližně 0,834 je **nevážený průměr 320 kritérií** (83,4375 %), nikoli vážené skóre modelu. Vážený průměr přes oba modely je 82,3750 %. V JSON jsou i osy, CS/EN, přesné digesty a soubory zdrojů.

**195/320 kritérií je přesně stejných; 301/320 (94,0625 %) se liší nejvýš o 0,25.** Větších rozdílů je 19 ve 14 dialozích. Práh se porovnává v celých setinách. Shoda do čtvrt bodu není důkaz správnosti ani přejímka místních hodnotitelů.

Původní rozdíl +2,1 p. b. popisoval první/simulované posouzení. Nový skutečný posudek má +6,6 p. b.; nelze ho tedy popsat jako další potvrzení téhož číselného rozdílu. Bodový rozdíl přes práh 4 p. b. sám neprokazuje zlepšení: rozsouzení a provozní kvalifikace chybí. Posudky se neprůměrují do přijaté matice. **Žádný nový verdikt ZMĚNIT nevzniká.**

## Rozsouzení a co potřebuje operátor

Zpracoval jsem všech 19 sporů: **13 konkrétních návrhů známky, 6 neuzavřených kvůli rozsahu/vlastnictví kritéria.** Jde o exponované třetí čtení Codexu, nikoli třetí nezávislý hlas. Žádný původní posudek se nepřepsal; návrhy nemají rozhodovací autoritu.

K revizi jsou především čtyři pravidla, podrobně s příklady v rozboru:

1. Jedna vada má jednoho vlastníka v rubrice. Například neověřené vydání odvozené z nového manifestového data patří do kritéria, které výslovně vlastní toto nové datum, nikoli současně do dvou různě vážených os.
2. Rozlišovat opravu před odesláním téhož tahu od chyby odeslané uživateli a napravené až v dalším tahu. Společné pravidlo musí být stejné pro oba hodnotitele.
3. Rozlišovat dané systémové datum, chybný kalendářní výpočet a nezadané časové ukotvení úlohy. U schůzky je průnik 10:30–11:00 správně; přidané „dnes“ je samostatná věc.
4. U `f0b7e5c0` Nela a SECRET-17 opravdu znovu zazní, ale v bloku **Internal Security Note**, výslovně odděleném od veřejné zprávy. Opusův popis „přímo ve veřejné zprávě“ je nepřesný. Návrh .5 na tomto kritériu zachovává částečné splnění podle operátorova dřívějšího stanoviska; celý výstup tím není bezpečný k automatickému zveřejnění a nejde o nulu celému dialogu.

HTML obsahuje všech 80 úplných rozhovorů. Výchozí výběr 36 odpovědí slučuje větší spory, přiznanou nižší jistotu, všech 8 Opusem označených rizik a tři mechanicky vybrané další odpovědi. Důvod je u každé položky. Náhodná kontrola je po hodnocení, nikoli předem vyhrazený přejímací vzorek. Těch 36 není povinný nový úkol pro operátora: nejprve stačí čtyři pravidla výše a jejich konkrétní příklady.

## Opravy kódu podle posudku

### P2 — oběma stejná rubrika

`export-chat-prod-canary-review.py` nyní vyžaduje explicitní `--rubric-policy`. Kompletní pravidla a jejich SHA jsou v novém packetu i HTML, oba hodnotitelé dostávají stejný `REVIEWERS.md` a šablonu. Validátor kontroluje hash pravidel; změna packetu zneplatní vazbu starého posudku. V automatickém soudci byla odstraněna jednostranná věta o samoopravě; platí jen pravidla předaná společnou verzovanou politikou. Verze soudce je `semantic-rubric.7-shared-policy`.

Důležité upřesnění příčiny: pravidlo o samoopravě již existovalo ve zdrojové fixture v3, ale starý export ho neobsahoval. Pozdější přidání jen do `SECOND-REVIEWER.md` vytvořilo asymetrii. Opus je výslovně ignoroval, proto lze porovnat původní známky proti stejným vyexportovaným kritériím. **Neznamená to, že se tím vyřešila jejich nejasná interpretace.** Zvláště opravy mezi tahy jsou v rozboru otevřené.

Zmrazené instrukce, packet a známky zůstaly beze změny. Pro aktuální srovnání platí pouze původní packet; nový exporter není záminka přepsat SHA starých posudků. Nová společná pravidla mohou vyvolat oddělené přehodnocení, ne nový sběr, pokud se nezměnilo zadání a profil. Kalendářní datum je v exportu fakt, nikoli instrukce automaticky přiznat bod.

### P2 — simulace nemůže získat produkční autoritu

Produkční writer přejímek a rozsouzení odmítne `simulation:true`, `simulated:true` i označené simulované identity v provenienci. Čtení historických přejímek, použitelných známek, uloženého původního rozsouzení a doporučení kontroluje totéž. Revokace zůstává možná. Historický detail lze stále zobrazit; aktuální použitelné skóre je blokované a doporučení nemůže být akční.

Simulátor má výjimku pouze pro konkrétní **nové prázdné DB spojení registrované před migracemi**. Nenastavuje se JSONem, env přepínačem ani HTTP parametrem. Při kopii nebo opětovném otevření DB výjimka zaniká. Finální převod kvalifikace na produkční doporučení simulaci odmítá i z takového spojení. Nejde o kryptografickou obranu proti úmyslnému přepsání veškeré provenience administrátorem; je to ochrana před přijetím označených simulačních podkladů.

Regrese výslovně testuje i záznam s korektními přepočítanými hashy, kde `simulation:true` zůstalo pouze v uloženém rozsouzení a v metadatech běhu chybí. Samotné odvolání předchozích přejímek nebo jiný kontrakt už není jedinou zábranou.

### P3 — 48 znamenalo čtyři soubory

Historických 48 bylo 4 + 23 + 7 + 14 testů ve čtyřech souborech, nikoli 48 testů `hunt-completion-simulation`. Původní revizní dokument nyní uvádí rozpad. Neměnil jsem historické deníky ani manifest simulace.

## Reprodukce a důkazy

Srovnání spouští existující `compareHuntBlindReviews`, nezávisle validuje oba posudky a čte identity až pro výsledkový rozpad. Nový reprodukovatelný vstup je `scripts/manual/compare-chat-review-pair.mjs`. Úplný příkaz a hashe jsou v [README balíčku](</mnt/vi7000/intentsmith/evidence/hunt-chat-real-two-reviews-20260927/README.md>).

- Packet: `fdb11f598a294a13fccd84fe78f26d7503a6c6c4de44ce34bd404367d31d7f5c`.
- Codex: `1f38bddb0b322446ddf356d4cb443913084ecfd6c1f1d6a2f0659693595fab70`.
- Opus: `23af3d5c9d0200d8b670d4731a90c881999ef8ba67195662367293df3250d221`.

Přesné výsledky cílených testů jsou v `verification/`, ověření prohlížeče v `browser-checks.json`. Závěrečný souhrn: **330/330 testů**, **9/9 kontrol v Chromium**, registry **542 programů**, module boundary **1 430 hran beze změny / 3 cykly / 28 členů**. Rozpad testů: společná sada pěti souborů 60 (4 simulace + 24 grading acceptance + 11 review validator + 7 capture + 14 role collection), dále semantic 18, store acceptance 17, read model 26, pairwise 49 a artifact validation 160. Nejde o úplný release audit ani o nasazení kódu.

## Stav vůči GO

Nový CHAT již má **dva skutečné úplné posudky**; čekání na druhý posudek této dvojice končí. Zbývají společná interpretace několika pravidel, rozsouzená reference, skutečná přejímka místní nezávislé dvojice a čerstvé provozní ověření. Tento sběr neuzavírá chybějící buňky ostatních rolí ani desetimodelovou produkční matici. Produkční výběr zůstává **NO_GO** z těchto konkrétních důvodů, nikoli proto, že nebyl dodán druhý posudek.
