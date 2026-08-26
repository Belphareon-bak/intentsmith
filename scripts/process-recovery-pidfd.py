#!/usr/bin/python3
"""Linux pidfd authority for one persisted IntentSmith process group.

The pidfd stays open from identity verification through TERM/KILL and the final
empty-group observation. This pins the numeric leader identity so a recycled
PID/PGID can never become signal authority between a /proc check and killpg.
"""

from __future__ import annotations

import json
import os
import re
import signal
import sys
import time


BOOT_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def emit(status: str, reason: str, *, identity_matched: bool = False,
         term_sent: bool = False, kill_sent: bool = False,
         group_state: str = "unknown") -> None:
    sys.stdout.write(json.dumps({
        "authority": "linux-pidfd-v1",
        "status": status,
        "reason": reason,
        "identityMatched": identity_matched,
        "termSent": term_sent,
        "killSent": kill_sent,
        "groupState": group_state,
    }, separators=(",", ":"), sort_keys=True) + "\n")
    raise SystemExit(0)


def parse_positive(value: str, name: str) -> int:
    try:
        parsed = int(value, 10)
    except ValueError:
        raise ValueError(name) from None
    if parsed < 1:
        raise ValueError(name)
    return parsed


def process_group_state(pgid: int) -> str:
    try:
        os.killpg(pgid, 0)
        return "alive"
    except ProcessLookupError:
        return "empty"
    except (PermissionError, OSError):
        return "unknown"


def read_proc_identity(pid: int) -> tuple[int, str]:
    with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as handle:
        stat_text = handle.read()
    close_paren = stat_text.rfind(")")
    if close_paren < 0:
        raise ValueError("invalid-proc-stat")
    fields = stat_text[close_paren + 2:].strip().split()
    if len(fields) <= 19 or not fields[19].isdigit():
        raise ValueError("invalid-proc-stat")
    return int(fields[2], 10), fields[19]


def wait_for_empty(pgid: int, timeout_ms: int) -> str:
    deadline = time.monotonic() + timeout_ms / 1000
    state = process_group_state(pgid)
    while state == "alive" and time.monotonic() < deadline:
        time.sleep(0.02)
        state = process_group_state(pgid)
    return state


def send_group(pgid: int, requested_signal: signal.Signals) -> bool | None:
    try:
        os.killpg(pgid, requested_signal)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return None


def main(argv: list[str]) -> None:
    if len(argv) != 8:
        emit("unresolved", "pidfd_helper_input_invalid")
    try:
        pid = parse_positive(argv[1], "pid")
        pgid = parse_positive(argv[2], "pgid")
        owner_boot_id = argv[3]
        owner_start_identity = argv[4]
        term_grace_ms = parse_positive(argv[5], "termGraceMs")
        kill_grace_ms = parse_positive(argv[6], "killGraceMs")
        expected_contract = argv[7]
    except ValueError:
        emit("unresolved", "pidfd_helper_input_invalid")
    if (expected_contract != "IntentSmithProcessRecoveryPidfdV1"):
        emit("unresolved", "pidfd_helper_input_invalid")
    if (not BOOT_ID_PATTERN.fullmatch(owner_boot_id)
            or not owner_start_identity.isdigit()
            or pid != pgid
            or term_grace_ms > 60_000
            or kill_grace_ms > 60_000):
        emit("unresolved", "pidfd_helper_input_invalid")

    try:
        with open("/proc/sys/kernel/random/boot_id", "r", encoding="utf-8") as handle:
            current_boot_id = handle.read().strip()
    except OSError:
        emit("unresolved", "boot_id_unavailable")
    if not BOOT_ID_PATTERN.fullmatch(current_boot_id):
        emit("unresolved", "boot_id_invalid")
    if current_boot_id != owner_boot_id:
        emit("already_terminated", "boot_changed", group_state="empty")

    if not hasattr(os, "pidfd_open"):
        emit("unresolved", "pidfd_unavailable")
    try:
        pidfd = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        state = process_group_state(pgid)
        if state == "empty":
            emit("already_terminated", "process_group_empty", group_state=state)
        emit("unresolved", "leader_missing_group_not_empty", group_state=state)
    except (PermissionError, OSError):
        emit("unresolved", "pidfd_open_failed")

    try:
        # The pidfd is deliberately opened before /proc verification and stays
        # live until the final observation. Numeric PID/PGID reuse is therefore
        # impossible across any subsequent signal in this helper.
        try:
            observed_pgid, observed_start_identity = read_proc_identity(pid)
        except (OSError, ValueError):
            emit("unresolved", "proc_identity_unavailable")
        if observed_start_identity != owner_start_identity:
            emit("already_terminated", "pid_identity_replaced", group_state="empty")
        if observed_pgid != pgid:
            emit("unresolved", "process_group_identity_mismatch",
                 identity_matched=True, group_state="not_observed")

        state = process_group_state(pgid)
        if state == "empty":
            emit("already_terminated", "process_group_empty",
                 identity_matched=True, group_state=state)
        if state != "alive":
            emit("unresolved", "process_group_unobservable",
                 identity_matched=True, group_state=state)

        term_sent = send_group(pgid, signal.SIGTERM) is True
        state = wait_for_empty(pgid, term_grace_ms)
        kill_sent = False
        if state != "empty":
            kill_sent = send_group(pgid, signal.SIGKILL) is True
            state = wait_for_empty(pgid, kill_grace_ms)
        if state == "empty":
            emit("terminated", "owned_group_reaped", identity_matched=True,
                 term_sent=term_sent, kill_sent=kill_sent, group_state=state)
        emit("unresolved", "owned_group_not_reaped", identity_matched=True,
             term_sent=term_sent, kill_sent=kill_sent, group_state=state)
    finally:
        os.close(pidfd)


if __name__ == "__main__":
    main(sys.argv)
