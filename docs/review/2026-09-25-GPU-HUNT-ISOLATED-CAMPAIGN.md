# GPU hunt: izolované měření a předání k revizi

25. 9. 2026 · větev `work/hunt-model-controls-20260917` · **PRŮZKUM / NO_GO pro autonomní výměnu**

Tento záznam navazuje na [GO review](2026-09-25-GPU-HUNT-GO-REVIEW.md). Měření běží na kopii živé SQLite v `.intentsmith-artifacts/hunt-isolated-20260925/c3-capture-verify.db` přes připnutý evaluační Ollama provider `0.34.2-intentsmith.1`. Každý požadavek nese očekávaný digest modelu a SHA256 kontraktu role. Výstupy jsou vývojová data na známých úlohách, nejsou čerstvým provozním holdoutem. Živá DB, přiřazení rolí, timer a instalovaná release se tímto sběrem nemění.

## CODE: měření zastavené před odpovědí modelu

Skutečný průchod `--evaluate-installed --role=CODE` skončil na přejímce historického orákula ještě před GPU inferencí. Referenční a alternativní oprava prošly, ale významově shodná formulace vysvětlení dostala částečné body a výslovný rozpor plné body; selhávají také sondy prahu a rychlosti. Runner nyní před umístěním kandidáta na GPU provede kontrolní opravy všech aktivních CODE úloh. Při selhání vydá `BLOCKED` s kódem `EVALUATION_SUITE_NOT_READY`, per-role kódem `CODE_ORACLE_CONTROL_FAILED`, konkrétními důvody a nulou modelových výsledků. Orákulum se neopravovalo dalším regexem: veřejný kontrakt volného vysvětlení potřebuje novou verzi a přijaté významové hodnocení.

Nová úloha `code_confidence_all_quality_v2_cs` již má vymezenou vstupní doménu, přesné API kontroly a pozitivní i negativní významové sondy. Je stále `PREPARED_FOR_REVIEW`, vyžaduje nezávisle přijaté posouzení volného vysvětlení a není připojená jako náhradní plné CODE orákulum. Její osm cílených testů prošlo; tím se však neotevřela rozhodovací brána.

Dřívější přesný technický replay na známých vývojových úlohách zůstává použitelný **jen jako dílčí komponenta**: qwen3.8 má 21/21 a devstral 15/21 spustitelných kontrol. U obou je `fullTaskScore: null`, `decisionAuthority: false`; plný CODE test ani dokončení reálné opravy z toho neplyne. Doklad je v [kompaktním auditu](evidence/2026-09-25-hunt-code-components.json) a zdrojovém reportu `/mnt/vi7000/intentsmith/evidence/hunt-milestones-20260923/code-components-with-observations.json`.

## VISION: stejné aktuální zadání pro tři modely

Všech 23 úloh VISION (22 s obrázkem a jedna kontrola bez obrázku) prošlo autorskými kontrolními sondami orákula: 299 kontrol, 22 odlišných skutečně dekódovaných obrázků. Každý model odpověděl třikrát na stejnou sadu a verzi poskytovatele. Opakování měří stabilitu jedné úlohy; nejsou to tři nezávislé případy. Výsledky jsou průměry obsahu podle aktuální technické rubriky, bez rozhodovací autority:

| Model | Přesný run ID | Průměr |
|---|---|---:|
| ornith-1.5:9b, současný | `eval_4d7587d8-6047-4ee9-aa9e-57795cd85344` | 0,7761 |
| qwen3.8:latest | `eval_248d2112-fc20-4830-8173-f5157aa7d900` | 0,7725 |
| gemma4:26b | `eval_14bc91d1-5add-4f8a-bd87-48d58a12a19f` | 0,7572 |

Deset úloh dalo všem stejnou známku, třináct je rozlišilo. Na `vision_connections` mají všichni nulu: obrázek stanoví minimální přestup 12 minut; qwen a gemma zvolily 9 minut, ornith pozdější přímý vlak. Na `vision_reconciliation` vyšel ornith 1, qwen 0,25 a gemma 0; na `vision_critical_path` naopak ornith 0,333, qwen 1 a gemma 0,667. Těsný celkový rozdíl není provozní důkaz lepšího přiřazení.

## D1, D2, R1 a R2

Na všech čtyřech sémantických rolích je **312/312 pokusů uloženo se stavem `CAPTURED`**. Každá role má osm stejných zadání a tři opakování na přesný artefakt. Opakování jedné úlohy nezvětšuje počet nezávislých případů. Každá kolekce prošla byte-exact kontrolou veřejného vstupu a voleb inference proti aktuální sadě; všech 13 kolekcí používá stejného připnutého poskytovatele. Staré známky se nepřenášejí. Nové rubrikové skóre má `null`, nikoli nulu.

