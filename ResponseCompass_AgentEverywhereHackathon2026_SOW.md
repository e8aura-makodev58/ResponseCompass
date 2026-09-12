# Response Compass — Build Statement of Work
# Agent Everywhere Hackathon 2026 SOW - 12 Sep 2026

**Status:** Final build specification

**Purpose:** Define the product contract for Response Compass: a manufacturing control-room agent that reads MES-style operational facts, recommends a responder and a grounded response option for one issue, and operates inside application-owned safety rules.

**Build rule:** This document specifies required behavior, boundaries, and acceptance evidence. Implementation language, internal module structure, storage engine, transport, hosting, and directory layout are the implementer's choice except where a requirement below is explicit. A demo may use a fictional MES Simulator as the fact source; a production deployment substitutes a real MES integration without changing Response Compass's role.

## 1. Product and scope

Response Compass shall provide independently selectable manufacturing **Control Rooms** in one deployment. A Control Room is a complete operating context with its own equipment, personnel, issues, assignments, history, clock, policy state, and audit data.

Response Compass shall support bounded queue dispatch, shift continuity, handover, surge staffing, contextual responder assignment, case-guided response options, and drill-down analytics. All demo data must be synthetic and domain-neutral. A production integration may read validated MES facts, but Response Compass shall not directly control machinery, payroll, HR records, or production schedules.

The product answers two application-owned questions in order:

1. Which actionable unresolved issue should receive available capacity next?
2. For that issue, which eligible responder is the best fit?

This is bounded operational dispatch, not enterprise-wide mathematical workforce optimization or automated real-world scheduling.

## 2. Non-negotiable boundaries

- Application code owns facts, eligibility, queue priority, calendars, staffing, metrics, baselines, simulation timing, random draws, outcomes, validation, and every state mutation.
- A model may only propose one bounded operational event, rank an application-supplied eligible candidate set, or choose from application-supplied factual response options. It may provide qualitative tradeoffs and uncertainty. It may not create canonical facts, set priority, select staffing, alter a shift, choose overtime, mutate state, or invoke unrestricted tools.
- `ResponderSkill` is hidden simulation truth. It shall never appear in browser/API payloads, analytics, event-planner input, Response Compass input, audit prose, priority logic, staffing logic, or any responder-specific observable.
- Priority shall use only deterministic issue facts. Neither priority nor staffing may use responder-specific outcome records, hidden skill, or any signal shaped by responder identity.
- Model output is untrusted. The backend shall schema-validate, constrain, and persist only valid application-owned transitions.
- Live and Offline are shared domain paths, not separate applications. Offline must make zero provider calls.
- LLM credentials remain server-side. Demo data shall contain no real people, organizations, facilities, equipment facts, maintenance history, customer data, proprietary rules, or credentials. A production integration must apply its own approved data-governance and access controls.

## 3. Runtime and tenancy

### 3.1 Control Rooms

The room registry shall define at least two rooms, each with a stable machine identifier and an editable human-readable display name (for example `plant-1` / "Plant #1"). The operator experience shall provide a room picker before entering a room, and a room-identity navigation contract that preserves the selected room across reload and direct navigation. A Control Room Management area shall let an operator select another room and rename its display name without changing its stable identifier.

Room state is canonical server state shared by all viewers of the same room. Browsers may view different rooms simultaneously. A room-scoped mutation shall use revision/conflict protection; polling and another viewer's mutation must never silently overwrite an operator's action.

Each room shall have separate state, audit history, hidden truth, random streams, and simulation clock. Identical entity identifiers in different rooms are valid. Provider settings and deployment-level application logs are shared. No room-scoped fact may leak across rooms.

The process shall own one scheduler interval. It shall dispatch room ticks concurrently; a slow or failed room tick must not delay another room. A per-room re-entry guard prevents overlapping ticks for that room.

Each room shall report `READY` or `FAILED` independently. `READY` rooms separately report `RUNNING` or `PAUSED`; a failed room has no clock state. A failed room must be visible as unavailable and must not make other rooms unavailable.

### 3.2 Persistence and lifecycle

Persist canonical state atomically with serialized read-modify-write operations. State shall include versioned schema and policy data, simulation time, random-stream state, equipment, responders, assignments, attempts, issues, historical outcomes, events, recommendations, calendar state, deferred demand, and scenario/audit state.

