# Oprava podrobnosti a návaznosti chatu

20. 9. 2026 · FLOW_RUNTIME_VERIFIED / REVIEW_PENDING / CHAT_CONTENT_NOT_ACCEPTED · autorita: hlášení operátora se screenshoty.
Vstup `080114ae`, původní instalace `9660d99b`; větev `work/chat-quality-20260920`.
Review rozsah kódu: `080114ae9c7374b0052748cc907acf03e25d33cd..9ad8bc3ff609400ec1cd44e50db4fe71ec1ee283`.
Nasazený runtime: `9ad8bc3f`; následný dokumentační commit nemění runtime.
Hunt, měřicí kontrakty, bindingy a modelové profily nejsou součástí změny.

## Reprodukce a příčina

Skutečný M1 HTTP průchod na původním runtime se stejným CHAT `qwen3.5:27b`:
Docker 47 slov, srovnání Kubernetes 42, výslovný detail 34, `vic detailu`
ASK_USER (20 slov menu), opakování požadavku 45. Generované odpovědi měly
`finishReason=stop`; nešlo v tomto průchodu o useknutí výstupu.
`decisions.js` ukládal nepodmíněně 45 slov / 2–3 věty, krátké otázce dával
256 tokenů a z historie bral 200 znaků každé zprávy. Krátký požadavek na
rozvedení nedostal pokračování ANSWER. Nález není pořadí kvality modelů.

## Změna

Konverzační prompt přizpůsobuje hloubku zadání a připouští nejistotu.
Plánuje dokončitelnou odpověď podle skutečného tokenového rozpočtu (orientační
rozsah, nikoli přesný počet slov). Při `finishReason=length` může nejvýše
dvakrát požádat o úspornější přepracování v rámci původního retry limitu a
stejné tokenové autority. Nedokončená verze se nepublikuje ani neukládá;
po vyčerpání pokusů zůstává `MODEL_RESPONSE_TRUNCATED`. Metadata ukazují
`answerBudget` a `answerRetries`.
Běžná odpověď má rozpočet do 1200 tokenů, detail do 2048; skutečný rozpočet
se může snížit podle dostupného kontextu. Pozdravy zůstávají krátké, vlastní
rozpočty CREATIVE/CODE se nemění. Kontextový profil modelu se nezvětšuje.
Historie využívá dostupný prostor, zachová úvod i konec dlouhé zprávy,
označuje vynechání a neduplikuje poslední uživatelský vstup. Bounded UTF-8
odhad není přesný tokenizer; posledních deset zpráv není paměť celé konverzace.
Příliš velký aktuální dotaz se odmítne, potichu se neořízne.

Přesně ohraničený požadavek na podrobnosti po ANSWER pokračuje tématem
přes auditovaný override. Nepřehrává tool effects, nepřeklápí příkazy ani
URL na ANSWER a neobchází pending clarification ani pre-handler approvals.
Běží přes původní gateway, tokenovou autoritu a cancellation signal.

Bing RSS se zobrazuje jako nejvýše deset deduplikovaných odkazů a náhledů;
bez hlavičky feedu, copyright balastu, HTML a automatického načítání odkazů.
Jednoduchá shoda klíčových slov odfiltruje zjevně nesouvisející výsledky,
ale neověřuje jejich správnost, úplnost ani splnění všech podmínek.
Bez výsledku se přizná, že odpověď není doložená. Souhlas nadále schvaluje
jeden přesný HTTPS požadavek. Raw bytes/digest/replay zůstávají zachované.
Před novým návrhem URL se odstraňuje jen konverzační úvod hledání; podmínky
uživatele zůstávají a výsledná URL je stále celá viditelná ke schválení.

Skutečný uložený RSS ze screenshotu (`web:b42e87f4…`, SHA-256
`66340abcc96068bf1e4d06a2fae2aa6e5886427eda62e248963789fc08d8a689`)
byl načten read-only a přehrán jako kontrolované tělo v izolované DB:
žádný nový outbound, 0 použitelných výsledků, žádný OTTO/copyright dump.

## Skutečný HTTP průchod na konečné instalaci

Stejný CHAT binding `qwen3.5:27b`, digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
profil 4096. Pět původních zadání bylo zopakováno v nové konverzaci;
druhá nová konverzace ověřila odlišné téma a následné zkrácení.

