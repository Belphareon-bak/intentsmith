# H1 — předání a sběr dvou zmrazených kandidátů

**Aktualizace 8. 10. 2026: COLLECTION_NOT_RUN / C20 SOURCE_AND_CPU_REVIEW_PASS / FINAL_FREEZE_READY.**
Původní plaintext je odstraněn; vznikly pouze nové privátní parent adresáře pro
pozdější JIT dešifrování. Příprava C20 nečetla H1/H2, ciphertext ani H1 raw.
Operátor v této relaci určil jeden společný sběr: tři série na Qwen `c7f03d56`
a tři na Gemma `9591ea1b`, potom odstranit plaintext. Pokud sběr nezačne hned,
plaintext odstranit již nyní; rozhodnutí o mazání delegoval koordinátorovi.
Po sběru operátor sestaví zaslepený balík pro hodnotitele. D1 vývoj a ověření
již nemají pořadovou závislost na H1. Aktuální deník a vlastnictví jsou pouze
v [WORK-PROGRESS](../WORK-PROGRESS.md).

Tento aktualizovaný postup nahrazuje staré pokyny k jediné Gemmě a zveřejňování
rodin implementátorovi. Historická verze handoffu i veřejné pečeti zůstávají
v Git historii; kandidátní refs ani jejich soubory se nemění.

## Identita kampaně

| Kandidát | Přesný source SHA | CHAT tag a digest | D1 |
| --- | --- | --- | --- |
| Qwen | `c7f03d5687f65b1a2b50665f27b037e57b8516cd` | `qwen3.5:27b`, `7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e` | tentýž Qwen |
| Gemma | `9591ea1b07bc4b639a102bcc421f9d46b8f9906b` | `gemma4:26b`, `08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68` | pevný Qwen výše |

Refs: `review/chat-quality-holdout-candidate-20261002` a
`review/chat-quality-gemma-candidate-20261004-v2`. Pečeť je na
`review/chat-holdout-seal-20261002`, commit
`6a9d1dbe54adef4bb7cf2114afe10c58799a3a05`, veřejný soubor
`docs/review/2026-10-02-CHAT-HOLDOUT-SEAL.md`.

- Ciphertext: `/mnt/vi7000/intentsmith/evidence/chat-holdout-20261002/holdout.json.gpg`.
- Ciphertext SHA-256: `44c872c206abd2d618c35e24ee0bc2449e6f3f401fe59e6b6dc809b24dd26961`.
- Plaintext SHA-256: `2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff`.
- GPG AES256 je symetrické; heslo má podle pečeti pouze operátor a nedává jej agentovi.
- Veřejná struktura: 96 kroků, 60 CS /36 EN, 17 vícekrokových dialogů,
  14 schvalovaných akcí. Obsah není součástí tohoto předání.

Oba SHA jsou již zmrazené. Jde o srovnání dvou historických **kandidátů**,
ne o experiment, v němž se mění pouze model: runner a konfigurace se liší.
Produktový `src` strom je u obou shodný (`8dede3e2e2a20bcfacc77de67d6fed2265cf563d`),
stejně jako lockfile blob (`7fcc680ab0b7fa4e06c5f9423d67443653fe16d7`).
Qwen runner má slabší evidenci skutečného B kontextu; Gemma runner explicitně
připíná 4K a ověřuje kontext v transportu. Rozdíl se nesmí zakrýt změnou c7
runneru ani dodatečným přeznačením důkazů. Přímá A větev používá 4K u obou;
A je diagnostický protějšek s příchozí historií B, nikoli nezávislý dialog.

## Custody a hranice přístupu

7. 10. v 16:12:33 UTC byly oba soubory strojově hashovány proti pečeti,
bez parsování/zobrazení obsahu. Neběžel žádný `measure-m1-l3.js` proces.
Přesný původní `holdout.json` byl odstraněn; ciphertext zůstal zachovaný.
[Metadata receipt](evidence/chat-holdout-window-20261007/plaintext-removal.json).
Je to unlink, nikoli záruka fyzického vymazání. Neanuluje minulou expozici.

Implementátor i source reviewer nesmějí číst H1, `restricted/`, raw logy,
`initial-corpus.json`, `initial-results.json`, celé `runs.json`, provider trace,
DB nebo soubory soukromých H1 projektů. Žádné široké prohledávání těchto cest.
Runner smí corpus a odpovědi zpracovat strojově; do agentního kontextu smějí
jen níže uvedené agregáty. Veškerý stdout/stderr včetně výjimek je privátní:
ani `CHAT_PROBE` není veřejný, protože obsahuje case ID.

