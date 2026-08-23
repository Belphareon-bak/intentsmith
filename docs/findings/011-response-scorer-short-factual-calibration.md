# Finding 011 — scorer podhodnocuje správné krátké FACTUAL odpovědi

- **stav:** `OPEN / NON-BLOCKING FOR M1 GATE 2`
- **vlastník:** navazující quality calibration WP
- **nalezeno v:** fyzický B5 run
  `m1-b5-quality-ab-20f61f2e-20260823`
- **dopad:** quality telemetry systematicky podhodnocuje část správných
  stručných odpovědí; Decision 024/C brání tomu, aby score samo spustilo druhé
  modelové volání

## Pozorovaný stav

Corpus případ `prague-factual` žádá jednovětou odpověď na hlavní město České
republiky. Model vrátil správnou 40znakovou větu „Praha je hlavním městem České
republiky.“ a při refinement pokusu ji vrátil doslova znovu. Artifact uvádí
baseline i final SHA-256
`f760d83af57fba45e948feed2ca36bc0fe95efb89663267e4bf4a3f43b609693`,
similarity `1`, 12 baseline i refinement output tokenů a score `59 → 59`.
Accepted corpus behavior prošlo.

`response-scorer.js` ale pro intent `FACTUAL` nastavuje `min=30`, `ideal=200`
a `max=2000`. Čtyřicet znaků proto dostane completeness přibližně `0,529`.
Coherence začíná na `0,5` a krátké jednověté odpovědi nezískají body za více
vět, odstavce ani strukturu. Metrika tedy trestá explicitně požadovanou
stručnost, přestože pozorovaná odpověď je správná a splnila corpus anchor.

Po Decision 024/C se na score `59` už nespustí modelový rewrite. Vada ale
přežívá v telemetrii a může zkreslit budoucí L3 agregace nebo jiné rozhodování,
které by scorer použilo bez kalibrace.

## Hranice tohoto findingu

Tento záznam neprohlašuje celý scorer za neplatný a nemění prahy v M1. Čtyři
corpus případy nestačí k nové kalibraci všech intentů. Stejně tak nenavrhuje
výjimku pouze pro jeden prompt; ta by maskovala obecný konflikt mezi explicitní
požadovanou délkou a intent-only length expectation.

## Navazující acceptance

1. Versioned calibration corpus obsahuje krátké i dlouhé správné a nesprávné
   `FACTUAL` odpovědi a explicitní user constraints jako „jednou větou“.
2. Scorer dostane do kontextu zamýšlený response format/verbosity, nebo jiný
   měřitelně doložený mechanismus, který netrestá splnění user constraintu.
3. Překalibrování zachová determinismus a nezhorší existující negativní
   případy; report ukáže before/after distribuci a false-positive/false-negative
   změnu.
4. Žádný produkční efekt ani modelové volání se nesmí řídit touto metrikou,
   dokud kalibrace nemá vlastní přijatý důkaz.
