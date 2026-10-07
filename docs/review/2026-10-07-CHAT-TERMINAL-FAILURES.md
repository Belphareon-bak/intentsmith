# C9 — klasifikátor ani projekt nevydají chybu modelu za úspěch

Stav: C9 SOURCE/TEST/EVIDENCE/INTEGRATION_REVIEW_PASS; CI SUCCESS.
Celý dd8a profil NOT_ACCEPTED; navazující C11 profil a54eaa60 má nezávislé FULL_REVIEW_PASS.
Classifier13HTTP/restart, contextv2 52, v3delta7 a project57 PASS.
Autorita: operátorova revize C1/kolo5 nad e6b83884; deník [WORK-PROGRESS](../WORK-PROGRESS.md).
BASE `22bb44134ba7e0dd1e9f145e2c77f301303cd808`, produktový zdroj
`24f329c6a3ffb4e9b0b50a1051adeaee18100fcf`; baseline samostatně d2f39d7e.

Oprava rozlišuje rejected modelový call a úspěšně přijatou, ale neplatnou klasifikaci.
První ukončí tah, druhá zachovává explicitní validační fallback. Neznámý nový
kód gateway už nemůže tiše vytvořit regex doptání. Provider HTTP500/502/503/404,
neověřený či změněný model, EMPTY_RESPONSE a transportní chyba vracejí503.
Poškozená provider obálka včetně přerušeného těla vrací500.
Cancellation má přednost; existující typed chyby se zachovají.

Projektový call používá stejnou normalizaci. Vnější handler už neukládá text
„Příprava dalšího kroku se nepodařila…“ jako úspěšnou odpověď. Vadný/incomplete
plán a vyčerpaný původní jeden strukturální repair končí500. Platný reply s
plan:null zůstává běžnou odpovědí. Žádný nový retry, prompt, model, budget ani efekt.
Interní recoverable:true se nevydává za novou položku veřejného M1 kontraktu;
ten dnes přenáší code/message/status. Interní user m7.status je mimo tuto opravu.

RED zachován: classifier13podmínek mělo6 false-ok s uloženým assistant i po
restartu a2 chybné500 místo503;5 controls PASS. Projektový503 rovněž200/ok.
První sonda měla navíc chybný recoverable-wire oracle; její neúspěch zůstává
oddělený od produktových vad. GREEN používá tutéž skutečnou M1/provider/restart
cestu:13/13, v2context52/52, v3delta7/7. Projekt57/57 pokrývá12 nových scénářů,
pozitivní plan:null a skutečný cancel409. Ověřeny počty ToolV1/M2, user-only
historie u chyby i po restartu a nezměněný projekt/Git. Fixture není živý model.

Zdroj přijal jiný worker než autor; testy a raw evidence mají ještě dalšího
reviewera. Přijaté dvě hrany project→core/{abort-error,chat-turn-error} mění graph
1512→1514 při stejných3cyklech/28členech. Baseline změna má samostatný commit.
Census přeměřen: src688/237254ř., tests604/271024ř.; registry beze změny.
Na clean dd8a: integrace19PASS, finální context55, project57; nezávislé review.
CI37691183506 má1job/18úspěšných kroků, potvrzeno samostatným review.
Celý dd8a profil: runner410PASS, ale skutečný scenario-engine22PASS/20FAILexit0.
Nezávislé review jej NEPŘIJALO. Stejný false-green ověřen ve f475; jeho původní
přijetí celého profilu je stažené, raw/report/posudky se nepřepisují. C5/C7 LIVE_FAIL, C6 NO_GO, H1/H2 a release zůstávají otevřené.

[Paket: base/target, diff, příkazy a očekávané/skutečné exity, raw cesty a SHA-256](evidence/chat-terminal-errors-20261007/result.json).
CPU opakování nevyžaduje GPU. Zakázané čtení: restricted/, H1/H2 corpus, odpovědi
a raw logy. Budoucí živý běh má vlastní sériové GPU okno; tato oprava ho neotevírá.

C11 testový commit d91ea3e7 opravuje příčinu: reálný package scenario fixture a
node:test se42byteidentickými oracle bodies. Positive42PASSexit0; chybějícífixture
20FAILexit1; sync/async mutanti1FAILexit1. Tři negativní kontroly ověřují pravdivý
status procesu. Product/src beze změny; pouze test a jeho koncová whitespace.
Source/test review c429a6d4…f5d261 PASS. C11 na čistém a54eaa60:
7. 10., 22:07:54–22:18:02 UTC, 410 PASS / 0 FAIL / BLOCKED / TIMEOUT / SKIPPED,
exit 0, clean after. Nezávislé review 69e5a0ec…0a771c ověřilo všech 410 logů,
scenario 42/42 a context 55. CI37694174356: 1 job / 18 kroků SUCCESS, review ecfc4383…b4dbc.
Přijetí konkrétního běhu neuzavírá šest dalších nalezených harness vad;
navazují jako [C12](2026-10-08-TEST-HARNESS-INTEGRITY.md).
C11 census: src688/237254ř., tests604/270997ř. Registry beze změny.
Helper output-gate.js v410programovém profilu pouze provádí import smoke,
nikoli vlastní funkční assertions; počet programů se nevydává za počet scénářů.