On restart, simulation resumes at the stored simulated timestamp. It must not advance while stopped and must not create wall-clock catch-up events. Startup reconciliation shall preserve valid state, repair only explicitly defined derived state, and isolate an unresolvable room as `FAILED` rather than guessing or discarding facts.

## 4. Simulation model

### 4.1 Equipment, issues, and lifecycle

Seed a manufacturing floor with stations/equipment across multiple floors and public coordinates. Equipment is `NORMAL` or `ISSUE_ACTIVE`. An unresolved issue opens downtime; downtime ends only after a final successful resolution. Failed attempts and reopen events do not reset the original downtime interval.

An issue lifecycle shall support at least queued/pending work, recommendation or offer pending, assigned work, resolved work, failed/reopened work, and queued handover/replan obligations. Event generation shall not create a second unresolved issue at a station that already has one. Presentation shall nonetheless resolve a multi-issue station deterministically, selecting the oldest issue by raised time and then by stable identifier.

Active rosters permit at most one PRIMARY and one SUPPORT simultaneously. A responder cannot have concurrent active assignments. A resolution record shall retain all unique lifetime contributors to that attempt; this historical contributor list has no artificial maximum.

When a responder moves because of assignment, assistance, transfer, release, resolution, handover, or reconciliation, their canonical location changes once at that event snapshot. Active responders shall render adjacent to the assigned station at deterministic, non-overlapping offsets; released responders return to a persisted duty station. Every real move records a public `RESPONDER_MOVED` event. Response Compass shall not fabricate continuous or per-second tracking.

### 4.2 Hidden truth and outcomes

For every responder and issue class, persist hidden `ResponderSkill` values for true median resolution duration and true success probability. The resolution engine shall use hidden truth plus bounded, persisted deterministic random draws to produce duration and success/failure. Observed outcomes, not hidden truth, become future application-visible evidence.

Observed history must remain capable of disagreeing with hidden truth at small sample sizes and converging only across independent observations. Hidden values remain immutable except for reproducible provisioning of newly created synthetic responders.

A resolution attempt may succeed, fail and reopen through the normal pending path, or be a temporary repair. Force Resolve shall bypass only waiting for the due time; it must consume the same one-shot resolution trigger and use the same outcome logic. It must not guarantee success.

Temporary repairs shall create one dedicated, deterministic recurrence window 30–90 simulated minutes after resolution for the affected equipment. Its recurrence shall produce one new linked issue, not rewrite history or duplicate a current issue. It must not compound general recurrence weighting and shall respect equipment constraints and the actionable-issue ceiling.

### 4.3 Clock, scheduler, and event generation

Expose 1×, 5×, 10×, and 60× simulation speed plus pause/resume. Paused simulation advances neither time nor scheduled work. Changes in speed must preserve ordering and must not duplicate events, offers, resolutions, staffing reviews, or handovers.

Persist all due times and claimable trigger tokens. A scheduler must claim a due trigger before dispatching asynchronous work and be safe to retry after interruption. Scheduled and forced paths must use the same validation and caps.

The event planner may receive bounded, public operational context: simulation time, equipment status, active issues, bounded recent events, recurrence summaries, allowed issue classes, and constraints. It may propose an issue event and descriptive narrative only. The backend validates identifiers, class, equipment eligibility, state transition, and capacity. If the provider fails, is malformed, or is unavailable, a deterministic weighted fallback shall produce a valid event without an API call.

## 5. Workforce continuity and demand

### 5.1 Calendar and personnel

Each room shall model four six-person crews (24 synthetic responders) on a persisted 14-day 2-2-3 rotation, measured from a single anchor timestamp fixed when the room is seeded and persisted thereafter. A/C are complementary day crews; B/D are complementary night crews. Exactly one normal six-person crew is on duty at every 08:00 and 20:00 boundary.

Normal duty is 12 hours. Minimum rest before recall is 12 hours. Continuous duty may not exceed 16 hours. Public responder display names shall follow a fixed, documented three-role convention (`EngrNNN`, `TechNNN`, `OptrNNN`); internal crew metadata must not become a person name.

### 5.2 Staffing review and handover

The application shall run deterministic staffing reviews at 06:00 and 18:00 simulated time, plus explicitly enumerated rechecks after `ISSUE_RAISED`, `ASSIGNMENT_RELEASED`, `ISSUE_ESCALATED`, and `RESPONDER_AVAILABLE`. Each review shall be a persisted, claimable trigger.

