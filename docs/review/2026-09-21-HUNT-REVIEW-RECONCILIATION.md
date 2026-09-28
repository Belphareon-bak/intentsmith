# GPU hunt — rozsouzení review a skutečný stav dokončení

**FACT_CHECKED / SCALE_ADJUDICATION_OPEN / NOT_DEPLOYED / NO_GO.**
Autorita: připomínky a otázka operátora 21. 9. 2026, HANDOFF §5,
DIRECTION §1 a větev B. Tento záznam zpřesňuje závěr
[packetu 20. 9.](2026-09-20-HUNT-COMPLETION.md); jeho archiv ani původní
známky se nemění. Nejde o nezávislou přejímku.

## Co se skutečně porovnávalo

1. Sběrové skripty spustily role nad panelem 12 artefaktů podle jejich
   použitelnosti pro text/obraz. Uložily 2 922 pokusů, přesné vstupy, odpovědi,
   identity a provozní výsledky. Ne každý model běžel v každé roli.
2. CODE četla spustitelná orákula, strukturovaný CHAT/VISION kontroly polí
   přes produkční `extractJSON`, otevřené odpovědi posuzoval Codex podle
   rubrik. Všechny pokusy jsou vyúčtované; to neznamená přijetí všech známek.
3. Následovalo 76 použitelných nových provozních pokusů s vybranými dvojicemi,
   srovnaných s benchmarkem. D1/D2 končily na výstupu kroku, ne dokončením
   celé opravy; ostatní meze a 33 vyřazených pokusů zůstávají v původním packetu.
4. Claude nyní dodal druhé hodnocení 30 položek; deklaruje slepé čtení.
   Toto následné porovnání už slepé není.

**Nepřijal a nenasadil se automatický hodnotitel huntu.** Není to porovnání
„naše známky proti známkám přijatého GPU huntu“. Jsou to dvě odlišné osy:
shoda posuzovatelů nad stejnými odpověďmi a přenos benchmarku do nové práce.

## Oprava interpretace pořadí

D1 a R2 změnily znaménko **bodového rozdílu**, ale benchmarkový rozdíl byl
pod praktickým prahem. Není doložená reverze rozhodovacího doporučení ani
prokázaná nespolehlivost sady. Dosavadní rank-check obecnou předpovědní
platnost **nepotvrdil ani nevyvrátil**. Výběr blokuje malý/nepřijatý důkaz,
nikoli tvrzení, že se prokázala opačná výkonnost.

Tabulka používá původní zmrazené autorské známky, vyšší benchmark minus
nižší benchmark. Po rozsouzení známek vyžaduje nový přepočet.

| Role | Rozdíl benchmarku | Práh v role plánu | Rozdíl provozních bodů | Výklad |
|---|---:|---:|---:|---|
| CODE | +0,1587 | 0,05 | +0,1667 | shodný bodový směr, široký interval, NEROZHODNUTO |
| D1 | +0,0156 | 0,06 | −0,2500 | podprahový benchmark, změna bodového pořadí |
| D2 | +0,0521 | 0,05 | +0,0313 | shodný bodový směr, bez průkazu |
| R1 | +0,0573 | 0,06 | chybí | jeden nevyřešený scope, neskládat úplné pořadí |
| R2 | +0,0104 | 0,05 | −0,3125 | podprahový benchmark, čtyři sdílené historické skupiny |
| CHAT | +0,0193 | 0,04 | +0,0417 | rovněž podprahový benchmark |
| VISION | +0,0558 | 0,05 | 0 | provozní vzorek nerozlišil |

Zdroj prahů: `src/eval/role-evaluation-plan.js:51`; CODE má 0,05 také
v předem uzamčeném provozním plánu. Ostatní zkoušky nebyly přijatým
rozhodovacím experimentem. Práh minimálního přínosu není test statistické
průkaznosti. Nepřekročení prahu neprokazuje rovnost. U VISION je benchmarkový
rozdíl nad prahem a provoz nerozlišuje; nelze tedy tvrdit, že každá nadprahová
role měla provozně potvrzené pořadí. Náhodnost prohození se rovněž neprokázala.

Čtyři binární výsledky mají krok 0,25; průměry dílčích rubrik D1/D2/CHAT
mohou mít jemnější krok. Rozdíl D1 0,25 proto automaticky neznamená jeden
celý případ. Návrh dvaceti nezávislých případů je rozumný pracovní start,
ne záruka průkaznosti. Počet je třeba odvodit od variability, minimálního
přínosu, intervalu a rozpočtu. Before/after téže opravy zůstávají jedna
skupina; nová nezávislost potřebuje jiné historické vady.

