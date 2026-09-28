# Agent 记忆

[English](memory.md) | 中文

由 [`@deepseek-ai/dsh-memory`](../../packages/memory/memory/README.zh.md) 拥有的持久记忆词汇。该存储跨会话保留事实，按 scope 分层并为关键词召回建立索引。包配置、工具 schema 与存储契约见[包 README](../../packages/memory/memory/README.zh.md)。

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## 记录与 scope

`MemoryRecord` 携带品牌化的 `MemoryId`、取值为 `global`、`project` 或 `task` 的 `MemoryScope`、可选的所属 `workspaceId` 与 `taskId`、可选的 `key` 与 `tags`、事实 `text`、`MemorySource`、`pinned` 标记、时间戳与使用计数。`project` 写入需要 workspace id，`task` 写入还额外需要 task id；缺失任一项的写入会在存储前以 `MemoryInputError` 拒绝。存储会检查 `text` 非空且处于配置的字节上限内；它不做脱敏，因此调用方不得写入凭据。

`MemorySource` 记录产生它的会话 id、事件序号与已知时的工具调用 id，以及取值为 `explicit` 或 `extracted` 的 `MemoryOrigin`。

## 召回

`MemoryQuery` 按文本词语、标签、scope、workspace 与 task 过滤。文本与标签使用 SQLite FTS5（`unicode61`）索引；`buildMatchExpression` 把每个词语引用为惰性短语，使查询语法始终是数据。`MemoryHit` 把匹配记录与其 FTS5 排序配对。`recall` 把每条返回记录标记为已使用；`search` 不标记。`forget` 软删除记录并保留其墓碑。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memorystore"></a>

### `ctx.memory` — `MemoryStore`

Durable, Host-wide layered memory. Writes and reads are independent of any Session; source links each record to the work that produced it.

```ts cordis-catalog
/**
 * Persist one fact.
 * @param input - the fact, its scope, and its source.
 * @returns the stored record.
 * @throws {@link MemoryInputError} when the input violates a store constraint.
 */
async remember(input: RememberInput): Promise<MemoryRecord>

/**
 * Search records and mark every returned record as used.
 * @param query - text, tag, and scope filters.
 * @returns ranked hits.
 */
async recall(query: MemoryQuery): Promise<MemoryHit[]>

/**
 * Search records without marking them used.
 * @param query - text, tag, and scope filters.
 * @returns ranked hits.
 */
async search(query: MemoryQuery): Promise<MemoryHit[]>

/**
 * Soft-delete one record, keeping an auditable tombstone.
 * @param id - the record identity.
 * @returns true when an active record was forgotten.
 */
async forget(id: MemoryId): Promise<boolean>

/**
 * List active records, newest first.
 * @param query - optional scope filters.
 * @returns the matching records.
 */
async list(query: MemoryQuery = {}): Promise<MemoryRecord[]>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)

<a id="memory-events"></a>

### `memory/*` events

<a id="memorychanged--emit"></a>

#### `memory/changed` — emit

A memory record was written, updated, or forgotten; clients refetch.

```ts cordis-catalog
/** A memory record was written, updated, or forgotten; clients refetch.
 * @mode emit
 */
'memory/changed'(): void
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
