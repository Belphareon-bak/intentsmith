# Opravy nezávislé revize 17. 9. 2026

Autorita: operátor předal reprodukované F1–F6 v externím REVIEW.md; navazuje
na zadání dokončit produkt. Výchozí čistý source `4ee13105`, větev
`work/review-remediation-20260917`. Jde o opravu pozorovaných regresí podle
PRODUCT §2 a CONTRACT §4, nikoli o nové acceptance požadavky.

Výsledek: nastavení paměti řídí skutečné čtení/učení, nepodporované vypnutí
durable historie není potvrzeno jako úspěch; legacy vypnutá historie zastaví
nový chat před persistencí. Automatická legacy paměť respektuje projekt a
projektless konverzaci, historické nescopované položky se neodhadují. Agentí
akce používají native autoritu a zobrazí skutečný výsledek nebo chybu.

Vlastněné cesty: settings/persistence a chat memory consumers; agentí Studio
surface; odpovídající testy a přesně doložené boundary změny; README, INSTALL,
ROADMAP, SYSTEM-MAP a review evidence. Cizí checkouty, provozní obsah a role
modelů se nemění. Specialistická větev se nejprve zkontroluje jako samostatný
kandidát. GitHub publikace pracovní větve není release acceptance.

Ověření: skutečný HTTP chat a restart nad izolovanou DB, nastavení přes obě
autority, negativní mez projektů a výsledný handler/modelový kontext, doslovný
Studio action handler proti native routám včetně odmítnutí; focused, registry,
module boundary, deterministic profil a produkční Studio build. Gate 0 pin
zůstává podle CONTRACT §8 samostatnou release prací, bez přebarvení FAIL.

Stop: nutnost oslabit L0, změnit schválený connector, přepsat cizí práci nebo
destruktivně sjednotit nesouvisející Git historie. Výstup pro operátora a
recenzenta: aktuální stav v ROADMAP/SYSTEM-MAP a jeden navazující review packet.