## Srovnání všech třiceti známek

Všech 30 vstupních odpovědí má shodný SHA s původním vzorkem.
`claude-sample-grades-20260921.json` nemá body jednotlivých kritérií, pouze
souhrny a komentáře. Rozdíl součtu tedy nelze jednoznačně rozložit.

Původní srovnání 28: **11/28** rozdíl nejvýše 0,10, **8/28** nejméně 0,25.
Chyba původního exportu: dvě nové provozní položky mají `score`, ostatní
`contentScore`. [30] proto nebyla neoznámkovaná — měla **0,75**; [29] zůstává
záměrně **null**. Normalizovaný export mění jen názvy polí. Po sjednocení:
**29 číselných dvojic**, 11/29 do 0,10 a 9/29 s rozdílem alespoň 0,25.

| Role | Počet | Původní Codex | Claude |
|---|---:|---:|---:|
| D1 | 5 | 0,5875 | 0,8750 |
| D2 | 5 | 0,5875 | 0,5125 |
| R1 | 6 číselných | 0,5000 | 0,5000 |
| R2 | 5 | 0,6000 | 0,7000 |
| CHAT | 4 | 0,8125 | 0,7813 |
| VISION | 4 | 0,8375 | 0,8375 |

Rozdíl podle rolí je důvod sjednotit bodové kotvy. Vzorek je zčásti cíleně
sporný, takže tato čísla sama neodhadují systematickou chybu na celé populaci.
Souhrnné známky se neprůměrují a nevydávají za referenční pravdu.

## Technické spory: co bylo přímo ověřeno

- **[20] `d2_model_cleanup`:** spuštěn přesný navržený `getUnusedOldModels`
  s mock DB a skutečnou canonical identity funkcí. Dvě aliasové položky
  projdou, protože `seen.add` běží až v `.map`. Opravená kontrolní varianta
  zachová jen novější. **Původní kritérium opravy už mělo 0,25 se stejným
  důvodem.** Součet 0,6875 = (0,75 + 0,25 + 1 + 0,75)/4, nikoli funkční
  oprava. Spor 0,4375 vs 0,6875 se musí rozložit na ostatní kritéria.
- **[6] `d2_history_late_guard`:** přesný try/catch z dodaného výřezu byl
  spuštěn s minimálními mocky. Vyhozená výjimka: historie 0; vrácená chyba
  v `metadata.error`: historie 1. Navržená reprodukce výjimkou vadu
  nevyvolá. Původní kritérium 1 už mělo 0,5 za správnou diagnózu s chybnou
  reprodukcí. Kritérium regresních kontrol 4 opravuji **0,5 → 0,25**,
  protože chybí konkrétní setup a úspěšná kontrolní větev; součet
  **0,6875 → 0,625**. Rubrika připouští kód **nebo kroky**, takže absence
  kódu sama není důvod ztráty. Zrušení odpověď zmiňuje v bodu testů 4.
- **[17] `d1_metrics_flush`:** příčinný sled splice před tx je správný.
  Původní srážka za metaforu RAM/WAL byla v diagnostickém kritériu navíc.
  Kritérium 1 **0,75 → 1**, součet **0,625 → 0,6875**. Odlišné vady
  návrhu (paměť po process crash, clear-all varianta, předpoklad batch10)
  zůstávají v příslušných dalších kritériích.
- **[29] `environment-prose`:** finální poslední issue skutečně tvrdí
  ztrátu odsazených konfigurací/komentářů; odpověď nekončí tím, že je
  všechno správně. Ztráta se reprodukuje, rozsah požadovaného odsazení
  není vymezený. Původní `null` trvá. Odvolané hypotézy nejsou samy o sobě
  důvodem trestu (§1.1); přetrvávající rozpory ve finálním seznamu lze
  posoudit zvlášť. Z toho ale neplyne automatická nepravdivost posledního nálezu.
- **[30] `nonfinite-math`:** regex pro restore je platný a s nepoškozeným
  placeholderem funguje. Reprodukce potvrzuje ztrátu písmen `SQ` při čištění,
  ne neplatný regex escape. `Function` samo nedokládá RCE; exploit nebyl
  doložen. Původních 0,75 a externích 0,5 zůstává škálovým sporem.

Nové dvě autorské korekce jsou append-only, neslepé a `REVIEW_PENDING`.
Staré otisky i archiv zůstávají shodné. Vyřešení faktů neznamená automatické
přijetí bodových vah. Poznámky k ostatním velkým sporům [1], [2], [12],
[18], [24] jsou v `adjudication.json`; body struktury nenahrazují správnost,
nezadané databázové schéma se nepoužívá jako skrytý důvod srážky.

