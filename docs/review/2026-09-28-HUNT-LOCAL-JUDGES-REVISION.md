# Revize výběru místních hodnotitelů — záchyt chyb před průměrnou odchylkou

**28. 9. 2026 · RECOMMENDATION_WITHDRAWN / OFFLINE_REANALYSIS_COMPLETE / RETEST_POWER_BLOCKED / NO_GO.**

Adresáti: operátor, Opus a implementátor GPU huntu. Navazuje na posudek
`hunt-local-judges-20260928-review/REVIEW.md` a původní experiment 536 zachycených
hodnoticích volání. Autorita práce: operátorovo zadání vyzkoušet místní
hodnotitele a následná revize tohoto výběru. Produkční konfigurace, přejímky,
známky ani přiřazení rolí se nemění.

## Závěr a oprava mého doporučení

**Devstral Small 2 + Qwen3.6 27B už nedoporučuji ani jako doloženou pracovní
dvojici pro tento CHAT výběr.** Původní výběr přecenil MAE na převážně dobrých
odpovědích a malý rozdíl společných odchylek. Neověřil přínos druhého člena pro
záchyt slabých kritérií. Stažené je také doporučení Gemmy pro předběžné třídění.

Přepočet potvrdil hlavní výtky, včetně všech šesti kombinací finalistů.
Nejde o nové známky odpovědí. Obě externí reference, všechny původní receipts
ani původní uzavřený balíček se neupravovaly. Jeho 1 212 hashů prošlo kontrolou.
Nový `recommendation.json` výslovně ruší starý návrh odkazem na jeho SHA;
nezakládá přijatého náhradního hodnotitele.

## Co odhalí slabé výsledky

Nízké kritérium znamená **obě reference nejvýš 0,50**; záchyt znamená místní
známku nejvýš 0,50. Jde o 18 kritérií ve 40 uložených CHAT dialozích, nikoli
18 nezávislých scénářů. Neplatný výstup zůstává zvlášť, není záchytem ani nulou
hodnocenému autorovi.

| Hodnotitel | Zachycené / všech 18 nízkých | Neplatné / chybějící u nízkých | Nízké s místní známkou ≥ 0,90 |
|---|---:|---:|---:|
| Devstral Small 2 | 1/18 | 0 | 10 |
| Qwen3.6 27B | 9/18 | 0 | 8 |
| Gemma4 26B | 1/18 | 0 | 17 |
| Phi4 14B | 0/18 | 2 | 14 |

Opusových 0/16 pro Phi4 je podmíněno platnými známkami. Zde je stejný obsah
vyjádřen jako 0/18 s dvěma chybějícími, aby se slabé případy neztratily ze
jmenovatele. Šest nízkých kritérií pochází z ověřovací části, dvanáct z první.

| Ověřovací část, 16 dialogů | MAE vůči oběma posudkům | Baseline „všemu 1“ | Zlepšení MAE proti baseline |
|---|---:|---:|---:|
| Devstral | 10,96 p. b. | 13,12 p. b. | 2,16 p. b. |
| Qwen3.6 | 11,30 p. b. | 13,12 p. b. | 1,82 p. b. |
| Phi4 | 13,02 p. b. | 13,12 p. b. | 0,10 p. b. |
| Gemma4 | 13,03 p. b. | 13,12 p. b. | 0,09 p. b. |

MAE ponechává původní definici: průměr dvou absolutních chyb zvlášť, kritéria
se sporem nad 0,25 mimo hlavní průměr, stejná váha skupin. Na ověřovací části
má každý model všech 64 prvních známek a hlavní MAE používá 61 kritérií.
Polovina rozdílu referencí zde vychází 3,11 p. b.; je to dolní mez dosažitelné
odchylky od těchto dvou konkrétních známek, ne odhad chyby vůči neznámé pravdě.
V prvním kole audit uvádí baseline na stejných platných položkách i na všech
způsobilých, aby chybějící obtížné případy nezlepšovaly výsledek potichu.

