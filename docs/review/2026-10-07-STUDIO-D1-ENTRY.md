# C5 — skutečný vstup ze Studia do D1

**LIVE_FAIL / D1_NOT_REACHED.** v5 po opravě ovladače vstup odeslal, ale
monitor běh přerušil před úplnou modelovou odpovědí. Historické v2/v4 skončily
před odesláním. D1 ani kvalita jeho plánu zatím nejsou ověřené. Deník: [WORK-PROGRESS](../WORK-PROGRESS.md).
Autorita: přijatý přirozený projektový dispatch `8fe6fb53` a výslovné zrušení
pořadové závislosti na H1 operátorem. ROOT vlastní implementaci; druhý worker
přezkoumává runner, důkazy a opravy.

Base historických v2/v4 pokusů je čistý `7ef8efbad9cb4ac78e60c0b29fc2f6f5e565e94c`,
[CI37661980083](https://github.com/Belphareon-bak/intentsmith/actions/runs/37661980083)
všech18 SUCCESS. [Paket s příkazy, skutečnými exity, cestami a SHA-256](evidence/studio-d1-entry-20261007/result.json).

Původní exponovaný vstup má1012B, SHA256
`6928c0192d6c0f5861110bdc6bec7716cb7c0bb364b9b637943b612404926f9c`.
Zadání, prompty, modely, schema ani oracle se nemění. Gemma4:26b classifier
`08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68`,
Qwen3.5:27b D1 `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`,
oba4K. Limit je1classifier + nejvýše2D1; druhý jen stávající structural repair.
CODE0, ostatní generování0, žádné prepare/approval/execution. Úspěch znamená
stejný skutečný ProjectWorkProposal v M1 terminálu a ve Studiu, přesné čtyři
cílové soubory a původní project/conversation/session binding.

| Kandidát | Skutečný výsledek | Modelová volání |
| --- | --- | --- |
| v2,18:40:34–18:40:47UTC | FAIL `FAN_REQUIRES_ONE_VISIBLE_CHAT_COLUMN`, exit1 | 0 |
| v3 | Review CHANGES_REQUIRED, actual NOT_RUN; nesouhlas názvu claim a nedostatečně omezené CDP čekání | 0 |
| v4,18:54:25–18:54:47UTC | FAIL desetisekundové DOM readiness, exit1 | 0 |

v4 zachovává původní controller a pouze pozoruje DOM. Po celou dobu vidí jeden
Studio root, dva viditelné textové vstupy a dvě tlačítka Odeslat. Hypotéza,
že postačí čekat na render, se nepotvrdila. Zdroj vysvětluje trvalý stav:
`bindActualConversation` nejprve klikne Jedna relace, ale pak otevře novou
konverzaci bez slotu; `SessionStore.nextSlot(undefined)` připojí další sloupec.
Úzká oprava ovladače předává běžný argument slot0. Nemění produktový
session store ani neinjektuje stav. Nezávislý reviewer ji přijal pro toto
chování: literal Studio CPU historický2/opravovaný1 sloupec, po5 stabilních
vzorcích, různé prázdné profily, stejná skutečná project/conversation vazba.
Review SHA256 `20da6ebfe276ada8588454702256d3a78685d049c4fbadfe9dd5b334a9db5b25`.

Historický CPU pokus před v5 jako celek přesto zůstává FAIL. Po dvou řízených fixture odpovědích
classifier+D1 narazil doplňkový assertCapture na předpoklad `canExecute` a
projektového ID na nesprávném místě WS terminálu. Skutečný serializer tato pole
whitelistuje jinak. Následný v5 guard byl nezávisle přijat podle skutečného
WS kontraktu a durable tahů; původní plan oracle se nezměnil. CPU26PASS není
živý modelový důkaz. Přesný v5 actual a jeho FAIL jsou uvedeny níže.

v2/v4 before i after full closure mají PASS/exit0. Původních58488 v2 refs
zachováno ve v4, která má58493 refs/309 symlinků. Váhové blobs nebyly znovu
hashovány celé: kontroluje se hash manifestu a identita/velikost/mtime souborů.
Privátní HOME/DB/projekt a net namespace nejsou read-only izolací filesystemu;
root filesystem je RW bind. Platí původní omezení procesní provenance/PGID,
vzorkovaného sledování a kernel EXE EACCES, nikoli záruka všech uniklých setsid.

Oba pokusy zachovaly projekt/Git/M2/ToolV1 stav. v2 pozoroval17 a v4 19 vlastních
procesních identit; žádná nezůstala, žádný cleanup signál nebyl potřeba.
Relay0, lease uvolněná. GPU se nepoužila pro generování. CPU test repair větve
zachovává samostatný FAIL: dodatečný repair prompt se do4K nevešel a byl
zastaven před druhou emisí; limit2D1 není slib, že repair do4K vždy vejde.

Každý freeze dovoluje jediný pokus. Nový kandidát po doložené opravě testovacího
ovladače má nové review/freeze/claim, nikoli opakování spotřebovaného pokusu.
Historické v2/v4 pokusy nevyčerpaly žádné modelové volání; schválené HTTP/Fan rozpočty
se tím nezvyšují. Pro reviewerovo nové živé opakování je potřeba sériové GPU
okno s vlastní lease a novými output cestami; přehrání uložených důkazů GPU nepotřebuje.
Zakázané vstupy jsou H1/H2, `restricted/` a jejich odpovědi.

**Release NOT_ACCEPTED; HTTP/Fan FAIL zůstávají.** C5 se zastavuje před CODE,
proto ani budoucí úspěšný proposal sám nepřijme vygenerovanou aplikaci.

## v5 — vstup odeslán, běh přerušen; D1 nepřijaté

Clean `cd3b8f02b65dbe0a92eab625ff39a5447f00cdb0`, CI37673340385/18SUCCESS.
Nezávisle přijatý v5 guard odpovídá skutečnému WS serializeru: canExecute a
top-level projectId na wire chybějí podle whitelistu; nepřítomnost se nevydává
za pozorované false. CPU fixture:26 raw/tamper kontrol PASS,
classifier1+D1fixture1,0efektů, dva durable tahy. Posudekeec855a0…7cf8b9.

První freeze builder skončil před actual chybou při čtení chybějícího device
z hash-only reference. Původní partial packet zůstal; opravený r2 nejprve ověří
původní hash/velikost a každou přítomnou identitu, pak vytvoří aktuální úplnou
referenci. Jeho7CPU kontrol i nezávislé review458b7be2…250471 PASS.
Finální freeze07502b18…b722d má59429refs/309linků; READY reviewf3f2dcb2…fd8797a.

Actual 7.10.19:44:28–19:44:42UTC skončil FAIL/exit1. Opravený ovladač doložil
jediný skutečný sloupec ve dvou vzorcích a odeslal původní vstup. Byl připuštěn
1 classifier request, ale žádná úplná modelová odpověď; D1/CODE0. GPU dohled
zachytil NVIDIA PID1492316, jehož /proc už vracelo ENOENT. Při cleanup jiný
PID1492337 měl stav Z a prázdné argv. První identita zůstává UNKNOWN, druhá NOT_FULLY_ATTESTED; nejde o
prokázanou cizí práci ani přijatý vlastní model. Freeze authority pole nebyla chybná.

Všech16 pozorovaných aplikačních procesů zaniklo, byly potřeba3SIGTERM skupinám;
relay0. Graceful cleanup se neclaimuje a původní inside/after-stop/capture
artefakty chybějí. Nezávislý post-stop audit vlastní DB kopie a projektu doložil
8stejných souborů, nezměněný Git a36prázdných authority tabulek. Source closure
před i po actual PASS. Je uložen USER a protokolový ASK_USER s M7 ok,
classifiedBy regex/confidence0.3. Není to dokončená modelová odpověď ani D1.
Přesný gateway exception nebyl zachycen; jde o otevřený nález
TRANSPORT_CLOSURE_WITH_OK_FALLBACK, nikoli prokázanou regresi přesné C1 větve.

Own lease původně zůstal k recovery. Po nezávislé revizi a nových3prázdných
ps/NVIDIA vzorcích ROOT ověřil mrtvý původní PID a přesný token/hash/dev/inode,
odstranil pouze owner.json přes připnutý descriptor a prázdný vlastní lock
adresář. Bez unload/signal/modelového volání. Recovery7f1576b9…29cb0 má samostatné
reviewbdfba6d9…5ba82; nepřepisuje actual FAIL ani UNKNOWN identity.
Actual reviewb87ccf60…ad3e8, immutable323refs/3links542cbc13…e740.

Další C5 retry ani rozšiřování aparátu se v tomto cyklu neprovádí. Podle pravidla
stagnace se práce přesunula na prokázanou produktovou ztrátu save kontextu C7.
Před dalším Studio→D1 pokusem je nutná jiná omezená strategie a nezávislý přezkum;
HTTP/Fan budgety se nezvýšily, release zůstává NOT_ACCEPTED.

[Přesný doplněk v5 s příkazy a SHA-256](evidence/studio-d1-entry-20261007/v5.json).
Samostatný [C8](2026-10-07-CHAT-TRANSPORT-FAILURES.md) opravuje tři reprodukované
providerové chyby; zpětně neidentifikuje nezachycenou výjimku C5.
