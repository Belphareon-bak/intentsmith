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

Aktuální runtime pozorování: nový projekt vznikl skutečným HTTP (id 12),
produkční systemd sandbox probe BLOCKED RTM_NEWADDR/AppArmor. Opravu nesmí
nahradit vypnutí izolace. Další modelový průchod může odhalit jiné překážky.

Ověření: skutečné uložené chatové/modelové odpovědi a jejich návaznost na
výsledné soubory, spuštění GUI, skutečné metriky a paměť/nastavení, negativní
chování senzorů; dotčené tests/project-collaboration.test.js,
tests/m2-lifecycle-application-service.test.js, tests/m1-studio-client.test.js,
registry a offline/database profil. Změny bezpečnostních invariantů nejsou
součástí zadání; neúplný nebo pouze izolovaný výsledek nepřejmenovat na hotovo.

Průběžný stav 2026-09-19: opravy nasazeny `c0eeec50`, REVIEW_PENDING.
Úplný profil 359 PASS / 1 zděděný FAIL release pečeti. První skutečný modelový
návrh odmítnut před zápisem, projekt id 12 archivován beze ztráty důkazů.
Aktivní desktopový SystemSmith_1 je id 13 na původní požadované cestě.
Aplikace není dokončená: M2 test z systemd BLOCKED AppArmorem a další inference
čeká na uvolnění GPU druhého workera. Celý navazující modelový GUI průchod
zůstává prací tohoto WP, nikoli údajně splněným výstupem.
Podrobnosti: ../review/2026-09-19-SYSTEMSMITH-PROJECT-FLOW.md.
