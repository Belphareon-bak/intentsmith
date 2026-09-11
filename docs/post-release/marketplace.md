# Kontrakt: marketplace po 1.0

**NÁVRH K REVIEW / NEIMPLEMENTOVÁNO.** Zadání operátora 2026-09-11.
Používá M3 extension manifest/registry a stávající outbound/effect authority.

Uživatel vyhledá rozšíření, vidí původ, licenci, přesnou verzi, kompatibilitu
a požadované pravomoci; schválí instalaci, později aktualizaci nebo odstranění.
Offline import i katalog z cache mají explicitní stáří a ověřitelné artefakty.
Marketplace není vzdálený libovolný install script pod oprávněním aplikace.

Navržené `ExtensionPackage@1` a `InstallTransaction@1` vážou digest,
publisher identity/signature, dependency closure, kontraktové verze, licence,
capability diff, data migration a rollback. Podpis dokládá původ, nikoli
bezpečnost chování. Native runtime musí vynutit udělená oprávnění i po importu.
Upgrade nesmí tiše zvýšit capabilities. Zranitelná/revokovaná verze se
označí a podle přijaté policy zablokuje; offline nejistota je viditelná.

Vlastněné oblasti budoucího WP: katalog klient/server adapter, package verifier,
M3 installer a Studio katalog; žádné duplikování core module identity.
Instalace je atomická; zip traversal, symlink escape, dependency confusion,
tampering, nekompatibilní kontrakt a spustitelný install hook se odmítnou.
Odstranění nejprve zastaví běhy a řeší uchování/export/smazání vlastních dat.

Akceptace: skutečný podepsaný balíček install→enable→use→update→rollback→
disable→uninstall po restartu. Při pádu nesmí zůstat poloviční aktivní verze.
Negativní sada pokryje záměnu digestu, revokaci, vyšší oprávnění, škodlivý
archiv a chybějící dependency. Nezávislé review supply-chain hranice a
konkrétní integrace jsou nutné před zapnutím produkčního marketplace.
