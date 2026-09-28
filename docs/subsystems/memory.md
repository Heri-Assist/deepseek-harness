# Agent memory

English | [中文](memory.zh.md)

The durable memory vocabulary owned by [`@deepseek-ai/dsh-memory`](../../packages/memory/memory/README.md). The store keeps facts across Sessions, layered by scope and indexed for keyword recall. Package configuration, tool schemas, and the store contract are on the [package README](../../packages/memory/memory/README.md).

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

## Records and scopes

A `MemoryRecord` carries a branded `MemoryId`, a `MemoryScope` of `global`, `project`, or `task`, optional owning `workspaceId` and `taskId`, optional `key` and `tags`, the fact `text`, `MemorySource`, a `pinned` flag, timestamps, and a use count. A `project` write requires a workspace id and a `task` write additionally requires a task id; a write missing either is rejected with `MemoryInputError` before storage. The store checks that `text` is non-empty and within the configured byte limit; it does not redact, so callers must not write credentials.

`MemorySource` records the producing session id, event sequence, and tool call id when known, plus a `MemoryOrigin` of `explicit` or `extracted`.

## Retrieval

`MemoryQuery` filters by text terms, tags, scope, workspace, and task. Text and tags are indexed with SQLite FTS5 (`unicode61`); `buildMatchExpression` quotes each term as an inert phrase, so query syntax stays data. `MemoryHit` pairs a matched record with its FTS5 rank. `recall` marks each returned record used; `search` does not. `forget` soft-deletes a record and keeps its tombstone.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
