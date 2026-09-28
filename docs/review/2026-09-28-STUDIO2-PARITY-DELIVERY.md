# Studio 2 — dokončení parity a předání balíku

Zdroj: větev `work/studio2-sessions-visual-20260928`; přesný commit,
kontrolní součty a výsledky běhů jsou v `TEST-RESULTS.json` předaného balíku.
Základ: `8c3fb85b`. Stav před závěrečnými běhy: **IMPLEMENTATION_COMPLETE,
VERIFICATION_RUNNING**. Tento text není release Gate 0 pečeť ani nezávislé review.

## Implementace

- Studio 2 je jediný frontend, včetně nových a starších uživatelských profilů.
  Theia 1.76.0, React 19.3.0 a Electron 42.11.3 zůstávají hostitelem.
  Klasický JS entrypoint, staré frontend registrace, přepínač a dočasné ruční
  obrazovky Studia 2 jsou odstraněny. Sdílený WS klient je beze změny.
- Relace: levý seznam, až tři sloupce, výběr a prohození, bezpečný strop pěti,
  zavírání bez smazání konverzace, skutečné názvy a obnovení po restartu.
- Chat: skutečná historie, M1 odesílání/zrušení a izolace vlastníka, souborové
  a modelové události, čtyři fáze, kopírování s výsledkem, expertní výběr i
  v PROJECT, výslovné Tab doplnění a potvrzené opakování posledního zadání.
- M2: projektový návrh se zachová, upravuje se v souborovém plánu; místní
  kontroly cest, instrukcí, závislostí, kontextu a doslovných argv. Příprava,
  zrušení, oprava a schválení mají oddělené kroky. Schválení vyžaduje přesný
  zobrazený plán. Průběh pouze pozoruje, úplný výsledek/test/diff/audit lze
  načíst po restartu z uložené přesné vazby.
- Pracovní soubory: skutečný strom a operace, editor a stráž neuložených
  změn; převod starého editoru až po ověření projektového kořene. Lokální
  soubory specialisty se nesdílejí bez výslovného připojení.
- SCM: skutečný status, stage/unstage, větve, commit, historie, fetch/pull/push,
  plán a potvrzení, politika hostitelů a ff-only, obnovení po ověřeném zápisu.
- Katalogy a průvodci: projekty, specialisté, expertýzy, obecné M3 instance,
  obchod a multimédia. Worker čte ověřenou deklaraci, zkontroluje parametry
  bez spuštění a instaluje se vypnutý; následná akce ověřuje skutečný výsledek.
- Nastavení: všech 12 kategorií, 11 motivů a původní uložené volby, modely,
  evaluace/hunt/governor, prostředí a řízené instalace, M4, M7, zpětná vazba,
  zabezpečení, úložiště, logy a zálohy. Chyba uložení načte skutečný stav a
  ponechá uživatelův rozpracovaný vstup.

## Ověření

Cílené testy skutečných adaptérů a prototypu jsou vedené v předaném balíku.
[Mapa převodu starých kontrol](../studio2/TEST-MIGRATION.md) zachovává jejich
požadavky; backendové a M1 protokolové kontroly zůstávají samostatné.
Závěrečné běhy používají čistý commit, izolovanou databázi, síť a vlastní
Electron proces. Ověřují skutečné DOM události, restart, migrovaný profil,
M1, M2, exkluzivní UI a obsah AppImage. Produkční databáze, cizí procesy
ani běžící GPU hunt se při ověřování nemění.

## Hranice předání

Čtvrtý typ balíčku toolchain a nové schopnosti shellu jsou mimo tento WP.
Import konverzace a export projektu jsou navíc v prototypu, bez existujícího
UI konektoru; zůstávají vypnuté. Legacy mutace workerů se neobnovují.
Modelová inference a skutečné GPU instalace mají dosavadní serverovou
politiku; integrační testy místo nich používají řízené fixture odpovědi.
Nové GPU měření se nespouští souběžně s cizím huntem.

Gate 0 pečeť původní linie neodpovídá vývojovým změnám. Její inherited FAIL
se nepřepisuje na PASS. Přesné baseline/regrese a případné environment
BLOCKED jsou samostatně uvedené v test manifestu. Operátorská zkouška
balíku a nezávislé review zůstávají samostatným přijetím.
