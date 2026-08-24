# M2 — povinná Claude Opus max review matice

- **stav:** `7 IMPLEMENTATION_GREEN / 0 OF 7 OPUS_MAX_REVIEW_PASSED`
- **větev:** `codex/m2-integration-20260824`
- **push:** neproveden
- **review runtime:** lokální Claude Code 2.1.220, `--model opus --effort max`

Tato matice je autorita pro nově požadovaných sedm nezávislých review. Starší
review užšího řezu, interní coworker audit, focused PASS ani celý gate
nenahrazují žádný z těchto sedmi verdictů. Account/tool limit je vždy
`REVIEW_BLOCKED`, nikdy `REVIEW_PASSED`.

## Přesné rozsahy

| Oddíl | Work Package | Exact source range | Aktuální review stav |
|---:|---|---|---|
| 1 | project-path authority | `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91..7dc6a807d94ee1fc4596abc3dd0233d77d55322d` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 2 | effect/approval authority | `33cf221c3b772a1002311c8b1f71b67ad0d46cc9..fa437d021e07728388eb61bbca88bcc98e208ddf` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 3 | ProjectContext | `44a9ba87c99a448b1b1b5f479963c3b6aaac7e91..5e19b8256f714367bc9ec444eb7d256d01e01e3e` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 4 | ToolRequest/ToolResult | `fa437d021e07728388eb61bbca88bcc98e208ddf..a35805ee79b778638151c608eaf29afec6d7df3b` | `CHANGES_REQUESTED / RE_REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 5 | durable project execution | `a35805ee79b778638151c608eaf29afec6d7df3b..da8698ffec6ce56e90603f05d55ec6644f6c4a29` | `CHANGES_REQUESTED_ROUND_2 / RE_REVIEW_REQUIRED` |
| 6 | lifecycle/governance journey | `da8698ffec6ce56e90603f05d55ec6644f6c4a29..cb9058b499961fc68711cbfc243ad2a7b68b0eba` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 7 | RemoteCorePort contract | `cb9058b499961fc68711cbfc243ad2a7b68b0eba..d034df62c525dbfc3dc81ffc5de9f6c6cc527b7e` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |

Oddíly 1 a 3 vznikly paralelně ze stejného přijatého M1 base; proto mají
samostatné branch-local ranges. Ostatní rozsahy jsou po integrační linii
sekvenční. Každý base je ověřený lokální ancestor příslušného headu.

Tyto ranges určují původ a odpovědnost změny, nikoli povolení revidovat pouze
historické bajty. Reviewer musí pro každý oddíl také porovnat jeho vlastněné
soubory se současným product-integration headem, trasovat aktuální
produkční konzumenty a ověřit, že pozdější oddíl nezměnil dříve posuzovaný
terminální nebo authority kontrakt. Pozdější delta se věcně připíše oddílu,
který ji zavedl, ale nalezená regrese blokuje aktuální review obou dotčených
hran. Evidence dokumenty se vždy čtou z aktuálního review checkoutu.

## Povinný review protokol

Každý běh musí:

1. použít lokální Claude Opus s `--effort max`, read-only
   `--permission-mode plan` a `--no-session-persistence`;
2. inspektovat skutečný diff, produkční call/import graph, výsledný
   persisted/emitted kontrakt a negativní hranice — nikoli pouze WP nebo testy;
   vedle provenance range zkontrolovat i současný product-integration head;
3. číst současný evidence report daného oddílu a ověřit jej proti source-bound
   logům; historický `FAIL` se nesmí přepsat na PASS;
4. znovu spustit bezpečné relevantní deterministic testy, ale nedotknout se
   GPU/Ollamy, Electronu, sítě, coworkerových procesů ani cizích checkoutů;
5. vrátit právě jeden top-level verdict `REVIEW_PASSED` nebo
   `CHANGES_REQUESTED`; tool/account failure nevrací verdict;
6. u `CHANGES_REQUESTED` uvést severity, `file:line`, reprodukci a falsifikovatelnou
   acceptance condition;
7. po každé opravě zopakovat celý exact-scope review, dokud nevznikne
   `REVIEW_PASSED`.

## Pinning bez mezery po review

Oddíl 1 je interní path primitive a veřejný stage nepřipíná. Oddíly 2 a 4–7
mají veřejné kontrakty stále `CANDIDATE_V1`; ProjectContext v oddílu 3 je
`PROVISIONAL_V1`. To je povinný stav před prvním nezávislým review, nikoli
finální stav M2.

Pro oddíly 2–7 platí dvoufázový cyklus:

1. Opus max vrátí `REVIEW_PASSED` nad kandidátem;
2. teprve potom se stage mechanicky změní na `PINNED_V1`, synchronizují se
   exact stage sentinely, descriptor digesty a pravdivá evidence;
3. zopakují se focused sady, registry/artifact/module checks a celý clean gate;
4. Opus max znovu reviduje finální připnuté bajty a musí vrátit
   `REVIEW_PASSED`.

Do součtu `7 OF 7` se počítá pouze verdict svázaný s finálními současnými
bajty. Kandidátní PASS, po němž se změnil contract stage, není finálním PASS a
nesmí uzavřít M2.

## Společná integrační evidence

Poslední čistý `offline,database` gate na
`4ddfe56e6ca2ea8e1eed0f60b80f2ab78711d5fe` má report
`.intentsmith-artifacts/test-runs/2026-08-24T10-38-56-185Z/report.json`:

- `verdict: FAIL`, `exitCode: 1`;
- `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesně pět známých baseline non-PASS ID a žádné M2 non-PASS;
- všech 27 M2 `offline,database` programů PASS;
- registry 428 programů / 14 exclusions / fingerprint
  `54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

Cross-section audit po section-5 opravě přímo zopakoval zbývající čtyři
M2 `soak` sady: lifecycle application service 6/6, project change 17/17,
process supervision 13/13 a exact Git preservation 12/12 PASS. Direct-test
runtime po bězích zůstal prázdný.

Tento head navíc uzavírá HIGH interní nález v section-5 sandboxu: původní
read-only host-root bind dovoloval pathname Unix socket effect a čtení mimo
projekt. `linux-bwrap-ro-v2` používá prázdný mount root, exact project/binary,
minimální runtime a seccomp; inside-project i outside-project host socket proby
mají nula spojení. Tato vlastní oprava rozšiřuje současné product bytes oddílu
5, a proto ji musí Opus zahrnout do section-5 review i do call-graph kontroly
navazujícího section-6 journey.

Tato evidence dokládá implementační integraci, nikoli nezávislé review ani M2
acceptance. M2 se smí uzavřít až po sedmi zaznamenaných Opus max
`REVIEW_PASSED`, následném finálním clean gate a requirement-by-requirement
closeout auditu.

## Account-limit pokusy

- Na section-7 evidence headu `efa1a5de` skončil exact section-7 Opus max
  příkaz exit 1 před review zprávou o měsíčním spend limitu.
- Po cross-section evidence hardeningu `62836571` skončil stejně exact
  section-1 Opus max příkaz. Nevznikl modelový výstup, nález ani verdict.

Oba pokusy jsou pouze `REVIEW_BLOCKED_ACCOUNT_LIMIT`. Další sekce se během
stejného účtového bloku nespouštějí, protože sedm identických billing failure
není sedm review.

Účtový blok následně skončil. První skutečný section-5 Opus max review na
`61e09d47` vrátil `CHANGES_REQUESTED`; repo-local záznam a fix response jsou v
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-REVIEW.md` a
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-RESPONSE.md`. Opravný head
čeká na celý exact-scope re-review; stav tedy stále není PASS.

První re-review na `0260bcb9` oba původní nálezy uzavřel, ale vrátil druhé
`CHANGES_REQUESTED` kvůli type-swap false success a unguarded type driftu v
rollback/recovery. Záznam, oprava `816c5b14` a nové důkazy jsou v
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-RE-REVIEW.md` a
`docs/review/2026-08-24-WP-M2-EXECUTION-V1-OPUS-MAX-RE-REVIEW-RESPONSE.md`.
Ani toto opravné kolo není PASS; čeká na další celý Opus review.

Section-1 interní audit současných bajtů byl remediován na `4ddfe56e`: storage
failure evidence už neprojde best-effort wrapperem, dead-import import probe
nečte metadata venku a post-rename durability failure přiznává efekt i
kompenzaci/orphan. Exact section-1 Opus max příkaz na tomto čistém headu znovu
skončil před modelovým výstupem měsíčním spend limitem. Nevznikl verdict;
stav oddílu 1 zůstává `REVIEW_BLOCKED_ACCOUNT_LIMIT`.

Section-2 current-byte audit je zaznamenán v
`docs/review/2026-08-24-WP-M2-EFFECT-CONTRACT-V1-INTERNAL-AUDIT.md` a
remediován na `60d39810` s module ratchetem `ab97809b`. Uzavírá semantic grant
constraints na repository/SQLite hranici, non-success fs.write evidence,
reconnect identity, restart path evidence, byte-exact provider hash a pozdější
project-change child result. Focused a integrační ratchety jsou zelené, ale
nevznikl Opus verdict; oddíl 2 zůstává `REVIEW_BLOCKED_ACCOUNT_LIMIT`.
