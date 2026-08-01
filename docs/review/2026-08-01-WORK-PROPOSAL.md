# Návrh paralelní práce

**Datum:** 2026-08-01
**Vztaženo k:** `17a8b9a8` (`codex/s1-legacy-loopback-containment`)
**Status:** návrh k rozhodnutí operátora; **nic z toho není rozpracované**

---

## 1. Mantinely, které tenhle návrh respektuje

| Pravidlo | Zdroj | Co z něj plyne |
|---|---|---|
| Jediný zapisovatel větví je GPT-5.6-sol v Codexu | `AGENTS.md` § Development rules | Nic níže se nezapíše na `codex/*` bez rozhodnutí operátora. Návrhy jsou buď handoff, nebo práce na oddělené větvi |
| Jakákoli změna stromu ruší kandidáta | `GATE-CRITERIA.md` § Scope of a verdict | Každá položka níže má uvedenou cenu v re-attestation |
| Žádná fáze se neotevírá, dokud předchozí gate nedrží | `ROADMAP.md` § Základní pravidlo | Gate 0 drží, takže Gate 1 je legitimně otevřený. Gate 2 není |
| `GAP-2` — bez prokázané hranice žádný bind mimo loopback | `PLAN.md` §8.1 | Nic mobilního se nesmí implementovat, ani prototypově |
| C3 je trunk, OpenCode/Serena až 1.1 | `AGENTS.md` § Product and scope | Integrace donorových komponent nesmí být zadními vrátky pro OpenCode |

---

## 2. Strukturální problém, který stojí před Gate 1

Tohle je podle mě nejdůležitější věc v celém dokumentu.

Gate 0 má 335 řádků normativních kritérií, devět clausulí, definici verdiktu,
schéma důkazu, C→E→R→A řetěz a post-commit validátor. **Gate 1 nemá vlastní
sekci kritérií vůbec** — existuje jeden řádek v tabulce „Later gates", jedna
věta v `CAPABILITY-MATRIX.md` a několik roztroušených zmínek u konkrétních
rizik. Ta jedna věta zní:

> Every suite referenced by Gate 1 acceptance requires a registered execution
> with non-empty `lastGreen.commit` equal to the candidate and a bound artifact.

Z toho plyne aritmetický problém. Kandidát je jeden commit. Akceptační důkaz
musí mít `lastGreen.commit` **rovný kandidátovi**. Jenže zápis důkazu pro
schopnost č. 1 změní strom → vznikne nový kandidát → důkaz pro schopnost č. 1
už neukazuje na kandidáta. Zápis č. 2 to udělá znovu.

Naivní čtení tedy vede k tomu, že buď platí vždycky jen poslední důkaz, nebo
se všech 30 musí zapsat v jednom commitu — což je přesně to hromadné povyšování,
které `CAPABILITY-MATRIX.md` zakazuje.

**To se musí vyřešit dřív, než vznikne první důkaz.** Jinak se buď 30× přepíše
práce, nebo se pravidlo tiše ohne — a ohnuté pravidlo o důkazech je přesně ta
třída problému, kvůli které Gate 0 vznikl.

Možná řešení (rozhodnutí operátora, ne moje):

| Varianta | Jak funguje | Cena |
|---|---|---|
| **Řetěz kandidátů** | Každá schopnost dostane vlastní `C→E→R→A`, důkaz platí ke svému SHA, matice drží ukazatel na SHA místo na „aktuální kandidát" | 30× attestation běh; nejpřísnější |
| **Kotva na obsah** | Důkaz se neváže na commit, ale na fingerprint podmnožiny stromu, které se dotýká (zdroj + testy dané schopnosti) | Návrh fingerprintu je netriviální; zato důkaz přežije nesouvisející změnu |
| **Dávky** | Kandidát se zmrazí, zapíše se N důkazů, pak jeden attestation pro celou dávku | Levné, ale rozostřuje „po jednom" — nutno pohlídat, aby dávka nebyla alibi |

---

## 3. Návrhy, seřazené podle (hodnota × bezpečnost)

### `P-1` — napsat kritéria Gate 1 · **doporučuji jako první**

**Co:** normativní dokument v úrovni detailu, jakou má `GATE-CRITERIA.md` pro
Gate 0 — co znamená akceptační důkaz jedné schopnosti, jaké má schéma, kdo ho
generuje, jak se váže ke kandidátovi (§2 výše), co je PASS/PARTIAL/FAIL na
úrovni řádku matice, a co se stane se zbylými 29 řádky, když se jeden posune.

