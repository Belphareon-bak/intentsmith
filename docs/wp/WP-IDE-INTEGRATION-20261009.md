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

10. 10. předáno: aplikační kandidát `c47d1883`; kompletní offline/database
415/415, registrované IDE HTTP/BE 2/2 programy, nativní AppImage 9/9 kontrol,
CI 19/19. **REVIEW_PENDING_WITH_OPEN_SETTINGS_FINDINGS**: dodatečná sonda bodu
f) prokázala persistenci 35 obecných polí, ale neúčinnou obecnou teplotu a
globální kontext; další účinky této sondě nepřísluší označit za PASS.
[Předání](../review/ide-integration-handoff-20261009.md) obsahuje důkazy,
reprodukce a limity. Podle doplňujícího zadání operátora se po publikování
čeká na nezávislý verdikt Opuse pro finální úpravy. CHAT styl/vlastní prompt
a související měření patří po releasu; žádný hold ani binding se nemění.

## Dokončení podle doplňujícího zadání 10. 10.

Autorita: přímé zadání operátora zapracovat důležité změny doladěného preview,
projít nezávislou revizi a dokončit nedodělky bránící releasu. Dostupný
nezávislý posudek je nyní doložen od Claude (Opus) pro `230f657f`, verdikt
`NEEDS_CHANGES`; přesná kopie je
[uložena v repozitáři](../review/opus-ide-integration-230f657f-20261010.md).
Tři importní hrany resolveru jsou schválené. Nejde o přejímku následných oprav.

Rozsah dokončení: bezpečné rozpočty CHAT a strukturovaných rolí (N1/N2),
skutečný pull endpoint a disková inventura Huntu (N3/N8), formulářový průvodce
a editace workerů (N4), známé klientské chyby a důvody neprovedení (N5/N6),
nativní zápis/readback (N7). Srovnat důležité body 1–9 V4 a původní a–k:
retence s náhledem/potvrzením, Git výběr větví a detail, telemetrie a označení
nepodložených funkcí. U obecných nastavení ověřit skutečného spotřebitele;
hodnoty bez účinku nesmějí vystupovat jako funkční ovladače.

Demo: nejmenší CHAT okno + 2000 znaků; nadlimitní zpráva s opravitelnou chybou;
strukturované role bez zkrácení JSON; sidecar inference/pull na různých portech;
worker vytvořený formulářem a upravený z detailu; nativní uložení/restart;
retence, Git a další ovladače podle výsledného rozsahu. Aktualizovat runtime
kontrakty, census, registry a souhrn hotových funkcí/zbývajících release podmínek.
Publikovat a ověřit vzdálené SHA i CI. Produkce, cizí soak, klíče/podpisy,
automation hold, bindingy a odložená CHAT personalizace zůstávají chráněné.


Implementační dokončení N1–N8 a V4 je v novém
[paketu](../review/ide-integration-remediation-20261010.md). Následuje čistý
aplikační commit, celý profil, skutečný HTTP/restart, nový AppImage/nativní
zápis a CI. Původní výsledky z c47d1883 nejsou přeneseny na nový kód.

Skutečné nativní ověření navíc otevřelo asynchronní editaci instance workera
a neplatný generovaný balíček specialisty. Opravy zahrnují skutečný loader,
ExtensionContext a readback. Fresh-clone Gate 0 odkryl zastaralou allowlist
Theia build výstupů; konkrétní nové výstupy mají kontrolu vlastnictví a
negativní testy symlinků/práv. Další release brány se tím neoznačují PASS.

Závěrečné nativní ověření odkrylo i prázdný filtr pozastavených workerů.
Filtry a stav nyní používají skutečné enabled/schedule z list API; sonda
ověřuje čítač i filtrovaný seznam. M6 deterministický plán doplňuje čtyři
pojmenované lokální toolchainy požadované aktuálním registrem (python3, tar,
iproute2, nftables). Každý stále prochází původním preflightem; nevzniká
autorita pro GPU, server ani externí síť. Starý Gate 0 v1 běh je pouze
diagnostika, podle Decision 036 není release řetězem M6.

Ověření další zprávy odhalilo také nulový účinek vytvořeného specialisty:
prázdné rozpoznávací vzory nabízely gap namísto doménové odpovědi. Příprava
kontextu nyní používá existující M3 dispatcher a wrapper. Povinný důkaz je
prompt/pravidla/omezení ve skutečném provider payloadu, krátký další vstup a
readback po restartu. Kvalifikace `0efdf04a` zůstává historická.

Finální aplikační source: `387a490fb3fbd6b5c06756629b42e6a44840f15b`,
publikovaný na integrační větvi. 415/415 offline/database, 3/3 registrované
HTTP programy, 27/27 kontrol AppImage proti vlastnímu backendu, čerstvá
instalace/opakování a CI 19/19 PASS. Nativní sonda má samostatný otisk;
její oprava čekání na načtené řádky rolí nemění src/, tests/ ani IDE.
Předání je integrační kvalifikace, nikoli M6 acceptance. Nový 24h HTTP soak
běží v loopback namespace nad zmrazeným zdrojem, bez inference a outboundu.
Zdrojové změny po jeho startu by vyžadovaly nový běh.
Dokončený skutečný 5min HTTP throughput a upgrade/restore přesné předchozí
136.0.0 na 136.1.0 jsou PASS; nezakládají M6 acceptance ani GPU autoritu.
