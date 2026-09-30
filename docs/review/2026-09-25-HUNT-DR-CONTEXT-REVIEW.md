# D/R: kontrola dostatečnosti předaného kontextu

25. 9. 2026 · **předběžná věcná kontrola, nikoli nezávislá přejímka sad nebo známek**

Podkladem je jediný kanonický [anonymní balíček 312 odpovědí](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/packet.json), SHA-256 `b3a2f33445ed7537fca65d2dd25645e68ba90250c1c0718c57396f8371aefc0f`. Zkoumal jsem veřejná zadání a rubriky všech 32 úloh (D1/D2/R1/R2 po osmi historických případech); známky druhého hodnotitele jsem nečetl. Níže je odděleně ověřený problém a hranice zbytku kontroly. Syrový balíček se nemění.

## Doložená vada kontextu: `model_cleanup`

Ve všech čtyřech rolích (`d1_model_cleanup`, `d2_model_cleanup`, `r1_model_cleanup`, `r2_model_cleanup`) veřejné zadání a kritéria žádají vypořádání `null` v `previous_model`. Výřez ukazuje dotaz nad `model_overrides`, ale **neobsahuje DDL tabulky**. V historické revizi uvedené v zadání přitom [migrace 030](../../src/db/migrations/2026_03_08_030_v103_model_overrides.js) i pozdější migrace 050 deklarují `previous_model TEXT NOT NULL` a primární klíč na `role`. Databázový řádek s `NULL` proto v platné tabulce nevznikne běžným zápisem. Předpoklad, že je to pozorovaná produkční příčina, není z dodaného kontextu obhajitelný. Kontrola prázdného řetězce a kanonických aliasů smysl má; `NOT NULL` nevylučuje prázdný řetězec.

Tento závěr se vztahuje k historickému commitu `a3a00baae2dffa6204afa327b97f102ee36c8c09`, nikoli jen k dnešnímu schématu. Při známkování musí být bod „null je zdrojem pozorovaného selhání“ označen jako sporný. Model smí navrhnout obranné vyloučení `null`, nesmí za to ale získat důkaz, že takový řádek v produkční historii existuje; stejně tak nesmí dostat srážku jen proto, že hypotetický databázově neplatný řádek neřešil. Rubrika potřebuje rozlišit **obrannou kontrolu vstupu** od **diagnózy reálného stavu**. Nové znění úlohy by vyžadovalo nový sběr a nesmí zpětně přepsat těchto 39 odpovědí (13 modelových běhů × 3 pokusy nad sdíleným případem napříč rolemi).

## Rozsah ostatních sedmi případů

| Případ | Co je ve veřejném zadání výslovné | Stav kontroly |
|---|---|---|
| `audit_error_envelope` | `params.fix=false`, výstup `ENOTFOUND`, exit 1 a hranice parseru/UI | Nenašel jsem další konkrétní chybějící předpoklad; přejímka správnosti rubriky zůstává otevřená. |
| `history_late_guard` | Pořadí in-memory appendu a trvalého zápisu, zachování uživatelského tahu a možnost typed rejection | Totéž. |
| `immutable_refinement` | Zmrazený výsledek, getter bez setteru, výsledek refinementu a argument scoreru | Totéž. |
| `model_lease` | Taxonomie ownerů, volající cutoveru, rollback a delete reservation | Totéž; odpověď nesmí odvodit nedodaný běh producenta. |
| `pairwise_confidence` | Producent, reducer a doporučovací caller ve výřezech | Totéž; nálezy mimo výřez vyžadují samostatný důkaz. |
| `verification_timeout` | Životnost timeru, hranice mezi `fetch` headers a čtením body | Totéž; prodloužený deadline body se z toho neprokazuje. |
| `metrics_flush` | Synchronní selhání transakce, tři události v bufferu a pozdější nové události | Totéž; přesně-jednou po restartu se z výřezu neprokazuje. |

„Nenašel jsem další“ **není** certifikát dostatečnosti všech 28 odpovídajících úloh. D1/D2 mají pozorovanou chybu a požadované chování přímo v promptu: měří rozbor *předané* závady, nikoli schopnost závadu samostatně objevit. R1/R2 mají navíc předaný bounded diff. Všechny tyto úlohy jsou pouze anglicky. Rozsah přijaté sady i případná potřeba českých protějšků se posuzují zvlášť.

Do dokončení dvou oddělených posudků lze odpovědi hodnotit po kritériích s označením `taskIssue` u konkrétních sporných tvrzení. Procentní pořadí nebo doporučení rolí z tohoto auditu nevzniká.
