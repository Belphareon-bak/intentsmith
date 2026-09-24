# GPU hunt — zapracování revize cílového workflow

24. 9. 2026 · **DESIGN_REVIEW / NO_RUNTIME_CHANGE / NO_AUTONOMOUS_GO**.
Kontrolovaný základ `805148c5a7171654b9ef7c1d89a5d9a14b09db73`.
Autorita: operátor předal revizi návrhu navazující na zadání celého workflow.
Přímé zadání max. dvou nesouvisejících rolí a nejméně dvou hodnotitelů
zůstává odlišné od nových návrhů politiky, které teprve vyžadují přijetí.

Zdrojová příloha: `faf96f60-28c7-4322-8fb2-a3ab4224b3aa/Pasted text.txt`,
SHA256 `003ca65fd84c71dc151dfe054b21b91419cdad3a5c91560f9c6773e7b90c14e0`.
Výsledný dokument: [GPU-HUNT-WORKFLOW](../GPU-HUNT-WORKFLOW.md).

## Co se změnilo

| Nález | Zapracování / potřebné upřesnění |
|---|---|
| Chybí proveditelnost rozhodovacího pravidla | §5.2a vyžaduje zdroj pilotních párových známek, odhad síly a počtu skupin, citlivost, kontrolu skutečné rozhodovací funkce, náklad a dostupnou zásobu případů před měřením. Nejistota a tolerance všech os, nejen hlavní přínos. |
| Chybí náprava kritické vady jako důvod výměny | §8 přidává návrh třetí cesty: reprodukovaná náprava, nové případy stejné schopnosti, absolutní brány a nezhoršení ostatních os. Není to již přijatá třetí větev kontraktu. |
| Kritická podmínka byla příliš relativní | §5.2b uvádí konkrétní návrh absolutních bran po rolích. Přijatou bránu musí splnit i kandidát proti vadnému současnému modelu. Selhání obou není zdravý stav PONECHAT. |
| Není zdroj čerstvých případů | §5.4 definuje zdroje, původ, deník expozice a oddělení vývoje, přejímky hodnotitelů, benchmarku, provozního potvrzení a dohledu. Nový překlad ani mutace nepřidají nezávislou skupinu. |
| Lokální hodnotitelé mohou zablokovat stavbu cesty | §4.4 odděluje implementaci/import dvojích posudků a asistované GPT/Opus review od přejímky místních modelů. Ani externí značky neznamenají automatickou kvalifikaci. |
| Rodinný střet | §4.2: při jednom hodnotiteli stejné rodiny jako kandidát musí být druhý z jiné; stále se ověřují chyby dvojice. Žádné self-grading přes jiný tag. |
| Měří se holý model místo produkce | §6 výslovně vyžaduje produkční prompt, thinking, nástroje a limity; konfigurace je identita kandidáta a musí být vynucená. Historický CHAT panel je průzkum bez systémové zprávy aplikace. |
| Výběrová data se mohou přimíchat do potvrzení | §8: rozhodovací interval pouze z nové zmrazené provozní sady, pár/profil vybrán před ní. Více potvrzovaných kandidátů vyžaduje předem určené řešení více porovnání. |
| Hodnotitel přehlédne přesné číslo v próze | §7.1: extrakce tvrzení s citací/jednotkou/pozicí a následný výpočet v kódu. Extraktor má vlastní přejímku na negacích, citacích a sebeopravách. |
| Kontrola jen finálního tahu přehlédne únik | §7.1: signály ve všech tazích směřují k posouzení, nevyrábějí samy významové skóre. |
| Náklady dvojího hodnocení | §7.5: cache podle úplné identity hodnoticího vstupu a hodnotitele; původ, počet pokusů a výkonové údaje se zachovají. Pilot časů hodnotitelů je samostatný. |
| Sedm rolí na jedné kartě | §9: měřit load/unload, cold/warm latenci, čekání CHATu a délku celého postupu. Interaktivní práce má prioritu; ta neobchází nezávislost. |
| Jednorázový cizí proces zastaví okno | §5.3: návrh obecné resource/časové politiky bez výjimek pro aplikace. Okamžitá reakce na nedostatek rezerv/nejistou telemetrii zůstává. Rušení odděleně zneplatní výkon; obsah lze zachovat jen při doložené platnosti. |
| Není seznam operátorských rozhodnutí | Nový §0 rozlišuje již zadané požadavky od konkrétních otevřených parametrů. Maximum 2 a dvojí hodnocení jsou zapsány v hlavním i hunt DIRECTION; není třeba se na ně ptát znovu. |

## Tři doporučení nebylo možné převzít doslova

