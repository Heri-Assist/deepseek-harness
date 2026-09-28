# 项目任务看板

[English](board.md) | 中文

由 [`@deepseek-ai/dsh-board`](../../packages/board/board/README.zh.md) 拥有的持久任务词汇。任务按 workspace 存在，携带 compare-and-set 修订号与依赖边，并推导就绪状态。配置与工具 schema 见[包 README](../../packages/board/board/README.zh.md)。

Source: [`packages/board/board/src/types.ts`](../../packages/board/board/src/types.ts)

## 任务与状态

`BoardTask` 携带品牌化 `BoardTaskId`、其 `WorkspaceId`、`revision`、`title`、可选的 `description`、`BoardPriority`、`labels`、`BoardTaskStatus`、`blockedBy` 任务 id、`writeScopes`、可选的 `BoardAssignee`，以及创建与更新时刻。存储的状态为 `backlog`、`in_progress`、`review`、`done`、`cancelled` 与 `blocked`。当所有阻塞任务都为 `done` 时，`backlog` 任务即就绪；就绪在读取时推导，绝不存储。每次变更都会递增 `revision`，而提供的修订号已过期的写入会在任何改变之前以 `BoardConflictError` 被拒绝。

`BoardAssignee` 记录 `kind`（`human` 或 `agent`）、可选的所属 `sessionId` 与可选标签。依赖图在每次写入时都会被校验为无环；缺失的阻塞任务、自阻塞或环都会以 `BoardInputError` 被拒绝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