| Zadání | Původní runtime: slov | Konečný runtime: slov | Výsledek konečného běhu |
|---|---:|---:|---|
| co je to docker? | 47 | 216 | ANSWER / stop |
| a jak funguje kubernetes? v cem jsou rozdily? | 42 | 279 | ANSWER / stop |
| muzes mi detailne popsat jak to funguje | 34 | 436 | ANSWER / stop |
| vic detailu | 20 (ASK_USER menu) | 506 | ANSWER / stop, stejné téma |
| chci vic detailu | 45 | 406 | ANSWER / stop, stejné téma |
| Co je databázový index? | neměřeno | 218 | ANSWER / stop |
| vice detailu | neměřeno | 435 | ANSWER / stop, stejné téma |
| Shrň to do dvou vět. | neměřeno | 44 | ANSWER / stop, skutečně dvě věty |

Všech osm tahů má HTTP 200, `ConversationResult.status=ok`, stejný model,
0 retry. Obě vlastní konverzace byly poté archivovány (HTTP 200).
Počty slov jsou pouze reprodukční údaj, nikoli skóre kvality. Vzorek osmi
tahů neprokazuje bezchybnost všech budoucích odpovědí. Toto je backendový
HTTP průchod s fyzickým modelem, nikoli nový end-to-end test vykreslení Studia.

[Úplné vlastní testovací odpovědi před/mezistav/po](2026-09-20-CHAT-QUALITY-TRANSCRIPTS.json)
zachovávají i neúspěšný meziběh. [Manifest důkazů](2026-09-20-CHAT-QUALITY-EVIDENCE.json)
obsahuje SHA-256 původních lokálních artefaktů, všech 360 logů posledního
profilu i obou starších běhů. Raw logy a archivy nejsou součástí publikace.

## Ověření

- m1-chat-contract 33/33; conversation-web 27/27.
- chat-memory-privacy 11/11; skutečné HTTP privacy včetně restartů 1/1.
- conversation-web-http 7/7 nad vlastním loopback serverem a dočasnou TLS identitou.
- module boundary 1380 hran, 3 cykly / 28 členů. Přibyly pouze čtecí importy
  config a model-ctx z decisions; zmizel již dříve odstraněný eval→synthetic-images.
- První úplný profil `af1ba099`: 358 PASS / 2 FAIL. Jeden Gate 0, druhý
  dokumentační census (LOC + počet hran). Po opravě census má samostatná
  artifact-validation sada 160/160. První běh zůstává zachovaný.
- Přímá invokace HTTP sady selhala bez runner port file; nightly ji správně
  vedl jako BLOCKED, protože není self-starting. Vlastněný fixture runner
  následně spustil skutečný server, získal jeho identitu a dosáhl 7/7.
- První RSS test zachytil zobrazení entity-escaped img tagu (26/27); oprava
  opakovaně odstraňuje tagy po dekódování a má 27/27. Chybný log zůstává.

- První fyzická verze `945fc40c` měla u první otázky HTTP 502 /
  MODEL_RESPONSE_TRUNCATED, další čtyři odpovědi byly úplné a navazovaly.
  To vedlo k opravě plánování délky a retry v `9ad8bc3f`; původní neúspěšný
  `after-http.json` není přepsaný výsledkem následného běhu.
- `9ad8bc3f`: úplný offline/database profil **359 PASS / 1 FAIL / 0 BLOCKED**,
  non-PASS pouze `nightly-orchestrator-self-test` (reviewed Gate 0 registry hash).
  Pečeť se neměnila; celkový verdict zůstává **FAIL**. Konkrétní cestu, původ
  a SHA-256 všech 360 logů obsahuje níže uvedený manifest.
- Skutečný izolovaný handler + gateway + qwen3.5:27b před nasazením: 3/3 stop,
  208 / 589 / 508 slov, 0 retry. Toto samostatně není HTTP ani Studio důkaz.
- Instalace `9660d99b → 945fc40c → 9ad8bc3f`: auth HTTP 200 / bez auth 401,
  DB quick_check ok, 0 FK chyb, 105 migrací. Při obou nasazeních zachováno
  všech devět kontrolovaných tabulek včetně bindingů, evaluací a paměti;
  všech 16 projektů má stejné údaje kromě očekávaného last_active z původního
  startup scanu devíti existujících projektových adresářů. Porovnání je před
  následujícími vlastními chatovými testy; ty pak přidávají své archivované relace.
- Žádný nový worktree. 3 dokončené runtime sandboxy byly zkomprimovány po
  `tar --compare` bez rozdílu; reporty, checkpointy i všechny logy zůstaly na
  původních cestách. Ušetřeno 0,712 GiB. Pro práci s dočasnými runtime soubory
  lze rozbalit příslušný archiv zpět do adresáře běhu.
