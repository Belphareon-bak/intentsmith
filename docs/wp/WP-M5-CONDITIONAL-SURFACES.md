# WP-M5-CONDITIONAL-SURFACES — deterministic release set

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

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

Jediná enabled/supported plocha je navázaná na M5 outbound scope
`model.metadata.read`. Ostatní čtyři nemají implicitní outbound povolení ani
falešný M6 journey. Defaultní server nevytvoří jejich efektové/runtime
komponenty; dormant implementace může zůstat dostupná pro neprodukční vývoj.

## Ověření

- product commit: `9abf672c585bf8398de76a375b361e668e859e64`
- `tests/m5-conditional-surfaces.test.js`: 8/8 PASS
- startup pořadí připíná kontrolu před notification, marketplace, media a
  updater inicializací;
- disabled notification factory: žádný externí channel;
- production env s explicitním marketplace flagem: proces končí nenulově s
  pojmenovanou unsupported plochou.

Nejde o M6 journey, nezávislé review ani M5 acceptance.

