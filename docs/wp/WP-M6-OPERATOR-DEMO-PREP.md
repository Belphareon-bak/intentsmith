# WP-M6-OPERATOR-DEMO-PREP — fail-closed příprava operátorské demonstrace

**Typ:** zapisující M6 přípravný Work Package
**Stav:** `IMPLEMENTED / REVIEW_PENDING / REAL DEMO NOT RUN`
**Integrační vstup:** `8eb56a168fd5af612c3a121dc47ecc7225263cdb`
**Větev:** `codex/m6-operator-demo-integration-20260829`

## 1. Výsledek a hranice

Vzniká zamčený devítikrokový demo plán, validator raw artefaktů a CLI pro
záznam skutečného operátorského pozorování. Příprava nemění server, DB, model
binding, Gate 0 ani probíhající M6 candidate evidence. Nespouští Ollamu/GPU,
nevydává review, demo approval, tag ani release.

## 2. Autoritativní tok

1. `M6OperatorDemoPlan@1` připne exact devět kroků z existující
   `M6_OPERATOR_DEMO_STEPS` autority.
2. Runner je povolen jen ve standalone checkoutu exact kandidáta bez změn
   product cest a s nulovým neočekávaným egressem.
3. Každý krok musí být `PASS`, `FAIL` nebo `NOT_RUN` a nést alespoň jeden
   non-empty, regular, content-addressed raw artefakt pod candidate cestou.
4. Všech devět PASS vytvoří pouze
   `DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL`; ostatní stav je
   `DEMO_INCOMPLETE`.
5. Runner nemá `--approve`, nevytváří
   `docs/review/M6-OPERATOR-DEMO-RESULT.json` a při kompletním pozorování končí
   kódem 2, protože externí approval stále chybí.
6. Samostatný signed-authority verifier povýší demo receipt jen tehdy, když
   `SignedAuthorityReceipt@1` podepsaný rolí `m6-release-operator` sváže právě
   jeden committed observation artefakt a ten znovu projde kontrolou kanonických
   UTF-8 bytes, všech raw Git blobů, candidate/tree/registry identity a complete
   verdictu.

## 3. Vlastněné cesty

`contracts/m6/operator-demo-v1.js`, `src/release/m6-operator-demo.js`,
`scripts/run-m6-operator-demo.js`, focused test, test registry a M6 demo
dokumentace. Integrace do release toku probíhá v Git-native
`signed-authority-bundle-verifier.js`; aplikační release CLI pouze spotřebuje
jeho znovu ověřený výsledek.

## 4. Negativní podmínky

Selže wrong candidate/tree/registry, dirty product path, linked worktree místo
standalone checkoutu, reorder/omission kroku, `FAIL` vydávaný za completion,
neočekávaný egress, path escape/symlink/empty artefakt, změna bytes/digestu,
nekanonické nebo neplatné UTF-8 JSON bytes, wrong role/domain, více či žádný
observation artefakt a forged `APPROVED` projection.

## 5. Ověření

```bash
node tests/m6-operator-demo.test.js
node scripts/run-m6-operator-demo.js --plan
node scripts/validate-test-registry.js
git diff --check
```

Skutečné demo je záměrně `NOT RUN`: vyžaduje hotový M6 candidate, standalone
fresh clone, operátorovu práci ve Studio a následné explicitní user approval.
Tento WP připravuje průkazný postup, nikoli chybějící externí autoritu.
