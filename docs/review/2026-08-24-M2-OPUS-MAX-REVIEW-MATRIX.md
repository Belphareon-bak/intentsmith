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
| 5 | durable project execution | `a35805ee79b778638151c608eaf29afec6d7df3b..da8698ffec6ce56e90603f05d55ec6644f6c4a29` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 6 | lifecycle/governance journey | `da8698ffec6ce56e90603f05d55ec6644f6c4a29..cb9058b499961fc68711cbfc243ad2a7b68b0eba` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |
| 7 | RemoteCorePort contract | `cb9058b499961fc68711cbfc243ad2a7b68b0eba..d034df62c525dbfc3dc81ffc5de9f6c6cc527b7e` | `REVIEW_BLOCKED_ACCOUNT_LIMIT` |

Oddíly 1 a 3 vznikly paralelně ze stejného přijatého M1 base; proto mají
samostatné branch-local ranges. Ostatní rozsahy jsou po integrační linii
sekvenční. Každý base je ověřený lokální ancestor příslušného headu.

Tyto ranges určují původ a odpovědnost změny, nikoli povolení revidovat pouze
historické bajty. Reviewer musí pro každý oddíl také porovnat jeho vlastněné
soubory se současným product-integration headem `d034df62`, trasovat aktuální
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

Čistý `offline,database` gate na
`d415e6d780a0cac931a28e59c7a51919aed79251` má report
`.intentsmith-artifacts/test-runs/2026-08-24T08-27-21-820Z/report.json`:

- `verdict: FAIL`, `exitCode: 1`;
- `260 PASS / 3 FAIL / 0 TIMEOUT / 2 BLOCKED / 0 SKIPPED`;
- přesně pět známých baseline non-PASS ID a žádné M2 non-PASS;
- všech 27 M2 `offline,database` programů PASS;
- registry 428 programů / 14 exclusions / fingerprint
  `c487692dd5ccea126d3b858f4dcf207cc701e945c545ee2843c7227b946d4374`.

Cross-section audit na čistém `d034df62` navíc přímo zopakoval zbývající čtyři
M2 `soak` sady: lifecycle application service 4/4, project change 10/10,
process supervision 11/11 a exact Git preservation 10/10 PASS. Direct-test
runtime po bězích zůstal prázdný.

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
