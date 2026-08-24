# M2 section 2 — integrační audit před Opus max review

- **Provenance range:** `33cf221c3b772a1002311c8b1f71b67ad0d46cc9..fa437d021e07728388eb61bbca88bcc98e208ddf`
- **Auditovaný integrační head:** `4e9f3a7d7294433e50f3f429634798e3323d6a73`
- **Product remediation:** `60d39810fce974f2c0fd8213ed9014a52d015a62`
- **Module ratchet:** `ab97809b`
- **Výsledek interního auditu:** `6 FINDINGS / CANDIDATE_CLOSED`
- **Nezávislý verdict:** `NOT_AVAILABLE / OPUS_ACCOUNT_LIMIT`

Tento dokument není nezávislé review a nesmí být počítán do `7 OF 7`.

## A1 HIGH — grant constraints nebyly authority na repository/SQL hranici

Issuer odvozoval správné constraints a broker je kontroloval, ale repository
a `trg_m2_approval_grants_exact_scope` ověřovaly jen scope/subject. Přímý batch
consumer proto mohl spotřebovat strukturálně platný grant s jiným
`allowedRealpaths`, pokud jej někdo vložil mimo issuer.

Sdílený `deriveApprovalGrantConstraints` a
`validateApprovalGrantForRequest` nyní vlastní jedinou semantiku. Repository ji
vynucuje při issue i consume; migrace 080 registruje deterministické SQLite UDF,
provede fail-closed preflight existujících řádků a nahradí insert trigger.
Test dokládá, že 077 podvržený řádek ještě přijme, 080 jej odmítne migrovat a
po migraci selže stejná přímá SQL vložka.

## A2 HIGH — neúspěšný fs.write mohl ztratit dotčenou cestu

`validateEffectResultForRequest` původně svazoval s requestem jen success.
Přímý SQL `orphaned` s prázdnými changes a `rollback:not_required` tak mohl
projít semantic triggerem. Validator nyní pro každý `fs.write` vynucuje nulové
process/network evidence, exact path a rollback evidence u applied/ambiguous
výsledku a prázdnou effect evidence u pre-effect failure. `orphaned`/`killed`
bez rollbacku a `lateCompletionRejected` bez rollback authority jsou neplatné.

## A3 MEDIUM — reconnect retry závisel na websocket session

Stejný conversation/operation po reconnectu vytvořil stejný `effectId`, ale
jiné immutable request bytes, protože `origin.sessionId` vznikalo ze surového
websocket session ID. Durable origin nyní používá conversation identity;
surová session zůstává pouze v pending UX řádku a není součástí exact retry.
Sonda opakuje stejnou operaci s novou session, dostane stejný request a ponechá
původní pending bajty beze změny.

## A4 MEDIUM — restart orphan neuváděl známý filesystem target

Recovery znala immutable request, ale zapisovala `changes.paths: []`. Nyní
ukládá přesně `request.target.relativePath`; restart test asertuje cestu,
pending rollback, jediný terminál a nulový replay.

## A5 MEDIUM — beforeDigest hashoval UTF-8 dekódovaný obsah

Filesystem provider četl text a hashoval znovu zakódovaný string. Neplatné
UTF-8 bajty se měnily na replacement znaky, takže evidence nebyla byte truth.
Provider používá descriptor-pinned `readProjectFileBytes`, kontroluje hardlink
z téhož `fstat` a porovnává exact after bytes. Test se vstupem
`ff fe 00 61` potvrzuje digest původních čtyř bajtů.

## A6 HIGH — pozdější execution consumer lhal po applied write/readback chybě

`project-change-runtime` mohl po úspěšném rename selhat až při readbacku,
zařadit cestu k parent rollbacku, ale child EffectResult uložit jako obyčejné
`failed` s nulovým efektem. Helper nyní přenáší rollback evidence; applied nebo
ambiguous forward write je `orphaned`, nese exact path a pending rollback.
Deterministická injekce dvou readback `EIO` potvrzuje nejdřív pravdivý child
terminal a potom úspěšnou parent kompenzaci původních bajtů.

## Focused ověření

- effect contract `20/20`;
- authority repository `45/45`;
- broker `28/28`;
- execution owner `5/5`;
- filesystem consumer `7/7`;
- filesystem runtime `6/6`;
- schema migrations `38/38`, current tip 080 / 70 migrací;
- M1 failover schema `20/20`;
- CRE `10/10`, WS bridge `87/87`, execution loop `61/61`;
- current project-change consumer `18/18`;
- artifact validation `154/154`;
- module boundary ratchet `13/13`, 1 117 hran / 3 cykly / 28 souborů;
- registry `428` programů / 14 exclusions, fingerprint
  `54dce9be3a18ef854097c5919d1471e53f38bf6ef0e828ecc5ff0438f9e302d2`.

První post-migration artifact a module běh pravdivě selhal na odvozeném census
69→70 a jedné nové import hraně. `SYSTEM-MAP`, `ROADMAP` a explicitní
module-edge baseline byly následně aktualizovány; teprve opakované běhy výše
jsou zelené.

## Review stav

Kontrakt zůstává `CANDIDATE_V1`. Exact lokální Opus příkaz musí použít
`claude --print --model opus --effort max --permission-mode plan
--no-session-persistence`, inspektovat provenance range i současné product
bajty a vrátit top-level `REVIEW_PASSED`. Účtový limit nevytváří verdict.
