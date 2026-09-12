# Operator-supplied review of web and builder

Source: review pasted by the operator in this conversation on 2026-09-12.
Reviewed checkout: `e87b1ca2219fe330a05c73443a340983ff5410ea`, reported clean.
Scope: both ranges in [the supplied packet](2026-09-12-PROJECT-BUILD-WEB-REVIEW-PACKET.md),
including the complete web implementation predating the old incremental range.
Outcome: **no blocking finding in either reviewed range**. This record preserves
that result; it does not attribute an unstated reviewer model/effort or accept
subsequent changes, physical-model journeys, M5 or the release.

Operator-reported reruns: conversation-web 23/23; lifecycle application service
53/53; Studio surface 24/24; routes 14/14; effect broker 56/56; authority repository
13/13. The operator traced the opaque local transport brand through the real
same-actor M7 denial, DB-enforced projectless scope, URL/DNS/TLS/response limits,
model-only content generation, dependency-cycle 400 and parent preflight. The
fixture schema transaction changes preserved the tested durability boundaries.

Two non-blocking notes are retained:

- `focusedTest.binary` is an operator-chosen canonical absolute executable.
  Containment comes from the approved M2 process sandbox, not a binary allowlist.
  Test presence alone does not establish adequate functional assertions.
- `ipaddr.js` is exactly pinned to 2.4.0 in package and lock. Its classification
  is part of the SSRF boundary: updates require explicit security re-review of
  public/special-use IPv4 and IPv6 classification and DNS/socket pinning, with
  the web negative and real TLS suites. They are not routine dependency bumps.

Excluded by the reviewer: the physically joined Studio → HTTP → durable model
binding → model → approval → execution → process restart journey, and the
usability of `docs/PROJECT-BUILD.md`. Those remain separate work; controlled
fixtures cannot close the physical-model condition. Earlier failed test runs
and archived evidence remain unchanged.
