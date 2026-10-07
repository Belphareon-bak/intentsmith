# C5 — skutečný vstup ze Studia do D1

**LIVE_ENTRY_NOT_REACHED.** Dva skutečné pokusy skončily před odesláním vstupu;
D1 ani kvalita jeho plánu zatím nejsou ověřené. Deník: [WORK-PROGRESS](../WORK-PROGRESS.md).
Autorita: přijatý přirozený projektový dispatch `8fe6fb53` a výslovné zrušení
pořadové závislosti na H1 operátorem. ROOT vlastní implementaci; druhý worker
přezkoumává runner, důkazy a opravy.

Base obou pokusů je čistý `7ef8efbad9cb4ac78e60c0b29fc2f6f5e565e94c`,
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

CPU pokus jako celek přesto zůstává FAIL. Po dvou řízených fixture odpovědích
classifier+D1 narazil doplňkový assertCapture na předpoklad `canExecute` a
projektového ID na nesprávném místě WS terminálu. Skutečný serializer tato pole
whitelistuje jinak. Připravovaná v5 musí vyhodnotit skutečný WS kontrakt,
durable tahy a nulové effect tabulky; nesmí vydávat chybějící pole za false.
Původní plan oracle se nemění. Nový actual zatím není přijat ke spuštění;
původní FAILy a spotřebované claims se nepřepisují.
Nový v5 fixture WS pokus již skončil CPU PASS (receipt c99d95d7…a2760b),
classifier1+D1fixture1,0CODE/efektů,26 kontrol raw replay/tamper PASS.
Jde zatím o autorský výsledek REVIEW_PENDING, nikoli živý modelový důkaz.

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
Dosavadní pokusy nevyčerpaly žádné modelové volání; schválené HTTP/Fan rozpočty
se tím nezvyšují. Pro reviewerovo nové živé opakování je potřeba sériové GPU
okno s vlastní lease a novými output cestami; přehrání uložených důkazů GPU nepotřebuje.
Zakázané vstupy jsou H1/H2, `restricted/` a jejich odpovědi.

**Release NOT_ACCEPTED; HTTP/Fan FAIL zůstávají.** C5 se zastavuje před CODE,
proto ani budoucí úspěšný proposal sám nepřijme vygenerovanou aplikaci.
