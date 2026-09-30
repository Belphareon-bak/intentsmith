# WP — skutečné naplnění okna a auto-context v živém chatu

**Stav:** implementační kandidát; modelový běh `NOT RUN`, přejímka otevřená.
Sada v registru nadále uvádí `BLOCKED`, `lastGreen=null`. Dokud nebude
zkontrolovaná a integrovaná volba runneru `--capture-provider`, nelze tento
scénář spustit průkazně.

**Autorita:** explicitní zadání operátora z 2026-09-30 ověřit chat po
naplnění kontextového okna a automatické zkrácení kontextu. Produktové chování
plyne z existujícího auto-contextu; tento WP nepřidává novou politiku uchování.

**Vstup:** ověřený `origin/main` `838b8cee038db027691072d293eb00153854f81e`.
Vlastní branch `work/real-chat-journeys-20260930`; navazuje v čase na
projektový test v témže checkoutu. Opravu počítání a promítání summary vlastní
oddělená větev `work/intent-resilience-20260928` a výsledky se musí ověřit
znovu až po integraci.

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
runner musí ověřit beze změny právě uložený prefix. Provedení po integraci
obou kandidátů:

```sh
node scripts/run-suites.js --suite=IS-T3-E2E-85-LONG-SESSION-DEGRADATION --capture-provider --timeout-scale=2 --keep-run-root
```

Před GPU během musí skončit cizí hodnocení a projít kontrola zámku, Ollamy,
NVIDIA procesů a přesného modelového digestu. Capture runner je samostatný
WP v `work/intent-resilience-20260928`; jeho izolovaný fake-upstream self-check
nenahrazuje modelový běh. Test na starém backendu se nesmí vydávat za ověření
nové opravy; po integraci je nutné zopakování na přesném SHA. Syntaktická,
registry a fake-upstream kontrola znamenají pouze `NAPSÁNO`, ne modelový `PASS`.
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
