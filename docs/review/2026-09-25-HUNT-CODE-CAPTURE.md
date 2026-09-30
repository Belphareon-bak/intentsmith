# CODE: oddělený syrový sběr a pracovní kontroly

25. 9. 2026 · **42/42 odpovědí sebráno · 42/42 celkových známek `null` · rozhodnutí NEROZHODNUTO**

Dva přesné lokální artefakty absolvovaly stejných sedm vývojových CODE zadání třikrát. Nová sběrná cesta nejprve ověřila spustitelnost fixture a pracovních kontrol. **Nepoužila finální významové orákulum k povolení inference a žádnou odpověď neoznámkovala.** Uložené odpovědi se potom samostatně spustily proti technické složce testů. Produkční rozhodovací brána ani bindingy se nezměnily.

| Artefakt | SHA-256 digest | Syrové odpovědi | Technická složka, jen pracovní testy |
|---|---|---:|---:|
| `qwen3.8:latest` | `22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643` | 21/21 | 21/21 |
| `qwen3.5:27b` | `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e` | 21/21 | 18/21; tři neúspěchy na `patch_adb1258cfec0` |

Technický poměr **není skóre role CODE**. Sedm úloh znamená nejvýše sedm odlišných historických případů na model; tři opakování nejsou tři nezávislé případy. Sada je známý vývojový materiál. `collectAnswer()` pořizuje jedno návrhové volání na pokus; zde **neproběhla opravná smyčka C3 s opakovanými pracovními testy a dalšími patchemi**. Technická kontrola spouští až uložený návrh. Tento rozdíl je nutný pro interpretaci výsledku a zůstává otevřenou částí provozního ověření.

## Proč sběr mohl běžet a známkování ne

[Technická přejímka](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/technical-replay.json) ověřila sedm fixture a 53/53 spustitelných kontrol, včetně správné alternativy, rozbité verze a záporných sond. Tytéž kontroly prošly v obou plánech před inferencí. Naproti tomu aktivní finální orákulum má u `patch_90eff80ecb8a` osm významových selhání: mimo jiné odmítá správnou parafrázi jistoty a přijímá výrok, který správnou jistotu popírá. To blokuje **celkovou známku, doporučení a nasazení**, nikoli způsobilou pracovní fixture. Připravené náhradní orákulum stále nemá nezávislou přejímku.

Pro nový sběr je přidána samostatná [kontrola technické způsobilosti](../../src/eval/code-capture-preflight.js). Manuální runner ji spustí pro každou CODE úlohu, uloží pozorování do `capture-preflights.jsonl` a zastaví pouze při chybě fixture/pracovních kontrol. Finální orákulum se v režimu `--collect-only` nevolá. Regresní test zároveň potvrzuje, že selhání finálního orákula nebrání syrovému sběru a že vadná pracovní kontrola jej zastaví.

## Přesné podklady k revizi

- [Anonymní přehled zadání → kandidát A/B → tři celé odpovědi](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/review/public/comparison.html) a [jeho JSON](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/review/public/packet.json). Packet SHA-256 `b6823b2f18bbfee989eccff06157b7d53effd7c24ff5d455d3d77b7ebe8a4d4f`. Technická pozorování jsou zde od obsahu odpovědi výslovně oddělena; nejde o známku.
- Plány a append-only odpovědi: [qwen3.8](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/qwen38/result.json) (plán `be571f61…`, výsledkový soubor SHA-256 `86e16b04…`) a [qwen3.5](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/qwen35/result.json) (plán `5cc59a72…`, výsledkový soubor SHA-256 `afb41442…`). Oba měřily z čistého commitu `4a54b753`, provider `0.34.2-intentsmith.1`, shodný suite contract `3ebe5911e6d0e11b5587e39e30fedbfb3f6898c622ba015b24032f22773aeb85` a měly `decisionAuthority:false`.
- [Export pro samostatný replay](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/replay-input/manifest.json) obsahuje 42 odpovědí a sedm veřejných zadání. Interní `_task`, referenční patche a rubrikové `gradingInputs` jsou z veřejného vstupu vynechány. Soubor identit a klíč A/B jsou oddělené v neveřejné části evidence. [Technický replay](/mnt/vi7000/intentsmith/evidence/hunt-code-capture-20260925/technical-replay.json) má SHA-256 `e5b55ab2659e6672e3b9e0963840c3a8aaf82d2a4b0fa93b639ab56abc8b1b8e`; všech 42 položek má `assessment.score:null` a `decisionAuthority:false`.

První pokus o spuštění sidecaru skončil před inferencí na výchozí staré cestě modelového skladu; další pokus skončil před inferencí kvůli chybějícímu `--resume` po přípravě plánu. Oba běhy jsou zaznamenány ve stavovém adresáři wrapperu a **nevstoupily do 42 odpovědí**. Dokončené série použily skutečné `OLLAMA_MODELS=/mnt/vi7000/ollama/models` a `--resume`.

## Další přejímací hranice

1. Nezávisle rozsoudit významové kontroly CODE; správné alternativy a věcné opaky musí mít opačný výsledek. Do té doby z technické složky nevypočítávat celkové procento role.
2. Porovnat uložené odpovědi s přijatou rubrikou, bez přepsání syrových dat. Dílčí replay není náhradou C3 opravného postupu.
3. Na **nových oddělených provozních případech** provést párovou zkoušku celého opravného cyklu: zadání, pracovní test, případný další patch, závěrečný stav. Pak teprve ověřit, zda pořadí z krátké sady předpovídá provoz.

Tento balíček je podklad pro krok 3 lidského posouzení, ne GO huntu ani návrh změny současného CODE modelu.
