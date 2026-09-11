# Konverzační web: samostatný bezpečnostní review packet

Stav: `IMPLEMENTED_CANDIDATE / WEB_REVIEW_REQUIRED`. Přijatý rozsah určuje
[Decision 044](../decisions/044-conversation-web-approval.md), nikoli tento packet.
Opravy vynucují existující místní schválení; neaktivují vzdálený ani autonomní web.

## Přesný revizní rozsah

Base před zavedením webu: `983121eece58b8522f736d4c8bc7c7e0ea4f657a`.
Finální implementation/test source: `dbe6630abefbffac8489c4cc0901997b52375e6d`.
Revize `4166056e81481415bbfa21228ec13f2b3fa2b5a5` je vstup operátorského review;
není začátkem webového rozsahu. Pozdější dokumentační předání nemění tyto runtime bytes.

Celý web začíná v `d050cb6e7cbfb56472d1943e0af6bf4baacb0553`, tedy **před**
původním rozsahem `8f9fb230..c6c9ee3a`. Tento starší packet proto nemůže
založit webové acceptance. Je zachovaný jako historický packet pro multi-file
řez; [odpověď na review](2026-09-11-PRODUCTION-FOLLOWUP-REVIEW-RESPONSE.md)
přesně zaznamenává, co operátor prověřil a co nespouštěl.

První commit je smíšený auditní řez. Pro web použijte celou následující deltu,
nikoli pouze poslední opravu. Balík změn lze vypsat:

```bash
git diff 983121ee..dbe6630a -- \
  contracts/m2/conversation-web-v1.js \
  src/chat/handlers/conversation-web.js src/chat/handlers/pre-handler.js \
  src/chat/handlers/decisions.js src/chat/response-finalizer.js \
  src/network/conversation-web-repository.js src/network/conversation-web-transport.js \
  src/security/global-auth-policy.js src/db/database.js \
  src/db/migrations/2026_09_11_111_conversation_web.js \
  src/effects/effect-authority-repository.js \
  tests/conversation-web.test.js tests/conversation-web-http.test.js \
  tests/m5-global-auth.test.js \
  tests/m2-tool-production-consumer.test.js tests/schema-migrations.test.js \
  tests/m1-model-failover-schema.test.js tests/harness-exit-code.test.js \
  tests/e2e/_helpers.js tests/registry.json tests/fixtures/module-boundary/baseline.json \
  tests/nightly-orchestrator-self-test.js tests/m6-candidate-plan.test.js \
  scripts/nightly-orchestrator.js contracts/m6/candidate-plan-v1.js \
  contracts/m6/runtime-evidence-v1.js package.json package-lock.json \
  DIRECTION.md docs/decisions/044-conversation-web-approval.md \
  docs/wp/WP-AUDIT-REMEDIATION-20260911.md docs/wp/WP-WEB-REVIEW-FOLLOWUP-20260911.md \
  docs/wp/WP-PROJECTLESS-WEB-20260911.md docs/execution/migration-reservation.md
```

Smíšené soubory obsahují i jiné změny; jejich přítomnost ve výpisu nezakládá
přijetí celého modelového, M6 nebo dependency řezu. `ipaddr.js` je připnuté na
2.4.0; zbytek aktualizací závislostí má vlastní širší auditní rozsah.

Povinná četba okolí i tam, kde soubor nemá webovou deltu: `src/server.js`
(HTTP/WS autentizace a `localRemoteSubjectId`), `src/routes/chat.js`,
`src/chat/controller.js`, `src/remote/m7-conversation-command-executor.js`,
`src/network/outbound-audit-repository.js`, `src/network/outbound-policy.js`,
`src/security/legacy-local-access-policy.js`, `src/security/legacy-listener-policy.js`
a Studio renderer v `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`.
Zde nekončí review na helperu: sleduje skutečný request, uložený turn,
produkční dispatch, finální response metadata, historii a zobrazení.

## Původ změn