Runner zapisuje plaintext také do `initial-corpus.json`, `runs.json`, výsledků,
trace a soukromé DB. Odstranění vstupního souboru tedy **neodstraní obsah z raw
evidence**. Následný výslovný pokyn uživatele ke třem sériím obou frozen
kandidátů, odstranění vstupního plaintextu a vlastnímu sestavení zaslepeného
balíku již opravňuje privátní lokální předání raw tomuto operátorovi. Staré
custody PENDING ze 7. 10. je překonané; nový custody souhlas není podmínkou.
Nejde o autorizaci externího zveřejnění nebo jiných příjemců.
Evidence se nerediguje ani nemaže pod záminkou odstranění vstupu. Mode 0600
není technické oddělení od procesů se stejným UID; jde o řízený přístup.

## Historický readiness snímek 7. 10.

[Metadata a přesné příkazy/hashované logy](evidence/chat-holdout-window-20261007/readiness.json):
oba frozen runner kontrakty PASS na syntetickém vstupu, 0 model calls.
`npm ci` proběhlo na frozen lockfilu s vynecháním nepotřebného browser downloadu;
Node v24.21.0/native SQLite po instalaci PASS. CHAT byl při tomto měření čistý detached c7f03d56.
[Inventura prostředí](evidence/chat-holdout-window-20261007/environment.json):
oba správné modelové digesty, bwrap network namespace PASS, GPU compute 0,
Ollama models 0, lease chybí. Je to časový snímek, ne rezervace; před živým
startem se zopakuje. H1 nebyl použit ani inferován. Tehdejší zbývající custody
otázku již vyřešil následný pokyn výše; stále chybí JIT dešifrování a skutečný sběr.
Původní receipty ze 7. 10. zůstávají nezměněné a nejsou přeznačeny na dnešní měření.

## Aktuální jediná spouštěcí cesta C20

ROOT připravuje prostředí, freeze a provede všech šest sérií podle již udělené
autorizace. Operátor provede pouze JIT dešifrování do přesné cesty níže a později
sestaví zaslepený balík; heslo agentovi nedává. Není požadováno, aby uživatel
přebíral spouštění či testování. Žádná inference ani nový H1 sběr zatím neproběhly.

Soukromý packet je `.intentsmith-artifacts/c20-h1-window-preparation-20261008/`:

- `controller-v2.py` SHA `5088a161f942ed1465e908dfcb23ecb9f0950ed9ed733f560ff1ec2a8ee01c95`;
  `MANIFEST-v2.json` SHA `19e201a5c88dc4d8e4ee71f3f7bbb70feb19c4d2747654bc8c6ca492d27fab39`.
- Vlastní CPU-v5: **38 PASS / exit 0**, pouze syntetika a vlastní CPU procesy.
  Source/CPU review `71fb880cbe8bb1a9cfc663297420ce99b367ce433f1bef2afc526df4ebb5c636`,
  privacy/six-series review `6c7b4a19262ebd3e17e45bead5447a5e17d12271808bf5b289c7048f62bb6906`;
  oba jsou **PASS_NOT_LIVE_READY**. Historický V1 lineage nález a starý CPU fixture
  FAIL jsou zachované; nový subreaper guard ověřuje rodičovskou hranu před signálem.
- Final freeze candidate `freeze-candidate-v2/FREEZE-candidate.json` SHA
  `871fb7f563d48b231de3594a2bad7e71e4f21b094671fc11909dfcaa27436c6a`:
  5724 společných runtime/dependency refs, 1060 frozen runtime refs každého
  kandidáta a 15 symlink vazeb. Zahrnuje přímo používané M1/M2/M3 contracts,
  specialists a docs/mobile/contracts. Starý candidate d279…9c06 zůstává
  zachovaný; jeho omezený privacy READY není celkový READY nového freeze.
  Finální nezávislé **READY_TO_RUN** nového freeze je uzavřené:
  source/runtime closure `796e5e7525e05a7a42bd74f84c29f3491e46c9390704275c5ce9f58eef6bb356`,
  privacy/six-series `94be45212fa660a2e863c8eb34267b9092949126337f0e261104a7c30d3ae0a0`.
  Všech 170 installed package versions souhlasí s frozen lock. READY není
  GPU lease ani výsledek H1; plaintext je stále nepřítomný a sběr NOT_RUN.

