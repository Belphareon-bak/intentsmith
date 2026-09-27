# GPU hunt: dokončený simulační průchod k celkové revizi

Datum: 27. 9. 2026. Stav: `SIMULATION_COMPLETE`, skutečná rozhodovací autorita `false`, nenasazeno.

Operátor výslovně povolil simulovat jeho i Opusovo posouzení, aby mohl zrevidovat celý výsledek. Toto povolení umožňuje dokončit zkoušku všech kroků; nedělá ze simulovaných známek skutečné nezávislé posudky. Původní odpovědi, posudky a manifesty se nemění.

Vstup k revizi: [celý průchod a proklikávací matice](</mnt/vi7000/intentsmith/evidence/hunt-authorized-completion-20260927-v2/REVIEW.html>). Obsahuje skutečný renderer Studia nad izolovanými databázemi. Není to nasazená aplikace.

## Dokončené milníky

1. **Celý CHAT v hodnoticí cestě.** Explicitní adaptér `conversationGradingSuite` předává hodnotiteli všechny tahy, přesnou rubriku, kontext sběru a váhy. Kontroluje úplnost, pořadí a hash přepisu, totožnost odpovědi i hodnotitele. Jediná závěrečná odpověď už nenahrazuje rozhovor. Předchozí výchozí plán automatického huntu se tím nezapíná ani nepřijímá.
2. **Dva posudky a rozsouzení.** Pořadí kritérií se při hodnocení obrací při zachování jejich identifikátorů; výsledek uvádí důvody. Rozsouzení přijímá setiny a pro CHAT používá váhy 40/30/20/10. Před rozhodnutím jsou dostupné celé rozhovory. Původní známky zůstávají samostatné. Shoda i rozsouzení zachovávají čas a délku původního sběru.
3. **Výsledek ve skutečném rendereru Studia.** Z hodnoceného řádku lze načíst úplný detail a rozbalit každý rozhovor, jeho oba posudky, váhy a rozsouzení. Přenosný balíček tento renderer používá s vypnutými mutacemi; skutečná aplikace ještě nebyla tímto balíčkem nasazena.
4. **Celý životní cyklus.** Zkouška zahrnuje 14 fiktivních modelů × 7 rolí: 90 hodnocených buněk a 8 VISION N/A. Čtyři kandidáti projdou simulovaným nalezením a stažením s průběhem. Následují sběr, posudky, spor, rozsouzení, přejímky, provozní páry, sestava bez vlastní revize, virtuální aktivace, selhání, rollback a opětovné otevření DB. Modely se nemažou.
5. **Skutečný nový CHAT v téže cestě.** Všech 80 rozhovorů z opraveného sběru 27. 9. projde produkčním zápisem sběru, hodnocení a rozsouzení do samostatné databáze. Skutečné odpovědi se nepřepisují; druhý hodnotitel a operátor jsou simulovaní.

## Co přesně znamenají procenta

Zdroj je výhradně `hunt-chat-context-fixed-20260927-v2`: 40 dialogů každého ze dvou přesných modelových artefaktů, 20 CS/EN skupin, poskytovatel `0.34.2-intentsmith.2`. Nový sběr se nemíchá se sběrem z 26. 9. s vadnou historií ani se staršími D/R výsledky na poskytovateli `.1`.

| Model / CHAT | Skutečný první posudek Codexu | Simulovaný druhý posudek | Po simulovaném rozsouzení |
| --- | ---: | ---: | ---: |
| qwen3.8:latest | 86,2625 % | 86,4500 % | 86,3250 % |
| qwen3.5:27b | 84,2000 % | 84,3250 % | 84,2000 % |

První posudek není nezávislá přejímka místního hodnotitele. Simulovaný druhý přebírá 313 z jeho 320 kritérií a u sedmi zkouší konkrétní alternativní interpretaci. Jejich shodu nelze vydávat za nezávislé potvrzení. Přesné SHA prvního posudku, balíčku, syrových odpovědí, kontraktu a zdrojového kódu jsou v `reviewed-chat/simulation.json` a `review-sources.json`.

Změna konečného čísla vznikla u jedné opravené srážky: viditelný mezivýpočet, který model sám správně opravil, nesnižuje správnost odpovědi. Ostatních šest sporů ponechává první posudek. Každý ze sedmi má vlastní důvod a doklad v sekci Rozsouzení. Únik v poznámce se posuzuje na příslušném kritériu, ne automatickou nulou celého rozhovoru; není vydáván za skutečné odeslání tajemství zákazníkovi.