**Proč první:** je to jediná položka, která **blokuje všech 30 zbývajících**.
Bez ní je první akceptační důkaz hádání a druhý ho bude muset předělat.

**Kolize s S-trackem:** žádná. Čistě dokumentační práce v `docs/convergence/`,
S-track je v `src/` a `tests/`.

**Cena:** jedna re-attestation. Odhad 1–2 dny.

**Můj vklad:** vysoký. Přečetl jsem celý Gate 0 aparát včetně validátorů a mám
čerstvý kontext na to, co v něm funguje (fail-closed, generovaná evidence,
odvozený verdikt) a co je drahé (devítifázový producer na jeden řádek matice).

---

### `P-2` — uzavřít `EX-1` (kolize `G0-R021`) · **rychlá výhra**

**Co:** přejmenovat mobilní `G0-R021` → `G0-R032`, doplnit entry do
`GATE0-RISK-IMPACT.json` s `LATER_GATE` a podmínkou, a přenést důkazní část
RCE nálezu (`EX-2`) na trunk.

**Proč:** dnes je merge mobilní větve tichá bomba pod `G0-C9`. Oprava je
mechanická a hotová za hodinu. Zároveň se tím implementátorovi `S-3` dostane
na oči, že `validateApiToken()` je hotová funkce, které chybí jen middleware —
to je největší jednotlivá úspora v celém `S-3`.

**Kolize:** nízká. Mobilní větev je od 2026-07-30 v klidu. Zásah je do dvou
souborů, oba v `docs/convergence/`.

**Cena:** jedna re-attestation, přibalitelná k `P-1`. Odhad 1–2 hodiny.

**Můj vklad:** vysoký. Nález je můj, návrh entry je hotový a napsaný
v [STATE-AND-VERIFICATION](2026-08-01-STATE-AND-VERIFICATION.md) `EX-1`.

---

### `P-3` — první akceptační důkaz pro jednu schopnost · **až po `P-1`**

**Co:** vzít **jeden** řádek matice a projít ho celý až do zelené, jako šablonu
pro zbylých 29.

**Který řádek:** doporučuji **`C3-024` — SQLite repositories and migrations**.

Odůvodnění výběru:
- je `BASELINE_RED`, tedy má co dokazovat, ale ne od nuly;
- je maximálně vzdálený od `S-1`..`S-4` (ty jsou o listenerech a originech),
  takže kolize je minimální;
- migrace a repozitáře jsou deterministické a `database` profil je uvnitř
  `G0-C5` scope, takže důkaz nepotřebuje GPU, Ollama ani vlastněný server —
  na rozdíl od `C3-023`, `C3-001` a většiny ostatních;
- data integrity je v `AGENTS.md` na druhém místě v pořadí autority hned za
  explicitním rozhodnutím uživatele.

**Kterému se naopak vyhnout:** `C3-023` (API/WS bridge) — to je přesně území
`S-trackem`. `C3-001` (Studio/Theia) — je zablokovaný `G0-R030` a navíc
vyžaduje reálný build Electron artefaktu s digest bindingem.

**Kolize:** nízká, při volbě `C3-024`.

**Cena:** podle rozhodnutí z §2. Odhad 3–5 dní včetně zavedení šablony.

---

### `P-4` — oprava `G0-R030` (lifecycle v render fázi) · **odblokuje `C3-001`**

**Co:** riziko samo popisuje rozsah přesně — přesunout health scheduling mimo
render, zastavit center timer při disposal, odstranit mutace cache z render
cest, zafixovat kadenci requestů a teardown, bez změny chování galerie.

**Proč:** `C3-001` (Studio/Theia) je vlajková schopnost a `G0-R030` je jmenovitě
uvedený jako to, co jí brání projít Gate 1.

**Kolize:** **střední — tady bych byl opatrný.** Na `s1` větvi jsou čerstvé
commity `security: authorize legacy media object URLs` a `fix(media): bound
failed object URL retries`. Ta oblast se aktivně hýbe. Bez potvrzení od
vlastníka větve, že media vrstvu pustil, by to znamenalo dvě ruce v jednom
souboru.

**Cena:** re-attestation + testy. Odhad 2–4 dny.

**Doporučení:** zařadit až po explicitním předání, ne dřív.

