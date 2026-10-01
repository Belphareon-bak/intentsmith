# Chat a izolované Studio 2 — přijetí integrační delty

Snapshot: 1. 10. 2026, 05:42 UTC. Posuzovaný chatový source je čistý
`c1a25dc1d962434b720cb210fc2d3586797eba85`, nyní integrovaný do
`work/real-chat-journeys-20260930`. Toto je omezené přijetí delty;
nový celý profil a fyzická přejímka čekají, instalace stále používá starší BE.

## Nezávislé review

Reviewer `hunt_completion_path`, oddělený od autora integračního kandidáta,
vrátil **REVIEW_PASS** pro kombinaci ordinal, literal a repeat-save změn.
Zkontroloval source call graph a přesun stejné kontroly M2 oprávnění před
parser i volbu obsahu. Porovnal čistý HEAD a diff; další produktová logika
v poslední deltě nebyla změněná.

Vlastní Node 24 běhy reviewera:

| Důkaz | Výsledek |
|---|---:|
| `capability-02-cre-behaviours` včetně původního C15 | 26/26 PASS |
| M1 doslovný text a zákaz přepsání | 1/1 PASS |
| M1 opakované uložení, restarty a projektové bariéry | 1/1 PASS |
| M2 file consumer | 39/39 PASS |
| shodná časová razítka a `messages.id` | 1/1 PASS |
| izolované Studio 2 kontrakty | 13/13 PASS |
| isolation meta test | PASS; 126 temp roots, 141 DB roots, žádný nechráněný |

V odděleném dočasném checkoutu návrat pouze `getLastN` k časovému řazení
vybral tahy 1–10 místo 3–12: test historie **0/1**. Po obnovení ID řazení
prošel **1/1**. HTTP opakované uložení zůstalo pod mutací **1/1**, protože
jeho 14tahový scénář již čte souhrn a `getTurnsAfterId`; ověřuje přesné bajty
trvalého návrhu a schváleného souboru. Samostatná mutace odstranění testu
historie změnila zjištěný DB census ze 141 na 140 a harness správně selhal;
po obnovení prošel. Dočasné mutační checkouty reviewer odstranil.

## Historické neúspěšné důkazy

První širší profil na `6d16e3f8` byl přerušen po nálezech:
**98 PASS / 5 FAIL / 5 BLOCKED / 297 SKIPPED**, výsledný verdict **FAIL**.
Report je soukromý `2026-10-01T05-29-33-559Z/report.json` v trial checkoutu.
Odhalil pořadí oprávnění C15, chybějící bootstrap a stale census, chybějící
IDE dependency setup a neaktivované deklarované lokální toolchainy.
Přerušená hunt simulace nemá dokončený výsledek. Tyto důkazy nejsou PASS.
Nejnovější dokončený celý profil stále patří `bf7dc31f`: **402/402 PASS**.

## Gate 0 a zbývající přejímka

Nezávislý reviewer `gate0_proposal_review` přijal pouze konzistenci návrhu
`efe70b42bfa89d6cd4102ef4005cb84cb1d2d0ae`: 28 historických, 25 současných
a 3 související identity odpovídají Git objektům; 11 mutací bylo odmítnuto.
Historická autorita nebyla změněná. Na původním pozorovaném zdroji `77672c2c`
starý validátor vrací 31 chyb a 35/60 matching subjects; nový vrací
konzistentní snapshot s **Gate0 BLOCKED**. Integrovaný README a oba registry
subjects mají nové identity a v1 je správně odmítá; čeká nová verze návrhu
nad zmrazeným integrovaným kandidátem.
[Návrh a přiznané sémantické mezery](2026-10-01-M6-GATE0-REDISPOSITION-PROPOSAL.md).

K dokončení přejímky zbývá nový celý offline/database profil, balík ze
zmrazeného source, fyzické AppImage/Legacy/M2/SCM scénáře a posouzený chat
53×3 se stejným source/model/corpusem včetně kontextu a specialistů. Hunt
skóre, druhý posudek a přijetí modelů, M5 custody a M6 signed authority mají
vlastní otevřené brány. Mobilní integrace a konečný úklid následují po těchto
milnících.
