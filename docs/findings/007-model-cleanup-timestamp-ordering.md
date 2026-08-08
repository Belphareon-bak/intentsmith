# 007 — model cleanup porovnává dva různé timestamp formáty lexikograficky

- **vlastník:** budoucí `WP-M1-MODEL` cleanup-authority checkpoint
- **nalezeno v:** nezávislé read-only review `B3-IDENTITY`
- **stav:** `PENDING-OWNER`
- **závislost:** sjednocená časová reprezentace nebo numerické porovnání

## Evidence

`src/upgrade/model-registry.js:runAutoCleanup()` vytváří cutoff přes
`Date.prototype.toISOString()`, tedy jako `YYYY-MM-DDTHH:mm:ss.sssZ`.
`model_usage.used_at` však běžně vzniká přes SQLite `datetime('now')` jako
`YYYY-MM-DD HH:mm:ss`. Kód oba řetězce porovnává operátorem `>`.

Na stejném kalendářním dni se mezera (`0x20`) řadí před `T` (`0x54`). Usage o
jednu hodinu novější než cutoff proto může být vyhodnocené jako starší a model
může dojít až k delete cestě. Reviewer tuto větev reprodukoval s izolovanou DB
a stubovaným provider deletem; nejde o síťový ani GPU nález.

Aliasový regression test nyní zapisuje recent usage produkčním SQLite tvarem
`datetime('now')`, ale záměrně neleží na 14denní hraně. Pinuje tím canonical
alias join, nikoli dosud neopravenou cutoff chybu.

## Dopad

Nález nemění správnost `name` versus `name:latest` identity a scheduler je dnes
podle evidence dormantní. Brání ale širšímu tvrzení, že age-based auto-cleanup
je bezpečný. Po aktivaci cleanup scheduleru by mohl být čerstvě použitý,
nepřiřazený model smazán dříve než po deklarované ochranné době.

## Acceptance směr

- cutoff i `lastUsedAt` se převedou na validované epoch milliseconds před
  porovnáním; nevalidní čas fail-close zabrání delete effectu;
- boundary test použije skutečný SQLite `datetime('now')` formát na obou
  stranách cutoffu ve stejném kalendářním dni;
- negativní mutace vrátí string comparison a test zčervená;
- řešení se spojí s findingem 006 pod jediným cleanup mutation ownerem, aby se
  zvlášť neopravovala časová a zvlášť atomická autorita.

## Co se v tomto checkpointu neopravuje

`B3-IDENTITY` mění identitu modelu, nikoli retention policy. Oprava cutoffu by
byla samostatná produktová změna mimo schválený identity seam; nález proto
zůstává explicitně `PENDING-OWNER`.
