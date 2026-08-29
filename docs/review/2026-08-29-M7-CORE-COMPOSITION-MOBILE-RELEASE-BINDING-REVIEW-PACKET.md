# M7 core composition + mobile release binding — review packet

**Požadované verdicts:**

- `CORE_COMPOSITION = REVIEW_PASSED | CHANGES_REQUIRED`;
- `MOBILE_RELEASE_BINDING = REVIEW_PASSED | CHANGES_REQUIRED`.

**Product candidate:** `d43e7ada01d6e5de38a06d79021bde8909d2eba3`

**Product tree:** `7a188be5b2accf29d0ffed322103b5114c7ee85a`

**Review range:**
`1d04bd42bbaa79e9da1fe2b6b59b6589ce8efad5..d43e7ada01d6e5de38a06d79021bde8909d2eba3`

## A. Core composition

Review má sledovat config → authority injection → handler composition →
provider advertisement/result, nikoliv pouze focused fixture:

1. Odmítá composition unknown config, chybějící dependency a built-in
   allow-all authority?
2. Jsou provider scope resolver, project/conversation authorization, mutation
   mediator, cursor key, DB a M1 executor skutečně injektované a nesdílejí
   nepojmenovanou autoritu?
3. Procházejí všechny mutace jedním durable journalem a recovery control plane
   bez možnosti spustit původní effect podruhé?
4. Inzeruje provider právě čtyři úplné capability a zůstanou neúplné
   `approvals/events/notifications` fail-closed unavailable?
5. Zůstávají operation recovery a remote health neinzerovanou control plane,
   nikoliv skrytou osmou capability?
6. Neimportuje composition server, route, session, pairing, listener, network
   nebo credential authority a zůstává `not_active`?

## B. Mobile release binding

Review má sledovat source commit → build transform → APK/AAB extraction →
finální manifest:

1. Je `7cf1c8b7` skutečně předkem `ab1940aa` a přenáší centrální řez pouze
   product/test bytes z `aa8e8440` a `b46062f9`, ne legacy server?
2. Shoduje se všech šest cílových blobů s tabulkou v execution reportu?
3. Vynutí URL configurator právě jeden `connect-src` a odpovídají source a
   generated runtime config přesně?
4. Používá clean-checkout build `cap sync` a nevznikne neúplný Gradle
   dependency graph?
5. Čte evidence z APK i AAB všech pět exact client assets, Capacitor config,
   plugins a network-security resource/tree a porovnává je s Git source?
6. Odmítne jediný stale/substituted asset, origin/CSP drift, nečekanou doménu,
   cleartext změnu a development transport pod production signerem?
7. Zůstává lint spustitelný bez release signing config, zatímco release
   assemble/bundle bez produkčních credentials dál fail-closed?
8. Nezaměňuje unit/archive evidence za device, TalkBack, distribution nebo
   wire-transport důkaz?

## C. Integrační evidence

1. Je harness změna `120 → 121` vědomým důsledkem nového database-reachable
   composition rootu, nikoliv skrytým vyřazením bootstrapu?
2. Odpovídá SYSTEM-MAP census committed JavaScript bytes a registry přesnému
   fingerprintu?
3. Má module graph 1 230 hran / 3 cykly / 28 cyclic files a jsou nové
   composition hrany jednotlivě explicitní?
4. Je rozhodující report nový nesouběžný `333/333 PASS` nad exact candidatem?
5. Jsou oba souběžné reporty ponechané jako `FAIL` a je jejich
   cross-run-interference vysvětlení doložitelné z `sourceTree.porcelain`,
   nikoliv jen tvrzené?

## Minimální reprodukce

```bash
git diff --check 1d04bd42..d43e7ada
git merge-base --is-ancestor 7cf1c8b7 ab1940aa

node tests/mobile-android-release.test.js
node scripts/mobile-gate.js
node tests/m7-core-composition.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/harness-exit-code.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
```

Zelený report:
`.intentsmith-artifacts/m7-mobile-release-binding-isolated-20260829/m7-mobile-release-binding-d43e7ada-isolated/report.json`.
Ověřit SHA-256
`aaa0b98eb2065f8dc85e73756de5e5930eec4855ae9c0ea1161a478c4a441b81`,
source `d43e7ada01d6e5de38a06d79021bde8909d2eba3`, registry
`a316db7caa97b966c557d2f6f4c2934048b0b7351eb1eac22c144e5479f96479`,
verdict `PASS`, exit 0 a counts `333/0/0/0/0`.

Úplný evidence ledger je v
[`m7-core-composition-mobile-release-binding-20260829.md`](../execution/runs/m7/m7-core-composition-mobile-release-binding-20260829.md).

Packet nežádá M7 acceptance a nepovoluje signing, distribution, device test,
session/pairing/listener/transport activation, live LLM/GPU práci, M5/M6
operátorské receipts, rotace, history změny, promotion, tag, publish nebo push.
