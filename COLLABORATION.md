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