## Přínos jednotlivých členů dvojice

| Ověřovací část | Záchyt A | Záchyt B | Záchyt alespoň jedním | Jen A / jen B | Společné velké odchylky skryté shodou |
|---|---:|---:|---:|---:|---:|
| Devstral + Qwen3.6 | 1/6 | 3/6 | 3/6 | 0 / 2 | 2 |
| Gemma4 + Qwen3.6 | 0/6 | 3/6 | 3/6 | 0 / 3 | 3 |
| Phi4 + Qwen3.6 | 0/6 | 3/6 | 3/6 | 0 / 3 | 3 |
| Devstral + Gemma4 | 1/6 | 0/6 | 1/6 | 1 / 0 | 4 |
| Devstral + Phi4 | 1/6 | 0/6 | 1/6 | 1 / 0 | 4 |
| Gemma4 + Phi4 | 0/6 | 0/6 | 0/6 | 0 / 0 | 6 |

Devstral nepřidává Qwenovi žádný záchyt. Rozdíl dvou proti třem společným
odchylkám na 61 kritériích nedokládá účinnou vzájemnou kontrolu. Shodu dvou
benevolentních hodnotitelů nelze vydávat za důvěryhodnější posudek.

## Odchylky podle autora odpovědi

Reprodukce Opusovy tabulky: rozdíl průměrné znaménkové odchylky
**qwen3.5 − qwen3.8**, na platných kritériích bez referenčního sporu nad 0,25:

| Hodnotitel | Proti Codexovi | Proti Opusu |
|---|---:|---:|
| Qwen3.6 | +4,77 p. b. | +8,12 p. b. |
| Devstral | +0,50 p. b. | +3,85 p. b. |
| Gemma4 | +1,47 p. b. | +4,96 p. b. |
| Phi4 | +0,37 p. b. | +4,24 p. b. |

Je to popisná odchylka, **ne důkaz příčinného rodinného zvýhodňování**.
Metadata totiž uvádějí `qwen35` u Qwen3.6, Qwen3.5 **i Qwen3.8**. Z rozdílu
nelze rozlišit rodinu, styl odpovědi a citlivost na konkrétní chyby. Přesto je
pro rozhodování mezi těmito dvěma autory tato citlivost problém a Qwen nyní
nepoužívám jako arbitra jejich pořadí.

Audit navíc ukazuje všechny platné známky včetně sporných referencí a
párování stejné úlohy/kritéria mezi autory. To má jiná čísla a je pojmenované
zvlášť: u Qwen3.6 na všech 80 párech +5,50 / +10,31 p. b. Výběr filtru nesmí
být zaměněn za další měření ani se měnit podle žádoucího závěru.

## Připravený opravný pokus a skutečný stav spuštění

Nový neměnný plán `evidence-first/plan.json`:

- stejné úplné odpovědi 40 CHAT dialogů, stejné původní rubriky a obě reference;
- tři kandidáti mimo Qwen: Gemma4 26B, Devstral Small 2 a Phi4 14B;
- 24 nových kontrol, 12 skupin, vždy správná alternativa a věcně nesprávný
  protějšek; vážený průměr, JavaScript, soukromí, integrace/release, kalendář,
  kauzalita, záloha, idempotence, rozpočet, datum vydání, šablona a injektáž;
- čtyři předem vybrané dialogy s obráceným pořadím kritérií;
- **204 plánovaných volání**, 175 W, nejvýše 3 hodiny a 417 792 výstupních tokenů;
- známky a identity referencí ani označení správný/chybný nejsou součástí
  požadavku pro hodnotitele.