Výsledek této skutečné dvojice zůstává **NEROZHODNUTO / PONECHAT**: rozdíl 2,125 p. b. neprokazuje požadovaný přínos CHAT 4 p. b. a nebyl přidán nový nezávislý provozní holdout. Fiktivní matice vedle něj ověřuje programovou cestu a její čísla nejsou známkami skutečných modelů.

## Simulace souhlasů a její hranice

Soubory mají označení `SIMULATED`, `simulation: true`, skutečné `actualIndependent: false` a `actualBlind: false`. Syntetické vstupy do přejímky obsahují kladné příznaky požadované smlouvou API: záměrně modelují, co by dodal přijatý posudek. Nepotvrzují skutečné lidské rozhodnutí. Identita simulovaného operátora je `SIMULATED_OPERATOR_BY_CODEX`; neposuzoval to Opus.

Lokální modely v této zkoušce neprovádějí inferenci. Jejich callback přehrává známky a záměrně je zná. Ověřuje datovou cestu, formát, úplnost a dohledatelnost; neověřuje schopnost neznámého lokálního modelu správně známkovat. Po skončení se simulační přejímky odvolají. Výchozí produkční plán tento odlišný kontrakt nepoužije. Živá DB, bindingy a instalované modely zůstávají zachované.

## Ověření a reprodukce

Regresní sada `tests/hunt-completion-simulation.test.mjs` ověřuje celý průchod i negativní případy: neúplný přepis, porušené SHA, opakované identifikátory kritérií, vlastní hodnocení, chybějící přejímku, nepřípustné rozsouzení shody a zachování původního výsledku. Samostatné prohlížečové kontroly porovnávají skutečně vykreslené tahy s uloženými daty, nestačí jim počet řádků.

Spustit z kořene repozitáře do nové prázdné cílové složky; jednotlivé podadresáře vytvářejí skripty a nepřepisují starý sběr:

```bash
node scripts/manual/simulate-hunt-lifecycle.mjs --out /nova/evidence/lifecycle
node scripts/manual/simulate-hunt-reviewed-chat.mjs --source /mnt/vi7000/intentsmith/evidence/hunt-chat-context-fixed-20260927-v2 --out /nova/evidence/reviewed-chat
node scripts/manual/build-hunt-authorized-review.mjs --out /nova/evidence
node scripts/manual/verify-hunt-completion-review.mjs /nova/evidence --authorized
```

Ověřovač prohlížeče přijímá `PUPPETEER_EXECUTABLE_PATH`. Deníky a konkrétní počty kontrol jsou součástí dokončeného balíčku. Finální balíček v2 navíc opravuje ztrátu času sběru v souhrnu dvojice a nepřesný štítek lidského rozsouzení v detailu. První simulační výstup zůstal odděleně, nové odpovědi ani nové modelové inference kvůli tomu nevznikly.

Zdrojové soubory, sqlite databáze a samostatné výsledky mají otisky; do manifestu nepatří měnitelné `-wal`/`-shm` soubory.

## Co simulace nemůže prokázat

| Oblast | Doložené nyní | Co ještě vyžaduje skutečnou evidenci |
| --- | --- | --- |
| Nový CHAT | 80 skutečných úplných rozhovorů, první známky, kompletní simulovaný průchod | Skutečný druhý posudek a přejímka lokální dvojice |
| D/R | Zachované starší sběry a oddělené posudky; úplná fiktivní cesta | Srovnatelná desetimodelová matice a dokončené rozsouzení celé sady |
| CODE | Technická cesta a záměrně syntetické přejímky | Přijaté úplné orákulum bez doslovných prózových kontrol |
| VISION | N/A podle schopností, historické výsledky oddělené | Nezaměňovat deterministické opakování za další nezávislé úlohy |
| Výběr a nasazení | Solver, odvolání autority a virtuální rollback | Nové nezávislé provozní případy, skutečná přejímka a fyzické nasazení |

**Verdikt pro tento balíček:** kompletní simulační průchod je připravený k celkové revizi. **Verdikt pro autonomní produkční výběr: NO_GO.** Nejde o čekání na simulované souhlasy — ty byly provedené — ale o rozdíl mezi zkouškou programu a skutečným doložením kvality modelů a hodnotitelů.
