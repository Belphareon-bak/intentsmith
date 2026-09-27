# CHAT — nový sběr po opravě historie

**Stav: první pokus COLLECTION_PARTIAL; oprava kontroly a nový oddělený běh v2.**
Autorita: operátorovo „pokračuj“ po předání simulace huntu; závazná cesta
HANDOFF §5 a dřívější zadání doplnit srovnatelné odpovědi před hodnocením.
První pokus zachytil dva celé dialogy a jeden neúplný. Známky se nevydávají.

## Zmrazený rozsah

- Stejné dva instalované artefakty jako 26. 9.: qwen3.8 a qwen3.5; jejich
  úplné digests jsou v `selection.json` a byly ověřené proti inventáři.
- Stejných 40 zadání, 20 CS/EN dvojic, jedna odpověď na scénář a model:
  80 dialogů, 232 plánovaných volání, bez případných opravných opakování handleru.
- Zadání a rubriky jsou bajtově totožné se zdrojem. SHA souboru úloh je
  `4334dd800f3f80521d6e80eb9900eaf8c731246588d9c1ca44701f6c2e15fe65`.
- Nový profil používá opravený `buildAnswerContext`, kontrolu požadavku
  před inferencí a poskytovatele `0.34.2-intentsmith.2` v samostatném procesu.
  Kontext 4096 a politika výstupního rozpočtu jsou u obou kandidátů totožné.
- Jde o známé vývojové scénáře, nikoli nový provozní holdout. Staré odpovědi
  se do tohoto sběru nepřebírají. Živá DB, role a instalované modely se nemění.

Soubor výběru používá `utilityMean: 0` pouze jako požadovaný parametr staršího
sběrného CLI, aby zachoval pořadí dvojice. **Není to naměřená známka.**
Identita poskytovatele v novém výběru je `.2`; původní výběr měl v položce
artefaktu zastaralé `.1`, přestože skutečné odpovědi pocházely z `.2`.

## Opravená závěrečná kontrola

`audit-chat-production-pair.py` nyní čte všechny předchozí vstupy uživatele
přímo z `receipts[].body.messages` a porovnává přesný obsah, pořadí a počet.
Nevěří uloženému příznaku úspěchu sběrného guardu. Citace údaje v odpovědi
asistenta uživatelskou zprávu nenahradí.

Export formuláře vyžaduje audit úplné historie všech požadavků a shodu
otisků jednotlivých souborů odpovědí. Předchozí audit, který historii vůbec
neověřoval, ani změna dat po novém auditu formulář neautorizuje.

Ověření:

- Celá sada `hunt-completion-simulation`: 3/3, včetně nového závěrečného auditu.
- Rozšířený test auditu/exportu: 1/1 po přidání kontrol otisků; přijme úplnou
  syntetickou dvojici, odmítne chybějící historii, starý audit a změněná data.
- Původní skutečný sběr z 26. 9. nový audit odmítl přesně jako
  `HISTORY_USER_TURNS_INCOMPLETE`; staré důkazy se nezměnily.
- `artifact-validation`: 160/160; registr: 542 validních programů.

## Spuštění, chyba kontroly a oddělení běhů

Operátor 27. 9. schválil nový dvoumodelový sběr. Běh na čistém `2e1b9b23`
se zastavil při třetím dialogu: produkční jazyková kontrola přidala před
historii opravný pokyn. Historie byla úplná, ale guard očekával její hlavičku
na začátku promptu. Tři transportní pokusy byly odmítnuté ještě před inferencí.
Nejde o chybu modelu ani chybějící historii. Výsledkem jsou **2 úplné dialogy,
1 neúplný, 8 skutečných odpovědí poskytovatele a 3 odmítnuté požadavky**.

Oprava přijímá blok historie za opravným pokynem pouze před polem aktuálního
uživatelského vstupu. Falešný blok citovaný uvnitř nového vstupu nepřijme.
Každý receipt nově obsahuje číslo tahu (`captureReceiptVersion: 2`), takže
závěrečný audit ověří historii i při opakování handleru a neplete další
provider volání s dalším kolem dialogu. První volání má u obou modelů stejné
parametry; opravné volání používá stávající produkční teplotu 0,5. Finální
odpověď tahu musí být úplná; mezivýstupy zůstávají v syrových datech.

| Běh | Účel a stav | Pravidlo použití |
| --- | --- | --- |
| `hunt-chat-prod-sameday-20260926` | Původní odpovědi a oba posudky; vada historie | Zachovat, neslučovat s novým během |
| `hunt-chat-context-fixed-20260927` | První nový pokus, `COLLECTION_PARTIAL` | Diagnostika guardu, bez převzetí odpovědí či známek |
| `hunt-chat-context-fixed-20260927-v2` | Nový čistý běh po opravě kontroly | Oba modely od začátku, vlastní plán a audit |

Všechny adresáře leží v `/mnt/vi7000/intentsmith/evidence/`. Nejde o nová
zadání: jejich SHA je stejná. Jde o nové odpovědi v opraveném provozním profilu.
`lineage.json` váže plány, modely a zdroje; seznam původních hashů doloží,
že se staré odpovědi ani posudky nezměnily. Nové odpovědi vyžadují nové známky
navázané na nový SHA balíčku. Samotná shoda ID úlohy neopravňuje přenos známky.

Po dokončení: závěrečný audit → jeden kanonický anonymní balíček → první
posudek po všech 320 kritériích a samostatný druhý posudek → srovnání neshod.
Identitní klíč patří do `restricted/`; souhrn s identitami nepatří do pokynů
pro slepého hodnotitele. Operátor dostane nejistoty a spory, nikoli povinnost
známkovat všech 80 dialogů.
