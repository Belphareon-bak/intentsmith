# Práce v IntentSmith Studiu

Levá navigace zůstává dostupná vedle katalogů i nastavení. Ctrl+B nebo šipka
u názvu aplikace ji sbalí na pás ikon a znovu rozbalí. Automatické sbalení
také ponechá ikony, takže lze dál přepínat. Po startu se hlavní menu obnoví
i ze staršího uloženého rozložení. Katalogy a nastavení využívají středovou plochu. Otevření projektu,
konverzace nebo specialisty přepne střed na pracovní prostor. Katalog lze znovu
otevřít stejnou položkou vlevo; rozpracovaná relace tím nezaniká.

## Relace a výstupy

Každá relace má pojmenovanou záložku. Tlačítko **+** vytvoří další, křížek na
záložce zavře celou relaci. Vpravo jsou dvě ikony rozložení: jedno okno pro
**Jednu relaci**, několik sloupců pro **Vedle sebe**. Aktivní ikona je podsvícená;
obě mají popisek po najetí a lze je ovládat klávesnicí. Chat, terminál a log stejné relace
zůstávají v jednom sloupci. Aktivní práci nelze zavřením tiše přesunout do jiné
relace; nejprve ji dokončete nebo zastavte.

Křížek v hlavičce chatu nyní zavírá celou relaci stejně jako křížek na záložce;
při zobrazení vedle sebe ubude příslušný sloupec. Historie se nemaže.
**Nová konverzace** v pravém panelu zahájí další chat ve stejném prostoru.
Záložky zobrazují nejvýše 28 znaků, celý název je v tooltipu. Procenta v
záhlaví vysvětlují při najetí využití kontextového okna modelu. Rozpracovaný text
chatu zůstává při přepínání relací a menu, nepřislíbena je jeho obnova po pádu
procesu. Po restartu se obnovují uložené konverzace a běžné souborové záložky.
Neuložené ruční změny souboru vyžadují potvrzení před zavřením.

Pod chatem jsou oddělené **Terminal**, **Log** a **Audit**. Terminal slouží
příkazům dané relace; u projektu používá jeho kořen. Log popisuje postup
backendu. Tyto výstupy se nemíchají s konverzací. Výšku spodní části lze měnit
přetažením oddělovače. V katalogu ani nastavení tato konzole nezabírá plochu.

## Soubory a rozdíly

Soubor otevřený ze stromu patří relaci, ze které byl otevřen. Náhled nebo diff
využije hlavní část jejího sloupce; chat lze sbalit, rozbalit a umístit nahoru
nebo dolů. Přepnutí menu náhled skryje a zachová jeho záložku. Šipky na
okrajích souborové lišty vybírají předchozí/další soubor; aktivní záložka
se sama posune do viditelné části. Funguje i vodorovné posouvání lišty.

**Upravit** otevře Monaco v témže sloupci. **Uložit** nebo Ctrl+S uloží ruční
úpravu přes existující souborovou službu Theia. Pokud se soubor na disku mezitím
změnil, uložení se zastaví a rozepsaný text zůstane. Náhled je samostatný od
modelového návrhu; schvalování M2 změn si dál vyžaduje konkrétní plán a diff.

## Specialisté

Otevření specialisty najde jeho vlastní relaci nebo vytvoří novou. Prázdná
konverzace specialisty, rozepsaný text, přílohy a otevřené soubory neznamenají
volnou relaci, kterou může jiný projekt převzít.

Pravý panel standardně ukazuje **Historii** tohoto specialisty. **Soubory**
přepnou na jeho samostatnou knihovnu. **Přidat soubory** otevře systémový výběr;
limit je 20 MiB na soubor. Knihovna je lokální IndexedDB v profilu Studia,
oddělená podle specialisty. Její obsah se zachová po restartu Studia. Není
součástí SQLite backupu backendu; při záloze celého pracoviště zahrňte také
profil aplikace. Soubory se automaticky neposílají modelu.

**Náhled** zobrazí podporovaný text do 512 KiB. **Připojit** vytvoří přílohu
rozepsané zprávy; odeslání je další výslovný krok. **Sdílet…** vytvoří kopii
vybraného souboru z knihovny jiného specialisty. Změna nebo odebrání jedné kopie
neodstraní druhou. **Odebrat** odstraní jen zvolenou položku této knihovny.
Historie se filtruje podle specialisty zaznamenaného u uživatelské zprávy;
staré konverzace bez tohoto údaje nelze spolehlivě zpětně přiřadit.

## Názvy a aktualizace

Aktivní runtime je v `intentsmith-ide/`, balíčky mají jména `@intentsmith/*`,
konfigurace používá `INTENTSMITH_*` a `intentsmith.*`. Staré názvy jsou přijímané
jen jako kompatibilní vstup tam, kde existují instalovaná data, licence nebo
lokální klienti. Explicitní nové nastavení má přednost. Databáze dosavadní
instalace se nepřejmenovává a nevytváří se potichu prázdná náhrada.

Historické podepsané důkazy, názvy externích repozitářů, identifikátory kontrol
(například Gate 0 C3) a zakódovaná data jsou identity, nikoli označení produktu.
Zůstávají zachované. Generované staré rootové výstupy IDE jsou vyřazené z Gitu;
produkční aplikace se sestavuje z nynějšího zdrojového workspace.

