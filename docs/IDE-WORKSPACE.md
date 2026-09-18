# Práce v IntentSmith Studiu

Levá navigace otevírá katalogy a nastavení ve středové ploše. Otevření projektu,
konverzace nebo specialisty přepne střed na pracovní prostor. Katalog lze znovu
otevřít stejnou položkou vlevo; rozpracovaná relace tím nezaniká.

## Relace a výstupy

Každá relace má pojmenovanou záložku. Tlačítko **+** vytvoří další, křížek na
záložce zavře celou relaci. **Vedle sebe** zobrazí otevřené relace jako sloupce;
**Jedna relace** se vrátí k vybrané záložce. Chat, terminál a log stejné relace
zůstávají v jednom sloupci. Aktivní práci nelze zavřením tiše přesunout do jiné
relace; nejprve ji dokončete nebo zastavte.

Křížek v hlavičce konverzace ukončí její otevření v prostoru; samotný sloupec a
otevřené soubory zůstanou. Tato akce nemaže uloženou historii. Rozpracovaný text
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
nebo dolů. Přepnutí menu náhled skryje a zachová jeho záložku.

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
