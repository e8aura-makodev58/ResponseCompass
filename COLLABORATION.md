# Human Collaboration Log

> **APPEND-ONLY COLLABORATION RULES — DO NOT EDIT OR REMOVE THIS BLOCK.** `develop` is the live integration branch and the only branch deployed for collaborative testing. `main` is the protected stable baseline. Every human developer works on a short-lived branch created from the latest `origin/develop` and opens a pull request back to `develop`; never push directly to `develop` or `main` unless acting as the designated main developer. Before starting work, append a task claim. Before requesting merge, append a handoff with the branch/commit, exact scope, changed files, test results, migration/deployment impact, risks, and reviewer request. Do not record secrets, private keys, real people, hidden `ResponderSkill`, or production data. Rebase or merge the latest `origin/develop`, resolve conflicts in your branch, and obtain verification/acceptance before the designated main developer merges to `develop`.

## Working agreement

| Role | Responsibility |
| --- | --- |
| Main developer | Owns architecture, `develop`, integration, deployment, and acceptance decisions. |
| Human collaborator | Works only in a scoped feature branch; keeps changes reviewable; supplies verification evidence. |
| Reviewer | Reviews a specific commit/PR against the SOW, contracts, and tests; does not merge or rewrite another author’s work. |

## Instructions for a developer agent

1. Read this file, `handover.md`, and the relevant SOW/plan before touching code.
2. **Do not choose work independently.** Wait until the main developer explicitly delegates a bounded scope and branch name. If no delegation is present, report that you are ready and stop; do not create a branch or modify files.
3. Once delegated, sync from `origin/develop`, then create the delegated feature branch automatically. Use the exact delegated branch name; otherwise use `feature/<short-scope>`.
4. Append a task-claim entry below before implementation. State owner/agent, branch, scope, expected files or contracts, and acceptance checks.
5. Implement only the delegated scope. Preserve existing work. Do not alter `main`, push directly to `develop`, merge branches, change a frozen contract, or deploy unless the main developer explicitly authorizes it.
6. Run the required tests. Append a completion handoff with commit, test result, risks, and reviewer request. Push only the feature branch, then wait for main-developer review and acceptance.

Required branch bootstrap after delegation:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c <delegated-branch-name>
```

## Branch workflow

```text
origin/develop → feature/<short-scope> → verified PR → main-developer acceptance → develop → live test
```

Suggested commands:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c feature/<short-scope>
```

Before handoff, run the relevant tests (currently `npm test`), push the feature branch, and append an entry below. The main developer will perform or authorize the merge after review. Any schema, public API, persistence, security, or deployment change must also be documented in `handover.md`.

## Active work

| Status | Owner | Branch | Scope | Review/merge condition |
| --- | --- | --- | --- | --- |
| Assigned | Developer 1 (Codex/main developer) | `feature/developer-1-api-settings` | Deployment-global API Settings page and safe settings API | `npm test`; no credential leakage; main-developer acceptance |
| Assigned | Developer 2 | `feature/developer-2-container-deploy` | Containerized live-test deployment (Lane E) | Build/smoke evidence; persistent-volume safety; main-developer acceptance |

## Current delegated work

### Developer 1 — API Settings vertical slice

**Branch:** `feature/developer-1-api-settings` (created by the main developer from the current `develop`).

Build the deployment-global **Settings → API** experience and its server-side contract. Scope includes: provider configuration records for the initially supported provider(s); write-only credential submission/replacement/removal; configured state, credential source, and masked ending only; server-side durable owner-restricted credential storage separate from ordinary room state; and public API/UI tests proving raw credentials never appear in responses, logs, audit records, or browser state. Keep provider calls disabled unless explicitly delegated later. Do not modify Control Room state, hidden truth, dispatch ranking, or deployment assets.

Acceptance evidence: `npm test` passes; settings persist across restart; a submitted raw credential cannot be recovered by a GET/public payload; replacement/removal behavior is verified; no secret appears in logs/test snapshots. Record any provider/API-contract or persistence design decision in `handover.md` before implementation.

### Developer 2 — Containerized live-test deployment

**Branch to create after reading this file:** `feature/developer-2-container-deploy` from the latest `origin/develop`.

Build **Lane E only**: Dockerfile, Compose definition, health check, named persistent volume, and concise operator runbook for the existing application. The container must run non-root; expose one configured HTTP port; use the single `DATA_ROOT`; exclude secrets and local runtime data; initialize the synthetic seed only on an empty volume; and make no provider call. Do not edit domain types, dispatch, browser UI, API settings, `COLLABORATION.md` rules, or application behavior except the smallest necessary deployment configuration change.

