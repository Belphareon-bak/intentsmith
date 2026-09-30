# CODE — podklad pro druhé posouzení a vyjasnění podprahové větve

**Stav: REVIEW_PACKET_PREPARED / TASK_CLARIFICATION_PROPOSED.**
Navazuje na operátorovu nabídku druhého posouzení z 23. 9. 2026 a přijaté
pořadí práce z GPU hunt handoff. Žádná nová inference, produkční import,
změna přiřazení, nasazení ani rozhodovací GO. Výchozí kód `57ce222e`.

## Co předat druhému posuzovateli

[Otevřít formulář 30 odpovědí bez identit a předchozích známek](/mnt/vi7000/intentsmith/evidence/hunt-code-prose-second-review-20260923/public/review.html).

Předávat pouze adresář `public/` nebo jeho samostatný archiv. Obsahuje
původní zadání, celé odpovědi a 12 skutečně pozorovaných volání každé
opravy. Neobsahuje referenční opravu, původní ID, modely, digesty,
opakování, technické známky ani moje posudky. Náhodné ID a pořadí jsou
nové; vazby na původní doklady jsou odděleně v `custody/`, ne v HTML.
Zdrojové odpovědi ani původní archiv se nepřepisují.

Formulář má dvě obsahové osy s důvodem a konkrétní citací/ID pozorování:
význam vysvětlení jistoty a správnost ostatních vysvětlení. Podporuje
0 / 0,25 / 0,5 / 0,75 / 1 i chybějící známku. Neagreguje je do nového
celkového CODE skóre. Chybějící API se nemá znovu penalizovat v textové ose.
Posudek se průběžně ukládá do prohlížeče a lze jej stáhnout jako JSON;
export má stav DRAFT, nikoli přijaté hodnocení. Neexistuje automatický
import do přejímky nebo produkce.

**Identita je skrytá, předchozí expozice nezmizela.** Posuzovatel už četl
část odpovědí, souhrny a některé důvody. Formulář žádá deklaraci této
znalosti a rozpoznání každé odpovědi. Ani po vyplnění z toho nevznikne
nový nepoužitý přejímací vzorek. Je to druhé posouzení pro rozsouzení
konkrétních sporů; nezávislá přejímka hodnotitele potřebuje jiné,
nepoužité odpovědi. Původních 30 autorských řádků zůstává neslepých.

## Oprava rozdělení 30 odpovědí

Vzájemně výlučný rozpad je **11 obě složky správně + 16 chybějící
vysvětlení + 3 chybějící API = 30**. Tři falešná odmítnutí formulace
jsou podmnožinou těch jedenácti, nikoli třetí samostatná třída. Platí
14 správných vysvětlení − 3 chybějící API = 11 obě složky správně.
Čísla ani původní posudky se touto poznámkou nemění.

## Podprahová větev: staré měření a další zadání

Původní veřejný požadavek žádá jistotu při rozhodování kvalitou; není
jednoznačné, zda se tím myslí jen výhra/prohra přes práh, nebo každý
návrat `basis: kvalita`. Reference v podprahové větvi vrací právě tuto
basis, ale nemá `confidence` ani jeho slovní vysvětlení. U větví přes
práh obě hodnoty má. Není tedy správné směšovat tuto nejasnost reference
s jasným vynecháním vysvětlení v nadprahových větvích šestnácti odpovědí.

Pro druhé posouzení starých odpovědí:

- O01–O08: nadprahová výhra/prohra, počty rozlišujících úloh 1, 2, 3, 7.
  Význam vysvětlení lze posoudit proti původnímu zadání.
- O09: podprahový výsledek. Chybějící jistota je **mimo hodnocení** kvůli
  rozporu zadání a reference; ostatní konkrétní tvrzení lze posoudit.
- O10–O12: rychlostní a nerozhodné větve; posuzovat původní chování,
  nevnášet do historické úlohy novou politiku huntu.

