# Project collaboration and import completion

Input: `2f150ce7f3f183f9e14c3e2522ce150e1fe1c7a1`. Owner: root, isolated
audit snapshot, branch `work/project-flow-20260918`.

Authority: operator request to repair and exercise the complete project flow,
including the clarification that an existing project is a repository created
outside IntentSmith. PRODUCT §3 and CONTRACT §11 apply. GPU hunt remains owned
by the other worker; no changes to its source, measurements, bindings or jobs.

Scenarios:

1. New fan-monitor widget: intent, useful questions and priorities, editable
   concrete file plan, exact M2 approval, implementation and meaningful tests,
   observed result and continuation. An ordinary affirmative answer is never an
   effect approval. Preserve the legacy lifecycle quarantine.
2. External repository: read-only bounded inspection, evidence and limitations,
   strengths/problems, clarify intended goal and next work, propose priorities.
   Opening a repository must not add or overwrite project files or run its code.
3. Another independent new project (weather/news widget), not a second task
   masquerading as the external-repository scenario.

Owned scope: project create/import routes and analysis, project conversation
handler, existing M2 draft adapter and Studio consumer, relevant tests and
documentation. Reuse canonical project context, model gateway, M2 prepare/
approve/execute/test/rollback and memory-policy boundaries. No alternate writer
or inferred execution authority. Existing foreign Git changes stay untouched.
New-project initialization is explicit creation, never import-time adoption.

Validation: focused regressions, real isolated HTTP and Studio journeys,
negative path/approval/privacy/staleness checks, functional generated-project
tests, production Studio build, module boundaries and registered deterministic
gate. Label injected-model evidence separately from real-model evidence. Real
inference uses the shared GPU admission path after checking the current owner.
Record all failures, incomplete journeys and acceptance limits in the packet.

Status 2026-09-18: implementation installed on `5e46fca7`; independent review pending.
Production systemd sandbox BLOCKED by AppArmor; prepared profile requires admin
authentication. Standalone successful local-model widget completion remains unproven.
Full evidence and remaining work: [review packet](../review/2026-09-18-PROJECT-FLOW.md).