Normal staffing is six. Up to two legal surge responders may raise active staffing to eight. A staffing review shall deterministically prefer a legal outgoing-shift extension of up to four hours; only when extension is not selected or not legal may it select one legal off-shift 12-hour call-in. It may instead record no action or unmet staffing risk when no legal capacity exists. A call-in must satisfy rest and duty constraints. Extensions end at their persisted legal end time.

At each 08:00/20:00 handover, unresolved work shall retain priority, age, active roster, current attempt, outstanding work, and staffing decision. Legal work may transfer or promote a support responder. Work without a lawful replacement shall become an explicit queued handover/replan obligation, never be silently dropped, duplicated, or resolved by fabricated history.

### 5.3 Demand queue and priority

Each room permits at most ten actionable unresolved issues, including pending, recommendation-ready, offer-pending, and assigned work. When capacity is full, event generation shall create a deterministic deferred-demand ledger entry rather than an eleventh actionable issue. Deferred demand is visible only in Settings → Demo with a clear note that the limit is a demonstration safety cap. It shall not appear as an active issue, normal feed item, or dispatch candidate.

Actionable priority bands are Critical, High, and Standard. Deferred demand is a separate capacity-ledger category, not an actionable priority band. Priority shall use a deterministic formula over serious synthetic operational risk/impact, issue complexity, and age. Aging promotes lower work to prevent starvation. Critical work must never be demoted below lower-impact work. Planning requirements may inform synthetic impact but are never the sole priority signal.

When capacity becomes eligible, the application selects the next queue item deterministically, then runs bounded per-issue responder selection. A queued issue may survive multiple reviews without losing age, being retriggered, or receiving duplicate offers.

### 5.4 Scenarios

Settings → Demo shall provide Normal operations, Elevated demand, Personnel shortage, Recurring temporary repairs, and Auto. The selected scenario and its revision are canonical room state. Each scenario shall use a persisted deterministic issue-arrival range: Normal 6–45 minutes, Elevated demand 3–22 minutes, Personnel shortage 5–35 minutes, and Recurring temporary repairs 6–35 minutes. Recurring temporary repairs also increases the temporary-repair likelihood. Auto selects a scenario from persisted random state every four simulated hours. No preset alters hidden skill or rewrites history.

Raw random seeds shall not be exposed in ordinary settings. Every scenario transition shall be persisted and auditable, and no scenario change may rewrite a room's persisted random seed or its accumulated history.

## 6. Responder recommendation and dispatch

For an issue selected by the queue, deterministic code shall build a bounded eligible-candidate packet containing public responder identifier/name, distance, travel time, same-class observed count, median resolution time, success rate, reopen rate, and evidence strength. Evidence labels are `NONE` (0), `WEAK` (1–2), `MODERATE` (3–5), and `STRONG` (6+). No-history responders remain eligible.

Packets shall exclude hidden skill, responder coordinates, availability fields, and unbounded history. Provide and audit two deterministic comparators: nearest available, and a documented naive weighted score over travel, observed median time, and success rate without evidence-strength adjustment.

Response Compass may rank only supplied candidates and explain qualitative tradeoffs and uncertainty. Its output must use a strict schema, reference valid identifiers, avoid invented numeric confidence, and compare its first choice with a meaningful alternative. The application revalidates all recommendations after asynchronous model gaps.

Dispatch shall offer the issue to responders one at a time. Acceptance produces the canonical assignment atomically; rejection advances to the next eligible ranked responder; exhaustion returns work to a deterministic rematch queue. A control-room operator may override an offer with another currently eligible responder. A stale recommendation, offer, or browser action must not assign an ineligible responder. When a provider fails, deterministic candidate ordering maintains dispatch. Offline uses a fixture and scripted acceptance without a provider.

Record recommendation winners, baseline winners, agreement/disagreement, evidence-strength role, decision source, offer sequence, confirmation/override, and eventual outcome. UI language must say assigned only after a successful canonical mutation.

### 6.1 Case-guided MES evidence

Response Compass shall operate against a source-neutral MES case contract. In a demo, the MES Simulator supplies synthetic cases; in production, a MES adapter supplies validated observed cases. Each closed case shall retain a stable case identifier, source/provenance, incident context, equipment/station context, broad issue class, observed action, verified result, duration, reopen/recurrence state, and recorded timestamp. The original source record is immutable.

