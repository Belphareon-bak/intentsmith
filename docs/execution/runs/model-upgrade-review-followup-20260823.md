# Model upgrade v136.1 — follow-up po review 2026-08-23

## Verdikt

Review správně našlo kolizi migrace, tiché vypadnutí starých gold úloh,
nevhodný CODE panel a svévolný limit dvou rolí. Oprava zachovala fail-closed
hranice a posunula prototyp do rozhodovacího stavu:

- CODE fixture má **44 úloh: 8 active / 33 reserve-floor / 3
  reserve-unstable / 0 pending**;
- CHAT kvalitativní vítěz `qwen3.5:27b` byl po párovém vítězství 7:5
  aplikován místo `qwen3:14b`;
- CODE kvalitativní vítěz `qwen3.8:latest` vyhrál 4:0, ale vazbu nepřevzal,
  protože už je R1 a CODE–R1 je nezávislá implementer-reviewer dvojice;
- žádný model nemá většinu sedmi rolí; `qwen3.5` drží tři, `qwen3.8` dvě;
- žádný model nebyl smazán a automatická aplikace z timeru zůstává vypnutá.

## 1. Migrace 070

Opakovaný union census nad **352 aktuálně dostupnými non-archive/recovery branch
tipy** našel obsazená čísla 001–069. Historický commit `c8ffbccc` navíc skutečně
vydal runtime finalization jako 068, i když současný tip jeho větve už soubor
přejmenoval na 069. Eval historie proto byla přesunuta z kolidující 068 na
první volnou **070**.

Lokální DB už původní eval 068 provedla. Migrace 070 ji smí adoptovat pouze
tehdy, když se přesně shodují sloupce a normalizované SHA-256 definice tabulky,
tří indexů a dvou append-only triggerů. Lookalike schema se stejnými názvy,
ale jinou definicí test odmítá. Podrobnosti censusu jsou v
[migration-reservation.md](../migration-reservation.md).

## 2. Zachování gold zásoby

Full rebuild v1→v2 dříve vzal jen první nově odvozené úlohy a starou ověřenou
zásobu tiše ztratil. Builder nyní při shodném kontraktu zachová fingerprintované
gold úlohy. Při změně cíle `failToPass` kalibraci nepřenese a uvede explicitní
důvod v `rejected`.

Z pěti nahlášených hashů jsou pod dnešním `code-task-v2` kontraktem pravdivě
použitelné čtyři:

| Commit | Stav po gold ověření | Kalibrace na novém panelu |
|---|---|---|
| `da03e8bd` | vrácen | active, hodnoty `[0,1,1,0,0]` |
| `cfcb63dd` | vrácen | reserve-floor |
| `723d5726` | vrácen | active, hodnoty `[0,0,1,0,0]` |
| `06d49847` | vrácen | reserve-floor |
| `286a9117` | odmítnut | pre-fix stav po vložení není syntakticky platný |

Pátý hash se tedy neztratil tiše; fixture uchovává přesný důvod odmítnutí.
CLI podporuje cílené `--recover-hash`, takže podobná oprava nevyžaduje slepé
vytěžování celé historie.

## 3. CODE panel a efektivní rekalibrace

Nový panel je čistě textový/CODE:

1. `qwen3-coder:latest`
2. `qwen3.5:27b`
3. `qwen3.8:latest`
4. `qwen3:14b`
5. `qwen3-30b-a3b:latest`

`llava:13b` byl odstraněn. `qwen2.5-coder:32b` byl skutečně změřen při 32 768
tokenech: celkem 26,83 GiB, GPU 20,31 GiB, CPU spill 6,52 GiB. Na RTX 3090 se
tedy celý nevejde a jeho přesný digest má trvalý hardwarový BLOCKED záznam.
Stejně byly o kontext doplněny starší doložené bloky `qwen2.5:32b`,
`deepseek-r1-32b` a `mistral-small:22b`; shortlist už je znovu nezařazuje.

Rekalibrace neprovedla zbytečných 660 inferencí. Čtyři vrácené úlohy dostaly
celý panel (4 × 5 × 3 = 60 odpovědí) a jediný nový člen panelu `qwen3.8`
doplnil starých 40 úloh (40 × 1 × 3 = 120). Ostatní čtyři modely použily jen
přesnou historii stejné úlohy a kontraktu. Celkem **180 nových odpovědí**.

Artefakty:

