# Opravy soukromí a agentího ovládání — 17. 9. 2026

Adresát: operátor a nezávislý recenzent. Vstup `4ee13105`, opravy
`6d84e667` + boundary pin `a4011362`, následné rozšíření uzavírá stejnou
policy i pro exportovaný feedback helper a atomický settings writer.
Stav: **IMPLEMENTED / REVIEW_REQUIRED**, bez M5/M6 acceptance.

## F1 — skutečné nastavení a pravdivá hranice historie

Společný `readChatMemoryPolicy` čte SQLite při použití, nikoli jednorázový
feature flag. Vypnutí LTM/learningu/feedbacku blokuje odpovídající automatické
čtení či zápis; vypnutí vzorců zastaví jejich sběr. `memory.saveContext=false`
zastaví automatickou legacy paměť/učení a použití uloženého projektového
kontextu. Explicitní M4 evidence a schválení mají samostatný kontrakt.

**Režim bez historie není implementovaný.** Z možností doporučených auditem
je zvolený pravdivý nepodporovaný režim: nové `saveHistory=false` odmítají
obecné HTTP, import i mobilní writer. Starší uložené false se nepřepíná;
nový chat skončí typed 409 před uložením obsahu. Obecný settings save jej
nemůže obejít pouhým vynecháním klíče. Obnovení chatu vyžaduje explicitní true.
Studio i mobil vysvětlují durable historii; Studio ukáže chybu ukládání
a znovu načte skutečný stav. Bezpečnostní žurnál se nevypíná.

## F2 — native akce a potvrzený výsledek

Studio používá `/api/agent-extensions/instances/:id/{run,enable,disable}`.
Kontroluje HTTP stav, běhový status i potvrzenou identitu/enabled hodnotu.
Chyba, timeout, skipped a partial nejsou úspěšný běh. Seznam zahrnuje i vypnuté
agenty, takže je lze znovu povolit. Legacy záznamy jsou pouze ke čtení.
Pozastavení zakazuje další plánování, neruší právě běžící úlohu. README už
nenabízí vyřazený CRUD jako funkční cestu.

## F3 — projektová hranice automatické legacy paměti

Chat používá existující LTM namespace, oddělený přesným JSON klíčem
`[userId, project, projectId]`; bez projektu `[userId, conversation, id]`.
Scope pochází z durable asociace konverzace. Model ani caller-supplied
projectId jej neurčuje. Preference a buffer vzorců jsou oddělené stejně.
Korekce navíc ukládá provenance konverzace a scope. Staré nescopované položky
se zachovají, ale automaticky se nikomu nepřiřazují ani se nenačítají do chatu.
Není změna schématu ani mazání historických záznamů.

Regrese ověřuje skutečný feedback intercept, SQLite, nové DB spojení,
controller, budgeted handler context a serializovanou odpověď řízeného
terminálního handleru. **Není to nová inference fyzického modelu**; původní
review rovněž doložilo přenos do handler contextu, nikoli modelový únik.

## Dosavadní ověření a zachované neúspěchy

- Nové DB/Studio regrese: **9/9 PASS**; native project-health agent používá
  skutečný service/runner a SQLite, pouze browser fetch je řízený transport.
- Nový skutečný HTTP server test: PASS, deterministická odpověď 391,
  dva procesové restarty, ochrana staršího false a explicitní obnova.
- Navazující focused běh včetně M5 settings a M6 inventory: **36/36 PASS**.
- Produkční Studio build na `a4011362`: PASS, consumer guard PASS.
- První celý profil na `a4011362`: **351 PASS / 3 FAIL / 1 BLOCKED**.
  FAIL: dokumentační census, M6 počty po přidání HTTP programu, release seal.
  BLOCKED: runner neměl povolený dostupný `systemd-analyze`.
  Pozdější běh má vlastní záznam; tento výsledek se nepřepisuje.
- První nová fixture narazila na ochranný M5 trigger při pokusu zapsat `[]`;
  malformed read je nyní ověřený na samostatné syntetické DB bez oslabení
  produkčního triggeru. Druhá fixture doplnila skutečnou inicializaci agentích
  tabulek. Původní neúspěšné logy zůstávají v lokálních artefaktech.

## F4–F6 — gate, publikace a dokumentace

`nightly-orchestrator-self-test` zůstává červený kvůli zapečetěnému registry
hash. `CONTRACT.md §8` tento stav při vývoji výslovně očekává; pin se zde
nepřepisuje a release není přijatý. Nové importy mají přesně jmenované boundary
delta; počet cyklů zůstává 3 / 28 členů.

Desktopový `4ee13105` je již na GitHub `work/desktop-hunt-20260917`.
Specialistických 17 commitů včetně `ff313081` je od tohoto běhu zveřejněno na
`review/specialists-engines-20260917`; jejich unpublished nález tím přestává
platit. Jejich integrace a čtyři účetní hrany zatím nejsou přijaty tímto
privacy patchem. GitHub `main=6676902c` má nesouvisející historii; žádný
force-push ani předstíraný merge se neprovádí.

INSTALL místo zastaralého pevného počtu odkazuje na skutečný registry
validator. README/SYSTEM-MAP/ROADMAP přebírají aktuální počty, nikoli historické
souhrny jako claim hotového releasu. Přesné závěrečné piny, instalace a nové
výsledky jsou doplněné níže po dokončení ověření.