The application shall build case evidence before calling Response Compass. It shall first apply deterministic access, completeness, broad-class, context, redaction, and payload limits. It may then use a deterministic comparable-case method over normalized incident and action details. The first implementation must be reproducible and API-free; embeddings or external retrieval are a separately approved extension.

The model packet may contain at most three personally handled comparable cases per eligible responder, at most three de-identified organization cases, and at most twelve cases total. Off-shift records may contribute only de-identified case knowledge; they must never affect eligibility, roster state, location, or staffing. Failed, reopened, and temporary-fix cases must be available as counterevidence.

The application shall construct factual response-plan options from observed successful cases. Response Compass may select a supplied option or `NO_CASE_SPECIFIC_PLAN`; it shall not invent repair procedures, measurements, hazards, equipment facts, or outcome claims. A case-guided result must contain a full candidate ranking, a selected option or sentinel, valid supporting and counterevidence case identifiers, an evidence-strength label, and uncertainty. Every output property is required and schema-checked; unknown, duplicate, invalid, or null-like references fail closed to deterministic dispatch.

Persist the bounded evidence snapshot used for a recommendation. If candidates or evidence change during model inference, mark the result stale and rebuild the packet. A model's plan selection must not affect simulated duration, success, recurrence, or hidden-skill outcome calculations.

### 6.2 Learning and clarification

Response Compass learns operationally through recorded cases, not by silently changing policy or retraining itself: recommendation → observed outcome → validated case record → evidence for a later comparable issue. Do not claim that an unselected responder would have performed better; outcome comparisons are observational unless supported by an approved experiment.

A clarification capability may ask one short, neutral question only when application-owned rules find a material difference between the selected factual option and the recorded action or verification. The application must limit this to one question per case and one per responder per shift, preserve the original record, and store the reply as separate attributed evidence. A demo may simulate this reply through the MES Simulator; a production integration may obtain it from an approved MES work-order or note channel. An independent responder-chat product is not part of Response Compass.

## 7. Operator experience

### 7.1 Navigation and Control Room management

Provide Live Floor, Analytics, Settings, and Control Room Management. The management view lists rooms with display name, stable identifier, health, mode, and clock state; supports non-destructive rename; and switches rooms through the room-identity navigation contract. Destructive room lifecycle actions are excluded pending dedicated administrator authorization.

Settings shall have API and Demo subtabs. API configuration is deployment-global: provider choice, provider-specific model/reasoning settings, guarded catalog refresh, and secure server-side credentials. A provider key field shall be write-only: it accepts a new or replacement key but never shows the raw stored key after submission. The UI may show only configured state, credential source, and a masked ending, and shall offer an explicit removal action for a settings-managed key. Demo is room-scoped and includes agent activity, simulation overrides, scenario selector, staffing outlook, surge actions, workforce-continuity handover information, deferred demand, and cap explanation. Mode, speed, pause/resume, reset, Trigger Next Event, and Force Resolve shall appear in the Live Floor simulation bar.

### 7.2 Live Floor

The desktop layout shall keep core control-room information and the floor viewport visible without ordinary page scrolling at a defined reference desktop viewport (for example 1920×1200); responsive/mobile or reduced-window layouts may scroll. Floor pan and zoom must be deliberate: normal page navigation must not accidentally pan or zoom the map.

The Manufacturing Floor heading uses title case. The viewport provides floor selection, station/equipment state, current issue/assignment visibility, and safe map focus. Floor labels must avoid collisions: search all usable lanes above an anchor first, then use below-anchor lanes only if upper space is exhausted; leader lines must meet the correct label edge.

Only on-duty personnel (`AVAILABLE`, `OFFERED`, `ASSIGNED`) appear by default on the floor and in **Shift Personnel**. Off-shift personnel remain in a collapsed disclosure. Personnel visuals are neutral by default and highlight only on hover or selection. Selecting a person focuses their map location without replacing the last station selection.

Shift Personnel and **Stations** are tabs. Station rows with active issues appear first; healthy stations are collapsed by default. Selecting a station or a station-focused issue brings the map to the correct floor/station. Clicking an active/waiting issue entry, event-feed issue record, or search result must focus its station and floor.

The right-side panel is **Station Status**. For a station with active work it displays the applicable issue, dispatch, baselines, recommendation, offer/assignment controls, and audit context. For a healthy station it displays public application-derived status, uptime, observed issue count, and MTBF. If multiple active issues share a station, use the oldest by timestamp then identifier. Station metrics must derive from public station/issue/event/clock facts only.

