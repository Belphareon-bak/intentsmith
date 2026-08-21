# Sada `code_patch` — evaluace CODE spuštěným testem

**Kontext:** [`EVAL-REDESIGN.md`](EVAL-REDESIGN.md) (proč se evaluace přestavuje) ·
[`MODEL-PLATFORM-HANDOFF.md`](MODEL-PLATFORM-HANDOFF.md) (stav platformy)

---

## 1. Co sada měří

Vezme skutečnou opravu z historie tohohle repa, vrátí zdroják do stavu před ní a
nechá model vadu opravit. Odpověď se vloží zpátky do souboru a spustí se
**skrytý test**.

```
zdroják PŘED opravou + popis vady  →  model vrátí opravené funkce
funkce se vloží zpátky do souboru  →  spustí se skrytý test v izolaci
                                       skóre = kolik cílových testů spravil
```

Proti staré sadě `code`, kde o skóre rozhodovala klíčová slova: `llava:13b` —
vision model — v ní dostal 100 %, a nefunkční `isPrime` dostal 1.0 za to, že
obsahoval `return` a cyklus. Tady o skóre rozhoduje `node tests/….test.js`.

## 2. Jak se pozná, co má oprava spravit

Cílové testy se **neodvozují z textu commitu, ale ze spuštění** — stejný princip
jako `FAIL_TO_PASS` a `PASS_TO_PASS` v SWE-benchi:

| sada | jak vznikne | k čemu je |
|---|---|---|
| `fail→pass` | padá na vadném kódu, projde s gold patchem | **zadání** — co má oprava spravit |
| `pass→pass` | projde v obou stavech | **hlídač** — co oprava nesmí rozbít |

```
skóre = spravené testy z fail→pass / velikost fail→pass
      = 0, když padne cokoli z pass→pass
```

Odvozovat cíle z diffu commitu se ukázalo jako křehké ve dvou směrech naráz:
commit testy nemusí přidávat, jen upravit (`06d49847`, `286a9117` — nula
přidaných názvů), a naopak může přidat test, který **procházel i předtím**
(`d8a2aa05` — jeden ze tří). Odvození spuštěním obojí řeší samo a nedá se
rozhodit přejmenováním testu.

Vedlejší, ale podstatný důsledek: **všechny úlohy mají podlahu nula.** Test,
který procházel před opravou, není cílový, takže model, který neudělá nic,
dostane 0,00 na každé úloze. Skóre jsou tím mezi úlohami srovnatelná a jejich
průměr přes sadu má význam.

Když testovací soubor protokol po jednotlivých testech netiskne (prostý skript,
který jen skončí nenulovým kódem), hodnotí se binárně celý soubor — hrubší, ale
pořád objektivní.

## 3. Jak vzniká sada úloh

```bash
node src/eval/build-code-suite.js --max-function-lines 250 --max-diff-lines 100
```

Síta, kterými musí commit projít:

1. mění **jeden** zdroják a **jeden** test — jinak není jednoznačné, co opravit
2. změněné řádky leží **uvnitř funkcí** — zadáním jsou funkce, ne celý soubor
3. dotčené funkce se vejdou do limitu řádků — delší se generují minuty
4. **test padá před opravou a prochází s gold patchem**, ve stejné izolaci,
   v jaké pak poběží odpověď modelu
5. aspoň jeden test se opravou překlopí z pádu do průchodu

Páté síto je to podstatné: co jím projde, je zaručeně řešitelné a měřitelné.
Vyřadilo například `2c5f1756`, jehož gold patch neprojde vlastním testem.

### Proč je jednotkou funkce, a ne soubor

Zdrojáky úloh mají 249 až 3531 řádků. Celý soubor o 3531 řádcích by byl řádově
dvacet tisíc tokenů na výstupu — mimo `num_ctx` i mimo rozumný čas generování.