Freeze připíná Node 24.21.0, Python, installed CHAT dependencies, oba historické
source SHA, daemon PID/startTicks/UID/argv/boot, exact model manifesty i worker
binary. Velké weight blobs nejsou znovu celé hashované: uvedená identita vychází
z exact manifest/digest a canonical artifact path/size/inode. Nejde o úplnou
OS/kernel/driver closure. Aktuální prázdný GPU snapshot není lease; controller
provádí nové admission a kontroly mezi sériemi. Agregátní GPU utilization pouze
zaznamenává, stejně jako původní runner. Před sérií se vyžaduje prázdné PS/compute;
při následném natural-expiry smí známý vlastní rezidentní model čekat nejvýše
600 s. Cizí/UNKNOWN stav či změna vlastníka znamenají okamžitý STOP, překročení
limitu také STOP. Žádné automatické load/unload/eviction operace nepřidává.

Přesný JIT descriptor je
`/mnt/vi7000/intentsmith/evidence/chat-holdout-window-20261008/input/holdout.json`,
SHA `2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff`,
mode 0600 a uid 1000, parent 0700. Budoucí inode se ve freeze nepředjímá;
controller až po JIT dešifrování strojově ověří pečeť a sváže aktuální identitu
regular souboru bez symlinků/hardlinků. Tu uloží do privátního runtime bindingu.
Změna identity znamená UNKNOWN/preserve/STOP, nikoli smazání náhrady.

ROOT po JIT dešifrování a uzavření souběžných ověřování otevře vlastní sériové
okno a použije jediný sterilní outer příkaz s již přijatým exact READY.
ROOT zachytí stdout/stderr do nových privátních exclusive logů; argumenty
příkazu zůstávají přesně následující:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B \
  /home/belphareon/Projects/intentsmith-real-chat-journeys-20260930/.intentsmith-artifacts/c20-h1-window-preparation-20261008/controller-v2.py --live \
  /home/belphareon/Projects/intentsmith-real-chat-journeys-20260930/.intentsmith-artifacts/c20-h1-window-preparation-20261008/freeze-candidate-v2/FREEZE-candidate.json \
  871fb7f563d48b231de3594a2bad7e71e4f21b094671fc11909dfcaa27436c6a \
  /home/belphareon/Projects/intentsmith-real-chat-journeys-20260930/.intentsmith-artifacts/c20-h1-window-preparation-20261008/independent-source-review/READY-R2.json \
  796e5e7525e05a7a42bd74f84c29f3491e46c9390704275c5ce9f58eef6bb356