## V jaké fázi je produkt a co konkrétně zbývá

Jsme ve **sjednocování hodnoticího měřítka po úplném sběru a prvním provozním
pilotu**: HANDOFF §5 kroky 1–4 mají data, krok 2 není přijatý. Kroky 5–7
(samostatný hodnotitel, jeho přejímka, běžný produktový průchod) hotové nejsou.

| Část | Ověřený stav | Potřebný další výsledek |
|---|---|---|
| Sběr, digest, evidence, parser, CODE orákula | provedené běhy a replay | zachovat totožné profily a dohledatelnost |
| Otevřené známky D1/D2/R1/R2/CHAT | autorské hodnocení, rozpor posuzovatelů | kritériové kotvy, rozsouzení scope, konzistentní replay všech dotčených odpovědí |
| Automatický hodnotitel | není přijatý | podle dohodnutých známek ověřit nezávislého hodnotitele na oddělených anotovaných případech; falešné přijetí/odmítnutí po typu úloh |
| Provozní platnost | malý pilot, NEROZHODNUTO | předem uzamčený větší oddělený soubor případů s odůvodněnou nezávislostí a rozpočtem |
| Běžný hunt a nové sady | částečná integrace | připojit nové sady/hodnotitele do běžné fronty a DB, rozšířit přejímku mimo CODE |
| Studio a pravidelný provoz | poslední review bylo statické HTML | skutečný instalovaný průchod: stažení/průběh/ETA, test, detail, rozhodnutí, zrušení/reconnect, disk/retence; pak přijaté nasazení a timer |
| Rychlý/plný profil | přijaté rozdělení není doložené | odvodit rychlou podmnožinu z úplných dat a ověřit její meze; čas nenatahovat čekáním |

Konkrétní integrační mezera v `28039a20`: `ROLE_SUITE_NAMES` stále mapuje
D1/D2/R1 na `reasoning_v2`, R2 na `review_v2`, CHAT na `chat_v3`.
`measurementReady` a `runSuite` tyto T5 cesty blokují. Nové sémantické sady
jsou samostatná ruční cesta. Přejímací importer
`src/upgrade/model-evaluation-acceptance.js` přijímá GRADER pouze T1–T3 a
OPERATIONAL pouze CODE. **Přidání dalších dvaceti měření samo tyto chybějící
části neimplementuje.** Brána tuto mezeru bezpečně blokuje; nenahrazuje ji.

Nejbližší pořadí: dořešit body bez nové inference → přepočítat uložené
odpovědi stejným měřítkem → kvalifikovat hodnotitele → doplnit a ověřit
produkční integraci a nové provozní případy → nasadit a prokliknout Studio.
Role lze přijímat postupně; z tohoto pilotu neplyne požadavek přestavět všechny
sady. Automatický výběr i kvalitativní mazání zůstávají zavřené. Timer
21. 9. ověřen disabled/inactive, žádná nová modelová inference ani změna vazeb.

## Reprodukce a podklady

Kořen: `/home/belphareon/Projects/coworker/intentsmith-hunt-adjudication-20260921`.
`comparison.json` spojuje přesná zadání, odpovědi, obě známky a důvody;
`review-sample-my-grades-normalized.json` sjednocuje exportní pole;
`rank-interpretation.json`, `adjudication.json`, `reproduction.json`
obsahují konkrétní opravy a neuzavřené body. `reproduce.mjs` je čistá
kontrolní reprodukce výřezů, ne test celého controlleru. Bez GPU/sítě/produkční DB.

Aktuální změna je dokumentační a analytická; produkční runtime se nemění.
Poslední runtime regrese z 20. 9. zůstává 363 PASS / 1 FAIL / 0 BLOCKED;
Gate 0 neshoda se podle CONTRACT §8 při vývoji očekává, neopravuje se
přepsáním pečeti. Nová plná regrese se pro tuto dokumentační korekci nespouštěla.

[Receipt archivu](evidence/2026-09-21-hunt-reconciliation.json): 18 souborů,
1 147 821 bajtů, SHA-256
`4b94e7d6708f6cbd809cf5118ad620a3291c012dfed0762412feecfeabd7e19a`.
Každý člen archivu znovu přečten a ověřen proti SHA a seznamu souborů.
Samostatná reprodukce s přibaleným nezměněným zdrojem canonical identity
prošla znovu. Původní zmrazení známek ověřeno; všech 30 response SHA souhlasí.
