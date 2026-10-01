# WP — doslovný zápis souboru v chatu

**Stav:** implementační kandidát; omezené lokální testy PASS, nezávislé review a integrace otevřené.

První nezávislé review commitu `3046c9d0` vrátilo `CHANGES_REQUIRED`:
podmínka „pouze pokud soubor ještě neexistuje“ stále mohla vytvořit přepisující
efekt. Následný red-first M1 HTTP test selhal přesně na chybějícím blokování.
Následná oprava rozpoznává ekvivalentní české a anglické podmínky create-only.
Red-first případ F06 `ulzo text "Ahoj" do network.md, necham si ho` navíc
odhalil chybné směrování do `project.collaboration`; přesný doslovný příkaz
teď CRE deterministicky směruje do FILE_WRITE a handler dovolí pouze tuto
uzavřenou vedlejší větu bez změny bajtů, cíle nebo autority.
Opakované review commitu `7397d71f` vrátilo další `CHANGES_REQUIRED`:
šest dalších formulací create-only ve zkratce `Ulož to` stále nabízelo
`fs.write`; reviewer také skutečným schválením doložil přepsání existujícího
souboru. Red-first HTTP/SQLite regrese tuto chybu zopakovala. Nynější
zpracování pojmenovaného nedoslovného zápisu odmítá jakoukoli nevyloženou
větu za prvním výskytem cílové cesty; srozumitelné podmínky create-only vrací
výslovný bezpečný stop. Uzavřené stávající výjimky jsou redundantní uložení
do stejné cesty a přesné „v projektu“ v aktivním projektovém kontextu. To
chrání i formulaci, kterou seznam synonym nezná. První běh existujícího M2
consumeru po zavedení brzdy našel tyto dvě legitimní věty a skončil **21 PASS /
1 FAIL**; po úzkém povolení obou konkrétních vět prošel **22/22**.
Po omezeném `REVIEW_PASS` nad `88212c16` jsem ještě před integrací ověřil
podmínku před názvem cíle: `Pouze nový soubor, ulož to do existing.md.`
Red-first M1 HTTP/SQLite běh prokázal nový přepisující návrh. Nynější kandidát
rozpoznává obvyklé předřazené create-only formulace; nevyložený podmínkový
prefix před cílem se také zastaví bez M2 efektu. Tato další delta znovu
vyžaduje nezávislé review; dřívější verdikt se na ni nepřenáší.

**Autorita:** explicitní zadání operátora dokončovat reálné chatové scénáře
(2026-09-30 a 2026-10-01) a živě pozorovaný pilot-4: první zpráva
`Ulož text "Ahoj" do new-notes.md.` i omezený zápis do `existing.md`
vrátily `Není co uložit`, bez návrhu M2. Stávající rozhodnutí v
`DIRECTION.md` přitom vyžaduje zachovat i zkratku `Ulož to` pro předchozí
odpověď asistenta. Tento WP nezakládá nové produktové rozhodnutí.

