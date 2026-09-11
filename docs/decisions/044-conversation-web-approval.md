# Decision 044 — web bez projektu v 1.0

Datum: 2026-09-11. Produktový rozsah: **PŘIJATO OPERÁTOREM**.
Implementace: candidate; samostatné bezpečnostní review a release acceptance
tento zápis nenahrazuje.

Operátor na konkrétní otázku o webu bez připojeného projektu odpověděl:
„Doplnit do 1.0 se schválením každého požadavku“.
Přijatý rozsah je jeden viditelný HTTPS požadavek schválený uživatelem v
konverzaci. Není to mandát k autonomnímu procházení webu ani aktivace agentů.

Prováděcí kontrakt `ConversationWebRequest@1` je oddělený od projektových
`EffectRequest@1` a root-list `EffectRequest@2`. Nikdy nevyrábí projektové ID.
Platí pro ověřeného `local-operator`, skutečnou aktivní konverzaci bez projektu
a uložený původní user-turn. Přesná kanonická URL včetně dotazu se zobrazí
před schválením. Příkaz `schválit web web:<digest>` musí být samostatný
uložený uživatelský vstup v téže konverzaci; obecné „ano“ nestačí.

Implementační meze: HTTPS GET na portu 443, maximálně 2048 bajtů URL, bez
těla, cookies, credentials a proxy konfigurace; validované TLS; pouze veřejné
IP, připnuté do socket lookup; žádné přesměrování, retry, fallback nebo
automatické následování odkazů. Jeden požadavek trvá nejvýše 15 sekund,
odpověď nejvýše 1 MiB, bez komprese, pouze podporované textové MIME typy.
Schválení čeká nejvýše pět minut; spotřebuje se atomicky před síťovým efektem.
URL limit omezuje objem, **nezabraňuje exfiltraci**; rozhodující je viditelné
schválení konkrétního cíle a obsahu dotazu.

Před oznámením úspěchu jsou v SQLite uložené přesné response bytes, hash,
URL, IP a HTTP status a existuje M5 outbound decision/terminal audit.
Výsledek je citovaný obsah, nikoli instrukce modelu či nástroji. Obnovení
vrací uložený výsledek bez sítě. Pád po spotřebování souhlasu nikdy nezakládá
právo požadavek znovu odeslat; nedoložený výsledek zůstává nedoložený.
Zrušení, změna původní zprávy, smazání/archivace nebo připojení projektu
ruší tento rozsah a odstraní response bytes z webového repository. Dříve
zobrazený úryvek ve zprávě se řídí běžnou retencí historie konverzace;
odvolání souhlasu nevymaže kopie, které už uživatel získal.

Přímé načtení používá `načti web https://…`. Vyhledávací intent nabídne jeden
konkrétní Bing RSS GET. Je to dostupnostní závislost na veřejném endpointu,
nikoli garantovaná search API služba. Blokace/challenge/chyba se neobchází
dalším providerem; další URL vyžaduje nový souhlas. Původních 34 modelových
web scénářů se neoznačí za PASS pouhou existencí tohoto consumeru.

Externí reputační služba a autonomní agentí egress jsou odlišný následný
kontrakt v [agentech po 1.0](../post-release/agents.md). Z této uživatelské
odpovědi se neodvozuje další komunikace s třetí stranou.
