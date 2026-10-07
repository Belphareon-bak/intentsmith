# C9 — klasifikátor ani projekt nevydají chybu modelu za úspěch

Stav: SOURCE_AND_TEST_EVIDENCE_REVIEW_PASS; integrace NOT_RUN.
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
Integrace, celý profil a CI tohoto zdroje zatím NOT_RUN. Starší f475410PASS se
nepřenáší na nový zdroj. C5/C7 LIVE_FAIL, C6 NO_GO, H1/H2 a release zůstávají otevřené.

[Paket: base/target, diff, příkazy a očekávané/skutečné exity, raw cesty a SHA-256](evidence/chat-terminal-errors-20261007/result.json).
CPU opakování nevyžaduje GPU. Zakázané čtení: restricted/, H1/H2 corpus, odpovědi
a raw logy. Budoucí živý běh má vlastní sériové GPU okno; tato oprava ho neotevírá.