| Role | Současný model | Další přesné artefakty | Uložené odpovědi | Stav kvality |
|---|---|---|---:|---|
| D1 | qwen3.5:27b | qwen3.6:27b, qwen3.8:latest | 3 × 8 × 3 = 72 | skóre čeká na nezávislé hodnocení |
| D2 | qwen3.8:latest | gemma4:26b, qwen3.6:27b | 3 × 8 × 3 = 72 | skóre čeká na nezávislé hodnocení |
| R1 | qwen3.8:latest | qwen3.6:27b, gemma4:26b, devstral-small-2:latest | 4 × 8 × 3 = 96 | skóre čeká na nezávislé hodnocení |
| R2 | devstral-small-2:latest | qwen3.6:27b, qwen3.8:latest | 3 × 8 × 3 = 72 | skóre čeká na nezávislé hodnocení |

Záznamy qwen3.8 u D1/D2/R1/R2 vznikly pod starším SHA rubriky. Aktuální validátor u nich přesto potvrdil **totožná zadání i inference options**, a proto jsou použitelné jako původní odpovědi pro nové hodnocení. Nejsou přijatým skóre pod novým kontraktem. SHA každé kolekce zahrnuje i identitu artefaktu a odpovědi, a musí se mezi modely lišit; audit se nyní opírá o individuální validaci vstupů a společný hash profilu úloh, nikoli o rovnost těchto SHA.

Přesné run ID pro revizi (úplný digest, oba SHA kontraktů a čas dokončení jsou v [strojovém auditu](evidence/2026-09-25-hunt-isolated-campaign.json)):

| Role | Model | Run ID | Digest, prvních 12 znaků | Rubrika |
|---|---|---|---|---|
| D1 | qwen3.6:27b | `eval_a5e13447-d837-4f03-b39d-978f241b956c` | `9d5803d493a9` | aktuální kontrakt |
| D1 | qwen3.5:27b | `eval_e37bee5f-78e4-4ded-ae84-9350624f0c86` | `7653528ba5cb` | aktuální kontrakt |
| D1 | qwen3.8:latest | `eval_80e8f162-cd84-449d-a0f0-d12e8264759e` | `22130167c4c2` | starší rubrika, shodný vstup |
| D2 | gemma4:26b | `eval_1d8bc564-095b-4d52-8d39-62d192d1cdbb` | `08ae7ec1744b` | aktuální kontrakt |
| D2 | qwen3.6:27b | `eval_6ddb2091-24e1-454c-bd44-eb21e46564c3` | `9d5803d493a9` | aktuální kontrakt |
| D2 | qwen3.8:latest | `eval_f766e962-899b-4fab-b0b9-f6eefe76809a` | `22130167c4c2` | starší rubrika, shodný vstup |
| R1 | qwen3.6:27b | `eval_754215bd-3ae1-41c3-aa0a-eec5009325c3` | `9d5803d493a9` | aktuální kontrakt |
| R1 | gemma4:26b | `eval_d116d7be-a68c-43e0-8ff3-19612003cc7b` | `08ae7ec1744b` | aktuální kontrakt |
| R1 | devstral-small-2:latest | `eval_9bca2dd3-799d-4df7-b9a5-4d3a839f86f9` | `24277f07f62d` | aktuální kontrakt |
| R1 | qwen3.8:latest | `eval_ee420a92-2fc1-462d-aa04-8b5df914e099` | `22130167c4c2` | starší rubrika, shodný vstup |
| R2 | qwen3.6:27b | `eval_6de74c77-dc0d-48c9-bf68-cdae6b7ca71f` | `9d5803d493a9` | aktuální kontrakt |
| R2 | devstral-small-2:latest | `eval_6534bff0-7830-4bd5-8dfe-e09b1e9a7cad` | `24277f07f62d` | aktuální kontrakt |
| R2 | qwen3.8:latest | `eval_70611a17-4e34-45dc-a500-3a48536d60de` | `22130167c4c2` | starší rubrika, shodný vstup |
| VISION | qwen3.8:latest | `eval_248d2112-fc20-4830-8173-f5157aa7d900` | `22130167c4c2` | aktuální kontrakt |
| VISION | gemma4:26b | `eval_14bc91d1-5add-4f8a-bd87-48d58a12a19f` | `08ae7ec1744b` | aktuální kontrakt |
| VISION | ornith-1.5:9b | `eval_4d7587d8-6047-4ee9-aa9e-57795cd85344` | `e5df7dcdd8a2` | aktuální kontrakt |

Tyto alternativy umožňují posoudit jiné rozložení rolí, zejména R1 a D2 mimo qwen3.8. Bez známek, přejímky hodnotitelů a provozního ověření není doloženo, že některá z nich může roli převzít. CHAT je v tomto sběru oddělený: opravený M0 pilot zůstává průzkumný a neověřil skutečný systémový prompt; z jeho spojení se skóre ostatních rolí nevzniká legitimní sedmirolová tabulka vítězů.


## Rozhodovací meze

