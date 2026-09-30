# CHAT — nový sběr po opravě historie

**Stav: 80/80 úplných dialogů, COLLECTION_AUDIT_PASS, první posudek 320/320 kritérií. Druhý posudek čeká.**
Autorita: operátorovo „pokračuj“ po předání simulace huntu; závazná cesta
HANDOFF §5 a dřívější zadání doplnit srovnatelné odpovědi před hodnocením.
První pokus zachytil dva celé dialogy a jeden neúplný. Druhý běh skončil
na chybě prostředí po 78 úplných dialozích. Samostatně zamčené pokračování
doplnilo právě dva chybějící dialogy. Z neúplných výstupů se známky nevydávají.
Výsledky a aktuální cesta k GO: [uzavření sběru a první posudek](2026-09-27-HUNT-CHAT-REFERENCE-MILESTONE.md).

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
| `hunt-chat-context-fixed-20260927-v2` | Nové odpovědi po opravě kontroly, dokončeno 78 + 2 | Vlastní dva plány, odvozený pohled `complete-view`, společný závěrečný audit |

Všechny adresáře leží v `/mnt/vi7000/intentsmith/evidence/`. Nejde o nová
zadání: jejich SHA je stejná. Jde o nové odpovědi v opraveném provozním profilu.
`lineage.json` váže plány, modely a zdroje; seznam původních hashů doloží,
že se staré odpovědi ani posudky nezměnily. Nové odpovědi vyžadují nové známky
navázané na nový SHA balíčku. Samotná shoda ID úlohy neopravňuje přenos známky.

Dokončeno: závěrečný audit → jeden kanonický anonymní balíček → první
posudek po všech 320 kritériích. Zbývá samostatný druhý posudek → srovnání neshod.
Identitní klíč patří do `restricted/`; souhrn s identitami nepatří do pokynů
pro slepého hodnotitele. Operátor dostane nejistoty a spory, nikoli povinnost
známkovat všech 80 dialogů.

## Obnova po přerušení prostředí

Běh v2 na `24823996` zachytil 40 + 38 úplných dialogů. Poslední dvě úlohy
druhého modelu skončily `OPERATIONAL_FAILURE`: timeout `nvidia-smi`, poté
`CANCELLED_OR_BUDGET`; závěr obsahuje i `cleanupError: fetch failed`. Příčina
se nesmí převést na nulu kvality. Původní `result.json` zůstává `BLOCKED`.

Pokračování nově přebírá otisky všech dokončených odpovědí a zamkne seznam
pouze chybějících úloh. Nemění produkční handler, zadání, poskytovatele ani
parametry inference. V novém adresáři uloží pouze chybějící odpovědi.
Odvozený pohled obsahuje původ obou běhů, oba neúspěšné pokusy i jejich hashe;
není vydáván za jediný nepřerušený běh. Závěrečný audit znovu čte požadavky
ze všech 80 dialogů a kontroluje také nezměněné zdroje a datum. Export
plného formuláře vyžaduje tento audit i u odvozeného pohledu.

Regresní test provádí obnovu 78 + 2, ověří 80 odpovědí, uchování dvou
selhání, správné opravné volání a odmítnutí změněného zdrojového reportu,
nesprávného seznamu úloh i exportu bez auditu. Je to test nástroje, nikoli
modelové měření.

Pokračování na čistém `554f6612` dokončilo dva dialogy. Odvozený pohled
zachovává všech 78 původních úplných odpovědí bitově; dva neúspěšné pokusy
jsou evidované samostatně. Audit prošel nad **233 skutečnými voláními**
(232 základních + 1 opravné) a **116 páry** systémových promptů a parametrů.
U času se porovnává společné datum; konkrétní sekunda v systémovém promptu
se normalizuje. Žádný převod chyby prostředí na známku neproběhl.

„Úplná historie“ zde znamená přesné předchozí **uživatelské vstupy**.
Předchozí odpovědi asistenta stále podléhají běžnému produkčnímu rozpočtu:
z 229 výskytů v navazujících požadavcích je 111 celých, 98 výslovně
zkrácených a 20 vynechaných. V posuzovaném balíčku jsou všechny výsledné
odpovědi celé. Není to měření neomezeného kontextu ani důkaz, že veškerý
minulý výstup asistenta zůstal dostupný modelu.