| Commit | Obsah webového řezu |
|---|---|
| `d050cb6e` | Kontrakt, migrace, repository, HTTPS transport, přímý a search consumer, základní testy. |
| `f839b386` + `3d088733` | Response tagging bez zpětného controller cyklu a přesný module baseline. |
| `f1c83276` + `2ee19e08` | Writer funkce na dalších SQLite spojeních, schema/upgrade a projectless guard. |
| `49ab53c1` | Čerstvý proces, replay a invalidace výsledku. |
| `3f85043a` | Přirozené hledání přes skutečnou HTTP route. |
| `7a5f4104` | Vnitřní deadline odlišený od zrušení uživatelem. |
| `226bc96e` + `39c96957` + `dbe6630a` | Oprava původu lokální autority, závěrečný audit po ztrátě scope, regrese a přesně jedna nová module hrana; M7 webový test je v databázové webové sadě. |

## Autorita a skutečný tok

1. Globální HTTP/WS autentizace vytvoří neprůhledný místní subject. Pouhé
   `{actorType:'user', actorId:'local-operator'}` není místní oprávnění. Admin/API
   token ani M7 principal ho nezíská; lokální capability a výslovný development
   loopback režim ano. Brand prokazuje původ autentizace místní capability;
   omezení skutečného listeneru je v uvedené listener/access policy. Capability
   branch sama netestuje remoteAddress. Brand se nepřenáší přes JSON; nový proces
   se autentizuje znovu.
2. Chat uloží skutečný user-turn a předá stejný subject. Přímý pre-handler
   nebo projektově prázdný search intent sestaví konkrétní viditelnou URL.
   Repository kontroluje aktivní konverzaci bez projektu a uloženou zprávu.
3. Návrh nic neodesílá. Nový uložený turn musí přesně schválit ID v téže
   konverzaci do pěti minut. Typed transakce spotřebuje pending approval a uloží
   outbound decision před transportem. Obecný souhlas ani modelový text nestačí.
4. Vlastní transport provede nejvýše jeden HTTPS GET: port 443, URL do 2048 B,
   bez credentials/cookies/těla/proxy konfigurace, bez redirect/retry/fallback.
   Všechna DNS řešení musí být veřejná; vybranou adresu předá připnutý lookup.
   Scope zkontroluje před požadavkem i po DNS. TLS validaci nevypíná. Deadline
   je 15 s, response nejvýše 1 MiB, podporované textové MIME, bez komprese.
5. Repository znovu kontroluje scope a atomicky ukládá bytes, digest, URL/IP/status
   a terminal audit před oznámením úspěchu. Opakování čte uložený výsledek bez sítě.
   Ztráta scope znemožní success a odstraní webové bytes. Vlastní skutečný claim
   může uzavřít audit i po zrušení či smazání; nikdy neobnoví obsah nebo approval.
6. Response je citovaný externí obsah s dynamickým code fence; nejvýše 12 000
   vstupních znaků se převede na úryvek. Raw bytes jsou oddělené od zobrazení.
   Dříve uložený chatový úryvek se řídí retencí historie, ne mazáním webové tabulky.

Tento consumer volá **přímo `https.request`**. Sdílí `OutboundAuditRepository`,
nikoli `createOutboundPolicy()` či globální fetch guard. M5 fetch review proto
není důkaz zabezpečení tohoto transportu. Web současně není jediný síťový modul
v projektu: model discovery a další klienti mají vlastní scope. Jejich současná
provozní aktivace se v tomto běhu neměřila.

## Nálezy a opravy

