# Převod testů klasického UI na aktivní Studio 2

Kontroly backendu a M1 protokolu zůstávají. Kontroly formátu odstraněného UI jsou nahrazené běhy uvedených testů skutečných adaptérů a generované vrstvy. Změněné ovládání relací a motivy odpovídají schválenému UI-SPEC.

## m1-studio-client

Aktivní ověření: `studio2-transport`, `studio2-attachments`, `studio2-session-store`, `studio2-appearance`, `studio2-model-workspace`, `studio2-live-model`, `studio2-conversation-view`.

Převedené požadavky:

- settings never invent installed models from the default portfolio
- history renders every decision and unverified interval while quality stays role specific
- sidebar startup preserves narrow content panels while hiding activity bars
- default Studio identity uses the accessible IntentSmith brand system
- IntentSmith and Clean keep independent palettes and background authority
- authoritative panel hard-requires the generated protocol consumer
- one panel terminal seam renders only ok as assistant and ends every spinner
- canonical send terminal follows conversation ownership after a pane swap
- authoritative panel passes the selected session into cancel
- all three send call sites use one WebSocket-only seam and expose NOT_SENT
- busy gap choices remain visible and create no user or wire effect
- all destructive session transitions invalidate prepared sends before reuse
- new and closed sessions cannot inherit a prior NOT_SENT banner
- ready WebSocket queues each call site once without claiming server acknowledgement
- panel persists only an exact transport-owned invalidation
- persisted Studio bounds are normalized by the function used during restore
- panel makes reconnect exhaustion visible and keeps health offline
- a complete failure event becomes an exact actionable identity
- an incomplete or non-exact event is never actionable
- the panel never rolls back automatically
- specialist focus repaints the center conversation on chat changes
- actual panel subscriptions bind activity to the owner turn and reject another conversation

## desktop-hunt

Aktivní ověření: `studio2-model-workspace`, `studio2-live-model`.

Převedené požadavky:

- Studio progress exposes real task counts and ETA, with raw failures only in collapsed details
- Studio hunt renders queue and skip reason, and cancelled confirmation sends no control request
- Studio grading handles absent acceptance and pins a confirmed source without requesting a new test
- candidate filtering keeps estimates separate from unknown capacity and sorts numeric values
- Studio selected test sends the current exact artifact and role, no arbitrary arguments
- selected test failure stays next to the selected model and role with its actual GPU reason
- open model workspace follows a rotated backend and never renders failed reads as empty data
- late model reads from the disconnected epoch cannot overwrite the recovered result
- LLM settings reject error objects as inventory and keep model management reachable before inventory loads
- download panel polls missed websocket events, shows rate and ETA, and marks stale progress

## model-evaluation-read-model

Aktivní ověření: `studio2-model-workspace`.

Převedené požadavky:

- §4: shipped Studio detail renders an invalid attempt as missing, with its count and reason
- quality tables separate role scores from chronological provider evidence
- shipped score detail exposes preservation failures and separates content from format
- Studio displays captured answers on demand without inventing a grade or rendering answer HTML

## ide-workspace

Aktivní ověření: `studio2-session-store`, `studio2-transport`, `studio2-attachments`, `studio2-workspace-files`, `studio2-appearance`, `studio2-live-model`.

Převedené požadavky:

- closing a conversation keeps its column, file editor and other session identities
- closing a tab never moves another active transport into its index
- closing the last tab retains an empty workspace and dirty editor close is cancellable
- new session editors, output modes and attachment queues are independent
- history and menu surfaces contain no second copy of chat or output panels
- draft snapshots cannot copy a closed conversation draft into its replacement
- opening another entity cannot consume an untouched specialist, draft, attachment, file or terminal workspace
- catalog navigation takes the center even while the owning session keeps an open editor
- late project tree responses stay with their owner and cannot replace the selected session tree
- manual file save refuses an externally changed file and retains the unsaved editor
- manual save keeps edits made while the previous save is still in flight
- split terminal rendering never steals focus; explicit focus stays with its live active owner
- restoring an inactive project reloads its missing tree exactly once on activation
- late system logs belong to the sender, never the currently selected or a closed session
- a background terminal completion cannot move focus out of the selected session
- navigation reveal repairs the dock and collapsing retains an icon rail
- navigation is reopened after saved layout restoration without changing the selected page
- a restored right panel cannot leave blank space beside a catalogue or Settings
- closing a session reduces displayed columns without reindexing another owner
- file arrows select adjacent files only in their owning session and stay bounded
- workspace labels have a Unicode character budget without truncating stored identity
- evaluation matrix keeps missing values distinct from zero and includes every task and total

## m1-model-automation-policy

Aktivní ověření: `studio2-model-workspace`, `studio2-live-model`.

Převedené požadavky:

- the Studio backup surface no longer treats a failure as success

### Další asynchronní kontroly M1 UI

- connection interruption remains visible after authoritative history replacement
- normal and edited sends fail closed for every transport failure and effect-capable prompt
- gap choice failures re-enable the exact choice and never create a fallback effect
- failed async attachment send preserves exact original and newer draft independently
- stale attachment callbacks cannot cross reset, replacement, or identity boundaries
- attachment preparation is single-flight and gap choices cannot overtake it
- pre-wire cancel restores owned input and makes late reader completion inert
- hidden panes, route drift, and focus switches cannot misroute a prepared send
- the rollback request carries exactly the identity and nothing else
- a double click sends exactly one rollback
- a refused rollback keeps the warning and does not retry
- a response that arrives after the action was superseded is ignored
- a dialog pick produces a real File the existing reader can read
- a picked image round-trips as a data URL the policy accepts
- the read is asked for the ceiling that kind of file will actually face
- an oversized pick is refused by name and never enters the attachment list
- a refused read is surfaced rather than attached as an unsendable stub
- a cancelled dialog attaches nothing and reports nothing
- the pick asks the dialog to open where the last one ended
- without the bridge the picker declines instead of inventing attachments
- a dialog that throws leaves the pane untouched
- Studio specialist list uses enabled package IDs independently of expertise flags
- PDF and large HEIC picked by the native byte bridge become complete inline documents