Station Status shall also provide an accessible **Observed issues (N)** history. Show the five newest records first, ordered by raised time then stable issue identifier. Put older records in a collapsed native disclosure. Each record must be a keyboard-accessible control showing its identifier, class, raised time, and current status. Selecting an active record opens the ordinary active-issue view. Selecting a resolved or reopened record obtains its redacted audit on demand and shows chronology, recorded action, and verified outcome. A **Return to Station Status** action returns to the same selected station without moving the map or changing tabs. The history view must not replace or alter independent event-feed selection.

The operational event feed must show selectable public-safe details for issue, assignment, movement, resolution, and system events. Workforce-continuity handovers are durable continuity records shown in the appropriate staffing/Demo context, not ordinary feed entries. Opening event detail shall not lose the last station selection; closing it restores Station Status.

The smart search shall search active issues, all stations, and all personnel including off-shift personnel within the open room. With an empty query it may prioritize context around the selected issue. Typed results are global within that room, not cross-room and not resolved-history search. Display at most five matches per category and state that cap in the search interface.

### 7.3 Analytics

Analytics must be derived from the same canonical room state, never a duplicate data store. It shall present a dashboard hierarchy: key metrics and time/metric charts first, with click-through drill-down to an equipment/station, issue grouping, or appropriate detail. Any operational-flow visualization must label its data source and meaning, be derived from actual canonical data, and provide a meaningful click action; it must not imply simulated flow that is neither defined nor actionable.

Core analytics shall include equipment uptime, completed median downtime, current open downtime, station issue counts/status, active/resolved/reopened issues, issue counts by class/equipment, responder issue-response summaries, Issue-Class Experience, Response Compass-versus-baseline results, and three bar charts: issues raised, issues resolved, and aggregate downtime. The charts shall offer Hour (past 12), Day (past 7, default), Week (past 4), and Month (past 3) views. The workforce presentation shall include backlog by actionable priority, cap-deferred demand, staffing actions, and handover records.

Time to first response, queue-aging trends, aggregate shortage/surge rates, temporary-repair recurrence rates, durable-repair rate, repeat-failure rate, and broader MTBF/observed-interval analytics are out of scope for this specification. They require their own metric definitions, denominator rules, and acceptance tests before becoming required dashboard measures.

Show denominators with rates. Suppress or mark rates with fewer than three observations as insufficient data. Do not performance-sort people, use performance heatmaps, expose employee rankings, or expose hidden truth. Analytics requests shall use one snapshot simulation timestamp; refresh only while Analytics is visible and preserve a selected drill-down across polling.

## 8. API, privacy, and reliability

Provide a room-scoped API contract for room state, simulation controls, issues, assignments, analytics, and audits. Unknown rooms return not found; known failed rooms return a distinct unavailable error. Shared provider settings and deployment logs remain deployment-scoped. Enforce mode errors explicitly: Live-only operations cannot run in Offline and vice versa.

Public projection must use an allowlist. It shall redact hidden skills, contributor weighting, internal resolution mechanics, credentials, and arbitrary event payload data. Event narratives use only approved public fields. Validate request input, method, content type, body size, and schema. Log structured request lifecycle and operational mutation events without secrets.

Provider support shall include at least two independently configured model providers (for example OpenAI and OpenRouter), each with separately persisted model/reasoning configuration and an independently managed credential. Credentials shall use a separate owner-restricted durable store, never the ordinary model-settings record. A settings-managed credential may override a server-managed bootstrap credential for its provider; removing it shall restore that fallback when present. Raw credentials must not appear in browser/API responses, logs, audit records, demo seeds, backups intended for distribution, or error messages. Provider-specific request shapes are centralized. Provider failure, timeout, malformed output, or unavailable credentials must leave canonical state valid and activate deterministic fallback where applicable.

## 9. Offline mode

Offline mode is a deterministic, API-free shared-mode path. It shall present a fixed scenario with predefined issue/candidates, fixed baselines, stored Response Compass output, real offer/assignment/override mutation behavior, public audit data, and exact reset of operational scenario state. It shall require no provider configuration, network, or API credit.

## 10. Deployment and operations

Package Response Compass as one hardened application container on a supported server runtime. Configure one explicit persistent data root holding per-room state/audits, room metadata, provider settings, offline audit records, and deployment-level application events. Every persistence path shall resolve from that single configured root, with a safe local default for development and an explicit mount in production.

