# Soukromí informačního API relací

Stav: **IMPLEMENTED / INSTALLED / REVIEW_REQUIRED**. Kandidát a nainstalovaný
runtime: **`365a4f1de59d2d867c16e2046ea95405d9c42ac1`**.
Autorita: operátorem předané nezávislé
review `ba7c72d6..3bbf8bc1`; [WP](../wp/WP-PRIVACY-PANELS-REREVIEW-20260917.md).

Review potvrdilo odmítnuté zprávy bez logování a zachování dat přes skutečné
restarty. Našlo však únik pracovní paměti otevřené relace v obou informačních
GET endpointech po vypnutí `memory.saveContext`, před dalším tahem chatu.
Předchozí tvrzení o veškerém získávání živého stavu bylo příliš široké.

## Oprava a hranice

`SessionState.toJSON()` čte současnou DB policy při každé serializaci.
Při false nebo neplatném nastavení vynechá `projectWorkingMemory` úplně.
Stejná hranice pokrývá jednotlivý detail, seznam, přímé `JSON.stringify`
i `saveToStorage`; duplicitní gate jen ve storage je odstraněn.

`getSessionInfo()` nevolá `getState()`: nevytváří relace, neposouvá idle
timer a nemění cache ani lifecycle časy. Čtení API nepřepisuje SQLite.
Vypnutí kontextu nevymazává projektové řádky a není přepínačem historie
konverzace. Další chatový tah dál uplatňuje stávající cache/restore policy.

Integrace `d1fa2991` spojuje dosavadní closeout s instalovaným `d4dea0bb`,
aby následná instalace zachovala současné modelové ovládání Studia.
Samotná privacy oprava nemění Studio, registry ani veřejné endpointy.

## Regresní důkaz

Před opravou nové kontroly selhaly na skutečně přítomném poli pracovní
paměti: in-process 10 PASS / 1 FAIL, skutečný HTTP 0 PASS / 1 FAIL.
Logy jsou zachované v `.intentsmith-artifacts/session-info-privacy-20260917/`.

Po opravě: `chat-memory-privacy` **11/11**, `chat-privacy-http` **1/1**,
`session-context` **66/66**, `chat-fixes` **58/58 PASS**. Nové kontroly
ověřují kladný stav, opt-out před dalším tahem, oba GET endpointy,
neexistující relaci, lifecycle časy, nezměněné DB řádky a opětovné zapnutí.
HTTP test zachovává i skutečné restarty a kontrolu odmítnutých vstupů.
Module boundary: **1 360 hran**, žádná přidaná ani odebraná.
Registr zůstává na 523 programech; nový testovací program nevzniká.

## Úplný profil a nasazení

Čistý připnutý `365a4f1d`, offline/database profil s jedním workerem:
**358 PASS / 1 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**, verdikt **FAIL**.
Jediný non-PASS je `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST`:
`registry hash differs from the reviewed Gate 0 policy`. Pečeť se nemění.
[Strojový záznam](../execution/runs/session-info-privacy-20260917.json)
obsahuje SHA-256 reportu a všech **359 ověřených logů**.

Čistý detached instalační klon znovu prošel privacy **11/11 + 1/1** nad
izolovanou DB. Studio zdroje jsou bajtově shodné s předchozím `d4dea0bb`;
z této instalace byly převzaty závislosti i hotový build. Nejde o nový build.
Consumer guard a capture sedmi release artefaktů PASS. Bundle SHA-256:
`727b770c0ccd147cc317d3f9d372eb132f7ba24d95cc5981c4097a56b1ad6114`.

Backend/Studio/hunt nyní používají instalaci `365a4f1d` a původní DB.
Instalátor vytvořil zálohu a ověřil migrace:
`~/.local/state/intentsmith/installation-backups/2026-09-17T20-29-22-487Z/`.
DB `quick_check=ok`, 0 FK porušení. Sledované tabulky mají shodné hashe:
10 položek projektové paměti, 28 pamětí, 7 modelových vazeb, 510 evaluací,
23 hunt pokusů a nastavení. API bez capability 401, s ní 200; skutečný
backend PID odpovídá čistému instalačnímu zdroji.

Běžné Studio bylo otevřeno přes detached `gtk-launch intentsmith`, bez
debug portu; ověřeno viditelné okno 2024 × 974 a identita procesu. To je
startup kontrola, nikoli nový modelový či vizuální journey. Timer je active
a persistent, hunt service má předchozí failed stav s PID 0, evaluation je
inactive. Tento běh nevytvořil nová modelová měření. Oddělené procesy
předchozího 24h soaku pokračují beze změny.

## Přesný rozsah pro review

Privacy delta: `d1fa2991..365a4f1d` pouze v `src/chat/controller.js`,
`tests/chat-memory-privacy.test.js` a `tests/chat-privacy-http.test.js`.
Souhrnná integrace včetně zachovaného modelového UI a dokumentace:
`b3d34f6a..365a4f1d`. Dokumentační follow-up nemění instalovaný produktový
zdroj. Publikační větev: `work/production-closeout-20260917` na GitHubu.

Zachované neúspěchy: první lokální integrační commit omylem zkrátil
ROADMAP/SYSTEM-MAP. Dokumentační test to odhalil (155 PASS / 5 FAIL);
úplný obsah byl obnoven před zmrazením kandidáta (160/160 PASS). Čisté
instalační testy nejprve správně odmítly adresář artefaktů s veřejnými právy;
po opravě režimu na 0700 prošly. První nedetached spuštění přes GTK nemělo
trvalé okno; přímý launcher i následné detached spuštění byly ověřené.
První okenní sonda narazila na nesouvisející nepřístupný PID namespace;
opravená kontrola ověřuje výhradně odpovídající instalační proces.

Nezávislé přijetí této opravy se nepředjímá. Běžící 24h soak je připnutý
na `d4dea0bb` a nepředstavuje ověření této nové změny. Historické instalace
se zbytkovým TLS párem zůstávají beze změn; podpisy M5/M6 a Gate 0 pečeť
tato oprava neuzavírá.
