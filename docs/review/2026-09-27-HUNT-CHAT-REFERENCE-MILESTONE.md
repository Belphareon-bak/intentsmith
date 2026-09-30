# GPU hunt — úplný nový CHAT sběr a první referenční posudek

Aktualizace: [skutečný druhý posudek, srovnání a zbývající spory](2026-09-27-HUNT-REAL-SECOND-REVIEW.md). Níže je zachovaný stav prvního milníku.

**COLLECTION_AUDIT_PASS / ONE_REVIEW_COMPLETE / REVIEW_PENDING / REAL_NO_GO.**

Nový CHAT sběr je dokončený a všech 80 dialogů má nový posudek Codexu po
kritériích. Staré známky ani odpovědi se nepřenášely. Toto uzavírá chybějící
sběr a první posouzení této dvojice; ne celý GPU hunt ani dvojí přejímku.

## Co otevřít

- **Operátor:** [odpovědi, známky a prioritní revize](</mnt/vi7000/intentsmith/evidence/hunt-chat-context-fixed-20260927-v2/operator-review/comparison-graded.html>).
  Výchozí filtr ukazuje 10 testů, u každého obě celé odpovědi. Všechny ostatní
  odpovědi zůstávají dostupné. Stránka obsahuje první známky i souhrn identit,
  a proto není určena druhému slepému hodnotiteli.
- **Druhý hodnotitel:** [samostatné pokyny bez prvního posudku](</mnt/vi7000/intentsmith/evidence/hunt-chat-context-fixed-20260927-v2/review/SECOND-REVIEWER.md>).
  Čte jeden kanonický balíček `review/packet.json`; vznikla k němu prázdná
  šablona, nikoli druhá kopie balíčku s jiným SHA.
- **Reprodukce:** [kořen evidence](</mnt/vi7000/intentsmith/evidence/hunt-chat-context-fixed-20260927-v2/README.md>),
  `final-audit.json`, `assessment-codex/validation.json`,
  `operator-review/preservation.json` a `operator-review/browser-checks.json`.

## Dokončené milníky

1. **Obnova sběru bez opakování hotového.** Původní běh na `24823996`
   zachytil 78 úplných dialogů a dvě chyby prostředí. Pokračování na čistém
   `554f6612` zachovalo jejich otisky a spustilo jen chybějící dvě úlohy.
   `complete-view` je výslovně odvozený pohled 78 + 2. Původní `BLOCKED`
   výsledek ani chyby prostředí se nepřepsaly na úspěch nebo nulu kvality.
2. **Závěrečný audit skutečného vstupu.** 233 volání = 232 základních a
   jedno opravné. Všechna obsahují přesné předchozí vstupy uživatele.
   Shoduje se 116 párů systémových promptů po normalizaci okamžiku hodin,
   116 párů parametrů, datum 27. září, dva přesné digests, profil a provider
   `0.34.2-intentsmith.2`. Audit kontroluje také původ a nezměněnost dat obou
   zdrojových běhů. Původní sběr z 26. září s vadou historie tento audit odmítá.
3. **Celý nový první posudek.** Ručně přečtených 80 dialogů, 320 známek,
   320 důvodů s odkazem na tah/výrok, samostatná jistota. Přísný JSON je
   navíc mechanicky ověřený. Posudek byl zmrazen před otevřením nového klíče
   identit. Codex však sestavoval sběr a znal dvojici i historické závěry;
   jde o přiznaně exponovaný vývojový posudek, nikoli nezávislou přejímku.
4. **Konkrétní revizní fronta a zachování důkazů.** Čtyři případy s jistotou
   nejvýš 0,70, tři zdůvodněné rizikové výstupy, jeden vlastní kontrolní
   nález a tři reprodukovatelně náhodné kontroly. Výběry se překrývají;
   doplnění protějšku pro stejný test dává 20 odpovědí v 10 testech.
   Náhodná kontrola vznikla až po známkování, není vydávána za předem
   zaslepený vzorek. Druhý hodnotitel musí stále posoudit všech 80 odpovědí.
5. **Použitelný přehled.** Test → model → všechny tahy → známka a důvod.
   13/13 kontrol v prohlížeči včetně shody celých textů se zdrojem,
   filtrů a všech 320 zobrazených známek. První start kontrolního prohlížeče
   nenašel implicitně požadovaný Chrome 152; ověření pak skutečně proběhlo
   s již instalovaným Chrome 145, nic se nedoinstalovávalo.

Obnova a kontrolní negativní případy prošly v `hunt-completion-simulation`
3/3; `artifact-validation` 160/160. Formát posudku validátor přijal 80/80
dialogů a 320/320 kritérií. Kontrola zachování starých dat prošla nad
86 soubory původního sběru a pěti soubory prvního přerušeného pokusu.
Tyto kontroly dokazují integritu a fungování nástrojů, ne správnost všech známek.

## Co znamená opravená historie

Oprava zachovává předchozí **vstupy uživatele**. Neznamená neomezený kontext.
Produkční rozpočet 4096 nadále zkracuje nebo vynechává starší odpovědi
asistenta. Z 229 takových výskytů ve skutečných požadavcích je 111 celých,
98 výslovně zkrácených a 20 vynechaných. Počty jsou z dekódovaných JSON
záznamů historie, nikoli z hledání neescapovaného textu uvnitř promptu.
Ve formuláři jsou všechny finální odpovědi celé. Měří se výkon modelu
v tomto skutečném omezeném produkčním profilu.

## První výsledky pouze pro CHAT

| Model / přesný artefakt v manifestu | Fakta | Použitelnost | Konverzace | Komunikace | Vážený výsledek |
| --- | ---: | ---: | ---: | ---: | ---: |
| qwen3.8:latest | 85,0 % | 85,0 % | 91,9 % | 83,9 % | **86,3 %** |
| qwen3.5:27b | 85,0 % | 83,1 % | 88,1 % | 76,4 % | **84,2 %** |

