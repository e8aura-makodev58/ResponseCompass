# Response Compass — Two-Hour Deployment Plan

**Source:** `ResponseCompass_AgentEverywhereHackathon2026_SOW.md` (12 Sep 2026)  
**Objective:** deploy a safe synthetic demo in two hours that lets humans test the dispatch loop live while later features continue independently.

## Delivery principle

Ship one **thin vertical slice**, not a partial implementation of every SOW chapter. The first deployment must be useful, observable, and safe:

1. select one of two isolated Control Rooms;
2. view deterministic synthetic stations, responders, and open issues;
3. pause/resume or trigger an issue;
4. deterministically choose the next issue and eligible responder;
5. offer, accept/reject, or operator-override an assignment;
6. record a public-safe audit/event trail; and
7. persist state across restart.

Everything in the slice uses application-owned facts and deterministic fallback. No provider credentials, external model calls, hidden `ResponderSkill`, real people, or real MES data are required. This is the only path that needs to be complete before human testing begins.

## Scope gates

| Gate | Included in the two-hour deployment | Explicitly deferred until the live slice is stable |
| --- | --- | --- |
| Domain safety | Public projection allowlist; hidden skill server-only; deterministic priority; bounded eligibility; schema/request validation | Case-guided evidence, provider integration, clarifications |
| Tenancy | Two seeded rooms; stable IDs; separate persisted room state; room picker; revision on mutations | Rename UI, failure isolation/migrations, scheduler concurrency hardening |
| Live dispatch | Queue, one active issue per station, offer/accept/reject/override, one active responder assignment, event/audit history | Support rosters, handover, surge staffing, 2-2-3 rotation, temporary repairs |
| Simulation | Paused seed, trigger-next-event, pause/resume, one deterministic tick path | Speed variants, due-token claims, deferred demand, scenario presets |
| UI | Room picker; Live Floor list/map placeholder; issue/station selection; dispatch controls; event feed | Full spatial floor, search, tabs, label collision rules, station-history drill-down |
| Operations | One container, configured HTTP port/data root, non-root, health endpoint, named volume, seed-if-empty | Read-only root filesystem proof, upgrade/relocation tooling, provider-secret store |
| Tests | Hermetic domain/API tests plus one browser happy-path test with provider disabled | Full SOW acceptance matrix and contention/race browser suite |

## Shared contracts: define before parallel work

The foundation owner creates these small, versioned contracts in the first 15 minutes. Other work must consume them rather than invent variants.

```text
RoomState { schemaVersion, roomId, revision, simulatedAt, mode, clockState,
            stations, responders, issues, offers, assignments, events, audits }
Issue     { id, stationId, class, raisedAt, status, priority }
Responder { id, displayName, role, dutyStatus, publicLocation, assignmentId? }
Offer     { id, issueId, responderId, status, createdAt, rankedCandidateIds }
Event     { id, type, occurredAt, publicPayload }
```

Mutation envelope: `POST /api/rooms/:roomId/<action>` accepts `expectedRevision`; a stale revision returns `409` and changes nothing. Public API responses are built from an explicit allowlist. `ResponderSkill` may exist only in a private server-side seed/outcome structure and is omitted from every shared contract, log, payload, test fixture visible to the browser, and audit narrative.

## Two-hour critical path

| Time | Critical-path owner | Deliverable and proof | Human-test value |
| --- | --- | --- | --- |
| 00:00–00:15 | Foundation | Runtime skeleton, two deterministic room seeds, typed state/public projection, atomic file store, `/health` | A restartable, isolated domain base |
| 00:15–00:35 | Dispatch | Deterministic priority + eligible-candidate comparator; create offer; accept/reject/override mutations with revision checks | Tests the central recommendation/dispatch decision |
| 00:35–00:55 | UI | Room picker, room-scoped Live Floor, issue/station panel, action buttons, event feed, polling/refetch after mutation | Operators can exercise the loop without API tooling |
| 00:55–01:10 | Simulation | Paused seed, resume/pause, Trigger Next Event; generated issue validation; one scheduler/tick path | Lets testers create new work safely |
| 01:10–01:25 | Integration | Wire UI to API, browser happy path, two-room isolation check, provider-disabled fallback | A believable end-to-end demo |
| 01:25–01:45 | Deploy | Dockerfile/compose, named data volume, seed-if-empty, health check; deploy to target | Public live-test endpoint |
| 01:45–02:00 | Stabilization | Smoke test, clear known-limitations panel, capture deployment URL/revision in `handover.md` | Humans can begin guided testing |

