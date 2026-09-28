# Agent Note: Worktree-isolated agent board

Status: proposed

English | [中文](2026-09-28-worktree-isolated-agent-board.zh.md)

## Problem

Agent work management is fragmented across single-purpose primitives. `todo_write` replaces a per-session checklist wholesale, plan mode persists one boolean and leaves the plan text in tool-call history, `ctx.goals` owns one durable objective per session, schedules own reminders, jobs track in-flight processes, and the experimental Agent Teams board owns tasks inside one Lead session's log. No primitive is a project-scoped queue: work cannot outlive its creating session, carry dependency edges or write scopes, or start without a human opening a session. The shipped composition gives parallel agents one shared checkout, so overlapping edits are coordinated only by model discipline; the Agent Teams package states that it provides no worktree, merge, or filesystem lock.

## Proposal

A board capability with a definition, durable and worktree providers, and an executor, composed as one family under `packages/board/`.

- `@deepseek-ai/dsh-board` defines `ctx.board`: task records, statuses, the dependency graph, compare-and-set revisions, ready selection, and write-scope conflict detection. It owns no persistence.
- `@deepseek-ai/dsh-board-storage` persists tasks in a `board` storage domain keyed by workspace id and emits `board/changed` after each committed mutation.
- `@deepseek-ai/dsh-board-worktrees` owns git worktree creation, listing, removal, pruning, and merge-back under a configured root outside the repository.
- `@deepseek-ai/dsh-board-executor` watches `board/changed`, selects dispatchable tasks, and starts each one through `ctx.subagents` from its own worktree.
- `@deepseek-ai/dsh-tool-board` registers the model tools, `@deepseek-ai/dsh-command-board` serves a human `/board` command, and `packages/client/ui-board` renders the board in the Web client.
- [Layered agent memory](2026-09-28-layered-agent-memory.md) supplies the per-task context that a dispatched run receives and returns.

### Task model

`BoardTask` carries a branded id, the workspace id, a revision, a title, a description, a priority, labels, a status, `blockedBy` task ids, `writeScopes`, an assignee, an execution record, and memory references. Stored statuses are `backlog`, `in_progress`, `review`, `done`, `cancelled`, and `blocked`. Ready is derived, not stored: a backlog task is ready when every blocking task is done, mirroring the Agent Teams `taskReady` derivation. Every mutation is a compare-and-set on the revision, so two dispatchers cannot claim one task.

### Dispatch and isolation

The executor recomputes the ready set on every `board/changed` and on every settled run. It admits a ready task only while the number of in-progress tasks stays below a configured maximum and the task's `writeScopes` do not overlap any running task; an overlapping task waits in the queue. Each admitted task gets a branch and a worktree, a subagent started with that worktree as its working directory, and a linked session id and job id. On settle the task moves to `review`, never directly to `done`: the completion path attaches the run's changed files and presented deliverables, then notifies the owning session. A failure moves the task to `blocked` with its reason and increments the attempt counter; retry policy is configured. Merging is an explicit `board_complete` operation, so a conflict becomes a blocked task with a recorded reason instead of a silent bad integration.

### Subagent working-directory seam

`SubagentStartRequest` has no working-directory field. In-process children inherit the parent session's `cwd` through `childSessionMeta`, and out-of-process providers accept only a deployment-level `cwd` config. Worktree-isolated dispatch therefore extends the request with an optional validated `cwd` that in-process providers apply to the child session metadata and out-of-process providers apply in place of the parent cwd. This is a Service Definition change: it updates the providers, their tests, the JSDoc, and the SDK projections that carry the request. The alternative, having the executor create child sessions directly with `ctx.agents.create`, duplicates delegation and loses tool filtering, personas, and the durable subagent catalog.

### Composition

The family ships in its own bundle, or as rows in the base and web-app bundles with the dependency declarations `verify-cordis-config` requires. Worktree roots live under `$DSH_HOME`, never inside the repository, and pruning is configured rather than eager.

## Alternatives considered

### Why not extend the Agent Teams board?

The Agent Teams board already models statuses, owners, dependencies, and compare-and-set revisions, but its tasks live in one Lead session's log and its members share one checkout. Extending it in place would either keep the session-scoped lifetime this proposal exists to remove or change the meaning of its durable events for existing replay. The new board borrows its task-graph derivations and leaves the team coordination surface to that package.

### Why not one board per session?

A session-scoped board is what `todo_write` and the Agent Teams board already provide. It cannot survive session deletion, cannot express work waiting for a dependency completed by another session, and has no place to persist across restarts. Project scope, keyed by workspace, is the smallest scope at which queued work outlives one conversation.

### Why not a shared checkout with serialized dispatch?

The executor could bound concurrency to one task at a time on the project checkout and skip worktrees entirely. That removes the merge path but makes every task edit the live tree, so an interrupted or failed run leaves partial changes in the working directory and no run can be reviewed in isolation. Worktrees cost a merge step and disk, and buy rollback, review, and parallel disjoint work.

### Why not auto-merge on completion?

Automatic merge would complete the loop without a human step, but a failed merge mid-loop corrupts the project checkout and hides which task caused it. Review state plus an explicit completion operation keeps every integration a named, auditable act; automation of that step can be layered on later without changing the task model.

## Acceptance criteria

- Two concurrent dispatchers cannot start the same task; the second compare-and-set fails and no duplicate run starts.
- The executor never runs two tasks whose write scopes overlap, and never exceeds the configured in-progress maximum.
- Every dispatched task runs in its own worktree; the project checkout changes only through an explicit `board_complete` merge.
- A settled run moves its task to `review` with linked session, job, changed files, and deliverables; a failed run moves it to `blocked` with a reason and an incremented attempt.
- The subagent `cwd` extension is exercised through the real Loader composition in a product-visible test, and the SDK projections reflect the added field.

## Risks

- Worktree isolation assumes a git repository; projects that are not repositories need the documented shared-checkout fallback or no board execution at all.
- Dispatching agents from a board service crosses the permission boundary of whoever asked for the work; the executor inherits subagent permission scope and cannot widen it, so a denied action must surface as a blocked task rather than an auto-approval.
- Accumulated `review` tasks are the intended safety valve and also an operational cost; an unpruned worktree root grows without a configured cleanup policy.
- A board service that dispatches subagents makes the board a long-lived host service; its own lifecycle, restart recovery, and duplicate-dispatch prevention after a restart need explicit handling.