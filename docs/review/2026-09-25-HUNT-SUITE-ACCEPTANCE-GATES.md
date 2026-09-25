# GPU hunt: přejímka sad před srovnávací maticí

25. 9. 2026 · stav sedmi rolí na přesně označených vývojových datech · **NO_GO pro modelové doporučení**

`SEBRÁNO` v [matici 70 buněk](2026-09-25-HUNT-STEP3-READINESS.md) znamená syrové odpovědi. Neznamená přijetí sady, lidskou referenci ani skóre. Sběr, hodnocení a případné nové znění úlohy zůstávají oddělené artefakty. Níže je stav bodu 1 zamčeného postupu; pokrytí bodu 2 je v propojené matici.

| Role | Co má sada měřit | Srovnatelný pilot | Nedoložená přejímka |
|---|---|---|---|
| D1 | Příčinná analýza a plán bez patchování | 3 přesné artefakty × 8 úloh × 3 pokusy | Nezávislá kontrola dostatku veřejného kontextu a významové rubriky; 8 historických skupin nelze vydávat za silný rank-check |
| D2 | Diagnóza a bezpečná oprava | 3 × 8 × 3 | Totéž; spustitelnou reprodukci preferovat tam, kde je proveditelná |
| R1 | Široká revize změny napříč vrstvami | 4 × 8 × 3 | Totéž; potvrdit, že rubric neodměňuje schválení vadného diffu |
| R2 | Rychlá lokální revize s důkazem | 3 × 8 × 3 | Totéž; doložit samostatné skupiny případů místo pouhých opakování |
| CODE | Skutečně bezpečná oprava podle spustitelných kontrol | Jen dílčí technický replay dvou modelů, nikoli plná úloha | Aktivní orákulum u `patch_90eff80ecb8a` přijímá věcný rozpor a odmítá správné alternativy. Celosadový preflight kontroluje 7/7 úloh a zablokuje GPU před inferencí. Připravená v2 čeká na nezávislou významovou přejímku a novou inferenci. |
| CHAT | Obsah, využitelnost, práce s opravou v dialogu a způsob komunikace; formát zvlášť | Starý vývojový panel 10 × 40 × 3; [produkční canary](2026-09-25-HUNT-CHAT-PRODUCTION-CANARY.md) 2 × 4 × 1 dialog se třemi koly | Celá 40úlohová sada pod produkčním promptem, nezávislé hodnocení a kontrola, že scénáře skutečně rozlišují kandidáty |
| VISION | Věcná interpretace 22 různých obrazů a jedna kontrola bez obrazu | 3 modely × 23 úloh × 3 deterministická opakování | Jen 69 různých odpovědí z 207 uložených; autorských 299 sond není nezávislá přejímka. Další vision-capable artefakty chybějí ve sběru. |

U D1, D2, R1 a R2 je [kanonický packet](</mnt/vi7000/intentsmith/evidence/hunt-isolated-20260925/blind/packet.json>) 312 odpovědí / 840 kritérií. Každá odpověď sedí bajtově s nynějším veřejným zadáním a rubrikou; starší SHA rubriky u qwen3.8 neměnilo vstup ani volby inference. Autorské pozitivní a negativní sondy existují pro všech 32 úloh. Zda výřez stačí k závěru a zda jsou sondy věcně správné, musí potvrdit druhá ruka. D1/D2 a R1/R2 sdílejí některé historické případy, ale měří odlišný požadovaný výstup; jejich známky se nepřenášejí mezi rolemi.

Aktuální [CODE preflight](/home/belphareon/worktrees/is-mobile-completion-20260908/src/eval/code-oracle-preflight.js) vrací `CODE_ORACLE_CONTROL_FAILED` přesně u jedné ze sedmi aktivních úloh. Selhávají parafráze, rozpor v jistotě a větve prahu i rychlosti. Zachování bloku je správné chování; přepsání regexu ani přeznámkování starých odpovědí by nedokázalo přijetí nové sady. Referenční návrh v2 je `PREPARED_FOR_REVIEW`, nikoli akceptované orákulum.

Před bodem 3 jsou tedy technicky připraveny surové D/R odpovědi a předvolený vzorek pro operátora; kvalitativní přijetí všech sad a úplné pokrytí 10 modelů nejsou hotové. Během čekání na nezávislé posudky se nové odpovědi nesmí doplňovat pod stejný název bez připnutí SHA veřejného zadání, digestu modelu, provideru a inference profilu.
