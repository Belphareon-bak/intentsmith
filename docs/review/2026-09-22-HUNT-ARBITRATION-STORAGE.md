# GPU hunt — nový disk a arbitráž, 22. 9. 2026

**CONFIGURATION_VERIFIED / ARBITRATION_REVIEW_PENDING.** Sběr pod dohledem
zůstává dostupný. Automatický výběr a mazání podle kvality jsou **NO_GO**,
0/7 přijatých rozhodovacích profilů. Autorita: pokračující zadání operátora,
HANDOFF §5, DIRECTION §1; kontrakt a zmrazené rubriky se neměnily.

## Opravené propojení nového úložiště

Systémová Ollama již používala `/mnt/vi7000/ollama/models`, ale uživatelský
systemd manager a běžící backend měly `OLLAMA_MODELS` nastavené na neexistující
`/usr/share/ollama/.ollama/models`. Tuto hodnotu by převzala ruční evaluace
i plánovaný hunt; stejnou chybnou cestu používala kontrola místa před pullem.

Přibyl uživatelský `~/.config/environment.d/99-zz-intentsmith-ollama.conf`.
Po aktualizaci prostředí manageru a restartu nečinného backendu mají všechny
tři cesty nové úložiště. Ověřil se skutečný výstup environment generatoru,
prostředí backend PID 36100 a krátká transient služba se stejným
`EnvironmentFile` jako ruční evaluace. Před restartem nebyl živý execution
claim, supervisor ani provider claim a GPU i obě měřicí služby byly nečinné.
Staré dva záznamy v `/etc/environment` se neměnily; pro user služby je přebíjí
nový soubor. Otevřený shell může stále držet původní zděděnou hodnotu.
Restart OS se při této kontrole neprováděl.

Oba provideři vracejí **12 přesně shodných artefaktů**: název, digest,
velikost. Digesty odpovídají manifestům na novém disku. Evaluační binárka
`0.34.2-intentsmith.1` i native manifest prošly SHA kontrolou. Dočasný provider
na 11435 obsluhoval pouze `version`, `tags`, `ps` a poté byl ukončen;
**0 inference / 0 pull / 0 delete**. Systémový provider zůstal běžet.

Modely a releasy jsou na Verbatim Vi7000, UUID
`3ee5300a-2531-41bd-881f-4032ffb980c7`, mount `/mnt/vi7000`.
Při tomto ověření měl disk jméno **nvme0n1**, nikoli nvme1n1; fstab používá
UUID, proto se na pořadí zařízení nespoléhá. Dostupno přibližně **755 GiB**,
na FS s DB/evidence přibližně **187 GiB**. Dosavadní meze RAM/FS zůstávají
beze změny; dostatek místa sám neautorizuje velkou dávku ani automatiku.

## Releasy: důkaz vazeb, žádné mazání

28 adresářů releasů; **26** má přímou nalezenou vazbu na aktivní instalaci,
jednu ze 48 instalačních záloh nebo registrovaný Git worktree. U
`4b5eb2091d7d41da8ab6f7c8f5dcd90ee57fd46f` a `df7800ac-code-pilot` nebyla
v tomto omezeném průchodu nalezena taková vazba: **KEEP_UNPROVEN**.
Nejde o úplný audit všech M6 podpisů, receiptů a archivů. Žádný adresář tím
nezískal oprávnění ke smazání. Btrfs reclaimable kapacita se z velikosti
adresářů neodhaduje. Obsah klíčů se nečetl; kontrola názvů souborů nepotvrdila
dřívější tvrzení o osmi retired TLS párech, nalezla testovací pár ve třech
releasech. Tento rozdíl není důkaz, že jiné reference či klíče neexistují.

## Konkrétní podklad k arbitráži

Otevři [arbitration.html](../../../../Projects/coworker/intentsmith-hunt-arbitration-20260922/arbitration.html)
v evidence rootu. Obsahuje devět větších normalizovaných neshod
**[1, 2, 6, 12, 17, 18, 20, 24, 30]** a nevyřešený scope **[29]**.
Původních osm sporů nezahrnovalo [30], protože předchozí export nečetl pole
`score`. To již bylo opravené 21. 9.; nynější běh to nevydává za nový nález.

Každá položka má původní worker a Claude skóre, původní kritéria a důvody,
můj oddělený návrh, úplné zadání i odpověď, nejistotu a otázku k rozsouzení.
HTML dovoluje uložit operátorovo rozsouzení do JSON. Nic neposílá a neimportuje
do produktu. Autor zná staré posudky; **nejde o slepé nezávislé hodnocení ani
náhodný přejímací vzorek**. Chybějící Claude kritériový rozpad se nedopočítává
z jeho celkového skóre.

