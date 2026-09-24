# GPU hunt: dvojí hodnocení a rozhodovací brána

25. 9. 2026 · `work/hunt-model-controls-20260917` · **IMPLEMENTATION_REVIEW / NO_GO**

## Výsledek

Dva přijatí hodnotitelé mohou postupně oznámkovat tentýž neměnný sběr
odpovědí. Každý jejich posudek má vlastní append-only řádek v DB. Souhrnné
`COMPLETE` vznikne pouze při shodě po jednotlivých kritériích, se správnou
identitou obou hodnotitelů, artefaktu odpovědí a kontraktu. Chybějící druhý
posudek a neshoda zůstanou `BLOCKED` s viditelným důvodem. Odvolání
přejímky zavře opětovné použití skóre bez mazání historie.

## Co se změnilo

- `model_evaluation_grader_reviews` (migrace 117) uchovává oba posudky
  odděleně a zakazuje UPDATE/DELETE.
- Automatické hodnocení před inferencí vyžaduje jedinou nezávislou dvojici
  přijatých artefaktů, různé digesty a známé různé rodiny; žádný z nich nesmí
  být hodnoceným artefaktem. Na jedné GPU běží postupně. Manuální první
  posudek je možný pouze jako průzkumný podklad.
- Zápis ověřuje zdrojový kontrakt, odpovědi, počty opakování, dílčí známky
  a souhrnný průměr. Čtení `COMPLETE` ověřuje fyzické dva řádky včetně hashů
  a digestu původního modelu. Stejné celkové skóre se sporem po kritériích
  neotevře rozhodování.
- Sémantické provozní přijetí nově vyžaduje obě přejímky; historické
  jednosoudcovské přijetí se zobrazuje, ale není rozhodovací autoritou.
- Studio zobrazuje stav čekání/sporu, podrobnosti obou posudků a u rozsouzeného běhu také lidské rozhodnutí s důvody.
- Migrace 118 přidává append-only rozsouzení. CLI `scripts/adjudicate-model-collection.mjs --plan` vydává anonymní podklad bez původních známek; `--run` vyžaduje přesný hash sběru, vyplněné odůvodnění ke každému kritériu a zálohu DB. Shodné známky nesmí změnit.

Jméno rodiny je konzervativní technická kontrola nezávislosti, ne důkaz
nezávislosti chyb. Tu musí doložit přejímka dvojice na oddělených případech.

## Ověření

Cílené syntetické testy po změně:
`evaluation-grading-acceptance` 22/22;
`desktop-hunt` 40/40;
`model-evaluation-read-model` 26/26;
`schema-migrations` 61/61; `m1-model-failover-schema` 20/20;
`artifact-validation` 160/160; M6 runtime evidence 8/8.
Tyto výsledky jsou lokální cílené běhy nad vývojovou verzí. Negativní testy
pokrývají jeden posudek, shodný součet při rozdílných kritériích,
odvolání přejímky, pokus o přepsání uloženého posudku, změnu odpovědi,
změnu souhrnného skóre a záměnu digestu modelu.

Tato ověření používají umělé fixture. Nedokazují kvalitu místních hodnotitelů,
předpovědní platnost sady ani bezpečnou autonomní výměnu bindingu.

## Zbývá do GO

1. Skutečná lidská rozsouzení sporů na čerstvých slepých případech a přijatá nezávislá dvojice pro každou
   sémantickou sadu, včetně měření společných falešných přijetí/odmítnutí.
2. Nová vícekolová CHAT sada se skutečným produkčním profilem, nebo vědomé
   omezení CHAT na dosavadní roli; `chat_v3` není oprávněná náhrada.
3. Dostatečná zásoba nových nezávislých provozních případů pro všech sedm rolí
   a předem zamknutý proveditelný rozhodovací plán; metoda schema 2 je zatím
   jen plánovací nástroj.
4. Vyřešení již konfliktní živé sestavy rolí bez svévolného snížení kvality,
   kontrola všech fallbacků a fyzický end-to-end průchod s návratem.

Pro aktuální rozhodnutí o CHAT zůstává
[průzkumný pilot M0](2026-09-24-HUNT-M0-DECISION-METHOD.md)
`NO_BINDING_CHANGE`. Skóre z jednoho Opusova posudku se nepromění v
autoritativní známku tím, že nová implementace dvojice prošla testy.