Každý řádek má 40 dialogů / 160 kritérií / **jeden** nový posudek.
Váhy 0,4 / 0,3 / 0,2 / 0,1 pocházejí z existujícího návrhu
`chat-conversation.3-draft`, nebyly zvolené podle nových výsledků.
Výsledek je průměr vážených známek dialogů, ekvivalentně rovnoměrný průměr
20 CS/EN skupin. Překlady nejsou další nezávislé případy. Nevážené
průměry, přesné hodnoty a jazyky jsou odděleně v `operator-review/summary.json`.
Přísný JSON prošel u obou artefaktů 2/2 a není přičten navíc do obsahu.

Rozdíl **2,06 procentního bodu** je pouze popis tohoto posudku, menší než
návrhový přínos CHAT 4 p. b. Interval ani statistické rozhodnutí se zde
nevydávají. Nemáme přijatý druhý posudek ani čerstvý provozní holdout.
Žádná změna role z této tabulky neplyne.

Příklady k revizi mají konkrétní rozsah: nepodložené schválení release bez
integrace; návrh opřít smazání jediné ověřené zálohy o kontrolu jediného
souboru; zopakování citlivých hodnot v oddělené interní poznámce. Poslední
případ dostal částečné plnění příslušného kritéria, ne nulu celému dialogu,
a nebyl označen za doložený únik třetí straně. Také samotný posudek má
otevřený vlastní nález: u `cs_meeting_window` B je srážka za opravené
mezivýpočty v napětí s politikou netrestat sebekorekci. Návrh změny 0,75→1
je v revizní frontě; zmrazenou známku jsme tiše nepřepsali.

## Identita důkazů

| Artefakt | SHA-256 |
| --- | --- |
| Zadání/rubriky | `4334dd800f3f80521d6e80eb9900eaf8c731246588d9c1ca44701f6c2e15fe65` |
| Odvozený plán 78 + 2 | `08ca3ec4bd0cc8d9a30b51e902f53fdd36074a2e697dbff4dd804c963a3bee7b` |
| Kanonický anonymní balíček | `fdb11f598a294a13fccd84fe78f26d7503a6c6c4de44ce34bd404367d31d7f5c` |
| Zmrazený první posudek | `1f38bddb0b322446ddf356d4cb443913084ecfd6c1f1d6a2f0659693595fab70` |

Zadání se nezměnilo; odpovědi jsou nové kvůli změně profilu historie.
Datum produkčních hodin se proti starému sběru rovněž změnilo, takže rozdíl
starých a nových známek nelze připsat výhradně opravě historie. Zdrojové
plány, odpovědi, posudky, identitní klíč a odvozené přehledy jsou oddělené.
Klíč zůstává v `restricted/`; druhý hodnotitel nesmí číst operátorský souhrn.

## Co zbývá z celého workflow

| Role / etapa | Skutečně doložený rozsah | Neuzavřená podmínka |
| --- | --- | --- |
| D1, D2, R2 | Každá 3 modely × 8 úloh × 3 opakování = 72 odpovědí ve starší kampani | Druhý úplný posudek a přijetí oprav sady; žádná desetimodelová dvojitě posouzená matice |
| R1 | 4 modely × 8 úloh × 3 opakování = 96 odpovědí | Stejně jako D1/D2/R2 |
| Novější `model_cleanup` | 24 odpovědí, dva úplné posudky, 66 kritérií | Pět sporů; jediná úloha nenahrazuje celou D/R sadu |
| CODE | 2 modely × 7 úloh × 3 opakování = 42 odpovědí, technický replay | Přijetí plného orákula včetně významové komponenty; technická známka není plná známka role |
| VISION | 3 modely × 23 úloh = 69 různých výstupů | Přejímka měřidla a provozní ověření; tři totožné kopie nejsou další pozorování |
| CHAT nový | 80 dialogů, audit PASS, nový posudek 320/320 | Druhý nový posudek, srovnání a rozsouzení; potom doplnění ostatních relevantních kandidátů ve stejném profilu |
| Místní hodnotitelé | Technická cesta dvojího posudku, cache, neshod a přejímek existuje | Skutečná nezávisle přijatá dvojice proti rozsouzené referenci, včetně rezervy proti vlastnímu hodnocení |
| Provozní výběr | Metoda a kontroly konfliktů implementované | Nové oddělené případy a doložení předpovědní platnosti po rolích; samotná shoda dvou posudků to nedokazuje |
| Celý hunt | Simulace produkčních tříd prošla 312 kontrolami na umělých odpovědích | Zapojení přijatého vícekolového CHAT hodnocení, skutečný dohledový průchod UI a obnova/rollback |

312 historických D/R odpovědí má jeden úplný Opusův posudek 840/840 kritérií,
navázaný na packet `b3a2f334…`. Dva nové posudky jediné opravené úlohy se do
něj nepřimíchávají. Starší širší sběry zůstávají evidence svých profilů,
nikoli náhrada chybějících buněk dnešní přijaté matice.

Nejbližší konkrétní krok je druhý posudek tohoto nového CHAT balíčku a
porovnání přes `compareHuntBlindReviews`. Operátor následně řeší neshody
nad 0,25, nízkou jistotu a vybranou kontrolu. To uzavře referenci této
dvojice, nikoli automaticky přejímku hodnotitelů či výběr pro všechny role.
První použitelný provozní režim může sbírat a předkládat doporučení pod
dohledem. Samostatné přepínání zůstává finále; mazání instalovaných modelů
je dál zakázané. Z tohoto milníku se žádný živý binding ani rozhodovací
příznak nemění.
