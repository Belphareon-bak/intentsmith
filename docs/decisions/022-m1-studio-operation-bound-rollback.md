# 022 — Studio rollback musí být svázaný s přesnou neúspěšnou operací

- **typ:** BLOCK pouze pro akční Studio recovery povrch po `upgrade_verify_failed`
- **stav rozhodnutí:** A PŘIJATO operátorem 2026-08-09 včetně obousměrného
  version-skew požadavku; akční recovery povrch je odemčený
- **WP:** WP-M1-STUDIO / B4 + WP-M1-MODEL / binding application
- **rail:** R1, R2, R3, R5, R6
- **vzniklo při:** návrhu explicitního rollback tlačítka podle 018/Q1+A/Q4+A

## Co už je jisté

Binding application emituje `upgrade_verify_failed` až po ověření, že jde v
daném okamžiku o aktuální operaci. Mezi touto kontrolou, durable zápisem
selhání a synchronním best-effort broadcastem není další `await`; starší
operace tedy nemůže být stale už při samotném emitování.

Akce ale může zestárnout **po** emitování a před kliknutím:

1. stejný target lze znovu ověřit; úspěšná revalidace dnes neposílá clear ani
   success event, takže původní varování může zůstat viditelné nad již
   `VERIFIED` bindingem;
2. po verification failure lze přijmout jiný target. `model_changed` je jen
   best-effort WS notifikace bez replaye, takže odpojený klient ji může minout;
3. dnešní rollback HTTP body nese pouze `{role}` a
   `rollbackManualBinding({role})` při kliknutí vybere právě aktuální operaci.

Repository správně CASuje aktuální desired revision a chrání integritu DB.
Role-only tlačítko by však mohlo konzistentně rollbacknout **novější** operaci,
ne tu, o které uživatele varovalo. Jde o ztrátu uživatelského záměru, nikoli o
porušení repository transakce.

## Varianty

| Varianta | Chování | Dopad |
|---|---|---|
| **A — operation-bound CAS** | Failure event nese `operationId`, `committedBindingRevision` a `failedAttemptRevision`; Studio je vrátí v rollback requestu a repository je atomicky ověří proti aktuálnímu bindingu i nejnovějšímu `FAILED` pokusu. | Přesně vrací operaci, o které uživatel rozhoduje. Stale akce skončí typovaným `409` před runtime/provider efektem. Vyžaduje schválenou adici veřejného eventu a HTTP body. |
| **B — role-only live prompt** | Studio zavolá dnešní `{role}` route a prompt čistí přes best-effort `model_changed`. | Menší diff, ale reverify nebo ztracená notifikace dovolí rollback novější operace. **Nedoporučeno.** |
| **C — ponechat jen varování** | Studio dál zobrazí text a rollback se provede jiným administrativním povrchem. | Bezpečný dnešní stav, ale UI recovery journey a Gate 1 zůstávají blokované. |

## Doporučení

**A.** Akční recovery musí používat stejnou přesnou identitu, jakou chrání
repository; pouhý aplikační precheck nestačí, protože background reverify běží
mimo klikací request. Verification success má navíc emitovat bounded clear
event pro živé UX, ale tento event není autorita — záruku drží transakční CAS.

Minimální kontrakt:

- event: přesná role, model, `operationId`, `committedBindingRevision`,
  `failedAttemptRevision`;
- request: stejné tři identity a přesná role, bez trimování/kanonizace;
- repository: current operation/revision musí sedět a poslední verification
  attempt té operace musí být stále přesně tento `FAILED` pokus;
- stale/malformed/replayed request: typovaný `409`/`400`, nula runtime,
  provider, desired, audit i broadcast efektů;
- Studio: explicitní potvrzení, single-flight, per-role token a stale-response
  guard; žádný automatický rollback;
- success/clear event: pouze UX invalidace, nikoli náhrada CAS.

Povinné negativní testy musí reprodukovat same-target reverify před klikem,
novější different-target apply, ztracený `model_changed`, replay starého
failure eventu, změněnou revision/attempt identitu, double click a non-2xx
odpověď. Odstranění kteréhokoli CAS členu musí odpovídající test zčervenat.

### Obousměrný version skew — operátorská korekce 2026-08-09

Rozšíření failure eventu o `operationId`, `committedBindingRevision` a
`failedAttemptRevision` je aditivní změna veřejného WS payloadu. Nestačí ověřit
jen jeden směr:

- **starý klient + nový event:** neznámá pole se ignorují, klient nespadne a
  dnešní textové varování se zobrazí beze změny;
- **nový klient + starý nebo neúplný event:** klient zobrazí pouze varování a
  akční rollback tlačítko **nikdy** nenabídne bez kompletní přesné identity.
  Chybějící člen identity není důvod k fallbacku na `{role}`.

Druhý směr je ten nebezpečný: cachovaný nový bundle proti staršímu serveru nebo
replayovanému eventu nesmí uživateli nabídnout akci, kterou repository nedokáže
svázat s konkrétní operací.

## Přesná otázka pro operátora

```text
022-recovery-authority: A-operation-bound-CAS
022-event-identity: operationId+committedBindingRevision+failedAttemptRevision
022-stale-action: HTTP-409-before-effect
022-success-clear: best-effort-UX-only
022-role-only: REJECT
022-version-skew: BIDIRECTIONAL-REQUIRED
022-incomplete-identity: WARN-ONLY-NEVER-ACTIONABLE
```

Operátor tento blok přijal 2026-08-09. Rollback tlačítko a rozšířený event se
implementují v rozsahu varianty A.

## Implementační stav

Focused checkpoint implementuje variantu A bez nahrazení obecné rollback cesty
z rozhodnutí 018/Q4:

- nový `POST /api/system/upgrades/recovery/rollback` přijímá pouze přesnou
  čtyřprvkovou identitu; původní `POST /api/system/upgrades/rollback` s `{role}`
  zůstává interním/administrativním povrchem pro obecný non-retryable incident;
- repository ověřuje operaci, desired binding a poslední `FAILED` verification
  attempt v jedné `IMMEDIATE` transakci a zapisuje append-only reversal před
  provider/runtime efektem;
- verification writer ve své transakci znovu CASuje úplný current desired
  tuple. Dvě nezávislá SQLite spojení dokazují oba výsledky závodu: vyhraje-li
  rollback, pozdní verify končí `MODEL_BINDING_VERIFICATION_STALE`; vyhraje-li
  verify, rollback končí `MODEL_BINDING_RECOVERY_STALE`;
- failure a bounded clear event nesou přesnou identitu. Commitnutý Studio
  runtime nabízí dvoukrokové potvrzení, per-role single-flight a token po
  `await`; neúplný/starý event je pouze varování a role-only `model_changed`
  není autorita pro clear;
- role membership používá vlastní exact klíče, takže prototypová jména jako
  `constructor` nikdy nevytvoří akční záznam;
- verification failure nad `USER_ROLLBACK` nemá další schválený reversal, a
  proto zůstává záměrně neúplným warn-only eventem bez akční identity;
- `400`/`409` akci vypnou, síť/`5xx` dovolí pouze nové explicitní potvrzení a
  neúplná nebo identity-mismatched `2xx` odpověď končí `UNKNOWN` bez retry.

Focused testy a cílené mutace pinují repository CAS, `response.ok` i post-await
token. Tento stav ještě není built Electron journey ani celý B4/Gate 1 PASS;
produkční ACK, rozhodnutí 021 a čistý Electron běh zůstávají samostatnými
podmínkami.
