# Human Collaboration Log

> **APPEND-ONLY COLLABORATION RULES — DO NOT EDIT OR REMOVE THIS BLOCK.** `develop` is the live integration branch and the only branch deployed for collaborative testing. `main` is the protected stable baseline. Every human developer works on a short-lived branch created from the latest `origin/develop` and opens a pull request back to `develop`; never push directly to `develop` or `main` unless acting as the designated main developer. Before starting work, append a task claim. Before requesting merge, append a handoff with the branch/commit, exact scope, changed files, test results, migration/deployment impact, risks, and reviewer request. Do not record secrets, private keys, real people, hidden `ResponderSkill`, or production data. Rebase or merge the latest `origin/develop`, resolve conflicts in your branch, and obtain verification/acceptance before the designated main developer merges to `develop`.

## Working agreement

| Role | Responsibility |
| --- | --- |
| Main developer | Owns architecture, `develop`, integration, deployment, and acceptance decisions. |
| Human collaborator | Works only in a scoped feature branch; keeps changes reviewable; supplies verification evidence. |
| Reviewer | Reviews a specific commit/PR against the SOW, contracts, and tests; does not merge or rewrite another author’s work. |

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
| Ready | Human collaborator | `feature/<scope>` | Next approved scoped feature | Tests pass; handoff entry complete; main-developer acceptance |

## Append-only collaboration entries

- **2026-09-12 — Main developer (Codex):** Created this protocol. `develop` is being established as the live integration branch from the verified current application baseline. No human feature branch is active yet.
