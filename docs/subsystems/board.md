# Project task board

English | [中文](board.zh.md)

The durable task vocabulary owned by [`@deepseek-ai/dsh-board`](../../packages/board/board/README.md). Tasks live per workspace, carry compare-and-set revisions and dependency edges, and derive readiness. Configuration and tool schemas are on the [package README](../../packages/board/board/README.md).

Source: [`packages/board/board/src/types.ts`](../../packages/board/board/src/types.ts)

## Tasks and status

A `BoardTask` carries a branded `BoardTaskId`, its `WorkspaceId`, a `revision`, a `title`, an optional `description`, a `BoardPriority`, `labels`, a `BoardTaskStatus`, `blockedBy` task ids, `writeScopes`, an optional `BoardAssignee`, and creation and update instants. The stored statuses are `backlog`, `in_progress`, `review`, `done`, `cancelled`, and `blocked`. A `backlog` task is ready when every blocking task is `done`; readiness is derived on read, never stored. Every mutation increments `revision`, and a write whose supplied revision is stale is rejected with `BoardConflictError` before anything changes.

`BoardAssignee` records `kind` (`human` or `agent`), an optional owning `sessionId`, and an optional label. The dependency graph is validated acyclic on every write; a missing blocker, a self-block, or a cycle is rejected with `BoardInputError`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxboard--boardservice"></a>

### `ctx.board` — `BoardService`

Durable, workspace-scoped task board. Mutations are serialized so a compare-and-set never races another write in this process.

```ts cordis-catalog
/**
 * Create one task.
 * @param input - board, title, and optional fields.
 * @returns the stored task.
 */
create(input: BoardCreateInput): Promise<BoardTask>

/**
 * Read one task.
 * @param id - task identity.
 * @returns the stored task.
 */
get(id: BoardTaskId): Promise<BoardTask>

/**
 * List a board's tasks, newest last.
 * @param query - board and optional filters.
 * @returns the matching tasks.
 */
async list(query: BoardListQuery): Promise<BoardTask[]>

/**
 * Replace the listed fields of one task under compare-and-set.
 * @param input - task, expected revision, and replacement fields.
 * @returns the updated task.
 */
update(input: BoardUpdateInput): Promise<BoardTask>

/**
 * Move one ready-to-start task to `in_progress` and assign it.
 * @param id - task identity.
 * @param revision - expected current revision.
 * @param assignee - who takes the task.
 * @returns the updated task.
 */
claim(id: BoardTaskId, revision: number, assignee: BoardAssignee): Promise<BoardTask>

/**
 * Mark one task `done` under compare-and-set.
 * @param id - task identity.
 * @param revision - expected current revision.
 * @returns the updated task.
 */
complete(id: BoardTaskId, revision: number): Promise<BoardTask>

/**
 * Cancel one task under compare-and-set.
 * @param id - task identity.
 * @param revision - expected current revision.
 * @returns the updated task.
 */
cancel(id: BoardTaskId, revision: number): Promise<BoardTask>
```

Source: [`packages/board/board/src/index.ts`](../../packages/board/board/src/index.ts)

<a id="ctxboardexecutor--boardexecutor"></a>

### `ctx.boardExecutor` — `BoardExecutor`

Dispatch ready tasks on a board to delegated runs.

```ts cordis-catalog
/**
 * Run one dispatch pass.
 * @param request - board, optional repository path, and optional parent.
 * @returns the started and skipped task ids.
 */
dispatch(request: DispatchRequest): Promise<DispatchOutcome>
```

Source: [`packages/board/board-executor/src/index.ts`](../../packages/board/board-executor/src/index.ts)

<a id="board-events"></a>

### `board/*` events

<a id="boardchanged--emit"></a>

#### `board/changed` — emit

A board task was created, changed, or cancelled; clients refetch.

```ts cordis-catalog
/** A board task was created, changed, or cancelled; clients refetch.
 * @mode emit
 */
'board/changed'(): void
```

Source: [`packages/board/board/src/index.ts`](../../packages/board/board/src/index.ts)
<!-- END GENERATED cordis-surface -->
