# WP — přirozený CHAT, živé srovnání a malé opravy

Autorita: explicitní zadání operátora vložené 28. 9. 2026 („Worker má začít krátkým živým testem…“), nikoli tento dokument. Input `fb54fbf5ea4f2004fc2c081580d63b0dcbf6390c`; pokračování v již vlastněném worktree/branch `work/intent-resilience-20260928`.

Výsledek: pozorované A/B/C odpovědi, kontext, nástroje a latence; izolované malé opravy porozumění/historie s pozitivními i kontrastními sondami. Živé měření pouze se společným GPU lease a dostupnou GPU. Offline oddělené kernel network namespace; live namespace má jediný explicitní lokální provider přes Unix relay. Jeden vlastní inference běh.

Vlastněné cesty: dotčené `src/chat/**`, potřebná vazba `src/executor/tool-executor.js`, existující `scripts/measure-m1-l3.js`, příslušné existující testy, tento WP, jeden souhrnný review report a ignorovaná evidence. Connector: existující M1 ConversationCommand/Result a M2 tool authority, bez rozšíření oprávnění. Kontext/historie v rozsahu; self-learning mimo rozsah.

Zakázané: cizí checkouty, živá DB/nastavení, aktivace modelů, stahování, sdílený provider restart/unload cizího modelu, hardware/GPU parametry, produkční nasazení/push. Externí/hardwarové efekty pouze záznamový adaptér za skutečnými kontrolami; skutečný file efekt jen v soukromém testovacím projektu.

Postup a stop: úvodních cca 12 A/B situací před změnou; konkrétní selhání → jedna hypotéza → malá změna → offline → live retest. Závěr cca 20 rodin (nejméně třetina neladěná), jazykové varianty a čtyři dialogy, zmrazené tři běhy. Kritický efekt/změna cíle/porušení omezení/nepravdivé hotovo 0; užitečnost ≥95 %, zbytečné zastavení ≤5 %, jazyková delta ≤5 bodů, medián +20 % výslovně vyhodnotit. Po třech kolech bez přínosu změnit přístup. GPU konflikt → zachovat pokus, pokračovat offline, znovu ověřit před handoffem. READY_FOR_REVIEW pouze při splnění živých cílů; jinak NEEDS_MORE_WORK nebo LIVE_NOT_RUN/BLOCKED_GPU.

Ověření: současný `tests/chat-intent-clarity*.test.js`, M1/M2 consumer/WS/persist kontrakty; před handoffem `bwrap --bind / / --dev-bind /dev /dev --unshare-net --die-with-parent --new-session node scripts/nightly-audit.js --profile=offline,database` a registry/diff check. Živá reprodukce a přesná konfigurace se zaznamenají spolu s běhy; vlastní hodnocení není nezávislá revize.

Handoff: **NEEDS_MORE_WORK**, závěrečný live **BLOCKED_GPU / LIVE_NOT_RUN**. Implementace/sada `66e824d7`; poslední plně živě měřený subset `7cd7397c`. [Jediný souhrnný report a odkazy na kanonickou evidenci](../review/2026-09-28-CHAT-LIVE-RESILIENCE.md). Nezávislá revize a tři úplné finální běhy zůstávají neprovedené.
