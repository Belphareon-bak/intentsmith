# Projekt SystemSmith_1 vytvořený IntentSmithem

Autorita: explicitní zadání operátora 2026-09-19. Z původního přirozeného
zadání má IntentSmith sám navrhnout a vytvořit funkční systémovou utilitu;
nekopírovat existující SystemSmith. Vstup ee5f36b9, runtime 0ef67a56.
Vlastněné cesty: projektové onboarding/collaboration/draft a jejich Studio
konzument, související regrese a dokumentace. Samostatný nový projekt
~/Projects/intentsmith/projects/systemsmith_1 vytváří produktové API.
Cizí projekty, dirty main a hunt měření se nemění.

Pozorovat reálný chat → návrh → modelové soubory → review → M2 schválení →
testy/rollback → opravy → spuštěnou utilitu a zachované nastavení. Chybějící
senzory nevydávat za nulové hodnoty. Konkrétní kroky a soubory navrhuje model;
Codex provádí nezávislou kontrolu a opravy produktu, nenahrazuje model tajně
ručně napsaným výsledkem. Efekty zůstávají v kanonickém M2 a přesném schválení.

Výchozí runtime pozorování: nový projekt vznikl skutečným HTTP (id 12),
produkční systemd sandbox probe BLOCKED RTM_NEWADDR/AppArmor. Opravu nesmí
nahradit vypnutí izolace. Další modelový průchod může odhalit jiné překážky.

Ověření: skutečné uložené chatové/modelové odpovědi a jejich návaznost na
výsledné soubory, spuštění GUI, skutečné metriky a paměť/nastavení, negativní
chování senzorů; dotčené tests/project-collaboration.test.js,
tests/m2-lifecycle-application-service.test.js, tests/m1-studio-client.test.js,
registry a offline/database profil. Změny bezpečnostních invariantů nejsou
součástí zadání; neúplný nebo pouze izolovaný výsledek nepřejmenovat na hotovo.

Průběžný stav 2026-09-19: opravy nasazeny `d22f64ac`, REVIEW_PENDING.
Úplný profil 359 PASS / 1 zděděný FAIL release pečeti. M2 application 66/66,
projektová spolupráce 23/23; integrační fixture ověřily oba skutečné základy
od návrhu po bwrap a commit. Modelová inference je samostatný důkaz.
První skutečný modelový návrh odmítnut před zápisem, projekt id 12 archivován
beze ztráty důkazů. Aktivní desktopový SystemSmith_1 je id 13 na původní cestě.
Živé pokusy odhalily vedle chyb výpočtů také strukturální plán, nekanonické
pořadí pravidel a nepodporované souborové kořeny inventury; obecné opravy a
reprodukce jsou v balíku. D1 profil zůstal 4096, delší připomínka má doložený
limit. Krátká oprava po zrušeném plánu nyní dostává přednost před starší
historií, která se z úložiště nemaže. GPU zámek se respektoval; dočasné měření druhého workera již doběhlo.
Aplikace není dokončená: produkční M2 test z systemd BLOCKED AppArmorem.
Nezávislá kontrola modelového kódu našla další chyby i při 14/14 vlastních
zelených testech. Poslední regenerace CPU navíc zavedla nové regrese readeru
a výběru souhrnného řádku. Všechny vzniklé modelové plány byly zrušené před
schválením; žádný utility zdroják není aplikovaný. Projekt id 13 zůstává čistý
na základním commitu `4a6072f`. Modelovou spolehlivost ani chybějící funkce
monitoru nevyřeší samotné nahrání AppArmor profilu.
Celý navazující modelový GUI průchod zůstává prací tohoto WP, nikoli údajně
splněným výstupem. Podrobnosti: ../review/2026-09-19-SYSTEMSMITH-PROJECT-FLOW.md.

Upřesnění operátora 2026-09-19: cílem je obecné budování projektů, SystemSmith_1
je pouze vhodné zkušební zadání. Přenositelnost oprav je třeba ověřit i na
jiném typu projektu a na převzetí existujícího kódu; doménové znalosti monitoru
nepatří jako zvláštní větev do projektového orchestrátoru.

Po dokončení této práce následuje operátorem zadaný
[úklid pracovních kopií a místa](WP-WORKSPACE-CLEANUP-20260919.md).
Výchozí inventura je připravená; úklid zatím neproběhl.

Doplněné zadání operátora 2026-09-19: úklid provést již nyní. Potom dokončit
přes skutečný IntentSmith tři nové projekty v pořadí SystemSmith_1, widget
aktuálního počasí/předpovědi pro polohu nebo uložená místa, widget news feedu
podle preferencí. Průběžně opravovat obecné projektové flow. Převzetí cizího
existujícího kódu předvést až po dokončení těchto tří projektů. Tvorbu utility
nenahrazovat ruční implementací mimo modelový návrh IntentSmithu.
