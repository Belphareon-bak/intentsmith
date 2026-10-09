# Backend pro nové funkce IDE

Adresát: operátor a integrační ROOT. Autorita: přímé zadání operátora 9. 10.
2026, zadání a–k a jeho exportované připomínky; tento WP rozsah nerozšiřuje.

Výsledek: skutečná, trvalá API pro nastavení jednotlivých modelových rolí,
telemetrii, účty Discord/Telegram, informace o úložišti, správu záloh,
repozitáře a SSH profily, Git compare/commit a plánování Huntu. Opravit česká
ID specialistů. Zachovat approval/audit, lokální auth, přesnou identitu modelů,
integritu záloh a existující M3 hranici workerů.

Vstup: GitHub main `138e958be927df9835c091d3ad41d44b347e85b5`, ověřený
`git ls-remote` a fetch. Checkout: `intentsmith-ide-backend-20261009`, větev
`work/ide-backend-20261009`. Zdrojový ROOT, běžící release i stabilitní snapshot
jsou cizí a pouze pro čtení. U absorbovaných checkoutů nebylo prokázáno
vlastnictví/evidence; inventura rozpočtu neopravňuje jejich odstranění.

Vlastněné cesty: nové `src/system/ide-*`, DB store, role-runtime-settings a SCM SSH connector, příslušné route/service změny,
nová migrace 123, pozitivní a negativní backendové testy a jejich registrace,
popis API, CI pro nové sady, PRODUCT/DIRECTION pro operátorem změněný rozsah externích kanálů.
Zakázané: frontend/prototypy, produkční DB/config, váhy/bindingy modelů,
release attestace a cizí checkouty. Veřejný connector: autentizované lokální
HTTP API; nové efekty používají existující řízené cesty. GPU/inference běhy
nejsou součástí této implementace; HW stropy se nevymýšlejí.

Výchozí pozorování: existující SCM runtime a autentizované routes 9/9 PASS;
zálohy mají V2 integrity/offline restore; Hunt má systemd admission; nové
správcovské routes chybějí. Vytvoření specialisty lze reprodukovat přes route.

Demonstrace: HTTP zápis → readback → znovu otevřená SQLite; skutečný Git
compare a commit detail v lokálním fixture. Negativně cizí auth, stale revision,
neplatné ref/cesta, chybějící credentials, archivovaná záloha a chybějící HW
evidence. Žádné skutečné zprávy do externích služeb.

Ověření: Node 24 `node --test tests/ide-backend.test.js`, dotčené SCM,
specialistické, storage, gateway a outbound sady; registry a `git diff --check`.
Stop: potřeba oslabit L0, nejasný rozsah efektu nebo kolize s cizím vlastníkem.
Publikace samostatné větve; integrace/nezávislá revize a release acceptance
zůstávají oddělené od výsledku vývojových testů.

Implementační výsledek a další krok: [předání ROOT](../review/ide-backend-handoff-20261009.md).
Vývojové ověření 414/414 PASS; integrační/nezávislé review je REVIEW_PENDING,
release zůstává NOT_ACCEPTED.
