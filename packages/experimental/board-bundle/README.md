---
description: "Add the project task board and its dispatcher from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-board-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle inserts the two board rows the shipped composition leaves out: `board`, which owns durable per-workspace tasks and registers the board tools, and `board-executor`, which dispatches ready tasks to delegated runs. Shipped profiles leave it switched off.

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

Select Task Board in the Plugins list. A live root Agent then receives `board_create`, `board_list`, `board_get`, `board_update`, `board_complete`, and `board_claim`, and the Host gains `ctx.boardExecutor.dispatch` for driving a board. The base composition supplies durable storage and a subagent provider. Disabling the bundle removes the tools and the dispatcher and leaves stored tasks on disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` inserts the `board` and `board-executor` rows, and `package.json` depends on both packages so the rows resolve from this bundle. No runtime invariant companion is published because the board validates its own graph and revisions.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the `board` and `board-executor` rows |
| [`package.json`](package.json) | The row packages as dependencies |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin-manager title and description |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Board package](../../board/board/README.md) — the task model, tools, and config.
- [Board executor](../../board/board-executor/README.md) — planning, dispatch, and worktree isolation.
- [Board subsystem](../../../docs/subsystems/board.md) — the task vocabulary.

-----

<a id="model-experience"></a>
## Model Experience

### Board tools

#### What the model sees

A live root Agent gains `board_create`, `board_list`, `board_get`, `board_update`, `board_complete`, and `board_claim`; each task renders as one compact line with its id, revision, status, priority, and title.

#### Token effect

Six tool schemas join every live root Agent request; listing returns one line per matching task.

#### KV Cache effect

The six schemas change the request prefix once when the bundle mounts. Listing results are tool-result content after that prefix, so existing cache entries are not invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This bundle mounts the board without automatic dispatch: set `auto: true` on the executor (with a provider) to drive ready tasks, or call `ctx.boardExecutor.dispatch` from a Host caller. The board tools and the dispatcher are not otherwise wired.
- The dispatcher needs a live parent agent; a task whose creator session has ended is skipped until a caller supplies a parent.
- No Web board UI ships with this bundle; the board is read and written through tools.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