---

### `P-5` — integrace donorových komponent `C3-029` / `C3-030` · **čistá půda**

**Co:** matice u obou uvádí *„Donor component; integration not started"*.
Jde o approval/execution audit a git-backed change evidence + final verdict.

**Proč:** je to jediný workstream v matici, na kterém prokazatelně **nikdo
nepracuje**, a donor je pro něj hotový a ověřeně zelený — 869 testů, viz
[STATE-AND-VERIFICATION](2026-08-01-STATE-AND-VERIFICATION.md) §3 „Stav donoru".

**Kolize:** nejnižší z celého seznamu — nulová se `S-trackem` i s Gate 1
řádky, které jsou `BASELINE_RED`.

**Zásadní mantinel:** `AGENTS.md` říká *„The hardened C3 executor and C3 Code
Intelligence are the IntentSmith 1.0 incumbents. OpenCode and Serena evaluation
belongs to 1.1."* Přenáší se tedy **approval ledger a git evidence jako
mechanismy**, ne OpenCode jako worker. Kdyby se to sneslo, je to porušení
rozsahu 1.0, ne feature.

**Cena:** re-attestation + testy. Odhad 4–7 dní.

---

### `P-6` — rebase mobilní větve na trunk · **nízká urgence**

119 commitů pozadu. `PLAN.md` §10 sám varuje, že jeho `[F]` tvrzení jsou
ověřená proti `54913a1`, který není předkem současné hlavy — takže rebase
není mechanický, znamená **přeověřit všechna `[F]` tvrzení** proti novému
základu.

Urgence je nízká, protože `GAP-2` blokuje implementaci tak jako tak. Dá se
odložit až těsně před start Fáze 0 spike. `EX-1` je z toho jediná část, která
spěchá — a ta jde vyřešit samostatně jako `P-2`.

---

## 4. Jak přistát tuhle složku, aniž se spálí kandidát

Adresář `docs/review/` je nový soubor ve stromu, takže i on sám o sobě ruší
kandidáta, kdyby se sloučil. Doporučuji proto **jednu dávku**:

```
1. zmrazit současný kandidát  (da485841 / attestation 17a8b9a8)   ← hotovo, PASS
2. v jednom sledu:  docs/review/  +  EX-1 (P-2)  +  EX-3 (ROADMAP)  +  P-1
3. jeden čistý běh: C → E → R → A
```

Tři samostatné změny = tři attestation běhy. Jedna dávka = jeden. `EX-3` je
sám o sobě příliš levný na vlastní běh, `P-2` spěchá, `P-1` blokuje 30 řádků —
dohromady dávají jednu smysluplnou dávku.

Do té doby zůstává `docs/review/` na oddělené větvi a **nic neruší**.

---

## 5. Co bych naopak nedělal

| Nedělat | Proč |
|---|---|
| Sáhnout na `S-2`/`S-3`/`S-4` | Je to aktivní práce vlastníka větve a zároveň nejcitlivější kód v repu. Dvě ruce v jednom bezpečnostním boundary je horší než pomalejší postup |
| Otevřít Gate 2 | 78 sad čeká, ale `ROADMAP.md` je jasný: fáze se neotevírá, dokud předchozí gate nedrží. Gate 1 je 0/30 |
| Cokoli mobilního implementovat | `GAP-2` to zakazuje bez výjimky, a operátor to potvrdil |
| Opravovat `ROADMAP.md` samostatně | Zneplatní kandidáta za jednu větu. Patří do dávky (§4) |
| Hromadně povýšit řádky matice | Explicitně zakázáno. I kdyby byl podklad, chybí kritéria Gate 1 (`P-1`) |
| Řešit privacy incident bez operátora | `P-001`..`P-003` vyžadují rotaci credentialů a rozhodnutí o historii. `AGENTS.md` obojí bez schválení zakazuje |

---

## 6. Kdybych měl vybrat jednu věc

**`P-1` — kritéria Gate 1.**

Gate 0 se povedl proto, že nejdřív vzniklo 335 řádků definice toho, co verdikt
znamená, a teprve pak se měřilo. Gate 1 má dnes čtyři řádky a třicet řádků
čekajících schopností. Pokud se začne měřit dřív, než bude jasné, co se měří,
skončí to na stejném místě jako tvrzení „~98 % hotovo" ve staré roadmapě —
jen o gate výš, a s dražším úklidem.