Nezávisle na tom vyšel stejně i kontrolní bod (3 úlohy, `qwen3-coder`,
2026-08-20): **3× ze 3** přišel přesně jeden blok ` ```javascript ` s celou
funkcí od hlavičky po uzavírací závorku, s původním odsazením a bez
vysvětlování. Ani jednou unified diff. **Parser diffů se proto nepíše.**

Změna smí zasáhnout několik funkcí. Zadání je očísluje a chce zpátky tolik
bloků, kolik jich poslalo; náhrady jdou od konce souboru, aby zůstala platná
čísla řádků. Když model pošle bloků víc, přiřadí se podle jména funkce; když
míň, úloha propadá — hádat, co model myslel, by měření zkreslilo.

## 4. Anti-cheat

| pravidlo | jak je splněné |
|---|---|
| hodnoticí logika neobsahuje termíny z promptu | hodnotí se spuštěním testu, ne porovnáváním textu |
| skryté testy | model vidí vadné funkce a **popis požadovaného chování**, ne tělo testu, fixtury ani aserce |
| bez úniku řešení | gold patch se do promptu nedostane; hlídá test `zadání neukazuje test ani gold patch` |

### Kde přesně vede hranice

Zadání obsahuje předmět commitu a názvy testů, které k opravě vznikly — tedy
popis toho, **co má platit**. Bez něj skončila první sonda 0/3, a ne kvůli
neschopnosti modelu: u `da03e8bd` zní předmět „preserve verification abort
boundary", kdežto skrytý test vyžaduje, aby se `clearTimeout` zavolalo *před*
parsováním těla odpovědi. To se z předmětu uhodnout nedá a úloha by měřila čtení
myšlenek, ne programování.

Model se tedy dozví požadavek, ne způsob ověření. Skórování běží na skutečném
spuštění, takže v hodnoticí logice žádný termín z promptu není.

## 5. Izolace

Spouští se kód, který napsal model:

- odhozený `git worktree`, nikdy pracovní strom
- podproces s timeoutem
- **síťový namespace** `unshare -rn` s nahozeným `lo` — loopback funguje
  (některé testy ho potřebují), ven se model nedostane (ověřeno: `EAI_AGAIN`)

## 6. Odkud se berou úlohy a kolik jich je

Z 805 commitů historie:

| síto | zbývá |
|---|---|
| commit mění jeden zdroják a jeden test, diff ≤ 100 ř. | 29 |
| změněné řádky leží uvnitř funkcí | 11 |
| dotčené funkce ≤ 250 řádků | 8 |
| test padá před opravou, prochází s gold patchem | **7** |

Zásoba je úzká a hlavní ztráta je jasně pojmenovatelná: **18 z 29 kandidátů
mění řádky mimo funkce** — import nahoře, konstanta na nejvyšší úrovni. Ty se
jako „přepiš tyhle funkce" zadat nedají.

Fixture [`src/eval/code-suite-tasks.json`](../src/eval/code-suite-tasks.json)
drží jen metadata a cílové sady; zdrojový kód se nekopíruje, `deriveTask()` si
ho vytáhne přes `git show`.

| úloha | režim | cílových | hlídaných | funkcí |
|---|---|---|---|---|
| `d8a2aa05` | named | 2 | 16 | 1 |
| `cfcb63dd` | named | 2 | 85 | 1 |
| `da03e8bd` | named | 1 | 33 | 1 |
| `723d5726` | named | 1 | 32 | 1 |
| `a33cc20a` | named | 3 | 18 | 1 |
| `286a9117` | failures-only | 4 | 23 | 1 |
| `06d49847` | file | — | — | 2 |

## 7. Co sada měří na panelu modelů

Měřeno 2026-08-21 na pěti modelech, 3 opakování, 7 úloh — 105 běhů, 47,1 min.
Surový výstup:
[`execution/runs/code-patch-panel-20260821.md`](execution/runs/code-patch-panel-20260821.md).

| úloha | qwen2.5-coder:32b | qwen3-coder | qwen2.5:32b | qwen3.5:27b | qwen3:14b | šum | zařazení |
|---|---|---|---|---|---|---|---|
| `da03e8bd` | **1,00** | 0,00 | 0,00 | **1,00** | 0,00 | 0,00 | rozlišuje |
| `a33cc20a` | **0,33** | **0,33** | **0,33** | 0,00 | 0,00 | 0,00 | rozlišuje |
| `d8a2aa05` | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | podlaha |
| `cfcb63dd` | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | podlaha |
| `723d5726` | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | podlaha |
| `286a9117` | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | podlaha |
| `06d49847` | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | podlaha |
| **průměr** | **0,19** | 0,05 | 0,05 | 0,14 | 0,00 | | |

**Pořadí:** `qwen2.5-coder:32b` 0,190 · `qwen3.5:27b` 0,143 · `qwen3-coder`
0,048 · `qwen2.5:32b` 0,048 · `qwen3:14b` 0,000.

### Co z toho platí

**Šum je nulový.** 105 běhů, žádná úloha nezměnila skóre mezi opakováními. Proti
staré sadě `reasoning`, kde skóre kolísalo 63 → 63 → 75 %, je rozdíl mezi modely
tvrdý údaj, ne přeskok.

**Sada rozlišuje, ale informaci nesou 2 úlohy ze 7.** Pět je na podlaze — jsou
nad síly celého panelu. Sada odliší čtyři z pěti modelů; `qwen3-coder` proti
`qwen2.5:32b` skončilo nerozhodně (0/7 úloh).

**Odstupňování funguje tam, kde je cílů víc.** `a33cc20a` má tři cílové testy a
tři modely na ní dostaly 0,33 — bez odstupňování by tam byla pětkrát nula a
úloha by nerozlišila nic. Úloha s **jediným** cílovým testem umí dát jen 0, nebo
1; `da03e8bd`, `723d5726` a `06d49847` proto žádnou mezipolohu nabídnout
nemůžou. **Při dalším rozšiřování zásoby je tohle hlavní vodítko: preferovat
commity, které přidávají víc testů.**

### Kalibrace: aktivní sada a rezervy

```bash
node src/eval/discrimination-report.js <modely…> --json /tmp/panel.json
node src/eval/calibrate-code-suite.js /tmp/panel.json
```

Kalibrace zapíše každé úloze `status` a běžné měření pak jede jen přes `active`:

| status | úloh | proč |
|---|---|---|
| `active` | 2 | modely se na ní liší → nese informaci |
| `reserve-floor` | 5 | nevyřešil ji nikdo → **rezerva** pro silnější modely |

Rezervy se **nemažou**. Úloha, kterou dnes nevyřeší nikdo, je přesně to, čím
půjde zítra odlišit lepší model od dnešního nejlepšího; vyhodit ji znamená
připravit sadu o strop. `C3_EVAL_INCLUDE_RESERVE=1` je vrátí do běhu — na
ověření, jestli už silnější model podlahu nepřerostl.

Kalibrace je vázaná na panel, na kterém proběhla; do fixture se proto zapisuje
i seznam modelů a datum. Se změnou panelu je potřeba ji zopakovat.

**Co to znamená pro cíl „každá úloha v sadě rozlišuje":** splněno konstrukcí —
v aktivní sadě jsou jen rozlišující úlohy. Že jsou dvě, a ne šest, je věc
velikosti zásoby, ne návrhu měření.

## 8. Známá omezení

**Zásoba je malá** — sedm úloh. Další růst vyžaduje umět zadat i změnu mimo
funkce, nebo povolit víc zdrojáků a víc testových souborů na commit.

**Jedna úloha se hodnotí binárně.** `06d49847` shodí na vadném kódu celý běh
(`TypeError: req.on is not a function`) dřív, než se protokol dotiskne, takže se
nedá zjistit, co přesně se překlopilo. Úloha je platná — soubor padá před
opravou a prochází s gold patchem — jen je hrubší než ostatní.

**Panel je z lokálních modelů.** Výběr úloh podle toho, co panel rozliší, se
může přeučit na dnešní sestavu. Proto se měří na pěti modelech, ne na dvou, a
proto se nic nemaže.

**Úloha s jediným cílovým testem nemá mezipolohu.** Skóre je podíl spravených
cílových testů, takže při jednom cíli vychází jen 0, nebo 1. Zásobu je proto
lepší rozšiřovat o commity, které přidávají víc testů najednou.

## 9. Pasti, které to stálo

**`git worktree add` nevytvoří `node_modules`.** Každý test pak spadne na
`ERR_MODULE_NOT_FOUND` a vypadá to jako nespolehlivé orákulum. Řeší symlink.

**`git checkout <ref> -- <cesta>` mění index hlavního repa**, i při zápisu do
jiného `--work-tree`. Používá se `git show <ref>:<cesta>` a ruční zápis; hlídá
to test `index zdrojového repa zůstane nedotčený`.

**Testy nehlásí výsledky jednotně.** `tests/harness.js` tiskne `✅ název` i
`❌ název: chyba`, kdežto `tests/routes-smoke.test.js` tiskne **jen** `FAIL:
název` a úspěch mlčí. Parser, který zná jen první styl, prohlásí dvě platné
úlohy za mrtvé — u mlčícího stylu je oprava poznat po *zmizelém pádu*, ne po
*přibylém průchodu*.

**Ztráta čárky za uzavírací závorkou.** U vlastnosti objektu končí funkce `},`;
když se zbytek řádku zahodí, soubor přestane být platný. Rozsah veze `tail`.

**Výchozích 30 s na volání modelu nestačí** — studené načtení a 2000 tokenů
odpovědi trvalo 122 s. Sada si žádá vlastní `options`.

**V repu není použitelný JS parser.** `@babel/parser` chybí, `esprima` neumí
`?.`, `tree-sitter` vrací `Invalid argument` a nula symbolů. Proto vlastní
scanner závorek, ověřený round-tripem gold patche.

**Commit, který soubor zakládá, není oprava** — nemá stav „před".

**`validation-suites.js` je bajtově připnutý.** Vedle `model-profiles.js` ho
`model-failover-proof-policy.js` pinuje přes `sha256-raw-bytes-v1` a navíc
kontroluje, že `Object.keys(SUITES)` přesně odpovídá pěti očekávaným sadám.
Přidání jediného řádku do toho souboru shodí policy na
`MODEL_FAILOVER_PROOF_POLICY_SOURCE_DRIFT`, zápis šesté sady do registru — i
zvenčí — na `AUTHORITY_INVALID`. Obojí bylo změřené, ne odhadnuté.

`code_patch` proto do registru **nepatří** a do souboje se předává explicitně:

```js
comparePair(runner, 'code_patch', kandidat, stavajici, { suite: codePatchSuite })
```

Vlastní parametry volání modelu nese `CodePatchValidationRunner`, potomek
`ValidationRunner`. Bez nich by platily výchozí `num_ctx` 4096, `num_predict`
512 a timeout 30 s — vadná funkce se do toho nevejde a uříznuté generování by
se počítalo jako selhání modelu. Hlídají to testy
`připnutý validation-suites.js zůstává nedotčený` a
`sada se do registru SUITES nezapisuje`.

## 10. Soubory a příkazy

| soubor | co dělá |
|---|---|
| `src/eval/code-task-extractor.js` | najde v historii kandidáty |
| `src/eval/function-span.js` | rozsahy funkcí kolem změněných řádků |
| `src/eval/code-patch-runner.js` | prompt → aplikace → spuštění testu → skóre |
| `src/eval/code-patch-suite.js` | sada ve tvaru pro `ValidationRunner` |
| `src/eval/build-code-suite.js` | kurátorská stavba fixture |
| `src/eval/discrimination-report.js` | co která úloha měří |
| `src/eval/calibrate-code-suite.js` | rozdělí úlohy na aktivní a rezervní |

```bash
# přestavět sadu úloh z historie (~10 min)
node src/eval/build-code-suite.js --max-function-lines 250 --max-diff-lines 100