Při přejmenování aplikace launcher rozpozná dosavadní profil
`c3-ide-electron`, pokud nový profil ještě neexistuje, a otevře jej na původním
místě. Nastavení, relace a IndexedDB se nekopírují ani nemažou. Explicitní
`--user-data-dir` / `--electron-user-data` a již existující nový profil mají
přednost. Toto je kompatibilita uložených dat, nikoli druhá instalace IDE.

## Modely a GPU hunt

V **Nastavení → Modely a inference → Spravovat role a modely** mají Kandidáti
řazení přímo v hlavičkách sloupců. Další kliknutí obrátí směr. Filtry role a
odhadované VRAM zůstávají samostatné; neznámá hodnota se nezaměňuje za nulu.
Katalog zahrnuje také trvale uložené nálezy GPU huntu, včetně zdroje a času
posledního nového nálezu. Není to výčet všech LLM na světě: automatický hunt
prohledává knihovnu Ollamy, vybírá místně použitelné varianty a ověřuje kvalitu
teprve měřením. Cloudové modely ani celý Hugging Face hub tato tabulka nepokrývá.

**Evaluace** standardně zobrazí matici pro každou roli: model na řádku,
jednotlivé úlohy ve sloupcích, **Celkem** vpravo. Čísla jsou 0–100 %, barevně
červená až zelená; pomlčka znamená chybějící platný výsledek. Celkem zůstává
oficiální průměr skóre úloh, nejde o nový způsob skórování. Model i celkový
výsledek zůstávají viditelné při vodorovném posouvání. **ⓘ** u úlohy vysvětluje
obsah a kritéria. Název modelu otevře detail; celý původní přehled je dostupný
přes **Podrobné výsledky**.

Vyber model, případně otevři **Testy modelu…** u staženého kandidáta.
**Otestovat vše** připraví všechna použitelná měření daného modelu. Potvrzení
vypíše role, úlohy a opakování. Jedna úloha služby zpracuje role postupně,
každou s přesnou aktuální sadou a stejným digestem modelu. Změna jedné sady
nebo identity před spuštěním odmítne celý požadavek. Nedokončená role nezíská
stav COMPLETE. Test jednotlivé role zůstává v detailu. Měření nemění přiřazení
modelů a nemaže historii. Průběh i případné přerušení jsou na kartě GPU hunt.

## Počasí a webové schválení

Na dotaz o počasí „v mé lokaci“ si chat vyžádá město. Polohu neodvozuje z IP
ani ze zařízení. Po doplnění místa ukáže jedinou konkrétní HTTPS adresu a
příkaz **schválit web …**. Do přesného schválení nic neodesílá; návrh se ve
Studiu zobrazuje jako návrh, nikoli obecná chyba M2. Webový výsledek je citovaný
obsah zdroje, sám o sobě neznamená ověřenou místní předpověď.

## Vzhled a nastavení

Nastavení má 12 kategorií v samostatné levé nabídce uvnitř středové plochy.
Hlavní navigace aplikace zůstává vedle ní. Každá kategorie rozděluje skutečné
ovladače do tematických záložek a kompaktních karet s ikonami. Vedle ovladačů
je přehled příslušné kategorie: profil, modely, nastavené rozpočty, běhové
údaje nebo rozsah exportu. V úzkém okně se přesune pod karty. Ukazatele
rozlišují nastavené limity od skutečně zjištěných provozních hodnot. Šipky vlevo/vpravo a
Home/End přepínají záložky; křížek v záhlaví vrací do pracovního prostoru.

**Vzhled → Obecné → Studio** používá chladné tmavé plochy a soustavnou
paletu: fialová pro výběr, modrá pro nástroje, mátová pro zapnuté stavy a
úspěch, jantarová pro upozornění, růžová pro chyby a odebrání. Barevné ikony
rozlišují oblasti navigace; modelové role mají vlastní štítky a stažení
modelu mátové tlačítko. Studio podporuje také světlou a systémovou
variantu. Zlatý IntentSmith zůstává výchozí, změna stylu je volitelná.
Clean zachovává vlastní paletu a Matrix/Japanese/Midnight své efekty.

**Vzhled → Písmo → Výraznost textu** ovládá veškerý text uvnitř IDE:
navigaci, chat, záložky, nastavení, soubory v Monaco, terminál i log.
Nižší hodnota text zjemňuje, vyšší zvýrazňuje; nula text neschová.
Mění se vykreslení písma, nikoli průhlednost panelů. Barvy stavů a syntaxe
zůstávají rozlišené. Živý náhled ukazuje strom souborů, chat, kód, terminál a stavové zprávy;
účinek je vidět okamžitě. Oba posuvníky jsou rychle dostupné také pod
**Obecné → Intenzita a čitelnost**. Velikost a rodina
písma jsou na stejné záložce, zvýraznění aktivních ovladačů pod **Barvy a prvky**.
Toto nastavení neovládá titulkový pruh vykreslovaný operačním systémem ani text
uvnitř obrázků/PDF. Uloží se do profilu Studia a obnoví po restartu, včetně 0 %.
Starý neúčinný posuvník „Neaktivní prvky“ nahrazuje nová hodnota; starý údaj
zůstává v profilu pro kompatibilitu, při prvním otevření je výraznost 70 %.
