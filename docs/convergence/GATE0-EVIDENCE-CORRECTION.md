# Gate 0 Evidence Correction

## Superseded attestation

Commit `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab` is retained in history but is
not trustworthy Gate 0 evidence and MUST NOT be used as a release or gate
baseline. It attested candidate
`82dbc3b30ad0c7329182dbe399705d874b004f2e`.

This correction does not claim that every underlying test result was false. It
states the narrower, proven problem: the attestation machinery could not
establish the claims it published.

## Confirmed defects

1. The disposition validator had not yet bound all repaired subject path/blob/
   mode/rationale identities to the candidate.
2. The evidence generator accepted caller-supplied command strings, artifact
   paths and a separately declared execution root.
3. Portable replay used substring replacement and lexical path checks. A no-op
   command, sibling-prefix path, absolute redirection and symlink escape could
   pass those checks.
4. Install evidence trusted duplicate-friendly text markers instead of a
   process-produced typed outcome.
5. Deterministic and soak reports were not bound to their adjacent inventory,
   exact options and actual suite-log contents.
6. G0-C1, G0-C4, G0-C5 and G0-C8 were assigned `PASS` before those facts were
   derived from evidence.

The generated `STATUS.md`, `EVIDENCE-INDEX.json`,
`GATE0-BASELINE-REPORT.md` and `reviews/GATE0-OPUS-REVIEW.md` remain
machine-generated files and are not hand-edited here. Until a new clean
candidate run regenerates them through the repaired path, this correction is
the authority on the old attestation's validity.

## Required superseding path

A later attestation is valid only when all of the following occur:

1. the repaired candidate is committed and clean;
2. `npm run gate0:run-evidence` completes its fixed nine-phase plan below the
   full-HEAD-derived ignored directory from a checkout with no pre-existing
   ignored dependency/build/runtime paths;
3. `npm run gate0:generate-evidence` validates schema-1 producer provenance,
   fixed environment/toolchain isolation, canonical private writable and
   dependency roots, report/inventory/options/result/log identity, both
   validators and the candidate immediately before writing; interruption
   restores the original four tracked outputs;
4. the generated evidence is committed alone with the tested candidate as its
   first parent;
5. `npm run gate0:validate-attestation` verifies that sole parent, exact
   four-file diff, output modes and bound Markdown hashes; reruns registry and
   disposition validation; recomputes inventory and G0-C6/G0-C7 from the
   parent registry, risk blockers and the sanitized privacy binding from parent
   blobs; rejects unknown nested fields and contradictory audit counters; and
   rechecks HEAD/cleanliness;
6. the commit and raw artifact hashes are independently reviewed.

No history was rewritten and the superseded commit was not removed.

## Clean-clone execution finding

The first locked run from candidate
`855fb80095b8f571303fa58ac992a51da3865f6f` correctly stopped with evidence
infrastructure exit 2 after `install-clean`: the installer returned 0 but
created ignored root `projects/` outside the candidate evidence boundary.
That run is retained as red diagnostic evidence and is not a green Gate 0
execution. The follow-up installer repair honors `C3_PROJECTS_DIR` while
preserving `./projects` as the default interactive-install location.