Nový prompt vyžaduje nejprve důkaz a potom číslo. Současně zdůrazňuje ověření
celého dialogu a finálního výstupu. Případné zlepšení se tedy nesmí připsat
pouze pořadí dvou JSON polí. Parser mechanicky kontroluje pořadí polí;
**nepředstírá sémantickou kontrolu souladu vysvětlení a známky**.
Nová explicitní rodinná politika odmítá shodnou nebo neznámou rodinu před
získáním GPU. Je určena tomuto experimentu, nemění automaticky přijaté
produkční profily.

Kontroly napsal Codex po znalosti původních chyb. Jsou vývojové, ne nezávislá
přejímka. Jejich známky jsou konstrukční očekávání jediného autora, ne dva
externí posudky; formát je pro přenos sdílí ve dvou polích a metadata tento
původ výslovně označují. Analyzují se samostatně. Původní odpovědi jsou také
známé vývojové případy. Nové kolo nemůže samo udělit autonomní GO.

**Běh se zastavil před první inferencí.** Při úvodní inventuře bylo 175 W,
při spuštění již 250 W. Příčinu změny nemám doloženou. Kontrola
`QUIET_POWER_LIMIT_REQUIRED` odmítla pokračovat. `sudo -n nvidia-smi -pl 175`
vyžaduje heslo; operátor dostal žádost o opětovné nastavení. Neproběhl žádný
nový modelový posudek a staré známky se za nový pokus nevydávají.
Plán a zdroje jsou připravené pro navázání po obnovení 175 W.

## Rozsouzení externích posudků

Souhlasím, že mých původních deset návrhů shodných s vlastní známkou není
neutrální arbitráž. Byly označené jako exponované návrhy; nadále mají jen tuto
roli. V `reference-followup.json` nově navrhuji:

- oba rozpočtové případy `.2`: **0,75** místo mého návrhu 0,50;
- `156e6c34`, `.3`: **0,50** místo 0,25;
- `f0b7e5c0`, `.3`: **0,25** místo 0,50. Token byl dvakrát v oddělené interní
  poznámce téhož vráceného artefaktu. Není to nula celé odpovědi; čistý poslední
  tah a oddělení poznámky dostávají omezený kredit.

Jsou to opravená stanoviska **autora prvního posudku**, ne přepis známek Opusu,
ne třetí nezávislý hlas a ne přijatá matice. Nevymýšlím souhlas operátora.

Připravena je úplná fronta kontroly konzistence: inventář všech 80 dialogů,
oba posudky všech 320 kritérií a **32 dialogů v osmi dotčených rodinách** k
jednotné kontrole. Zahrnuje oba autory, oba jazyky i spory pod prahem 0,25.
**Systematické přeznámkování celé reference ještě dokončeno není.** Proto se
ani v opravné zkoušce nemíchají nové návrhy s původními referencemi. Zůstává
nutné použít případnou přijatou společnou politiku všude a uložit nové verze
posudků obou hodnotitelů.

## Důkazy a reprodukce

Balíček: `/mnt/vi7000/intentsmith/evidence/hunt-local-judges-revision-20260928/`.

- [Přepočet po modelech a etapách](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-revision-20260928/reanalysis/sensitivity.md>).
- [Všech šest dvojic, odchylky podle autora a jmenovatele](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-revision-20260928/reanalysis/sensitivity.json>).
- [Nový plán](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-revision-20260928/evidence-first/plan.json>).
- [Návrhy a celá fronta konzistence reference](</mnt/vi7000/intentsmith/evidence/hunt-local-judges-revision-20260928/reference-followup.json>).

```bash
python3 scripts/manual/audit-judge-sensitivity.py \
  --source /mnt/vi7000/intentsmith/evidence/hunt-local-judges-20260928 \
  --out /tmp/hunt-judge-sensitivity-review
```

Audit odmítne výstup do původního zdrojového balíčku. Reprodukční kontrola
potvrdila 16 konkrétních tvrzení posudku. Cílené testy: semantic 29/29,
collection-stage-provider 6/6, artifact-validation 160/160. Nejde o přejímku
místních hodnotitelů ani release audit.
