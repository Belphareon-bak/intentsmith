# Proč běžně spuštěné IDE ještě ukazuje starý vzhled

Stav: **WITHDRAWN_BY_OPERATOR / HISTORICAL_EVIDENCE / RELEASE_NOT_ACCEPTED**.

Operátor další spouštěč odmítl. Je odstraněn z nabídky aplikací a pomocný
skript je stažen. Níže uvedené snímky jsou historický důkaz dílčí opravy;
neprokazují dokončení preview ani funkčnost Huntu. Aktuální práce upravuje
původní IDE 2.0: [doplnění preview](ide-preview-completion-20261010.md). Autorita: operátorův snímek IDE 2.0 z 10. 10. 2026.

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

## Historický izolovaný pokus — stažen

Třetí položka „IntentSmith IDE 2.0 – kandidát“ se již nepoužívá.
Soukromá data pokusu zůstala zachována. Pokus používal odpojený provider,
proto prázdný katalog a chybové přiřazení rolí nelze vydávat za funkční
provozní ověření. Menu nemá dostat další IDE.

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

## Nahrazení postupu

Aktualizace se provádí do stávajícího IDE 2.0 při zachování databáze,
profilu, Legacy a výslovného automation holdu. Formální přejímku ani
nezávislou revizi tím nelze nahradit. Tento historický report nesmí být
použit jako verdikt dokončení všech změn V4.
