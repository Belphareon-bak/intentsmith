# WP-SPECIALISTS-20260911

Autorita: zadání operátora 2026-09-11 implementovat sázkaře podle připraveného
kontraktu, doplnit 24h/72h okna a rozpracovat reálný účetní scénář PDF+HEIC →
DPHKH1 + DPHDP3. Navazuje na přijatý směr M3; není release WP.

1. Výsledek: funkční výpočetní a chatový řez sázkaře s tvrdými časovými limity,
   datovým kontraktem, importem, solverem a deterministickou prezentací;
   účetní případ ověřit proti skutečným podkladům a připnout potřebnou cestu.
2. Vlastněné cesty: specialists/sazeni/**, související nové specialist testy,
   docs specialist kontrakty/WP, úzké integrační spoje specialist-runtime,
   specialist-handler a loader podle potřeby. Účetní doménové změny jen v
   specialists/accountant-cz a příslušných testech. M1/M2 authority se neoslabuje.
   Zakázáno: živé DB, GPU/model bindings, cizí checkouty/změny, odeslání přiznání,
   podání sázek, placené registrace a tajné podklady v Git.
3. Doménový connector BettingRequest/Result@2 s časovým dodatkem, stávající
   ExtensionManifest/Context@1. Rozšíření hostu vyžaduje explicitní nezávislé
   review před tvrzením přijaté integrace.
4. Vstupní SHA 7c693d32107cdd5f6d16405ab58ea94057a8f28e. Aktivní mobilní checkout
   současně používá jiný worker. Budget report: 29 records, 0 safely retirable,
   chráněné dirty/evidence/live checkouty se zachovávají. Vlastní současný
   worktree je nutný pro bezpečný zápis; žádný cizí se neuklízí.
5. Demo: syntetická nabídka obsahující zápasy do 24h, do 72h, za týden a za
   měsíc. Výsledek nesmí obsahovat zápasy za zvolenou hranicí. Účetní PDF/HEIC
   zůstávají pouze v Downloads a privátní externí evidenci.
6. Pozitivní/negativní: exhaustive oracle pro malý solver, hraniční čas,
   časový rozestup, nulové/nesprávné p, kurz, korelace, společná kancelář,
   expire, nekompletní search, disabled/cancel, serializovaný výstup.
7. Stop: chybějící credentials/coverage blokuje jen live provider; chybějící
   účetní podklady blokují přesnou parity, ne nezávislou práci na sázkaři.
   Nikdy neoznačit nezměřenou predikční kvalitu nebo neověřenou parity jako PASS.
8. Ověření: nové focused testy + příslušné existující specialist boundary,
   runtime/handler, registry a deterministic profily podle změn. Výsledek
   průběžně patří do implementačního reportu, nikoli do tohoto zadání.

## Pokračování účetního, autorizováno operátorem 2026-09-12

Autorita: „tak implementuj a pokračuj … tvorbou daňového přiznání“ a reálný
`repiznn2025.zip`. Vstup 8654e67a; stejný checkout a vlastník. Výsledek:
lokální CLI pro měsíční DPH/KH a roční OSVČ, import složky, dohledatelné návrhy
dokladů, trvalý seznam podkladů/rozhodnutí, termíny a validované výstupní balíčky.
Soukromé podklady slouží jako místní regresní příklady; nejsou tréninkovou sadou
odesílanou ven. Chybějící podklady se nedopočítávají z referenčního podání.

Vlastněné cesty navíc: `src/accounting/**`, `bin/ucetni.js`,
`scripts/install-ucetni*`, `specialists/accountant-cz/**`, nové účetní testy
a jejich přidané registry záznamy, příslušný návod a stav v SYSTEM-MAP.
Connector: čisté doménové funkce a lokální CLI host; M1/M2/M3 veřejné rozhraní
se nemění. Host drží scoped soubory, lokální OCR, privátní stav a export;
specialista neimportuje core. Bez podávání na úřady, změn živé DB nebo GPU.

Demo: skutečné PDF+HEIC a rozbor ročního ZIP; syntetická úplná měsíční/roční
evidence musí vytvořit výstupy, neúplná musí vypsat konkrétní požadavky.
Negativní cesty: duplicitní import, nejisté OCR, neznámá platba přes rok,
neoprávněná sleva, chybějící potvrzení, nepodporovaný režim, chybná XML,
ZIP traversal a neplatná privátní cesta. Úplná parity s účetní je závislá na
úplné evidenci; její absence neblokuje implementaci a pravdivé draft výstupy.
Ověření: nové registrované účetní journey testy, stávající package/boundary,
`npm run test:registry`, `npm run test:deterministic`, `git diff --check`.
