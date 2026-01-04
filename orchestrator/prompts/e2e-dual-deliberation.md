GOAL
Design a lightweight but powerful desktop/web UI for the C.3 backend.

CONSTRAINTS
- Backend is authoritative. UI must NOT infer or compute state.
- UI only renders backend events and artifacts.
- Long-running executions must survive reload.
- No dependency on VS Code or IDEs.
- UI must support multiple projects and session resume.

REQUIRED OUTPUT
- Clear layout description (main prompt area, sidebars, settings).
- Interaction flow for:
  - new project
  - existing project
  - resumed execution
- Explicit list of what UI must NEVER do.
- Assumptions and next steps.

IMPORTANT
- This is a CONCEPT task.
- No code.
- No implementation details.
- Output MUST be suitable for final DECISION artifact.
