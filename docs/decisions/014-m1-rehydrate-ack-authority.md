# 014 — Rehydrate ACK musí autoritativně pokrýt celý požadovaný set

- **typ:** BLOCK
- **stav rozhodnutí:** A SCHVÁLENO; SERVEROVÝ CHECKPOINT IMPLEMENTOVÁN;
  KLIENT, 012 A SPOLEČNÝ LIVE WIRE DŮKAZ OTEVŘENÉ
- **WP:** WP-M1-STUDIO
- **rail:** R1, R3, R5, R6
- **vzniklo při:** read-only review serverového limitu a klientského cleanupu

## Evidence na stole

`ws-server.js` dnes zpracuje nejvýše prvních 32 požadovaných conversation ID,
ale odpoví `validationFailed: false`. `ws-client.js` interpretuje každé ID,
které v `validIds` chybí, jako neplatné a přes `_clearInvalidSession()` smaže
identitu i lokální zprávy.

End-to-end probe se skutečným handlerem a klientským VM harness prokázal:

```text
requested: 40
lookups / ACKed: 32
omitted and cleared: 8
validationFailed: false
```

Chybějící store nebo metoda `exists` dnes vrací prázdné `validIds` se stejným
autoritativním příznakem a může tak označit všechny panely za neplatné. Stejnou
falešnou autoritu umí vydat funkční, ale nedurable in-memory store: `exists()`
má, jen všechny dřívější SQLite identity legitimně nezná. Sesterská exception
větev naopak fail-closes. `T25g` částečný ACK připíná jako očekávané chování,
takže současný green je důkaz rozporu, nikoli důkaz bezpečnosti.

Běžné UI ukládá `_sessionCount` klapnutý na 1–3, takže nad 32 se normálním
používáním nedostane. Cesta je dosažitelná přes poškozený nebo ručně editovaný
persistovaný stav a je relevantní pro budoucího druhého klienta. Priorita stojí
na kontraktní autoritě, nikoli na tvrzení, že běžný uživatel dnes otevře 40
panelů.

## Varianty

| Varianta | Chování | Dopad | Cena zavedení |
|---|---|---|---|
| A — úplný bounded partition nebo reject | Server vydá ACK jen pro celý set do 32 ID; větší/malformed set odmítne bez partial ACK | Jedna autoritativní sémantika a žádné mazání z absence | WS schema/server/client, local restore clamp, wire a VM negativní testy |
| B — stránkovaný ACK | Každý request může mít více navazujících úplných stran | Podporuje více panelů, ale přidává ordering/retry state machine, který produkt 1.0 nepotřebuje | Nová wire verze, stránkovací stav na obou stranách a recovery testy |
| C — pouze zvýšit limit nebo klapnout klienta | Současný implicitní komplement zůstane autoritou | Nechrání budoucího klienta ani missing-store/partial-error větev | Malý diff, ale invariant zůstává nepravdivý |

## Rozhodnutí operátora — 2026-08-08: A

1. Každý request nese `rehydrateRequestId`, který odpověď přesně zopakuje.
2. Nejvýše 32 unikátních, syntakticky platných ID smí vytvořit ACK. Více než
   32, duplicita nebo malformed set vytvoří typovaný `rehydrate_reject` s
   důvodem; nevznikne žádný partial ACK ani cleanup.
3. ACK smí vydat jen store, který explicitně potvrzuje durable/DB-backed
   readiness. Chybějící store/`exists`, in-memory store, nedokončená DB
   inicializace nebo lookup exception nevydá ACK ani reject s autoritou nad
   identitou. Unavailable větev uzavře spojení kódem `1011`, aby klient nemohl
   nedostupnost zaměnit za autoritativní invaliditu.
4. Úspěšný ACK nese `complete: true`, `validIds` a `invalidIds`. Pole jsou
   disjunktní, bez duplicit a jejich sjednocení je přesně původní požadovaný set.
5. Klient smí zrušit identitu pouze pro explicitní `invalidIds` a jen pokud
   socket epoch, conversation identity a lokální snapshot stále odpovídají
   requestu. Absence ve `validIds` už sama o sobě není evidence.
6. Incomplete, foreign, duplicated, overlapping, unsolicited nebo jinak
   nekonzistentní ACK zachová všechny snapshoty a skončí `degraded`.
7. Matching `rehydrate_reject` zopakuje `rehydrateRequestId`, okamžitě ukončí
   právě tento běh jako `degraded` a nespustí history fetch, cleanup ani pětisekundové
   čekání. Foreign, replayed nebo malformed reject nesmí ukončit aktuální běh.
