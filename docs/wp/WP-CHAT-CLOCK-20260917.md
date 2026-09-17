# Aktuální časový kontext chatu — 17. 9. 2026

Autorita: operátor doložil chybnou odpověď na „a datum?“ a upřesnil, že chce
obecnou orientaci v datu pro každý dotaz včetně včera/dnes/zítra. Vstup
`e0b75ee4`, vlastněná větev `work/chat-date-context-20260917`.

Rozsah: společná tvorba interaktivního modelového požadavku, lokální date
routing/formatování, regresní ověření a instalace opravy. Datum pochází ze
systémových hodin backendu a jeho časového pásma; žádná hodnota z historie
nenahrazuje aktuální referenci. Historické či hypotetické datum v zadání si
zachovává význam. Modelové benchmarky, bindingy a jejich kontrakty se nemění.

Ověření: výstupní provider payload pro obecný dotaz, nové datum při dalším
požadavku po půlnoci, kalendářní posuny přes DST/rok/přestupný den, skutečný
HTTP follow-up bez modelu, registry/boundary a úplný deterministický profil.
Release seal zůstává samostatnou release prací podle CONTRACT §8.
