---
description: "Host-facing board dispatcher that turns ready tasks into delegated subagent runs, for maintainers and deployers automating project work."
kind: "package-reference"
---

# @deepseek-ai/dsh-board-executor

English | [中文](README.zh.md)

## Summary

`dsh-board-executor` turns a board into running work. It plans the tasks that are ready and whose write scopes do not collide with a running task, up to a concurrency limit, claims each under compare-and-set, and starts one delegated subagent run per task. Each run may execute in its own git worktree, so a task edits an isolated checkout instead of the shared one. When a run finishes, the executor moves its task to `review`, or to `blocked` when the run fails. The dispatcher is a Host service; nothing calls it from a model tool yet.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside [`@deepseek-ai/dsh-board`](../board/README.md) and a subagent provider. A Host caller then runs one dispatch pass per board.

```yaml
- name: '@deepseek-ai/dsh-board-executor'
  config:
    provider: spawn
    maxConcurrent: 1
    useWorktrees: true
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required per pass | Named subagent provider; a request may override it |
| `maxConcurrent` | `1` | Maximum tasks allowed in `in_progress` at once |
| `useWorktrees` | `true` | Run each task in its own git worktree |
| `worktreeRoot` | `$DSH_HOME/worktrees` | Directory holding created worktrees |
| `branchPrefix` | `board/` | Branch-name prefix for created worktrees |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-board-executor) is the exhaustive source for the accepted fields.

### How a pass resolves a parent

Each delegated run needs a parent Agent. A pass uses an explicit `parent` when the caller supplies one; otherwise it resolves the task's `createdBy` session through the agent registry. A task whose parent cannot be resolved is skipped, not failed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`planDispatch` is a pure function: it filters ready tasks (status `backlog`, every blocker `done`), orders them by priority then age, and admits each while the in-progress budget allows and its write scopes do not overlap a running or already-selected task. An empty scope set is treated as unknown and conflicts with everything. `runDispatch` then claims each selected task, creates a worktree when isolation is on, starts the run with `cwd` set to that worktree, and settles the task on completion. `WorktreeManager` shells out to `git worktree`.

| File | Role |
|---|---|
| [`src/plan.ts`](src/plan.ts) | Ready selection, WIP budget, and scope disjointness |
| [`src/dispatch.ts`](src/dispatch.ts) | Claim, start, and settle over injected ports |
| [`src/worktrees.ts`](src/worktrees.ts) | Git worktree creation, listing, and removal |
| [`src/index.ts`](src/index.ts) | `BoardExecutor`, config, and the Host-facing `dispatch` call |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Board package](../board/README.md) — the tasks this dispatcher reads and settles.
- [Subagent subsystem](../../../docs/subsystems/subagent.md) — the delegated runs and the `cwd` they accept.
- [Board subsystem](../../../docs/subsystems/board.md) — the task, status, and dependency vocabulary.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the delegated subagent runs it starts.

#### KV Cache effect

Indirect: each child's cache behavior belongs to its own provider; the dispatcher adds no request content of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Dispatch is host-called only: no model tool, command, or `board/changed` trigger starts a pass yet.
- A finished worktree is kept for review and never merged; integration and cleanup are manual.
- Write scopes are compared as exact strings; a glob-aware overlap check is deferred.
- A failed or cancelled run marks its task `blocked`; there is no retry policy or attempt counter yet.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
