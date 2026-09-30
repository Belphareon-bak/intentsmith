# WP — skutečné naplnění okna a auto-context v živém chatu

**Stav k 30. 9. 2026:** první živý běh na `4a789bb1` ověřil podscénář
naplnění okna `PASS`, celá sada však skončila `FAIL` (3/4) po HTTP 502 u
neúplné CODE odpovědi. Po opravě v `WP-CHAT-ANSWER-TRUNCATION-20260930`
opakovaný běh na `0b0cabdba153b0bebfda8fc06a8a34da11766a30` dokončil
celou sadu `PASS` (4/4), provider capture `PASS` a uvolnil GPU lease. Lokální
reporty jsou `.intentsmith-artifacts/run-suites/2026-09-30T17-31-23-783Z/report.json`
a `.intentsmith-artifacts/run-suites/2026-09-30T17-58-43-582Z/report.json`.
Registr nadále nemá `lastGreen`; běhový režim není release Gate 0.

**Autorita:** explicitní zadání operátora z 2026-09-30 ověřit chat po
naplnění kontextového okna a automatické zkrácení kontextu. Produktové chování
plyne z existujícího auto-contextu; tento WP nepřidává novou politiku uchování.

**Vstup a integrace:** větev `work/real-chat-journeys-20260930` vznikla z
`origin/main` `838b8cee038db027691072d293eb00153854f81e`. Opravy promítání
summary a počítání krátké historie z větve `work/intent-resilience-20260928`
jsou integrovány do kandidáta `4a789bb1`. Tehdy otevřenou mezeru asynchronní
sumarizace krátkých zpráv řeší navazující
`WP-CHAT-CONTEXT-RETENTION-20260930`; integrovaná oprava `88a7f91a` +
`222793c6` má omezené nezávislé review, ale čeká na nový živý běh této sady.

**Výsledek pro uživatele:** při konverzaci, jejíž původní historie přesáhne
skutečně odeslané `num_ctx` a jejíž efektivní historie s režijní rezervou
překročí práh auto-contextu, zůstane počáteční důležitý fakt dostupný po
zkrácení kontextu.
Starší historie musí být shrnuta a efektivní počet tokenů klesnout. Celý
původní dialog zůstane persistovaný.

**Rozsah a vlastnictví:** pouze `tests/e2e/85-long-session-degradation.e2e.js`
a tento WP. Neměnit modelový profil, produkční data, bindings ani cizí GPU práci.

**Demonstrace a test:** existující registrovaná modelová sada
`IS-T3-E2E-85-LONG-SESSION-DEGRADATION` pošle přes skutečné HTTP až osm
obsahově různých delších tahů a případně devátý po cooldownu. Předem známý
auditní kód je pouze v prvním tahu. Opt-in runner zachytí skutečné požadavky
a terminální odpovědi `/api/chat` v soukromém JSONL artefaktu. Test porovná
identitu CHAT modelu, skutečné `num_ctx` a `prompt_eval_count` s historií API;
vyžaduje překročení `num_ctx` v úplné uložené historii a překročení spouštěcího
prahu z nejvýše 10 tehdy dostupných zpráv plus stejné 1500tokenové rezervy,
kterou používá `maybeCompact`. `prompt_eval_count` zaznamená skutečné využití
provideru, ale není totožné se spouštěcím odhadem: `buildAnswerContext` záměrně
rezervuje místo pro odpověď a omezuje historii. Test ověří, že background
compaction uložila summary pokrývající první zprávu, zachovala kód a při
prvním dokončení snížila efektivní historii vůči témuž snapshotu bez summary.
Zachycená ANSWER odpověď providera se musí přesně rovnat HTTP odpovědi a
metadata musí potvrdit stejný model i `num_ctx`. Závěrečný zachycený provider
prompt musí obsahovat summary i kód, avšak původní první zpráva a její
nesouhrnný prostřední řádek už v něm nesmějí být. Závěrečná otázka kód nesmí
opakovat; model musí kód vrátit.
Průběh, odpovědi, snapshot DB a délka se SHA256 úplného JSONL prefixu se uloží před
odstraněním izolované konverzace do privátního artefaktu s právy `0600` i při
selhání. Pozdější řádky background sumarizace zůstanou v surovém záznamu a
runner musí ověřit beze změny právě uložený prefix. Použitý příkaz:

```sh
node scripts/run-suites.js --suite=IS-T3-E2E-85-LONG-SESSION-DEGRADATION --capture-provider --timeout-scale=2 --keep-run-root
```

Před GPU během musí skončit cizí hodnocení a projít kontrola zámku, Ollamy,
NVIDIA procesů a přesného modelového digestu. Capture runner je popsán v
`WP-CHAT-PROVIDER-CAPTURE-20260930`; jeho izolovaný fake-upstream self-check
nenahrazuje modelový běh. Po každé produktové opravě se živá sada opakuje na
novém přesném SHA; offline kontroly nejsou modelový `PASS`.
Všechny tahy sady nyní propagují časový limit testu do HTTP a čekání; interní
deadline nastane 15 sekund před záložním limitem harnessu, aby po timeoutu
nepokračoval předchozí modelový request souběžně s dalším testem. Zdvojený
limit celé sady pokrývá i pomalé modelové odpovědi.

**Stop condition:** `FAIL` při ztrátě kódu, chybějícím summary, neúspoře
tokenů, neshodě skutečného provider requestu nebo chybě modelové odpovědi;
`BLOCKED` jen při doložené chybě
prerekvizity. Tento scénář neprokazuje paměť přes více než 50 starších tahů,
restart ani kvalitu shrnutí u jiných témat; to jsou samostatné acceptance
scénáře. Nezměnit registr `lastGreen` z lokálního běhu.

**Naměřený rozsah druhého běhu:** syrová uložená historie měla 4602 odhadovaných
tokenů při skutečném `num_ctx=4096`; efektivní historie před souhrnem měla
3315 tokenů a s režijní rezervou 1500 překročila 75% práh. První dokončený
souhrn při šestém tahu snížil stejný snapshot o 303 tokenů (3267 → 2964).
Finální provider prompt neměl syrovou první zprávu, ale obsahoval souhrn a
počáteční auditní kód; model vrátil přesný kód, `prompt_eval_count=1638`.
Zachycené sumarizační requesty však opakovaně skončily `done_reason=length`
na tehdejším 500tokenovém limitu a tehdejší kód přijal jejich neprázdný obsah.
Navazující oprava v `WP-CHAT-CONTEXT-RETENTION-20260930` takové souhrny
odmítá a dovoluje v rámci existujícího limitu 1 000 výstupních tokenů.
Nové chování dosud nemá živý důkaz; tento starší PASS potvrzuje jen uvedený
kontrolní kód na SHA `0b0cabdb`.