- Vlastní dokončený modelový probe byl uvolněn pouze po shodě přesné identity,
  nezměněného idle-expiry s časem našeho posledního výstupu, nulových dalších
  klientů a získání společného GPU lease. Nešlo o vyřazení modelu ani změnu DB.

Důkazy: `.intentsmith-artifacts/chat-quality-20260920/`; nové veřejné reporty
nesmí obsahovat lokální capability ani administrátorský token.

## Hranice výsledku

Toto není komplexní přeměření CHAT modelů, důkaz převahy nad historickým C3,
ani akceptace celého produktu. Web zatím není samostatný vícestránkový rešeršní
agent; náhled není prověřený inzerát. Markdown renderer Studia se v této
opravě nemění. Nezávislé review této změny zůstává otevřené.

## Obsahová kvalita zůstává otevřená

Ani poslední obecný prompt není zárukou správnosti. Ve skutečném HTTP běhu
na `9ad8bc3f` model při vysvětlení Kubernetes dál používá neodůvodněné
„okamžitě“ a „bez výpadku“. Takovou garanci nelze připsat samotnému
orchestrátoru; záleží na detekci poruchy, konfiguraci, replikách a kapacitě.
Dokumentace například popisuje výchozí pětiminutové čekání mezi stavem Unknown
a prvním eviction requestem: [Kubernetes Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/).
V odmítnutém meziběhu navíc slučoval Docker Swarm s ruční správou, přestože
Swarm má orchestraci a udržování požadovaného počtu replik:
[Docker services](https://docs.docker.com/engine/swarm/how-swarm-mode-works/services/).
Izolovaný probe nepřesně spojoval trvalost zápisové vrstvy se zastavením
kontejneru; relevantní hranicí je jeho odstranění:
[Docker storage](https://docs.docker.com/engine/storage/drivers/).
Pozorovaná čeština má také chyby jako „instancie“, „Složitosť“ a „běželit“.

Nejde o nové ruční pravidlo pro Docker v produktu. Testovací zadání nesmí
vést k naučení odpovědi na tento jeden příklad. Pro navazující CHAT hodnocení
jsou důležité obecné vlastnosti: faktická správnost a podmínky tvrzení,
vícetahová návaznost, změna požadované hloubky, respektování stručnosti,
čeština a úplný terminál. Pouhý počet slov, HTTP 200 ani `stop` tuto kvalitu
neprokazují. Hunt kontrakty/bindingy v této větvi zůstaly nedotčené.

V druhém tématu konečná odpověď o B-stromu popisuje jen levou/pravou větev
a nerozlišuje vnitřní a listové stránky. B-strom je vícecestný; například
PostgreSQL výslovně rozlišuje odkazy vnitřních stránek na další úroveň a
listové záznamy: [PostgreSQL B-tree](https://www.postgresql.org/docs/18/btree.html).
To potvrzuje, že problém správnosti není omezen na Docker. Jde o pozorování
současné kombinace modelu a promptu; bez srovnávacího experimentu nelze
veškeré chyby připsat jen modelu nebo jen aplikaci.

## Zaměření nezávislého review a dalšího měření

1. `src/chat/handlers/decisions.js`: rozpočet, zachování aktuálního zadání,
   zkrácení historie, retry limit a metadata; úplnost vs. skutečná správnost.
2. `src/chat/handlers/conversation.js`: úzké pokračování odpovědi, zachování
   pre-handlerů/approvals, žádné přehrání efektu a žádné převzetí nového záměru.
3. `src/chat/handlers/conversation-web.js`: nedůvěryhodný RSS text, URL,
   escapy, falešná relevance a přesně jedno schválení/požadavek.
4. Následné CHAT měření: více témat a více tahů, správné věcné hranice,
   přiznání nejistoty, čeština, rozvedení i zkrácení. Rozhodnutí o modelu
   musí vycházet z měření přesných artefaktů; tato oprava role neaktivuje.

Reprodukce cílených kontrol: `node tests/m1-chat-contract.test.js`,
`node tests/conversation-web.test.js`, `node tests/chat-memory-privacy.test.js`,
`node tests/chat-privacy-http.test.js`. Web HTTP sada vyžaduje serverový runner;
prosté spuštění bez port file není platný důkaz této sady. Kompletní příkazy
profilů a identity prostředí jsou v původních `report.json` připnutých manifestem.