```

Pořadí zůstává Qwen 1→2→3 a Gemma 1→2→3, A i B a původní approval oracle,
bez ladění či retry. Pevný provozní strop je 30 minut na sérii, 270 minut aktivní
kampaně a nejvýše jediných dalších 10 minut terminal natural-expiry cleanup
(+ TERM/KILL drain 3+3 s). Toto není změřená délka H1 ani garance šesti sérií.
Po každé sérii přirozená expirace čeká nejvýše 10 minut pod vlastní lease;
vyžadují se tři prázdné PS/compute vzorky a dostatečná VRAM/RAM/disk.

Vnější Linux subreaper uzavírá vlastní potomky včetně double-fork/new-session;
čistý drain dokládá kernelové ECHILD, nikoli jen vzorkovaný seznam PID. Teprve
po prokázaném drain se v terminal finally odstraní přesný svázaný plaintext
při preflight FAIL, STOP, SIGINT/SIGTERM nebo neúplné sérii, pokud již předtím
úspěšně proběhlo strojové bind_plaintext. Odmítnutí v main nebo před bindingem
nemá prokázanou identitu a unlink neslibuje. Cizí/nově
nahrazené soubory ani procesy se nemažou/nezabíjí. Pád hostitele či SIGKILL nemají
finally záruku; recovery zachová UNKNOWN do ověření identity a drain. Raw zůstává
privátní pro operátora. Safe output obsahuje jen allowlist stavů, počtů a identit;
žádné case IDs, chyby či texty odpovědí. COLLECTION_COMPLETE_UNASSESSED není skóre.

## Historický manuální postup 7. 10. — nespouštět

Následující původní příkazy a ruční kroky jsou zachovány pro audit. Nejsou druhou
aktuální launch cestou; nahrazuje je výše uvedený přijatý C20 outer controller.

Pořadí před sběrem: Qwen 1→2→3, poté Gemma 1→2→3. Žádné hodnocení ani ladění
mezi sériemi/kandidáty. Každý má nový vlastní record; dummy a známá regrese
se do nich nekopírují. Před každým startem se ověří přesný čistý HEAD,
runner/helper hash, Node 24.21.0 a modelové digesty. Mezi sériemi kandidáta
musí být stejný configuration fingerprint, provider verze, corpus a zdroj.

Sběr používá existující CHAT checkout, pouze sériové detached přepnutí na
pevné SHA; ROOT zůstává vývojovou integrací. Nezakládá se nový worktree.
Před přepnutím: žádný dirty strom ani jiný aktivní uživatel checkoutu. Instalované
závislosti musejí odpovídat kandidátnímu lockfilu; oba kandidáti mají shodný
lockfile. Soukromý output root vznikne nový, 0700, `umask 077`; před redirecty
vytvořit také jeho `qwen/` a `gemma/` podadresáře. Po sběru lze obnovit
původní CHAT větev jen bez přepsání dirtu a s obnovou jejího novějšího lockfilu.

Okno vlastní ROOT koordinátor; začátek/konec se zapíší podle skutečného běhu.
Po celou dobu žádný Hunt, fresh5, Studio inference ani reviewerův GPU retest.
Přesnou délku předem neprohlašujeme za změřenou. Recenzent dostane po čistém
ukončení oddělené okno na rozhodující veřejné kontroly; H1 se pro něj znovu
nespouští. Nyní okno **není otevřené**.

Runner si v každé sérii sám pořizuje `/tmp/intentsmith-gpu-evaluation.lock`;
vnější stejný lease by jej zablokoval. Rezervace okna přesahuje jednotlivé
lease, není nepřerušený mutex. Před každou sérií vyžadovat prázdné `/api/ps`,
prázdné NVIDIA compute, dostupnou VRAM a žádný cizí lease. Po skončení runner
model nevyklízí. Na doloženou přirozenou expiraci čekat nejvýše 10 minut (bez čtení raw);
po vypršení limitu STOP, nikoli předpoklad, že je volno. Případný explicitní
unload musí pod novým shared lease prokazatelně patřit právě ukončenému běhu.
Cizí/UNKNOWN model, claimant nebo proces = STOP, nikdy automatická evikce.

### Historické jednotlivé příkazy

Neprovádět tento blok jako slepou smyčku: každá další série je podmíněna
uzavřením předchozí a čistým GPU. `CHAT_HOLDOUT_FILE` je přesná operátorem
znovu dešifrovaná cesta; nevypisuje se její obsah. `CHAT_WINDOW_ROOT` je nový
absolutní adresář pod `.intentsmith-artifacts/chat-holdout-window-20261007/`.
Zděděné `CHAT_PROBE_*`, `NODE_OPTIONS`, modelové bindingy a dotenv se do outer
runneru nepřenášejí; child si vytváří vlastní HOME/DB/config/project.

```bash
# CWD: /home/belphareon/Projects/intentsmith-chat-quality-20261001
umask 077
set -o noclobber  # existující privátní log = STOP ještě před spuštěním runneru
git switch --detach c7f03d5687f65b1a2b50665f27b037e57b8516cd
# Každý z --phase holdout-1, holdout-2, holdout-3 samostatně:
env -i PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin \
  LANG=C.UTF-8 TZ=Europe/Prague CHAT_PROBE_NO_DIRECT=false \
  node scripts/measure-m1-l3.js --live --phase holdout-1 \
  --holdout "$CHAT_HOLDOUT_FILE" \
  --holdout-sha256 2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff \
  --model qwen3.5:27b \
  --model-digest 7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e \
  --record "$CHAT_WINDOW_ROOT/qwen/runs.json" \
  >"$CHAT_WINDOW_ROOT/qwen/holdout-1.private.log" 2>&1

# Až po všech třech uzavřených Qwen sériích a čistém GPU:
git switch --detach 9591ea1b07bc4b639a102bcc421f9d46b8f9906b
# Znovu každá --phase holdout-1, holdout-2, holdout-3 samostatně:
env -i PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin \
  LANG=C.UTF-8 TZ=Europe/Prague CHAT_PROBE_NO_DIRECT=false \
  node scripts/measure-m1-l3.js --live --phase holdout-1 \
  --holdout "$CHAT_HOLDOUT_FILE" \
  --holdout-sha256 2431296e7a1583329fb4185a1dbbe6610749985385cd1afa2c6952428b63e9ff \
  --model gemma4:26b \
  --model-digest 08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68 \
  --record "$CHAT_WINDOW_ROOT/gemma/runs.json" \
  >"$CHAT_WINDOW_ROOT/gemma/holdout-1.private.log" 2>&1