If a critical-path item slips, cut visual fidelity and simulation sophistication first; do not cut isolation, mutation validation, public redaction, persistence, or the ability to recover from a failed action.

## Independent work lanes after contracts freeze

These lanes may run alongside the live slice or immediately after it. They must not change shared contracts without a decision record and handover entry.

| Lane | Can start | Outputs | Dependency / merge rule |
| --- | --- | --- | --- |
| A — Runtime & persistence | Immediately | app shell, data-root configuration, room registry/store, seed loader, health endpoint | Owns state versioning and atomic writes; other lanes use its repository API |
| B — Dispatch domain | Immediately | priority, eligibility, deterministic ranking/fallback, offers and audits | Works against frozen domain interfaces; no UI changes needed |
| C — Live UI | After endpoint shapes are written | picker, station/issue view, dispatch controls, polling/error states | Uses public API fixtures; never imports private state |
| D — Simulator | After issue/state interfaces are written | clock, deterministic event planner fallback, trigger actions | Must call the same validation/mutation path as manual actions |
| E — Deployment & test harness | Immediately | container, compose, smoke script, hermetic test setup | Must not require provider credentials or production data |
| F — Continuity & workforce | After live dispatch is proven | crew calendar, legality, staffing reviews, handover/replan | Feature-flagged; cannot block basic dispatch |
| G — Case evidence & providers | After public/private boundary tests exist | MES case contract, reproducible retrieval, schema gateway, OpenAI/OpenRouter adapters | Provider failure must retain deterministic dispatch |
| H — Analytics & advanced UX | After canonical event/audit shapes exist | room-snapshot analytics, charts, search/history/map refinements | Read-only consumer of canonical state; no duplicate store |

## Live-test script (handoff at ~01:45)

1. Open the room picker; enter `plant-1` and then `plant-2` in a second browser context.
2. In `plant-1`, trigger an issue or resume one tick. Confirm `plant-2` does not change.
3. Select the active station. Confirm the priority, eligible candidates, deterministic recommendation, and alternative are visible without hidden-skill claims.
4. Accept the offer; confirm a single assignment and corresponding public event/audit appear.
5. Trigger a second issue, reject the initial offer, then use the override action. Confirm only currently eligible responders can be selected.
6. Reload the page/service. Confirm both the room state and audit survive.
7. Attempt the same mutation twice or with a stale revision. Confirm it is rejected rather than silently overwriting state.

## Deployment definition of done

- `docker compose up` exposes exactly one configured HTTP port and a named persistent volume.
- The application runs non-root and reads/writes only the configured data root (plus explicitly mounted temporary storage if required).
- A new empty volume receives synthetic, paused two-room seed data once; a nonempty volume is never merged, reset, or overwritten.
- `/health` succeeds only when the process can serve the room registry; a failed room must not make another room unavailable.
- Provider calls are disabled in the deployment. The recommendation label clearly says `Deterministic fallback`.
- The deployed revision, URL, data-root/volume name, smoke-test result, and risks are recorded in `handover.md`.

## Post-deployment feature order

1. Complete scheduler idempotency, speed controls, issue lifecycle, and ten-item/deferred-demand cap.
2. Add 2-2-3 crews, legal staffing reviews, surge/extension/call-in, and durable handover obligations.
3. Add offline fixed scenario and full public-redaction/concurrency test coverage.
4. Add MES case normalization, bounded deterministic comparable-case retrieval, and factual response-plan options.
5. Add provider adapters and credentials only behind schema validation, stale-result checks, and deterministic fallback.
6. Add analytics from canonical room snapshots, then advanced floor/search/history UX.
7. Finish container hardening, recovery/upgrade procedure, and the complete SOW acceptance matrix.

## Risks and stop conditions

- **Do not deploy** if a browser/API payload exposes hidden skill, raw credentials, internal outcome mechanics, or arbitrary event payloads.
- **Do not deploy** if rooms share mutable state, actions can double-assign a responder, or restart overwrites persisted state.
- A provider integration, workforce model, analytics dashboard, or polished map is not a reason to delay the first live test.
- Record every material SOW deviation in a decision record and cross-link it from `handover.md`.