**Návrh pro novou verzi úlohy, nikoli retroaktivní přepis:** při každém
návratu s `basis: kvalita` vrátit `confidence` i významově odpovídající
vysvětlení v `detail`, včetně ponechání současného modelu pod prahem.
Mapování pro platné kvalitativní vstupy s alespoň jednou rozlišující
úlohou: 1 → `nízká (jediná úloha)`, 2 → `střední`, ≥3 → `vysoká`.
Síla podkladu a dosažení prahu pro výměnu jsou odlišné vlastnosti; vysoká
jistota sama nesmí znamenat doporučení výměny. U rychlostních a
nerozhodných větví se tento kvalitativní údaj nově nevyžaduje. Neplatné
vstupy a nulový počet při `inconclusive: false` nesmí zůstat novou
nevyřčenou výjimkou: před zmrazením mají být ve veřejné doméně vstupů
výslovně vyloučené nebo samostatně specifikované.

Alternativou je povinnost výslovně omezit pouze na nadprahové větve.
Doporučuji první variantu: operátor uvidí sílu podkladu i při ponechání
současného modelu. Obě jsou změnou/upřesněním zadání. Až po přijetí je
možné připravit novou identitu úlohy, upravenou referenci i alternativu,
kontroly obou stran prahu a nový sběr. Původních 30 odpovědí nelze
vydávat za odpovědi na tento nový prompt. Celé náhradní orákulum zůstává
nepřijaté; slovní význam se neověřuje regexem ani podřetězcem.

## Pilot a případné druhé okno plného panelu

Nabídku posouzení CODE lze využít hned s výše vymezeným historickým
rozsahem. Nemusí čekat na přijetí nového promptu. Stejně tak rozpor této
CODE úlohy neblokuje přípravu CHAT pilotu — jde o různá zadání.

Připravený CHAT zůstává 64 volání pilot / 3 480 volání plný panel.
Nový plán v `chat-plan/plan.json` přiznává pokračování jako
`PROPOSED_NOT_IMPLEMENTED`; runner pro etapu, který vynucuje celkové
limity, stále není dodaný. Před sběrem zbývá tento runner, revize a
zmrazení nové CHAT rubriky, ověření aktuálních modelů/GPU a výslovné
spuštění konkrétní etapy v jejím rozpočtu. Podpora vícekolového sběru
sama tyto podmínky nesplňuje.

První okno plného panelu má navržený strop 24 h, další okno zatím nemá
schválenou délku. Po dosažení limitu zůstane částečný checkpoint a
samostatné rozhodnutí stanoví zbývající rozsah a další čas/tokeny/volání.
Hotové pokusy se neopakují pro výběr lepší odpovědi. Přerušený dialog
zůstane viditelný; jeho případná náhrada z čisté historie dostane nové
navázané ID a předem dané pravidlo zahrnutí. Spotřeba všech oken se sčítá.
Změna zadání, digestu či generovacích voleb srovnatelný panel zastaví.
Odhad délky a rozdělení oken má vycházet z pilotu; 24 h není slíbená ETA.

## Ověření tohoto přírůstku

- 5 cílených testů exportu: únik identity/známek, změna odpovědi či
  promptu, neúplná/duplicitní mřížka, záměna úplné známky za složku,
  chybějící pozorování a nevykonávání vloženého HTML.
- 11 kontrol formuláře v headless Chromium: všech 30 položek,
  navigace, meziznámky, uchování důvodu, obnovení návrhu, skutečný
  download JSON a explicitní označení předchozí expozice a sporné větve.
- 30 odpovědí a 360 pozorování proti zdrojovým hashům; veřejný HTML/JSON
  neobsahuje identity, původní ID, předchozí známky ani moje důvody.
- Návrh pokračování nemění prompty, počty volání ani původní evidenci.

Nejde o nový běh modelů, opakování 210 orákul, release gate ani o přijaté
hodnocení. [Hashové doklady](evidence/2026-09-23-code-second-review.json).
