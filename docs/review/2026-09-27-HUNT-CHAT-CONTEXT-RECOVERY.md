# CHAT — nový sběr po opravě historie

**Stav: PREFLIGHT_PASS / CAPTURE_NOT_STARTED / REVIEW_PENDING.**
Autorita: operátorovo „pokračuj“ po předání simulace huntu; závazná cesta
HANDOFF §5 a dřívější zadání doplnit srovnatelné odpovědi před hodnocením.
Žádné nové výsledky ani známky tento přípravný checkpoint netvrdí.

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

## Spuštění a předání

Pracovní důkazy jsou v
`/mnt/vi7000/intentsmith/evidence/hunt-chat-context-fixed-20260927/`.
Vstupní `tasks.json` a `selection.json` už existují. Plán se pečetí z čistého
commitu; launcher hlídá paměť, disk a vlastnictví GPU a nemá mazací krok.
Před sběrem musí být dodržen dříve požadovaný příkon nebo nové rozhodnutí
operátora: pokus o 175 W nyní skončil `Insufficient Permissions`, zůstává 350 W.
Operátor dostal otázku, zda při současném limitu měřit; bez odpovědi se nový
GPU sběr nespouští.

Po dokončení: závěrečný audit → jeden kanonický anonymní balíček → první
posudek po všech 320 kritériích a samostatný druhý posudek → srovnání neshod.
Identitní klíč patří do `restricted/`; souhrn s identitami nepatří do pokynů
pro slepého hodnotitele. Operátor dostane nejistoty a spory, nikoli povinnost
známkovat všech 80 dialogů.
