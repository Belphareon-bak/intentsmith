# Proč běžně spuštěné IDE ještě ukazuje starý vzhled

Stav: **CANDIDATE_PREVIEW_AVAILABLE / INDEPENDENT_REVIEW_REQUIRED /
RELEASE_NOT_ACCEPTED**. Autorita: operátorův snímek IDE 2.0 z 10. 10. 2026.

## Příčina a ověřený výsledek

`~/.local/share/applications/intentsmith.desktop` spouští runtime nasazení
`c84b88cd0c0b76639823c82c022d2feab96dfc15`. Jeho instalační konfigurace stále
připíná AppImage `fddfe9966e7cea648bff3bb4d2bdcfdd0900f3d2` z 29. 9.,
SHA-256 `705ea03a353af6549e8ff483599875b577782fe0469df322f7f178862693d006`.
To vysvětluje opakované sloupce „nastavení“ i chybějící kategorii Git.
Commit/push integrační větve tuto místní instalaci nepřepnul.

Nový skutečný AppImage ze zdroje
`387a490fb3fbd6b5c06756629b42e6a44840f15b`, SHA-256
`247ea9552231a5cd6946cde4842b41c7695c9f72380bb97ec821be67401a0969`,
už správně ukazuje pouze Název/Popis, samostatný Git a přepínání
seznam/dlaždice. Snímky jsou ze skutečného Electronu nad vlastním backendem,
nikoli z HTML preview:
[1920 px](evidence/ide-launch-candidate-20261010/candidate-settings-1920.png),
[1366 px](evidence/ide-launch-candidate-20261010/candidate-settings-1366.png),
[dlaždice](evidence/ide-launch-candidate-20261010/candidate-tiles-1366.png).
Původní komentář agenta o chybě nového přehledu byl chybný: kanonické CSS
sloupce již skrývalo. Zobrazení produktu se v tomto dodatku nemění.

## Jak nové IDE otevřít

V nabídce aplikací je nová položka **IntentSmith IDE 2.0 – kandidát**.
Stejný spouštěč z terminálu:

```sh
gtk-launch intentsmith-candidate
```

Balík je v `~/.local/share/intentsmith/ide-candidate-387a490f`; obsahuje
ověřený AppImage, vlastní kopii backendových závislostí a Node 24.
Profil je v `~/.local/share/intentsmith/ide-candidate-review-387a490f`.
Má vlastní DB a adresář projektů; neimportuje provozní historii ani cesty
provozních projektů. Motiv Studio byl zvolen skutečným ovladačem vzhledu
v tomto novém profilu. Modelový provider je odpojený, takže toto okno slouží
k prohlédnutí a přípravě IDE, nikoli ke GPU měření nebo běžnému modelovému
chatu. Backend při chybě poskytovatele nevyrábí falešnou odpověď.

Spouštěč kontroluje otisk AppImage a vlastnictví profilu, ověří autentizované
API a po zavření okna ukončí své procesy. `flock` brání souběžným startům
téhož profilu. Běžná položka nemá diagnostický CDP listener.
Chromium používá již existující místní volbu sandboxu; nevzniká nové
oprávnění ani změna systémové politiky.

## Oprava balení a ověření

Packager odmítal platný build receipt, protože jeho 346 cest bylo v pořadí
`git ls-files`, zatímco výběr packageru používal `localeCompare`. Obě sady
byly úplně stejné. Porovnání nyní nezávisí na pořadí, ale dál vyžaduje přesné
pokrývání vstupů, shodné bajty každého souboru a shodný AppImage.
Regrese ověřuje i odmítnutí chybějícího/duplicitního souboru a změněného vstupu.

| Ověření | Výsledek |
|---|---|
| Desktop/Hunt včetně regrese packageru | 35/35 PASS |
| Čtyři Studio programy | PASS, TAP 42/42 včetně skutečného generovaného view |
| Artifact validation a přeměřený testový census | 161/161 PASS |
| Registr, hranice modulů, generované view, syntaxe spouštěče, diff hygiene | PASS |
| Skutečný nový balík | 3401 vybraných sledovaných souborů ověřeno, build receipt a AppImage shodné |
| Nativní spouštěč kandidáta, vlastní DB/API, nový přehled a šířky | 9/9 PASS; vlastní backend po zavření ukončen |
| Běžná položka nabídky aplikací | PASS, skutečně běžící AppImage a autentizované API; žádný CDP listener |

[Nativní receipt](evidence/ide-launch-candidate-20261010/launch-native.json)
a [použitá sonda](evidence/ide-launch-candidate-20261010/inspect-launch.mjs)
dokládají UI, vlastní DB a odpojený provider. Počáteční chyby sondy byly
chybný předpoklad o velikosti okna CDP (800 px) a očekávání odpovědi na
`Browser.close` po zavření cíle; oprava sondy nemění ani neoslabuje produkt.
Po opravě prošel celý nativní průchod s návratovým kódem 0.

Backendové `src/` a celé `intentsmith-ide/` se v tomto dodatku nemění.
Předchozí 415/415, HTTP/restart a 27 nativních kontrol zůstávají důkazy
svého zdroje `387a490f`, nikoli automaticky všech nových pomocných skriptů.
Zmrazený 24h soak tohoto zdroje pokračuje; jeho start nebyl změněn.

## Co dál zbývá

Výchozí položka **IntentSmith IDE 2.0** stále patří staré nasazené dvojici.
Přepnutí produkce je další krok po přejímce, s ověřeným backupem a migrací;
publikace není nasazení podle `CONTRACT.md §11`. Nový spouštěč přejímku
nenahrazuje. Přetrvávající release podmínky a dostupná nezávislá revize jsou
v [integračním předání](ide-integration-remediation-20261010.md).

Součástí tohoto dodatku není uvolnění automatiky Huntu, výběr/aktivace modelů
ani změna provozní DB, původního menu či instalace. Provozní PID a otisky
instalační konfigurace, původního menu a automation holdu se kontrolují
odděleně od nového kandidáta.
[Receipt běžného spuštění](evidence/ide-launch-candidate-20261010/menu-launch.json)
dokládá vlastní backend a zachování provozního PID i tří chráněných souborů.
