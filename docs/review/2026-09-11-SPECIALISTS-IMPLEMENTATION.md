# Sázkař a reálný účetní případ — implementační předání

Stav: **IMPLEMENTED_SLICE / REVIEW_PENDING**. Celý betting kontrakt ani účetní
PDF/HEIC → XML cesta nejsou dokončené. Tento dokument je důkaz implementátora,
nepředstavuje nezávislé přijetí. Adresát: operátor a nezávislý reviewer.
Autorita: dvě navazující zadání operátora 2026-09-11 a potvrzení, že účetní
vstupy/výstupy patří stejnému měsíci; [WP](../wp/WP-SPECIALISTS-20260911.md).

## Konkrétní výsledek

- Sázkař má v2 uzavřený request/snapshot, čistý engine, přesné kurzy/peníze,
  tržní a ruční pravděpodobnosti, bounded solver, společné časové okno a
  samostatný maximální rozestup začátků. 24 h / 3 dny jsou tvrdé podmínky.
- Existující balíček `sazeni` a čtyři veřejná tool ID jsou zachované. Runtime
  i manifest směrují na nový engine. Persona číselné výsledky nepřepisuje;
  chyby/chybějící data se vracejí deterministicky, bez smyšlené predikce.
- JSON lze vložit do chatu / přiložit inline. Následné časové preference se
  přepočítají ve stejné relaci. CLI poskytuje soukromé input/result/CSV/Markdown
  soubory. Čistý adaptér převádí lokálně dodané The Odds API v4 odds.
- Účetní má [konkrétní měsíční kontrakt](../../specialists/accountant-cz/MONTHLY-VAT-CONTRACT.md)
  založený na přímém čtení reálného PDF, věrném dekódování HEIC a kontrole obou
  XML. Přílohy jsou přírůstek knihy; nesmí se zaměnit s úplnou evidencí měsíce.
  Jeden vydaný doklad souhlasí, přijatá strana z předaných zdrojů doložit nejde.
  Podnikatelský nárok a důvod vyřazení účtenek nejsou odhadované.

Použití a reprodukce: [README sázkaře](../../specialists/sazeni/README.md).
Původní cílový rozsah s implementační maticí: [kontrakt](../../specialists/sazeni/CONTRACT.md).

## Přesná identita a ověření

Vstup: `7c693d32107cdd5f6d16405ab58ea94057a8f28e`.
Vlastní worktree: `/home/belphareon/worktrees/is-specialists-engines-20260911`.
Větev: `codex/specialists-engines-20260911`.
Implementace `a634624c`, samostatné rozšíření DB test census `5bdb3dde`, opravy a
reconciliace `85f16c53f70ce7f50eb953b7bfbc64f065caadce`. Následné předání mění pouze dokumenty.

Příkaz `npm run test:deterministic`, čistý poslední kódový commit:
**343 PASS / 3 FAIL / 8 BLOCKED / 0 TIMEOUT / 0 SKIPPED**, exit 1.
Raw run `2026-09-11T21-39-21-905Z`: [report.json](../../.intentsmith-artifacts/test-runs/2026-09-11T21-39-21-905Z/report.json).
Výsledek celého profilu je **FAIL**, nikoli acceptance.

V něm nové sady `sazeni-engine` a `sazeni-integration` mají **13/13 PASS**:
20 variant nezávislé úplné enumerace, hranice 24/72 h, oddělený spread, DST,
kurzy/výplata, zdroj p, korelované události, neplatné vstupy, padělaný live,
search limit, zrušení, alternativy, session isolation, skutečný serializovaný
handler, disable a stejný scanner jako v loaderu. Stávající účetní a relevantní
M3/runtime/handler sady ve full profilu prošly. Kalibrace modelu se netestovala:
žádný takový model není implementovaný/aktivovaný.

