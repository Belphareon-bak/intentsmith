# GPU hunt — oprava workflow a rozhodovacích hranic

**WORK_IN_PROGRESS / REVIEW_PENDING / NOT_DEPLOYED.** Navazuje na operátorovo
zadání dokončit mezery z [auditu](2026-09-19-GPU-HUNT-READINESS.md).
Vstupní commit `eb67eb314ab87c3ee6670855978c77bfb7468077`.

## Konkrétní opravy

- Parser zachová více samostatných fenced patchů i více změn uvnitř jedné
  funkce. Validace a aplikace používají tentýž resolver původního textu.
  Numerické unified hunks vyžadují přesnou pozici, obsah a deklarované počty;
  sémantické kotvy jednoznačný úsek (povolena dosavadní tolerance odsazení).
  Nejednoznačný nebo zastaralý patch se neaplikuje.
- Node `ERR_ASSERTION`, TAP, členské TypeError a `.mjs/.cjs` stacky poskytují
  skutečnou diagnostiku. Neznámý neúspěšný výstup je explicitní chyba.
  Jediný opravný pokus formátu po odmítnutém patchi zůstává v limitu iterací;
  úspěch vyžaduje potvrzení testů i quality gate, včetně poslední iterace.
- Spustitelné průzkumné měření se odděluje od přijatého rozhodovacího profilu.
  Dnešní prototypy mohou měřit, ale jejich vítězství nezaloží doporučení
  ani retenční důkaz. Historická skóre a ruční přiřazení se nepřepisují.
- Samotný pokus kandidáta již nemůže mazat po jedné prohře ani po CPU spill.
  Mazání vlastní posouzení všech použitelných rolí a exact-artifact autorita.
- GUI a controller zobrazují hold automatiky a odmítnou start/resume, který
  by systemd podmínka stejně přeskočila. Ruční měření je nadále dostupné.
- Běžný evaluační wrapper vybírá opravený provider `.2`, stejně jako pilot;
  reprodukovatelný build pro 0.34.0 jej používá jako výchozí revizi.

## Vývojová evidence

Přehrání 48 uložených odpovědí bez inference opravilo šest stavů: tři
plánovače a tři kategorií expertiz. Některé jiné pokusy potřebují další
odpověď, kterou archiv nemá; takový replay není nové selhání modelu.
Historických 0/24 se tento experiment nedotýká.

Přejímka současné smyčky na osmi případech: 24 přímých kontrol stavu a
28 kontrol přes skutečný patch engine. První běh odhalil odmítnutí dvou
správných referencí; je zachován vedle následné opravy a úplného PASS.
Čerstvá inference a celková regrese následují; tento checkpoint je netvrdí.

Evidence: `/home/belphareon/Projects/coworker/intentsmith-hunt-completion-20260919`.
Původní C3 checkout, produkční DB, vazby, artefakty a automatický timer nebyly
při této implementaci změněny. Nasazená aplikace zatím obsahuje starší zdroje.

## Nálezy z nové inference a GUI

První vývojový běh používá čistý `bdbcd201`, dva přesné artefakty a osm
již zveřejněných případů; není to holdout. Oba modely prošly kvalifikací
16 384 kontext / 4 096 výstup, celé na GPU pod limitem 22 GB. Během něj
vznikly další opravy, které jeho výsledky zpětně nemění:

- Identická opakovaná nabídka patche v jedné odpovědi se aplikuje jednou.
  Historie oscilací obsahuje pouze aplikované změny, nikoli odmítnuté návrhy.
- Pojmenované chyby skutečného repository harnessu zůstávají rozlišitelné
  bez vymyšlených řádků zdroje. Zkrácený prompt další iterace vždy obsahuje
  aktuální chyby; skutečný Node test ověřuje dvě následné opravy.
- Existující hold s nepřijatelnými oprávněními již neshodí celé API na 503:
  automatika zůstane pozastavená a panel vysvětlí nečitelné podrobnosti.
- Oba instalační skripty vybírají stejný provider `.2` a jeho SHA jako wrapper.
  Běžící systémový provider se zde nepřepínal.

Samostatný Electron/CDP průchod `gui-3` otevřel sedm záložek, historický
  detail a ověřil opětovné spojení po restartu vlastního backendu na novém
  portu. Použil nový frontend a skutečné read model/controller nad produkční
  DB otevřenou pouze pro čtení, diagnostický bridge a `--no-sandbox`.
  Nejde o doklad nasazené aplikace, downloadu, inference z GUI nebo změny vazby.
  První dva neúspěšné průchody jsou zachované včetně nalezené chyby hold.
