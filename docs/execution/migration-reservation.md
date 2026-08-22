# Rezervace čísel migrací — union census 2026-08-22

**Vlastník:** integrační vlastník M1 · **Metoda:** union přes všechny živé větve
· **Platí od:** 2026-08-22

Tento dokument je položka 3 závazné Gate 1 fronty (`ROADMAP.md` §13). Vzniká
proto, aby obě migrační položky fronty — 020 a 015 — dostaly čísla z jednoho
censusu a nekolidovaly spolu ani s žádnou existující větví.

## Změřený stav

```text
git branch -a  (mimo archive/** a recovery/**)   351 větví
union obsazených čísel src/db/migrations/**      001–065, bez jediné mezery
nejvyšší obsazené číslo                          065
```

Kdo drží pásmo nad 054:

| Čísla | Linka | Větve |
|---|---|---|
| 055–060, 063 | mobilní | `wp/mobile-prototype-20260817`, `wp/mobile-refresh-20260809`, `integration/mobile-alpha-20260812`, `codex/mobile-prototype-20260817` |
| 061–062, 064–065 | M1 konsolidace | `integration/m1-consolidated-20260810` a ~120 navazujících `docs/**`, `evidence/**`, `queue/**`, `wp/**` větví |

`wp/mobile-prototype-20260817` drží 050–065 souvisle, protože obě linky nese
zároveň.

## Rezervace

| Číslo | Rozhodnutí | Obsah |
|---|---|---|
| **066** | [020](../decisions/020-m1-model-failover-opt-in-surface.md) | oddělená failover-policy storage, default-off, versioned/CAS řádek |
| **067** | [015](../decisions/015-m1-model-failover-proof-policy.md) | immutable proof run artifact vázaný na PASS proof |

## Proč to nejsou 058 a 059

`ROADMAP.md` §13 bod 5 uvádí `058` = 020 a `059` = 015 a k tomu poznámku, že
`055`–`057` jsou obsazené mobilními migracemi z `d6fee86f`. To platilo, když se
fronta psala. Mobilní linka mezitím pokračovala na `058`, `059`, `060` a `063`
a M1 konsolidace zabrala `061`, `062`, `064` a `065`. Rezervace `058`/`059` by
dnes vyrobila kolizi při prvním merge s kteroukoli mobilní větví.

Přesně kvůli tomuhle fronta žádá **union census přes všechny větve**, ne jen
kontrolu vlastního stromu. ROADMAP je opravená ve stejném commitu jako tento
dokument.

## Jak census zopakovat

```bash
for b in $(git branch -a --format='%(refname:short)' | grep -vE "^archive/|^recovery/"); do
  git ls-tree -r --name-only "$b" -- src/db/migrations 2>/dev/null \
    | sed -E 's#.*/[0-9_]{11}([0-9]{3})_.*#\1#'
done | grep -E "^[0-9]{3}$" | sort -u
```

Před každou další migrací se census pouští znovu. Rezervované číslo, které se
do dvou týdnů nepoužije, se uvolňuje.
