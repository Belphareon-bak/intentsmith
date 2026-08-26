# WP-M5-CONDITIONAL-SURFACES — deterministic release set

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / RE_REVIEW_REQUIRED`

**Product revision:** `122b5df5303e08a38cdd62a35e6577b118795c30`

## Release dispozice

| Plocha | Default | M5 release | Required M6 journey |
|---|---:|---|---|
| model discovery | ON | supported | `M6-JOURNEY-MODEL-DISCOVERY-V1` |
| external notifications | OFF | unsupported | — |
| marketplace | OFF | unsupported | — |
| media / ComfyUI | OFF | unsupported | — |
| core auto-update | OFF | unsupported | — |

`M5ConditionalSurfaceDisposition@1` odvozuje tento seznam z přesných boolean
flagů a prostředí. Produkční startup skončí typed chybou
`M5_CONDITIONAL_SURFACE_UNSUPPORTED`, pokud operátor požádá o některou
unsupported plochu. Status neobsahuje hodnotu `C3_UPDATE_REPO`, pouze boolean
informaci, zda byla plocha vyžádána.

Tentýž již normalizovaný manifest je jedinou runtime enablement autoritou pro
model discovery, external notifications, marketplace, ComfyUI i updater.
Server podruhé nečte raw env/config, takže například whitespace
`C3_UPDATE_REPO` nemůže projít preflightem jako OFF a následně spustit timer.

Jediná enabled/supported plocha je navázaná na M5 outbound scope
`model.metadata.read`. Ostatní čtyři nemají implicitní outbound povolení ani
falešný M6 journey. Defaultní server nevytvoří jejich efektové/runtime
komponenty; dormant implementace může zůstat dostupná pro neprodukční vývoj.

## Ověření

- product commit: `122b5df5303e08a38cdd62a35e6577b118795c30`
- `tests/m5-conditional-surfaces.test.js`: 9/9 PASS
- startup pořadí připíná kontrolu před notification, marketplace, media a
  updater inicializací;
- disabled notification factory: žádný externí channel;
- production env s explicitním marketplace flagem: proces končí nenulově s
  pojmenovanou unsupported plochou.

Nejde o M6 journey, nezávislý re-review ani M5 acceptance. Remediation evidence
je v
[`m5-auth-outbound-remote-remediation-20260826.md`](../execution/runs/m5-auth-outbound-remote-remediation-20260826.md).
