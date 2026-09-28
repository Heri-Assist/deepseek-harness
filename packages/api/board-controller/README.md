---
description: "The board Remote owner a future Web Kanban surface calls, exposing board reads and compare-and-set writes over the generated board namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-board-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-board-controller` is the Host side of the board's browser surface. It publishes a `board` Remote namespace so a client can list a workspace's tasks and create or change them without holding the board store itself. Readiness is derived on every read, so the browser never computes it. Writes keep the board's compare-and-set rule: the caller sends the revision it last read, and a stale revision is refused as a bad request. No client UI ships in this package.

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

Mount it beside [`@deepseek-ai/dsh-board`](../../board/board/README.md). It injects the board service and registers `ctx.boardController` as the owner of the `board` Remote namespace.

```yaml
- name: '@deepseek-ai/dsh-board'
- name: '@deepseek-ai/dsh-api-board-controller'
```

### The Remote methods

`list` reads one workspace's tasks, newest last, each carrying a `ready` flag derived from its blockers. `create` adds a `backlog` task. `update` replaces the listed fields under compare-and-set. A board validation, not-found, or stale-revision failure reaches the caller as a `gateway/bad-request` Remote failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`BoardController` extends `TypertRemoteService` with namespace `board` and three `@Remote` methods. It maps stored `BoardTask` values to client-safe `BoardTaskValue` objects, computing `ready` from the workspace's whole task set. Known board errors become `RemoteError('gateway/bad-request', …)`; anything else becomes `gateway/internal`. The generated `./typert` and `./remote` artifacts are produced by the repository host build.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `BoardController`, the three Remote methods, and error mapping |
| [`src/types.ts`](src/types.ts) | Client-safe request and value types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Board package](../../board/board/README.md) — the task store this owner reads and writes.
- [Board subsystem](../../../docs/subsystems/board.md) — the task, status, and dependency vocabulary.
- [Typert subsystem](../../../docs/subsystems/typert.md) — the Remote invocation and namespace contracts.

-----

<a id="model-experience"></a>
## Model Experience

None, as the Remote owner exposes board reads and writes to the browser only.

#### KV Cache effect

None: the owner adds no request content; it serves browser calls over the generated namespace.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No client UI ships here; the generated namespace is ready for a Web Kanban surface that is not yet built.
- `list` reads a whole workspace's tasks each call; there is no change stream, so a browser must poll or refetch.
- The owner exposes read, create, and update only; claim, complete, and dispatch remain Host- or tool-driven.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
