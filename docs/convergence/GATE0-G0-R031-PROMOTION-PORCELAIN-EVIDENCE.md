# Gate 0 — G0-R031 promotion porcelain evidence

## Scope

This record covers the fail-closed rejection discovered after the valid
one-file review-result commit `ca46340c63bec9c96df1bf3eaa4f29b3822dac7d`.
The reviewed candidate and pending attestation remained unchanged, and the
writer restored all four generated outputs after the failed postcondition.

## Reproduction

From a clean review-result worktree:

```text
$ npm run gate0:promote-review
Error: Gate 0 review promotion failed: review promotion must leave exactly four tracked modified outputs
exit 2
```

The writer compared the four expected unstaged porcelain rows with output from
a helper that called `trim()`. Git's first unstaged row begins with a space in
column one (` M path`); `trim()` changed only that first row to `M path` and
made the otherwise exact comparison impossible.

Post-failure verification:

```text
$ git status --short --branch
## codex/s1-legacy-loopback-containment...origin/codex/s1-legacy-loopback-containment [ahead 1]
exit 0
```

No generated output remained modified after rollback.

## Repair contract

- Git command output removes trailing whitespace only.
- The leading two-column porcelain status is preserved byte-for-byte.
- Scalar Git outputs such as `rev-parse` remain newline-normalized.
- The promotion writer must still leave exactly the four locked unstaged
  outputs and no staged or untracked file.

## Focused verification

Both executions used the same worktree and dependencies. The mutation changed
only `normalizeGitOutput()` from `trimEnd()` back to `trim()` and was restored
after the red run; the repaired source SHA-256 was identical before and after
the mutation.

| Command | Source | Result | Exit |
|---|---|---|---:|
| `node tests/artifact-validation.test.js` | repaired `trimEnd()` | 147 passed, 0 failed | 0 |
| same command | mutation `trimEnd()` → `trim()` | 146 passed, 1 failed; exact porcelain-column regression failed | 1 |

The focused suite was executed outside the managed process sandbox because its
intentional subprocess fixtures otherwise receive host-policy `EPERM`; that
environmental restriction is not a product result.
