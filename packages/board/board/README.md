---
description: "Project-scoped agent task board with dependency-ready selection and compare-and-set writes, for maintainers and deployers orchestrating work across sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-board

English | [中文](README.zh.md)

## Summary

`dsh-board` gives a project one durable queue of work that survives a Session: tasks with a title, priority, labels, dependency edges, and intended write scopes. A task moves through `backlog`, `in_progress`, `review`, `done`, `cancelled`, and `blocked`; readiness is derived from the dependency graph rather than stored, so a task is ready exactly when every blocker is done. Every mutation is a compare-and-set on a revision, so two callers cannot silently overwrite each other. Tasks are stored per workspace, so the board is shared by every Session working in that directory. Use it to track multi-step agent work across conversations.

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

Mount it after the storage hub provides a backend and the domain facility. A live root Agent then receives the board tools.

```yaml
- name: '@deepseek-ai/dsh-board'
  config:
    maxTasksPerWorkspace: 256
```

| Field | Default | Meaning |
|---|---|---|
| `maxTasksPerWorkspace` | `256` | Tasks retained per workspace; a create past the cap is rejected |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-board) is the exhaustive source for the accepted fields.

### What each call does

`board_create` adds a `backlog` task. `board_list` reads a board, optionally only the ready tasks. `board_get` reads one by id. `board_update`, `board_complete`, `board_claim`, and `board_merge` change one task and require the current revision; a stale revision fails and the caller must re-read. `board_merge` closes a reviewed task as `done` and can record an integration note. A dependency cycle, a missing blocker, a self-block, and a write past the cap are rejected before anything is stored.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`BoardService` opens the version-1 `board` storage domain and keeps one `tasks` table keyed by task id, with `workspaceId` on each record. Mutations run through a process-local chain, so a compare-and-set never races another write in this process; each committed write emits `board/changed`. Readiness is a pure function of the task and its blockers, and the dependency graph is validated as acyclic on every write. No invariant companion is published because the service validates its own graph and revisions.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `BoardService`, config, graph validation, ready derivation, serialized CAS mutations |
| [`src/schema.ts`](src/schema.ts) | The version-1 board domain schema |
| [`src/types.ts`](src/types.ts) | Task, status, priority, assignee, and input types |
| [`src/tools.ts`](src/tools.ts) | The `board_*` tool schemas |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Board subsystem](../../../docs/subsystems/board.md) — task, status, and dependency vocabulary.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the durable storage hub this board stores through.

-----

<a id="model-experience"></a>
## Model Experience

### Board tools

#### What the model sees

A live root Agent gains `board_create`, `board_list`, `board_get`, `board_update`, `board_complete`, and `board_claim`. Each task appears as `- <id> r<revision> [<status>/<priority>] <title>`, with blockers when present. The schema source is [`src/tools.ts`](src/tools.ts).

#### Token effect

Six tool schemas join every live root Agent request; listing returns one line per matching task.

#### KV Cache effect

The six schemas change the request prefix once when the plugin mounts. Listing results are tool-result content after that prefix, so existing cache entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Automatic dispatch is deferred: the board records and selects ready tasks but does not itself start agents, create worktrees, or merge results.
- Write scopes are advisory: the board stores them for a future dispatcher to serialize on; nothing enforces path ownership today.
- Nothing consumes the board's tasks after a Session ends unless a caller keeps reading; there is no scheduler, retry policy, or notification yet.
- The board is read and written through tools only; no Web board UI ships yet.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