`npm run test:registry`: PASS, 514 programů,
SHA256 `2322ef86b7eabbf1b3a2b0bd513d2fba08d19320fd8290a47798e79823117993`.
`harness-exit-code`: PASS, všech 127 DB-reachable testů chráněno bootstrapem,
mutation check zůstává aktivní. Baseline měla 126; přírůstek je jedině nový
skutečný handler test. Změna census je oddělený commit, bez oslabení kontroly.

### Zbývající non-PASS, bez přebarvení

| Sada | Stav a příčina |
|---|---|
| artifact-validation | FAIL: rezervační manifest neobsahuje již existující migraci 112. Reprodukováno na čisté kopii vstupu: 157 PASS / 1 FAIL. Stejný výsledek na závěrečném kandidátu. Naše README/LOC/registry odchylky byly opravené. |
| nightly-orchestrator-self-test | FAIL způsobený přidáním dvou registrovaných sad: přijatá Gate 0 policy stále pinne předchozí registry hash a profil 279 offline / 73 database. Kandidát má 280 / 74. Baseline self-test PASS. Policy ani test nebyly oslabeny nebo přepnuty na nový otisk bez review. |
| mobile-browser-a11y | Runner uvádí FAIL; log hlásí chybějící chromium-runtime, 0 provedených browser assertions. Nesmí se vydat za PASS ani za proběhlý browser E2E. |
| chat-export-budget, export-pdf-docx | BLOCKED: toolchain:python-pdf-runtime |
| m2-execution-git-preservation, workspace-budget | BLOCKED: toolchain:git v auditním prostředí |
| m2-execution-process-supervision | BLOCKED: toolchain:bwrap |
| m2-execution-project-change, m2-lifecycle-application-service | BLOCKED: toolchain:bwrap a toolchain:git |
| m5-process-hardening | BLOCKED: toolchain:bubblewrap a toolchain:prlimit |

Otisk Gate 0 se nemění jako vedlejší účinek implementace. Review musí zvlášť
posoudit registrační delta a případné nové připnutí v `scripts/nightly-orchestrator.js`.
To je otevřená integrační podmínka; není to tvrzení, že celý projekt je zelený.

## Účetní důkaz, provoz a zbývající práce

Skutečné podklady a soukromý přepis jsou mimo Git:
`/home/belphareon/Projects/coworker/intentsmith-specialists-20260911/private-evidence/`.
Oficiální XSD načtené lokálně 2026-09-11: KH PASS; DPHDP jedna schema chyba
v `Veta5.koef_p20_nov` s desetinnou čárkou. Originály nebyly změněny nebo odeslány.
To nevypovídá o přijetí/odmítnutí FÚ. Jejich reprodukce vyžaduje úplnou měsíční
knihu a potvrzené zacházení s účtenkami.

Neimplementované cílové části: ověřený živý feed a jeho scoped connector,
kalibrovaný statistický model, DB historie/settlement, Studio formulář,
produkční refresh. Účetní stále nemá automatický import PDF/HEIC s review ani
export obou formulářů. Nejsou prohlašované za dostupné.

Další akce pro přijetí sázkaře: nezávislé review tohoto přesného diffu a registry
delta; poté připojení zdroje s potvrzenou kanceláří/regionem a coverage. Pro
účetního: dokumentový host/import a přehled návrhů dokladů spojený s knihou,
poté dva exportéry z jedné revize a XSD/věcné validace podle kontraktu.

Cizí checkouty, jejich změny, živé DB a GPU běhy zůstaly zachované. Žádný push,
merge do provozu, podání sázky ani daňového přiznání nebyly provedeny.
Rozpočet plochy: 30 worktree records, 0 safely retirable, všechny chráněné;
vlastní větev je nezintegrovaná. Baseline probe byla místní izolovaná kopie,
cleanup proběhl jen v ní (0 odstraněných, 2 chráněné plochy); globální cleanup
cizích sandboxů nebyl proveden. Důkazy a logy se zachovávají.