**1. Statistická čísla review nejsou reprodukovatelná z dodané přílohy.**
Dolní mez +0,027 a odhad 50–140 skupin nemají dodané párové známky,
metodu intervalu, předpoklad variability ani cílovou sílu. Stávající úplné
kritériové známky pokrývají jen 119 záznamů; jeden čeká na rozsouzení,
1 076 úplných dialogů je neoznámkovaných. Opusův součet /72 je výběr
binárních kontrol ve 12 scénářích, není plná přijatá párová metrika.

Provedena reprodukce **existující funkce** `boundedGroupInterval()`
z `src/eval/code-pilot-decision.js`, nikoli nové hodnocení modelů:

| Hypotetický pozorovaný průměr rozdílu | Dolní mez při 20 skupinách / 95 % | První N s dolní mezí >0,04 při přesně stejném pozorovaném průměru |
|---|---:|---:|
| +0,08 | −0,491425 | 4 598 |
| +0,10 | −0,474913 | 2 042 |
| +0,17 | −0,415479 | 434 |

Poslední sloupec **není power analýza ani doporučený počet úloh**. Drží
pozorovaný průměr konstantní a používá současnou konzervativní KL funkci,
která závisí na průměru, rozsahu a N. Ukazuje zásadní význam volby metody;
neprokazuje, že je toto vhodná či přijatá metoda pro nový CHAT profil.
Při průměru +1 a 20 skupinách tatáž funkce dává dolní mez +0,663133,
takže obecné tvrzení „s 20 skupinami nelze nikdy rozhodnout“ by neplatilo.

Správná změna plánu je povinná proveditelnost **před** potvrzovacím sběrem.
Neprovádí se tichá náhrada metody užší po shlédnutí výsledku. Přijatý plán
bude potřebovat reálná párová data a explicitní statistické předpoklady;
tento dokument ani ilustrace ho nenahrazují.

**2. Syntetické negativy nejsou neomezený zdroj nezávislé pravdy.**
Konstrukcí lze doložit konkrétní chybnou hodnotu či stav, ale výměna slova
v odvolané hypotéze nemusí zkazit výslednou odpověď. Mutace musí mít
ověřený dopad na konkrétní kritérium, pozitivní protějšek a původní skupinu.
Přijetí volného významového hodnocení stále vyžaduje i přirozené nové
odpovědi a nezávisle přijaté reference.

**3. Saturace nedává oprávnění vynechat dvojí významový posudek.**
Čistě mechanicky lze uzavřít plně mechanicky ověřitelný požadavek. Pokud
zbývá význam, oba posudky zůstávají povinné. Úsporu umožní přesná cache,
ne předpoklad „minule všichni prošli, teď stačí vzorek“. Shodný transkript
také neznamená stejné zadání, přejímku nebo platnost hodnotitele.

## Ověření a reprodukce

- Přímo znovu přečteny `preview.graders[0]`, max. 3, mez 0,15, čtyři
  dvojice přes jména a `measurementReady:false`. §14 původního dokumentu sedí.
- [Kontrolní skript](evidence/2026-09-24-workflow-method-check.mjs)
  a [výsledek](evidence/2026-09-24-workflow-method-check.json) reprodukují
  intervalové ilustrace, počet 20 deklarovaných skupin, 396 úplných trojic
  a 25 bajtově shodných trojic. Nezávislost jejich původu tím nebyla přejata.
- Znovu spuštěn původní `verify-observations.mjs`; výsledek je strukturálně
  identický s `opus-reconciliation-20260924/observations.json`. Tím byla
  znovu ověřena vazba exportu na celý deník, 3 472 volání, 1 200 dialogů,
  profil a původní zdrojové hashe. Původní data a známky se nezměnily.
- Ověřeny místní odkazy změněných dokumentů a `git diff --check`.
  Evaluační kontrakt z 18. 9. je nezměněný, stejně jako produkční kód.

Reprodukce bez inference a bez produkční DB:

```bash
node docs/review/evidence/2026-09-24-workflow-method-check.mjs
```

## Co zůstává k provedení

Opraven je **návrh**, nikoli chybějící runtime. Další implementační krok
je společná cesta pro dva verzované posudky a spory nad již existujícím
sběrem. Lze ji ověřovat kontrolními a asistovanými exporty, aniž se
prohlásí za přijatý lokální hodnotitel. Současně je potřeba připravit
konkrétní produkční profily, referenční data a proveditelný rozhodovací
plán; až potom má význam nový potvrzovací běh pro změnu role.

Přijetí číselných limitů, mapy bran, třetí rozhodovací cesty a případného
automatického externího API zůstává viditelnou operátorskou položkou v §0.
Maximálně dvě role a dva nezávislí hodnotitelé už položkou k opakovanému
schválení nejsou. Žádná nová inference, odeslání dat ani aktivace v tomto kroku.
