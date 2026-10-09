# Společná integrace IDE a backendu

Autorita: přímé zadání operátora 9. 10. 2026 „dolad to … at IDE a BE spolu
skvele funguji“, původní a–k/V4 a předaná nezávislá revize backendu i společného
kandidáta. Revize není nová produktová autorita; popisuje vady těchto požadavků.

Výsledek: spojený frontend/backend; nastavení nesmí rozbít další chat ani
zkrátit interní JSON volání; role se rozliší i u stejného modelu; inventura
ukáže skutečné úložiště; odmítnutý formulář zachová data a dovolí opravu;
průvodci a dostupné katalogové podklady použijí reálná API. Ověřit skutečné
IDE připojené k vlastnímu produktu, restart/readback a relevantní negativní
cesty. Nejde o GPU kvalifikaci, deployment ani release přejímku.

Vstupy: čerstvě fetchovaný main `138e958be927df9835c091d3ad41d44b347e85b5`,
BE `0766a0ba73b4f25be3d6ccc507d26ba5e26ba2c6`, FE
`598de50e357350a2014ad49e4df46e288c678579`. Obě větve spojené na nové větvi
`work/ide-integration-20261009` v mém existujícím checkoutu
`intentsmith-ide-backend-20261009`; nová pracovní plocha nevzniká. Konflikty
jsou census v README/SYSTEM-MAP/TEST-REGISTRY, přepočítané na skutečný stav.

Vlastněné: dotčené role/gateway/call sites, správcovské routes, provider storage
resolver/config/upgrade, M3 service, scheduler a UI controllery; kanonická
Studio šablona a její generovaný build; cílené testy, registry/census, CI a toto
předání. Connector: skutečná lokální auth HTTP/WS, původní M1/M3/SCM/outbound.
Zakázané: cizí checkouty a dirt, provozní DB/config/bindingy, váhy, běžící
production/soak, persistentní automation hold, release attestace/Gate 0.

Pozorování: aktuální Ollama unit je active s
`OLLAMA_MODELS=/mnt/vi7000/ollama/models`, BE env tuto informaci nepřebírá.
Produkce je stále `c84b88cd`, cizí soak běží. Hold vyžaduje výslovné uvolnění
operátorem; v tomto WP se neruší. GPU ani skutečné externí zprávy nejsou
potřebné k integračnímu ověření.

Demonstrace: nastavení přes skutečný frontend → API → zavřená/znovu otevřená
DB → další zpráva; dvojice stejného modelu s různými rolemi; invalidní SSH a
cesta opravitelné ve stejném formuláři; worker/specialista vytvoření a úprava;
native IDE nad vlastním port file a řízeným poskytovatelem. Žádné fake quality
scores ani přihlášené účty z pouhé konfigurace.

Ověření: Node 24, nové integrační testy a dotčené M1/CHAT/M3/SCM/storage/Studio
sady, `node scripts/validate-test-registry.js`, build-view `--check`, module
ratchet a `git diff --check`; po stabilizaci spojený offline/database profil a
vlastní server journeys sériově. U nativního IDE doložit skutečné click/readback
a úklid vlastněných procesů. STOP: potřeba oslabit L0, kolize vlastníka nebo
nejasná autorita skutečného efektu; jiná nezávislá práce pokračuje.

Publikovat samostatnou větev a ověřit vzdálené SHA. Zdrojové změny tohoto WP
vyžadují novou nezávislou revizi; review původních dvou větví se na ně nepřenáší.
