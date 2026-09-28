# Agent Note: Worktree-isolated agent board

Status: implemented

English | [中文](2026-09-28-worktree-isolated-agent-board.zh.md)

## Problem

Agent work management is fragmented across single-purpose primitives. `todo_write` replaces a per-session checklist wholesale, plan mode persists one boolean and leaves the plan text in tool-call history, `ctx.goals` owns one durable objective per session, schedules own reminders, jobs track in-flight processes, and the experimental Agent Teams board owns tasks inside one Lead session's log. No primitive was a project-scoped queue: work could not outlive its creating session, carry dependency edges or write scopes, or start without a human opening a session. The shipped composition gave parallel agents one shared checkout, so overlapping edits were coordinated only by model discipline; the Agent Teams package states that it provides no worktree, merge, or filesystem lock.

## Decision

A board capability family under `packages/board/`, a Host-facing Remote owner under `packages/api/`, and a Web surface under `packages/client/`.

- `@deepseek-ai/dsh-board` defines `ctx.board`: the task record, statuses, the dependency graph, compare-and-set revisions, and ready selection. It owns a version-1 `board` storage domain (one `tasks` table keyed by task id, with the owning workspace on each record) and registers the tools `board_create`, `board_list`, `board_get`, `board_update`, `board_complete`, `board_claim`, and `board_merge`. Mutations run through a process-local serial chain so a compare-and-set never races another write in this process; each committed write emits `board/changed`. Readiness is derived, never stored.
- `@deepseek-ai/dsh-board-executor` dispatches: `planDispatch` selects ready, scope-disjoint tasks within a concurrency budget; `runDispatch` claims each, creates a git worktree, starts one delegated subagent run with that worktree as its `cwd`, and settles the task to `review` or `blocked`; `WorktreeManager` owns worktree creation, listing, removal, merge, and abort. The service discovers each workspace's repository path from the workspace registry and, with `auto: true`, drains one pass per workspace on `board/changed`.
- `@deepseek-ai/dsh-api-board-controller` publishes the `board` Remote namespace for browser reads and compare-and-set writes.
- `@deepseek-ai/dsh-client-ui-board` renders a read-only Session-header list of the open project's tasks, grouped by status.

### Task model

`BoardTask` carries a branded `BoardTaskId`, the owning `WorkspaceId`, a `revision`, a `title`, an optional `description`, a `BoardPriority`, `labels`, a `BoardTaskStatus`, `blockedBy` task ids, `writeScopes`, an optional `BoardAssignee`, an optional creating `SessionId`, and an optional `BoardExecution` (attempt count and the latest worktree path and branch). Stored statuses are `backlog`, `in_progress`, `review`, `done`, `cancelled`, and `blocked`. A backlog task is ready when every blocker is `done`. Every mutation increments `revision`; a stale revision is rejected with `BoardConflictError` before anything changes, and the dependency graph is validated acyclic on every write.

### Dispatch and isolation

The executor admits a ready task only while the number of in-progress tasks stays below the configured maximum and the task's `writeScopes` do not overlap a running or already-selected task. Scope overlap is glob-aware: a literal is tested against the other's glob, and two globs conflict when either static prefix contains the other. An empty scope set is treated as unknown and conflicts with everything. Each admitted task gets a branch and a worktree, a subagent started with that worktree as its working directory, and the execution record on the task. On settle a completed run moves the task to `review`, never directly to `done`; a failed run retries as `backlog` while `maxAttempts` allows and otherwise stays `blocked`. Merging is the explicit `board_merge` operation against the stored branch.

### Subagent working-directory field

`SubagentStartRequest` gained an optional `cwd`. In-process providers record it on the child session in place of the parent's cwd; out-of-process providers use it ahead of the parent and deployment cwd. `SubagentRuntime.start` validates it as an absolute, enterable directory.

### Composition

The family ships through the optional `@deepseek-ai/dsh-experimental-board-bundle`, which inserts the `board` and `board-executor` rows and is listed in `OPTIONAL_BUNDLES`, so the plugin manager offers it switched off.

## Alternatives considered

### Why not extend the Agent Teams board?

The Agent Teams board already models statuses, owners, dependencies, and compare-and-set revisions, but its tasks live in one Lead session's log and its members share one checkout. Extending it in place would either keep the session-scoped lifetime this decision exists to remove or change the meaning of its durable events for existing replay. The board borrows its task-graph derivations and leaves the team coordination surface to that package.

### Why not one board per session?

A session-scoped board is what `todo_write` and the Agent Teams board already provide. It cannot survive session deletion, cannot express work waiting for a dependency completed by another session, and has no place to persist across restarts. Project scope, keyed by workspace, is the smallest scope at which queued work outlives one conversation.

### Why not a shared checkout with serialized dispatch?

The executor could bound concurrency to one task at a time on the project checkout and skip worktrees entirely. That removes the merge path but makes every task edit the live tree, so an interrupted or failed run leaves partial changes in the working directory and no run can be reviewed in isolation. Worktrees cost a merge step and disk, and buy rollback, review, and parallel disjoint work.

### Why not auto-merge on completion?

Automatic merge would complete the loop without a human step, but a failed merge mid-loop corrupts the project checkout and hides which task caused it. Review state plus an explicit merge operation keeps every integration a named, auditable act.

### Why not create child sessions directly instead of extending the subagent request?

The executor could create child sessions with `ctx.agents.create` and set `meta.cwd` itself. That duplicates delegation and loses tool filtering, personas, and the durable subagent catalog. Extending the request kept one delegation path for every caller that needs an isolated checkout.

## Consequences

- The board and executor are two packages: the definition and store, and the dispatcher that consumes them.
- Worktree isolation requires a git repository; a workspace whose repository path is unknown when worktrees are enabled is skipped.
- Dispatch needs a live parent agent; a task whose creator session has ended is skipped until a caller supplies a parent.
- The UI is read-only and re-reads on open; it creates, moves, completes, and merges nothing.
- The board key for the UI is the session's working directory, so two directories never share one board even within one repository.
- A start failure with no run to settle releases the claimed task as `blocked`.
- `auto: true` without a configured provider fails at load.
