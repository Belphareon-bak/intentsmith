# WP-M1 standalone chats decommission — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: 5d33a46336489e6d9a09d17a5fd5edf05da76cdc
subjectHead: 1b46d59d3c52859827f0b0b6b0ee7babd1fe2028
reviewA.verdict: PASS

## Rozsah

Standalone `chats/` package je na immutable subjectu fail-closed a pravdivě
označený jako `unsupported / not shipped`. Přímý entrypoint obsahuje pouze
bezpečný ESM main guard; neimportuje DB, HTTP, filesystem ani lokální chats
modul. Jeho jediná direct-execution větev zapisuje non-secret marker
`C3_STANDALONE_CHATS_UNSUPPORTED_NOT_SHIPPED` a nastavuje exit code `78`.

Canonical `/chat-ui` a hlavní server jsou mimo tento subject. Existující chats
DB, WAL, attachments, historie, konfigurace, logy, sessions a backupy se
neotevíraly, nemigrovaly ani nemazaly. `private:true` je pouze ochrana nested
npm package; neprokazuje vyloučení z root archivu, které zůstává u
`M5-PACKAGE`.

## Nezávislé Review A

Nezávislý read-only reviewer ověřil exact base a jediného parenta subjectu,
clean/upstream stav, živý origin, absenci tohoto reportu v subjectu a přesně
pět povolených source/docs cest. Commitnutý obsah je byte-identický se stable
review kandidátem.

Statický call graph nemá cestu k DB, raw settings/reset routes, listeneru,
filesystemu, síti, timeru, scheduleru ani signal handleru. `chats/package.json`
se proti base mění jen v přesně čtyřech povolených hodnotách: `private`,
`description`, `start` a `dev`; oba scripts spouštějí stejný jednorázový
sentinel bez watcheru. Zakázané chats moduly, canonical source, test registry,
root package/lockfile a auth/access boundary zůstávají tree-identical.

`node --check chats/src/server.js` a `git diff --check` byly bez chyb. Review A
nespouštěl behavior, npm, build, externí síť, Electron, GPU, Ollama ani
full-product test.

## Hranice tvrzení

Přímý boot, exact exit/stderr/stdout, nulový listener/proces/handle a byteově
shodný před/po manifest test-owned DB, WAL, attachment a unknown souboru jsou
`NOT RUN`; patří právě jednomu bounded Review B gate nad immutable candidate.
Žádná skutečná uživatelská data se v tomto review nečetla.

Tento PASS není factory delete, privacy erase, root archive exclusion ani
disposition canonical chat UI. Promotion dosud neproběhla; navazující reset
zůstává blokovaný do Review B, report-only evidence a fast-forward promotion.
Finding 011 zůstává `OPEN` a Gate 1 `BLOCKED`.