Provide a container-orchestration deployment definition that exposes one configured HTTP port and a named persistent volume. The image shall exclude secrets and local runtime data, run as non-root, use a read-only root filesystem, mount temporary writable storage separately, drop capabilities, and enable no-new-privileges. Test-only data-root overrides must be unavailable in production.

An empty persistent volume may initialize a bundled, synthetic, paused demo seed. The seed must contain only room state and room metadata; it must exclude credentials, provider settings, application logs, backups, and machine-specific paths. It must be copied once, and only when no room-state directory exists. Deploying newer application code, restarting, or opening a nonempty volume must never merge, reset, or overwrite runtime state.

Any procedure that relocates or upgrades persisted data shall be explicit and conservative, and shall satisfy these properties: a verified backup exists beforehand; the target is validated before any write; exactly one writer is active during the move; data is copied once rather than merged; every room's health and preserved state is verified afterward; and a documented rollback path remains available. Ambiguous or conflicting data provenance must fail loudly rather than be resolved silently.

## 11. Acceptance and verification

Implementation is acceptable only when the following are automated and demonstrated:

- Unit/integration tests are hermetic: no network and no writes to production data.
- Browser end-to-end tests run with providers forced to fail and make no paid API calls.
- Both Live and Offline exercise the shared domain invariants, and Offline makes zero provider calls.
- Two simultaneous browser contexts prove room isolation: mutations/time in one room do not affect another; provider settings intentionally remain shared.
- A per-room startup or state-upgrade failure isolates to `FAILED` while other rooms serve.
- Pause, restart, all speed changes, scheduled triggers, and forced triggers preserve time/order and fire exactly once.
- No responder is off shift, under-rested, over 16 continuous hours, concurrently assigned, or rendered as on-floor while off shift.
- Handover preserves lawful work; no assignment, offer, history record, or queue item is silently lost or duplicated.
- Sustained contention reaches ten actionable issues; excess demand is deferred only; queued work ages correctly and cannot be double-offered.
- Priority determinism, Critical guardrails, scenario persistence, staffing-review triggers/outcomes, extension/call-in legality, and the single temporary-repair recurrence are reproducible from the same state/random streams.
- Hidden-skill redaction is asserted for every room, public endpoint, model packet, event/audit view, and analytics payload. Provisioning that adds responders leaves already-persisted hidden rows unchanged and generates new rows reproducibly from a dedicated seed.
- Invalid/malformed provider output, provider failure, stale recommendation, competing confirmation, offer rejection, override race, and failed resolution cannot corrupt state.
- Provider credential tests prove write-only browser/API behavior, per-provider replacement/removal, owner-restricted persistence, absence from logs and public state, and safe fallback to a server-managed bootstrap credential where configured.
- MES-case normalization, provenance, source mapping into the case contract, redaction, and observed-action independence from event-planner suggestions are verified.
- Comparable-case retrieval is reproducible, bounded, and redacts off-shift organization evidence. Case-guided model results can select only supplied factual options and valid cited cases; invalid citations fail closed without stopping dispatch.
- Station issue history shows recent records, keeps older records collapsed, opens redacted historical audits on demand, returns to the same station context, and remains independent of event-feed selection.
- Station and personnel selection, floor focus, healthy Station Status, issue Station Status, tab behavior, collapsed lists, search cap note, map label non-overlap, and event-detail restoration are covered in browser tests.
- Analytics measures are reproducible from one state snapshot, exclude open intervals from completed medians, display denominators, and suppress thin-sample rates.
- Container build, orchestration definition, non-root hardening, persistent-volume behavior, data-relocation procedure, health checks on the configured port, and room readiness are verified.

Every material design deviation shall be recorded in the project decision record; each handoff shall state scope, verification, deployment state, and remaining risks.

## 12. Explicit non-goals

- Real people, employment records, labor-law advice, payroll, messaging, or automatic real-world overtime/shift changes.
- Real sensors, real facility maps, real equipment facts, real maintenance/failure history, predictive-maintenance claims, or real production prioritization.
- Generic chat, unbounded autonomous agents, direct model mutation, or model-owned staffing/priority.
- Exposure of hidden truth, employee-performance leaderboards, universal personnel scores, biometrics, demographics, disciplinary data, or HR evaluations.
- Cross-room global optimization, room deletion, or room creation by ordinary operators.
- Automated unsafe data merges, silent conflict resolution during data upgrades, or a separate analytics data store.