- [vrácené gold úlohy](./code-patch-panel-recovered-gold-20260823.json)
- [qwen3.8 rozšíření starého panelu](./code-patch-panel-qwen38-extension-20260823.json)

Konečné skóre na osmi active úlohách:

| Model | Skóre |
|---|---:|
| `qwen3.8:latest` | 0,791625 |
| `qwen3.5:27b` | 0,291625 |
| `qwen3-coder:latest` | 0,141625 |
| `qwen3:14b` | 0,138875 |
| `qwen3-30b-a3b:latest` | 0,000000 |

Párové rozhodnutí nepoužívá tento absolutní žebříček. Po konzervativním
odstranění jednoho třídesetinného rounding artefaktu porazilo `qwen3.8`
incumbent `qwen3.5` na čtyřech stabilních úlohách **4:0, marže 0,833**, při
16,20/16,20 GiB ve VRAM a 36,5 tok/s. Portfolio zůstalo korektně beze změny,
protože CODE–R1 nesmí být stejný model. Úplný běh je v
[CODE pairwise reportu](./model-upgrade-code-qwen38-reuse-20260823.json).

## 4. CHAT testy a scoring

CHAT v3.2 obsahuje 35 úloh: 21 EN a 14 CZ. Každá vrací průběžné skóre `0..1`
jako vážený podíl splněných checklist bodů po explicitních penalizacích za
faktické rozpory, porušení formátu nebo vymyšlené hodnoty. Tři opakování dávají
mean a spread. Úloha vstoupí do párového rozhodnutí jen tehdy, když rozdíl
překročí 0,05 i naměřený spread. Automatická CHAT výměna navíc vyžaduje
nejméně 7 stabilních úloh, z toho 3 EN a 4 CZ.

Panel rozlišil 11 úloh, **7 EN + 4 CZ**. Proti `qwen3:14b` rozlišilo
`qwen3.5` dvanáct úloh, **6 EN + 6 CZ**, a vyhrálo **7:5 s marží 0,100**.
Po změně limitu ze svévolných dvou na operátorem určené „žádný model nemá
většinu“ proto CHAT durable binding přešel na `qwen3.5:27b`. Runtime apply
uspěl; navazující notification receipt nebyl vydán, takže pravdivý terminální
výsledek je `APPLIED_NOTIFICATION_DEGRADED`, ne plně verified.

- [přesné prompty a rubriky všech CHAT testů](./chat-v3.2-tests-20260823.json)
- [525 odpovědí a dílčí scoring](./chat-v3.2-panel-results-20260823.json)
- [párové rozhodnutí a aplikace CHAT](./model-upgrade-chat-qwen35-apply-20260823.json)

## 5. Historie, provoz a ověření

- SQLite: **46 COMPLETE / 98 BLOCKED**, `PRAGMA quick_check = ok`;
- exact digest + exact suite contract se nespouští znovu; hardwarový blok se
  znovu použije jen pro stejnou GPU, VRAM a kontext;
- user timer `intentsmith-model-hunt.timer` je `enabled` a `active`, další běh
  je 2026-08-25 09:51 CEST; kadence je 48 hodin, nejvýše dva kandidáti;
- 11 relevantních sad: **561 passed, 0 failed**;
- syntax checks, `git diff --check`, failover proof policy a oba pinned soubory
  prošly; `validation-suites.js` ani `model-profiles.js` nejsou v diffu;
- po běhu je Ollama prázdná, přibližně 22,4 GiB VRAM volných, 17,6 GiB RAM
  dostupných a 83 GiB volného místa. Cizí procesy ani sessions nebyly ukončeny,
  `swapoff` nebyl proveden.

## 6. Otevřené produktové body

Prototyp je funkční, ale následující dvě věci nejsou vhodné k tichému odhadu:

1. princip oddělení autora a reviewera je schválený; přesná čtveřice dvojic
   D1–R1, CODE–R1, CODE–R2 a D2–R2 je stále prototypová politika;
2. incumbent se má ponechat „ještě chvíli“, ale chybí délka grace period,
   diskový strop a pravidlo, kdy je automatické smazání přípustné.

D1 zůstává `qwen3.5` jako dříve provedená policy repair, nikoli jako nově
doložený párový vítěz nad `qwen3.8`. Nevrací se automaticky, protože by se tím
obnovilo právě sdílení D1–R1, které má segregace odstranit. Tento status je
vědomě označený jako otevřený, ne jako kvalitativní upgrade.