Sémantické odpovědi se v této kampani **neznámkují**: žádná ze čtyř sad nemá dvojici nezávisle přijatých hodnotitelů. Původní zaslepený vývojový balíček 192 odpovědí je zmrazený pod SHA256 `b553d337adf6661e3a802f77edb532c95a4792794f6d0770320989162ee3359d`; klíč s identitami leží odděleně. Souhlas na těchto známých případech sám není přejímkou hodnotitele. CHAT pilot se po revizi M0 počítá odděleně po sadách; žádná neprokázala přínos 0,04 ani dostatečně silné nezhoršení 0,02. Běžel bez produkčního systémového promptu a jen s jedním nepřijatým externím hodnotitelem. Žádná role se zde nepřepíná.

Aktuální závazné konflikty portfolia jsou qwen3.8 současně v D2, CODE a R1, qwen3.5 současně v D1 a CHAT. Kód hlídá nejvýše dvě role na artefakt a autor nesmí být svým reviewerem; dnešní vazby tyto podmínky nesplňují. Průzkumné sběry vytvářejí možnosti k posouzení, ne kvalifikované náhrady. Před GO jsou nutné nezávislá přejímka hodnotitelů, nový provozní holdout a kvalifikovaná celá sestava s fyzickým ověřením a rollbackem.

## Kontroly a přesné artefakty

Revizní materiál je uložen v lokálním adresáři `/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925`. [Přehled se jmény modelů](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/identified/comparison-ungraded.html) ukazuje zadání → model → všechny tři odpovědi → technickou známku, pokud ji sada vydala. Má 55 zadání, 173 modelových karet, 519 odpovědí a 22 skutečně dekódovaných obrázků; průchod v prohlížeči byl bez chyby. [Zaslepený formulář](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/review.html) a [JSON packet](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/packet.json) obsahují 312 sémantických odpovědí a 840 kritérií, umožňují známky po setinách v intervalu 0–1; validátor vyžaduje důvod pro každé kritérium. Formulář dovoluje uložit i neúplný návrh. Packet SHA256 je `b3a2f33445ed7537fca65d2dd25645e68ba90250c1c0718c57396f8371aefc0f`; modelová identita a run ID v packetu nejsou, klíč je oddělený. Styl odpovědi může anonymitu i tak oslabit. Jde o známé vývojové případy, nikoli čerstvou přejímku.

Fyzický izolovaný CODE smoke pod původním připnutým kontraktem `8562144b245b992691f0716b7ae6d81fb6094f8726871c24baf55fc138fd8b81` vydal v [reportu](/mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/identified/code-preflight-final.json) i progress souhrnu stav `BLOCKED`, obecný kód `EVALUATION_SUITE_NOT_READY` a pro CODE přesný kód `CODE_ORACLE_CONTROL_FAILED`, s 0 výsledky modelu. Nejprve se oprávněně zastavil na neshodě kontraktu vyvolané mou diagnostickou úpravou CODE sady; tu jsem vrátil a stejné měření znovu spustil. Tato chyba tedy není připsána modelu a kontrakt zůstal stabilní. U smíšeného běhu závěrečná větev podle cíleného testu vypíše strukturované `blockedRoles` a stav `PARTIAL`, nikoli `COMPLETE`; fyzicky ověřen byl zatím samostatný CODE běh.

Po opravě auditu má pět rolí srovnatelné **syrové sběry** (D1, D2, R1, R2, VISION); tři chybějící položky jsou dvě plná CODE měření a pokrytí role CODE. Stav `decisionReady` je **0/7**. Archiv obsahuje [manifest SHA256](evidence/2026-09-25-hunt-isolated-manifest.json) pro 53 exportovaných souborů a konzistentní zálohu izolované SQLite (`integrity_check = ok`). Ověřil jsem všech 53 hashů a původní packet SHA. Záloha s klíči je v oddělené složce `restricted` a neslouží jako podklad k zaslepenému čtení.

Cílené kontroly: candidate-trial 38/38, code-patch-suite 29/29, připravená CODE v2 8/8, desktop-hunt 40/40 a validátor slepých posudků 5/5. Nový plný packet prošel strukturální validací v paměti (312 případů, 840 kritérií, žádné umělé známky neuloženy). VISION orákulum prošlo 299 autorskými sondami; nezávislá přejímka významového měřidla tím není doložená. Starší širší offline/database sada měla 364 PASS, 1 známý FAIL a 10 BLOCKED na jiném commitu; tento sběr ji nepovyšuje na zelenou release přejímku.

**K revizi:** nejprve známkovat zaslepené odpovědi a rozhodnout konkrétní spory rubrik; odděleně přijmout nové CODE významové orákulum včetně negativních sond; potom na čerstvých nezávislých provozních případech ověřit pořadí a omezení celé sedmirolové sestavy. CHAT potřebuje krátkou zkoušku se skutečným systémovým promptem. Až kvalita a sestava obstojí, následuje přejímka přesné instalované release s rollbackem. Do té doby je bezpečná autonomie pouze sběr a uchování důkazů, ne automatická výměna či mazání modelů.
