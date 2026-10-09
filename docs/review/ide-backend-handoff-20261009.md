# Předání backendu nového IDE

Pro operátora a integračního ROOT. Stav před prací: návrh a–k/V4 bez nových
správcovských API. Stav nyní: implementovaný vývojový kandidát,
**REVIEW_PENDING / NOT_ACCEPTED**. Větev `work/ide-backend-20261009`, základ
`138e958be927df9835c091d3ad41d44b347e85b5`. Produkce zůstává na
`c84b88cd0c0b76639823c82c022d2feab96dfc15`; cizí ROOT a jeho stabilitní
snapshot nebyly upraveny. Publikace není merge, deployment ani přejímka.

## Posunuté požadavky

| Oblast | Výsledek backendu |
|---|---|
| Modely | Trvalý oddělený kontext/output každé role včetně skutečných CHAT/VISION volání a rozpočtů; přesný model/digest; provozní telemetrie a veřejné reference s proveniencí. |
| Účty a kanály | Více Discord/Telegram účtů, revizované nastavení, potvrzený test a odběr worker/lifecycle událostí přes outbound/audit. PRODUCT/DIRECTION upraveny podle rozhodnutí operátora. |
| Úložiště a zálohy | Skutečné kapacity více filesystémů, databáze a WAL; výchozí cesta projektů; sekce snapshotu, poznámky, archivace a retence s ochranou poslední zálohy. |
| Git a SSH | Repozitáře/remotes, SSH profily s kontrolou souborů a změny klíče, řazení větví, compare a commit detail se skutečnými OID. |
| Hunt | Trvalé profily, časové plány včetně timezone/DST, sériová fronta, přesné artefakty a výsledky obou částí challenge; bezpečné přerušení po restartu a zachované review stavy. |
| Vytváření prvků | Česká ID specialistů, prompt/doménová pravidla/constraints a skrytý dummy-logger; vlastní deklarativní M3 worker šablony a úprava instancí. Existující projekty a expertízy zachovány. |

Konkrétní endpointy, JSON, revize a omezení jsou v
[integračním návodu](../development/ide-management-api.md). Nové zápisy vyžadují
skutečnou lokální operátorskou identitu, přesnou revizi a tam, kde vzniká efekt,
potvrzení. Credentials jsou odkazy na environment, nikoli tajné hodnoty v DB.

## Důkaz a nalezené regrese

Kód a testy ověřeny na `03abd72a61c1c59cf6535f2746d9735468683e2b`:
**414/414 testovacích programů PASS**, 324 offline + 88 database + dva izolované
product-server journeys. Žádné FAIL, TIMEOUT, BLOCKED ani SKIPPED. Node
`v24.21.0`, concurrency 1, čistý zdroj ověřen po každém programu a bez úniku
procesů. Nová sada má 19 kontrol; další test spouští skutečný produkt s auth,
zápisem, restartem, readback a odmítnutím staré revize. Řízené provider fixtures
nejsou živé GPU měření. Kontrolní součty a přesná selekce jsou v
[validation.json](evidence/ide-backend-20261009/validation.json); raw důkaz je
v `.intentsmith-artifacts/ide-backend-evidence/ide-be-final-20261009/`.

První souběžný běh byl přerušen a zachovává 25 FAIL, tři BLOCKED a 69 SKIPPED.
Odhalil chybnou změnu ručního Huntu při automation hold, zastaralé schema/count
oracles a nepřipravené lokální Studio/Python prostředí. Ruční exploratory Hunt
zůstává povolený podle stávající autority; nové scheduled joby hold respektují.
Oracles nyní ověřují skutečnou migraci 123 (celkem 110), nikoli starých 109.
Sériový úplný běh měl původně jednu OCR blokaci: `--resume` se stejným source,
registry a options pinem po předání `UCETNI_RUNTIME_DIR` zopakoval pouze tuto
sadu. Původní BLOCKED report i přerušený report jsou zachovány a hashované;
nejsou přejmenovány na PASS.

Registry: 599 programů, 501 ACTIVE, 83 BLOCKED, 15 HISTORICAL. Modulová baseline
má 1554 hran, nula driftu, nezměněné tři cyklické komponenty / 28 souborů;
samostatný baseline commit a [self-review](ide-backend-boundaries-20261009.md)
nejsou nezávislé schválení. Mobile inventory má 308 desktop routes; číslo
není důkaz dostupnosti pro mobil. Nové dvě sady jsou přidány do development CI
a jejich logy/reporty se archivují. Závěrečný dokumentační/CI commit nemění
ověřený backendový kód ani testy.

## Zbylé podmínky a další krok

1. ROOT vezme publikovanou větev do vlastního integračního checkoutu a napojí
   GET/readback, revizované PUT/DELETE a potvrzovací cesty podle API návodu.
   Body a/b/h, explorer a generický název větve zůstávají frontendová práce.
2. Nezávisle zkontrolovat DB migraci, credentials/outbound, SSH a scheduler,
   poté ověřit skutečné IDE journeys. M3 šablona není upload spustitelného kódu;
   doménová pravidla specialisty sama nepřidělují nástroje.
3. Discord/Telegram patří před vydání, ale aktuální produkční M5 manifest je
   stále odmítá. Nový M5/M6 důkaz a přejímka musí pokrýt jejich opt-in,
   credentials a skutečné doručení. Tento WP žádnou skutečnou zprávu neposlal.
4. Po uvolnění GPU ověřit Hunt a HW stropy. `verifiedHardwareMaximum` zůstává
   null; veřejná skóre pouze prioritizují test, neaktivují model. Nový scraper,
   OAuth/vault, přesun živé DB/Ollama dat a obnova volitelných archivních sekcí
   nejsou implementací tohoto WP. Offline restore nadále obnovuje pouze DB.
5. Teprve potom kvalitativní kampaň a nová release evidence. Stávající M6
   receipts se 109 migracemi ani soak na starém source nedokazují přejímku
   kandidáta se 110 migracemi. Gate 0 a release approval nebyly spuštěny.

Operátor nyní nemusí znovu rozhodovat o implementaci ani o pre-release rozsahu
Discord/Telegram. Jeho přejímka následuje po konkrétních integračních důkazech.