| Nález na vstupu `4166056e` | Změna a důkaz |
|---|---|
| **P1: M7 používá stejné `local-operator` jako místní relace.** Samotná kontrola actor ID mohla při zapnutém M7 povolit vzdálenou spotřebu webového souhlasu. | Neprůhledný brand z existující autentizační vrstvy; skutečný M7 executor → web handler odmítne návrh i přesné schválení `WEB_LOCAL_TRANSPORT_REQUIRED`, původní pending zůstane a transport má 0 volání. Nejde o tvrzení, že byl M7 v živé instalaci zapnutý nebo zneužitý. |
| **P1: Zrušení/ztráta scope mohla nechat allow audit bez terminalu.** Původní `settle` opět vyžadovalo již odvolanou konverzační autoritu. | `failClaim` uzavírá jen vlastní brandovaný pokus podle původního zmrazeného snapshotu, atomicky a idempotentně. Testy explicit cancel, archive, project attach, edit obou zpráv i delete; žádné obnovené bytes a právě jeden failed terminal. |
| **P2: Packet vynechal zavedení webu.** | Tento úplný vymezený rozsah od `983121ee`, samostatný stav `WEB_REVIEW_REQUIRED` a odpověď na původní review. |
| **P2: Vadný první peer nebyl prokázán.** | Dva service testy: syntakticky chybný i syntakticky validní, funkčně chybný první soubor se dostane do dalších promptů jako `proposed`. Po jediném approval skutečný test selže, všechny změny se vrátí a rekonstrukce služby nevyrobí success. Viz run record; není to síťová vlastnost. |

Companion delta peer testu: `git diff 4166056e..dbe6630a -- tests/m2-lifecycle-application-service.test.js`.

Read-only spolupracující kontrola oprav zopakovala nad paměťovou SQLite skutečné
moduly: remote denial, lokální claim → revoke → dvojí finalizace, jeden terminal,
0 síťových volání. Hashované runtime bytes odpovídají kandidátu. Je to engineering
recheck, **není to požadované nezávislé Claude Opus `--effort max` acceptance**.

## Ověření a nepokryté hranice

Na `dbe6630abefbffac8489c4cc0901997b52375e6d`:

| Důkaz | Výsledek a hranice |
|---|---|
| Úplný deterministic profil | **353/353 PASS**, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED; všech 353 source/clean údajů a log hashů ověřeno. |
| Webová DB/transport sada | **20/20 PASS**, včetně skutečného M7 executoru, odvolání scope, auditu a replay. |
| Lifecycle application service | **36/36 PASS**, včetně obou vadných prvních peerů a rollbacku celé dávky. |
| M5 global auth + web HTTP | **2/2 programy PASS** v namespace; auth **13/13** podle TAP logu, web HTTP **2/2** podle reportu. Runner u TAP sady uvádí stepsPassed=0, proto se počet auth případů odvozuje z raw TAP. |
| Původní offline M7 + production tool consumer | **4/4 + 22/22 PASS** v plném profilu. |
| Registry, artifact, module/isolation | PASS; 515 programů beze změny, 158 artifact případů, 1321 hran a 128 chráněných DB test roots. |

První úplný běh `39c96957` je zachovaný jako **349 PASS / 2 FAIL / 2 TIMEOUT**.
Nový PASS je jeden celý běh, nikoli součet cílených oprav. M2 authority repository
nyní prošlo 13/13 za 2718 ms, tool broker 34/34 za 3029 ms při původním 30s limitu.
Příčina předchozích timeoutů není prokázaná; zůstává to omezení reprodukovatelnosti.


Aktuální HTTP důkaz má **2 případy**: search proposal → cancel a souhlas privátní
IP → denial → replay. Nepokrývá úspěšné veřejné načtení. Síťový namespace nemá
odchozí routu; výsledek tak nelze zaměnit za test živého Bing provideru.

M7 odmítnutí se podle `contracts/m1/terminal.js` a executor mapování doručí
jako text konverzační odpovědi s M1 terminalem `ok`; strukturovaná webová chyba
se přes M7 dále nepropaguje. Nejde o úspěch webového požadavku. Regrese ověřuje
handler error, nezměněné pending a 0 I/O; typed `ConversationResult.error` netvrdí.

