# Kontrakt: bezpečné aktualizace produktu po 1.0

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11.
Týká se aplikace/Studia/runtime balíčku. Discovery modelů, aktualizace
rozšíření a změna modelových bindingů jsou odlišné existující autority.

Uživatel vidí dostupnou verzi, původ, změny, kompatibilitu a potřebné
přerušení práce. Aplikace stáhne a ověří přesný balíček, připraví obnovu,
po schválení provede přepnutí a zkontroluje skutečný start. Volitelné
automatické stahování nemůže samo schválit instalaci. Offline update používá
stejné ověření a instalátor.

Navržené `ReleaseUpdateManifest@1`, `UpdatePlan@1`, `UpdateReceipt@1` vážou
source/build digests, cílovou platformu, podpis/trust root, dependency a
schema kompatibilitu, migrace a rollback plán. Podepsaná metadata musí řešit
expiraci, revokaci a rollback/freeze útok; záměrný uživatelský downgrade má
vlastní schválení a nesmí obejít datovou kompatibilitu.

Vlastněné oblasti: stávající release/backup/update porty, balíčkování a Studio
update UI. Před swapem drain běhů nebo explicitní odklad; instalace mimo
uživatelskou projektovou oblast, žádný stažený libovolný shell script.
A/B nebo jiná atomická publikace spolu s kontrolovaným launcherem. Návrat
binárky bez obnovy nekompatibilní DB není rollback.

Akceptace: čistá předchozí podporovaná verze s daty→ověřená aktualizace→
reálné Studio/model chat/patch→restart. Fault injection po každé fázi:
výpadek napájení, plný disk, špatný podpis, revokovaný klíč, poškozený balíček,
nekompatibilní migrace a neúspěšný health. Obnovená data a předchozí verze
se musí skutečně spustit. Falešný health, neověřené metadata a ztráta
schválení nesmějí vytvořit UPDATE_SUCCESS. Review musí zahrnout distribuční
kanál a recovery, nikoli jen unit test downloaderu.
