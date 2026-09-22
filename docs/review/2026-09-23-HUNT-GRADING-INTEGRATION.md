# GPU hunt — propojené hodnocení a přejímka všech rolí

Stav: **INTEGRATION_TESTING / REVIEW_PENDING**. Autorita: zadání operátora
dokončit hunt, HANDOFF §5, DIRECTION a hodnoticí kontrakt ze září 2026.
Tento packet není přejímka modelů. Přijetí implementace a oprávnění vybírat
modely jsou dvě různé věci.

## Co se mění

Dosud běžný hunt uměl otevřené odpovědi uložit, ale neměl podporovanou cestu
k jejich pozdějšímu hodnocení. Provozní přejímka navíc podporovala pouze CODE.
Nová cesta propojuje uložené odpovědi, přijatého hodnotitele, nezměnitelnou
historii, frontu, párové rozhodování a Studio pro všech sedm rolí.

- Hodnocení je nový záznam. Původní odpovědi, jejich kontrakt, čas sběru a
  poskytovatel zůstávají zachované. Změna rubriky nebo hodnoticího kódu může
  využít staré odpovědi jen při shodě všech zadání a inferenčních parametrů.
- T4 vyžaduje jiný digest hodnotitele než odpovídajícího modelu. Samotné
  autorské kontrolní sondy nedávají produkčnímu hodnotiteli oprávnění.
- Přejímka T4 přepočítává chyby z jednotlivých nezávisle označených odpovědí,
  včetně obou pořadí, všech jmenovatelů a skupin původu. Nepřebírá tvrzení PASS.
- Nový příjem provozních důkazů pro D1/D2/R1/R2/CHAT/VISION vyžaduje úplný
  postup role, doložený konečný stav a regresní kontroly. Jedna izolovaná
  odpověď nebo zopakování jednoho historického případu to nenahradí.
- Přijetí hodnotitele samo neotevírá rozhodování. Potřebuje se i přijaté
  oddělené párové provozní měření přesných dvou digestů, profilu a runtime.
- Zneplatnění přejímky zavře aktuální skóre i běžící hodnocení; historický
  záznam se nemaže. Nová přejímka mění klíč fronty, aby se čekající sběr znovu
  dostal na řadu.
- Studio nabízí **Ohodnotit uložené odpovědi** v detailu sběru. Ověří dostupnou
  přejímku, potvrdí přesný zdroj a spustí samostatné hodnocení. Ukazuje průběh
  a oddělenou dobu sběru/hodnocení; nevyvolá skrytě nové odpovědi modelu.

## Rozhraní a provozní hranice

`GET /api/system/models/grading/:runId` poskytuje čerstvý náhled, pevný hash
zdroje a způsobilé hodnotitele. `POST /api/system/models/grade` přijímá jen
run ID, hash a ID přejímky. GET podléhá autentizaci serveru; mutační POST navíc
vyžaduje lokální brandovanou autoritu. Vstup nemůže dodat skóre, příkaz,
cestu DB ani libovolný systemd unit.

CLI `scripts/grade-model-collection.js --help` popisuje read-only `--plan`
a měření přes vlastněný provider wrapper `--grade-collection --run`.
Vlastní hodnocení používá stejný GPU zámek, sidecar, sledování rezerv a
omezenou systemd službu jako ruční test. Před i po volání kontroluje cizí
GPU procesy, systémovou Ollamu, digest, verzi provideru a úplné GPU umístění.
Selhání hodnotitele je chybějící známka; nejde o nulu kandidáta.

Produkční import přejímky zůstává oddělený a explicitní přes
`scripts/model-evaluation-acceptance.js --record`. Žádný běh si vlastní
přejímku nevytvoří. Hodnocení nezmění přiřazení role ani nic nesmaže.
Retence stále potřebuje důkaz pro všechny příslušné role a kontrolu bindingů.

## Konkrétní návrhové volby k review

Nový T4 validátor navrhuje pro každý deklarovaný typ úlohy nejméně 20
nezávislých skupin, alespoň 8 kladných a 8 záporných skupin, nejvýše 10 %
nesprávných přijetí i odmítnutí, průměrnou absolutní kritériovou chybu do
0,10 a rozdíl pořadí do 0,15. Parametry se uzamykají před měřením.
Tyto konkrétní meze jsou implementační návrh, ne dříve schválená fakta ani
záruka chybovosti v populaci. Jsou předmětem tohoto review. Identita skupin,
nezávislost lidského značení a pravdivost receiptů vyžadují kontrolu zdrojů;
validátor ověřuje konzistenci, nemůže sám dokázat jejich historický původ.

## Co tato delta sama neuzavírá

1. Deset otevřených položek v [arbitráži z 22. září](2026-09-22-HUNT-ARBITRATION-STORAGE.md).
   Návrhy autora nejsou operátorovým rozsouzením.
2. Nový oddělený, nezávisle označený přejímací vzorek pro T4 a skutečné
   predikce jiného hodnotitele. Syntetické DB fixture testují implementaci,
   nikoli schopnost konkrétního modelu známkovat.
3. Dostatečné nové provozní případy a přijatá kvalifikace přesných dvojic.
   Stará vývojová měření se nepřejmenovávají na holdout.

Příjem a vynucování této evidence je implementace této delty. Výroba nezávisle
označené evidence a ověření skutečných modelů z ní automaticky neplynou.
Dokud přijaté záznamy chybí, **automatický výběr a mazání podle kvality nejsou GO**.
Sběr pod dohledem zůstává samostatná použitelná cesta.

## Ověření

Probíhá finální regrese, sestavení a fyzická kontrola nasazené cesty.
Neúspěšné vývojové běhy zůstávají v evidence rootu; následný výsledek je
nenahrazuje. Finální receipt doplní přesnou revizi, rozsah testů a výluky.