# co sada měří na panelu modelů (5 modelů ≈ 47 min)
node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest \
  qwen2.5:32b qwen3.5:27b qwen3:14b --json /tmp/panel.json

# rozdělit úlohy na aktivní a rezervní podle naměřeného
node src/eval/calibrate-code-suite.js /tmp/panel.json

# testy
node tests/function-span.test.js && node tests/code-patch-runner.test.js
```

Testy: `function-span` 13, `code-patch-runner` 43, `code-patch-suite` 10,
`code-task-extractor` 12.

## 11. Jak se návrh vyvíjel

Zaznamenáno, protože každý krok stál měření a bylo by škoda ho zopakovat.

**Binární hodnocení celého souboru** (první verze). Testovací soubor má desítky
testů, ale opravy se týkají jednotek — u `da03e8bd` je to 1 test z 34. Model,
který zvládl část, dostal stejnou nulu jako model, který neudělal nic.

**Cíle podle názvů testů přidaných commitem** (druhá verze). Křehké v obou
směrech: commit testy nemusí přidávat, jen upravit, a naopak může přidat test,
který procházel i předtím — `d8a2aa05` tak měl „podlahu" 0,33 a skóre úloh
přestala být srovnatelná.

**Cíle odvozené spuštěním** (současný stav). Podlaha je z definice nula, protože
test procházející před opravou není cílový. Nedá se rozhodit přejmenováním a
funguje i tam, kde commit testy vůbec nepřidal.

**Vada, kterou odhalilo až měření.** V mlčícím režimu se oprava pozná po
zmizelém řádku `FAIL:` — jenže ten zmizí i tehdy, když běh spadne dřív, než se
k testu dostane. Částečný pád (`TypeError` po pár vytištěných řádcích) tak
dostával **plné skóre** a úloha `286a9117` skákala mezi 0 a 1 mezi opakováními.
Mlčící režim proto vyžaduje doklad, že běh doběhl — závěrečný souhrn. Po opravě
spadla ta úloha na nulu na všech pěti modelech: ta jednička byla havárie, ne
oprava.

Poučení do dalších sad: **nestabilní úloha není slabá úloha, ale podezření na
vadu měření.** Proto má v reportu vlastní kategorii a neschovává se pod
„shodné".