| Položka | Doložený fakt / návrh |
|---|---|
| [20] D2 cleanup | Přesná navržená funkce vrací dva aliasy téže identity. Oprava už v originálu měla 0,25; součet 0,6875 pochází ze samostatné diagnózy, shortcutu a testovacího návrhu. Není to úspěšná oprava. |
| [6] D2 history | Throw reprodukce v dodané catch větvi historii neznečistí; chybu vyvolává vrácené `metadata.error`. Navrhuji v kritériu diagnóza+reprodukce 0,25 místo 0,5. S dřívější korekcí regresí vychází návrh 0,5625; bez nové inference, nepřijato. |
| [17]/[18] D1 metrics | Nová kontrola přesného dodaného `_flush` potvrzuje prázdný buffer již při vytvoření transakce. Práh 10 neomezuje velikost flush dávky. [17] zachovává dřívější korekci příčiny na 1; [18] chybný řetězec zůstává na 0,25. |
| [12]/[24] R2 cleanup | Rubrika říká „one finding“, ale připojuje všechny systémové požadavky. Doporučuji bodovat doložený primární nález, nikoli požadovat kompletní opravu calleru. Návrh 1 za tento nález čeká na potvrzení výkladu a následný jednotný replay. Dodatečné neověřené nálezy nemají další kredit. |
| [29] R1 environment | Rozsah odsazených komentářů není z veřejného zadání rozhodnutý. Zůstává null; neopravuje se domnělou nulou. |
| [30] R1 math | Regex pro nulový znak funguje. SQ odstraní předchozí filtrování písmen; „invalid escape“ je chybná příčina. Samotné `Function` nedokládá RCE; žádný exploit se nepotvrdil. |

U [1], [2], [18], [20] a [30] se původní součty neprohlašují za přijaté jen
proto, že je autor po kontrole ponechal. U [17] se potvrzuje již připojená
korekce z 21. 9.; nové návrhy tohoto běhu jsou [6], [12], [24]. Původní soubory
a známky jsou zachované beze změny. Žádné nové pořadí modelů z toho nevzniklo.

## Ověření a zbývající práce

- Původní dedup/history/regex reprodukce znovu prošla, nová metrics reprodukce
  prošla. Jde o přesné funkce v mock objektech, ne celé produkční integrace.
  Tail během callbacku je syntetická reentrantní kontrola, nikoli tvrzení
  o skutečném asynchronním chování synchronní DB.
- Health, hunt, evaluace a kandidáti: **4× HTTP 200** po restartu backendu.
  API vrací sedm rolí, všechny `decisionReady:false`, hunt `HELD`.
- Integrita instalovaného Studio consumer buildu po přesunu: PASS. Release
  zůstává `cd5a6943`; žádné přepsání pečeti ani souborů uvnitř releasu.
- Nové arbitrážní HTML: Chromium 152, deset položek, rozbalení odpovědi,
  navigace a export JSON ověřeny. Síť blokovaná, diagnostické `--no-sandbox`,
  GPU vypnuté. Není to nový fyzický průchod celé aplikace Studio.
- První storage probe selhal na chybném názvu systemd generatoru ještě před
  startem provideru. Pokus je zachován; po zjištění skutečné cesty prošel.
  Produktový kód se v tomto běhu neměnil, celý produktový test profil se
  neopakoval. Starší známý FAIL Gate 0 pečeti se tím neuzavírá.

Další pořadí: potvrdit kritériové kotvy a scope [29], promítnout přijaté změny
do všech dotčených uložených odpovědí, nikoli jen vybraných deseti; přijmout
nezávislého hodnotitele na oddělených označených případech; provést uzamčené
provozní ověření na nových historických případech. **CODE může připravovat
provozní holdout paralelně k této arbitráži**, protože používá spustitelné
orákulum. Jeho 21/21 proti 11/21 je opakování sedmi vývojových úloh v pěti
deklarovaných skupinách, nikoli 21 nezávislých provozních případů. Silný
vývojový signál neuzavírá velikost vzorku ani předpovědní platnost.

Timer je stále **disabled/inactive**, GPU po probe prázdná. Různé režimy
schválení modelu, cleanup a inference nebyly aktivované.

Strojový [receipt a hash archivu](evidence/2026-09-22-hunt-arbitration-storage.json)
váže zdroje, hostové ověření, reprodukce, arbitrážní soubory a screenshot.
Archiv byl znovu přečten a všech 26 položek manifestu ověřeno proti SHA-256.
