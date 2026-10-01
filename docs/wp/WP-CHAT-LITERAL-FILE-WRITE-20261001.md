# WP — doslovný zápis souboru v chatu

**Stav:** implementační kandidát; omezené lokální testy PASS, nezávislé review a integrace otevřené.

**Autorita:** explicitní zadání operátora dokončovat reálné chatové scénáře
(2026-09-30 a 2026-10-01) a živě pozorovaný pilot-4: první zpráva
`Ulož text "Ahoj" do new-notes.md.` i omezený zápis do `existing.md`
vrátily `Není co uložit`, bez návrhu M2. Stávající rozhodnutí v
`DIRECTION.md` přitom vyžaduje zachovat i zkratku `Ulož to` pro předchozí
odpověď asistenta. Tento WP nezakládá nové produktové rozhodnutí.

**Vstup a vlastnictví:** čistý integrační checkpoint `2477c8a2` ve vlastní
větvi `work/chat-literal-write-20261001` a vlastním checkoutu. Dotčené cesty:
`src/chat/handlers/file.js`, `tests/chat-literal-write-http.test.js`,
`tests/registry.json`, generovaný `docs/convergence/TEST-REGISTRY.md` a tento
WP. Žádná produkční DB, GPU, služba, model binding ani korpus 53 živých případů.
Paralelní oprava druhého kontextového okna patří jinému WP.

**Výsledek pro uživatele:** jednoznačný příkaz s textem v uvozovkách zapíše
přesně tyto bajty do pojmenovaného souboru po samostatném M2 schválení.
Zkratka `Ulož to` dál ukládá předchozí odpověď. Neúplný doslovný příkaz
vyvolá upřesnění. Požadavek „nepřepisuj existující soubor“ nevytvoří návrh
efektu, který by mohl později soubor přepsat.

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

**Stop condition:** při nejednoznačném textu, cíli nebo negaci nevytvořit
M2 proposal. Historii, stav registru `lastGreen` a produkční soubory neměnit.
Po review musí společná integrační větev znovu validovat registr a své
aktuální počty, protože souběžné WP mohou přidat další program.