Unit testy ověřují DNS/TLS options pomocí injektovaného transportu; nevytvářejí
skutečný veřejný TLS socket. DNS-time scope check, přesný limit 1 MiB a +1 B,
20 návrhů/min, jeden executing request, audit outage a zákaz opakovaného I/O
jsou pokryté. Nejsou doložené skutečné odmítnutí cizího certifikátu, socket peer
attestation, přerušená skutečná HTTP stream odpověď, souběžný claim více procesů
ani hostile-web render přes celé Studio. Čerstvý proces ověřuje replay, nikoli
pád serveru po odeslání. Process-local claim není crash recovery: nedostupný
terminal audit se hlásí `unavailable`, záznam může zůstat executing a nesmí se
znovu odeslat. Audit outage není falešně vykázaný dokončený audit.

URL limit ani veřejná IP nejsou ochrana proti exfiltraci na schválený veřejný
cíl. Kontrola konkrétní URL včetně query je proto zásadní. Citovaný code fence
je ochrana prezentace, nikoli důkaz odolnosti budoucího modelového kontextu
proti prompt injection. Webový obsah nesmí získat další effect/approval autoritu.

Historické veřejné smoke JSON obsahuje 2 úspěchy (example/Bing), ale postrádá
source revision, čas, raw response a připnutý driver. Je pouze slabší historický
smoke; nepřičítá se k current-source journey. Starší auditní manifest navíc
kombinoval revision `5d7aab48` s cestou reportu na `2ee19e08`; správný report pro
5d7 je druhý běh `audit-remediation-final-20260911-02`. Staré soubory zůstávají
beze změny; aktuální důkaz má vlastní přesné identity a hashes.

## Integrace a další review

Konsolidační worktree byl read-only zkontrolován na
`7c693d32107cdd5f6d16405ab58ea94057a8f28e`. Již má commitnuté migrace
`111_model_hunt_provider_identity` i `112_model_hunt_append_only`; zde je 111
`conversation_web` a 98 migrací. Nový společný census, číslo a upgrade obou
linií jsou před merge povinné. **112 není volná náhrada.** Cizí práci ani DB
jsme neměnili; tento audit není plošný census všech vzdálených refs.
Následná read-only kontrola před předáním našla čistý upstream `fe064ee8` se
stejnými obsazenými migracemi. Přibyl také samostatný dokument
`docs/decisions/044-reproducible-evaluation-provider.md`; číslo rozhodnutí 044
je tudíž v obou liniích použité pro jiný obsah. Při konsolidaci je třeba
sjednotit i číslování a přesné odkazy rozhodnutí, bez změny jejich přijatého
obsahu. Tento packet pod Decision 044 vždy rozumí přesný konverzační webový
soubor z připnutého kandidátu.

Review má rozhodnout zvlášť o úplné síťové deltě a opravách:

1. Je místní transportní původ nepodvržitelný všemi skutečnými ingress cestami,
   včetně M7 se shodným actor ID, a drží approval uložený konkrétní user-turn?
2. Přežijí claim/invalidace/commit hranice editaci, smazání, cancel, DNS čekání,
   chybějící audit a procesní pád bez opakovaného egress nebo falešného úspěchu?
3. Odpovídá HTTPS transport úplnému síťovému rozsahu Decision 044, včetně TLS,
   veřejných adres, přesměrování a limitů? Které chybějící runtime negativní
   důkazy jsou před release ještě potřeba?
4. Zůstává finální zobrazení/history/model kontext externími daty bez nové autority?
5. Jsou před integrací sladěny migrace a všechny přesné identity důkazů?

Nezávislé webové review a integrační schema testy jsou nejbližší kroky. Celý
projektový builder, spojený Studio/server/model journey a M5/M6 acceptance
zůstávají odděleně otevřené. Alternativou při nutnosti vydat dříve je web z
release kandidátu po novém operátorském rozhodnutí výslovně odložit; samotný
PASS izolovaných testů nenahrazuje review.

Příkazy, aktuální reporty, hashes a zachované neúspěchy:
[run record](../execution/runs/conversation-web-review-20260911.md).
