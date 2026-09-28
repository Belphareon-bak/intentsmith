# M7 VPN listener and Android release closeout — 2026-09-09

**Stav:** `IMPLEMENTATION_GREEN / DETERMINISTIC_GATE_PASS / REVIEW_PENDING /
REAL_VPN_DEVICE_EVIDENCE_BLOCKED / NOT_ACCEPTED`

## Identita

```text
reviewed base        = b23f63d6b4b7f503a25f2bdaf3f364048432be21
product candidate    = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
candidate tree       = 78fb2adc88ba9a9d2604f8a837bf3d0cd68503a6
review range         = b23f63d6..07b582d1
branch               = codex/m7-mobile-contract-integration-20260829
upstream             = absent
push                 = not performed
```

`b23f63d6` je exact kandidát, na kterém durable limiter a tehdejší M6 registry
ratchet dostaly `REVIEW_PASSED`. Tento closeout nepřenáší verdikt na pozdější
produkční bytes; celý uvedený rozsah čeká na nové nezávislé review.

## Dokončené implementační bloky

1. Disconnected request pipeline skládá admission → durable limiter → fatal
   UTF-8/canonical JSON → podepsanou session/invocation autoritu → private core
   provider. Jedna session revision má nejvýš jednu in-flight invocation.
2. Decision 042 je implementované jako VPN-only TLS 1.3 HTTP/1.1 listener na
   exact rozhraní/adrese a portu 7443. TLS private key i 32bajtový limiter HMAC
   se načítají jen ze jmenovitých systemd credentials; LAN, wildcard, proxy a
   veřejný ingress nemají fallback.
3. Pairing claim vydá jen closure-authenticated local Studio subject. Claim je
   single-use, pětiminutový a raw hodnota se do SQLite neukládá.
4. Session open/refresh/revoke i každá invocation nesou Ed25519 device proof.
   Counter a nonce jsou spotřebované atomicky a durable přes restart.
5. Remote mutation jde přes M2 approval/effect port a mutation mediator;
   conversation command executor mapuje M1 command path do stejného provideru.
6. Android companion používá native HTTPS bez proxy a redirectů, TLS 1.3,
   build-pinned origin a leaf SPKI, fatal UTF-8/canonical JSON a podepsaný
   device/session/invocation protokol. Software Ed25519 seed je at-rest zabalený
   non-exportable AndroidKeyStore AES-GCM klíčem; hardware-backed Ed25519 se
   netvrdí.
7. Mobilní reconnect už nedělá falešný `connected` z OS online eventu. Při
   transportním výpadku zachová jen validovaný native snapshot, mutace zůstanou
   blokované a online stav vznikne až po resume + skutečném health probe.
8. `MobileM7RuntimeEvidence@1` váže fyzickou Android/VPN cestu na candidate
   SHA/tree, APK/AAB digesty a signery, source manifest, origin/SPKI a přesně 13
   seřazených kontrol. Release policy bez zelené content-addressed evidence
   fail-closed odmítne release. Výstup je privátní a non-clobbering.

## Focused evidence

| Hranice | Výsledek |
|---|---:|
| disconnected request pipeline | `7/7 PASS` |
| VPN runtime configuration | `8/8 PASS` |
| TLS listener | `5/5 PASS` |
| production runtime composition | `5/5 PASS` |
| local pairing route + Studio surface | `4/4 + 4/4 PASS` |
| mutation mediator | `5/5 PASS` |
| conversation command executor | `4/4 PASS` |
| session authority | `11/11 PASS` |
| native remote client | `7/7 PASS` |
| mobile app runtime | `1/1 PASS` |
| mobile UI API adapter | `4/4 PASS` |
| Android release boundary | `18/18 PASS` |
| browser accessibility | `22/22 PASS` |
| complete mobile gate | `45/45 PASS` |
| M6 candidate plan | `20/20 PASS` |
| module boundary | `13/13 PASS` |
| artifact validation | `158/158 PASS` |

Registry je validní: 510 programů, 416 ACTIVE, 79 BLOCKED, 15 HISTORICAL,
411 `ACTIVE + required`; deterministic profil obsahuje 277 offline + 73
database programů. Fingerprint je
`73782eec4854f94af66b1f6bf27ea70cee90ed4d173d3da3888eb76f603d5fd9`.
Module graph má 1 273 hran, 3 cykly a 28 souborů v cyklech. Schéma má 95
migrací. `git diff --check`, registry validator a repository hygiene prošly.

## Dva souvislé deterministické reporty

### Fail-closed běh bez toolchain autorit

```text
runId          = 2026-09-08T22-34-02-636Z
sourceRevision = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
result         = 342 PASS / 0 FAIL / 0 TIMEOUT / 8 BLOCKED / 0 SKIPPED
verdict        = BLOCKED / exit 2
reportSha256   = e23201c9de5d89926e0959e92496031d486ac7a03e7f834c3a7e92be328e2f80
```

Osm blockerů je přesně deklarovaných: dva PDF, tři M2 execution, M2 lifecycle,
M5 process hardening a workspace budget. Vyžadují jen pojmenované lokální
`python-pdf-runtime`, `git`, `bwrap`/`bubblewrap` a `prlimit`. Tento report se
nepřebarvuje ani nemaže.

### Kandidátním plánem povolená deterministic fáze

```text
runId                = 2026-09-08T22-41-31-787Z
sourceRevision       = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
startedAt            = 2026-09-08T22:41:31.827Z
endedAt              = 2026-09-08T22:45:45.963Z
result               = 350 PASS / 0 non-PASS
verdict              = PASS / exit 0
registryHash         = 73782eec4854f94af66b1f6bf27ea70cee90ed4d173d3da3888eb76f603d5fd9
inventoryFingerprint = 3ad39250baad4bab86f04d1668fe4cdba4a7a35843a109593eb03729d85e4d28
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = 72f8c9e79fcac8ea598206040e50e07e0e80c557e17fa41f80be41f67f62cc96
```

Povolené autority byly jen exact
`toolchain:{python-pdf-runtime,bwrap,git,bubblewrap,prlimit}`. `noBlock` zůstal
`false`, concurrency 1 a profily byly jen `offline,database`.

Raw report:

`.intentsmith-artifacts/m7-vpn-android-closeout-20260909/2026-09-08T22-41-31-787Z/report.json`

## Co zůstává blokované

- nezávislé technické review rozsahu `b23f63d6..07b582d1`;
- produkční TLS/HMAC credentials a jejich systemd ceremony;
- skutečné VPN rozhraní, bind, firewall/no-public-ingress evidence;
- fyzický API 29+ telefon, single-use pairing, restart/replay, offline/reconnect,
  wrong-SPKI a approval journey;
- release APK/AAB signing, retained artifacty, instalace/distribuce a TalkBack
  device matice;
- M5 privacy receipts/rotace/history disposition a M6 acceptance/demo/Gate 0;
- live LLM/chat quality, Ollama a GPU podle operátorského odkladu.

Neproběhla změna systemd, firewallu, VPN, produkčních secrets, telefonu, historie,
tagu, publish ani push.