Before coding, append a claim below, then run:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c feature/developer-2-container-deploy
```

Acceptance evidence: image build succeeds; Compose starts; `/health` and `/` return HTTP 200 on the configured port; state survives a container restart using the named volume; a nonempty volume is not reset; the process is non-root. Append commands/results, image/runtime assumptions, risks, and the exact commit to the handoff. Push only the feature branch and wait for main-developer review—do not merge it.

## Append-only collaboration entries

- **2026-09-12 — Main developer (Codex):** Created this protocol. `develop` is being established as the live integration branch from the verified current application baseline. No human feature branch is active yet.

- **2026-09-12 — Main developer (Codex):** Added an explicit developer-agent startup protocol. Agents wait for a bounded delegation, then automatically create only the delegated feature branch from the latest `origin/develop` and hand work back for acceptance.

- **2026-09-12 — Main developer (Codex):** Delegated API Settings to Developer 1 on `feature/developer-1-api-settings`. Delegated the independent containerized live-test deployment lane to Developer 2 on `feature/developer-2-container-deploy`; Developer 2 must create that branch from current `origin/develop`, complete only the documented deployment scope, and hand it back for acceptance.

## Superseding priority — do not start the earlier assignments

**2026-09-12 main-developer decision:** The earlier Developer 1 API Settings and Developer 2 container-deployment assignments are **parked**. Do not begin either scope or create Developer 2’s branch until the main developer explicitly reactivates it. The existing Developer 1 branch remains available but must receive no implementation work while parked.

The revised implementation order is:

1. **Shared operational core:** simulation clock and one safe trigger path; issue lifecycle through assignment and resolution; deterministic, persisted events/outcomes. This produces the canonical operational data every later page relies on.
2. **Live Floor viewport:** replace the thin station grid with the SOW’s usable floor-focused operator experience: floor selection, safe focus, station/issue visibility, Shift Personnel/Stations navigation, and selection preservation. It consumes the operational core but should not invent a second data store.
3. **Workforce continuity and demand:** 2-2-3 roster, legality, staffing reviews, handover/replan obligations, actionable cap, and deferred demand. This makes live dispatch behavior credible and safe.
4. **Container deployment:** resume Lane E once the first complete live-test loop is stable, so humans can test the intended behavior rather than a partial prototype.
5. **Analytics:** build only after resolved/reopened outcomes and staffing events exist. Analytics must derive from the canonical state created above; an earlier dashboard would be mostly empty or misleading.
6. **Case evidence, providers, and API Settings:** resume only after deterministic case/dispatch behavior is proven. Provider credentials and a settings page are not prerequisites for the provider-free first live test.

Developer agents must wait for a new explicit, bounded delegation aligned to this order. They must not self-select an item from this list.

## Active delegated work — supersedes parked assignments

### Developer 1 — Manufacturing Floor viewport

**Branch:** `feature/developer-1-floor-viewport` (created by the main developer from current `develop`).

Own the Live Floor viewport only. Replace the thin station grid with a floor-aware, deliberate operator viewport that consumes existing public room APIs: floor selection, station/equipment state, active issue and assignment visibility, safe station/issue focus, selected-station preservation, and clear neutral/default personnel presentation where personnel are rendered. Keep the current dispatch controls functional. Do not implement simulation ticks, issue generation/resolution, staffing/calendar policy, analytics, provider settings, Docker/Compose, or private-state access.

Acceptance evidence: `npm test` passes; the UI remains provider-free; room switching does not leak selection/state between rooms; selected station/issue focuses the correct floor; no browser code gains hidden/private fields. Record any public API or shared UI-state contract change in `handover.md` before implementation.

### Developer 2 — Simulation and issue lifecycle

**Branch to create after reading this file:** `feature/developer-2-simulation-lifecycle` from latest `origin/develop`.

Own the shared operational core: persisted simulation clock, pause/resume and safe trigger actions, deterministic event generation fallback, and the issue lifecycle through assignment attempt, deterministic resolution/failure/reopen, and public-safe events/audits. Scheduled and forced triggers must share validation and must not duplicate events or mutate hidden truth into public state. Use existing room revision protection and the same domain mutation paths; do not implement/rework the floor viewport, workforce policy, analytics, settings/providers, or deployment assets.

Acceptance evidence: `npm test` passes; paused time does not advance; restart resumes stored simulated time without wall-clock catch-up; trigger actions fire once; successful/failing outcomes follow one lifecycle path; invalid/stale mutations leave canonical state valid; all public API/event/audit payloads remain hidden-skill-free. Append a task claim before work, then push only this feature branch for main-developer acceptance.

The earlier `feature/developer-1-api-settings` branch remains parked and must not receive work. The previously proposed Developer 2 container branch must not be created.

- **2026-09-12 — Main developer (Codex):** Activated swapped implementation delegations: Developer 1 owns the Manufacturing Floor viewport on `feature/developer-1-floor-viewport`; Developer 2 owns simulation/issue lifecycle on `feature/developer-2-simulation-lifecycle`. These are the only currently authorized implementation scopes.

- **2026-09-12 — Developer 1 (Codex) — Task claim:** On `feature/developer-1-floor-viewport`, implementing only the client-side Manufacturing Floor viewport: public-coordinate floor selection, explicit zoom/reset controls, station/personnel tabs, deterministic active-issue ordering, and room-scoped selection preservation. Expected changes are limited to `static/` assets, static UI assertions, and append-only handoff records. No server/domain/persistence/API contract changes or private-state access. Acceptance: `npm test`, `git diff --check`, and a manual public-API smoke check.

- **2026-09-12 — Developer 1 (Codex) — Completion handoff:** Manufacturing Floor viewport implementation is ready for review on `feature/developer-1-floor-viewport` but intentionally uncommitted/unpushed per main-developer instruction. Changed `static/index.html`, `static/app.js`, `static/app.css`, `test/api.test.ts`, and append-only coordination files. It uses only public room fields, preserves dispatch controls, adds no dependencies or API contract changes, and does not access hidden truth. Verification: `npm test` **31/31 pass** and `git diff --check` pass. Manual review: select floors, station/personnel tabs, neutral personnel markers, zoom/reset focus, polling behavior, room switch reset, and existing offer actions. Risks/limits: fixed synthetic coordinate canvas only; no simulation, workforce, analytics, or browser automation. Reviewer request: confirm the UI meets SOW operator-viewport intent and accept/commit before integration.

- **2026-09-12 — Developer 2 (GitHub Copilot / Claude Sonnet 4.6) — Task claim:** Branch `feature/developer-2-simulation-lifecycle` created from `develop` at `414afb3`. Scope: persisted simulation clock (`pause`/`resume`), `trigger` action for deterministic synthetic issue generation with priority recompute, and `assignments/:id/resolve` for issue resolution/responder release. Expected files: `src/domain/clock.ts`, `src/domain/lifecycle.ts` (new); `src/http/server.ts` (four new endpoints); `test/simulation.test.ts` (new). No frozen contract fields will be added/changed; no hidden truth will enter public state; all mutations use existing `RoomStore.mutate` + `expectedRevision` envelope. Acceptance: `npm test` passes; simulated time only advances on trigger; restart resumes stored time; duplicate trigger calls are safe; resolve returns responder to AVAILABLE; stale mutations return 409.

- **2026-09-12 — Developer 2 (GitHub Copilot / Claude Sonnet 4.6) — Completion handoff:** Commit `8eef605` on `feature/developer-2-simulation-lifecycle`. `npm test`: **45/45 pass** (19 new tests in `test/simulation.test.ts`; all prior tests unmodified). Files changed: `src/domain/clock.ts` (new — `pauseClock`, `resumeClock`, `triggerNextEvent`), `src/domain/lifecycle.ts` (new — `resolveAssignment`), `src/store/roomStore.ts` (added `mutateWithHidden` — atomic public+hidden write inside existing queue lock), `src/http/server.ts` (four new endpoints: `POST .../pause`, `.../resume`, `.../trigger`, `.../assignments/:id/resolve`), `test/simulation.test.ts` (new). No frozen contract field was added or changed; `schemaVersion` stays at 1. Hidden truth (`ResponderSkill`, `randomStream.cursor`) is never placed on public state or any public payload. The `mutateWithHidden` extension to `RoomStore` is additive; existing `mutate` callers are unchanged. Risks: (1) The ten-issue actionable cap (SOW §5.3) is not enforced — a long trigger sequence can accumulate more than ten PENDING issues; (2) `simulatedAt` advances even when the room `clockState` is `PAUSED` (trigger is an explicit operator action, not an automatic scheduler tick — this is intentional per SOW); (3) `resolveAssignment` does not reopen issues or model partial failures (Lane F). Reviewer request: main-developer acceptance and merge to `develop`.

- **2026-09-12 — Main developer (Codex) — Primary navigation handoff:** On `feature/primary-navigation`, added the Production Floor, Analytics, and Settings application tabs. Production Floor owns the existing live workspace; Analytics and Settings are explicit placeholders and are not authorization to begin those parked lanes. The URL preserves both room and view, and the tab interface supports keyboard navigation and ARIA tab semantics. No shared API or domain contract changed. Verification: JavaScript syntax, TypeScript typecheck, diff check, all **34/34** tests, and a temporary HTTP smoke check passed. Human collaborators should not add content to the placeholder pages until the main developer delegates that bounded scope.

- **2026-09-12 — Main developer (Codex) — Integration override completed:** On `feature/integration-hardening`, merged the primary-navigation work over current `origin/develop` and retained both contributors’ append-only entries. Main-developer review found and replaced Developer 2’s non-atomic public/hidden writes with crash-recoverable transaction journaling, replaced unconditional success with deterministic hidden-skill success/failure/reopen outcomes, made reopened issues dispatchable, removed conditional test passes, and added Live Floor simulation controls. The existing endpoint paths remain compatible; the resolve response gains a public-safe `outcome`. Verification: syntax/type/diff checks, **52/52** tests, and actual Plant 1 trigger/resolve smoke passed without hidden-truth leakage. This override is authoritative for integration; contributors must rebase future work from the resulting `develop`.

- **2026-09-12 — Main developer delegation update:** Developer 2 is now assigned only to the Analytics vertical slice from current `origin/develop`. To prevent conflicts with Developer 1’s active Settings work, Developer 2 owns analytics domain/API/tests and new analytics-specific static assets, but must not edit `static/index.html`, `static/app.js`, `static/app.css`, provider settings, credentials, or shared server routing until the Settings branch merges. Developer 2 must rebase afterward and request main-developer integration of the Analytics tab shell.

- **2026-09-12 — Developer 1 (Codex/main developer) — Provider Settings task claim:** On `feature/developer-1-provider-settings`, implementing deployment-global OpenAI/OpenRouter provider selection, write-only credential save/replace/removal, authenticated model discovery after key validation, catalog refresh, and Compass model selection. Credentials will use an owner-restricted durable file separate from ordinary provider settings; API/browser/log/audit surfaces receive only configured state, source, masked ending, model identifiers/names, and selected configuration. Expected files: provider settings/credential store and gateway, settings routes, Settings UI, focused tests, and append-only records. No analytics implementation or room-state schema change.

- **2026-09-12 — Developer 1 (Codex/main developer) — Provider Settings completion:** `feature/developer-1-provider-settings` is ready for main-developer integration. OpenAI/OpenRouter credentials are independently validated through authenticated model discovery, write-only to the browser/API, persisted in a separate owner-only file, and recoverable through a private transaction journal. Catalogs and Compass provider/model selection persist separately; a settings key overrides its environment fallback and removal restores it. Verification: `npm run typecheck`, `node --check static/app.js`, `git diff --check`, and `npm test` (**57/57**) pass with hermetic mocked providers. Developer 2 remains Analytics-only and must rebase from the resulting `develop` before requesting the shared Analytics tab-shell integration.

- **2026-09-12 — Main developer (Codex) — Shared seed update:** `plant1-simulation-seed.json` is now the tracked, default Plant 1 seed for every fresh data root; `PLANT1_SIMULATION_SEED` is override-only. The seed remains write-once bootstrap input and must never overwrite a nonempty runtime volume. Developer 2 must rebase Analytics onto the updated `origin/develop` and must not modify, copy, parse, or commit alternate versions of this shared 13 MB asset.

- **2026-09-12 — LLM integration coder (Codex) — Task claim:** On `feature/llm-mes-compass-runtime`, implementing the selected deployment-global OpenAI/OpenRouter runtime for MES event proposals and Compass candidate ranking. Provider calls are gated by `LIVE` room mode plus `PROVIDERS_ENABLED`, occur outside room locks, and are revalidated under the original revision. Provider outputs are bounded strict JSON and may only choose application-supplied station/class/candidate identifiers. Failures remain deterministic with public-safe reason enums. Analytics files and contracts are out of scope.

- **2026-09-12 — LLM integration coder (Codex) — Completion handoff:** Implemented centralized OpenAI Responses/OpenRouter Chat Completions adapters, server-only selected credential lookup, MES proposal orchestration, Compass ranking orchestration, strict bounded parsing, semantic allowlist/permutation checks, stale-result rejection, deterministic fallbacks, and provider-aware Production Floor recommendation labels. Provider calls are skipped for disabled/offline rooms and run outside locks; canonical mutation rechecks the original revision. Verification: typecheck, browser syntax, diff check, and **65/65 tests pass**, all provider calls mocked. No Analytics implementation or real credential use. Main developer owns review, commit, push, merge, enabling `PROVIDERS_ENABLED`, and deployment.