**Vstup a vlastnictví:** čistý integrační checkpoint `2477c8a2` ve vlastní
větvi `work/chat-literal-write-20261001` a vlastním checkoutu. Dotčené cesty:
`src/chat/cre-decision.js`, `src/chat/handlers/file.js`,
`tests/chat-literal-write-http.test.js`,
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md` a tento
WP. Žádné úpravy produkční DB, služby, GPU huntu, model bindingu ani korpusu
53 živých případů.
Paralelní oprava druhého kontextového okna patří jinému WP.

**Výsledek pro uživatele:** jednoznačný příkaz s textem v uvozovkách zapíše
přesně tyto bajty do pojmenovaného souboru po samostatném M2 schválení.
Zkratka `Ulož to` dál ukládá předchozí odpověď. Neúplný doslovný příkaz
vyvolá upřesnění. Požadavek „nepřepisuj existující soubor“ nevytvoří návrh
efektu, který by mohl později soubor přepsat; totéž platí pro „jen pokud
soubor ještě neexistuje“ a `only if the file does not exist`.

**Bezpečnostní hranice:** aktuální `file.write@1` a M2 `fs.write` nemají
atomickou podmínku „vytvoř jen při neexistenci“. Kontrola existence před
schválením by nezabránila závodu. Dokud nevznikne verzovaný create-only efekt,
chat u takového požadavku musí zastavit zápis a vyžádat nový název souboru
i výslovné rozhodnutí, zda je přepsání přípustné.
Tento kandidát tedy nenabízí hotové atomické vytváření bez přepsání.

**Demonstrace a ověření:** nový registrovaný test
`IS-T3-TESTS-CHAT-LITERAL-WRITE-HTTP-TEST` startuje skutečné M1 HTTP se
soukromou SQLite databází a projektem a s řízenou lokální klasifikační
fixture. Kontroluje přesný `file.write@1` vstup, cílový root a cestu, SHA-256
a délku payloadu, absenci souboru před M2 schválením a přesné bajty po něm.
Samostatně chrání již existující soubor i se starší odpovědí v historii a
ověřuje, že omezení nevytvoří M2 efekt. Kontroluje také starší zkratku,
doslovný text obsahující slovo `nepřepisuj` a nejednoznačný nezakotovaný text.
Dalších šest českých a anglických create-only formulací a dvě nevyložené
věty za cílovou cestou musí zůstat bez M2 návrhu.
F06 překlep testuje přesný cíl, obsah a skutečné M2 schválení; další efektová
věta za stejným překlepem musí skončit bez návrhu.
Původní červený HTTP test reprodukoval chybějící proposal; další běh odhalil
tečku připojenou k názvu souboru u starší zkratky, kterou tento WP opravil.

Přímý izolovaný běh na Node 24: nový HTTP test **1/1 PASS**,
`tests/m1-chat-contract.test.js` **73/73 PASS**,
`tests/m2-tool-production-consumer.test.js` **22/22 PASS**,
`tests/m2-effect-file-consumer.test.js` **39/39 PASS** a
`tests/file-write-extract.test.js` **21/21 PASS**. Registrovaný kandidátní
běh `2026-10-01T04-26-52-519Z` skončil **1/1 PASS**; report je v ignorované
`.intentsmith-artifacts/run-suites/2026-10-01T04-26-52-519Z/report.json`.
Registr kandidáta validuje 585 programů s fingerprintem
`81f1b52615e18c67db7af02635128d091c93274bc4c22ff77efba0d5c6287953`.
Nezávislé review a integrovaný test zůstávají otevřené; tyto omezené výsledky
nejsou živou modelovou ani release akceptací.

Při následné kontrole CRE byly omylem spuštěny dvě nepovinné sady
`cre-comprehensive` a `cre-guard-interactions`, které skutečně kontaktovaly
sdílenou Ollamu. Oba vlastní Node procesy byly ihned ukončeny; jejich výsledek
je **INTERRUPTED**, nikoli PASS. Logy zůstaly v ignorované soukromé cestě
`.intentsmith-artifacts/followup-{0,1}.log`. Další ověření používá pouze
řízenou loopback fixture. Po opravě prošel nový M1 HTTP scénář **1/1**,
`cre-file-reference-guard` **9/9**, M1 kontrakt **73/73**, produkční M2
consumer **22/22**, M2 souborový consumer **39/39** a extrakce **21/21**.
Generovaný registr znovu validoval stejných 585 programů a fingerprint
`81f1b52615e18c67db7af02635128d091c93274bc4c22ff77efba0d5c6287953`.

**Stop condition:** při nejednoznačném textu, cíli nebo negaci nevytvořit
M2 proposal. Historii, stav registru `lastGreen` a produkční soubory neměnit.
Po review musí společná integrační větev znovu validovat registr a své
aktuální počty, protože souběžné WP mohou přidat další program.