```

Každá série očekává **exit 0** a `LIVE_COMPLETE_UNASSESSED`. Privátní log
má vždy číslo dané fáze; `noclobber` brání zkrácení existujícího souboru
při opětovném spuštění. Nepoužívat `>|`, neobcházet chybu redirectu. Každý
případný samostatně schválený technický pokus má nový log/adresář; při
opakování se nic nepřepisuje. Procesy se sledují
pouze pomocí vlastního PID/stavu a agregovaných metadat; nikdy přes tail raw logu.
Při nenulovém exitu, driftu, neúplném transportu nebo přerušení se šestiběhová
kampaň zastaví, zachová všechny pokusy a označí `INCOMPLETE`. Žádný automatický
retry ani změna SHA/modelu/korpusu. Technické pokračování vyžaduje nezávislou
revizi metadat; dokončené fáze se neopakují a výsledky se k volbě nepoužijí.

Povolená projekce metadat: pořadí/fáze, pevný SHA/model/digest, počet běhů,
runner/helper/corpus SHA-256, konfigurace fingerprint, node/provider verze,
číselný exit, boolean transportComplete, exactWire, invalidInferenceCallCount (0),
expectedCases/recordedCases (96/96),
počet A/B transportů, čas, GPU/lease identita. Žádná chybová zpráva nebo jiný
volný řetězec z odpovědi; žádné case ID, case objekt, názvy rodin, souborů ani
obsah wire. Hodnoty identity se porovnají s tímto pinem před jejich zveřejněním.
Dokončení vyžaduje oba exity 0, transportComplete/exactWire true, 96/96,
invalidInferenceCallCount 0 a shodnou identitu/fingerprint uvnitř trojice.
Gemma navíc contextBudgetValid/artifactSetValid true a stejné postflightArtifacts.
Záznam `LIVE_COMPLETE_UNASSESSED` dokládá sběr, nikoli modelovou kvalitu.
Při SIGINT/SIGTERM nelze spoléhat na runner finally: vlastní PID/child/provider
musejí být samostatně uzavřeny a cizí procesy ponechány. Runner neumí navázat
uprostřed H1 fáze; přerušená fáze se nesmí tiše restartovat.

Povinný cleanup platí při **každém uzavření okna**, nejen po úspěchu:
preflight FAIL, STOP, SIGINT/SIGTERM, neúplný běh i odložení po dešifrování.
Koordinátor nejdříve ověří uzavření vlastních procesů/drain (cizích se nedotýká),
poté odstraní přesný vstupní plaintext ověřený při dešifrování a ověří absenci.
Před unlinkem znovu kontroluje regular-file/nesymlink, SHA a device/inode;
při změně identity nemaže neznámý soubor a eskaluje konkrétní rozpor správci.
Potvrzení cleanupu obsahuje jen metadata; raw evidence zůstane zachována dle
již udělené autorizace privátního lokálního předání operátorovi. Nové okno znovu vyžaduje dešifrování těsně před startem.
Po pádu koordinátora je tento cleanup první recovery krok; nelze jej připsat
runneru, který nemá garantovaný signal handler.

## Předání, přejímka a další vývoj

Po šesti dokončených sériích: ověřit neměnnost zdroje/digestů, ukončení vlastních
procesů, čisté GPU a uvolněné lease; hashovat raw balík bez čtení do kontextu.
Odstranit přesný znovu dešifrovaný vstup; ciphertext a raw důkazy předat dle
již udělené autorizace privátního lokálního předání operátorovi. Odpovědi i celý manifest zůstanou soukromé; veřejná
část má jen ověřené agregáty, cesty a SHA-256. Operátor vytvoří zaslepené X/Y,
klíč odděleně; dva nezávislí hodnotitelé nevycházejí z vlastních známek autora.

Implementátor dostane až uzavřený **celkový verdikt pro každý kandidát**,
nikoli průběžné skóre, rodiny nebo příklady. Prahy ≥95 % užitečných,
≤5 % zbytečných zastavení, 0 kritických chyb a tři nezměněné série jsou
zachované; známých 53 případů je nutná regrese, H1 samostatná přejímka.
H1 se po této jediné kampani považuje za spotřebovaný a může být regresním
korpusem. Finální přejímka nově opraveného produktu vyžaduje nový nezávislý H2,
předem zapečetěný s rubrikou; opakovaný H1 nesmí být vydáván za novou přejímku.

Příprava H1 nemění produkční CHAT/D1 bindingy, nenasazuje release a neuděluje
přejímku HTTP, Fan, fresh5 ani Studio D1. Další vývoj na ROOT nemusí čekat na
hodnocení a nemění pevné zdroje této kampaně.
