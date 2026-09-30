# WP — zachování kontextu při asynchronním souhrnu

Autorita: explicitní zadání operátora z 30. 9. 2026 dokončit a reálně ověřit chat včetně naplnění kontextového okna a automatického čištění; produktový závazek `PRODUCT.md` §3 zachovat historii konverzace. Tento WP nepřidává novou produktovou autoritu.

Uživatelský výsledek a rozsah: další zpráva nevynechá starý fakt jen proto, že souhrn ještě běží nebo skončil na limitu. Souhrn s `finishReason=length` se neuloží. Nastavení `keepTurns >= 10` nezastaví retenční trigger. Projektový prompt předá syntetický souhrn i po deseti nových zprávách. Žádná změna modelového bindingu, GPU provozu, schvalování efektů ani mobilní hranice.

Vlastněné cesty a connector: `src/chat/context-compact.js`, `src/chat/controller.js`, `src/chat/handlers/project-collaboration.js`, cílené existující testy `tests/context-compact-model-ctx.test.js` a `tests/project-collaboration.test.js`, tento WP. Connector je `ConversationStore` → `ChatController` → handler history a stávající autorizovaný `TOOL_INTERNAL` summarization call.

Vstupní revision a závislosti: `436cd7345301bfdb51661a14e019441599a8b9d0` na `work/intent-resilience-20260928`. Živá suite 85 na starším SHA pozorovala nedokončené souhrny na 500 výstupních tokenech; její běh není důkazem této opravy. Integrace a opakované omezené review už proběhly v commitech `88a7f91a` a `222793c6`.

Demonstrace a testy: řízený odložený provider dokládá čekání před ztrátovým snapshotem, zrušení jednoho čekajícího požadavku a pokračování sdíleného souhrnu. Pozitivní test dokládá zachování prvního faktu při `keepTurns=10` a limit 1 000 tokenů na 4K modelu v rámci existující `TOOL_INTERNAL` ceiling 2 048. Tato oprava může spotřebovat dvě autorizovaná modelová volání na jeden souhrn. Negativní testy dokládají dva výstupy `length` bez uloženého souhrnu a zamítnutí dalšího ztrátového turnu; nadměrný vstup nebo více než 50 nových zpráv končí před providerem a nesmí se označit jako souhrn. Projektový test kontroluje konečný rozpočtovaný provider prompt. Limity: deterministický provider nedokazuje sémantickou úplnost skutečného modelu; živý běh je samostatný navazující krok. Zastavení: jakmile nelze spolehlivě zjistit počet neshrnutých zpráv nebo dokončený souhrn, nepokračovat zkráceným kontextem.

Navazující review odhalilo dvě konkrétní mezery v tomto kandidátu: `fitProjectDiscussionPrompt` krátil souhrn na 600 znaků a pozdější výběr nechával jen uživatelské zprávy; dřívější mapování ho krátilo už na 2 400 znaků. Dále kompakce spuštěná tlakem tokenů při devíti zprávách mohla během běhu dostat dvě nové zprávy, po úspěšném souhrnu ponechat deset neshrnutých a příští požadavek zbytečně odmítnout. Oprava zachovává celý souhrn až do finálního rozpočtovaného promptu nebo skončí před providerem; navazující kompakce se nejvýše jednou zopakuje a po selhání ponechá surovou historii. Dřívější `fitProjectDiscussionPrompt` již měl kontrolu velikosti před doplňováním excerptů; závěrečná kontrola je pojistka pro další změny algoritmu, ne důkaz pozorovaného překročení.

Ověření po navazující opravě: `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node tests/context-compact-model-ctx.test.js` (13/13); `/home/belphareon/.nvm/versions/node/v24.21.0/bin/node --test tests/project-collaboration.test.js` (32/32); předchozí `tests/m1-chat-contract.test.js` (35/35), `tests/chat-persistence.test.js` (36/36), validní registry. Navazující testy pokrývají těsný 4K profil s pozdním markerem, nadlimitní souhrn, závod 9+2 zpráv i selhání druhé kompakce. Nezávislé opakované review obou reprodukcí dalo omezené `REVIEW_PASS`; integrované commity jsou `88a7f91a` a `222793c6`. Stav pro tuto produktovou změnu zůstává `LIVE_NOT_RUN`, nikoli release PASS.

## Navazující sémantické zjištění 2026-09-30

Živý běh sady 85 na `c25174a4` technicky provedl kompakci: první souhrn při
šestém tahu ušetřil 446 odhadovaných tokenů a syrová historie 4579 tokenů
překročila `num_ctx=4096`. Finální dotaz však neprošel přísným orákulem.
Rekurzivní souhrn změnil původní uživatelskou vazbu „auditní kód → hodnota“ na
nejednoznačný popis auditního projektu; předchozí odpověď asistenta o výpočtu
navíc převzal jako fakt. Finální model měl hodnotu v promptu, ale odmítl ji
jako samostatný kód. Soukromá evidence zůstává v
`.intentsmith-artifacts/run-suites/2026-09-30T20-42-23-470Z/artifacts/85-window-fill-evidence.json`.
Tento výsledek je **LIVE_FAIL**, ne potvrzení kvality auto-contextu.

Izolovaný kandidát z `d1739e21` zachovává v uloženém souhrnu omezené doslovné
citace identifikátorů ze skutečných uživatelských zpráv včetně ID zdrojové
zprávy. Odpověď asistenta nemůže vytvořit uživatelskou citaci. Při dalším
souhrnu se citace znovu odvodí z trvalých syrových zpráv a dřívější kopie se
nepřidá podruhé. Citace sdílejí dosavadní výstupní rozpočet modelu; více než
16 rozpoznaných citací nebo 1024 UTF-8 bajtů skončí bez zápisu nového
souhrnu, aby se původní zprávy tiše neztratily. Jde o označené kódy/ID/tokeny
s přesným tvarem, nikoli obecnou sémantickou extrakci všech faktů. Prompt
odděluje neověřené odpovědi asistenta od tvrzení uživatele, ale jeho dodržení
modelem není deterministicky zaručeno. Kandidát vyžaduje nezávislé review a
nový živý běh; do té doby zůstává kvalita **NOT_ACCEPTED**.
