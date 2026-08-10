# WP-M1 settings notification clobber — Review A evidence

integrationRef: integration/m1-consolidated-20260810
baseRevision: fc86b718e3872176a644ec296e7c6b98c2f5dba3
subjectHead: ebe7ee20981ace44865dd3b29a666e49f859daac
reviewA.verdict: PASS

## Rozsah

F-A chrání přesně devět notification-owned klíčů v `user_settings` před
generic top-level save a převádí generic i notification mutation na existující
`BEGIN IMMEDIATE` seam. Nemění generic GET, import/reset, ostatní RMW writery,
schema, UI ani secret storage.

## Nezávislé Review A

Review ověřilo lineární rozsah
`fc86b718e3872176a644ec296e7c6b98c2f5dba3..ebe7ee20981ace44865dd3b29a666e49f859daac`,
clean/upstream stav, exact allowlist, nulový zásah do zakázaných cest a
aditivní registraci jediné sady. Runtime používá commitnutý snapshot; samotná
maska `*****` je no-op, partial SMTP update zachová ostatní committed hodnoty
a neaplikovatelný clear hostu vrátí pravdivý degraded úspěch.

## Focused evidence

| Příkaz | Výsledek | Exit |
|---|---:|---:|
| `node tests/m1-settings-notification-authority.test.js` | 4 passed, 0 failed | 0 |
| `node tests/m1-model-settings.test.js` | 14 passed, 0 failed | 0 |
| `node tests/m1-model-policy.test.js` | 36 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js --json` | 381 programů, 8 exclusions; fingerprint `665461cccea8f691e6d609c381b21c7bd8b7b2b1ff9932fd4aad42b9552216e0` | 0 |
| syntax čtyř dotčených JS souborů | valid | 0 |
| `git diff --check` | bez whitespace chyb | 0 |

Test má právě čtyři top-level scénáře; široké produktové sady nebyly v Review A
opakované.

## Hranice tvrzení

Generic secret-bearing read, import response, storage/webhook writery,
revision/CAS, F-B reset a oddělená secret authority zůstávají Finding 011.
Electron, GPU, Ollama a externí síť neběžely. Gate 1 zůstává `BLOCKED`.
