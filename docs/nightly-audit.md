# C3 Local Nightly Audit

The nightly audit is a read-only local execution layer around:

- `scripts/nightly-audit.js`
- `scripts/audit-summary.js`

It fetches `origin/master`, resolves one immutable commit, creates a detached
worktree for that commit, installs dependencies there with
`npm ci --legacy-peer-deps`, runs deterministic preflights, then runs the audit
with default blocker enforcement. Candidate mode is not enabled.

Runtime output is kept outside the disposable worktree under:

```bash
/home/belphareon/Projects/c3-nightly-artifacts
```

Disposable automatic worktrees are kept under:

```bash
/home/belphareon/Projects/c3-nightly-worktrees
```

The `--legacy-peer-deps` install flag is temporary dependency debt for the
current dependency graph. Do not edit package files from the nightly service.

## Dry Run

```bash
node scripts/nightly-orchestrator.js --dry-run
```

The dry run prints the resolved source revision, worktree path, artifact paths,
commands, environment isolation, and blocker policy. It does not fetch, create
or delete worktrees, install dependencies, or run tests.

## Install User Units

Install the service and timer without starting anything:

```bash
node scripts/install-nightly-audit-systemd.js --enable
```

This writes:

```bash
~/.config/systemd/user/c3-nightly-audit.service
~/.config/systemd/user/c3-nightly-audit.timer
```

The default schedule is daily at `00:30 Europe/Prague` with
`Persistent=false`. The installer enables the timer only when `--enable` is
provided and never manually starts the service.

## Status

```bash
systemctl --user status c3-nightly-audit.timer
systemctl --user status c3-nightly-audit.service
systemctl --user list-timers c3-nightly-audit.timer
```

## Logs

```bash
journalctl --user -u c3-nightly-audit.service --since today
```

Run artifacts contain durable logs:

```bash
ls -la /home/belphareon/Projects/c3-nightly-artifacts/runs
```

Each run preserves `metadata.json`, `preflight.json` when applicable,
`audit/product-audit/inventory.json`, `audit/product-audit/checkpoint.json`,
`audit/product-audit/report.json`, `summary.json`, and suite logs.

## Manual Start

```bash
systemctl --user start c3-nightly-audit.service
```

The service fails when preflight fails, when the audit runner fails, or when the
summary step fails. Summary still runs after product test failures.

## Disable

```bash
systemctl --user disable --now c3-nightly-audit.timer
```

## Uninstall

```bash
systemctl --user disable --now c3-nightly-audit.timer
rm ~/.config/systemd/user/c3-nightly-audit.service
rm ~/.config/systemd/user/c3-nightly-audit.timer
systemctl --user daemon-reload
```

The orchestrator only removes worktrees that contain a matching
`.c3-nightly-owned.json` marker. Retention only removes completed run artifact
directories whose `metadata.json` identifies `c3-nightly-orchestrator`.
