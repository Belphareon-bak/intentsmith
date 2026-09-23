# Studio: průběh práce, soubory a kopírování odpovědi

Autorita: zadání operátora 23. 9. 2026 a jeho přiložené ukázky IDE.
Vstup: nasazený `400c9d8ffdf336055d4dc6f9fb8a10565c0adccd`.
Stav: IN_PROGRESS / REVIEW_PENDING.

Výsledek: u konkrétního tahu je vidět běžící práce, nástroj/model, čekání
na odpověď či schválení a pravdivý terminál. Souborový plán a provedený výsledek
mají rozlišitelné souhrny s počty přidaných/odebraných řádků a otevřením diffu.
Malé tlačítko kopíruje přesnou odpověď, formátovaný text se bezpečně vykreslí.
Terminál a podrobné logy zůstávají oddělené, existující M1/M2 autorita se nemění.

Vlastněné cesty: Studio chat renderer, lokální zobrazovací pomocník a styly,
navazující Studio testy a tento report. Žádné změny Huntu, modelových rolí,
profilů, měřicích kontraktů či cizího checkoutu. Použit stávající vlastní checkout.

Ověření: skutečný Electron s vlastní DB a bez připojení k modelovému provideru;
M1 transport a deterministický chat, řízené události pro pomalé/fault stavy,
M2 prepare/approval a diff nad vlastními soubory, copy a malá šířka. Jednotkové
regrese izolace tahů, terminálů, diff statistik a bezpečného vykreslení;
produkční Studio build, registry a úplný offline/database profil.
Kontrolované události nejsou důkaz živé modelové inference. Žádné smyšlené
mezistavy ani oprávnění odvozené ze zobrazení. Při chybě nebo odpojení žádný
falešný úspěch; nasazení nesmí přerušit cizí běžící GPU práci.
