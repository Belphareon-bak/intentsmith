# Nezávislý holdout a kandidát po archivních reprodukcích

Stav: **PROPOSAL / AUTHOR_UNKNOWN / REVIEW_PENDING / NOT_RUN**.
Autorita: explicitní doplňující posudek operátora z 2. 10. 2026.
Zmrazený kandidát: `0fad3823249104b62edc1e663440d51592de0dbd`.
Srovnávání jiných modelů zůstává odložené; tento návrh je přejímka jedné
skutečné chatové cesty, nikoli modelový panel nebo změna bindingu.

1. Autor nezávislý na implementaci vytvoří například 60 nepoužitých dialogů:
   36 českých, 16 anglických, 4 slovenské a 4 německé. Jde o navržený rozsah,
   ne o již existující či schválený corpus. Předem určí chybějící údaje,
   zdrojovou pravdu, povolené a zakázané efekty a důvody správné odpovědi.
   Zahrne přirozené návaznosti, opravy/negace, složené žádosti, odbočení a návrat,
   skutečnou obnovu procesu a kompakce, zdrojové identity, změny tématu archivu
   a nedostupné nástroje. Delší skutečné dialogy oddělí od syntetického seedování.
2. Před spuštěním zapečetí přesné vstupy, pořadí a rubriku pomocí SHA-256
   manifestu a timestampu. Vývojář nebude podle nich ladit. Nezávislý hodnotitel
   nebude znát vlastní známky vývojáře, jména/digesty modelu ani označení větve.
   Uchová se zvláštní ověřitelný manifest propojující anonymní ID s kandidátem.
   Otázky samy mohou obsahovat jména verzí; to není identita testovaného modelu.
3. Sběr proběhne skutečným M1, s privátní DB/projekty a sériovou GPU lease.
   U každé odpovědi se uchová relevantní předchozí dialog, úplný aktuální vstup,
   zdrojové identity, návrh, schválení a skutečný efekt. Sběr nesmí autonomně
   schvalovat jiné efekty než předem přesně deklarované soukromé fixture.
4. Hodnotitel dostane celé dialogy a odpovídající efekty, ne pouhé izolované
   odpovědi nebo počty slov. Každé užitečné/neužitečné rozhodnutí má významový
   důvod. Předem stejné hlavní cíle: alespoň 95 % užitečných reakcí, nejvýše
   5 % zbytečných zastavení, nula kritických chyb. Zveřejní se také nejhorší
   oblast/rodina, jazyky, dokončení celých dialogů a nejistota odhadu.
   Rozdělení na podskupiny nesmí měnit hlavní jmenovatel ani schovat kritický nález.
5. Sporné hodnocení se zaznamená předem určenou adjudikací a nikdy se tiše
   nepřepíše. Další aplikační oprava vyžaduje konkrétní nový reprodukovatelný
   nález a nový kandidát. Jednou použitý holdout se potom označí jako regrese;
   nebude současně zásobovat ladění a prokazovat dosud neviděnou přejímku.

Pro rychlost se nad stejné vstupy/limity připojí interpretace, generování,
zbytek aplikace a diagnostika; cold a warm se rozlišují skutečným načtením.
Čas celé odpovědi se nesmí zaměnit za TTFT. Publikované sondy S9/S10 jsou
úzké vývojové důkazy a nemají zastupovat tento holdout ani jeho latenci.

K uzavření jsou potřeba nezávislé známky, vyhodnocená rychlost a technické
brány přesného kandidáta. Aktuálně chybí autor/hodnotitel a kontakt; otázka
operátorovi je otevřená. Předávací návrh CI je samostatně v
`docs/review/2026-10-02-CHAT-CI-HANDOFF.md`; jeho vlastník rovněž není určen.
Žádný PR, merge, workflow zásah nebo externí zpráva tímto dokumentem nevzniká.
