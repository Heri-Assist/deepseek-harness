---
description: "Session-header project board list that groups a project's tasks by status from the board Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-board

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-board` puts the project board in the Session header. One action summarizes the open session's project — how many tasks are running or ready to start — and its popover groups the tasks by status: backlog, in progress, review, blocked, done, and cancelled. Each row marks whether a task is ready to start or still waiting on blockers, and shows its priority. The board itself is host-wide and keyed by the working directory the session's project shares, so every session in that directory sees the same board. This package renders it; it owns no task state.

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

The Web bundle mounts it; no configuration is required. The action appears in the Session header whenever a project board has tasks. Opening it reads that project's board through the `board` Remote namespace; a project with no tasks shows the empty board.

### What each part shows

The trigger reads the running count first, then the ready count, then an empty board. The popover lists one group per non-empty status, each task as one row with a status dot, its title, a ready or waiting mark, and its priority. A failed read reports its message; a session with no working directory reads nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`apply` registers the `board` dictionary and one `conversation.session.header.actions` entry. The entry's inject face resolves a session's working directory from the client session list and calls `ctx.remote.board.list`; the component holds only the open/closed and loaded states. The node half is an inert Loader row. No invariant companion is published because the plugin owns only its registrations.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Dictionary and header-action registration, inject face |
| [`src/client/BoardListAction.tsx`](src/client/BoardListAction.tsx) | Header trigger, summary, and columned task popover |
| [`src/client/locales.ts`](src/client/locales.ts) | `board` namespace dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Board controller](../../api/board-controller/README.md) — the Remote namespace this action reads.
- [Board subsystem](../../../docs/subsystems/board.md) — task, status, and dependency vocabulary.
- [Jobs UI](../ui-jobs/README.md) — the header-action pattern this package follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the header summary and task rows are browser UI copy.

#### KV Cache effect

Independent: no request prefix changes when this plugin mounts or updates.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The action is read-only: it lists tasks but cannot create, move, complete, or merge them.
- The board key is the session's working directory; two different directories never share one board, even when they are one repository.
- No live updates: the popover re-reads on open, so a change elsewhere appears only after reopening.
- A session with no working directory shows no board.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