8. Restore z localStorage normalizuje celočíselný `sessionCount` na `1..3`;
   invalidní typ/hodnota dostane bezpečný default `2` a teprve potom clamp.
   Nulově indexovaný `sessionActive` se normalizuje na `0..sessionCount-1`;
   invalidní typ/hodnota dostane default `0` a potom clamp. Jde o
   defense-in-depth, ne náhradu serverového wire kontraktu.
9. Lokálně malformed `_convId` se nevymaže preflightem. Neodešle se na server,
   panel zůstane se snapshotem v explicitním `degraded`/quarantined stavu a
   nemůže provést chat efekt, dokud uživatel identitu neopraví nebo vědomě
   nezaloží novou konverzaci.

## Ordering s history GET (012)

Po rozhodnutí 012/B existují dvě různé informace: ACK autorita identity a GET
autorita obsahu. **Pouze `invalidIds` z úplného ACK ruší `_convId`.** Následné
typované `404` z GET je degraded obsahový výsledek a identitu zachová do dalšího
rehydrate. Hard-delete mezi ACK a GET proto nemůže zrušit panel podruhé ani
zasáhnout mezitím znovupoužitou pozici.

## Povinný důkaz před uzavřením

- 32 ID vytvoří přesný úplný partition; 33 i 40 vytvoří reject a nulový ACK;
- missing store/`exists` a throw po několika úspěšných lookupách nikdy nevydají
  partial ACK;
- funkční `exists()` nad in-memory store rovněž nevydá autoritativní ACK;
- klient odmítne ACK bez `complete`, s chybějícím, duplicitním, overlapping nebo
  cizím ID a nic nesmaže;
- matching reject skončí okamžitě jako degraded bez GET/cleanup/timeout wait;
  foreign, replayed a malformed reject aktuální běh neukončí;
- validní partition vyčistí jen explicitně invalidní nezměněný panel;
- persisted `sessionCount=40` se klapne na `3`; string/null/float dostanou
  default `2`; `sessionActive` se klapne do `0..sessionCount-1` a jeho
  string/null/float dostanou default `0`;
- syntakticky malformed lokální identita zachová snapshot v quarantined stavu;
- živý DB-backed WS wire test prokáže stejnou sémantiku; in-memory helper nebo
  samotný VM test jej nenahrazuje;
- typed history `404` po úspěšném ACK zachová `_convId` i při souběžném reuse
  panelu.

Rozhodnutí 014 lze implementovat ve stejném rehydrate-authority checkpointu
jako 012, ale jeho acceptance invariant zůstává samostatný. Gate 1 je do obou
implementací a skutečného wire důkazu `BLOCKED`.

### Implementační pořadí

1. server 014: bounded request, request ID, reject/úplný partition a durable-store guard — **implementováno v serverovém checkpointu**;
2. klient 014: přesný partition, reject, stale/foreign ochrany a bezpečný restore;
3. route 012: existence a messages v jednom SQLite snapshotu/transakci;
4. klient 012: autoritativní prázdná historie, zatímco `404` pouze degraduje;
5. společný DB-backed live wire test.

### Stav serverového checkpointu

Server přijme pouze syntakticky platný `rehydrateRequestId`. Neplatný request
ID zavře právě tento socket kódem `1008`, protože server nesmí echoovat
neomezenou nekorelovatelnou hodnotu. Platný request ID a vadný conversation set
vrací typovaný request-bound reject. Délka nad 32, duplicita, malformed ID i
ne-array vstup končí před prvním DB lookupem.

Autoritativní ACK vznikne pouze z explicitně durable, otevřeného a file-backed
SQLite `ConversationStore`. `exists()` musí pro každou položku vrátit přesně
boolean; Promise, string, chybějící metoda, in-memory store, zavřená DB nebo
výjimka vrací unavailable a socket `1011`, nikdy partial ACK. Úspěšný ACK nese
úplný ordered partition `validIds/invalidIds` a přesně opakuje request ID.

Focused wire test používá skutečný file-backed SQLite store. Samostatně pinuje
1008 pro malformed request ID, 1011 bez ACK/reject pro transientní DB chybu a
in-memory store a nulový lookup pro over-limit reject. Klientská autorita,
localStorage clamp, 012 route a společný built/live journey tím nejsou hotové;
Gate 1 zůstává `BLOCKED`.

Mezi serverovým a klientským commitem je starý klient záměrně fail-closed:
neposílá request ID a server jeho rehydrate socket zavře `1008`. Tento
mezistav není přijatelný produktový checkpoint a musí bez prodlevy následovat
klientská polovina před jakoukoli built journey nebo integračním přijetím.
